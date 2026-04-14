import type { SkillEntry } from "./index.js";
import { TASK_PREAMBLE } from "./preamble.js";

export function gsWork(): SkillEntry {
  return { "SKILL.md": `---
name: work
description: Implement a given task using existing codebase patterns. Use when user says 'implement', 'build this', 'make this change', 'add this feature', 'code this up', or provides ad-hoc task instructions. Reads CLAUDE.md, follows dependency order, typechecks after changes.
argument-hint: "[task instructions]"
disable-model-invocation: true
---

# Work — Test-Driven Implementation

Write the test first. Watch it fail. Write minimal code to pass.

If you didn't watch the test fail, you don't know if it tests the right thing.

## The Iron Law

NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST

Write code before the test? Delete it. All of it. Start over with a test.

No exceptions:
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Delete means delete

Thinking "skip TDD just this once"? Stop. That's rationalization.

## Input

The user describes what to implement: \`$ARGUMENTS\`

${TASK_PREAMBLE}

## Setup

1. **Check for an active glorious task** by running the task lookup from the context section above.
2. **If no working branch exists yet**:
   \`\`\`bash
   git fetch origin
   MAIN=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')
   git checkout "$MAIN" && git pull origin "$MAIN"
   git checkout -b <slug>
   \`\`\`
3. Read \`CLAUDE.md\` for project-specific commands.
4. Read relevant source files to understand the current state.

## Step 1: Plan

Break the task into small increments. For each increment, identify:
- What behavior to add
- What test to write for it (REQUIRED — every increment needs a test)
- What file(s) to modify

Write the plan before touching any code:

\`\`\`
## Plan
1. Test: [describe what the test asserts] → File: [test file path]
   Impl: [describe change] → File: [source file path]
2. Test: [describe test] → File: [test file path]
   Impl: [describe change] → File: [source file path]
Verify: bun run typecheck && bun test
\`\`\`

**Every plan item MUST have a Test line.** If no test file exists for the module you're changing, create one. Name it \`<module>.test.ts\` next to the source file.

**How to test things that seem hard to test:**
- CLI commands that print output → import the function, capture or check return values
- Functions that write to console → extract the logic into a testable pure function, test that
- Flag/option parsing → test the behavior the flag enables, not the flag itself
- If a function is truly untestable as-is, refactor it to be testable FIRST, then write the test

## Step 2: Red-Green-Refactor (repeat for each increment)

### RED — Write a failing test

1. Write ONE test that describes the desired behavior for this increment
2. Run the test suite:
   \`\`\`bash
   bun test
   \`\`\`
3. **Confirm: your new test FAILS.** Paste the failure output.
   - If it passes immediately → your test doesn't test anything new. Rewrite it.
   - If it errors (not fails) → fix the error, re-run until it fails correctly.

### GREEN — Write minimal code to pass

1. Write the **simplest code** that makes the failing test pass
2. Don't add features beyond what the test requires
3. Don't refactor yet
4. Run the test suite:
   \`\`\`bash
   bun test
   \`\`\`
5. **Confirm: ALL tests pass** (new and existing). Paste the output.
6. Run typecheck:
   \`\`\`bash
   bun run typecheck
   \`\`\`
7. **Confirm: zero errors.**

### REFACTOR (only after green)

- Remove duplication
- Improve names
- Extract helpers if needed
- Keep all tests green — run them again if you change anything

### REPEAT

Move to the next increment. Write the next failing test.

## Step 3: Final verification

After all increments are done:

1. \`bun run typecheck\` — zero errors
2. \`bun test\` — ALL tests pass
3. \`bun run build\` — succeeds
4. Review the task description line by line — every requirement met?
5. \`git diff\` — no debug code, no unused imports, no duplicate code blocks

**Do not declare done until all 5 checks pass.**

## Common rationalizations — all invalid

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Testing takes seconds. Write the test. |
| "I'll add tests after" | Tests-after pass immediately, proving nothing. Tests-first prove the feature works. |
| "This is just a flag/config" | If it can break in production, it needs a test. |
| "No existing tests for this area" | Then you're the one who improves it. Create the test file. |
| "Manual testing is faster" | Manual tests can't be re-run, can't catch regressions, can't prove anything. |

## Red flags — start over if you catch yourself

- Writing implementation code before a test exists
- A test passing immediately when you first write it
- Saying "should work" or "looks correct" without running the test
- Thinking "this case is different" — it's not
` };
}
