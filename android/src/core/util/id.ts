/** Short unique ids (crypto.randomUUID, browser-native). */
export function newId(prefix = ''): string {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  return prefix ? `${prefix}_${id}` : id
}
