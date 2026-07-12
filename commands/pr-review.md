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

### Stage 1 — Martin: Comment response

Invoke the `martin` agent with the PR number `$ARGUMENTS`.

Martin will:
1. Fetch all review comments and reviews from the PR.
2. Classify each comment as actionable, informational, or already resolved.
3. Implement code changes for every actionable comment.
4. Commit and push the fixes to the PR branch.
5. Reply to every comment directly on the PR — in-thread for inline comments, as a summary comment for top-level reviews — stating whether the change was applied (and how) or not applied (and why).

---

## Completion

Report to the user:
- A table of comments addressed and changes made.
- Any comments skipped and why.
- The commit SHA pushed to the branch.
- Confirmation that every comment received a reply on GitHub (Martin's output reports N/N replied — flag it to the user if any reply failed).
- A reminder to re-request review on GitHub after pushing.
