import { randomUUID } from 'node:crypto'

export function newId(prefix = ''): string {
  const id = randomUUID().replace(/-/g, '').slice(0, 16)
  return prefix ? `${prefix}_${id}` : id
}
