# Plan: Interactive Scope Selection for `gsag skills`

## Problem

`gsag skills` defaults to project scope (`.claude/` in git root). The `--user` flag exists but must be remembered. The user prefers user-global scope (`~/.claude/`). The command should interactively ask which scope to install into when no flag is given.

## Scope

- **In scope:** Interactive scope picker, refactored install logic, TDD for all changes
- **Out of scope:** Per-project-user scope (`~/.claude/projects/...`), individual skill cherry-picking, changes to skill content

## Architecture

### Current flow

```
gsag skills          → installs to .claude/ (project)
gsag skills --user   → installs to ~/.claude/ (global)
gsag skills --prefix → nests under glorious/ subdirectory
gsag skills --force  → overwrites without prompting
```

### Target flow

```
gsag skills               → interactive: pick scope (project or user), then install
gsag skills --user        → non-interactive: installs to ~/.claude/ (global)
gsag skills --project     → non-interactive: installs to .claude/ (project) — NEW FLAG
gsag skills --force       → still works (force overwrite)
gsag skills --prefix      → still works (glorious/ subdirectory)
```

When no scope flag is given and stdin is a TTY, show a `select()` picker:

```
? Where should skills be installed?

  Scope
> ~/.claude/          user-global — available in all projects
  .claude/            project — committed to this repo
```

When stdin is not a TTY (CI/piped), fall back to project scope (backwards-compatible).

---

## File changes

| File | Change |
|------|--------|
| `src/commands/install-skills.ts` | Extract pure logic into testable functions; add `--project` flag; add interactive picker |
| `src/commands/install-skills.test.ts` | **New.** Unit tests for all extracted functions and integration tests for handler logic |
| `src/lib/select.ts` | No changes needed — existing `select()` supports this |

---

## Sequenced work with TDD

Every step follows **Red → Green → Refactor**:
1. Write a failing test
2. Write the minimum code to pass
3. Refactor while tests stay green

---

### Phase 1: Extract pure functions from handler (refactor only — no behavior change)

The current handler is a single 100-line function mixing I/O, logic, and side effects. Before adding features, extract testable units.

- [x] **1.1 — Extract `resolveClaudeDir(scope, gitRootFn)`**

  **What:** A pure function that takes a scope string (`"project"` | `"user"`) and returns the absolute path to the `.claude/` directory. For `"project"`, it calls `gitRoot()` and appends `.claude`. For `"user"`, it returns `~/.claude/`.

  **Signature:**
  ```ts
  function resolveClaudeDir(
    scope: "project" | "user",
    gitRootFn?: () => string,
  ): string
  ```

  **Test cases (write first):**
  | Test | Input | Expected |
  |------|-------|----------|
  | user scope returns homedir/.claude | `"user"` | `path.join(os.homedir(), ".claude")` |
  | project scope returns gitRoot/.claude | `"project"`, mock gitRoot returning `/tmp/repo` | `/tmp/repo/.claude` |
  | project scope throws when not in git repo | `"project"`, mock gitRoot throwing | throws Error |

  **File:** `src/commands/install-skills.test.ts` — create file, import `resolveClaudeDir`
  **File:** `src/commands/install-skills.ts` — extract function, export it

