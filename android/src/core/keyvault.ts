/**
 * Key vault — mobile edition. Provider keys and the Telegraph burner key
 * live in app-private IndexedDB, AES-GCM encrypted with a device key kept
 * in native Preferences (Capacitor). Nothing ever leaves the device.
 */

import { kvGet, kvSet, kvDelete } from './storage'

const DEVICE_KEY = 'vault:device-key'
const KEY_PREFIX = 'vault:key:'

/* ------------------------------------------------------------------ */
/* AES-GCM helpers (WebCrypto)                                        */
/* ------------------------------------------------------------------ */

async function deviceKey(): Promise<CryptoKey | null> {
  try {
    let rawB64 = (await kvGet<string | null>(DEVICE_KEY, null)) as string | null
    if (!rawB64) {
      const raw = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)))
      rawB64 = bytesToBase64(raw)
      await kvSet(DEVICE_KEY, rawB64)
    }
    const raw = base64ToBytes(rawB64)
    return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
  } catch {
    return null
  }
}

export function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function encryptString(plain: string): Promise<string> {
  const key = await deviceKey()
  if (!key) return plain
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)))
  const data = new TextEncoder().encode(plain)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource)
  return `enc1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`
}

async function decryptString(blob: string): Promise<string> {
  if (!blob.startsWith('enc1:')) return blob
  const key = await deviceKey()
  if (!key) throw new Error('vault: device key unavailable')
  const [, ivB64, dataB64] = blob.split(':')
  const iv = base64ToBytes(ivB64!)
  const data = base64ToBytes(dataB64!)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data as BufferSource)
  return new TextDecoder().decode(plain)
}

/* ------------------------------------------------------------------ */
/* Vault                                                              */
/* ------------------------------------------------------------------ */

export class KeyVault {
  private keys = new Map<string, string>()

  async load(): Promise<void> {
    if (this.keys.size) return
    try {
      const entries = await kvGet<Array<[string, string]>>('vault:entries', [])
      for (const [id, blob] of entries) {
        try {
          this.keys.set(id, await decryptString(blob))
        } catch {
          /* undecryptable (device key rotated) — drop the entry */
        }
      }
    } catch {
      /* start empty */
    }
  }

  private async persist(): Promise<void> {
    const entries: Array<[string, string]> = []
    for (const [id, value] of this.keys) entries.push([id, await encryptString(value)])
    await kvSet('vault:entries', entries)
  }

  async get(providerId: string): Promise<string | undefined> {
    await this.load()
    return this.keys.get(providerId)?.trim() || undefined
  }

  async has(providerId: string): Promise<boolean> {
    return !!(await this.get(providerId))
  }

  async set(providerId: string, key: string): Promise<void> {
    await this.load()
    this.keys.set(providerId, key.trim())
    await this.persist()
  }

  async remove(providerId: string): Promise<void> {
    await this.load()
    this.keys.delete(providerId)
    await this.persist()
  }

  async deleteAll(): Promise<void> {
    this.keys.clear()
    await kvDelete('vault:entries')
  }

  /** Masked preview for the UI: sk-…4f2a */
  async preview(providerId: string): Promise<string | undefined> {
    const key = await this.get(providerId)
    if (!key) return undefined
    if (key.length <= 8) return '••••'
    return `${key.slice(0, 4)}…${key.slice(-4)}`
  }

  async statusAll(): Promise<Record<string, boolean>> {
    await this.load()
    const out: Record<string, boolean> = {}
    for (const [k, v] of this.keys) out[k] = !!v.trim()
    return out
  }

  /** Which provider ids use the given key (duplicate-key rule). */
  async findKeyUsage(key: string): Promise<string[]> {
    await this.load()
    const trimmed = key.trim()
    if (!trimmed) return []
    return [...this.keys.entries()].filter(([, v]) => v.trim() === trimmed).map(([k]) => k)
  }
}
