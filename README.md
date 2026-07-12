# assistant

A Claude Code plugin that packages a **multi-agent, ticket-to-PR development pipeline**. Give it an implementation brief; it produces a Jira ticket, writes the code, reviews it, tests it, gates it, and opens the PR — fully automated and driven by a single shared contract: the acceptance criteria.

---

## What it does

```
brief.md                       existing Jira ticket (from a teammate / another AI)
   │                                    │
   ▼                                    ▼
[lisa]      Writes a new ticket    [hermes]   Normalizes it into the same
   │         with Gherkin AC          │        Gherkin format lisa produces
   └──────────────┬───────────────────┘
                   ▼
[spock]     Explores the repo + CLAUDE.md → produces an implementation plan
   │         → Jira ticket transitions to "En curso" once work begins
   ▼
[kirk]      Writes the code following the plan
   │
   ▼
[skinner]   Reviews the diff (correctness, security, architecture)
   │         ↩ loops back to kirk if CRITICAL/MAJOR findings
   ▼
[leela]     Writes tests derived from the acceptance criteria
   │
   ▼
[bender]    Runs all configured quality commands, saves evidence, returns PASS/FAIL
   │         ↩ loops back to kirk if FAIL
   ▼
[smithers]  Commits, pushes, opens the PR, transitions the Jira ticket
```

The Gherkin acceptance criteria produced by **Lisa** (or normalized by **Hermes**, for tickets someone else already wrote) are the **contract** that flows through the whole pipeline: Spock plans against them, Kirk codes to them, Leela derives tests from them, and Bender's gate verifies them.

---

## Install

```bash
# From the Claude Code marketplace (once published):
/plugin marketplace add jmeleciocp/assistant
/plugin install assistant@assistant-dev

# For local development / testing:
/plugin install ./
```

Commands are namespaced under `assistant`:

| Command | Description |
|---|---|
| `/assistant:create-task [path-to-brief]` | Run the full pipeline on an implementation brief |
| `/assistant:normalize-ticket [TICKET-ID]` | Rewrite a ticket someone else already filed into Gherkin format, then stop for human review |
| `/assistant:pr-review [pr-number]` | Address human review comments on an open PR |

---

## Requirements

- [Claude Code](https://claude.ai/code) installed.
- `git` and `gh` (GitHub CLI) authenticated in your shell.
- A `CLAUDE.md` in your project describing its conventions, commands, and constraints — the agents read this to stay project-agnostic.
- (Optional) Atlassian MCP integration for automatic Jira ticket creation and status transitions.

---

## Casting table

| Agent | Character | Role |
|---|---|---|
| `lisa` | Lisa | Ticket author — reads the brief and writes the specification |
| `hermes` | Hermes | Ticket compliance officer — normalizes tickets written by someone else into the pipeline's Gherkin format |
| `spock` | Spock | Planner — explores the repo and produces a logical implementation plan |
| `kirk` | Kirk | Implementer — writes the code |
| `skinner` | Skinner | Reviewer — inspects the diff for issues, never edits |
| `leela` | Leela | Test author — writes tests from the acceptance criteria |
| `bender` | Bender | Quality gate — runs commands, returns hard PASS/FAIL, no opinions |
| `smithers` | Smithers | PR publisher — commits, pushes, opens PR, transitions ticket |
| `martin` | Martin | PR comment responder — reads human review comments and addresses them |

---

## Why these character names?

Each character is a mnemonic for their role's personality:

- **Lisa** — methodical, principled, writes things down properly.
- **Hermes** — a bureaucrat's bureaucrat; nothing passes through improperly filed, and he never touches what he can't verify.
- **Spock** — pure logic, evidence-based, never guesses.
- **Kirk** — decisive, gets things done, moves fast.
- **Skinner** — critical eye, sees what others miss, reports without fixing.
- **Leela** — thorough, disciplined, covers every scenario.
- **Bender** — executes without opinion or judgment. PASS or FAIL, nothing else.
- **Smithers** — efficient, loyal, makes things happen on behalf of the team.
- **Martin** — attentive, responsive, addresses every concern.

---

## Project-specific configuration

This plugin is intentionally generic. All project-specific rules — frameworks, domain terms, coding standards, test infrastructure — belong in your project's `CLAUDE.md`. The agents read it automatically. Nothing domain-specific lives in this plugin.

---

## License

MIT © 2026 José Melecio