- [x] **1.2 — Extract `computeInstallPlan(opts)`**

  **What:** A pure function that takes the full set of inputs and returns a plan object describing what to do, without performing any I/O.

  **Signature:**
  ```ts
  interface InstallPlan {
    claudeDir: string;
    commands: Record<string, string>;    // files to install
    skills: Record<string, string>;      // files to install
    previousManifest: Manifest;          // from disk
    usePrefix: boolean;
    force: boolean;
    collisions: string[];                // files that would collide
  }

  function computeInstallPlan(opts: {
    scope: "project" | "user";
    prefix: boolean;
    force: boolean;
    gitRootFn?: () => string;
    readManifestFn?: (dir: string) => Manifest;
    existsFn?: (path: string) => boolean;
    readFileFn?: (path: string) => string;
  }): InstallPlan
  ```

  **Test cases (write first):**
  | Test | Input | Expected |
  |------|-------|----------|
  | default plan with project scope | `scope: "project"`, no prefix, no force | `claudeDir` points to project, `commands` = COMMANDS, `skills` = SKILLS |
  | prefix wraps files under glorious/ | `prefix: true` | all keys in `commands` and `skills` start with `glorious/` |
  | force skips collision detection | `force: true` | `collisions` is empty regardless of existing files |
  | collisions detected for new files | existing file at dest with different content | `collisions` contains the filename |
  | no collision for previously-installed files | file in previous manifest with different content | `collisions` is empty (it's an update) |

  **File:** `src/commands/install-skills.test.ts` — add tests
  **File:** `src/commands/install-skills.ts` — extract function, export it

- [ ] **1.3 — Extract `executeInstall(plan)` and `formatInstallResult(result)`**

  **What:** `executeInstall` takes an `InstallPlan` and performs all filesystem writes. Returns a result summary. `formatInstallResult` takes the result and returns an array of log lines (no console.log calls — pure string output).

  **Signature:**
  ```ts
  interface InstallResult {
    created: number;
    updated: number;
    upToDate: number;
    removed: number;
    commandNames: string[];
    skillNames: string[];
    target: string;           // display label: "~/.claude/" or ".claude/"
  }

  function executeInstall(plan: InstallPlan): InstallResult

  function formatInstallResult(result: InstallResult): string[]
  ```

  **Test cases for `executeInstall` (write first):**
  | Test | Setup | Expected |
  |------|-------|----------|
  | creates new files | empty temp dir | `created` = file count, files exist on disk |
  | updates changed files | pre-existing file with old content | `updated` = 1, file has new content |
  | skips up-to-date files | pre-existing file with same content | `upToDate` = 1 |
  | removes stale files | manifest lists file not in current set | `removed` = 1, file deleted |
  | writes manifest | any install | `.glorious-skills.json` exists with correct content |

  **Test cases for `formatInstallResult` (write first):**
  | Test | Input | Expected |
  |------|-------|----------|
  | shows created count | `{ created: 3, ... }` | output includes "created 3 new files" |
  | shows updated count | `{ updated: 2, ... }` | output includes "updated 2 files" |
  | shows removed count | `{ removed: 1, ... }` | output includes "removed 1 stale file" |
  | shows up-to-date when nothing changed | `{ created: 0, updated: 0, removed: 0, upToDate: 5 }` | output includes "all skills up to date" |
  | lists command slugs | `{ commandNames: ["glorious/work.md"] }` | output includes "/glorious:work" |
  | lists skill slugs | `{ skillNames: ["browser.md"] }` | output includes "/browser" |

  **File:** `src/commands/install-skills.test.ts` — add tests
  **File:** `src/commands/install-skills.ts` — extract functions, export them

- [ ] **1.4 — Rewrite handler to compose extracted functions**

  **What:** The handler becomes a thin orchestrator: resolve scope → compute plan → handle collisions → execute → format → print. Existing behavior is preserved exactly. No new features yet.

  **Verification:** Run `bun run typecheck && bun test` — all green. Manual smoke test: `node dist/index.js skills --user` produces same output as before.

---

### Phase 2: Add `--project` flag

- [ ] **2.1 — Add `--project` flag to command definition**

  **What:** Add a new `project` flag alongside `user`. Both are boolean flags. They are mutually exclusive — if both are set, print an error and exit.

  **Test cases (write first):**
  | Test | Input | Expected |
  |------|-------|----------|
  | --project sets scope to project | `{ project: true, user: false }` | `resolveClaudeDir` called with `"project"` |
  | --user sets scope to user | `{ user: true, project: false }` | `resolveClaudeDir` called with `"user"` |
  | both flags errors | `{ user: true, project: true }` | throws / exits with error message |
  | neither flag returns null scope | `{ user: false, project: false }` | scope is `null` (triggers interactive) |

  **Signature addition to args:**
  ```ts
  project: flag({
    long: "project",
    description: "Install to .claude/ (project-level) in the current repo",
  }),
  ```

  **File:** `src/commands/install-skills.test.ts` — add tests for scope resolution from flags
  **File:** `src/commands/install-skills.ts` — add flag, add `resolveScopeFromFlags` function

---

### Phase 3: Add interactive scope picker

- [ ] **3.1 — Create `promptScope()` function**

  **What:** An async function that shows the `select()` picker and returns `"project" | "user"`. Returns `"project"` if stdin is not a TTY (backwards-compatible fallback).

  **Signature:**
  ```ts
  async function promptScope(opts?: {
    isTTY?: boolean;
    selectFn?: typeof select;
  }): Promise<"project" | "user">
  ```

  **Picker UI:**
  ```
  ? Where should skills be installed?

    Scope
  > ~/.claude/          available in all projects
    .claude/            committed to this repo
  ```

  **Test cases (write first):**
  | Test | Input | Expected |
  |------|-------|----------|
  | returns user when selected | mock selectFn returning `"user"` | `"user"` |
  | returns project when selected | mock selectFn returning `"project"` | `"project"` |
  | falls back to project when not TTY | `isTTY: false` | `"project"` without calling selectFn |
  | falls back to project on cancel (null) | mock selectFn returning `null` | `"project"` |

  **File:** `src/commands/install-skills.test.ts` — add tests
  **File:** `src/commands/install-skills.ts` — add function, export it

- [ ] **3.2 — Wire picker into handler**

  **What:** When no scope flag is provided (`--user` or `--project`), call `promptScope()`. Pass the result into the existing `resolveClaudeDir` → `computeInstallPlan` → `executeInstall` pipeline.

  **Handler logic (pseudocode):**
  ```ts
  handler: async ({ force, user, project, prefix }) => {
    // 1. Resolve scope
    let scope: "project" | "user";
    if (user && project) {
      console.error("Cannot use --user and --project together");
      process.exit(1);
    } else if (user) {
      scope = "user";
    } else if (project) {
      scope = "project";
    } else {
      scope = await promptScope();
    }

    // 2. Compute plan
    const claudeDir = resolveClaudeDir(scope);
    const plan = computeInstallPlan({ scope, prefix, force, claudeDir });

    // 3. Handle collisions (existing askYesNo logic)
    if (plan.collisions.length > 0 && !force) {
      // ... existing collision prompt ...
    }

    // 4. Execute
    const result = executeInstall(plan);

    // 5. Print
    for (const line of formatInstallResult(result)) {
      console.log(line);
    }
  }
  ```

  **Integration test cases (write first):**
  | Test | Scenario | Expected |
  |------|----------|----------|
  | `--user` skips picker | flag set | `promptScope` not called, installs to `~/.claude/` |
  | `--project` skips picker | flag set | `promptScope` not called, installs to `.claude/` |
  | no flags triggers picker | neither flag | `promptScope` called |
  | full flow: user scope | mock picker → user, temp dir | files appear in user dir |
  | full flow: project scope | mock picker → project, temp dir | files appear in project dir |

  **File:** `src/commands/install-skills.test.ts` — add integration tests
  **File:** `src/commands/install-skills.ts` — update handler

---

### Phase 4: Verify and clean up

- [ ] **4.1 — Full test suite pass**

  ```bash
  cd packages/agentic
  bun run typecheck
  bun test
  ```

  All tests green. No type errors.

- [ ] **4.2 — Manual smoke tests**

  Run each of these from the repo root and verify correct behavior:

  | Command | Expected |
  |---------|----------|
  | `node dist/index.js skills` | Shows interactive picker, installs to chosen scope |
  | `node dist/index.js skills --user` | Installs to `~/.claude/` without picker |
  | `node dist/index.js skills --project` | Installs to `.claude/` without picker |
  | `node dist/index.js skills --user --project` | Error: cannot use both |
  | `echo "" \| node dist/index.js skills` | Falls back to project scope (no TTY) |
  | `node dist/index.js skills --user --force` | Force overwrites in `~/.claude/` |
  | `node dist/index.js skills --prefix` | Shows picker, installs under `glorious/` prefix |

- [ ] **4.3 — Update help text**

  Update `src/help.ts` if `gsag skills` is mentioned there to reflect the new interactive behavior and `--project` flag.

---

## Test file structure

```
src/commands/install-skills.test.ts
├── describe("resolveClaudeDir")
│   ├── test("user scope returns ~/.claude")
│   ├── test("project scope returns gitRoot/.claude")
│   └── test("project scope throws outside git repo")
├── describe("computeInstallPlan")
│   ├── test("default plan with project scope")
│   ├── test("prefix wraps files under glorious/")
│   ├── test("force skips collision detection")
│   ├── test("detects collisions for new files")
│   └── test("no collision for previously-installed files")
├── describe("executeInstall")
│   ├── test("creates new files in empty dir")
│   ├── test("updates changed files")
│   ├── test("skips up-to-date files")
│   ├── test("removes stale files from previous manifest")
│   └── test("writes manifest file")
├── describe("formatInstallResult")
│   ├── test("shows created count")
│   ├── test("shows updated count")
│   ├── test("shows removed count")
│   ├── test("shows up-to-date message when nothing changed")
│   ├── test("lists command slugs")
│   └── test("lists skill slugs")
├── describe("resolveScopeFromFlags")
│   ├── test("--project returns project")
│   ├── test("--user returns user")
│   ├── test("both flags throws")
│   └── test("neither flag returns null")
├── describe("promptScope")
│   ├── test("returns user when selected")
│   ├── test("returns project when selected")
│   ├── test("falls back to project when not TTY")
│   └── test("falls back to project on cancel")
└── describe("handler integration")
    ├── test("--user skips picker")
    ├── test("--project skips picker")
    ├── test("no flags triggers picker")
    ├── test("full flow: user scope end-to-end")
    └── test("full flow: project scope end-to-end")
```

## Dependency order

```
Phase 1.1  (resolveClaudeDir)
    ↓
Phase 1.2  (computeInstallPlan) — depends on resolveClaudeDir
    ↓
Phase 1.3  (executeInstall + formatInstallResult) — depends on InstallPlan type
    ↓
Phase 1.4  (rewrite handler) — composes all three
    ↓
Phase 2.1  (--project flag) — extends handler
    ↓
Phase 3.1  (promptScope) — standalone, but logically after flags exist
    ↓
Phase 3.2  (wire picker into handler) — depends on 2.1 + 3.1
    ↓
Phase 4.1–4.3  (verify + cleanup)
```

No step can be parallelized — each depends on the previous. Execute sequentially.
