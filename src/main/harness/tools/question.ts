/**
 * ask_user — structured clarification questions (opencode question +
 * deepseek ask_user). The agent can present up to 4 questions with options;
 * the renderer shows an interactive card. The tool blocks until the user
 * answers or a 10-minute timeout returns a pending result the model can
 * act on.
 */
import type { QuestionAnswer, QuestionPrompt } from '@shared/types'
import type { ToolContext, ToolDef, ToolResult } from './index'

const MAX_QUESTIONS = 4
const TIMEOUT_MS = 10 * 60 * 1000

export const askUserTool: ToolDef = {
  name: 'ask_user',
  description:
    'Ask the user clarifying questions with selectable options. Use when a decision materially changes the work (approach, scope, trade-offs) — not for trivial confirmations. Provide 1-4 questions, each with 2-4 concrete options. If one option is recommended, put it FIRST and append "(Recommended)" to its label.',
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '1-4 questions',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable short id, e.g. "db-choice"' },
            question: { type: 'string', description: 'Complete question text' },
            header: { type: 'string', description: 'Short chip label, max 30 chars' },
            multiSelect: { type: 'boolean', description: 'Allow choosing several options' },
            options: {
              type: 'array',
              description: '2-4 options; the user can always type a custom answer instead',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Short option label (a few words)' },
                  description: { type: 'string', description: 'One-line explanation of the option' },
                },
                required: ['label'],
              },
            },
          },
          required: ['id', 'question'],
        },
      },
    },
    required: ['questions'],
  },
  kind: 'question',
  readOnly: true,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const raw = Array.isArray(args.questions) ? args.questions : []
    if (!raw.length) return { output: 'Provide at least one question.' }
    if (!ctx.askUser) {
      return { output: 'ask_user is unavailable in this context — decide yourself and state your assumption clearly.' }
    }
    const seen = new Set<string>()
    const questions: QuestionPrompt[] = []
    for (const entry of raw.slice(0, MAX_QUESTIONS)) {
      const e = entry as { id?: unknown; question?: unknown; header?: unknown; multiSelect?: unknown; options?: unknown }
      const id = String(e.id ?? '').trim() || `q${questions.length + 1}`
      if (seen.has(id)) return { output: `Duplicate question id "${id}". Ids must be unique within the call.` }
      seen.add(id)
      const question = String(e.question ?? '').trim()
      if (!question) return { output: 'Every question needs text.' }
      const options = Array.isArray(e.options)
        ? (e.options as Array<{ label?: unknown; description?: unknown }>).slice(0, 4).map((o) => ({ label: String(o?.label ?? '').trim(), description: o?.description ? String(o.description) : undefined })).filter((o) => o.label)
        : undefined
      if (options && options.length < 2) return { output: `Question "${id}": if you provide options, give at least 2 (or none to allow a free-form answer).` }
      questions.push({
        id,
        question,
        header: e.header ? String(e.header).slice(0, 30) : undefined,
        options: options?.length ? options : undefined,
        multiSelect: !!e.multiSelect,
      })
    }

    ctx.emit({
      type: 'tool-update',
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
      // Key to the loop's real call id when available: the renderer already
      // holds a part for it (tool-start); a synthetic id would add a second,
      // permanently-pending chip that nothing ever completes.
      run: { toolCallId: ctx.toolCallId ?? `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, tool: 'ask_user', args, state: 'awaiting-approval', startedAt: Date.now() },
    })

    // The implementation parks the card in the ApprovalManager and must race
    // the wait against BOTH the timeout and the turn signal, dismissing the
    // card when the wait loses — a card left behind would keep accepting
    // clicks whose answers resolve a promise nobody awaits anymore.
    const answers = await ctx.askUser(questions, { timeoutMs: TIMEOUT_MS })

    if (!answers || !answers.length) {
      return {
        output:
          'The question card timed out or was dismissed without answers — treat it as "no answer". Continue with the most reasonable default, state the assumption clearly, and make it easy to change later. Do NOT treat this as approval for anything.',
        data: { pending: true },
      }
    }

    const rendered = answers
      .map((a: QuestionAnswer) => {
        const question = questions.find((q) => q.id === a.id)
        const picked = [...a.selected, ...(a.custom ? [`(custom) ${a.custom}`] : [])]
        return `"${question?.question ?? a.id}" = ${picked.length ? picked.join(', ') : '(skipped)'}`
      })
      .join('; ')
    return {
      output: `User answered: ${rendered}. You can now continue with these decisions locked in.`,
      data: { answers },
    }
  },
}

export const questionTools = [askUserTool]
