import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Small, dependency-free JSON store with atomic writes (tmp + rename).
 * Halis Code keeps everything local-first: plain JSON files in the
 * Electron userData directory.
 */
export function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (err) {
    console.warn(`[halis] failed to read ${path}:`, err)
    return fallback
  }
}

/**
 * Write JSON atomically (tmp + rename). `mode` applies restrictive
 * permissions at creation — use 0o600 for files that hold secrets
 * (settings with provider keys, the swarm config with per-agent keys).
 */
export function writeJson(path: string, value: unknown, opts: { mode?: number } = {}): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', ...(opts.mode !== undefined ? { mode: opts.mode } : {}) })
  renameSync(tmp, path)
  if (opts.mode !== undefined) {
    try {
      chmodSync(path, opts.mode)
    } catch {
      /* Windows: not applicable */
    }
  }
}
