---
description: Fetches an existing Jira ticket that didn't originate from lisa and rewrites it with proper Gherkin acceptance criteria, then stops for human review before execute-task runs.
argument-hint: "[TICKET-ID]"
---

# normalize-ticket

Rewrite a ticket someone else already filed — a teammate, a client, or another AI — into this pipeline's Gherkin format, then **stop for human approval**.

## Usage

```
/assistant:normalize-ticket DEV-45
```

---

## 1. INPUT

The ticket identifier is: **$ARGUMENTS**

If `$ARGUMENTS` is empty, ask the user to supply a Jira ticket identifier before proceeding.

---

## 2. VALIDATE PROJECT KEY

Before fetching anything from Jira, check whether this repo restricts which Jira project it accepts:

1. Read the project's `CLAUDE.md` and look for a line that declares the Jira project (e.g. `Jira project key: MM`, `jira_project: MM`, or similar wording).
2. If no such line exists, this repo is unrestricted — skip validation and continue to Section 3.
3. If a project key **is** declared, extract the project prefix from `$ARGUMENTS` (the text before the first `-`, e.g. `MM-42` → `MM`).
4. Compare the two case-insensitively.
   - **Match** — continue to Section 3.
   - **No match** — stop immediately, do not contact Jira, and tell the user:
     > This repo is restricted to Jira project `<declared-key>` (per `CLAUDE.md`). `$ARGUMENTS` belongs to a different project and will not be processed. Re-run with a `<declared-key>-*` ticket.

---

## 3. FETCH TICKET FROM JIRA

Using the connected Atlassian Jira MCP tools available on the main thread, fetch the live ticket for `$ARGUMENTS`. Extract the title (summary field), full description, and any comments that add relevant context.

If the Atlassian MCP is not available, ask the user to paste the ticket's title and description directly instead, and proceed with that pasted content in place of a live fetch.

---

## 4. INVOKE HERMES — Ticket normalization

Invoke the `hermes` agent with the fetched (or pasted) title and description.

Hermes produces:
- The ticket rewritten in the standard format with **Gherkin acceptance criteria**.
- A **Normalization Notes** section listing every place it had to interpret or infer something the source ticket left ambiguous (omitted if the source needed no interpretation).

Capture Hermes's full markdown output — it becomes the Jira description.

---

## 5. CONFIRM WITH USER

Before touching Jira, output:

- The ticket identifier and current title.
- Hermes's full **Normalization Notes** (if any) — these are the most important thing for the human to check, since they mark every place the rewrite guessed at intent.
- A short bulleted summary of the Gherkin scenarios produced.

Ask: "Shall I update **`$ARGUMENTS`** with this normalized description?" and wait for the user's confirmation, including any corrections to scenarios Hermes got wrong. Only proceed to step 6 after receiving confirmation.

---

## 6. UPDATE THE JIRA ISSUE

Using the connected Atlassian Jira MCP tools available on the main thread:

1. Add a comment to `$ARGUMENTS` containing the **original** description, prefixed with a note that it's being preserved before normalization (traceability — nothing the original author wrote is lost).
2. Update the issue's description field to Hermes's normalized markdown (as corrected by the user in step 5, if any corrections were given).

If the Atlassian MCP is not available, output Hermes's full markdown and note:
`[Jira update skipped — Atlassian MCP not available. Paste this into the ticket manually.]`

---

## STOP — HUMAN CHECKPOINT

**Do not continue to planning, implementation, or testing.**

This is an intentional pause, same as `/assistant:create-ticket`. The normalized ticket should be visible in Jira and confirmed correct before development begins.

---

## 7. OUTPUT

Report to the user:

1. **Ticket normalized:**
   ```
   KEY:  $ARGUMENTS
   URL:  <direct browse link>
   ```
2. **Normalization Notes** — repeated here for the record, so nothing gets lost if the user scrolls past step 5.
3. **Next step** — tell the user that once satisfied, they can run:

   ```
   /assistant:execute-task $ARGUMENTS
   ```

   to start the full development pipeline. `execute-task` re-fetches the live ticket, so it will pick up the normalized description automatically.
