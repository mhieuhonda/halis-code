import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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

export function writeJson(path: string, value: unknown): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}
