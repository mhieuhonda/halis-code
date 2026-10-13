import { describe, expect, it } from 'vitest'
import { applyPatch, deriveState, parsePatch } from '../src/main/harness/util/patch'

describe('parsePatch', () => {
  it('parses add / update / delete sections', () => {
    const patch = `*** Begin Patch
*** Add File: new.txt
+hello
+world
*** Update File: src/app.ts
@@ old line
-old line
+new line
*** Delete File: gone.txt
*** End Patch`
    const { sections, errors } = parsePatch(patch)
    expect(errors).toEqual([])
    expect(sections).toHaveLength(3)
    expect(sections[0]).toEqual({ type: 'add', path: 'new.txt', content: 'hello\nworld\n' })
    expect(sections[1]?.type).toBe('update')
    if (sections[1]?.type === 'update') {
      expect(sections[1].chunks[0]!.oldLines).toEqual(['old line'])
      expect(sections[1].chunks[0]!.newLines).toEqual(['new line'])
    }
    expect(sections[2]).toEqual({ type: 'delete', path: 'gone.txt' })
  })

  it('parses Move to and End of File anchor', () => {
    const patch = `*** Begin Patch
*** Update File: a.ts
*** Move to: b.ts
@@ last
-old tail
+new tail
*** End of File
*** End Patch`
    const { sections, errors } = parsePatch(patch)
    expect(errors).toEqual([])
    if (sections[0]?.type === 'update') {
      expect(sections[0].moveTo).toBe('b.ts')
      expect(sections[0].chunks[0]!.isEndOfFile).toBe(true)
    } else throw new Error('expected update section')
  })

  it('strips a shell heredoc wrapper', () => {
    const patch = `cat <<'EOF'\n*** Begin Patch\n*** Add File: x.txt\n+hi\n*** End Patch\nEOF`
    const { sections } = parsePatch(patch)
    expect(sections).toHaveLength(1)
  })
})

describe('deriveState fuzzy matching', () => {
  const lines = ['function main() {', '  const x = 1  ', '  return x', '}']
  it('matches exactly', () => {
    expect(deriveState(lines, ['  const x = 1  ', '  return x'], false)).toBe(1)
  })
  it('matches with rstrip tolerance', () => {
    expect(deriveState(lines, ['  const x = 1', '  return x'], false)).toBe(1)
  })
  it('matches with trim tolerance', () => {
    expect(deriveState(lines, ['const x = 1', 'return x'], false)).toBe(1)
  })
  it('returns -1 when nothing matches', () => {
    expect(deriveState(lines, ['nope'], false)).toBe(-1)
  })
  it('anchors at end of file', () => {
    expect(deriveState(lines, ['  return x', '}'], true)).toBe(2)
  })
})

describe('applyPatch', () => {
  const makeFs = (files: Record<string, string>) => {
    const store = new Map(Object.entries(files))
    return {
      store,
      read: (path: string) => ({ exists: store.has(path), content: store.get(path) ?? '' }),
      write: (path: string, content: string | null) => {
        if (content === null) store.delete(path)
        else store.set(path, content)
      },
    }
  }

  it('adds, updates and deletes files', () => {
    const fs = makeFs({ 'a.ts': 'one\ntwo\nthree\n', 'b.ts': 'bye\n' })
    const { sections } = parsePatch(`*** Begin Patch
*** Add File: c.txt
+fresh
*** Update File: a.ts
@@
-two
+deux
*** Delete File: b.ts
*** End Patch`)
    const result = applyPatch({ sections, read: fs.read, write: fs.write })
    expect(result.success).toBe(true)
    expect(fs.store.get('a.ts')).toBe('one\ndeux\nthree\n')
    expect(fs.store.get('c.txt')).toBe('fresh\n')
    expect(fs.store.has('b.ts')).toBe(false)
  })

  it('fails with a clear message when context is missing, leaving earlier files changed', () => {
    const fs = makeFs({ 'a.ts': 'one\n' })
    const { sections } = parsePatch(`*** Begin Patch
*** Add File: ok.txt
+fine
*** Update File: a.ts
@@
-does-not-exist
+nope
*** End Patch`)
    const result = applyPatch({ sections, read: fs.read, write: fs.write })
    expect(result.success).toBe(false)
    expect(result.failedPath).toBe('a.ts')
    expect(fs.store.get('ok.txt')).toBe('fine\n')
    expect(result.output).toContain('Completed before failure')
  })

  it('supports Move to rename', () => {
    const fs = makeFs({ 'old.ts': 'content\n' })
    const { sections } = parsePatch(`*** Begin Patch
*** Update File: old.ts
*** Move to: new.ts
@@
-content
+renamed
*** End Patch`)
    const result = applyPatch({ sections, read: fs.read, write: fs.write })
    expect(result.success).toBe(true)
    expect(fs.store.has('old.ts')).toBe(false)
    expect(fs.store.get('new.ts')).toBe('renamed\n')
  })

  it('refuses to overwrite an existing file via Add File', () => {
    const fs = makeFs({ 'exists.txt': 'x' })
    const { sections } = parsePatch(`*** Begin Patch
*** Add File: exists.txt
+x
*** End Patch`)
    const result = applyPatch({ sections, read: fs.read, write: fs.write })
    expect(result.success).toBe(false)
    expect(result.output).toContain('already exists')
  })

  it('preserves per-line endings in a mixed CRLF/LF file', () => {
    // Lines untouched by the patch must keep their own endings — collapsing
    // to the majority ending would show the whole file as changed to git.
    const mixed = 'one\r\ntwo\nthree\r\nfour\n'
    const fs = makeFs({ 'mix.txt': mixed })
    const { sections } = parsePatch(`*** Begin Patch
*** Update File: mix.txt
@@
-three
+THREE
*** End Patch`)
    const result = applyPatch({ sections, read: fs.read, write: fs.write })
    expect(result.success).toBe(true)
    expect(fs.store.get('mix.txt')).toBe('one\r\ntwo\nTHREE\r\nfour\n')
  })

  it('keeps multi-line replacements separated on a newline-less EOF line', () => {
    const fs = makeFs({ 'eof.txt': 'last' })
    const { sections } = parsePatch(`*** Begin Patch
*** Update File: eof.txt
@@ last
-last
+first
+second
*** End of File
*** End Patch`)
    const result = applyPatch({ sections, read: fs.read, write: fs.write })
    expect(result.success).toBe(true)
    expect(fs.store.get('eof.txt')).toBe('first\nsecond')
  })

  it('appends at end-of-file without fusing onto a newline-less last line', () => {
    const fs = makeFs({ 'tail.txt': 'kept\nlast' })
    const { sections } = parsePatch(`*** Begin Patch
*** Update File: tail.txt
@@
+appended
*** End of File
*** End Patch`)
    const result = applyPatch({ sections, read: fs.read, write: fs.write })
    expect(result.success).toBe(true)
    expect(fs.store.get('tail.txt')).toBe('kept\nlast\nappended')
  })
})
