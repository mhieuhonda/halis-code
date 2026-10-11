/**
 * skill — load a SKILL.md pack into context (opencode-style). Skills live
 * in <workspace>/.halis/skills/, .agents/skills/ or .claude/skills/. The
 * available skill list is injected into the system prompt; this tool loads
 * the full content on demand.
 */
import type { ToolContext, ToolDef, ToolResult } from './index'
import { discoverSkills, renderSkill } from '../skills'

export const skillTool: ToolDef = {
  name: 'skill',
  description: 'Load a skill pack (instructions + bundled files) into context by id. Skills provide domain-specific playbooks; use one when its description matches the task.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Skill id (folder name), e.g. "release-checklist"' },
    },
    required: ['id'],
  },
  kind: 'other',
  readOnly: true,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const id = String(args.id ?? '').trim()
    if (!id) return { output: 'A skill id is required.' }
    const skills = discoverSkills(ctx.workspace)
    const skill = skills.find((s) => s.id === id || s.id.toLowerCase() === id.toLowerCase())
    if (!skill) {
      const available = skills.map((s) => s.id).join(', ') || '(none — no SKILL.md packs in this workspace)'
      return { output: `Skill "${id}" not found. Available: ${available}` }
    }
    return { output: renderSkill(skill), data: { id: skill.id, dir: skill.dir } }
  },
}

export const skillTools = [skillTool]
