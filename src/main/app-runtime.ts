/**
 * HalisApp — the main-process runtime: settings, vault, catalog, sandbox,
 * locks, task board, approvals, sessions, background jobs, reminders, MCP,
 * todos, the single-agent runner (with auto-compaction and delegation) and
 * the swarm orchestrator. IPC handlers are thin wrappers around this object.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type {
  AlwaysAllowRule,
  AppSettings,
  ChatMessage,
  HarnessEvent,
  McpServerConfig,
  QuestionAnswer,
  QuestionPrompt,
  Session,
  SwarmConfig,
  TelegraphNetworkConfig,
  ToolRun,
} from '@shared/types'
import { getSettings, setSettings } from './config/app-settings'
import { paths } from './config/paths'
import { KeyVault } from './models/keyvault'
import { modelCatalog } from './models/catalog'
import { LlmDispatcher } from './models/llm/client'
import type { LlmMessage } from './models/llm/types'
import { AgentRunner } from './harness/loop'
import { ApprovalManager, defaultSingleAgentPermissions } from './harness/approvals'
import { FileLockManager } from './harness/file-locking'
import { TaskBoard } from './harness/task-board'
import { createSandbox, type Sandbox } from './harness/sandbox'
import { createToolRegistry } from './harness/tools/registry'
import { TodoStore, type ToolContext } from './harness/tools'
import { JobRegistry } from './harness/jobs'
import { ScheduleStore, type Schedule } from './harness/schedules'
import { McpManager, type McpToolInfo } from './harness/mcp'
import { discoverSkills } from './harness/skills'
import { ponytailSection } from './harness/ponytail'
import { planCompaction, olderToTranscript, summarizeRequest, looksLikeSummary } from './harness/compaction'
import { setToolOutputSpillDir } from './harness/util/truncate'
import { SwarmOrchestrator } from './swarm/orchestrator'
import { buildSingleAgentPrompt } from './swarm/prompts'
import { extractMentions, resolveMentions } from './swarm/router'
import { SWARM_ROLES, normalizeRoleId } from './swarm/roles'
import { readJson, writeJson } from './util/json'
import { newId } from './util/id'
import { raceWithAbort } from './harness/util/abort-race'
import { SessionStore } from './sessions/store'
import { getNetwork } from './telegraph/config'
import { ReceiptLedger } from './telegraph/receipts'
import { usdcBalance, walletAddress } from './telegraph/wallet'
import { pingNode, listIntents, askTelegraph, TelegraphError } from './telegraph/client'
import { telegraphTools } from './harness/tools/telegraph'

export class HalisApp {
  readonly vault: KeyVault
  readonly dispatcher: LlmDispatcher
  readonly registry = createToolRegistry()
  readonly approvals = new ApprovalManager()
  readonly locks = new FileLockManager()
  readonly sessions = new SessionStore()
  readonly ledger: ReceiptLedger
  readonly jobs = new JobRegistry()
  readonly schedules: ScheduleStore
  readonly mcp = new McpManager()
  private todoStores = new Map<string, TodoStore>()

  private sandbox: Sandbox | null = null
  private taskBoard: TaskBoard | null = null
  private running = new Map<string, AbortController>()
  private pendingReminders = new Map<string, Schedule[]>()
  /** Background-job completion notices waiting for the session's next turn. */
  private pendingJobNotices = new Map<string, string[]>()
  /**
   * In-memory session objects of turns currently running. A turn keeps
   * mutating its own copy and overwrites the session file on every save —
   * anything delivered mid-turn (job notes) must go into THIS object, not
   * into a fresh parse, or the next save erases it.
   */
  private liveSessions = new Map<string, Session>()
  private broadcaster: ((event: HarnessEvent) => void) | null = null
  private swarmConfig: SwarmConfig | null = null

  constructor() {
    this.vault = new KeyVault(paths.keysFile, safeStorageCodec())
    this.dispatcher = new LlmDispatcher(() => modelCatalog.get(), (providerId) => this.vault.get(providerId))
    this.ledger = new ReceiptLedger(paths.receiptsFile)
    setToolOutputSpillDir(paths.toolOutputDir)
    this.schedules = new ScheduleStore(paths.userData)
    this.migrateTelegraphKey()

    this.approvals.setRules(readJson<AlwaysAllowRule[]>(paths.approvalRulesFile, []))
    this.approvals.setHooks({
      onRequest: (request) => this.emit({ type: 'approval-request', request }),
      onResolved: (requestId, approved) => this.emit({ type: 'approval-resolved', requestId, approved }),
      // "Always allow" rules survive restarts — they are part of the user's
      // trust decisions, not transient turn state.
      onRulesChanged: (rules) => writeJson(paths.approvalRulesFile, rules),
    })
    this.locks.setHooks({ onChanged: (locks) => this.emit({ type: 'lock-changed', locks }) })
    modelCatalog.setUpdatedListener((catalog) => this.emit({ type: 'model-catalog-updated', catalog }))

    // Background jobs: completion notices ride into the owning session's
    // next turn as a system note (no busy-polling).
    this.jobs.onSettled((jobId) => {
      const notice = this.jobs.takeNotice(jobId)
      if (!notice) return
      const job = this.jobs.get(jobId)
      if (job?.sessionId) this.deliverSystemNote(job.sessionId, notice)
    })

    // Reminders fire back into their session as a prompt turn.
    this.schedules.setHooks({
      onFire: (schedule) => this.fireReminder(schedule),
      onChanged: () => {},
    })
    this.schedules.ensureTimer()

    // Settled background jobs (16 KB output rings + kill closures) must not
    // accumulate for the whole process lifetime — sweep old ones hourly.
    const jobSweeper = setInterval(() => this.jobs.sweep(), 60 * 60 * 1000)
    if (typeof jobSweeper.unref === 'function') jobSweeper.unref()

    // MCP tools register into the shared registry.
    this.mcp.setHooks({
      onToolsChanged: (tools) => this.syncMcpTools(tools),
    })
  }

  /** Called once the Electron app is ready. */
  async startup(): Promise<void> {
    this.applyTelegraphEnabled()
    await this.resyncMcp()
  }

  /* ------------------------- Telegraph master switch ------------------------- */

  /** Vault id holding the Telegraph burner wallet private key. */
  static readonly TELEGRAPH_WALLET_VAULT_ID = 'telegraph-wallet'

  /**
   * One-time migration: the wallet key used to live in plaintext
   * settings.json — move it into the OS-keychain-encrypted vault and scrub
   * the plaintext copy. Idempotent: a migrated install has no key left in
   * settings.
   */
  private migrateTelegraphKey(): void {
    try {
      const settings = getSettings()
      const plain = settings.telegraph.privateKey?.trim()
      if (plain) {
        this.vault.set(HalisApp.TELEGRAPH_WALLET_VAULT_ID, plain)
        setSettings({ telegraph: { ...settings.telegraph, privateKey: undefined } })
      }
    } catch (err) {
      console.warn('[halis] telegraph key migration failed:', err)
    }
  }

  /** The wallet key now lives (encrypted) in the vault, never in settings. */
  walletKey(): string | undefined {
    return this.vault.get(HalisApp.TELEGRAPH_WALLET_VAULT_ID)
  }

  walletKeySet(privateKey: string): void {
    this.vault.set(HalisApp.TELEGRAPH_WALLET_VAULT_ID, privateKey)
  }

  /** Register or unregister every telegraph_* tool based on the Settings switch. */
  applyTelegraphEnabled(): void {
    const enabled = getSettings().telegraphEnabled !== false
    const hasTelegraph = this.registry.get('telegraph_ask') !== undefined
    if (enabled && !hasTelegraph) {
      for (const tool of telegraphTools) this.registry.register(tool)
    } else if (!enabled && hasTelegraph) {
      this.registry.unregisterNamespace('telegraph_')
    }
  }

  telegraphEnabled(): boolean {
    return getSettings().telegraphEnabled !== false
  }

  /* ------------------------- MCP ------------------------- */

  private syncMcpTools(tools: McpToolInfo[]): void {
    this.registry.unregisterNamespace('mcp_')
    for (const tool of tools) {
      this.registry.register({
        name: tool.qualifiedName,
        description: `[MCP · ${tool.server}] ${tool.description}`,
        parameters: tool.parameters as { type: 'object'; properties: Record<string, unknown>; required?: string[] },
        kind: 'other',
        readOnly: tool.readOnly,
        execute: async (args) => {
          const result = await this.mcp.callTool(tool.qualifiedName, args)
          if ('error' in result) throw new Error(result.error)
          return { output: result.text, data: result.structured }
        },
      })
    }
  }

  async resyncMcp(): Promise<{ ok: boolean; error?: string }> {
    try {
      const servers = getSettings().mcpServers.filter((s) => s.enabled)
      const statuses = await this.mcp.syncConfigs(servers)
      this.emit({ type: 'mcp-changed', servers: statuses })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async setMcpServers(configs: McpServerConfig[]): Promise<{ ok: boolean; error?: string }> {
    setSettings({ mcpServers: configs })
    return this.resyncMcp()
  }

  mcpStatuses() {
    return this.mcp.statuses()
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

  settings(): AppSettings {
    return getSettings()
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next = setSettings(patch)
    if (patch.workspace !== undefined) this.refreshWorkspace()
    if (patch.telegraphEnabled !== undefined) this.applyTelegraphEnabled()
    return next
  }

  effectiveWorkspace(): string {
    const ws = getSettings().workspace
    if (ws) return ws
    const fallback = join(app.getPath('home'), 'HalisWorkspace')
    mkdirSync(fallback, { recursive: true })
    return fallback
  }

  private refreshWorkspace(): void {
    this.sandbox = null
    this.taskBoard = null
    this.locks.clear()
    try {
      const ws = this.effectiveWorkspace()
      this.sandbox = createSandbox(ws)
      this.taskBoard = new TaskBoard(paths.taskBoardFile(ws), this.locks)
      this.taskBoard.setHooks({ onChanged: (tasks) => this.emit({ type: 'task-board-changed', tasks }) })
      // Spill truncated tool outputs INSIDE the workspace: the marker tells
      // the model to read_file the path, and read_file is jailed to the
      // workspace — a userData path would be permanently unreadable.
      setToolOutputSpillDir(join(ws, '.halis', 'tool-outputs'))
    } catch (err) {
      console.warn('[halis] workspace init failed:', err)
    }
  }

  ensureWorkspace(): { sandbox: Sandbox; taskBoard: TaskBoard } {
    if (!this.sandbox || !this.taskBoard) this.refreshWorkspace()
    if (!this.sandbox || !this.taskBoard) throw new Error('Workspace is not accessible. Pick a valid folder in Settings.')
    return { sandbox: this.sandbox, taskBoard: this.taskBoard }
  }

  telegraphDeps(): ToolContext['telegraph'] {
    const settings = getSettings()
    const network = getNetwork(settings.telegraph.networkId)
    return {
      enabled: settings.telegraphEnabled !== false,
      privateKey: this.walletKey(),
      network,
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
    this.sessions.save(session)
  }

  /* ------------------------- skills ------------------------- */

  private skillsSummary(): string | undefined {
    try {
      const skills = discoverSkills(this.effectiveWorkspace())
      if (!skills.length) return undefined
      return skills.map((s) => `- ${s.id}${s.description ? `: ${s.description}` : ''}`).join('\n')
    } catch {
      return undefined
    }
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
      const session = this.sessions.get(schedule.sessionId)
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
      this.sessions.save(session)
      this.emit({ type: 'message-start', sessionId: session.id, message: reminderMessage })

      if (session.mode === 'agent') {
        await this.runSingleAgent(session, session.modelId ?? getSettings().defaultModelId, controller)
      } else {
        await this.runSwarm(session, controller)
      }
    } finally {
      this.running.delete(schedule.sessionId)
      this.liveSessions.delete(schedule.sessionId)
      this.approvals.rejectAllForSession(schedule.sessionId)
      if (![...this.running.keys()].some((id) => id.split(':')[0] !== schedule.sessionId)) this.locks.clear()
    }
    // Fire reminders that queued while THIS reminder turn was running —
    // send() only drains the queue for user-initiated turns, so without
    // this a recurring reminder firing mid-turn would be lost until the
    // user happened to message the session again.
    const queued = this.pendingReminders.get(schedule.sessionId)
    if (queued?.length) {
      this.pendingReminders.delete(schedule.sessionId)
      for (const next of queued) {
        await this.runReminderTurn(next)
      }
    }
  }

  /**
   * Queue a background-job completion notice for the session's next turn.
   * The notice is delivered as a visible system message AND queued for the
   * agent's transcript, so the model actually learns the job finished (the
   * previous implementation computed the notice and threw it away).
   */
  private deliverSystemNote(sessionId: string, note: string): void {
    const queue = this.pendingJobNotices.get(sessionId) ?? []
    queue.push(note)
    this.pendingJobNotices.set(sessionId, queue)
    // Surface the note immediately as a system message so the user sees why
    // the next reply suddenly talks about a background job. Route into the
    // live turn's session object when one is running — the turn's own saves
    // would otherwise overwrite this note away.
    const session = this.liveSessions.get(sessionId) ?? this.sessions.get(sessionId)
    if (!session) return
    const noteMessage: ChatMessage = {
      id: newId('msg'),
      sessionId,
      mode: session.mode,
      from: 'system',
      fromName: 'Halis',
      to: [],
      mentions: [],
      role: 'system',
      content: note,
      createdAt: Date.now(),
    }
    session.messages.push(noteMessage)
    this.sessions.save(session)
    this.emit({ type: 'message-start', sessionId, message: noteMessage })
    this.emit({ type: 'message-done', sessionId, messageId: noteMessage.id, message: noteMessage })
  }

  /**
   * Fold queued job notices into a user-role message so they reach the LLM
   * transcript (system messages are skipped when rebuilding the transcript).
   * Called at the start of a turn, before the new user message is added.
   */
  private drainJobNotices(session: Session): void {
    const notices = this.pendingJobNotices.get(session.id)
    if (!notices?.length) return
    this.pendingJobNotices.delete(session.id)
    const noticeMessage: ChatMessage = {
      id: newId('msg'),
      sessionId: session.id,
      mode: session.mode,
      from: 'system',
      fromName: '⏙ Background job',
      to: [],
      mentions: [],
      role: 'user',
      content: notices.map((n) => `[Background job notice] ${n}`).join('\n\n'),
      createdAt: Date.now(),
    }
    session.messages.push(noticeMessage)
    this.sessions.save(session)
    this.emit({ type: 'message-start', sessionId: session.id, message: noticeMessage })
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

  /** Abort every running turn — used on app quit. */
  stopAll(): void {
    for (const controller of this.running.values()) controller.abort()
    this.running.clear()
  }

  async send(params: { sessionId: string; text: string; modelId?: string }): Promise<{ ok: boolean; error?: string }> {
    const { sessionId, text } = params
    if (this.running.has(sessionId)) return { ok: false, error: 'A turn is already running in this session. Stop it first.' }
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, error: 'Session not found.' }
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, error: 'Empty message.' }

    const controller = new AbortController()
    this.running.set(sessionId, controller)
    this.liveSessions.set(sessionId, session)

    try {
      // Deliver background-job notices queued while no turn was running —
      // before the new user message, so the transcript order stays honest.
      this.drainJobNotices(session)
      // Parse @mentions for swarm routing (explicit addressing, no broadcast).
      let mentions: string[] = []
      let to: string[] = []
      if (session.mode === 'swarm') {
        const config = this.getSwarmConfig()
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
      this.sessions.save(session)
      this.emit({ type: 'message-start', sessionId, message: userMessage })

      if (session.mode === 'agent') {
        await this.runSingleAgent(session, params.modelId ?? session.modelId ?? getSettings().defaultModelId, controller)
      } else {
        await this.runSwarm(session, controller)
      }
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Surface turn-level failures as a persisted system message — an event
      // with no messageId would never render anywhere.
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
      this.sessions.save(session)
      this.emit({ type: 'message-start', sessionId, message: errorMessage })
      return { ok: false, error: message }
    } finally {
      this.running.delete(sessionId)
      this.liveSessions.delete(sessionId)
      // Scope the cleanup to THIS session: another session's turn may be
      // running concurrently with its own approval cards and file locks.
      this.approvals.rejectAllForSession(sessionId)
      if (![...this.running.keys()].some((id) => id.split(':')[0] !== sessionId)) this.locks.clear()
      // Deliver reminders that fired while the turn was running — in the
      // finally, so a failed turn (e.g. swarm validation throw) does not
      // strand queued reminders until some later successful turn.
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
  private baseToolContext(input: {
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
  }): ToolContext {
    const { sandbox, taskBoard } = this.ensureWorkspace()
    const session = input.session
    return {
      sandbox,
      locks: this.locks,
      taskBoard,
      approvals: this.approvals,
      workspace: sandbox.workspace,
      sessionId: session.id,
      messageId: input.messageId,
      agentId: input.agentId,
      agentName: input.agentName,
      agentColor: input.agentColor,
      permissions: input.permissions,
      alwaysRules: this.approvals.rulesFor(input.agentId),
      autoApproveAll: getSettings().autoApproveAll,
      telegraph: this.telegraphDeps(),
      emit: input.emit,
      sendMessage: input.sendMessage,
      jobs: this.jobs,
      schedules: this.schedules,
      mcp: this.mcp,
      todos: this.todoStoreFor(session, input.emit),
      settings: { tavilyApiKey: getSettings().tavilyApiKey || undefined },
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
        // The wait races the tool's timeout AND the turn signal; when the
        // wait loses, the card is dismissed so a late user answer is not
        // silently discarded and the card cannot linger clickable.
        const timeoutMs = Math.max(1_000, opts?.timeoutMs ?? 10 * 60 * 1000)
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeoutPromise = new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs)
          if (typeof timer.unref === 'function') timer.unref()
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
              if (input.signal?.aborted) subController.abort()
              else input.signal?.addEventListener('abort', () => subController.abort(), { once: true })
              this.running.set(`${session.id}:sub`, subController)
              try {
                const subSession: Session = { ...session, messages: [] }
                const subMessageId = newId('msg')
                const subContext = this.baseToolContext({
                  session: subSession,
                  messageId: subMessageId,
                  agentId: `${input.agentId}:sub`,
                  agentName: `${input.agentName} (sub)`,
                  agentColor: input.agentColor,
                  permissions: { ...defaultSingleAgentPermissions(), autoApproveEdits: true },
                  emit: input.emit,
                  signal: subController.signal,
                  depth: (input.depth ?? 0) + 1,
                })
                subContext.todos = new TodoStore(`${session.id}:sub`, input.emit)
                delete (subContext as { askUser?: unknown }).askUser
                const systemPrompt = `${buildSingleAgentPrompt(sandbox.workspace, getSettings().language, taskBoard?.renderForPrompt(), this.skillsSummary(), getSettings().telegraphEnabled !== false, getSettings().ponytailEnabled ? ponytailSection() : undefined)}\n\nYou are a SUB-AGENT spawned for one focused task: "${task.description}". Work autonomously and end with a complete final report — your reply is returned verbatim to the parent agent.`
                const history: LlmMessage[] = [{ role: 'user', content: task.prompt }]
                const runner = new AgentRunner(this.dispatcher, this.registry)
                const result = await runner.runTurn(
                  {
                    sessionId: `${session.id}:sub`,
                    messageId: subMessageId,
                    modelId: getSettings().defaultModelId,
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
                // Sub turns run under `${session.id}:sub` — cleanup scoped to
                // the plain id never touches their pending approval cards.
                // Without this, an aborted delegation leaves ghost cards that
                // survive the whole turn (and write junk always-rules if
                // clicked).
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
      // Keep prior summaries in the chain: each new summary covers the older
      // messages PLUS whatever the previous summary already folded.
      const transcript =
        (session.summary?.text ? `Previous summary of the even older conversation:\n\n${session.summary.text}\n\n` : '') + olderToTranscript(plan.older)
      const result = await this.dispatcher.complete(
        modelId,
        {
          model: modelId,
          messages: summarizeRequest(transcript),
          maxTokens: 2048,
          // Stop must cancel the compaction call too — an unabortable request
          // keeps the session "running" (and blocks app quit) for as long as
          // the provider feels like taking.
          signal: controller.signal,
        },
        undefined,
      )
      const summary = result.text.trim()
      if (!summary || !looksLikeSummary(summary)) return
      // coversMessages is measured against the CURRENT messages array: after
      // the prune below, every message BEFORE plan.recent is folded into the
      // summary, so the transcript rebuild must keep all remaining messages
      // (coversMessages stays 0 — the summary prefix + full message list).
      session.summary = { text: summary, coversMessages: 0, createdAt: Date.now() }
      session.messages = [...plan.recent]
      this.sessions.save(session)
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
      this.sessions.save(session)
      // The whole transcript changed (older messages pruned, note on top) —
      // a plain message-start would APPEND the note at the live view's end
      // while the pruned messages stay visible until the turn's final
      // refetch. A full reload event keeps the live view canonical.
      this.emit({ type: 'session-reloaded', session })
    } catch (err) {
      console.warn('[halis] compaction failed (continuing without):', err)
    }
  }

  /* ------------------------- single agent ------------------------- */

  private async runSingleAgent(session: Session, modelId: string, controller: AbortController): Promise<void> {
    await this.compactIfNeeded(session, modelId, controller)
    const { taskBoard } = this.ensureWorkspace()
    const settings = getSettings()
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
    this.sessions.save(session)
    this.emit({ type: 'message-start', sessionId: session.id, message: assistantMessage })

    const history = transcriptFromSession(session.messages, assistantMessage.id, session.summary)
    const systemPrompt = buildSingleAgentPrompt(this.effectiveWorkspace(), settings.language, taskBoard.renderForPrompt(), this.skillsSummary(), settings.telegraphEnabled !== false, settings.ponytailEnabled ? ponytailSection() : undefined)
    const runner = new AgentRunner(this.dispatcher, this.registry)
    const toolContext = this.baseToolContext({
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
    this.sessions.save(session)
    this.emit({ type: 'turn-usage', sessionId: session.id, messageId: assistantMessage.id, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens })
    this.emit({ type: 'message-done', sessionId: session.id, messageId: assistantMessage.id, message: assistantMessage })
    if (result.error) this.emit({ type: 'message-error', sessionId: session.id, messageId: assistantMessage.id, error: result.error })
  }

  /* ------------------------- swarm ------------------------- */

  private async runSwarm(session: Session, controller: AbortController): Promise<void> {
    const config = this.getSwarmConfig()
    if (!config.agents.some((a) => a.enabled)) {
      throw new Error('The swarm has no enabled agents. Open Swarm Setup and enable at least one.')
    }
    const { sandbox, taskBoard } = this.ensureWorkspace()
    session.agentNames = config.agents.filter((a) => a.enabled).map((a) => a.name)
    this.sessions.save(session)

    const orchestrator = new SwarmOrchestrator({
      dispatcher: this.dispatcher,
      registry: this.registry,
      approvals: this.approvals,
      locks: this.locks,
      taskBoard,
      sandbox,
      jobs: this.jobs,
      schedules: this.schedules,
      mcp: this.mcp,
      todoFor: (sessionId, emit) => {
        const live = this.sessions.get(sessionId) ?? session
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
        // Stop must settle swarm question cards too — an unresolved wait
        // parks the whole turn and the session stays "running" forever.
        // The ask_user timeout gets the same treatment, and a lost wait
        // dismisses its card.
        const timeoutMs = Math.max(1_000, opts?.timeoutMs ?? 10 * 60 * 1000)
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeoutPromise = new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs)
          if (typeof timer.unref === 'function') timer.unref()
        })
        try {
          return await raceWithAbort(Promise.race([wait, timeoutPromise]), controller.signal)
        } finally {
          if (timer) clearTimeout(timer)
          this.approvals.dismissQuestions(id)
        }
      },
      getSettings: () => getSettings(),
      telegraph: this.telegraphDeps(),
      emit: (event) => this.emit(event),
      persistSession: (s) => this.sessions.save(s),
    })

    const objective = session.title || 'Assist the user with their request.'
    await orchestrator.runTurn({ session, config, objective, signal: controller.signal })
  }

  /* ------------------------- swarm config ------------------------- */

  getSwarmConfig(): SwarmConfig {
    if (!this.swarmConfig) {
      const loaded = readJson<SwarmConfig>(paths.swarmFile, { agents: [], maxRounds: 4, plannerCoordination: true })
      this.swarmConfig = {
        maxRounds: loaded.maxRounds ?? 4,
        plannerCoordination: loaded.plannerCoordination ?? true,
        agents: (loaded.agents ?? []).slice(0, 20).map((a) => ({
          ...a,
          // Older builds saved model ids wrapped in literal double quotes
          // (a generator bug). Clean them so catalog lookups match again.
          modelId: a.modelId?.replace(/"/g, '').trim() ?? a.modelId,
          apiKey: a.apiKey?.trim() || undefined,
          // Older builds also saved the retired role ids (planner, coder,
          // reviewer, …) — migrate them so role lookups keep working.
          roleId: normalizeRoleId(a.roleId),
        })),
      }
    }
    return this.swarmConfig
  }

  saveSwarmConfig(config: SwarmConfig): { ok: boolean; error?: string; warnings: string[] } {
    const validation = this.validateSwarm(config)
    if (validation.errors.length) return { ok: false, error: validation.errors.join(' '), warnings: validation.warnings }
    this.swarmConfig = { ...config, agents: config.agents.slice(0, 20) }
    // 0600: the config carries per-agent provider keys in plaintext —
    // default 0644 would expose them to every local user.
    writeJson(paths.swarmFile, this.swarmConfig, { mode: 0o600 })
    return { ok: true, warnings: validation.warnings }
  }

  validateSwarm(config: SwarmConfig): { errors: string[]; warnings: string[] } {
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
        // A provider key saved in the vault satisfies the requirement —
        // a per-agent key is only one of the two valid sources.
        if (provider && !provider.keyless && !agent.apiKey?.trim() && !this.vault.has(provider.id)) {
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
    return { errors, warnings }
  }

  /* ------------------------- questions (ask_user) ------------------------- */

  answerQuestions(requestId: string, answers: QuestionAnswer[]): boolean {
    return this.approvals.respond(requestId, 'allow', answers)
  }

  /* ------------------------- telegraph ------------------------- */

  async telegraphStatus() {
    const settings = getSettings()
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
        receiptsTotal: this.ledger.count(),
        spentTodayUsd: 0,
        spentTotalUsd: 0,
      }
    }
    const key = this.walletKey()
    const address = key ? walletAddress(key) : undefined
    const [balance, ping] = await Promise.all([
      address ? usdcBalance(key!, network) : Promise.resolve('0'),
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
      receiptsTotal: this.ledger.count(),
      spentTodayUsd: this.ledger.spentTodayUsd(),
      spentTotalUsd: this.ledger.spentTotalUsd(),
    }
  }

  async telegraphAsk(query: string, sessionId?: string) {
    if (!this.telegraphEnabled()) throw new TelegraphDisabledError()
    const settings = getSettings()
    const network = getNetwork(settings.telegraph.networkId)
    const result = await askTelegraph({
      query,
      privateKey: this.walletKey() ?? '',
      network,
      // The UI button must respect the same daily ceiling as the agent tool —
      // without this, a mispriced miner gets paid silently.
      onQuote: (quote) => {
        const budget = settings.telegraph.dailyBudgetUsd
        if (budget <= 0) {
          throw new TelegraphError('Daily Telegraph budget is $0 — paid asks are disabled. Raise the budget in Settings to spend.', 'validation')
        }
        const spentToday = this.ledger.spentTodayUsd()
        if (spentToday + quote.amountUsd > budget) {
          throw new TelegraphError(
            `Daily Telegraph budget reached ($${spentToday.toFixed(2)} of $${budget.toFixed(2)}).`,
            'validation',
          )
        }
      },
    })
    if (result.receipt) {
      const receipt = this.ledger.append({ ...result.receipt, signalHash: result.signalHash }, network, query)
      this.emit({ type: 'receipt', sessionId: sessionId ?? '', receipt })
      result.receipt = receipt
    }
    return result
  }

  telegraphNetwork(): TelegraphNetworkConfig {
    return getNetwork(getSettings().telegraph.networkId)
  }
}

/** Rebuild an LLM transcript from persisted chat messages (tool history + compaction summary included). */
function transcriptFromSession(messages: ChatMessage[], excludeId?: string, summary?: Session['summary']): LlmMessage[] {
  const out: LlmMessage[] = []
  // Compacted prefix: the auto-summary stands in for the folded messages.
  // coversMessages counts leading messages of the CURRENT array that the
  // summary already covers (0 right after a compaction — the summary
  // replaces everything before plan.recent).
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

/** Electron safeStorage codec (keeps the vault module testable without Electron). */
function safeStorageCodec(): import('./models/keyvault').SafeCodec | undefined {
  try {
    return {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain: string) => safeStorage.encryptString(plain),
      decrypt: (encrypted: Buffer) => safeStorage.decryptString(encrypted),
    }
  } catch {
    return undefined
  }
}

export { SWARM_ROLES }

export class TelegraphDisabledError extends Error {
  constructor() {
    super('Telegraph is disabled in Settings. Turn it back on to use the network.')
    this.name = 'TelegraphDisabledError'
  }
}
