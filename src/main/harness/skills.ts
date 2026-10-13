/**
 * Skill discovery — SKILL.md packs. A skill is a folder
 * containing SKILL.md (frontmatter name + instructions); optional scripts/
 * and reference/ files ride along. Skills are read-only context the agent
 * loads on demand with the `skill` tool.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface SkillInfo {
  id: string
  name: string
  description: string
  dir: string
  files: string[]
}

const SKILL_DIRS = ['.halis/skills', '.agents/skills', '.claude/skills']
const MAX_SAMPLE_FILES = 10

export function discoverSkills(workspace: string): SkillInfo[] {
  const skills: SkillInfo[] = []
  // Same folder name in two skill dirs (e.g. .halis/skills/foo and
  // .claude/skills/foo) produced two entries with id "foo" — consumers
  // looked up by id and silently loaded the wrong one. First dir wins
  // (the SKILL_DIRS order is the intended priority).
  const seen = new Set<string>()
  for (const base of SKILL_DIRS) {
    const root = join(workspace, base)
    if (!existsSync(root)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      continue
    }
    for (const folder of entries) {
      if (seen.has(folder)) continue
      const dir = join(root, folder)
      const skillFile = join(dir, 'SKILL.md')
      if (!existsSync(skillFile)) continue
      seen.add(folder)
      const info = readSkill(skillFile)
      const files: string[] = []
      try {
        collectFiles(dir, dir, files)
      } catch {
        /* ignore */
      }
      skills.push({
        id: folder,
        name: info.name ?? folder,
        description: info.description ?? '',
        dir,
        files: files.slice(0, MAX_SAMPLE_FILES),
      })
    }
  }
  return skills
}

function readSkill(file: string): { name?: string; description?: string } {
  try {
    const content = readFileSync(file, 'utf8')
    const fm = content.match(/^---\n([\s\S]*?)\n---/)
    if (!fm) return { name: content.split('\n')[0]?.replace(/^#\s*/, '') }
    const name = fm[1]?.match(/^name:\s*(.+)$/m)?.[1]?.trim()
    const description = fm[1]?.match(/^description:\s*(.+)$/m)?.[1]?.trim()
    return { name, description }
  } catch {
    return {}
  }
}

function collectFiles(root: string, dir: string, out: string[], depth = 0): void {
  if (depth > 4 || out.length >= MAX_SAMPLE_FILES) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= MAX_SAMPLE_FILES) return
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      collectFiles(root, full, out, depth + 1)
    } else {
      const rel = full.slice(root.length + 1)
      if (rel !== 'SKILL.md') out.push(rel)
    }
  }
}

/** Render the `<skill_content>` block the model receives. */
export function renderSkill(skill: SkillInfo): string {
  const lines: string[] = []
  lines.push(`<skill_content name="${skill.name}">`)
  lines.push(`# Skill: ${skill.name}`)
  lines.push('')
  try {
    const content = readFileSync(join(skill.dir, 'SKILL.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n?/, '')
    lines.push(content.trim())
  } catch {
    lines.push('(SKILL.md could not be read)')
  }
  lines.push('')
  lines.push(`Base directory for this skill: ${skill.dir}`)
  lines.push('Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.')
  if (skill.files.length) {
    lines.push(`Files bundled with this skill: ${skill.files.join(', ')}`)
  }
  lines.push('</skill_content>')
  return lines.join('\n')
}

/** Short directory listing for a skill (extra files beyond the sample). */
export function skillFileCount(dir: string): number {
  try {
    return statSync(dir).isDirectory() ? readdirSync(dir).length : 0
  } catch {
    return 0
  }
}
