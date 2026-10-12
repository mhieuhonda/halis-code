---
name: ponytail-review
description: >
  Quality review of a change: is the logic right, is it safe, does it hold
  under real load, is risky code tested, is it fast enough, and is every line
  needed. Reads the connected code, not only the diff. Use for "review this",
  "code review", "review the last commit", "is this over-engineered",
  "ponytail review".
---

Review a change like the senior developer who will be paged when it breaks.
Order of importance: correct, safe, holds under load, tested, fast, lean.
This is a report the user asked for, so give it in full.

## 1. Understand first

- Review what the user names: uncommitted changes, a branch, a PR, or files.
  Nothing named: the uncommitted changes, or the last commit if there are none.
- Read the diff, then the code it touches: callers of every changed function,
  the functions it calls, the tests, the README.
- A change can break code it does not touch: when a signature, return value
  or behavior changes, grep every caller.
- Find the expected load in the repo (README, deploy config): one person
  running a script, or many users at once. Judge scale against that.

## 2. Look for

1. **Bug:** wrong result, crash, missed edge case (empty, zero, last item,
   rounding, time zones), a caller broken by the change.
2. **Risk:** security holes (injection, weak randomness, secrets, unchecked
   user input), data loss (errors swallowed, writes in the wrong order).
3. **Scale:** fine for one user, wrong for many: check-then-write races,
   lists that only grow, a query per item, O(n^2) on big input.
4. **Missing test:** risky new logic with no test that fails when it breaks.
   One good test, not coverage.
5. **Speed:** big slowdowns are problems; small wins are suggestions.
6. **Lean:** code that should not exist or should be smaller —
   - delete: dead code, unused options, speculative features
   - reuse: the repo already has this helper (name the path)
   - stdlib / native: the platform already does it
   - yagni: abstraction with one implementation, config nobody sets
   - merge: near-copies that must change together
   - split: one function doing several unrelated jobs. Split by job, never
     by line count.

## 3. Check before you report

- Every finding needs a concrete case: "this input leads to this wrong
  result". No case, no finding.
- Re-read the lines and confirm: the caller exists, the value can really be
  empty, the code really is unused.
- A `shortcut:` comment naming its limit is a decision, not a finding —
  unless the expected load already crosses it.
- Propose the smallest fix that works. Prefer fixes that delete code.
- No style taste, no "consider", no vague worries.

## 4. Output

Very simple English, short sentences. Start with `What this change does:` in
two or three sentences. Then findings in three groups, skip empty groups:

- **Must fix:** bug, security, data loss, breaks at the expected load.
- **Should fix:** risky code without a test, real slowness, duplication,
  code that should not exist.
- **Nice to have:** small speed-ups, shorter forms.

Number findings across all groups, so the user can say "fix 2 and 5". Each
finding: a bold title with `file:line`, then **What this is**, **Problem**,
**Fix** (smallest one), **If we skip it** — one or two short sentences each.

End with `Verdict: Ship.` or `Verdict: fix 1 and 3 first.`, plus `Lean:
-<N> lines possible.` when lean findings exist, and `Not checked:` one line
if something mattered and you could not check it.

Nothing found: `What this change does:`, then `Looks good. Ship.` and one
line on what you checked.

Lists findings, changes no code.
