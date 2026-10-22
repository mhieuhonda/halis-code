/**
 * Shared domain types — the contract between the Electron main process
 * (harness, swarm, telegraph) and the renderer.
 */

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

/** How to speak to a provider's API. */
export type ApiStyle = 'openai' | 'anthropic'

export interface ProviderInfo {
  id: string
  name: string
  apiStyle: ApiStyle
  baseURL: string
  /** Environment-style key name shown in the UI (e.g. ANTHROPIC_API_KEY). */
  envKey?: string
  /** true when the gateway serves models without any key. */
  keyless?: boolean
  /** true when the key is free to obtain. */
  freeKey?: boolean
  /** Optional provider-level note shown in the model picker. */
  note?: string
  docs?: string
}

export interface ModelInfo {
  /** Fully-qualified id: "<providerId>/<modelId>" */
  id: string
  /** Model id sent to the provider API. */
  apiId: string
  name: string
  providerId: string
  description?: string
  free: boolean
  toolCall: boolean
  contextWindow?: number
  maxOutput?: number
  reasoning?: boolean
  /** USD per million tokens. */
  costPerMTok?: { input: number; output: number }
  tags?: string[]
  deprecated?: boolean
}

export interface CatalogSnapshot {
  providers: ProviderInfo[]
  models: ModelInfo[]
  updatedAt: number
  source: 'bundled' | 'models.dev' | 'merged'
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ToolRun {
  toolCallId: string
  tool: string
  /** Pretty summary of arguments for the UI. */
  args: Record<string, unknown>
  state: 'pending' | 'running' | 'awaiting-approval' | 'completed' | 'error' | 'rejected'
  result?: unknown
  error?: string
  approval?: { approvedBy: 'user' | 'auto' | 'always'; at: number }
  startedAt: number
  endedAt?: number
}

export interface ReceiptRef {
  receiptHash: string
  txHash?: string
  miner?: string
  intent?: string
  amountUsd: number
  explorerUrl?: string
}

export interface ChatMessage {
  id: string
  sessionId: string
  mode: ChatMode
  /** 'user' or agent id. */
  from: string
  fromName: string
  /** Explicit recipients. Agent messages always carry one or more. */
  to: string[]
  /** @mentions parsed out of the content. */
  mentions: string[]
  role: ChatRole
  content: string
  reasoning?: string
  parts?: MessagePart[]
  model?: string
  agentRole?: string
  agentColor?: string
  agentAvatar?: string
  createdAt: number
  streaming?: boolean
  error?: string
  /** Token usage for this turn's final step (honest numbers or nothing). */
  usage?: { inputTokens: number; outputTokens: number }
}

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool'; run: ToolRun }
  | { type: 'receipt'; receipt: ReceiptRef }
  | { type: 'image'; dataUri: string; mime: string; path: string }

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export type ChatMode = 'agent' | 'swarm'

export interface SessionMeta {
  id: string
  title: string
  mode: ChatMode
  createdAt: number
  updatedAt: number
  messageCount: number
  /** Agent mode: the model used. */
  modelId?: string
  /** Swarm mode: agent names involved. */
  agentNames?: string[]
  /** Live todo checklist for this session (survives restarts). */
  todos?: TodoItem[]
  /** Auto-compaction summary + the message count it covers. */
  summary?: { text: string; coversMessages: number; createdAt: number }
}

export interface Session extends SessionMeta {
  messages: ChatMessage[]
}

/* ------------------------------------------------------------------ */
/* Swarm                                                               */
/* ------------------------------------------------------------------ */

export interface AgentPermissions {
  /** Read-only agent: all mutating tools are denied outright. */
  readOnly: boolean
  /** Auto-approve file edits (write/edit) for this agent. */
  autoApproveEdits: boolean
  /** Allow shell commands (still gated by approval unless autoApproveShell). */
  canRunShell: boolean
  autoApproveShell: boolean
  /** Allow paid Telegraph calls. */
  canUseTelegraph: boolean
  /** Auto-approve Telegraph spends at or below this USD amount. 0 = always ask. */
  usdcAutoApproveUpTo: number
}

export interface AgentConfig {
  id: string
  name: string
  avatar: string
  /** User-uploaded avatar (data URL). Empty = no picture; the UI falls back
   *  to the agent's initial. Preset avatars are never offered. */
  avatarImage?: string
  color: string
  roleId: string
  modelId: string
  /** Key entered for this agent's model (rule: re-entered when model changes). */
  apiKey?: string
  /** Marks that the user acknowledged the duplicate-key warning. */
  duplicateKeyAck?: boolean
  permissions: AgentPermissions
  /** Auto-generated from role; user-editable afterwards. */
  systemPrompt?: string
  enabled: boolean
}

export interface SwarmConfig {
  agents: AgentConfig[]
  maxRounds: number
  /** Whether the planner agent coordinates when the user does not @mention. */
  plannerCoordination: boolean
}

export type AgentRole = {
  id: string
  name: string
  nameVi: string
  emoji: string
  /** Role priority for arbitration (lower = higher priority). */
  priority: number
  defaultPermissions: Partial<AgentPermissions>
  prompt: string
  promptVi: string
}

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

export type ApprovalKind = 'file-write' | 'shell' | 'usdc-spend' | 'other' | 'question'

export interface ApprovalRequest {
  id: string
  sessionId: string
  agentId: string
  agentName: string
  agentColor?: string
  kind: ApprovalKind
  title: string
  /** Human-readable description of the exact action. */
  detail: string
  risk: 'low' | 'medium' | 'high'
  amountUsd?: number
  tool: string
  createdAt: number
  /** ask_user tool: the structured questions waiting for answers. */
  questions?: QuestionPrompt[]
}

export interface AlwaysAllowRule {
  agentId: string
  kind: ApprovalKind
  tool?: string
  maxAmountUsd?: number
  createdAt: number
}

/* ------------------------------------------------------------------ */
/* Todos (agent-side checklist)                                        */
/* ------------------------------------------------------------------ */

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  content: string
  status: TodoStatus
}

