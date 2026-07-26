---
description: Reads all human review comments on an open pull request and addresses them with code changes. Invokes martin to implement the fixes and push them to the branch.
argument-hint: "[pr-number]"
---

# pr-review

Address human review comments on an open pull request.

## Usage

```
/assistant:pr-review 42
```

---

## Pipeline

The pull request number is: **$ARGUMENTS**

---

### Stage 0 — Resolve ticket and prepare usage tracking

1. Run `gh pr view $ARGUMENTS --json title,body` and extract the Jira ticket id: it's the prefix of the title before the em dash (e.g. `DEV-147 — Fix ...` → `DEV-147`, the convention `smithers` uses when opening PRs). If the title doesn't have that shape, fall back to the `## Related ticket` section of the body. If neither yields a ticket id, this PR didn't come from this pipeline — skip every usage-tracking step below for the rest of this command, silently.
2. If a ticket id was found, locate the usage-tracker script: prefer `${CLAUDE_PLUGIN_ROOT}/scripts/usage-tracker.js`. If `$CLAUDE_PLUGIN_ROOT` is unset or the file doesn't exist there, search the assistant plugin's installation directory (commonly under `~/.claude/plugins/`) for `scripts/usage-tracker.js`. If it can't be found, skip usage tracking for the rest of this run — never fail the pipeline over it.
3. Capture the start time: `PIPELINE_START=$(date +%s)`.

---

### Stage 1 — Martin: Comment response

Invoke the `martin` agent with the PR number `$ARGUMENTS`. If a ticket id was resolved in Stage 0, set the Task tool's `description` parameter to start with it (e.g. `DEV-147: PR review response`) — usage tracking below finds Martin's transcript by that prefix.

Martin will:
1. Fetch all review comments and reviews from the PR.
2. Classify each comment as actionable, informational, or already resolved.
3. Implement code changes for every actionable comment.
4. Commit and push the fixes to the PR branch.
5. Reply to every comment **in its own thread** on the PR — right next to the comment it answers — stating whether the change was applied (and how) or not applied (and why). No single "big message" summary is posted at the end of the PR; top-level review remarks with no inline thread are reported back to you for manual handling instead.

---

### Stage 2 — Record usage and update the Jira summary

Skip entirely if Stage 0 didn't resolve a ticket id or couldn't find the usage-tracker script.

1. `node <usage-tracker-path> record <TICKET-ID> assistant:martin <TICKET-ID>`
2. `PIPELINE_END=$(date +%s)` then `node <usage-tracker-path> add-duration <TICKET-ID> $((PIPELINE_END-PIPELINE_START)) pr-review`
3. `node <usage-tracker-path> summary <TICKET-ID> --markdown`, then using the Atlassian Jira MCP tools update `<TICKET-ID>`'s description: replace any existing `## 📊 Resumen de ejecución` section with the freshly captured one (same heading every time — find-and-replace that section; append it if not present yet). Never touch the rest of the description. Skip if the Atlassian MCP is unavailable.

---

## Completion

Report to the user:
- A table of comments addressed and changes made.
- Any comments skipped and why.
- The commit SHA pushed to the branch.
- Confirmation that every inline comment received an in-thread reply on GitHub (Martin's output reports N/N replied — flag it to the user if any reply failed).
- Any "Unanchored review points" Martin reported — top-level review remarks that had no inline thread to reply to and were intentionally not posted on the PR, so the user can decide how to follow up.
- If Stage 2 ran, the accumulated usage for the ticket (`node <usage-tracker-path> summary <TICKET-ID> --plain`), noting the cost is an estimate, not exact billing.
- A reminder to re-request review on GitHub after pushing.
