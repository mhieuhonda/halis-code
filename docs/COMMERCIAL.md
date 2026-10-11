# Commercial summary — Halis Code

**Who buys this.** Software teams and solo developers who already pay for AI coding assistants and still lose hours to confident wrong answers — guessed library APIs, invented flags, hallucinated security claims. Anyone whose agent touches code that ships: startups without a review budget, agencies shipping client work, platform teams auditing dependencies. The secondary buyer is the swarm operator running autonomous agent teams overnight, where a wrong answer costs a broken build nobody watches.

**What it replaces.** The guess-then-debug loop. Today a developer asks an LLM, gets an invented answer, discovers it is wrong inside a compiler or a browser, re-prompts, and repeats — 10–30 minutes lost per incident, multiplied by every developer on the team. Where that shows up as a line item today: senior-engineer review time ($50–150/hour), security review contractors ($300–800 per audit hour, often booked days out), and per-seat assistant subscriptions ($10–30/user/month) that still hallucinate because nothing verifies them. Halis Code replaces *the unverified answer* with a purchased, ranked, on-chain-verifiable one — the same motion as paying for a static-analyzer license instead of trusting gut feel.

**What that costs today.** The verification the app buys costs about **$0.01 per question** on Telegraph's testnet (Base Sepolia; mainnet is the same contracts with real USDC). A developer buying 50 verified answers a week spends roughly **$2/month** — against the $10–30 assistant seat it runs inside and the $50–150/hour of human time it keeps off the debugging loop. The first wrong guess that reaches production costs more than a year of paid asks.

**Why a market beats an API.** Halis Code does not call any single vendor. It posts the question to the Telegraph Engine, which routes it to the highest-ranked miner for that intent — code review, security analysis, web research, LLM inference — and returns the answer with a receipt: who produced it, what they rank, what it cost, and the settlement transaction on-chain. If a miner degrades, the ranking routes around it. The app never has a vendor relationship to renegotiate; it has a price to watch.

**The wedge.** Halis Code is a working desktop coding agent first — files, shell, git, a 20-agent swarm with explicit addressing — so the paid intelligence lands in a real workflow, not a demo. The buy is one approval card among ordinary tools, priced before it moves, receipted after.

---

*Submission pointers: the testnet spend panel with its boundary line is the Telegraph tab; every settled request is listed with a click-through tx hash; the receipts ledger exports as JSON (`halis-telegraph-receipts-*.json`) so volume can be counted without opening the app.*
