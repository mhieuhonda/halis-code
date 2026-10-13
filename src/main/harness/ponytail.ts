/**
 * PonyTail pack — six SKILL.md files bundled under resources/ponytail/.
 * When the Settings toggle is on, their full text is injected into the
 * agent system prompt (verbatim, not loaded on demand like workspace
 * skills).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const SKILLS = [
  'ponytail',
  'ponytail-review',
  'ponytail-audit',
  'ponytail-debt',
  'ponytail-gain',
  'ponytail-help',
]

let cached: string | null = null

function packDir(): string {
  // electron-vite dev: app root holds resources/. Packaged: extraResources
  // copies the pack to <resourcesPath>/ponytail (NOT /resources/ponytail —
  // that double-nesting made existsSync fail and the feature die silently
  // in shipped builds while working perfectly in dev).
  return app.isPackaged ? join(process.resourcesPath, 'ponytail') : join(app.getAppPath(), 'resources', 'ponytail')
}

/** Full markdown of the six bundled ponytail skills, or undefined when the pack is missing/empty. */
export function ponytailSection(): string | undefined {
  if (cached !== null) return cached || undefined
  const dir = packDir()
  if (!existsSync(dir)) {
    cached = ''
    return undefined
  }
  const blocks: string[] = []
  for (const name of SKILLS) {
    try {
      const file = join(dir, name, 'SKILL.md')
      if (!existsSync(file)) continue
      blocks.push(`<skill name="${name}">\n${readFileSync(file, 'utf8').trim()}\n</skill>`)
    } catch {
      /* skip unreadable skill */
    }
  }
  cached = blocks.join('\n\n')
  return cached || undefined
}
