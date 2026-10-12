---
name: ponytail-help
description: >
  Quick reference for ponytail levels, skills and triggers. One-shot
  display, changes no mode. Use for "ponytail help", "how do I use
  ponytail".
---

# Ponytail Help

Display this reference card when invoked. One-shot, do NOT change mode or
persist anything.

## Levels

| Level | Trigger | What changes |
|-------|---------|-------------|
| **Lite** | "ponytail lite" | Build what was asked, name the smaller option in one line. |
| **Full** | "ponytail" | The smallest complete change, a check where the logic needs one, and a reply that names skipped work and risks. Default. |
| **Ultra** | "ponytail ultra" | Also questions the request and pushes back before building. |

The level sticks for the conversation until changed, the user says "stop
ponytail", or the PonyTail toggle is turned off.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **ponytail** | "ponytail" | Lazy mode itself: least new code, clear replies that name skipped work and risks. |
| **ponytail-review** | "ponytail review" | Quality review of a diff: bugs, security, load, missing tests, speed, what to cut. |
| **ponytail-audit** | "ponytail audit" | The same quality review for the whole repo, ranked. |
| **ponytail-debt** | "ponytail debt" | Harvest `shortcut:` comments into a tracked ledger. |
| **ponytail-gain** | "ponytail gain" | Measured-impact scoreboard: less code, less cost, more speed. |
| **ponytail-help** | "ponytail help" | This card. |

## How it runs in Halis Code

These are not slash commands. The PonyTail toggle in Settings injects all
six skills' full text into the agent system prompt — when the toggle is on,
the rules above are already in force, and turning it off removes them
entirely (the hint mentions a restart so running turns pick it up).

## Deactivate

Turn off the PonyTail toggle in Settings, or say "stop ponytail" / "normal
mode". Resume anytime with the toggle or by saying "ponytail".

## More

Full docs + examples: https://github.com/DietrichGebert/ponytail
