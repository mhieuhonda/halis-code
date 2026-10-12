---
name: ponytail-audit
description: >
  Quality audit of a whole repo: bugs, security holes, what breaks under real
  load, risky code without tests, slow paths, and what to delete, merge or
  split. Ranked, explained in plain English. One-shot report, changes
  nothing. Use for "audit this codebase", "review the whole repo",
  "find bloat", "ponytail audit".
---

Audit the whole repo like the senior developer who just inherited it and
will be paged when it breaks. Order of importance: correct, safe, holds
under load, tested, fast, lean. One-shot report, changes nothing.

## 1. Map first

- Audit what the user names: a folder, a package, or the whole repo.
  Nothing named: the whole repo.
- Read the README, build and deploy config, dependency list, entry points
  (main, routes, handlers, jobs, CLI commands) and the tests.
- Find the expected load — one person running a script, or many users and
  processes at once. Judge scale against that, and say which load you assumed.
- Trace the main flows end to end: where data comes in, what is stored, what
  goes out. Read fully: user input, money, auth, data writes, background
  jobs, anything shared between processes.
- Big repo: go deep where a mistake costs the most, not file by file. Say
  which parts you did not read.

## 2. Look for

1. **Bug:** wrong result, crash, missed edge case (empty, zero, last item,
   rounding, time zones), callers that disagree with what a function returns.
2. **Risk:** security holes (injection, weak randomness, secrets in code,
   unchecked user input), data loss (errors swallowed, writes in the wrong
   order, no transaction).
3. **Scale:** check-then-write races, the same work done by every process,
   lists that only grow, a query per item, per-process state that must be
   shared.
4. **Missing test:** risky logic (branch, parser, money, security, data
   writes) with no test that fails when it breaks.
5. **Speed:** big slowdowns are problems; small wins are suggestions.
6. **Lean:** code that should not exist or should be smaller —
   - delete: dead code, unused flags and config, speculative features
   - reuse: two helpers doing the same thing (keep one, name the path)
   - stdlib / native: the platform already does it
   - yagni: interface with one implementation, wrapper that only forwards
   - merge: near-copies that must change together
   - split: one function or class doing several unrelated jobs. Split by
     job, never by line count.

## 3. Check before you report

- Every finding needs a concrete case: no case, no finding.
- Before calling code unused, grep the whole tree — tests, fixtures, config,
  string references.
- A `shortcut:` comment naming its limit is a decision, not a finding —
  unless the expected load already crosses it.
- Propose the smallest fix that works. Prefer fixes that delete code.
- No style taste, no "consider", no vague worries.

## 4. Output

Very simple English. Start with `What this repo does:` in two or three
sentences, plus the load you assumed. Then findings in three groups, most
important first, skip empty groups:

- **Must fix:** bug, security, data loss, breaks at the expected load.
- **Should fix:** risky code without a test, real slowness, duplication,
  code that should not exist.
- **Nice to have:** small speed-ups, shorter forms.

Number findings across all groups; at most 20, and say how many smaller ones
you left out. Each finding: a bold title with `file:line`, then **What this
is**, **Problem**, **Fix** (smallest one), **If we skip it**.

End with `Verdict:` one line, `Lean: -<N> lines, -<M> dependencies possible.`
when lean findings exist, and `Not checked:` the parts you did not read.

Nothing found: `What this repo does:`, then `Healthy. Nothing to fix.` and
one line on what you checked.