export interface TodoState {
  todos: TodoItem[]
  updatedAt: number
}

/* ------------------------------------------------------------------ */
/* Questions (ask_user tool — structured clarification cards)          */
/* ------------------------------------------------------------------ */

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionPrompt {
  /** Stable id within the call. */
  id: string
  question: string
  /** Short chip label, ≤30 chars. */
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

export interface QuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

/* ------------------------------------------------------------------ */
/* MCP                                                                 */
/* ------------------------------------------------------------------ */

export interface McpServerConfig {
  name: string
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  timeoutMs?: number
  enabled: boolean
}

export interface McpServerStatus {
  name: string
  enabled: boolean
  connected: boolean
  error?: string
  toolCount: number
}

/* ------------------------------------------------------------------ */
/* Reminders (schedule subsystem)                                      */
/* ------------------------------------------------------------------ */

export type ScheduleSelectorView =
  | { kind: 'after_seconds'; seconds: number }
  | { kind: 'at'; iso: string }
  | { kind: 'every_seconds'; seconds: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; weekdays: number[] }
  | { kind: 'cron'; expression: string }

export interface ScheduleView {
  id: string
  sessionId: string
  title: string
  prompt: string
  selector: ScheduleSelectorView
  createdBy: string
  createdAt: number
  nextFireAt: number
  lastFiredAt?: number
  fireCount: number
}

/* ------------------------------------------------------------------ */
/* Background jobs                                                     */
/* ------------------------------------------------------------------ */

export interface JobView {
  id: string
  kind: string
  label: string
  ownerAgentId: string
  status: 'running' | 'completed' | 'killed' | 'failed'
  exitCode: number | null
  startedAt: number
  finishedAt?: number
  outputBytes: number
  truncated: boolean
}

/* ------------------------------------------------------------------ */
/* Task board                                                          */
/* ------------------------------------------------------------------ */

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'

export interface BoardTask {
  id: string
  title: string
  description?: string
  status: TaskStatus
  assignee?: string
  assigneeName?: string
  createdBy: string
  createdAt: number
  updatedAt: number
  blockedReason?: string
}

/* ------------------------------------------------------------------ */
/* Telegraph                                                           */
/* ------------------------------------------------------------------ */

export interface TelegraphNetworkConfig {
  label: string
  caip2: string
  chainId: number
  rpcUrl: string
  usdcAddress: string
  explorerTxUrl: string
  nodeUrl: string
  facilitatorUrl: string
  isTestnet: boolean
}

/**
 * Network parameters live here (shared) so the renderer can display them.
 * Hard design line: chain ID, token address, node URL and price source are
 * configuration values — flipping to mainnet is a settings change.
 */
export const TELEGRAPH_NETWORKS: Record<string, TelegraphNetworkConfig> = {
  'base-sepolia': {
    label: 'Base Sepolia (testnet)',
    caip2: 'eip155:84532',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorerTxUrl: 'https://sepolia.basescan.org/tx/',
    nodeUrl: 'https://devnode.telegraphprotocol.com',
    facilitatorUrl: 'https://facilitator.payai.network',
    isTestnet: true,
  },
  'base-mainnet': {
    label: 'Base (mainnet)',
    caip2: 'eip155:8453',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    explorerTxUrl: 'https://basescan.org/tx/',
    nodeUrl: 'https://devnode.telegraphprotocol.com', // swap for the mainnet node when live
    facilitatorUrl: 'https://facilitator.payai.network',
    isTestnet: false,
  },
}

export interface TelegraphSettings {
  networkId: string
  /** EVM private key (0x...) — burner wallet. Stored via safeStorage. */
  privateKey?: string
  /** Auto-approve paid asks at or below this amount (0 = always ask). */
  autoApproveUpTo: number
  /** Hard daily spend ceiling in USD. */
  dailyBudgetUsd: number
}

export interface TelegraphReceipt {
  receiptHash: string
  rail: string
  payer: string
  miner: string
  intent: string
  amountUsd: number
  amountUusdc: string
  epochId: number
  settlement: string
  chain: string
  txHash: string
  timestamp: number
  /** Signal hash of the served answer — the per-call verifiable artifact. */
  signalHash?: string
  explorerUrl?: string
  query?: string
}

export interface TelegraphMiner {
  id: string
  slug: string
  name: string
  endpoints?: Array<{ path?: string; method?: string; description?: string }>
  supportedIntents: string[]
  minPriceUsdc?: number
  activationStatus?: string
}

export interface TelegraphIntent {
  id: string
  name?: string
  category?: string
  type?: string
}

export interface TelegraphAskResult {
  minerId: string
  minerName: string
  intent?: string
  reasoning?: string
  result: unknown
  costUsd: number
  durationMs: number
  signalHash?: string
  receipt?: TelegraphReceipt
}

export interface TelegraphStatus {
  enabled: boolean
  walletAddress?: string
  walletFunded: boolean
  usdcBalance: string
  networkLabel: string
  isTestnet: boolean
  nodeReachable: boolean
  minerCount: number
  intentCount: number
  receiptsTotal: number
  spentTodayUsd: number
  spentTotalUsd: number
}

/* ------------------------------------------------------------------ */
/* App settings                                                        */
/* ------------------------------------------------------------------ */

export type AppLanguage = 'en' | 'vi'

/** UI theme: light is the default, dark is opt-in from Settings. */
export type AppTheme = 'light' | 'dark'

export interface AppSettings {
  language: AppLanguage
  /** Renderer theme; applied to body[data-dark-theme]. */
  theme: AppTheme
  workspace: string
  defaultModelId: string
  telegraph: TelegraphSettings
  /**
   * Master switch for the whole Telegraph Protocol surface of the app.
   * Off = every Telegraph tool, tab, wallet and paid call is disabled;
   * on = everything comes back. Wallet + receipts stay stored either way.
   */
  telegraphEnabled: boolean
  /** Master switch: auto-approve everything (demo mode). Off by default. */
  autoApproveAll: boolean
  /**
   * PonyTail pack: inject the six bundled ponytail SKILL.md files
   * (resources/ponytail/) verbatim into the agent system prompt.
   */
  ponytailEnabled: boolean
  /** MCP servers the harness connects to. */
  mcpServers: McpServerConfig[]
  /** Optional Tavily key; without it web_search uses the keyless DuckDuckGo backend. */
  tavilyApiKey?: string
}

/* ------------------------------------------------------------------ */
/* Live events (main → renderer)                                       */
/* ------------------------------------------------------------------ */

export type HarnessEvent =
  | { type: 'message-start'; sessionId: string; message: ChatMessage }
  | { type: 'message-delta'; sessionId: string; messageId: string; delta: string }
  | { type: 'message-reasoning'; sessionId: string; messageId: string; delta: string }
  | { type: 'message-done'; sessionId: string; messageId: string; message: ChatMessage }
  | { type: 'message-error'; sessionId: string; messageId: string; error: string }
  | { type: 'turn-usage'; sessionId: string; messageId: string; inputTokens: number; outputTokens: number }
  | {
      type: 'tool-start'
      sessionId: string
      messageId: string
      run: ToolRun
    }
  | {
      type: 'tool-update'
      sessionId: string
      messageId: string
      run: ToolRun
    }
  | { type: 'approval-request'; request: ApprovalRequest }
  | { type: 'approval-resolved'; requestId: string; approved: boolean }
  | { type: 'task-board-changed'; tasks: BoardTask[] }
  | { type: 'lock-changed'; locks: LockInfo[] }
  | { type: 'receipt'; sessionId: string; messageId?: string; receipt: TelegraphReceipt }
  | { type: 'typing'; sessionId: string; agentId: string; agentName: string; isTyping: boolean }
  | { type: 'swarm-round'; sessionId: string; round: number; maxRounds: number }
  | { type: 'model-catalog-updated'; catalog: CatalogSnapshot }
  | { type: 'session-reloaded'; session: Session }
  | { type: 'todo-changed'; sessionId: string; todos: TodoItem[] }
  | { type: 'reminder-fired'; sessionId: string; scheduleId: string; title: string; prompt: string }
  | { type: 'mcp-changed'; servers: McpServerStatus[] }

export interface LockInfo {
  path: string
  holderAgentId: string
  holderName: string
  mode: 'hard' | 'advisory'
  acquiredAt: number
}
