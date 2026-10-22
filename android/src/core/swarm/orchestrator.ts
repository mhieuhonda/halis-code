/**
 * Swarm orchestrator — runs the group chat turn (mobile edition):
 *
 *   user message → route (@mentions or planner) → addressed agents take
 *   turns (their replies may address further agents) → repeat within a
 *   round budget → done.
 *
 * Anti-chaos guarantees are identical to the desktop app: explicit
 * recipients, per-agent speak budget, planner-first coordination and
 * context filtering.
 */
import type { AgentConfig, ChatMessage, HarnessEvent, QuestionAnswer, QuestionPrompt, Session, SwarmConfig } from '@shared/types'
import { newId } from '../util/id'
import type { LlmDispatcher } from '../llm/client'
import type { LlmMessage } from '../llm/types'
import { AgentRunner } from '../harness/loop'
import { buildAgentContext, seedUserAsk } from '../harness/context-filter'
import { TodoStore, type ToolContext } from '../harness/tools'
import type { ToolRegistry } from '../harness/tools'
import type { ApprovalManager } from '../harness/approvals'
import type { TaskBoard } from '../task-board'
import type { ScheduleStore } from '../schedules'
import { buildSystemPrompt } from './prompts'
import { normalizeRoleId } from './roles'
import { parseAgentReply, resolveMentions, routeNext } from './router'

export interface SwarmDeps {
  dispatcher: LlmDispatcher
  registry: ToolRegistry
  approvals: ApprovalManager
  taskBoard: TaskBoard
  schedules: ScheduleStore
  todoFor: (sessionId: string, emit: (event: HarnessEvent) => void) => TodoStore
  saveTodos: (session: Session) => void
  askUser: (questions: QuestionPrompt[], ctx: { sessionId: string; agentId: string; agentName: string; agentColor?: string }, opts?: { timeoutMs?: number }) => Promise<QuestionAnswer[] | null>
  getSettings: () => { language: import('@shared/types').AppLanguage; autoApproveAll: boolean; telegraph: import('@shared/types').TelegraphSettings; telegraphEnabled?: boolean; tavilyApiKey?: string }
  telegraph: ToolContext['telegraph']
  emit: (event: HarnessEvent) => void
  persistSession: (session: Session) => void
}

export interface SwarmTurnParams {
  session: Session
  config: SwarmConfig
  objective: string
  signal: AbortSignal
}

export class SwarmOrchestrator {
  private runner: AgentRunner

  constructor(private readonly deps: SwarmDeps) {
    this.runner = new AgentRunner(deps.dispatcher, deps.registry)
  }

  private agentMessageBase(session: Session, agent: AgentConfig): ChatMessage {
    return {
      id: newId('msg'),
      sessionId: session.id,
      mode: 'swarm',
      from: agent.id,
      fromName: agent.name,
      to: [],
      mentions: [],
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      streaming: true,
      model: agent.modelId,
      agentRole: agent.roleId,
      agentColor: agent.color,
      agentAvatar: agent.avatar,
    }
  }

  private toolContextFor(agent: AgentConfig, session: Session, allAgents: AgentConfig[], messageId: string, outbox: ChatMessage[], signal?: AbortSignal): ToolContext {
    const settings = this.deps.getSettings()
    return {
      taskBoard: this.deps.taskBoard,
      approvals: this.deps.approvals,
      sessionId: session.id,
      messageId,
      agentId: agent.id,
      agentName: agent.name,
      agentColor: agent.color,
      permissions: agent.permissions,
      alwaysRules: this.deps.approvals.rulesFor(agent.id),
      autoApproveAll: settings.autoApproveAll,
      telegraph: this.deps.telegraph,
      emit: this.deps.emit,
      sendMessage: (to, content) => {
        const mentioned = this.resolveNames(to, allAgents)
        const message: ChatMessage = {
          ...this.agentMessageBase(session, agent),
          streaming: false,
          content,
          // `to` carries resolved agent ids; `mentions` keeps the raw names
          // so routeNext (a name-based resolver) can re-resolve them.
          to: mentioned,
          mentions: to.map((n) => n.trim().replace(/^@+/, '')),
        }
        outbox.push(message)
        this.deps.emit({ type: 'message-start', sessionId: session.id, message })
        this.deps.emit({ type: 'message-done', sessionId: session.id, messageId: message.id, message })
      },
      schedules: this.deps.schedules,
      todos: this.deps.todoFor(session.id, this.deps.emit),
      settings: { tavilyApiKey: settings.tavilyApiKey },
      askUser: (questions, opts) =>
        this.deps.askUser(
          questions as QuestionPrompt[],
          {
            sessionId: session.id,
            agentId: agent.id,
            agentName: agent.name,
            agentColor: agent.color,
          },
          opts,
        ),
      signal,
      delegationDepth: 1,
    }
  }

