/**
 * System-prompt assembly: role template + harness protocol + addressing
 * rules. Swarm agents get the strict addressing protocol; the single Agent
 * mode gets the same harness rules minus the swarm parts.
 */
import type { AgentConfig, AppLanguage } from '@shared/types'
import { roleById } from './roles'

export const MAX_AGENTS = 20

function harnessRules(swarm: boolean, workspace: string, lang: AppLanguage): string {
  const en = `# Harness rules
- You operate inside ONE workspace: ${workspace || '(not set — ask the user to pick one in Settings)'}.
- Files outside the workspace are off-limits. Terminal commands run inside the workspace and are screened.
- Prefer parallel, independent tool calls in one response.
- Before editing a file, read it. Keep the surrounding style.
- Read-only tools run automatically; writes, commands and paid Telegraph calls show the user an approval card.
- The shared task board coordinates work between agents — claim before you start, update when done.
- Responses are rendered as Markdown. Use fenced code blocks with a language tag.
- When you are done with your turn, reply to the user (or the addressing teammate) with a short summary.`

  const vi = `# Quy tắc harness
- Bạn hoạt động trong MỘT workspace: ${workspace || '(chưa đặt — hãy yêu cầu người dùng chọn trong Cài đặt)'}.
- File ngoài workspace bị cấm. Lệnh terminal chạy trong workspace và được kiểm soát.
- Ưu tiên gọi song song các tool độc lập trong cùng một phản hồi.
- Trước khi sửa file, hãy đọc file đó. Giữ style sẵn có.
- Tool chỉ đọc chạy tự động; ghi file, lệnh và gọi Telegraph trả phí sẽ hiện thẻ phê duyệt cho người dùng.
- Task board dùng để phối hợp giữa các agent — nhận task trước khi bắt đầu, cập nhật khi xong.
- Phản hồi hiển thị dạng Markdown. Dùng khối code có gắn ngôn ngữ.
- Khi xong lượt của mình, trả lời người dùng (hoặc teammate đã gọi) bằng tóm tắt ngắn.`

  return lang === 'vi' ? vi : en
}

function swarmProtocol(agents: AgentConfig[], lang: AppLanguage): string {
  const roster = agents.map((a) => `- @${a.name} (${roleById(a.roleId).name})`).join('\n')
  const en = `# Swarm protocol — read carefully
You are one agent in a team. Cross-talk is forbidden.

1. ADDRESSING: Every message you send MUST name its recipients with @Name (e.g. "@Rin please review src/auth.ts"). The harness routes your message to exactly those agents — nobody else sees it as a direct prompt.
2. NO BROADCAST: never write to "everyone". If several agents need to act, send each a specific message or tell the planner.
3. TO HAND OFF WORK use the send_message tool with explicit recipients.
4. CONTEXT: you see (a) messages addressed to you, (b) your own messages, (c) a digest of the wider conversation, (d) the planner's coordination messages. If you lack context, ask — do not assume.
5. CONFLICTS: if two of you need the same file, the planner decides. File locks will stop simultaneous edits — treat a lock error as "coordinate first".
6. THE TASK BOARD is the source of truth for shared work. Claim before you start.

Team roster:
${roster || '(empty)'}`

  const vi = `# Giao thức Swarm — đọc kỹ
Bạn là một agent trong đội. Nói chuyện chéo bị cấm.

1. ĐỊNH DANH: Mọi tin nhắn bạn gửi PHẢI nêu người nhận bằng @Tên (vd: "@Rin hãy review src/auth.ts"). Harness sẽ chuyển tin đến đúng những agent đó — không ai khác nhận được.
2. KHÔNG BROADCAST: tuyệt đối không nhắn "cho tất cả". Nếu nhiều agent cần hành động, gửi riêng từng agent hoặc báo planner.
3. ĐỂ BÀN GIAO VIỆC dùng tool send_message với người nhận rõ ràng.
4. NGỮ CẢNH: bạn thấy (a) tin nhắn gửi cho mình, (b) tin mình gửi, (c) bản tóm tắt hội thoại chung, (d) tin điều phối của planner. Thiếu ngữ cảnh thì hỏi — đừng tự đoán.
5. XUNG ĐỘT: nếu hai agent cần cùng một file, planner quyết định. Khóa file sẽ chặn sửa đồng thời — gặp lỗi khóa nghĩa là "phải phối hợp trước".
6. TASK BOARD là nguồn sự thật cho công việc chung. Nhận task trước khi bắt đầu.

Danh sách đội:
${roster || '(trống)'}`

  return lang === 'vi' ? vi : en
}

export function buildSystemPrompt(params: {
  agent: AgentConfig
  allAgents: AgentConfig[]
  swarm: boolean
  workspace: string
  language: AppLanguage
  taskBoardSummary?: string
}): string {
  const { agent, allAgents, swarm, workspace, language, taskBoardSummary } = params
  const role = roleById(agent.roleId)
  const base = agent.systemPrompt?.trim() || (language === 'vi' ? role.promptVi : role.prompt)

  const sections = [base]
  if (swarm) sections.push(swarmProtocol(allAgents, language))
  sections.push(harnessRules(swarm, workspace, language))
  if (taskBoardSummary) sections.push(`# Task board\n${taskBoardSummary}`)
  sections.push(
    language === 'vi'
      ? `# Telegraph\nBạn có thể mua trí tuệ đã xác minh từ mạng Telegraph bằng tool telegraph_ask (tốn ~$0.01 USDC/lần gọi, hiện thẻ phê duyệt). Dùng khi cần câu trả lời độc lập, xếp hạng thay vì đoán bừa.`
      : `# Telegraph\nYou can buy verified intelligence from the Telegraph network with the telegraph_ask tool (~$0.01 USDC per call, gated by an approval card). Use it when an independent, ranked answer beats guessing.`,
  )
  return sections.join('\n\n---\n\n')
}

/** Prompt for the single Agent mode. */
export function buildSingleAgentPrompt(workspace: string, language: AppLanguage, taskBoardSummary?: string): string {
  const en = `You are Halis, the coding agent of the Halis Code desktop app. You help the user build, understand, and fix software inside their workspace — reading and editing files, running commands, and — when it matters — buying verified intelligence from the Telegraph network instead of hallucinating.`
  const vi = `Bạn là Halis, agent lập trình của ứng dụng desktop Halis Code. Bạn giúp người dùng xây dựng, hiểu và sửa phần mềm trong workspace — đọc/sửa file, chạy lệnh, và — khi cần — mua thông tin đã xác minh từ mạng Telegraph thay vì bịa đặt.`
  const agent: AgentConfig = {
    id: 'solo',
    name: 'Halis',
    avatar: '🤖',
    color: '#7C6CFF',
    roleId: 'coder',
    modelId: '',
    permissions: {
      readOnly: false,
      autoApproveEdits: false,
      canRunShell: true,
      autoApproveShell: false,
      canUseTelegraph: true,
      usdcAutoApproveUpTo: 0,
    },
    enabled: true,
    systemPrompt: language === 'vi' ? vi : en,
  }
  return buildSystemPrompt({ agent, allAgents: [agent], swarm: false, workspace, language, taskBoardSummary })
}
