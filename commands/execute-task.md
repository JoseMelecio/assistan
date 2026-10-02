---
description: Runs the full development pipeline from an existing Jira ticket. Orchestrates spock → kirk → skinner → leela → bender → smithers (or a fast lane without spock for small, already-diagnosed bugs), using the ticket's acceptance criteria as the contract. Run /create-ticket first to produce the ticket.
argument-hint: "[--fast|--full] [TICKET-ID]"
---

# execute-task

Run the full development pipeline for an existing Jira ticket.

## Usage

```
/assistant:execute-task DEV-12            # lane chosen automatically (Section 4b)
/assistant:execute-task --fast DEV-12     # force the fast lane
/assistant:execute-task --full DEV-12     # force the full lane
```

Each run works in its own isolated `git worktree` (see Section 4), so it's safe to invoke this command for several tickets back to back or in parallel — each pipeline gets its own directory and branch and cannot clobber another run's files or checked-out branch.

---

## 1. PURPOSE & INPUT

Parse `$ARGUMENTS` before doing anything else:

- An optional lane flag, `--fast` or `--full` (see Section 4b). Remove it from the text.
- The remaining text is the ticket identifier — call it **TICKET_ID** (e.g. `DEV-12`). Every later reference to `TICKET_ID` means this value, never the raw arguments.

If no ticket identifier remains, ask the user to supply one before proceeding.

---

## 2. VALIDATE PROJECT KEY

Before fetching anything from Jira, check whether this repo restricts which Jira project it accepts:

1. Read the project's `CLAUDE.md` and look for a line that declares the Jira project (e.g. `Jira project key: MM`, `jira_project: MM`, or similar wording).
2. If no such line exists, this repo is unrestricted — skip validation and continue to Section 3.
3. If a project key **is** declared, extract the project prefix from `TICKET_ID` (the text before the first `-`, e.g. `MM-42` → `MM`).
4. Compare the two case-insensitively.
   - **Match** — continue to Section 3.
   - **No match** — stop immediately, do not contact Jira, and tell the user:
     > This repo is restricted to Jira project `<declared-key>` (per `CLAUDE.md`). `TICKET_ID` belongs to a different project and will not be processed. Re-run with a `<declared-key>-*` ticket.

---

## 3. FETCH TICKET FROM JIRA

Using the connected Atlassian Jira MCP tools available on the main thread, fetch the live ticket for `TICKET_ID`. Extract:

- **Title** (summary field)
- **Description** (full body)
- **Acceptance criteria** — locate the Gherkin scenarios in the description. These are the contract for the entire pipeline. Do not use any earlier draft or local copy — always read the live ticket.

If the Atlassian MCP is not available, stop immediately and tell the user:
> `/execute-task` requires a live Jira connection via the Atlassian MCP. Please configure the MCP or paste the ticket content manually and rerun.

---

## 4. SETUP

Before invoking any agent:

1. **Determine the base branch** in this priority order:
   a. Read the project's `CLAUDE.md` and look for a line that declares the base branch (e.g. `Base branch: development`, `base_branch: development`, or similar). Extract the value.
   b. If not declared in `CLAUDE.md`, default to `development`.
   Store this value as the **base branch** — every feature branch is cut from it, and every PR targets it.

2. From the current checkout (the directory the command was invoked in), make sure the base branch actually exists and is current:
   ```
   git fetch origin
   ```
   - If `<base-branch>` exists locally: `git checkout <base-branch> && git pull origin <base-branch>`.
   - If `<base-branch>` does not exist locally but exists on `origin`: `git checkout -b <base-branch> origin/<base-branch>`.
   - If `<base-branch>` does not exist locally **nor** on `origin`: **stop** and ask the user whether to create it (and from what starting point) or whether the base-branch configuration is wrong. Never silently invent a base branch — a wrong guess here means every feature branch and PR targets the wrong place.

3. Derive a feature branch name from the ticket id: lowercase it and prefix with `feature/` (e.g. `DEV-12` → `feature/dev-12`).

4. **Create an isolated git worktree for this ticket**, instead of checking the feature branch out in the current directory. This keeps the current checkout untouched (still sitting on the base branch) and lets multiple tickets be worked **in parallel** without one pipeline's checkout stepping on another's:
   ```
   git worktree add ../<repo-folder-name>-<feature-branch-slug> -b <feature-branch> <base-branch>
   ```
   - `<repo-folder-name>` is the name of the current repository directory.
   - `<feature-branch-slug>` is the feature branch name with every `/` replaced by `-` (e.g. `feature/dev-12` → `feature-dev-12`), so the sibling directory name is filesystem-safe.
   - If the feature branch already exists (a previous run on this ticket was interrupted), drop `-b` and reuse it: `git worktree add ../<repo-folder-name>-<feature-branch-slug> <feature-branch>`.
   - If a worktree at that path already exists, reuse it as-is — do not create a duplicate or delete it.
   - Store the resulting absolute path as **WORKTREE_PATH**. Every stage from here on operates inside `WORKTREE_PATH`, never in the original checkout.

