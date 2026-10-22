/**
 * Session store — mobile edition. Same shape as the desktop store, backed
 * by IndexedDB (`session:<id>` keys). Sessions carry both chat modes.
 */
import type { ChatMode, Session, SessionMeta } from '@shared/types'
import { kvGet, kvSet, kvDelete, kvKeys } from './storage'
import { newId } from './util/id'

const PREFIX = 'session:'

export class SessionStore {
  /** Tombstoned ids: a deleted session must not be resurrected by a
   *  still-running turn's post-abort save (stop only aborts — the runner
   *  unwinds asynchronously and then saves). */
  private deleted = new Set<string>()

  private toMeta(session: Session): SessionMeta {
    return {
      id: session.id,
      title: session.title,
      mode: session.mode,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages?.length ?? 0,
      modelId: session.modelId,
      agentNames: session.agentNames,
    }
  }

  async list(): Promise<SessionMeta[]> {
    const keys = await kvKeys(PREFIX)
    const metas: SessionMeta[] = []
    for (const key of keys) {
      const id = key.slice(PREFIX.length)
      if (this.deleted.has(id)) continue
      const session = await kvGet<Session | null>(key, null)
      if (!session?.id) continue
      metas.push(this.toMeta(session))
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(sessionId: string): Promise<Session | null> {
    if (this.deleted.has(sessionId)) return null
    const session = await kvGet<Session | null>(PREFIX + sessionId, null)
    if (!session?.id) return null
    // Streaming flags may have been persisted mid-turn (crash) — clear them.
    for (const message of session.messages ?? []) message.streaming = false
    return session
  }

  async create(mode: ChatMode, title?: string, modelId?: string, agentNames?: string[]): Promise<Session> {
    const session: Session = {
      id: newId('ses'),
      title: title?.trim() || (mode === 'swarm' ? 'New swarm session' : 'New chat'),
      mode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      messages: [],
      modelId,
      agentNames,
    }
    await this.save(session)
    return session
  }

  async save(session: Session): Promise<void> {
    if (this.deleted.has(session.id)) return
    session.updatedAt = Date.now()
    session.messageCount = session.messages?.length ?? 0
    await kvSet(PREFIX + session.id, session)
  }

  async delete(sessionId: string): Promise<void> {
    await kvDelete(PREFIX + sessionId)
    // Tombstone AFTER the delete: any late save from an unwinding turn is a
    // no-op, so the deleted session never reappears in the list.
    this.deleted.add(sessionId)
  }

  async rename(sessionId: string, title: string): Promise<void> {
    const session = await this.get(sessionId)
    if (!session) return
    session.title = title.trim() || session.title
    await this.save(session)
  }

  /** Auto-title from the first user message (cheap, no LLM call). */
  maybeAutoTitle(session: Session): void {
    if (session.title !== 'New chat' && session.title !== 'New swarm session') return
    const first = session.messages.find((m) => m.role === 'user')
    if (!first) return
    session.title = first.content.replace(/\s+/g, ' ').slice(0, 48) || session.title
  }
}
