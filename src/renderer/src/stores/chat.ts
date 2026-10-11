/** Chat store: sessions, live message stream, approvals, typing, task board. */
import { create } from 'zustand'
import type {
  ApprovalRequest,
  BoardTask,
  ChatMessage,
  HarnessEvent,
  LockInfo,
  Session,
  SessionMeta,
} from '@shared/types'
import { bridge } from '../lib/ipc'

interface ChatState {
  sessions: SessionMeta[]
  activeSessionId: string | null
  activeMode: 'agent' | 'swarm'
  messages: ChatMessage[]
  running: boolean
  typing: Record<string, { name: string; since: number }>
  approvals: ApprovalRequest[]
  tasks: BoardTask[]
  locks: LockInfo[]
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
  loadTasks: () => Promise<void>
  createTask: (title: string, description?: string) => Promise<void>
  updateTask: (taskId: string, patch: { status?: import('@shared/types').TaskStatus; blockedReason?: string }) => Promise<void>
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
      return { swarmRound: { round: event.round, maxRounds: event.maxRounds } }
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
  activeMode: 'agent',
  messages: [],
  running: false,
  typing: {},
  approvals: [],
  tasks: [],
  locks: [],
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
    const session = (await bridge.sessionGet(id)) as Session | null
    if (!session) return
    set({ activeSessionId: id, messages: session.messages, activeMode: session.mode, typing: {}, swarmRound: null, approvals: [] })
  },

  newSession: async (mode, modelId) => {
    const session = (await bridge.sessionNew(mode, undefined, modelId)) as Session
    await get().loadSessions()
    set({ activeSessionId: session.id, messages: session.messages, activeMode: mode, typing: {}, swarmRound: null })
    return session.id
  },

  deleteSession: async (id) => {
    await bridge.sessionDelete(id)
    if (get().activeSessionId === id) set({ activeSessionId: null, messages: [] })
    await get().loadSessions()
  },

  renameSession: async (id, title) => {
    await bridge.sessionRename(id, title)
    await get().loadSessions()
  },

  send: async (text, modelId) => {
    const sessionId = get().activeSessionId
    if (!sessionId || !text.trim()) return
    set({ running: true, swarmRound: null })
    try {
      // Main persists and broadcasts turn-level errors as system messages.
      await bridge.chatSend({ sessionId, text, modelId })
    } finally {
      set({ running: false, typing: {} })
      await get().loadSessions()
      // Refresh the open session to catch anything missed by events.
      await get().openSession(sessionId)
    }
  },

  stop: async () => {
    const sessionId = get().activeSessionId
    if (sessionId) await bridge.chatStop(sessionId)
  },

  respondApproval: async (requestId, response) => {
    await bridge.approvalRespond(requestId, response)
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
}))