5. Report the base branch, feature branch, and `WORKTREE_PATH` to the user before continuing.

**Running multiple tickets in parallel**: because step 4 gives each ticket its own worktree and branch, `/execute-task` can be invoked for several tickets at the same time with no risk of one run's file writes or branch checkout clobbering another's. Conflicts, if any, only ever show up later as ordinary Git merge conflicts when each PR is merged — never as corrupted local state. The one shared resource is the base branch itself (step 2), which is only ever read from (checked out and pulled) before any worktree is created, never written to directly.

---

## 4a. START USAGE TRACKING

Capture the pipeline's start time so the final summary can report how long this run took:

```
PIPELINE_START=$(date +%s)
```

Also locate the usage-tracker script once and reuse the path for the rest of this command: prefer `${CLAUDE_PLUGIN_ROOT}/scripts/usage-tracker.js`. If `$CLAUDE_PLUGIN_ROOT` is unset or the file doesn't exist there, search the assistant plugin's installation directory (commonly under `~/.claude/plugins/`) for `scripts/usage-tracker.js`. If it can't be found at all, skip every "RECORD USAGE" step below for the rest of this run — usage tracking must never fail or block the pipeline.

---

## 4b. CHOOSE THE LANE

The full six-stage pipeline is worth its cost on feature work, but on a small, already-diagnosed bug most of its tokens go to re-deriving what the ticket already says. Pick a lane before invoking any agent:

- `--fast` or `--full` in the arguments wins.
- Otherwise use the **fast lane** only when **all** of these hold for the fetched ticket:
  1. It names the root cause **and** the concrete fix (typically under "Technical Notes" or similar).
  2. The fix touches the files the ticket names, roughly three source files or fewer.
  3. It adds no migrations, new routes/endpoints, new dependencies, or new public interfaces.
- In any other case, or if you are unsure, use the **full lane**.

| Lane | Stages |
|---|---|
| full | Spock → Kirk → Skinner → Leela → Bender → Smithers |
| fast | (no Spock) Kirk → Skinner → Leela → Bender → Smithers |

In the fast lane, Stage A is skipped (see Stage A). Report the chosen lane, and the reason, together with the setup report from Section 4.

---

## 5. MARK TICKET AS IN PROGRESS

Now that the ticket has been fetched and the worktree is set up, mark the ticket as started **before** invoking any agent, so the board reflects that work is underway. Using the connected Atlassian Jira MCP tools on the main thread:

1. Look up the valid workflow transitions for `TICKET_ID`.
2. Select the transition whose name most closely matches "En curso" (case-insensitive; exact match preferred; common English equivalents such as "In Progress" are acceptable fallbacks if no "En curso" transition exists).
3. Apply that transition to the issue.

Handle the outcome gracefully — a failure here must **not** abort the pipeline, since the code work can still proceed:
- If the transition succeeds, record the result and continue to Section 6.
- If the ticket is already in "En curso" (the transition is not offered), treat that as success and continue.
- If the Atlassian MCP is unavailable at this point, print the following and continue:
  ```
  [Jira transition skipped — Atlassian MCP not available]
  Would transition: TICKET_ID → "En curso"
  ```

---

## 6. PIPELINE

Invoke each agent via the Task tool in the order below. Pass the captured outputs forward explicitly — agents do not share memory.

**Every invocation below must explicitly tell the agent its working directory is `WORKTREE_PATH` (from Section 4)** — e.g. "Your working directory for this task is `<WORKTREE_PATH>`. Resolve all file paths, and run all Bash/git commands, relative to that directory — do not touch the original checkout." Agents do not share process state with the orchestrator, so this must be repeated in every stage's prompt, not assumed from context.

**Every invocation below must also set the Task tool's `description` parameter to start with the ticket id**, e.g. `TICKET_ID: Spock implementation planning` — this is how the "RECORD USAGE" steps below find each stage's transcript. A missing or wrong prefix just means that one stage's tokens/cost/duration silently won't be tracked — it never blocks the pipeline.

After **every** Task invocation in this section (including retries), run (if Section 4a found the usage-tracker script):
```
node <usage-tracker-path> record TICKET_ID assistant:<agent-name> TICKET_ID
```
replacing `<agent-name>` with the agent just invoked (`spock`, `kirk`, `skinner`, `leela`, `bender`, `smithers`). This is called out explicitly again at the end of each stage below as "**RECORD USAGE**".

