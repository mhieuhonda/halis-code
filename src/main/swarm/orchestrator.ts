/**
 * Swarm orchestrator — runs the group chat turn:
 *
 *   user message → route (@mentions or planner) → addressed agents take
 *   turns (their replies may address further agents) → repeat within a
 *   round budget → done.
 *
 * Anti-chaos guarantees:
 *  - every agent message carries explicit recipients (parsed @mentions);
 *  - each agent speaks at most `speakBudget` times per user turn;
 *  - the planner, when addressed, runs first and alone so it can coordinate;
 *  - context filtering means each agent only sees what concerns it.
 */
import type { AgentConfig, ChatMessage, HarnessEvent, QuestionAnswer, QuestionPrompt, Session, SwarmConfig } from '@shared/types'
import { newId } from '../util/id'
import type { LlmDispatcher } from '../models/llm/client'
import type { LlmMessage } from '../models/llm/types'
import { AgentRunner } from '../harness/loop'
import { buildAgentContext } from '../harness/context-filter'
import { TodoStore, type ToolContext } from '../harness/tools'
import type { ToolRegistry } from '../harness/tools'
import type { ApprovalManager } from '../harness/approvals'
import type { FileLockManager } from '../harness/file-locking'
import type { TaskBoard } from '../harness/task-board'
import type { Sandbox } from '../harness/sandbox'
import type { JobRegistry } from '../harness/jobs'
import type { ScheduleStore } from '../harness/schedules'
import type { McpManager } from '../harness/mcp'
import { buildSystemPrompt } from './prompts'
import { ponytailSection } from '../harness/ponytail'
import { parseAgentReply, routeNext } from './router'

export interface SwarmDeps {
  dispatcher: LlmDispatcher
  registry: ToolRegistry
  approvals: ApprovalManager
  locks: FileLockManager
  taskBoard: TaskBoard
  sandbox: Sandbox
  jobs: JobRegistry
  schedules: ScheduleStore
  mcp: McpManager
  todoFor: (sessionId: string, emit: (event: HarnessEvent) => void) => TodoStore
  saveTodos: (session: Session) => void
  askUser: (questions: QuestionPrompt[], ctx: { sessionId: string; agentId: string; agentName: string; agentColor?: string }) => Promise<QuestionAnswer[] | null>
  getSettings: () => { workspace: string; language: import('@shared/types').AppLanguage; autoApproveAll: boolean; telegraph: import('@shared/types').TelegraphSettings; telegraphEnabled?: boolean; ponytailEnabled?: boolean; tavilyApiKey?: string }
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

  private toolContextFor(agent: AgentConfig, session: Session, allAgents: AgentConfig[], messageId: string, outbox: ChatMessage[]): ToolContext {
    const settings = this.deps.getSettings()
    return {
      sandbox: this.deps.sandbox,
      locks: this.deps.locks,
      taskBoard: this.deps.taskBoard,
      approvals: this.deps.approvals,
      workspace: this.deps.sandbox.workspace,
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
          to: mentioned,
          mentions: mentioned,
        }
        outbox.push(message)
      },
      jobs: this.deps.jobs,
      schedules: this.deps.schedules,
      mcp: this.deps.mcp,
      todos: this.deps.todoFor(session.id, this.deps.emit),
      settings: { tavilyApiKey: settings.tavilyApiKey },
      askUser: (questions) =>
        this.deps.askUser(questions as QuestionPrompt[], {
          sessionId: session.id,
          agentId: agent.id,
          agentName: agent.name,
          agentColor: agent.color,
        }),
      delegationDepth: 1,
    }
  }

  private resolveNames(names: string[], agents: AgentConfig[]): string[] {
    const ids: string[] = []
    for (const raw of names) {
      // Models pass "@Name" as often as "Name" — strip the sigil and trim.
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
    const planner = agents.find((a) => a.roleId === 'planner')
    const speakBudget = new Map<string, number>(agents.map((a) => [a.id, 2]))
    const produced: ChatMessage[] = []
    const outboxAll: ChatMessage[] = []

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
          try {
            const outbox: ChatMessage[] = []
            const message = await this.runOneAgent({ session, config, agent, objective: params.objective, outbox, signal, allAgents: agents })
            roundMessages.push(...outbox, message)
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err)
            const failMessage: ChatMessage = {
              ...this.agentMessageBase(session, agent),
              streaming: false,
              to: ['user'],
              content: '',
              error: `Agent failed: ${error}`,
            }
            roundMessages.push(failMessage)
          } finally {
            this.deps.emit({ type: 'typing', sessionId: session.id, agentId, agentName: agent.name, isTyping: false })
          }
        }),
      )

      if (!roundMessages.length) break

      // Persist + index the round's messages, oldest first for stable routing.
      roundMessages.sort((a, b) => a.createdAt - b.createdAt)
      session.messages.push(...roundMessages)
      produced.push(...roundMessages)
      outboxAll.push(...roundMessages)
      this.deps.persistSession(session)

      // Route on the union of this round's agent messages.
      const alreadySpoke = new Set([...speakBudget].filter(([, n]) => n <= 0).map(([id]) => id))
      const nextTargets = new Set<string>()
      for (const message of roundMessages) {
        if (message.role !== 'assistant' || message.from === 'system') continue
        const next = routeNext({ message, agents, plannerId: undefined, alreadySpoke })
        for (const id of next.toRun) nextTargets.add(id)
      }
      decision = { toRun: [...nextTargets], unknownMentions: [] }
    }

    return { messages: produced, rounds: round }
  }

  private async runOneAgent(params: {
    session: Session
    config: SwarmConfig
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

    const planner = allAgents.find((a) => a.roleId === 'planner')
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
    const systemPrompt = buildSystemPrompt({
      agent,
      allAgents,
      swarm: true,
      workspace: settings.workspace,
      language: settings.language,
      taskBoardSummary: this.deps.taskBoard.renderForPrompt(),
      telegraphEnabled: settings.telegraphEnabled !== false,
      ponytailSection: settings.ponytailEnabled ? ponytailSection() : undefined,
    })

    const toolContext = this.toolContextFor(agent, session, allAgents, message.id, outbox)
    const result = await this.runner.runTurn(
      {
        sessionId: session.id,
        messageId: message.id,
        modelId: agent.modelId,
        apiKey: agent.apiKey,
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
