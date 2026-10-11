/**
 * HalisApp — the main-process runtime: settings, vault, catalog, sandbox,
 * locks, task board, approvals, sessions, the single-agent runner and the
 * swarm orchestrator. IPC handlers are thin wrappers around this object.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type {
  AppSettings,
  ChatMessage,
  HarnessEvent,
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
import type { ToolContext } from './harness/tools'
import { SwarmOrchestrator } from './swarm/orchestrator'
import { buildSingleAgentPrompt } from './swarm/prompts'
import { extractMentions, resolveMentions } from './swarm/router'
import { SWARM_ROLES } from './swarm/roles'
import { readJson, writeJson } from './util/json'
import { newId } from './util/id'
import { SessionStore } from './sessions/store'
import { getNetwork } from './telegraph/config'
import { ReceiptLedger } from './telegraph/receipts'
import { usdcBalance, walletAddress } from './telegraph/wallet'
import { pingNode, listIntents, askTelegraph } from './telegraph/client'

export class HalisApp {
  readonly vault: KeyVault
  readonly dispatcher: LlmDispatcher
  readonly registry = createToolRegistry()
  readonly approvals = new ApprovalManager()
  readonly locks = new FileLockManager()
  readonly sessions = new SessionStore()
  readonly ledger: ReceiptLedger

  private sandbox: Sandbox | null = null
  private taskBoard: TaskBoard | null = null
  private running = new Map<string, AbortController>()
  private broadcaster: ((event: HarnessEvent) => void) | null = null
  private swarmConfig: SwarmConfig | null = null

  constructor() {
    this.vault = new KeyVault(paths.keysFile, safeStorageCodec())
    this.dispatcher = new LlmDispatcher(() => modelCatalog.get(), (providerId) => this.vault.get(providerId))
    this.ledger = new ReceiptLedger(paths.receiptsFile)

    this.approvals.setHooks({
      onRequest: (request) => this.emit({ type: 'approval-request', request }),
      onResolved: (requestId, approved) => this.emit({ type: 'approval-resolved', requestId, approved }),
      onRulesChanged: () => {},
    })
    this.locks.setHooks({ onChanged: (locks) => this.emit({ type: 'lock-changed', locks }) })

    modelCatalog.setUpdatedListener((catalog) => this.emit({ type: 'model-catalog-updated', catalog }))
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
      privateKey: settings.telegraph.privateKey,
      network,
      autoApproveUpTo: settings.telegraph.autoApproveUpTo,
      dailyBudgetUsd: settings.telegraph.dailyBudgetUsd,
      ledger: this.ledger,
      onReceipt: (receipt, messageId) => this.emit({ type: 'receipt', sessionId: '', messageId, receipt }),
    }
  }

  /* ------------------------- chat ------------------------- */

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId)
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

    try {
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
      this.approvals.rejectAll()
      this.locks.clear()
    }
  }

  private async runSingleAgent(session: Session, modelId: string, controller: AbortController): Promise<void> {
    const { sandbox, taskBoard } = this.ensureWorkspace()
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

    const history = transcriptFromSession(session.messages, assistantMessage.id)
    const systemPrompt = buildSingleAgentPrompt(sandbox.workspace, settings.language, taskBoard.renderForPrompt())
    const runner = new AgentRunner(this.dispatcher, this.registry)
    const toolContext: ToolContext = {
      sandbox,
      locks: this.locks,
      taskBoard,
      approvals: this.approvals,
      workspace: sandbox.workspace,
      sessionId: session.id,
      messageId: assistantMessage.id,
      agentId: 'halis',
      agentName: 'Halis',
      agentColor: '#7C6CFF',
      permissions: defaultSingleAgentPermissions(),
      alwaysRules: this.approvals.rulesFor('halis'),
      autoApproveAll: settings.autoApproveAll,
      telegraph: this.telegraphDeps(),
      emit: (event) => this.emit(event),
    }

    const result = await runner.runTurn(
      {
        sessionId: session.id,
        messageId: assistantMessage.id,
        modelId,
        systemPrompt,
        history,
        swarm: false,
        maxSteps: 32,
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
    this.sessions.save(session)
    this.emit({ type: 'turn-usage', sessionId: session.id, messageId: assistantMessage.id, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens })
    this.emit({ type: 'message-done', sessionId: session.id, messageId: assistantMessage.id, message: assistantMessage })
    if (result.error) this.emit({ type: 'message-error', sessionId: session.id, messageId: assistantMessage.id, error: result.error })
  }

  private async runSwarm(session: Session, controller: AbortController): Promise<void> {
    const config = this.getSwarmConfig()
    if (!config.agents.some((a) => a.enabled)) {
      throw new Error('The swarm has no enabled agents. Open Swarm Setup and enable at least one.')
    }
    const { sandbox, taskBoard } = this.ensureWorkspace()
    const settings = getSettings()
    session.agentNames = config.agents.filter((a) => a.enabled).map((a) => a.name)
    this.sessions.save(session)

    const orchestrator = new SwarmOrchestrator({
      dispatcher: this.dispatcher,
      registry: this.registry,
      approvals: this.approvals,
      locks: this.locks,
      taskBoard,
      sandbox,
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
        agents: (loaded.agents ?? []).slice(0, 20),
      }
    }
    return this.swarmConfig
  }

  saveSwarmConfig(config: SwarmConfig): { ok: boolean; error?: string; warnings: string[] } {
    const validation = this.validateSwarm(config)
    if (validation.errors.length) return { ok: false, error: validation.errors.join(' '), warnings: validation.warnings }
    this.swarmConfig = { ...config, agents: config.agents.slice(0, 20) }
    writeJson(paths.swarmFile, this.swarmConfig)
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
        if (!provider?.keyless && !agent.apiKey) {
          errors.push(`${agent.name}: API key required for ${model.name}.`)
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

  /* ------------------------- telegraph ------------------------- */

  async telegraphStatus() {
    const settings = getSettings()
    const network = getNetwork(settings.telegraph.networkId)
    const address = settings.telegraph.privateKey ? walletAddress(settings.telegraph.privateKey) : undefined
    const [balance, ping] = await Promise.all([
      address ? usdcBalance(settings.telegraph.privateKey!, network) : Promise.resolve('0'),
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
    const settings = getSettings()
    const network = getNetwork(settings.telegraph.networkId)
    const result = await askTelegraph({ query, privateKey: settings.telegraph.privateKey ?? '', network })
    if (result.receipt) {
      const receipt = this.ledger.append(result.receipt, network, query)
      this.emit({ type: 'receipt', sessionId: sessionId ?? '', receipt })
      result.receipt = receipt
    }
    return result
  }

  telegraphNetwork(): TelegraphNetworkConfig {
    return getNetwork(getSettings().telegraph.networkId)
  }
}

/** Rebuild an LLM transcript from persisted chat messages (tool history included). */
function transcriptFromSession(messages: ChatMessage[], excludeId?: string): LlmMessage[] {
  const out: LlmMessage[] = []
  for (const message of messages) {
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
