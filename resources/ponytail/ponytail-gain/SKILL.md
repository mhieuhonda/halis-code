---
name: ponytail-gain
description: >
  Show ponytail's measured savings (code, cost, speed) from the benchmark.
  One-shot display, changes no mode. Use for "ponytail gain", "what does
  ponytail save", "ponytail impact".
---

# Ponytail Gain

Display this scoreboard when invoked. One-shot: do NOT change mode or write
anything.

These are the published agentic benchmark figures of Ponytail: a headless
coding agent on 39 tasks (feature tickets in a real FastAPI + React repo,
bug fixes, security cases, small apps), 5 runs each, against the same agent
without the skill; 18 tasks have hidden checks for correctness and safety.
Each figure is the geometric mean of per-task medians — measured, not
computed from the current repo.
Source: github.com/DietrichGebert/ponytail

## Scoreboard

Render plain ASCII bars. The bar shows ponytail as a share of the no-skill
baseline; the label carries the exact figure:

```
  ponytail gain           benchmark · 39 tasks × 5 runs

  no-skill        ████████████████████  100%
  Lines of code   █████████···········   47%   ▼ 53%
  Output tokens   ███████████·········   55%   ▼ 45%
  Cost            ███████████████·····   74%   ▼ 26%
  Time            ████████████········   59%   ▼ 41%
  Hidden checks passed   97%  (no-skill 96%)
  Tests where the logic needs one   98%  (no-skill 68%)

  This repo:  ponytail-debt  (shortcuts you deferred)
              ponytail-audit (what's still cuttable)
```

## Honesty boundary

Benchmark averages, not this repo. NEVER print a per-repo savings number
("you saved X lines here"): the unbuilt version was never written, so there
is no real baseline. The only real per-repo figures come from ponytail-debt
(a counted ledger) — point there instead of inventing one.
