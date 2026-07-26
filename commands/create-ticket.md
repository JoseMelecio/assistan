---
description: Takes an implementation brief and produces a structured ticket with Gherkin acceptance criteria, then stops for human review before any planning or coding begins.
argument-hint: "[--project <KEY>] [path-to-brief or pasted text]"
---

# create-ticket

Produce a review-ready ticket from an implementation brief, then **stop for human approval**.

## Usage

```
/assistant:create-ticket [--project <KEY>] path/to/brief.md
```

The `--project <KEY>` flag is optional. When provided, it pins the target Jira project. When omitted, the project key is resolved from the consuming repo's CLAUDE.md, or the user is asked if it cannot be found.

---

## 1. PARSE ARGUMENTS

Parse `$ARGUMENTS` before doing anything else:

- If `$ARGUMENTS` contains `--project <KEY>`, extract the key and remove that flag from the remaining text. The remaining text is the brief.
- If no brief remains after parsing, ask the user to supply one before proceeding.

---

## 2. RESOLVE JIRA PROJECT KEY

Determine the target Jira project key in this priority order:

1. **`--project <KEY>` flag** — use the key extracted in step 1 if present.
2. **Consuming repo's CLAUDE.md** — read the CLAUDE.md in the current working directory and look for a line that declares the Jira project (e.g. `Jira project key: DEV`, `jira_project: DEV`, or similar wording). Extract the key from that line.
3. **Ask the user** — if neither of the above yields a key, stop and ask: "Which Jira project should I create this ticket in? (e.g. `DEV`)" Do not guess or default to any key.

---

## 2a. RESOLVE JIRA LABELS

Read the same `CLAUDE.md` and look for a line that declares one or more mandatory Jira labels (e.g. `Jira label: POS-API`, `Jira labels: POS-API, backend`, or similar wording). If found, every label listed there **must** be attached to the issue created in Section 5 — this is not optional and does not require user confirmation. If no such line exists, create the issue without labels (unless the user's brief requests specific ones).

---

## 3. INVOKE LISA — Ticket authoring

Invoke the `lisa` agent with the implementation brief (file path or pasted text).

Lisa produces structured markdown with:
- A title (imperative, ≤ 72 chars)
- Summary and background
- Gherkin acceptance criteria (Given/When/Then)
- Out of scope and technical notes

Capture Lisa's full markdown output — it becomes the Jira description.

---

## 4. CONFIRM WITH USER

Before creating anything in Jira, output a short confirmation message:

- The resolved project key
- The ticket title (from Lisa's output)
- The mandatory labels resolved in Section 2a, if any

Ask: "Shall I create this ticket in **`<KEY>`**?" and wait for the user's confirmation. Only proceed to step 5 after receiving confirmation.

---

## 5. CREATE THE JIRA ISSUE

Using the connected Atlassian Jira MCP tools available on the main thread:

1. If needed, look up the valid issue types for the project to find "Story" (or the closest equivalent — note some Jira instances use localized names, e.g. `Historia`).
2. Create the issue in the resolved project with:
   - Issue type: Story (or closest equivalent)
   - Summary: the ticket title from Lisa
   - Description: Lisa's full markdown output
   - Labels: the mandatory labels resolved in Section 2a, if any (pass them as the issue's `labels` field)
3. From the response, extract the issue key (e.g. `DEV-12`) and derive the browse URL. Use the `self` URL or the Atlassian base URL from the response to construct `<baseUrl>/browse/<ISSUE-KEY>`. Do **not** hardcode any base URL.

If the Atlassian MCP is not available, output Lisa's full markdown ticket and note:
`[Jira not available — paste this ticket manually or configure the Atlassian MCP integration]`

---

## 5a. RECORD USAGE AND APPEND SUMMARY

Skip this section entirely if the Atlassian MCP was not available in Section 5 (there is no ticket to write to).

1. Locate the usage-tracker script: prefer `${CLAUDE_PLUGIN_ROOT}/scripts/usage-tracker.js`. If `$CLAUDE_PLUGIN_ROOT` is unset or the file doesn't exist there, search the assistant plugin's installation directory (commonly under `~/.claude/plugins/`) for `scripts/usage-tracker.js`. If it still can't be found, skip this whole section silently — never fail the ticket creation over usage tracking.
2. Run (via Bash):
   ```
   node <usage-tracker-path> record <ISSUE-KEY> assistant:lisa
   ```
   This attributes Lisa's token usage and duration (just spent authoring the ticket) to the newly created issue. It's a no-op if it can't find a matching transcript — don't treat that as an error.
3. Run:
   ```
   node <usage-tracker-path> summary <ISSUE-KEY> --markdown
   ```
   and capture its output.
4. Using the Atlassian Jira MCP tools, update `<ISSUE-KEY>`'s description to Lisa's original markdown **plus** the captured summary appended at the end (the summary output already starts with its own `## 📊 Resumen de ejecución` heading — just concatenate it after Lisa's content with a blank line in between).

---

## STOP — HUMAN CHECKPOINT

**Do not continue to planning, implementation, or testing.**

This is an intentional pause for human review. The ticket must be approved and adjusted in Jira before development begins.

---

## 6. OUTPUT

Report to the user:

1. **Ticket created:**
   ```
   KEY:     <ISSUE-KEY>
   URL:     <direct browse link>
   Labels:  <applied labels, or "none">
   ```
2. **Acceptance criteria summary** — a short bulleted list of the Gherkin scenarios Lisa produced.
3. **Usage so far** (if Section 5a ran) — run `node <usage-tracker-path> summary <ISSUE-KEY> --plain` and show its output. Omit this item if Section 5a was skipped.
4. **Next step** — tell the user to review and adjust the ticket at the link above, and that when satisfied they can run:

   ```
   /assistant:execute-task <ISSUE-KEY>
   ```

   to start the full development pipeline.
