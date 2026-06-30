---
description: Runs the full development pipeline from an existing Jira ticket. Orchestrates spock → kirk → skinner → leela → bender → smithers, using the ticket's acceptance criteria as the contract. Run /create-ticket first to produce the ticket.
argument-hint: "[TICKET-ID]"
---

# execute-task

Run the full development pipeline for an existing Jira ticket.

## Usage

```
/assistant:execute-task DEV-12
```

---

## 1. PURPOSE & INPUT

The ticket identifier is: **$ARGUMENTS**

If `$ARGUMENTS` is empty, ask the user to supply a Jira ticket identifier before proceeding.

---

## 2. FETCH TICKET FROM JIRA

Using the connected Atlassian Jira MCP tools available on the main thread, fetch the live ticket for `$ARGUMENTS`. Extract:

- **Title** (summary field)
- **Description** (full body)
- **Acceptance criteria** — locate the Gherkin scenarios in the description. These are the contract for the entire pipeline. Do not use any earlier draft or local copy — always read the live ticket.

If the Atlassian MCP is not available, stop immediately and tell the user:
> `/execute-task` requires a live Jira connection via the Atlassian MCP. Please configure the MCP or paste the ticket content manually and rerun.

---

## 3. SETUP

Before invoking any agent:

1. Derive a branch name from the ticket id: lowercase it and prefix with `feature/` (e.g. `DEV-12` → `feature/dev-12`).
2. If the branch already exists locally, check it out. Otherwise create it from the current default branch and check it out.
3. Report the branch name to the user before continuing.

---

## 4. PIPELINE

Invoke each agent via the Task tool in the order below. Pass the captured outputs forward explicitly — agents do not share memory.

---

### Stage A — Spock: Implementation planning

Invoke the `spock` agent with:
- The ticket title, description, and full acceptance criteria fetched in step 2.
- Instruction to read the project's `CLAUDE.md`, explore the repository, and produce an ordered implementation plan with each acceptance criterion mapped to concrete steps.

Spock does **not** need to contact Jira — provide the ticket content directly.

**CAPTURE:**
- The acceptance criteria (verbatim from the fetched ticket — this is the contract).
- The implementation plan.

---

### Stage B — Kirk: Implementation

Invoke the `kirk` agent with:
- The acceptance criteria (from Stage A).
- The implementation plan (from Stage A).

Kirk writes all code changes required to satisfy the acceptance criteria.

**CAPTURE:**
- The complete list of files kirk created or modified (needed by skinner, which is read-only and cannot discover changes on its own).
- A summary of the changes made.

---

### Stage C — Skinner: Code review

Invoke the `skinner` agent with:
- The acceptance criteria (from Stage A).
- The implementation plan (from Stage A).
- The list of changed files (from the most recent Stage B run).
- Kirk's change summary (from the most recent Stage B run).

The first output line from Skinner must be one of:
- `VERDICT: PASS`
- `VERDICT: CHANGES REQUESTED`

**If `VERDICT: CHANGES REQUESTED`:**
- Hand Skinner's findings back to Kirk (Stage B), along with all previous context.
- Re-run Stage C (Skinner) after Kirk responds.
- This loop counts against the global retry cap (see Section 5).

---

### Stage D — Leela: Test authoring

Invoke the `leela` agent with:
- The acceptance criteria (from Stage A — the criteria are the source of truth, NOT Kirk's implementation).
- Kirk's final change summary (from the last Stage B run).

Leela writes tests derived from the acceptance criteria. She does not run the suite.

---

### Stage E — Bender: Quality gate

Invoke the `bender` agent.

Bender discovers and runs the project's configured lint, static-analysis, and test commands. It saves all output as evidence and returns `PASS` or `FAIL`.

**If `FAIL`:**
- Hand Bender's error evidence and the failing output back to Kirk (Stage B), along with all previous context.
- Re-run Stage C (Skinner), Stage D (Leela), and Stage E (Bender) in order, since the code changed.
- This loop counts against the global retry cap (see Section 5).

---

### Stage F — Smithers: PR publication

Invoke the `smithers` agent **only after both Stage C returns `VERDICT: PASS` and Stage E returns `PASS`**.

Provide:
- The ticket identifier.
- The branch name (from Section 3).
- The acceptance criteria (from Stage A).
- Kirk's final change summary.
- Bender's evidence file path.

Smithers commits all staged changes, pushes the `feature/<TICKET-ID>` branch, and opens a pull request via `gh`. He returns the PR URL and branch name.

**CAPTURE:** the PR URL from Smithers.

---

### Stage G — Jira transition

After Smithers returns a PR URL, using the connected Atlassian Jira MCP tools on the main thread:

1. Look up the valid workflow transitions for `$ARGUMENTS`.
2. Select the transition whose name most closely matches "Revision" (case-insensitive; exact match preferred).
3. Apply that transition to the issue.

If the transition succeeds, record the result. If the Atlassian MCP is unavailable at this point, print:
```
[Jira transition skipped — Atlassian MCP not available]
Would transition: $ARGUMENTS → "Revision"
```

---

## 5. CORRECTION LOOPS & RETRY CAP

Both correction loops (Skinner → Kirk and Bender → Kirk) share a **maximum of 3 correction attempts total** across the entire pipeline run.

If the pipeline is still not passing after the 3rd attempt:
- **Do not open a PR.**
- Stop and report to the user:
  - Which stage is failing and why.
  - The latest Skinner findings or Bender evidence.
  - The list of files involved.
  - A recommendation for manual intervention.

---

## 6. PROGRESS REPORTING

Announce each stage as you invoke it. After each agent returns, report its verdict or outcome in one line before continuing.

**Final summary (after Stage G or on hard stop):**

```
Ticket:      $ARGUMENTS
Branch:      feature/<ticket-id>
Implemented: <one-line summary of changes>
Review:      PASS / CHANGES REQUESTED (N iterations)
Gate:        PASS / FAIL (N iterations)
PR:          <URL or "not opened">
Jira:        transitioned to "Revision" | [skipped]
```