---

### Stage A — Spock: Implementation planning

Invoke the `spock` agent with:
- The ticket title, description, and full acceptance criteria fetched in Section 3.
- Instruction to read the project's `CLAUDE.md`, explore the repository, and produce an ordered implementation plan with each acceptance criterion mapped to concrete steps.

Spock does **not** need to contact Jira — provide the ticket content directly.

**Fast lane:** do not invoke Spock. Instead, build the implementation plan yourself from the ticket's own root-cause and fix notes: a short ordered list of the files to change and what to change in each, mapped to the acceptance criteria. Pass that as "the implementation plan" to the following stages. Skip Spock's RECORD USAGE step.

**CAPTURE:**
- The acceptance criteria (verbatim from the fetched ticket — this is the contract).
- The implementation plan.

**RECORD USAGE:** `node <usage-tracker-path> record TICKET_ID assistant:spock TICKET_ID`

---

### Stage B — Kirk: Implementation

Invoke the `kirk` agent with:
- The acceptance criteria (from Stage A).
- The implementation plan (from Stage A).

Kirk writes all code changes required to satisfy the acceptance criteria.

**CAPTURE:**
- The complete list of files kirk created or modified (needed by skinner, which is read-only and cannot discover changes on its own).
- A summary of the changes made.

**RECORD USAGE:** `node <usage-tracker-path> record TICKET_ID assistant:kirk TICKET_ID` — run this after every Kirk invocation, including re-invocations from the Skinner, Leela-discrepancy, and Bender correction loops below.

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
- This loop counts against the global retry cap (see Section 7).

**RECORD USAGE:** `node <usage-tracker-path> record TICKET_ID assistant:skinner TICKET_ID` — run this after every Skinner invocation, including re-runs from this loop.

---

### Stage D — Leela: Test authoring

