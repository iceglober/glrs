# Wave 4 — Context-Aware Retry with Prior Work

### 4.1 Capture work diff before retry
- intent: When an item fails verification and is about to be retried (loop-session.ts retry path), capture the git diff of files modified during the failed attempt. Add a `captureWorkDiff(cwd: string, files: string[]): string` function that runs `git diff HEAD -- <files>` scoped to the item's declared file list. The diff is capped at 8000 characters (truncate from the middle with a `[...truncated...]` marker) to keep the retry prompt bounded. If the diff is empty (model made no changes), return an empty string — the retry proceeds without prior-work context.
- files:
    - packages/autopilot/src/loop-session.ts (MODIFY)
- tests:
    - packages/autopilot/test/loop-session-retry.test.ts
- verify: bun test packages/autopilot/test/loop-session-retry.test.ts

### 4.2 Include verification error and diff in retry prompt
- intent: Modify the retry prompt construction in `runItemsForPhase` to prepend a context block when prior work exists. Format: `"A previous attempt at this item produced the following changes but failed verification.\n\n<diff>\n{diff}\n</diff>\n\n<verification-error>\n{verify_stderr}\n</verification-error>\n\nFix the issues in the existing code rather than starting over. The files listed above already exist with partial implementation."` The original item spec (intent, files, tests, verify) follows after this context block. When the diff is empty, omit the context block entirely and use the original prompt unchanged (current behavior).
- files:
    - packages/autopilot/src/loop-session.ts (MODIFY)
- tests:
    - packages/autopilot/test/loop-session-retry.test.ts
- verify: bun test packages/autopilot/test/loop-session-retry.test.ts

### 4.3 Preserve working-tree state across retry sessions
- intent: Currently, `resetWebapp`-style cleanup between retries is eval-specific (autoresearch.ts). The autopilot itself does not reset files between retry sessions — the model's partial work persists in the working tree. This is correct for context-aware retries (the retry session should see and fix the partial work, not start from a clean slate). Verify this invariant holds: add an assertion in `runItemsForPhase` that the working tree is NOT reset between retry attempts of the same item. If any future code path introduces a reset, the assertion catches it. Document this as a contract in a code comment on the retry path.
- files:
    - packages/autopilot/src/loop-session.ts (MODIFY)
- tests:
    - packages/autopilot/test/loop-session-retry.test.ts
- verify: bun test packages/autopilot/test/loop-session-retry.test.ts
