/**
 * Local API-key vault. Keys live in the app's userData directory, encrypted
 * with the OS keychain via Electron safeStorage when available, with a
 * plain-file fallback (0600) otherwise. Nothing ever leaves the machine.
 */
import { existsSync, readFileSync, statSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SafeCodec {
  isEncryptionAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(encrypted: Buffer): string
}

export class KeyVault {
  private keys: Record<string, string> = {}
  private loaded = false

  constructor(
    private readonly file: string,
    private readonly codec?: SafeCodec,
  ) {}

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      if (!existsSync(this.file)) return
      const raw = readFileSync(this.file)
      const parsed = JSON.parse(raw.toString('utf8')) as { v: number; enc?: boolean; keys?: Record<string, string> | Array<[string, string]> }
      if (parsed.enc && this.codec?.isEncryptionAvailable()) {
        const entries = parsed.keys as unknown as Array<[string, string]> | Record<string, string>
        const pairs = Array.isArray(entries) ? entries : Object.entries(entries)
        for (const [providerId, blob] of pairs) {
          try {
            this.keys[providerId] = this.codec.decrypt(Buffer.from(blob, 'base64'))
          } catch {
            // Keychain changed or was wiped — drop the unreadable key.
          }
        }
      } else if (parsed.keys) {
        this.keys = parsed.keys as Record<string, string>
      }
    } catch (err) {
      console.warn('[halis] key vault: failed to load, starting empty:', err)
    }
  }

  private persist(): void {
    const dir = dirname(this.file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (this.codec?.isEncryptionAvailable()) {
      const enc: Record<string, string> = {}
      for (const [k, v] of Object.entries(this.keys)) enc[k] = this.codec.encrypt(v).toString('base64')
      writeFileSync(this.file, JSON.stringify({ v: 1, enc: true, keys: enc }, null, 2))
    } else {
      writeFileSync(this.file, JSON.stringify({ v: 1, enc: false, keys: this.keys }, null, 2))
    }
    try {
      chmodSync(this.file, 0o600)
    } catch {
      /* Windows: not applicable */
    }
  }

  get(providerId: string): string | undefined {
    this.ensureLoaded()
    return this.keys[providerId]?.trim() || undefined
  }

  has(providerId: string): boolean {
    return !!this.get(providerId)
  }

  set(providerId: string, key: string): void {
    this.ensureLoaded()
    this.keys[providerId] = key.trim()
    this.persist()
  }

  remove(providerId: string): void {
    this.ensureLoaded()
    delete this.keys[providerId]
    this.persist()
  }

  /** Masked preview for the UI: sk-…4f2a */
  preview(providerId: string): string | undefined {
    const key = this.get(providerId)
    if (!key) return undefined
    if (key.length <= 8) return '••••'
    return `${key.slice(0, 4)}…${key.slice(-4)}`
  }

  statusAll(): Record<string, boolean> {
    this.ensureLoaded()
    const out: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(this.keys)) out[k] = !!v.trim()
    return out
  }

  /** Looks up which provider ids use the given key (duplicate-key rule). */
  findKeyUsage(key: string): string[] {
    this.ensureLoaded()
    const trimmed = key.trim()
    if (!trimmed) return []
    return Object.entries(this.keys)
      .filter(([, v]) => v.trim() === trimmed)
      .map(([k]) => k)
  }

  static readFileExists(file: string): boolean {
    return existsSync(file) && statSync(file).size > 0
  }
}