Invoke the `leela` agent with:
- The acceptance criteria (from Stage A — the criteria are the source of truth, NOT Kirk's implementation).
- Kirk's final change summary (from the last Stage B run).

Leela writes tests derived from the acceptance criteria, then runs **only the test files she touched** and fixes her own test mistakes before handing off. She does not run the full suite — that stays with Bender.

**CAPTURE:** the list of test files Leela created or modified, and her "Test run" result. If she reports implementation discrepancies (tests written to the criteria that fail against the code), treat that like a Skinner `CHANGES REQUESTED`: hand the discrepancies to Kirk (Stage B), then re-run Stage C and continue. This counts against the retry cap (Section 7).

**RECORD USAGE:** `node <usage-tracker-path> record TICKET_ID assistant:leela TICKET_ID` — run this after every Leela invocation, including re-runs from the Bender → Leela loop below.

---

### Stage E — Bender: Quality gate

Invoke the `bender` agent. If the project's `CLAUDE.md` has a `## Quality gate` section, pass Bender those exact commands so it does not spend tokens rediscovering them.

Bender runs the project's lint, static-analysis, and test commands. It saves all output as evidence and returns `PASS` or `FAIL`.

**If `FAIL`:** route the fix to whoever owns the failing files, and re-run only what that fix can affect.

- **Failures only in test files** (a failing test caused by its own fixture or setup, lint on a test file, a test that only fails in isolation):
  - Hand Bender's evidence to Leela (Stage D) with the instruction to fix those test files only.
  - Then re-run Stage E (Bender). Do not re-run Skinner: no source file changed.
- **Failures in source files**, or a test failing because the implementation does not meet a criterion:
  - Hand Bender's evidence to Kirk (Stage B), along with all previous context.
  - Re-run Stage C (Skinner).
  - Re-run Stage D (Leela) **only if** Kirk changed behaviour the tests cover. If Leela only needs to confirm that the existing tests still cover the criteria, invoke her with the Task tool's model override set to `haiku`.
  - Then re-run Stage E (Bender).
- Either path counts against the global retry cap (see Section 7).

**RECORD USAGE:** `node <usage-tracker-path> record TICKET_ID assistant:bender TICKET_ID` — run this after every Bender invocation, including re-runs from this loop.

---

### Stage F — Smithers: PR publication

Invoke the `smithers` agent **only after both Stage C returns `VERDICT: PASS` and Stage E returns `PASS`**.

Provide:
- The ticket identifier.
- The feature branch name (from Section 4).
- The **base branch** (from Section 4 step 1) — Smithers must use this as `--base` when creating the PR.
- The **`WORKTREE_PATH`** (from Section 4 step 4) — Smithers must `cd` there before running any `git`/`gh` command; the commit, push, and PR must come from the ticket's worktree, not the original checkout.
- The acceptance criteria (from Stage A).
- Kirk's final change summary.
- Bender's evidence file path.

Smithers commits all staged changes, pushes the feature branch, and opens a pull request via `gh` targeting the base branch. He returns the PR URL and branch name.

Do **not** run `git worktree remove` after this stage. The worktree stays in place after the PR is published — `/pr-review` needs it to address human review comments on the same branch, and removing it prematurely would force the next run to recreate it from scratch. Mention `WORKTREE_PATH` in the final summary so the user knows where it lives and can remove it manually (`git worktree remove <path>`) once the PR is merged.

**If Smithers does not return a PR URL, stop immediately. Do not proceed to Stage G.**

**CAPTURE:** the PR URL from Smithers.

**RECORD USAGE:** `node <usage-tracker-path> record TICKET_ID assistant:smithers TICKET_ID`

---

### Stage G — Jira transition

After Smithers returns a PR URL, using the connected Atlassian Jira MCP tools on the main thread:

1. Look up the valid workflow transitions for `TICKET_ID`.
2. Select the transition whose name most closely matches "Revision" (case-insensitive; exact match preferred).
3. Apply that transition to the issue.

If the transition succeeds, record the result. If the Atlassian MCP is unavailable at this point, print:
```
[Jira transition skipped — Atlassian MCP not available]
Would transition: TICKET_ID → "Revision"
```

---

## 7. CORRECTION LOOPS & RETRY CAP

All correction loops (Skinner → Kirk, Leela discrepancies → Kirk, Bender → Kirk, Bender → Leela) share a **maximum of 3 correction attempts total** across the entire pipeline run.

If the pipeline is still not passing after the 3rd attempt:
- **Do not open a PR.**
- **Do not remove the worktree.** Leave `WORKTREE_PATH` in place so the user can inspect or continue the work by hand.
- Stop and report to the user:
  - Which stage is failing and why.
  - The latest Skinner findings or Bender evidence.
  - The list of files involved.
  - `WORKTREE_PATH` and the feature branch name, so the user can pick up manually.
  - A recommendation for manual intervention.

---

## 7a. RECORD PIPELINE DURATION AND UPDATE JIRA SUMMARY

Run this whether the pipeline reached Stage G or hit the retry cap in Section 7 — a partial run still spent time and tokens and should be reflected.

Skip entirely if Section 4a couldn't find the usage-tracker script.

1. Capture the end time and add the wall-clock duration of everything that isn't already attributed to a specific agent stage (orchestration, Jira calls, the human-facing exchanges in between):
   ```
   PIPELINE_END=$(date +%s)
   node <usage-tracker-path> add-duration TICKET_ID $((PIPELINE_END-PIPELINE_START)) execute-task
   ```
   Note this is the *entire* run's wall time added as overhead on top of the per-stage durations already recorded — the reported total will therefore double-count the agent stages' own time against the overhead bucket. That's expected and fine: the ledger's `duration_seconds` total is meant to read as "how long did this take end to end," not as a precise non-overlapping breakdown.
2. Run `node <usage-tracker-path> summary TICKET_ID --markdown` and capture the output.
3. Using the Atlassian Jira MCP tools, update `TICKET_ID`'s description: replace any existing `## 📊 Resumen de ejecución` section with the freshly captured one (it's the same heading every time, so find-and-replace that section; if the heading isn't present yet, append the section at the end). Never touch the rest of the description. Skip this step if the Atlassian MCP is unavailable.

---

## 8. PROGRESS REPORTING

Announce each stage as you invoke it. After each agent returns, report its verdict or outcome in one line before continuing.

**Final summary (after Stage G or on hard stop):**

```
Ticket:      TICKET_ID
Lane:        fast | full (<reason>)
Base branch: <base-branch>
Branch:      feature/<ticket-id>  →  <base-branch>
Worktree:    <WORKTREE_PATH> (left in place — safe to remove after the PR merges)
Implemented: <one-line summary of changes>
Review:      PASS / CHANGES REQUESTED (N iterations)
Gate:        PASS / FAIL (N iterations)
PR:          <URL or "not opened">
Jira start:  transitioned to "En curso" | [skipped]
Jira end:    transitioned to "Revision" | [skipped]
```

If Section 7a ran, follow the block above with the plain-text usage summary (`node <usage-tracker-path> summary TICKET_ID --plain`) under a `Usage (accumulated across all runs on this ticket):` heading. Note explicitly that the cost is an estimate, not exact billing.
