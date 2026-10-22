/** Chat store: sessions, live message stream, approvals, typing, task board, todos. */
import { create } from 'zustand'
import type {
  ApprovalRequest,
  BoardTask,
  ChatMessage,
  HarnessEvent,
  LockInfo,
  QuestionAnswer,
  Session,
  SessionMeta,
  TodoItem,
} from '@shared/types'
import { bridge } from '../lib/bridge'
import { useAppStore } from './app'

interface ChatState {
  sessions: SessionMeta[]
  activeSessionId: string | null
  /** The id of the session the user CLICKED (the fetch may still be in flight). */
  pendingSessionId: string | null
  activeMode: 'agent' | 'swarm'
  messages: ChatMessage[]
  /** True when the session BEING VIEWED has a turn running. */
  running: boolean
  /** Sessions whose turns are actually running (main runs them per-session). */
  runningSessions: string[]
  /** Last rejected send (main refused the turn) — surfaced by the Composer. */
  sendError: string | null
  typing: Record<string, { name: string; since: number }>
  approvals: ApprovalRequest[]
  tasks: BoardTask[]
  locks: LockInfo[]
  todos: TodoItem[]
  swarmRound: { round: number; maxRounds: number } | null
  sessionsLoaded: boolean
  unsubscribe: (() => void) | null

  init: () => () => void
  loadSessions: () => Promise<void>
  openSession: (id: string) => Promise<void>
  newSession: (mode: 'agent' | 'swarm', modelId?: string) => Promise<string | null>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  send: (text: string, modelId?: string) => Promise<void>
  stop: () => Promise<void>
  respondApproval: (requestId: string, response: 'allow' | 'always' | 'reject') => Promise<void>
  answerQuestions: (requestId: string, answers: QuestionAnswer[]) => Promise<void>
  loadTasks: () => Promise<void>
  createTask: (title: string, description?: string) => Promise<void>
  updateTask: (taskId: string, patch: { status?: import('@shared/types').TaskStatus; blockedReason?: string }) => Promise<void>
  loadLocks: () => Promise<void>
}

