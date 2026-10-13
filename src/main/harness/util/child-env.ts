/**
 * Shared child-process environment: credential-shaped env vars (API keys,
 * tokens, passwords) never reach spawned children — not even git, whose
 * hooks run arbitrary repo code with the inherited environment.
 */
const SENSITIVE_ENV = /KEY|PASSWORD|SECRET|TOKEN|PASSWD|PRIVATE|CREDENTIALS|COOKIE/i

export function scrubbedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (SENSITIVE_ENV.test(key) && !key.startsWith('HALIS_')) continue
    out[key] = value
  }
  Object.assign(out, extra)
  return out
}