  private resolveNames(names: string[], agents: AgentConfig[]): string[] {
    const ids: string[] = []
    for (const raw of names) {
      const name = raw.trim().replace(/^@+/, '')
      const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase())
      if (agent) ids.push(agent.id)
      else ids.push(`name:${name}`)
    }
    return ids
  }

  async runTurn(params: SwarmTurnParams): Promise<{ messages: ChatMessage[]; rounds: number }> {
    const { session, config, signal } = params
    const agents = config.agents.filter((a) => a.enabled)
    if (!agents.length) throw new Error('No enabled agents in the swarm. Configure the team first.')
    const planner = agents.find((a) => normalizeRoleId(a.roleId) === 'chief-of-staff')
    const speakBudget = new Map<string, number>(agents.map((a) => [a.id, 2]))
    const produced: ChatMessage[] = []

    const lastUser = [...session.messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) throw new Error('No user message to run on.')

    let decision = routeNext({
      message: lastUser,
      agents,
      plannerId: planner?.id,
      alreadySpoke: new Set([...speakBudget].filter(([, n]) => n <= 0).map(([id]) => id)),
    })
    if (decision.unknownMentions.length) {
      const note: ChatMessage = {
        id: newId('msg'),
        sessionId: session.id,
        mode: 'swarm',
        from: 'system',
        fromName: 'Harness',
        to: ['user'],
        mentions: [],
        role: 'system',
        content: `Unknown @mention(s): ${decision.unknownMentions.map((m) => `@${m}`).join(', ')}. No agent has that name — nothing was routed to them.`,
        createdAt: Date.now(),
      }
      session.messages.push(note)
      produced.push(note)
      this.deps.emit({ type: 'message-start', sessionId: session.id, message: note })
      this.deps.emit({ type: 'message-done', sessionId: session.id, messageId: note.id, message: note })
      this.deps.persistSession(session)
    }

    let round = 0
    while (decision.toRun.length && round < config.maxRounds) {
      if (signal.aborted) break
      round++
      this.deps.emit({ type: 'swarm-round', sessionId: session.id, round, maxRounds: config.maxRounds })

      // Planner runs first and alone when it is among the targets.
      let batch: string[]
      if (planner && decision.toRun.includes(planner.id) && decision.toRun.length > 1) {
        batch = [planner.id]
      } else {
        batch = decision.toRun.filter((id) => (speakBudget.get(id) ?? 0) > 0)
      }

      const roundMessages: ChatMessage[] = []
      await Promise.all(
        batch.map(async (agentId) => {
          const agent = agents.find((a) => a.id === agentId)
          if (!agent) return
          speakBudget.set(agentId, (speakBudget.get(agentId) ?? 0) - 1)
          this.deps.emit({ type: 'typing', sessionId: session.id, agentId, agentName: agent.name, isTyping: true })
          const outbox: ChatMessage[] = []
          try {
            const message = await this.runOneAgent({ session, agent, objective: params.objective, outbox, signal, allAgents: agents })
            roundMessages.push(...outbox, message)
          } catch (err) {
            roundMessages.push(...outbox)
            const error = err instanceof Error ? err.message : String(err)
            const ghost = [...session.messages].reverse().find((m) => m.from === agent.id && m.streaming)
            if (ghost) {
              ghost.streaming = false
              ghost.error = `Agent failed: ${error}`
              roundMessages.push(ghost)
              this.deps.emit({ type: 'message-done', sessionId: session.id, messageId: ghost.id, message: ghost })
            } else {
              const failMessage: ChatMessage = {
                ...this.agentMessageBase(session, agent),
                streaming: false,
                to: ['user'],
                content: '',
                error: `Agent failed: ${error}`,
              }
              roundMessages.push(failMessage)
              this.deps.emit({ type: 'message-start', sessionId: session.id, message: failMessage })
              this.deps.emit({ type: 'message-done', sessionId: session.id, messageId: failMessage.id, message: failMessage })
            }
          } finally {
            this.deps.emit({ type: 'typing', sessionId: session.id, agentId, agentName: agent.name, isTyping: false })
          }
        }),
      )

      if (!roundMessages.length) break

      roundMessages.sort((a, b) => a.createdAt - b.createdAt)
      const fresh = roundMessages.filter((m) => !session.messages.includes(m))
      session.messages.push(...fresh)
      produced.push(...roundMessages)
      this.deps.persistSession(session)

      // Route on the union of this round's agent messages.
      const alreadySpoke = new Set([...speakBudget].filter(([, n]) => n <= 0).map(([id]) => id))
      const nextTargets = new Set<string>()
      const budgetBlocked = new Set<string>()
      for (const message of roundMessages) {
        if (message.role !== 'assistant' || message.from === 'system') continue
        const next = routeNext({ message, agents, plannerId: undefined, alreadySpoke })
        for (const id of next.toRun) nextTargets.add(id)
        const { resolved } = resolveMentions(message.mentions, agents)
        for (const id of resolved) {
          if (id !== message.from && alreadySpoke.has(id) && !nextTargets.has(id)) budgetBlocked.add(id)
        }
      }
      if (budgetBlocked.size) {
        const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id
        const note: ChatMessage = {
          id: newId('msg'),
          sessionId: session.id,
          mode: 'swarm',
          from: 'system',
          fromName: 'Harness',
          to: ['user'],
          mentions: [],
          role: 'system',
          content: `${[...budgetBlocked].map((id) => `@${nameOf(id)}`).join(', ')} already reached their speaking limit for this turn — the hand-off was NOT delivered. Ask them again in your next message or end the turn.`,
          createdAt: Date.now(),
        }
        session.messages.push(note)
        produced.push(note)
        this.deps.emit({ type: 'message-start', sessionId: session.id, message: note })
        this.deps.emit({ type: 'message-done', sessionId: session.id, messageId: note.id, message: note })
      }
      // When the planner ran alone this round, the agents the user (or the
      // routing) originally asked for must not be silently dropped.
      if (planner && batch.length === 1 && batch[0] === planner.id) {
        for (const id of decision.toRun) {
          if (id !== planner.id && (speakBudget.get(id) ?? 0) > 0) nextTargets.add(id)
        }
      }
      decision = { toRun: [...nextTargets], unknownMentions: [] }
    }

    return { messages: produced, rounds: round }
  }

  private async runOneAgent(params: {
    session: Session
    agent: AgentConfig
    allAgents: AgentConfig[]
    objective: string
    outbox: ChatMessage[]
    signal: AbortSignal
  }): Promise<ChatMessage> {
    const { session, agent, allAgents, objective, outbox, signal } = params
    const settings = this.deps.getSettings()
    const message = this.agentMessageBase(session, agent)
    session.messages.push(message)
    this.deps.emit({ type: 'message-start', sessionId: session.id, message })
    this.deps.persistSession(session)

    const planner = allAgents.find((a) => normalizeRoleId(a.roleId) === 'chief-of-staff')
    const context = buildAgentContext({
      agent,
      agents: allAgents,
      plannerId: planner?.id,
      messages: session.messages.filter((m) => m.id !== message.id),
      objective,
    })

    const history: LlmMessage[] = [
      ...context.transcript.map((t) => ({ role: t.role, content: t.text }) as LlmMessage),
    ]
    if (!history.length) {
      history.push({ role: 'user', content: seedUserAsk(objective, session.messages) })
    }
    const systemPrompt = buildSystemPrompt({
      agent,
      allAgents,
      swarm: true,
      language: settings.language,
      taskBoardSummary: await this.deps.taskBoard.renderForPrompt(),
      telegraphEnabled: settings.telegraphEnabled !== false,
    })

    const toolContext = this.toolContextFor(agent, session, allAgents, message.id, outbox, signal)
    const result = await this.runner.runTurn(
      {
        sessionId: session.id,
        messageId: message.id,
        modelId: agent.modelId,
        // A blank per-agent key means "use the provider key saved in the
        // vault" — pass undefined, not '', or the vault would be skipped.
        apiKey: agent.apiKey?.trim() || undefined,
        systemPrompt,
        history,
        swarm: true,
        maxSteps: 24,
        toolContext,
        signal,
      },
      this.deps.emit,
    )

    const addressed = parseAgentReply(result.text, allAgents)
    message.content = result.text
    message.reasoning = result.reasoning || undefined
    message.mentions = addressed.mentions
    message.to = addressed.to.length ? addressed.to : ['user']
    message.streaming = false
    message.error = result.error
    if (result.usage.inputTokens > 0 || result.usage.outputTokens > 0) message.usage = result.usage
    message.parts = [
      ...(message.parts ?? []),
      ...result.toolRuns.map((run) => ({ type: 'tool' as const, run })),
    ]
    this.deps.emit({ type: 'message-done', sessionId: session.id, messageId: message.id, message })
    this.deps.saveTodos(session)
    this.deps.persistSession(session)
    return message
  }
}
