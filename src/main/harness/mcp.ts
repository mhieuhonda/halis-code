/**
 * MCP (Model Context Protocol) client manager — the flagship integration
 * both opencode and deepseek-harness ship. Servers are configured in app
 * settings (stdio command or HTTP url); their tools are registered into the
 * harness ToolRegistry with `mcp_<server>_<tool>` names so every agent can
 * call them. Tool schemas come straight from the server (JSON Schema);
 * mutating tools default to requiring approval.
 */
import { execFile } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export interface McpServerConfig {
  name: string
  /** stdio server: command to spawn. */
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  /** Remote server: streamable-HTTP endpoint. */
  url?: string
  headers?: Record<string, string>
  timeoutMs?: number
  enabled: boolean
}

export interface McpToolInfo {
  server: string
  name: string
  qualifiedName: string
  description: string
  parameters: Record<string, unknown>
  readOnly: boolean
}

export interface McpServerStatus {
  name: string
  enabled: boolean
  connected: boolean
  error?: string
  toolCount: number
}

interface ServerEntry {
  config: McpServerConfig
  client: Client | null
  error?: string
  tools: McpToolInfo[]
}

const REQUEST_TIMEOUT_DEFAULT = 30_000

export class McpManager {
  private entries = new Map<string, ServerEntry>()
  private hooks: { onToolsChanged: (tools: McpToolInfo[]) => void } | null = null

  setHooks(hooks: { onToolsChanged: (tools: McpToolInfo[]) => void }): void {
    this.hooks = hooks
  }

  statuses(): McpServerStatus[] {
    return [...this.entries.values()].map((e) => ({
      name: e.config.name,
      enabled: e.config.enabled,
      connected: !!e.client,
      error: e.error,
      toolCount: e.tools.length,
    }))
  }

  allTools(): McpToolInfo[] {
    return [...this.entries.values()].flatMap((e) => e.tools)
  }

  /** Apply a new config set: connect new servers, drop removed ones.
   * Serialized: rapid Settings saves interleave at the awaits below — two
   * overlapping syncs both see the same stale entry, both closeEntry, then
   * both set their own; the loser's connect() finishes into an entry that is
   * no longer in the map, and its stdio child is never closed by closeAll.
   * Every caller gets the result of ITS OWN run (chained onto the tail). */
  private syncTail: Promise<McpServerStatus[]> = Promise.resolve([])

  syncConfigs(configs: McpServerConfig[]): Promise<McpServerStatus[]> {
    const run = this.syncTail.catch(() => {}).then(() => this.doSyncConfigs(configs))
    this.syncTail = run
    return run
  }

  private async doSyncConfigs(configs: McpServerConfig[]): Promise<McpServerStatus[]> {
    const wanted = new Map(configs.map((c) => [c.name, c]))
    for (const [name, entry] of this.entries) {
      if (!wanted.has(name)) {
        await this.closeEntry(entry)
        this.entries.delete(name)
      }
    }
    for (const config of configs) {
      const existing = this.entries.get(config.name)
      // Field-wise compare: JSON.stringify is key-order-sensitive — saving a
      // semantically identical config with reordered keys would close and
      // respawn every server (brief tool outage + orphaned children).
      if (existing && sameConfig(existing.config, config)) continue
      if (existing) {
        await this.closeEntry(existing)
      }
      const entry: ServerEntry = { config, client: null, tools: [] }
      this.entries.set(config.name, entry)
      if (config.enabled) await this.connect(entry, 0)
    }
    this.hooks?.onToolsChanged(this.allTools())
    return this.statuses()
  }

  /** Connect or reconnect one server by name. */
  async connectServer(name: string): Promise<McpServerStatus | { error: string }> {
    const entry = this.entries.get(name)
    if (!entry) return { error: `Unknown MCP server: ${name}` }
    await this.closeEntry(entry)
    await this.connect(entry, 0)
    this.hooks?.onToolsChanged(this.allTools())
    return { name, enabled: entry.config.enabled, connected: !!entry.client, error: entry.error, toolCount: entry.tools.length }
  }

