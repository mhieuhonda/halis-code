---
name: ponytail-help
description: >
  Quick reference for ponytail levels, skills and triggers. One-shot display.
  Use for "ponytail help", "how do I use ponytail".
---

# Ponytail Help

Display this reference card when invoked. One-shot, do NOT change mode,
write flag files, or persist anything.

## Levels

| Level | Trigger | What change |
|-------|---------|-------------|
| **Lite** | "ponytail lite" | Build what was asked, name the smaller option in one line. |
| **Full** | "ponytail" | The smallest complete change, a check where the logic needs one, and a reply that names what was skipped and any risk. Default. |
| **Ultra** | "ponytail ultra" | Also questions the request and pushes back before building. |

Level sticks until changed, the user says "stop ponytail", or the PonyTail toggle is turned off.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **ponytail** | "ponytail" | Lazy mode itself: least new code, clear replies that name skipped work and risks. |
| **ponytail-review** | "ponytail review" | Quality review of a diff: bugs, security, load, missing tests, speed, what to cut. Each finding says what goes wrong and how to fix it. |
| **ponytail-audit** | "ponytail audit" | The same quality review for the whole repo, ranked. |
| **ponytail-debt** | "ponytail debt" | Harvest `shortcut:` comments into a tracked ledger. |
| **ponytail-gain** | "ponytail gain" | Measured-impact scoreboard: less code, less cost, more speed. |
| **ponytail-help** | "ponytail help" | This card. |

In Halis Code these six skills are not slash commands: the PonyTail toggle in
Settings injects their full text into the agent system prompt. There is
nothing to invoke — when the toggle is on, the rules above are already in
force.

## Deactivate

Turn off the PonyTail toggle in Settings, or say "stop ponytail" / "normal
mode". Resume anytime with the toggle or by saying "ponytail".

## More

Full docs + examples: https://github.com/DietrichGebert/ponytail
