/**
 * HalisMobile — the app runtime: settings, vault, catalog, task board,
 * approvals, sessions, reminders, todos, the single-agent runner (with
 * auto-compaction and delegation) and the swarm orchestrator. The UI bridge
 * is a thin typed wrapper around this object.
 *
 * Desktop surfaces that cannot exist on Android (file tools, shell, git,
 * background command jobs, MCP stdio, workspace folders) are simply absent.
 */
import type {
  AlwaysAllowRule,
  AppSettings,
  BoardTask,
  ChatMessage,
  CatalogSnapshot,
  HarnessEvent,
  QuestionAnswer,
  QuestionPrompt,
  ScheduleView,
  Session,
  SwarmConfig,
  TelegraphAskResult,
  TelegraphNetworkConfig,
  TelegraphReceipt,
  TelegraphStatus,
  ToolRun,
} from '@shared/types'
import { loadSettings, setSettings, currentSettingsSync } from './settings'
import { KeyVault } from './keyvault'
import { modelCatalog } from './models/catalog'
import { LlmDispatcher } from './llm/client'
import type { LlmMessage } from './llm/types'
import { AgentRunner } from './harness/loop'
import { ApprovalManager, defaultSingleAgentPermissions } from './harness/approvals'
import { TaskBoard } from './task-board'
import { createToolRegistry } from './harness/tools/registry'
import { TodoStore, type ToolContext } from './harness/tools'
import { ScheduleStore, type Schedule } from './schedules'
import { planCompaction, olderToTranscript, summarizeRequest, looksLikeSummary } from './harness/compaction'
import { SwarmOrchestrator } from './swarm/orchestrator'
import { buildSingleAgentPrompt } from './swarm/prompts'
import { extractMentions, resolveMentions } from './swarm/router'
import { SWARM_ROLES, normalizeRoleId } from './swarm/roles'
import { readJson, writeJson } from './storage'
import { newId } from './util/id'
import { raceWithAbort } from './harness/util/abort-race'
import { SessionStore } from './sessions'
import { getNetwork } from './telegraph/config'
import { ReceiptLedger } from './telegraph/receipts'
import { usdcBalance, walletAddress, createBurnerWallet, importWallet } from './telegraph/wallet'
import { pingNode, listIntents, askTelegraph, verifySignal, listMiners, TelegraphError } from './telegraph/client'
import { telegraphTools } from './harness/tools/telegraph'

export class HalisMobile {
  readonly vault = new KeyVault()
  readonly dispatcher: LlmDispatcher
  readonly registry = createToolRegistry()
  readonly approvals = new ApprovalManager()
  readonly sessions = new SessionStore()
  readonly ledger = new ReceiptLedger()
  readonly schedules = new ScheduleStore()
  readonly taskBoard = new TaskBoard()
  private todoStores = new Map<string, TodoStore>()

  private running = new Map<string, AbortController>()
  private pendingReminders = new Map<string, Schedule[]>()
  /** In-memory session objects of turns currently running. */
  private liveSessions = new Map<string, Session>()
  private broadcaster: ((event: HarnessEvent) => void) | null = null
  private swarmConfig: SwarmConfig | null = null
  private started = false

  constructor() {
    this.dispatcher = new LlmDispatcher(() => modelCatalog.get(), (providerId) => this.keys.get(providerId))

    this.approvals.setHooks({
      onRequest: (request) => this.emit({ type: 'approval-request', request }),
      onResolved: (requestId, approved) => this.emit({ type: 'approval-resolved', requestId, approved }),
      // "Always allow" rules survive restarts — they are part of the user's
      // trust decisions, not transient turn state.
      onRulesChanged: (rules) => void writeJson('approval-rules', rules),
    })
    this.taskBoard.setHooks({ onChanged: (tasks) => this.emit({ type: 'task-board-changed', tasks }) })
    modelCatalog.setUpdatedListener((catalog) => this.emit({ type: 'model-catalog-updated', catalog }))

    // Reminders fire back into their session as a prompt turn.
    this.schedules.setHooks({
      onFire: (schedule) => this.fireReminder(schedule),
      onChanged: () => {},
    })

    // MCP tools surface (desktop-only) is intentionally absent: settings
    // keep mcpServers at [] and the registry has no mcp_ namespace.
  }

  /** In-memory key cache fed by the async vault. */
  private keys = new Map<string, string>()

