# AGENTS.md — Behind the Scenes

This document covers the design rationale for each agent: why this character, why this tool set, and how the pipeline was shaped by real-world experience.

---

## Full casting table

| Agent file | Character | Why this character |
|---|---|---|
| `agents/lisa.md` | **Lisa** (Simpson) | Lisa is the most principled, methodical member of any group — she does the homework others skip. A ticket author who produces rigorous Gherkin criteria before a single line of code is written is exactly that person. |
| `agents/spock.md` | **Spock** (Star Trek) | Pure logic, zero assumption. Spock reads the evidence (the repo, the CLAUDE.md), builds a plan grounded only in what he observes, and explicitly flags what he doesn't know. No guessing. |
| `agents/kirk.md` | **Kirk** (Star Trek) | Decisive, action-oriented, gets the job done under pressure. Kirk takes the plan and executes — quickly, pragmatically, without over-engineering. |
| `agents/skinner.md` | **Skinner** (The Simpsons / Pavlov) | Seymour Skinner has a critical eye and never misses a rule violation. He reviews without sympathy but without malice — he reports what he sees and leaves it to others to fix. |
| `agents/leela.md` | **Leela** (Futurama) | Capable, disciplined, and covers every angle. Leela writes tests that leave nothing untested — every scenario from the acceptance criteria gets a corresponding test case. |
| `agents/bender.md` | **Bender** (Futurama) | Bender does exactly what he's told, no more, no less, with no regard for feelings. The quality gate is not a place for opinions — it runs the commands, captures the output, and says PASS or FAIL. Bender embodies that perfectly. |
| `agents/smithers.md` | **Smithers** (The Simpsons) | Efficient, loyal, makes things happen. Smithers is the last agent in the pipeline — he commits, pushes, opens the PR, and updates the ticket status without drama. |
| `agents/martin.md` | **Martin** (The Simpsons / Fowler) | Martin Prince is attentive, eager to address every comment, and thorough. Martin the agent reads every human review comment and addresses each one — no comment left behind. |

---

## Model routing rationale

| Model | Agents | Why |
|---|---|---|
| `claude-sonnet-4-6` | lisa, spock, kirk, skinner, leela, martin | These agents must reason about code, understand context, and make non-trivial judgments. Sonnet is the right balance of capability and cost. |
| `claude-haiku-4-5-20251001` | bender, smithers | These agents are purely mechanical: run a shell command, capture output, commit, push. No reasoning required — Haiku is fast and cheap. |

---

## The acceptance-criteria contract

The pipeline's key architectural decision is that **Lisa's Gherkin output is the shared contract**:

```
lisa (writes criteria)
  → spock (plans against criteria)
  → kirk (implements to satisfy criteria)
  → skinner (verifies criteria are met correctly)
  → leela (derives tests FROM criteria)
  → bender (runs tests that prove criteria)
  → smithers (ships the evidence)
```

This means no agent needs to re-derive intent. Each agent receives the same criteria and interprets them for its role.

---

## Origin story (illustrative)

This pipeline grew from hands-on experience building compliance-heavy systems — think notice generation, authentication flows, and risk-evaluation engines in Laravel applications — where:

- Vague implementation briefs led to tickets missing edge cases.
- Code review was a bottleneck with no structured feedback loop.
- Tests were written after the fact, from memory, not from spec.
- PR publication was manual and error-prone.

The pipeline addresses each of these pain points in order. The character names were chosen as a mnemonic during the first team walkthrough and stuck.

**This is an example use case.** The plugin itself contains no references to any specific domain, framework, or business logic. All such detail belongs in the consuming project's `CLAUDE.md`.

---

## Tool set rationale

| Agent | Tools | Why |
|---|---|---|
| lisa | Read, Grep, Glob | Needs to read the brief; no writes needed |
| spock | Read, Grep, Glob | Read-only by design; must not touch the repo |
| kirk | Read, Write, Edit, Bash, Grep, Glob | Full implementation access; Bash for running generators or checking output |
| skinner | Read, Grep, Glob | Read-only by design; must not touch the repo |
| leela | Read, Write, Edit, Grep, Glob | Writes test files; no Bash (does not run tests) |
| bender | Bash, Read | Needs shell access to run commands; Read to discover config |
| smithers | Bash, Read | Shell access for git and gh; Read for commit message content |
| martin | Bash, Read, Write, Edit, Grep, Glob | Needs gh to read comments; full edit access to implement fixes |
