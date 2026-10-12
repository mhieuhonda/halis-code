/**
 * Session store: JSON files in userData/sessions, atomic writes, list/get/
 * delete + rename. Sessions carry both chat modes.
 */
import type { ChatMode, Session, SessionMeta } from '@shared/types'
import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import { newId } from '../util/id'
import { readJson, writeJson } from '../util/json'
import { paths } from '../config/paths'

export class SessionStore {
  /** Tombstoned ids: a deleted session must not be resurrected by a
   *  still-running turn's post-abort save (chatStop only aborts — the
   *  runner unwinds asynchronously and then saves). */
  private deleted = new Set<string>()

  list(): SessionMeta[] {
    if (!existsSync(paths.sessionsDir)) return []
    const metas: SessionMeta[] = []
    for (const file of readdirSync(paths.sessionsDir)) {
      if (!file.endsWith('.json')) continue
      const session = readJson<Session | null>(paths.sessionFile(file.replace(/\.json$/, '')), null)
      if (!session?.id) continue
      if (this.deleted.has(session.id)) continue
      metas.push(this.toMeta(session))
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private toMeta(session: Session): SessionMeta {
    return {
      id: session.id,
      title: session.title,
      mode: session.mode,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      modelId: session.modelId,
      agentNames: session.agentNames,
    }
  }

  get(sessionId: string): Session | null {
    if (this.deleted.has(sessionId)) return null
    const session = readJson<Session | null>(paths.sessionFile(sessionId), null)
    if (!session?.id) return null
    // Streaming flags may have been persisted mid-turn (crash) — clear them.
    for (const message of session.messages ?? []) message.streaming = false
    return session
  }

  create(mode: ChatMode, title?: string, modelId?: string, agentNames?: string[]): Session {
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
    this.save(session)
    return session
  }

  save(session: Session): void {
    if (this.deleted.has(session.id)) return
    session.updatedAt = Date.now()
    session.messageCount = session.messages.length
    writeJson(paths.sessionFile(session.id), session)
  }

  delete(sessionId: string): void {
    const file = paths.sessionFile(sessionId)
    if (existsSync(file)) unlinkSync(file)
    // Tombstone AFTER unlinking: any late save from an unwinding turn is a
    // no-op, so the "deleted" session never reappears in the sidebar.
    this.deleted.add(sessionId)
  }

  rename(sessionId: string, title: string): void {
    const session = this.get(sessionId)
    if (!session) return
    session.title = title.trim() || session.title
    this.save(session)
  }

  /** Auto-title from the first user message (cheap, no LLM call). */
  maybeAutoTitle(session: Session): void {
    if (session.title !== 'New chat' && session.title !== 'New swarm session') return
    const first = session.messages.find((m) => m.role === 'user')
    if (!first) return
    session.title = first.content.replace(/\s+/g, ' ').slice(0, 48) || session.title
  }
}
