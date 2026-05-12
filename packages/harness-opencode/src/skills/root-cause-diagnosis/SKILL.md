---
name: root-cause-diagnosis
description: Use when a test, lint, or typecheck failure appears unexpectedly — before assuming it's pre-existing or unrelated.
---

# Root-cause diagnosis protocol

When any test, lint, or typecheck fails during execution, run this protocol before concluding anything about the failure's origin:

1. **Reproduce on merge-base.** Run `git stash && git merge-base HEAD origin/main` (fallback `origin/master`), check out the merge-base, run the failing command, then restore: `git checkout -` and `git stash pop`. If the failure reproduces on the merge-base, it pre-dates this branch — but it still blocks merge.
2. **git blame the failing line.** Run `git blame <file> -L <line>,<line>` to identify the commit that introduced the failure. If the commit is on this branch, you introduced it — fix it. If the commit pre-dates this branch, it is pre-existing — but it still blocks merge.
3. **Scope check.** If fixing the pre-existing failure would require touching >~5 files outside the plan's `## File-level changes`, STOP with a reorganization proposal. Do NOT defer or log-and-continue.

**Exception (TDD-RED state):** Tests written in this session under the TDD order (RED → GREEN) are EXPECTED to fail before their corresponding implementation step. The diagnosis protocol fires on UNEXPECTED failures — tests or lints that were green before your session and are now red, or tests from previous sessions that have started failing. A test you just wrote that has never been green is not an unexpected failure.

## Root-cause rationalization table

| Excuse | Reality |
|---|---|
| "This test was probably already failing before my change" | "Probably" is not evidence. Run the merge-base reproduction. |
| "Likely pre-existing — unrelated to my diff" | "Likely" is not evidence. Run `git blame` and show the commit SHA. |
| "This failure is in a different module, not my concern" | Red CI blocks merge regardless of which module owns the failure. |
| "I'll log it to Open questions and move on" | There is no deferral path. Fix it or STOP with a reorganization proposal. |
| "The test is flaky — it passes sometimes" | Flaky tests still block merge. Either fix the flakiness or STOP. |