  private async connect(entry: ServerEntry, attempt: number): Promise<void> {
    const { config } = entry
    const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_DEFAULT
    let client: Client | null = null
    let timer: NodeJS.Timeout | null = null
    try {
      client = new Client({ name: 'halis-code', version: '0.3.0' })
      const transport = config.url
        ? new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } })
        : new StdioClientTransport({
            command: config.command!,
            args: config.args ?? [],
            cwd: config.cwd,
            env: { ...minimalEnv(), ...(config.env ?? {}) },
            stderr: 'ignore',
          })
      const connectPromise = client.connect(transport)
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`connect timed out after ${timeoutMs}ms`)), timeoutMs)
        if (typeof timer.unref === 'function') timer.unref()
      })
      await Promise.race([connectPromise, timeout])
      if (timer) clearTimeout(timer)
      timer = null
      entry.client = client
      entry.error = undefined
      await this.refreshTools(entry)
    } catch (err) {
      // Close whatever was created — a stdio transport has already spawned
      // its child process at this point; leaving it running orphans one node
      // process per failed (and retried) connect.
      if (client) {
        try {
          await client.close()
        } catch {
          /* ignore */
        }
      }
      if (timer) clearTimeout(timer)
      entry.client = null
      entry.error = err instanceof Error ? err.message : String(err)
      entry.tools = []
      // One quiet reconnect for flaky stdio startups.
      if (attempt < 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        await this.connect(entry, attempt + 1)
      }
    }
  }

  private async refreshTools(entry: ServerEntry): Promise<void> {
    if (!entry.client) {
      entry.tools = []
      return
    }
    try {
      const result = await entry.client.listTools({}, { timeout: entry.config.timeoutMs ?? REQUEST_TIMEOUT_DEFAULT })
      entry.tools = (result.tools ?? []).map((tool) => ({
        server: entry.config.name,
        name: tool.name,
        qualifiedName: `mcp_${sanitize(entry.config.name)}_${sanitize(tool.name)}`,
        description: tool.description ?? `${tool.name} (MCP: ${entry.config.name})`,
        parameters: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
        readOnly: !!(tool.annotations as { readOnlyHint?: boolean } | undefined)?.readOnlyHint,
      }))
    } catch (err) {
      entry.error = `listTools failed: ${err instanceof Error ? err.message : String(err)}`
      entry.tools = []
    }
  }

  /** Call a tool on the server it belongs to. */
  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<{ ok: true; text: string; structured?: unknown } | { ok: false; error: string }> {
    const entry = [...this.entries.values()].find((e) => e.tools.some((t) => t.qualifiedName === qualifiedName))
    if (!entry) return { ok: false, error: `No MCP server provides "${qualifiedName}".` }
    const tool = entry.tools.find((t) => t.qualifiedName === qualifiedName)!
    if (!entry.client) return { ok: false, error: `MCP server "${entry.config.name}" is not connected: ${entry.error ?? 'unknown error'}.` }
    try {
      const result = await entry.client.callTool({ name: tool.name, arguments: args }, undefined, { timeout: entry.config.timeoutMs ?? REQUEST_TIMEOUT_DEFAULT })
      if (result.isError) {
        const text = contentText(result.content)
        return { ok: false, error: text || 'Tool reported an error.' }
      }
      const structured = (result as { structuredContent?: unknown }).structuredContent
      const text = contentText(result.content) || (structured ? JSON.stringify(structured, null, 2) : '(empty result)')
      return { ok: true, text, structured }
    } catch (err) {
      return { ok: false, error: `MCP call failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async closeAll(): Promise<void> {
    for (const entry of this.entries.values()) await this.closeEntry(entry)
    this.entries.clear()
  }

  private async closeEntry(entry: ServerEntry): Promise<void> {
    if (entry.client) {
      try {
        await entry.client.close()
      } catch {
        /* ignore */
      }
      entry.client = null
    }
  }
}

/**
 * Injective encoding: every character outside [a-zA-Z0-9-] (including "_"!)
 * becomes "_<hex>_". Plain concatenation of two sanitized names can never
 * collide across server/tool pairs, so qualified MCP tool names stay unique
 * and calls always reach the right server.
 */
export function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, (ch) => `_${ch.codePointAt(0)!.toString(16)}_`)
}

/** Child MCP servers get a lean environment — no credential leak-through. */
function minimalEnv(): Record<string, string> {
  const keep = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'SYSTEMROOT', 'TEMP', 'TMP', 'LANG', 'TERM', 'COMSPEC', 'SHELL', 'USER', 'LOGNAME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']
  const out: Record<string, string> = {}
  for (const key of keep) {
    const value = process.env[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

/** Order-insensitive config equality (JSON.stringify is key-order-sensitive). */
function sameConfig(a: McpServerConfig, b: McpServerConfig): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  for (const key of keys) {
    const av = ra[key]
    const bv = rb[key]
    const an = av === undefined || av === '' ? null : av
    const bn = bv === undefined || bv === '' ? null : bv
    if (JSON.stringify(an) !== JSON.stringify(bn)) return false
  }
  return true
}

/** Quick reachability test used by Settings. */
export async function testMcpConfig(config: McpServerConfig): Promise<{ ok: boolean; detail: string; toolCount: number }> {
  if (config.command) {
    const check = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
      execFile(config.command!, config.args ?? [], { timeout: 5000, windowsHide: true }, (err, _stdout, stderr) => {
        // MCP stdio servers may exit non-zero on a bare probe; what matters is
        // that the binary exists and is executable.
        if (!err) resolve({ ok: true, detail: `command "${config.command}" runs` })
        else if ((err as NodeJS.ErrnoException).code === 'ENOENT') resolve({ ok: false, detail: `command not found: ${config.command}` })
        else resolve({ ok: true, detail: `command exists (probe: ${(stderr || err.message).slice(0, 120)})` })
      })
    })
    if (!check.ok) return { ...check, toolCount: 0 }
  }
  const manager = new McpManager()
  try {
    const statuses = await manager.syncConfigs([{ ...config, enabled: true }])
    const status = statuses[0]
    if (status?.connected) return { ok: true, detail: `connected — ${status.toolCount} tool(s)`, toolCount: status.toolCount }
    return { ok: false, detail: status?.error ?? 'connection failed', toolCount: 0 }
  } finally {
    await manager.closeAll()
  }
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  return content
    .map((part) => {
      const p = part as { type?: string; text?: string }
      if (p.type === 'text') return p.text ?? ''
      if (p.type === 'image') return '[image returned by MCP tool]'
      if (p.type === 'resource') return '[resource returned by MCP tool]'
      return ''
    })
    .filter(Boolean)
    .join('\n')
}
