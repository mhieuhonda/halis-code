---
name: ponytail-debt
description: >
  List every `shortcut:` comment as a debt ledger: what was simplified, its
  ceiling, and the trigger to revisit. One-shot report, changes nothing.
  Use for "ponytail debt", "what did ponytail defer", "list the shortcuts".
---

Every deliberate ponytail shortcut is marked with a `shortcut:` comment
naming its ceiling and upgrade path. This collects them into one ledger so a
deferral can't quietly become permanent. One-shot: report only.

## Scan

Grep the repo for the marker, skipping `node_modules`, `.git` and build
output. Use the `grep` tool with pattern
`(#|//|/\*)\s*(shortcut|ponytail):`, or run the equivalent `grep -rnE` with
`run_command`. The comment prefix keeps prose that merely mentions the
convention out of the ledger; skip hits that are not a deferral (a keyboard
shortcut, for example).

If the user names their own marker word, grep for that word instead.

## Output

One row per marker, grouped by file:

`<file>:<line>, <what was simplified>. ceiling: <the limit>. upgrade: <the trigger>.`

Pull the ceiling and trigger straight from the comment — the convention is
`shortcut: <ceiling>, <upgrade path>`. Flag rot risk: a marker naming no
upgrade path gets a `no-trigger` tag; those silently rot.

End with `<N> markers, <M> with no trigger.` Nothing found: `No shortcut
debt. Clean ledger.`

## Boundaries

Reads and reports only, changes nothing. To persist it, ask first, then
write the ledger to a file (e.g. `PONYTAIL-DEBT.md`). One-shot.