  /** Called once when the app boots, before the first render completes. */
  async startup(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.vault.load()
    await this.refreshKeyCache()
    await loadSettings()
    const rules = await readJson<AlwaysAllowRule[]>('approval-rules', [])
    this.approvals.setRules(rules)
    await this.taskBoard.all()
    await this.schedules.init()
    this.applyTelegraphEnabled()
    modelCatalog.startBackgroundRefresh()
  }

  private async refreshKeyCache(): Promise<void> {
    const status = await this.vault.statusAll()
    this.keys.clear()
    for (const providerId of Object.keys(status)) {
      const key = await this.vault.get(providerId)
      if (key) this.keys.set(providerId, key)
    }
  }

  /* ------------------------- Telegraph master switch ------------------------- */

  static readonly TELEGRAPH_WALLET_VAULT_ID = 'telegraph-wallet'

  /** Register or unregister every telegraph_* tool based on the Settings switch. */
  applyTelegraphEnabled(): void {
    void loadSettings().then((settings) => {
      const enabled = settings.telegraphEnabled !== false
      const hasTelegraph = this.registry.get('telegraph_ask') !== undefined
      if (enabled && !hasTelegraph) {
        for (const tool of telegraphTools) this.registry.register(tool)
      } else if (!enabled && hasTelegraph) {
        this.registry.unregisterNamespace('telegraph_')
      }
    })
  }

  async telegraphEnabled(): Promise<boolean> {
    return (await loadSettings()).telegraphEnabled !== false
  }

  /* ------------------------- wiring ------------------------- */

  setBroadcaster(fn: (event: HarnessEvent) => void): void {
    this.broadcaster = fn
  }

  emit(event: HarnessEvent): void {
    try {
      this.broadcaster?.(event)
    } catch (err) {
      console.warn('[halis] emit failed:', err)
    }
  }

  async settings(): Promise<AppSettings> {
    return loadSettings()
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = await setSettings(patch)
    if (patch.telegraphEnabled !== undefined) this.applyTelegraphEnabled()
    return next
  }

  /** The real per-turn Telegraph deps (async settings resolved). */
  async buildTelegraphView(): Promise<NonNullable<ToolContext['telegraph']>> {
    const settings = await loadSettings()
    return {
      enabled: settings.telegraphEnabled !== false,
      privateKey: await this.vault.get(HalisMobile.TELEGRAPH_WALLET_VAULT_ID),
      network: getNetwork(settings.telegraph.networkId),
      autoApproveUpTo: settings.telegraph.autoApproveUpTo,
      dailyBudgetUsd: settings.telegraph.dailyBudgetUsd,
      ledger: this.ledger,
      onReceipt: (receipt, messageId) => this.emit({ type: 'receipt', sessionId: '', messageId, receipt }),
    }
  }

  /* ------------------------- todos ------------------------- */

  todoStoreFor(session: Session, emit: (event: HarnessEvent) => void): TodoStore {
    let store = this.todoStores.get(session.id)
    if (!store) {
      store = new TodoStore(session.id, emit, session.todos ?? [])
      this.todoStores.set(session.id, store)
    }
    return store
  }

  private saveTodos(session: Session, todos: ReturnType<TodoStore['get']>): void {
    session.todos = todos.length ? todos : undefined
    void this.sessions.save(session)
  }

  /* ------------------------- reminders ------------------------- */

  private fireReminder(schedule: Schedule): void {
    this.emit({ type: 'reminder-fired', sessionId: schedule.sessionId, scheduleId: schedule.id, title: schedule.title, prompt: schedule.prompt })
    if (this.running.has(schedule.sessionId)) {
      const queue = this.pendingReminders.get(schedule.sessionId) ?? []
      queue.push(schedule)
      this.pendingReminders.set(schedule.sessionId, queue)
      return
    }
    void this.runReminderTurn(schedule).catch((err) => console.warn('[halis] reminder turn failed:', err))
  }

  private async runReminderTurn(schedule: Schedule): Promise<void> {
    const controller = new AbortController()
    this.running.set(schedule.sessionId, controller)
    try {
      const session = await this.sessions.get(schedule.sessionId)
      if (!session) return
      this.liveSessions.set(schedule.sessionId, session)
      const reminderMessage: ChatMessage = {
        id: newId('msg'),
        sessionId: session.id,
        mode: session.mode,
        from: 'system',
        fromName: `⏰ ${schedule.title}`,
        to: [],
        mentions: [],
        role: 'user',
        content: `[Reminder fired: ${schedule.title}]\n\n${schedule.prompt}`,
        createdAt: Date.now(),
      }
      session.messages.push(reminderMessage)
      await this.sessions.save(session)
      this.emit({ type: 'message-start', sessionId: session.id, message: reminderMessage })

      if (session.mode === 'agent') {
        await this.runSingleAgent(session, session.modelId ?? (await loadSettings()).defaultModelId, controller)
      } else {
        await this.runSwarm(session, controller)
      }
    } finally {
      this.running.delete(schedule.sessionId)
      this.liveSessions.delete(schedule.sessionId)
      this.approvals.rejectAllForSession(schedule.sessionId)
    }
    const queued = this.pendingReminders.get(schedule.sessionId)
    if (queued?.length) {
      this.pendingReminders.delete(schedule.sessionId)
      for (const next of queued) {
        await this.runReminderTurn(next)
      }
    }
  }