function applyEvent(state: ChatState, event: HarnessEvent): Partial<ChatState> | null {
  switch (event.type) {
    case 'message-start': {
      if (event.message.sessionId !== state.activeSessionId) return null
      return { messages: [...state.messages.filter((m) => m.id !== event.message.id), event.message] }
    }
    case 'message-delta': {
      if (event.sessionId !== state.activeSessionId) return null
      return {
        messages: state.messages.map((m) =>
          m.id === event.messageId ? { ...m, content: m.content + event.delta, streaming: true } : m,
        ),
      }
    }
    case 'message-reasoning': {
      if (event.sessionId !== state.activeSessionId) return null
      return {
        messages: state.messages.map((m) =>
          m.id === event.messageId ? { ...m, reasoning: (m.reasoning ?? '') + event.delta } : m,
        ),
      }
    }
    case 'message-done': {
      if (event.sessionId !== state.activeSessionId) return null
      return { messages: state.messages.map((m) => (m.id === event.messageId ? { ...event.message, streaming: false } : m)) }
    }
    case 'message-error': {
      if (event.sessionId !== state.activeSessionId) return null
      return {
        messages: state.messages.map((m) =>
          m.id === event.messageId ? { ...m, streaming: false, error: event.error } : m,
        ),
      }
    }
    case 'tool-start':
    case 'tool-update': {
      if (event.sessionId !== state.activeSessionId) return null
      return {
        messages: state.messages.map((m) => {
          if (m.id !== event.messageId) return m
          const parts = [...(m.parts ?? [])]
          const idx = parts.findIndex((p) => p.type === 'tool' && p.run.toolCallId === event.run.toolCallId)
          const part = { type: 'tool' as const, run: event.run }
          if (idx >= 0) parts[idx] = part
          else parts.push(part)
          return { ...m, parts }
        }),
      }
    }
    case 'approval-request': {
      if (state.approvals.some((a) => a.id === event.request.id)) return null
      return { approvals: [...state.approvals, event.request] }
    }
    case 'approval-resolved': {
      return { approvals: state.approvals.filter((a) => a.id !== event.requestId) }
    }
    case 'task-board-changed':
      return { tasks: event.tasks }
    case 'lock-changed':
      return { locks: event.locks }
    case 'typing': {
      if (event.sessionId !== state.activeSessionId) return null
      const typing = { ...state.typing }
      if (event.isTyping) typing[event.agentId] = { name: event.agentName, since: Date.now() }
      else delete typing[event.agentId]
      return { typing }
    }
    case 'swarm-round':
      // A swarm turn in session A must not paint "Round 2/4" onto the
      // composer of another session the user switched to — and must not
      // CLEAR A's own live indicator either (parallel swarms). Switching
      // sessions already resets swarmRound in openSession.
      if (event.sessionId !== state.activeSessionId) return null
      return { swarmRound: { round: event.round, maxRounds: event.maxRounds } }
    case 'model-catalog-updated': {
      // The main process refreshes the catalog in the background; without
      // this case the refreshed snapshot is silently dropped and the model
      // pickers stay stale for the whole session.
      useAppStore.setState({ catalog: event.catalog })
      return null
    }
    case 'session-reloaded': {
      // Compaction prunes older messages and re-orders the transcript —
      // a plain append (message-start) would show the note at the bottom
      // and keep the pruned messages visible until the turn's refetch.
      if (event.session.id !== state.activeSessionId) return null
      return { messages: event.session.messages }
    }
    case 'todo-changed': {
      if (event.sessionId !== state.activeSessionId) return null
      return { todos: event.todos }
    }
    case 'reminder-fired': {
      if (event.sessionId !== state.activeSessionId) return null
      return null
    }
    case 'mcp-changed':
      window.dispatchEvent(new CustomEvent('halis:mcp', { detail: event.servers }))
      return null
    case 'receipt':
      // Receipts surface inside tool runs; the Telegraph view reloads its ledger.
      return null
    default:
      return null
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  pendingSessionId: null,
  activeMode: 'agent',
  messages: [],
  running: false,
  runningSessions: [],
  sendError: null,
  typing: {},
  approvals: [],
  tasks: [],
  locks: [],
  todos: [],
  swarmRound: null,
  sessionsLoaded: false,
  unsubscribe: null,

  init: () => {
    // Idempotent: StrictMode mounts effects twice; never double-subscribe.
    if (get().unsubscribe) return get().unsubscribe as () => void
    const unsub = bridge.onEvent((event) => {
      const patch = applyEvent(get(), event as HarnessEvent)
      if (patch) set(patch as Partial<ChatState>)
      if (event.type === 'receipt') {
        window.dispatchEvent(new CustomEvent('halis:receipt', { detail: event.receipt }))
      }
    })
    // Recover approvals parked before this window subscribed (reload /
    // restart mid-approval would otherwise orphan the card and hang the
    // turn — there is no other path to approvalRespond). Deduped by id.
    void bridge
      .approvalList()
      .then((pending) => {
        const known = new Set(get().approvals.map((a) => a.id))
        const fresh = (pending as ApprovalRequest[]).filter((a) => !known.has(a.id))
        if (fresh.length) set({ approvals: [...get().approvals, ...fresh] })
      })
      .catch(() => {})
    // Recover running turns the same way: after a renderer reload the Stop
    // button and the composer lock would otherwise never come back, and a
    // mid-turn send would just bounce with "a turn is already running".
    void bridge
      .chatRunningSessions()
      .then((ids) => {
        if (!Array.isArray(ids) || !ids.length) return
        set((state) => {
          const runningSessions = [...new Set([...state.runningSessions, ...ids.filter((id) => typeof id === 'string')])]
          return { runningSessions, running: state.activeSessionId !== null && runningSessions.includes(state.activeSessionId) }
        })
      })
      .catch(() => {})
    // The cleanup must clear the field too, or the remount would reuse an
    // already-unsubscribed listener and drop every live event.
    const teardown = () => {
      unsub()
      set({ unsubscribe: null })
    }
    set({ unsubscribe: teardown })
    return teardown
  },

  loadSessions: async () => {
    const sessions = (await bridge.sessionList()) as SessionMeta[]
    set({ sessions, sessionsLoaded: true })
  },

  openSession: async (id) => {
    // Track the REQUESTED id synchronously: comparing against the committed
    // activeSessionId after the await rejected every switch after boot (the
    // auto-open had already set it) — the sidebar, mode toggle and palette
    // jumps were all silently dead.
    set({ pendingSessionId: id })
    const session = (await bridge.sessionGet(id)) as Session | null
    if (get().pendingSessionId !== id) return
    if (!session) return
    // approvals are NOT wiped here: a turn may still be waiting on one in
    // the main process (they are global pending cards, deduped by id), and
    // clearing the array would make the card — the only path to
    // approvalRespond — unrecoverable.
    set({
      activeSessionId: id,
      messages: session.messages,
      activeMode: session.mode,
      typing: {},
      swarmRound: null,
      todos: session.todos ?? [],
      // A "Send failed" banner from the previous session must not follow the
      // user into this one.
      sendError: null,
      // Per-session running state: the composer only locks up when the
      // session on screen is one of the sessions with a live turn.
      running: get().runningSessions.includes(id),
    })
  },

  newSession: async (mode, modelId) => {
    const session = (await bridge.sessionNew(mode, undefined, modelId)) as Session
    await get().loadSessions()
    // A session click landing while the create was in flight wins — do not
    // yank the view back to the brand-new empty session (same guard shape
    // as openSession; without it "New chat" + quick sidebar click yanked).
    if (get().pendingSessionId && get().pendingSessionId !== session.id) return session.id
    // Reset the LIVE-turn state too: a brand-new session inherits nothing —
    // leaving `running` from session A would dead-lock the composer (Enter
    // is gated on chat.running) and show A's todos and error banner.
    set({
      activeSessionId: session.id,
      pendingSessionId: session.id,
      messages: session.messages,
      activeMode: mode,
      typing: {},
      swarmRound: null,
      running: false,
      todos: [],
      sendError: null,
    })
    return session.id
  },

  deleteSession: async (id) => {
    // Stop the turn first: main keeps running it after the file is gone and
    // sessions.save() on completion would resurrect the deleted session.
    await bridge.chatStop(id)
    await bridge.sessionDelete(id)
    if (get().activeSessionId === id) set({ activeSessionId: null, pendingSessionId: null, messages: [] })
    set((state) => {
      const runningSessions = state.runningSessions.filter((s) => s !== id)
      return { runningSessions, running: state.activeSessionId !== null && runningSessions.includes(state.activeSessionId) }
    })
    await get().loadSessions()
  },

  renameSession: async (id, title) => {
    await bridge.sessionRename(id, title)
    await get().loadSessions()
  },

  send: async (text, modelId) => {
    const sessionId = get().activeSessionId
    // Early returns must surface: the Composer already cleared the input, a
    // silent return used to make the message vanish without a trace.
    if (!sessionId) {
      set({ sendError: 'No active session — create or open one first.' })
      return
    }
    if (!text.trim()) return
    set((state) => ({
      running: true,
      runningSessions: state.runningSessions.includes(sessionId) ? state.runningSessions : [...state.runningSessions, sessionId],
      sendError: null,
      swarmRound: null,
    }))
    try {
      // Turn-level failures arrive as system messages; the three early
      // rejections (turn already running / session gone / empty) come back
      // as { ok: false } and must be surfaced, or the message silently
      // disappears (text was already cleared from the composer).
      const result = (await bridge.chatSend({ sessionId, text, modelId })) as { ok: boolean; error?: string }
      if (result && result.ok === false) set({ sendError: result.error ?? 'Send failed' })
    } catch (err) {
      set({ sendError: err instanceof Error ? err.message : String(err) })
    } finally {
      // Remove THIS session's slot (parallel turns in other sessions are
      // unaffected) and re-derive `running` for the session on screen.
      set((state) => {
        const runningSessions = state.runningSessions.filter((s) => s !== sessionId)
        return {
          runningSessions,
          running: state.activeSessionId !== null && runningSessions.includes(state.activeSessionId),
          typing: state.activeSessionId === sessionId ? {} : state.typing,
          // The round indicator belongs to the turn — without this it keeps
          // showing "Round N/M" after the swarm turn completes.
          swarmRound: state.activeSessionId === sessionId ? null : state.swarmRound,
        }
      })
      await get().loadSessions()
      // Refresh the open session to catch anything missed by events — but
      // only if the user is still looking at it. `pendingSessionId` catches
      // the in-flight case: a session click during the turn's last moment
      // used to be stomped by this refetch (its openSession re-pinned
      // pendingSessionId back to the finished session and the click died).
      if (get().pendingSessionId === sessionId && get().activeSessionId === sessionId) await get().openSession(sessionId)
    }
  },

  stop: async () => {
    // Prefer stopping the turn of the session ON SCREEN; fall back to the
    // most recent still-running turn when the viewed session is idle.
    const active = get().activeSessionId
    const runningSessions = get().runningSessions
    const sessionId = active && runningSessions.includes(active) ? active : runningSessions[runningSessions.length - 1] ?? active
    if (sessionId) await bridge.chatStop(sessionId)
  },

  respondApproval: async (requestId, response) => {
    await bridge.approvalRespond(requestId, response)
    set({ approvals: get().approvals.filter((a) => a.id !== requestId) })
  },

  answerQuestions: async (requestId, answers) => {
    await bridge.approvalRespond(requestId, 'allow', answers)
    set({ approvals: get().approvals.filter((a) => a.id !== requestId) })
  },

  loadTasks: async () => {
    const tasks = (await bridge.taskBoardGet()) as BoardTask[]
    set({ tasks })
  },

  createTask: async (title, description) => {
    await bridge.taskBoardCreate(title, description)
    await get().loadTasks()
  },

  updateTask: async (taskId, patch) => {
    await bridge.taskBoardUpdate(taskId, patch)
    await get().loadTasks()
  },

  loadLocks: async () => {
    try {
      const locks = (await bridge.locksList()) as LockInfo[]
      set({ locks })
    } catch {
      /* the lock panel falls back to lock-changed events */
    }
  },
}))