  /* ------------------------- chat ------------------------- */

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId)
  }

  /** Sessions with a live turn — lets a reloaded renderer recover its Stop buttons. */
  runningSessionIds(): string[] {
    return [...this.running.keys()].filter((id) => !id.endsWith(':sub'))
  }

  stop(sessionId: string): void {
    this.running.get(sessionId)?.abort()
  }

  /** Abort every running turn. */
  stopAll(): void {
    for (const controller of this.running.values()) controller.abort()
    this.running.clear()
  }

  async send(params: { sessionId: string; text: string; modelId?: string }): Promise<{ ok: boolean; error?: string }> {
    const { sessionId, text } = params
    if (this.running.has(sessionId)) return { ok: false, error: 'A turn is already running in this session. Stop it first.' }
    const session = await this.sessions.get(sessionId)
    if (!session) return { ok: false, error: 'Session not found.' }
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, error: 'Empty message.' }

    const controller = new AbortController()
    this.running.set(sessionId, controller)
    this.liveSessions.set(sessionId, session)

    try {
      // Parse @mentions for swarm routing (explicit addressing, no broadcast).
      let mentions: string[] = []
      let to: string[] = []
      if (session.mode === 'swarm') {
        const config = await this.getSwarmConfig()
        const found = extractMentions(trimmed)
        const { resolved } = resolveMentions(found, config.agents.filter((a) => a.enabled))
        mentions = found
        to = resolved
      }
      const userMessage: ChatMessage = {
        id: newId('msg'),
        sessionId,
        mode: session.mode,
        from: 'user',
        fromName: 'You',
        to,
        mentions,
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
      }
      session.messages.push(userMessage)
      this.sessions.maybeAutoTitle(session)
      await this.sessions.save(session)
      this.emit({ type: 'message-start', sessionId, message: userMessage })

      if (session.mode === 'agent') {
        await this.runSingleAgent(session, params.modelId ?? session.modelId ?? (await loadSettings()).defaultModelId, controller)
      } else {
        await this.runSwarm(session, controller)
      }
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const errorMessage: ChatMessage = {
        id: newId('msg'),
        sessionId,
        mode: session.mode,
        from: 'system',
        fromName: 'Halis',
        to: [],
        mentions: [],
        role: 'system',
        content: message,
        createdAt: Date.now(),
      }
      session.messages.push(errorMessage)
      await this.sessions.save(session)
      this.emit({ type: 'message-start', sessionId, message: errorMessage })
      return { ok: false, error: message }
    } finally {
      this.running.delete(sessionId)
      this.liveSessions.delete(sessionId)
      // Scope the cleanup to THIS session: another session's turn may be
      // running concurrently with its own approval cards.
      this.approvals.rejectAllForSession(sessionId)
      const queued = this.pendingReminders.get(sessionId)
      if (queued?.length) {
        this.pendingReminders.delete(sessionId)
        for (const schedule of queued) {
          await this.runReminderTurn(schedule).catch((err) => console.warn('[halis] reminder turn failed:', err))
        }
      }
    }
  }

  /** Build the ToolContext shared by agent + swarm turns. */
  private async baseToolContext(input: {
    session: Session
    messageId: string
    agentId: string
    agentName: string
    agentColor?: string
    permissions: ToolContext['permissions']
    emit: (event: HarnessEvent) => void
    sendMessage?: ToolContext['sendMessage']
    signal?: AbortSignal
    depth?: number
  }): Promise<ToolContext> {
    const session = input.session
    const settings = await loadSettings()
    return {
      taskBoard: this.taskBoard,
      approvals: this.approvals,
      sessionId: session.id,
      messageId: input.messageId,
      agentId: input.agentId,
      agentName: input.agentName,
      agentColor: input.agentColor,
      permissions: input.permissions,
      alwaysRules: this.approvals.rulesFor(input.agentId),
      autoApproveAll: settings.autoApproveAll,
      telegraph: await this.buildTelegraphView(),
      emit: input.emit,
      sendMessage: input.sendMessage,
      schedules: this.schedules,
      todos: this.todoStoreFor(session, input.emit),
      settings: { tavilyApiKey: settings.tavilyApiKey || undefined },
      signal: input.signal,
      delegationDepth: input.depth ?? 0,
      askUser: async (questions, opts) => {
        const { id, wait } = this.approvals.requestQuestions({
          sessionId: session.id,
          agentId: input.agentId,
          agentName: input.agentName,
          agentColor: input.agentColor,
          questions: questions as QuestionPrompt[],
        })
        const timeoutMs = Math.max(1_000, opts?.timeoutMs ?? 10 * 60 * 1000)
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeoutPromise = new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs)
        })
        try {
          return await raceWithAbort(Promise.race([wait, timeoutPromise]), input.signal)
        } finally {
          if (timer) clearTimeout(timer)
          this.approvals.dismissQuestions(id)
        }
      },
      delegate:
        (input.depth ?? 0) >= 1
          ? undefined
          : async (task) => {
              const subController = new AbortController()
              const abortSub = () => subController.abort()
              if (input.signal?.aborted) subController.abort()
              else input.signal?.addEventListener('abort', abortSub, { once: true })
              this.running.set(`${session.id}:sub`, subController)
              try {
                const subSession: Session = { ...session, messages: [] }
                const subMessageId = newId('msg')
                const subContext = await this.baseToolContext({
                  session: subSession,
                  messageId: subMessageId,
                  agentId: `${input.agentId}:sub`,
                  agentName: `${input.agentName} (sub)`,
                  agentColor: input.agentColor,
                  permissions: { ...defaultSingleAgentPermissions(), canRunShell: false },
                  emit: input.emit,
                  signal: subController.signal,
                  depth: (input.depth ?? 0) + 1,
                })
                subContext.todos = new TodoStore(`${session.id}:sub`, input.emit)
                delete (subContext as { askUser?: unknown }).askUser
                const settings = await loadSettings()
                const systemPrompt = `${buildSingleAgentPrompt(settings.language, await this.taskBoard.renderForPrompt(), settings.telegraphEnabled !== false)}\n\nYou are a SUB-AGENT spawned for one focused task: "${task.description}". Work autonomously and end with a complete final report — your reply is returned verbatim to the parent agent.`
                const history: LlmMessage[] = [{ role: 'user', content: task.prompt }]
                const runner = new AgentRunner(this.dispatcher, this.registry)
                const result = await runner.runTurn(
                  {
                    sessionId: `${session.id}:sub`,
                    messageId: subMessageId,
                    modelId: settings.defaultModelId,
                    systemPrompt,
                    history,
                    swarm: false,
                    maxSteps: 24,
                    toolContext: subContext,
                    signal: subController.signal,
                  },
                  input.emit,
                )
                if (result.error && !result.text) return { output: '', error: result.error }
                return { output: result.text || '(sub-agent finished with no output)' }
              } finally {
                this.running.delete(`${session.id}:sub`)
                input.signal?.removeEventListener('abort', abortSub)
                this.approvals.rejectAllForSession(`${session.id}:sub`)
              }
            },
    }
  }

  /* ------------------------- compaction ------------------------- */

  private async compactIfNeeded(session: Session, modelId: string, controller: AbortController): Promise<void> {
    const plan = planCompaction(session.messages, modelCatalog.getModel(modelId))
    if (!plan.needed) return
    try {
      const transcript =
        (session.summary?.text ? `Previous summary of the even older conversation:\n\n${session.summary.text}\n\n` : '') + olderToTranscript(plan.older)
      const result = await this.dispatcher.complete(
        modelId,
        {
          model: modelId,
          messages: summarizeRequest(transcript),
          maxTokens: 2048,
          signal: controller.signal,
        },
        undefined,
      )
      const summary = result.text.trim()
      if (!summary || !looksLikeSummary(summary)) return
      session.summary = { text: summary, coversMessages: 0, createdAt: Date.now() }
      session.messages = [...plan.recent]
      await this.sessions.save(session)
      const note: ChatMessage = {
        id: newId('msg'),
        sessionId: session.id,
        mode: session.mode,
        from: 'system',
        fromName: 'Halis',
        to: [],
        mentions: [],
        role: 'system',
        content: `Compacted ${plan.older.length} older messages into a summary to stay inside the model's context window. Nothing was lost — the summary rides at the top of the transcript.`,
        createdAt: Date.now(),
      }
      session.messages.unshift(note)
      await this.sessions.save(session)
      this.emit({ type: 'session-reloaded', session })
    } catch (err) {
      console.warn('[halis] compaction failed (continuing without):', err)
    }
  }

  /* ------------------------- single agent ------------------------- */

  private async runSingleAgent(session: Session, modelId: string, controller: AbortController): Promise<void> {
    await this.compactIfNeeded(session, modelId, controller)
    const settings = await loadSettings()
    const assistantMessage: ChatMessage = {
      id: newId('msg'),
      sessionId: session.id,
      mode: 'agent',
      from: 'halis',
      fromName: 'Halis',
      to: ['user'],
      mentions: [],
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      streaming: true,
      model: modelId,
    }
    session.messages.push(assistantMessage)
    session.modelId = modelId
    await this.sessions.save(session)
    this.emit({ type: 'message-start', sessionId: session.id, message: assistantMessage })

    const history = transcriptFromSession(session.messages, assistantMessage.id, session.summary)
    const systemPrompt = buildSingleAgentPrompt(settings.language, await this.taskBoard.renderForPrompt(), settings.telegraphEnabled !== false)
    const runner = new AgentRunner(this.dispatcher, this.registry)
    const toolContext = await this.baseToolContext({
      session,
      messageId: assistantMessage.id,
      agentId: 'halis',
      agentName: 'Halis',
      agentColor: '#7C6CFF',
      permissions: defaultSingleAgentPermissions(),
      emit: (event) => this.emit(event),
      signal: controller.signal,
    })

    const result = await runner.runTurn(
      {
        sessionId: session.id,
        messageId: assistantMessage.id,
        modelId,
        systemPrompt,
        history,
        swarm: false,
        maxSteps: 40,
        toolContext,
        signal: controller.signal,
      },
      (event) => this.emit(event),
    )

    assistantMessage.content = result.text
    assistantMessage.reasoning = result.reasoning || undefined
    assistantMessage.streaming = false
    assistantMessage.error = result.error
    if (result.usage.inputTokens > 0 || result.usage.outputTokens > 0) assistantMessage.usage = result.usage
    assistantMessage.parts = [...(assistantMessage.parts ?? []), ...result.toolRuns.map((run) => ({ type: 'tool' as const, run }))]
    this.saveTodos(session, this.todoStoreFor(session, () => {}).get())
    await this.sessions.save(session)
    this.emit({ type: 'turn-usage', sessionId: session.id, messageId: assistantMessage.id, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens })
    this.emit({ type: 'message-done', sessionId: session.id, messageId: assistantMessage.id, message: assistantMessage })
    if (result.error) this.emit({ type: 'message-error', sessionId: session.id, messageId: assistantMessage.id, error: result.error })
  }

  /* ------------------------- swarm ------------------------- */

  private async runSwarm(session: Session, controller: AbortController): Promise<void> {
    const config = await this.getSwarmConfig()
    if (!config.agents.some((a) => a.enabled)) {
      throw new Error('The swarm has no enabled agents. Open Swarm Setup and enable at least one.')
    }
    session.agentNames = config.agents.filter((a) => a.enabled).map((a) => a.name)
    await this.sessions.save(session)

    const orchestrator = new SwarmOrchestrator({
      dispatcher: this.dispatcher,
      registry: this.registry,
      approvals: this.approvals,
      taskBoard: this.taskBoard,
      schedules: this.schedules,
      todoFor: (sessionId, emit) => {
        const live = this.liveSessions.get(sessionId) ?? session
        return this.todoStoreFor(live, emit)
      },
      saveTodos: (liveSession) => this.saveTodos(liveSession, this.todoStoreFor(liveSession, () => {}).get()),
      askUser: async (questions, ctx, opts) => {
        const { id, wait } = this.approvals.requestQuestions({
          sessionId: ctx.sessionId,
          agentId: ctx.agentId,
          agentName: ctx.agentName,
          agentColor: ctx.agentColor,
          questions,
        })
        const timeoutMs = Math.max(1_000, opts?.timeoutMs ?? 10 * 60 * 1000)
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeoutPromise = new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs)
        })
        try {
          return await raceWithAbort(Promise.race([wait, timeoutPromise]), controller.signal)
        } finally {
          if (timer) clearTimeout(timer)
          this.approvals.dismissQuestions(id)
        }
      },
      getSettings: () => {
        const snapshot = currentSettingsSync()
        return {
          language: snapshot.language,
          autoApproveAll: snapshot.autoApproveAll,
          telegraph: snapshot.telegraph,
          telegraphEnabled: snapshot.telegraphEnabled,
          tavilyApiKey: snapshot.tavilyApiKey,
        }
      },
      telegraph: await this.buildTelegraphView(),
      emit: (event) => this.emit(event),
      persistSession: (s) => void this.sessions.save(s),
    })

    const objective = session.title || 'Assist the user with their request.'
    await orchestrator.runTurn({ session, config, objective, signal: controller.signal })
  }

  /** Delete a session and drop every per-session cache keyed by its id. */
  deleteSession(sessionId: string): void {
    void this.sessions.delete(sessionId)
    this.todoStores.delete(sessionId)
    this.todoStores.delete(`${sessionId}:sub`)
    this.pendingReminders.delete(sessionId)
  }

  /** Rename a session, keeping the LIVE turn's in-memory copy in sync. */
  renameSession(sessionId: string, title: string): void {
    const live = this.liveSessions.get(sessionId)
    const next = title.trim()
    if (live && next) live.title = next
    void this.sessions.rename(sessionId, title)
  }

  /* ------------------------- swarm config ------------------------- */

  async getSwarmConfig(): Promise<SwarmConfig> {
    if (!this.swarmConfig) {
      const loaded = await readJson<SwarmConfig>('swarm-config', { agents: [], maxRounds: 4, plannerCoordination: true })
      this.swarmConfig = {
        maxRounds: loaded.maxRounds ?? 4,
        plannerCoordination: loaded.plannerCoordination ?? true,
        agents: (loaded.agents ?? []).slice(0, 20).map((a) => ({
          ...a,
          modelId: a.modelId?.replace(/"/g, '').trim() ?? a.modelId,
          apiKey: a.apiKey?.trim() || undefined,
          roleId: normalizeRoleId(a.roleId),
        })),
      }
    }
    return this.swarmConfig
  }

  async saveSwarmConfig(config: SwarmConfig): Promise<{ ok: boolean; error?: string; warnings: string[] }> {
    const validation = await this.validateSwarm(config)
    if (validation.errors.length) return { ok: false, error: validation.errors.join(' '), warnings: validation.warnings }
    this.swarmConfig = { ...config, agents: config.agents.slice(0, 20) }
    await writeJson('swarm-config', this.swarmConfig)
    return { ok: true, warnings: validation.warnings }
  }

  async validateSwarm(config: SwarmConfig): Promise<{ ok: boolean; errors: string[]; warnings: string[] }> {
    const errors: string[] = []
    const warnings: string[] = []
    const agents = config.agents ?? []
    if (agents.length > 20) errors.push('A swarm can have at most 20 agents.')
    const names = new Set<string>()
    const keyUsage = new Map<string, { agent: string; model: string }>()
    for (const agent of agents) {
      if (!agent.name?.trim()) errors.push('Every agent needs a name.')
      const name = agent.name?.trim().toLowerCase()
      if (name && names.has(name)) errors.push(`Duplicate agent name: ${agent.name}. Names must be unique.`)
      if (name) names.add(name)
      const model = modelCatalog.getModel(agent.modelId)
      if (!model) errors.push(`${agent.name}: model "${agent.modelId}" is not in the app's model list. Pick one from the list.`)
      else {
        const provider = modelCatalog.getProvider(model.providerId)
        if (provider && !provider.keyless && !agent.apiKey?.trim() && !(await this.vault.has(provider.id))) {
          errors.push(`${agent.name}: API key required for ${model.name}. Save it once in Settings → Models & API keys, or enter it for this agent.`)
        }
      }
      // Duplicate-key rule: same key on two different models → warn.
      if (agent.apiKey) {
        const existing = keyUsage.get(agent.apiKey)
        if (existing && existing.model !== agent.modelId) {
          warnings.push(
            `${agent.name} uses the same API key as ${existing.agent} (different model: ${existing.model}). Sharing one key across models multiplies rate-limit risk — both agents can stall when the provider throttles. Confirm to keep, or give ${agent.name} its own key.`,
          )
        } else if (!existing) {
          keyUsage.set(agent.apiKey, { agent: agent.name, model: agent.modelId })
        }
      }
    }
    return { ok: errors.length === 0, errors, warnings }
  }

  /* ------------------------- questions (ask_user) ------------------------- */

  answerQuestions(requestId: string, answers: QuestionAnswer[]): boolean {
    return this.approvals.respond(requestId, 'allow', answers)
  }

  /* ------------------------- telegraph ------------------------- */

  async telegraphStatus(): Promise<TelegraphStatus> {
    const settings = await loadSettings()
    const network = getNetwork(settings.telegraph.networkId)
    const enabled = settings.telegraphEnabled !== false
    if (!enabled) {
      return {
        enabled: false,
        walletAddress: undefined,
        walletFunded: false,
        usdcBalance: '0',
        networkLabel: network.label,
        isTestnet: network.isTestnet,
        nodeReachable: false,
        minerCount: 0,
        intentCount: 0,
        receiptsTotal: await this.ledger.count(),
        spentTodayUsd: 0,
        spentTotalUsd: 0,
      }
    }
    const key = await this.vault.get(HalisMobile.TELEGRAPH_WALLET_VAULT_ID)
    const address = key ? walletAddress(key) : undefined
    const [balance, ping] = await Promise.all([
      address && key ? usdcBalance(key, network) : Promise.resolve('0'),
      pingNode(network),
    ])
    let intentCount = 0
    if (ping.reachable) {
      try {
        intentCount = (await listIntents(network)).length
      } catch {
        intentCount = 0
      }
    }
    return {
      enabled: true,
      walletAddress: address,
      walletFunded: Number(balance) > 0,
      usdcBalance: balance,
      networkLabel: network.label,
      isTestnet: network.isTestnet,
      nodeReachable: ping.reachable,
      minerCount: ping.miners,
      intentCount,
      receiptsTotal: await this.ledger.count(),
      spentTodayUsd: await this.ledger.spentTodayUsd(),
      spentTotalUsd: await this.ledger.spentTotalUsd(),
    }
  }

  async telegraphAsk(query: string, sessionId?: string): Promise<TelegraphAskResult> {
    if (!(await this.telegraphEnabled())) throw new TelegraphDisabledError()
    const settings = await loadSettings()
    const network = getNetwork(settings.telegraph.networkId)
    const walletKey = (await this.vault.get(HalisMobile.TELEGRAPH_WALLET_VAULT_ID)) ?? ''
    const result = await askTelegraph({
      query,
      privateKey: walletKey,
      network,
      onQuote: async (quote) => {
        const budget = settings.telegraph.dailyBudgetUsd
        if (budget <= 0) {
          throw new TelegraphError('Daily Telegraph budget is $0 — paid asks are disabled. Raise the budget in Settings to spend.', 'validation')
        }
        const spentToday = await this.ledger.spentTodayUsd()
        if (spentToday + quote.amountUsd > budget) {
          throw new TelegraphError(
            `Daily Telegraph budget reached ($${spentToday.toFixed(2)} of $${budget.toFixed(2)}).`,
            'validation',
          )
        }
      },
    })
    if (result.receipt) {
      const receipt = await this.ledger.append({ ...result.receipt, signalHash: result.signalHash }, network, query)
      this.emit({ type: 'receipt', sessionId: sessionId ?? '', receipt })
      result.receipt = receipt
    }
    return result
  }

  telegraphNetwork(): TelegraphNetworkConfig {
    return getNetwork(currentSettingsSync().telegraph.networkId)
  }

  async createTelegraphWallet(): Promise<{ address: string }> {
    const wallet = createBurnerWallet()
    await this.vault.set(HalisMobile.TELEGRAPH_WALLET_VAULT_ID, wallet.privateKey)
    return { address: wallet.address }
  }

  async importTelegraphWallet(privateKey: string): Promise<{ address: string }> {
    const wallet = importWallet(privateKey)
    await this.vault.set(HalisMobile.TELEGRAPH_WALLET_VAULT_ID, wallet.privateKey)
    return { address: wallet.address }
  }

  async exportTelegraphWallet(): Promise<{ privateKey: string } | null> {
    const key = await this.vault.get(HalisMobile.TELEGRAPH_WALLET_VAULT_ID)
    return key ? { privateKey: key } : null
  }

  /* ------------------------- models & keys ------------------------- */

  modelCatalog(): CatalogSnapshot {
    return modelCatalog.get()
  }

  async modelKeyStatus(): Promise<Record<string, boolean>> {
    return this.vault.statusAll()
  }

  async modelSaveKey(providerId: string, key: string): Promise<{ ok: boolean }> {
    await this.vault.set(providerId, key)
    await this.refreshKeyCache()
    return { ok: true }
  }

  async modelRemoveKey(providerId: string): Promise<void> {
    await this.vault.remove(providerId)
    await this.refreshKeyCache()
  }

  async modelTestKey(modelId: string, keyOverride?: string): Promise<{ ok: boolean; detail: string }> {
    return this.dispatcher.testModel(modelId, keyOverride)
  }

  async modelValidateAgentKey(candidate: { apiKey: string; modelId: string; agentId: string; existingAgents: Array<{ id: string; name: string; modelId: string; apiKey?: string }> }): Promise<{ conflict: boolean; agentName?: string; message: string }> {
    const model = modelCatalog.getModel(candidate.modelId)
    if (!model) return { conflict: false, message: 'Model not found.' }
    const usage = await this.vault.findKeyUsage(candidate.apiKey)
    // Per-agent key reuse among the saved agents:
    for (const agent of candidate.existingAgents) {
      if (agent.id === candidate.agentId) continue
      if (agent.apiKey && agent.apiKey === candidate.apiKey && agent.modelId !== candidate.modelId) {
        return {
          conflict: true,
          agentName: agent.name,
          message: `${agent.name} uses this key on a different model (${agent.modelId}). Sharing one key across models multiplies rate-limit risk.`,
        }
      }
    }
    void usage
    return { conflict: false, message: 'Key looks fine.' }
  }

  /* ------------------------- reminders (user-facing) ------------------------- */

  async scheduleList(sessionId: string): Promise<ScheduleView[]> {
    return this.schedules.forSession(sessionId)
  }

  async scheduleDelete(id: string): Promise<{ ok: boolean; message: string }> {
    return this.schedules.remove(id)
  }

  /* ------------------------- task board (user-facing) ------------------------- */

  async taskBoardGet(): Promise<BoardTask[]> {
    return this.taskBoard.all()
  }

  async taskBoardCreate(title: string, description?: string): Promise<BoardTask> {
    return this.taskBoard.create(title, description, 'user', 'user', 'You')
  }

  async taskBoardUpdate(taskId: string, patch: Partial<BoardTask>): Promise<BoardTask> {
    return this.taskBoard.update(taskId, patch, 'user', 'You')
  }

  async taskBoardClaim(taskId: string, agentId: string, agentName: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.taskBoard.claim(taskId, agentId, agentName)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /* ------------------------- receipts ------------------------- */

  async telegraphReceipts(): Promise<TelegraphReceipt[]> {
    return this.ledger.all()
  }

  async telegraphVerifySignal(signalHash: string): Promise<{ found: boolean; detail: string }> {
    const settings = await loadSettings()
    const network = getNetwork(settings.telegraph.networkId)
    return verifySignal(network, signalHash)
  }

  async telegraphMiners() {
    const settings = await loadSettings()
    const network = getNetwork(settings.telegraph.networkId)
    try {
      return await listMiners(network)
    } catch {
      return []
    }
  }

  async telegraphIntents(): Promise<Array<{ id: string; label?: string }>> {
    const settings = await loadSettings()
    const network = getNetwork(settings.telegraph.networkId)
    try {
      return await listIntents(network)
    } catch {
      return []
    }
  }
}

/** Rebuild an LLM transcript from persisted chat messages (tool history + compaction summary included). */
function transcriptFromSession(messages: ChatMessage[], excludeId?: string, summary?: Session['summary']): LlmMessage[] {
  const out: LlmMessage[] = []
  const startIndex = summary ? Math.max(summary.coversMessages, 0) : 0
  if (summary) {
    out.push({ role: 'user', content: `## Conversation summary (auto-compacted)\n\n${summary.text}\n\n(Continue from here.)` })
    out.push({ role: 'assistant', content: 'Understood — I have the full context from the summary and will continue from there.' })
  }
  for (let i = startIndex; i < messages.length; i++) {
    const message = messages[i]!
    if (message.id === excludeId) continue
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content })
    } else if (message.role === 'assistant') {
      const toolRuns = (message.parts ?? []).filter((p): p is { type: 'tool'; run: ToolRun } => p.type === 'tool')
      const toolCalls = toolRuns.map((p) => ({ id: p.run.toolCallId, name: p.run.tool, arguments: JSON.stringify(p.run.args) }))
      if (message.content || toolCalls.length) {
        out.push({ role: 'assistant', content: message.content, toolCalls: toolCalls.length ? toolCalls : undefined })
        for (const p of toolRuns) {
          out.push({
            role: 'tool',
            toolCallId: p.run.toolCallId,
            toolName: p.run.tool,
            content: p.run.state === 'completed' ? String(p.run.result ?? '') : `ERROR: ${p.run.error ?? 'not executed'}`,
            isError: p.run.state !== 'completed',
          })
        }
      }
    }
  }
  return out
}

export { SWARM_ROLES }

export class TelegraphDisabledError extends Error {
  constructor() {
    super('Telegraph is disabled in Settings. Turn it back on to use the network.')
    this.name = 'TelegraphDisabledError'
  }
}
