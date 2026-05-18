# Wave 4 — Execution Quality + Validation

**Focus:** The autopilot should produce correct code, not just code. Validate at every step, catch drift early, and give the agent the context it needs to succeed on the first pass.

---

## Items

- [x] 4.1 **Post-phase test gate.** After each phase completes, run the phase's `verify` commands (from the plan-state items). If any verify command fails, mark the phase as incomplete, log the failure, and either retry the phase (up to the iteration budget) or move on with a warning. The debrief reports which verify commands passed/failed.

  - mirror: `packages/harness-opencode/src/autopilot/plan-parser.ts` (`parseItems` already extracts each item's `verify: string` — line 257-259); `packages/harness-opencode/src/autopilot/loop.ts`'s `execFile("git", ...)` shell-out shape (lines 126-146) is the runtime invocation pattern
  - files (NEW):
    - `packages/harness-opencode/src/autopilot/verify-runner.ts` — `runVerifyCommands(items: PlanItem[], cwd: string): Promise<VerifyResult[]>` where each command runs in a child process with a 5-minute timeout
    - `packages/harness-opencode/test/verify-runner.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — after a phase's `phaseComplete === true` (around line 254), call `runVerifyCommands(parseItems(updatedPhaseContent), opts.cwd)`; if any fail, treat the phase as incomplete and feed the failure back into the next iteration's prompt
    - `packages/harness-opencode/src/autopilot/debrief.ts` — extend `buildContextMessage` to include a verify-results table when `loopResult.verifyResults` is set
  - context (`plan-parser.ts` parseItems verify extraction, lines 257-259):
    ```ts
    } else if (trimmed.startsWith("verify:")) {
      verify = trimmed.slice("verify:".length).trim();
      i++;
    }
    ```
    Each `PlanItem.verify` is the literal command string (e.g., `bun test test/foo.test.ts`).
  - context (`loop-session.ts` phase-complete branch, lines 251-258):
    ```ts
    const updatedPhaseContent = _readFileSync(phasePath);
    const phaseComplete = isPhaseComplete(updatedPhaseContent);
    if (phaseComplete) {
      phasesCompleted++;
      const updatedMain = markPhaseChecked(_readFileSync(mainMdPath), phaseFile);
      _writeFileSync(mainMdPath, updatedMain);
    }
    ```
    Insert verify-runner call between `isPhaseComplete` and `markPhaseChecked`: only mark checked when `phaseComplete && allVerifiesPassed`.
  - context (VerifyResult shape):
    ```ts
    interface VerifyResult {
      itemId: string;
      command: string;
      passed: boolean;
      stdout: string;
      stderr: string;
      durationMs: number;
    }
    ```
  - conventions: verify commands run via `execFile("/bin/sh", ["-c", cmd])` to support shell features; per-command timeout = 5 minutes (`signal: AbortSignal.timeout(5*60*1000)`); on timeout, mark `passed: false` with a synthetic stderr message; never throw — VerifyResult always returned; `bun:test` with mocked `execFile`; named exports.

- [x] 4.2 **File-list validation.** After each iteration, compare the files the agent actually touched (`git diff --name-only`) against the plan's `files:` list for the current phase. If the agent touched files not in the plan, log a warning: "Scope drift: agent edited <file> which is not in the plan." If the agent missed files that are in the plan, log: "Incomplete: plan expects changes to <file> but none were made."

  - mirror: `packages/harness-opencode/src/autopilot/loop.ts`'s `checkProgress` helper (lines 126-134) — same `git diff` shell-out shape; `plan-parser.ts`'s `PlanItem.files[]` array provides the expected set
  - files (NEW):
    - `packages/harness-opencode/src/autopilot/scope-validator.ts` — `validateScope(expected: string[], actual: string[]): { extra: string[]; missing: string[] }` and `getChangedFiles(cwd, baseRef): Promise<string[]>`
    - `packages/harness-opencode/test/scope-validator.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop.ts` — after each iteration, between the `checkProgress` call (line 477) and the heartbeat update (line 551), call `validateScope` and emit warnings via the existing `log` instance
  - context (`loop.ts` per-iteration progress block, lines 477-509):
    ```ts
    const madeProgress = await checkProgress(opts.cwd, headBefore);
    struggle.record(madeProgress);
    const cumulativeCostUsd = await getSessionCost(server.client, sessionId!);
    let filesChanged = 0;
    let commitSubject = "";
    try {
      const { stdout: diffStat } = await execFile("git", ["diff", "--stat", "HEAD~1", "HEAD"], { cwd: opts.cwd });
      const match = diffStat.match(/(\d+) files? changed/);
      if (match) filesChanged = parseInt(match[1], 10);
    } catch { ... }
    const headAfter = await getHeadSha(opts.cwd);
    if (headAfter !== headBefore) {
      try {
        const { stdout: logOut } = await execFile("git", ["log", "--oneline", "-1"], { cwd: opts.cwd });
        commitSubject = logOut.trim().replace(/^[0-9a-f]+ /, "");
      } catch { /* ... */ }
      ...
    }
    ```
    Insert: `const changedFiles = await getChangedFiles(opts.cwd, headBefore); const { extra, missing } = validateScope(expectedFilesForPhase, changedFiles); for (const f of extra) log.warn({ file: f }, "Scope drift");`.
  - context (`getChangedFiles` implementation):
    ```ts
    export async function getChangedFiles(cwd: string, baseRef: string): Promise<string[]> {
      try {
        const { stdout } = await execFile("git", ["diff", "--name-only", baseRef], { cwd });
        return stdout.trim().split("\n").filter(Boolean);
      } catch { return []; }
    }
    ```
  - conventions: validation is informational — never blocks the loop; warnings use structured pino logging (`log.warn({ scopeDrift: file }, "...")`); the "expected files" set is unioned across all unchecked items in the current phase (each item's `files[].path`); `bun:test`; named exports.

- [x] 4.3 **Enrichment idempotency check.** Before running the enrichment pass, check if the plan already has `mirror:`, `context:`, and `conventions:` fields on its items. If >80% of items already have these fields, skip enrichment and log "Plan already enriched — skipping." Saves an Opus call on re-runs.

  - mirror: `packages/harness-opencode/src/autopilot/plan-enrichment.ts` (existing `enrichPlanForFastModel` is the entry point — wrap it with the idempotency check)
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/plan-enrichment.ts` — at the top of `enrichPlanForFastModel` (line 38), read each plan file and count items with all three fields; if `enrichedCount / totalCount > 0.8`, log and return early
  - context (`plan-enrichment.ts` entry, lines 38-69):
    ```ts
    export async function enrichPlanForFastModel(
      cwd: string,
      planPath: string,
    ): Promise<void> {
      const resolvedPath = path.resolve(cwd, planPath);
      const isDir = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory();
      let planFiles: string[];
      if (isDir) {
        const entries = fs.readdirSync(resolvedPath);
        planFiles = entries
          .filter((f) => f.endsWith(".md") && f !== "scope.md" && f !== "scope-seed.md")
          .map((f) => path.join(resolvedPath, f));
      } else {
        planFiles = [resolvedPath];
      }
      const server = await startServer({ cwd });
      ...
    }
    ```
    Insert before `await startServer`:
    ```ts
    const enrichmentRatio = computeEnrichmentRatio(planFiles);
    if (enrichmentRatio > 0.8) {
      process.stderr.write(`  Plan already enriched (${Math.round(enrichmentRatio * 100)}% of items have context) — skipping\n`);
      return;
    }
    ```
  - context (idempotency detection — count items with all three fields):
    ```ts
    function computeEnrichmentRatio(planFiles: string[]): number {
      let total = 0;
      let enriched = 0;
      for (const f of planFiles) {
        const content = fs.readFileSync(f, "utf-8");
        // Each item: "- [ ] N.M **..." or "- [x]..."; count items
        const items = content.match(/^- \[[ xX]\]\s+\d+\.\d+/gm) ?? [];
        total += items.length;
        // Heuristic: count occurrences of all three field markers
        const hasMirror = (content.match(/^\s*-?\s*mirror:/gm) ?? []).length;
        const hasContext = (content.match(/^\s*-?\s*context/gm) ?? []).length;
        const hasConventions = (content.match(/^\s*-?\s*conventions:/gm) ?? []).length;
        enriched += Math.min(hasMirror, hasContext, hasConventions);
      }
      return total > 0 ? enriched / total : 0;
    }
    ```
  - conventions: idempotency check is a pure synchronous function (no I/O against the OpenCode server); threshold 0.8 is a constant in the module; on read failure, treat the file as unenriched (return 0 for that file); `bun:test` with fixture markdown files; named exports.

- [x] 4.4 **Smart enrichment.** Instead of a single Opus session that reads the entire plan, enrich per-phase: read one phase file + its referenced codebase files, add context, move to the next. This keeps the enrichment context small and allows partial enrichment (if the session dies mid-enrichment, completed phases are already enriched).

  - mirror: `packages/harness-opencode/src/autopilot/plan-enrichment.ts` (existing single-pass `enrichPlanForFastModel` — refactor into a per-file loop); `loop-session.ts`'s per-phase iteration (lines 231-273) is the structural reference
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/plan-enrichment.ts` — replace the single `await sendAndWait(...)` invocation (line 97) with a per-file loop; each iteration creates a fresh session, sends one file's contents, waits for `ENRICHMENT_COMPLETE`
  - context (current single-pass body, `plan-enrichment.ts` lines 56-119):
    ```ts
    const server = await startServer({ cwd });
    try {
      const sessionId = await createSession(server.client, { cwd, agentName: "prime" });
      const planContents = planFiles.map((f) => {
        const content = fs.readFileSync(f, "utf-8");
        return `### ${path.relative(cwd, f)}\n\`\`\`markdown\n${content}\n\`\`\``;
      }).join("\n\n");
      const prompt = `You are enriching a plan ... ${planContents} ... Enrich each item, then respond with "ENRICHMENT_COMPLETE" when done.`;
      let toolCalls = 0;
      let lastToolName = "";
      await sendAndWait(server.client, {
        sessionId, message: prompt, stallMs: 10 * 60 * 1000,
        onToolCall: (toolName) => { ... },
        onTextDelta: () => { ... },
      });
      ...
    } finally { await server.shutdown(); }
    ```
    Refactor to:
    ```ts
    for (const f of planFiles) {
      if (computeEnrichmentRatio([f]) > 0.8) continue; // per-file idempotency
      const sessionId = await createSession(server.client, { cwd, agentName: "prime" });
      const content = fs.readFileSync(f, "utf-8");
      const prompt = `You are enriching ONE file ... \`\`\`markdown\n${content}\n\`\`\` ... ENRICHMENT_COMPLETE.`;
      await sendAndWait(server.client, { sessionId, message: prompt, stallMs: 5 * 60 * 1000, onToolCall, ... });
    }
    ```
  - context (per-phase prompt template — preserve the rules section verbatim from the existing prompt at lines 71-92): the rules text (mirror/context/conventions definitions, "modify in place", "don't hallucinate") stays identical; only the input changes from `planContents` (all files concatenated) to a single file's content.
  - conventions: each per-file session uses a fresh session ID (don't reuse — each file gets its own clean context); per-file stall timeout drops from 10 min to 5 min (smaller scope); progress reporting still writes to stderr with the existing TTY/non-TTY pattern; if any single-file enrichment fails, log a warning and continue to the next file (don't abort the whole pass); `bun:test`.

- [x] 4.5 **Plan structure validation.** Before execution, validate the plan structure: main.md exists, phase files exist and are referenced, each item has `intent` + `tests` + `verify`, `files:` field is present (warn if missing). Report validation results before starting. Fail fast on structural issues instead of discovering them mid-execution.

  - mirror: `packages/harness-opencode/src/autopilot/plan-parser.ts` (existing `parsePlanState` and `parseItems` — same input shape, new validator wraps them); `packages/harness-opencode/src/autopilot/loop-session.ts`'s `detectPhaseFiles`/`filterUncheckedPhases` helpers (lines 61-138) are the reference for plan-shape inspection
  - files (NEW):
    - `packages/harness-opencode/src/autopilot/plan-validator.ts` — `validatePlan(planPath: string): ValidationReport` with `errors: ValidationError[]` and `warnings: ValidationWarning[]`
    - `packages/harness-opencode/test/plan-validator.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — call `validatePlan(opts.planPath)` at the top of `runLoopSession` (line 181); if `report.errors.length > 0`, return immediately with `exitReason: "error"`; print warnings to log
    - `packages/harness-opencode/src/autopilot/autopilot-cmd.ts` — same call at the top of the handler when `--plan` is provided, before any execution
  - context (`loop-session.ts` runLoopSession entry, lines 179-208):
    ```ts
    export async function runLoopSession(
      opts: LoopSessionOptions & { _deps?: LoopSessionDeps },
    ): Promise<LoopResult> {
      const _runRalphLoop = opts._deps?.runRalphLoop ?? runRalphLoop;
      const _readFileSync = opts._deps?.readFileSync ?? ((p: string) => fs.readFileSync(p, "utf8"));
      const _writeFileSync = opts._deps?.writeFileSync ?? ((p: string, content: string) => fs.writeFileSync(p, content, "utf8"));
      const isDirectory = opts._deps?.isDirectory ? opts._deps.isDirectory(opts.planPath) : ...
      if (!isDirectory) {
        const prompt = `Work the plan at ${opts.planPath}. ...`;
        return _runRalphLoop({ prompt, cwd: opts.cwd, agentName: opts.fast ? "autopilot-fast" : undefined });
      }
      ...
    }
    ```
    Insert after the deps unpacking, before `isDirectory`:
    ```ts
    const report = validatePlan(opts.planPath);
    for (const w of report.warnings) log.warn({ ...w }, w.message);
    if (report.errors.length > 0) {
      return { exitReason: "error", iterations: 0, message: `Plan validation failed: ${report.errors.map(e => e.message).join("; ")}` };
    }
    ```
  - context (ValidationReport shape):
    ```ts
    interface ValidationError { code: string; message: string; file?: string; itemId?: string; }
    interface ValidationWarning { code: string; message: string; file?: string; itemId?: string; }
    interface ValidationReport { errors: ValidationError[]; warnings: ValidationWarning[]; }
    ```
    Required structural checks (errors): `main.md` exists for directory plans; every phase file referenced in main.md exists on disk; every phase file has at least one item with `intent:`. Soft checks (warnings): items missing `files:`, `tests:`, or `verify:`.
  - conventions: pure function (no I/O beyond `fs.readFileSync`/`fs.statSync`); never throws — degrades to `{ errors: [], warnings: [...] }` on parse failure; `bun:test` with fixture plans; named exports.

- [x] 4.6 **Automatic changeset generation.** After all phases complete successfully, generate a changeset file (`.changeset/<slug>.md`) with the appropriate bump level (minor for new features, patch for fixes) and a description derived from the plan's goal. The user can review and adjust before merging.

  - mirror: existing `.changeset/*.md` files in repo root (changeset format is fixed); `packages/harness-opencode/src/cli/install.ts` (the `writePluginOption` atomic-write pattern) is the reference for safe file writes
  - files (NEW):
    - `packages/harness-opencode/src/autopilot/changeset-generator.ts` — `generateChangeset(planPath: string, repoRoot: string): Promise<{ path: string; content: string }>` — writes to `.changeset/<slug>.md`
    - `packages/harness-opencode/test/changeset-generator.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — at the end of `runLoopSession`, after all phases are checked, call `generateChangeset(opts.planPath, opts.cwd)` and log the resulting path
  - context (changeset file format — Changesets v2):
    ```markdown
    ---
    "@glrs-dev/harness-plugin-opencode": minor
    ---

    Add autopilot v1 production-grade autonomous execution: notifications, resume from checkpoint, parallel execution, validation gates.
    ```
    Frontmatter is YAML between `---` delimiters; package name + bump level (`patch` | `minor` | `major`); body is a single paragraph derived from the plan's `## Goal` section in main.md.
  - context (`loop-session.ts` post-completion return, lines 294-299):
    ```ts
    return {
      ...lastResult,
      iterations: totalIterations,
      cumulativeCostUsd: totalCostUsd,
      message: `${phasesCompleted}/${uncheckedPhases.length} phases completed in ${totalIterations} iterations, total $${totalCostUsd.toFixed(2)}`,
    };
    ```
    Insert before this return: `if (phasesCompleted === uncheckedPhases.length) { const cs = await generateChangeset(opts.planPath, opts.cwd); log.info({ path: cs.path }, "Changeset generated"); }`.
  - context (bump-level inference): plan's main.md `# Title` containing "fix"/"bug" → `patch`; containing "remove"/"break"/"v2" → `major`; otherwise → `minor`. Fall back to `minor` if no signal.
  - conventions: monorepo uses Changesets v2 (per `AGENTS.md` rule 5 — never run `npm publish` manually; always go through changesets); changeset filename uses the plan slug + random suffix to avoid collisions (e.g., `<slug>-<random6>.md`); the `@glrs-dev/harness-plugin-opencode` package name is the only one autopilot ships changesets for in this repo (other packages would require `--package` flag); `bun:test`; named exports.

- [x] 4.7 **PR auto-open.** After all phases complete and tests pass, automatically push the branch and open a PR via `gh pr create`. The PR body is the plan's main.md content. The PR title is derived from the plan's `# Title`. Gated behind a `--ship` flag — without it, the autopilot stops at "all phases complete, run `/ship` to finalize."

  - mirror: existing slash command `/ship` (template at `packages/harness-opencode/src/commands/prompts/ship.md`); same `gh pr create --title --body` invocation flow; `loop.ts`'s `execFile` shell-out shape is the runtime pattern
  - files (NEW):
    - `packages/harness-opencode/src/autopilot/auto-ship.ts` — `autoShip({ planPath, repoRoot, dryRun }): Promise<{ prUrl: string }>` — runs `git push -u origin <branch>` then `gh pr create`
    - `packages/harness-opencode/test/auto-ship.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/autopilot-cmd.ts` — add `ship: flag({ long: "ship", ... })`; pass through to the runner
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — after `generateChangeset` (4.6), if `opts.ship` is true, call `autoShip` and include the PR URL in the final result message
  - context (existing `autopilot-cmd.ts` flags, lines 18-32):
    ```ts
    args: {
      plan: option({ long: "plan", short: "p", type: optional(stringType), description: "Path to an existing plan ..." }),
      fast: flag({ long: "fast", short: "f", description: "Use the fast executor model ..." }),
    },
    ```
    Add: `ship: flag({ long: "ship", description: "Auto-push branch and open PR after all phases complete." })`.
  - context (gh CLI invocation shape — heredoc for body, per AGENTS.md):
    ```bash
    gh pr create \
      --title "<title from plan H1>" \
      --body "$(cat <plan-main.md path>)"
    ```
    Use `execFile("gh", ["pr", "create", "--title", title, "--body-file", mainMdPath])` to avoid shell escaping bugs.
  - context (hard rules from AGENTS.md / autopilot safety invariants — these MUST be enforced):
    - Never `git push --force` or `git push -f`
    - Never push to `main` or `master` directly
    - Never merge a PR without explicit user instruction
    - Never use `--no-verify`
  - conventions: `--ship` defaults to `false` — autopilot stops at "all phases complete" by default and prints `run \`/ship\` to finalize`; PR title uses the plan's H1 heading verbatim; PR body is the literal contents of `main.md` (not a derived summary); branch name comes from `git rev-parse --abbrev-ref HEAD` — must NOT be `main`/`master` (abort with error); `bun:test` with mocked `execFile`; named exports.

- [x] 4.8 **Per-item execution for fast models.** For the `autopilot-execute` tier, instead of sending the entire phase to the agent, send one item at a time. After each item completes (checkbox checked + verify passes), send the next item. This keeps the context minimal and prevents fast models from getting confused by multi-item phases. Falls back to per-phase for deep models.

  - mirror: `packages/harness-opencode/src/autopilot/loop-session.ts`'s per-phase loop (lines 231-273) — same shape, finer granularity; `plan-parser.ts`'s `parseItems` returns the items in order
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — when `opts.fast === true` AND the resolved tier is `autopilot-execute`, replace the per-phase prompt with a per-item loop: for each unchecked `PlanItem`, build a focused prompt containing only that item + the phase goal/constraints
  - context (`loop-session.ts` current per-phase prompt, lines 235-241):
    ```ts
    const prompt =
      `You are executing one phase of a multi-file plan. Work through every unchecked item in order. Check each box as you complete it. Commit when the phase is done.\n\n` +
      `## Overall goal\n${goal}\n\n` +
      `## Constraints\n${constraints}\n\n` +
      `## Your phase (${phaseFile})\n${phaseContent}\n\n` +
      `Do not work on items from other phases. Do not ask questions — pick sensible defaults and note decisions in ## Open questions.`;
    const result = await _runRalphLoop({ prompt, cwd: opts.cwd, agentName: opts.fast ? "autopilot-fast" : undefined });
    ```
    Replace with (when fast):
    ```ts
    const items = parseItems(phaseContent).filter((i) => !i.checked);
    for (const item of items) {
      const itemPrompt =
        `You are executing ONE item of a multi-item phase. ...\n\n## Overall goal\n${goal}\n\n## Constraints\n${constraints}\n\n` +
        `## Your item\n- [ ] id: ${item.id}\n  intent: ${item.intent}\n  files: ${item.files.map(f => f.path).join(", ")}\n  verify: ${item.verify}\n\n` +
        `Complete this item only. Mark the checkbox in ${phaseFile} when done. Commit. Do not work on other items.`;
      const itemResult = await _runRalphLoop({ prompt: itemPrompt, cwd: opts.cwd, agentName: "autopilot-fast" });
      // re-read phaseContent to detect the checkbox state
    }
    ```
  - context (tier detection — reuse the same logic as `loop.ts` lines 196-204): when `agentName === "autopilot-fast"` AND `opts.fast === true`, the resolved tier is `autopilot-execute`. The per-item path activates only for this tier.
  - context (the existing structured handoff for strict executors from PRIME's system prompt — per-item prompts should follow the same "Files / Verify / Non-goals" structured-context block format):
    ```
    Files you may touch (ONLY these): - <path> (CREATE|EDIT)
    Verify command (must exit 0): <bash>
    Non-goals: Do NOT modify <other files>
    ```
  - conventions: per-item path is opt-in via tier detection — never apply to deep models (they handle multi-item phases fine); each item runs a fresh session via `_runRalphLoop` (the loop function creates the session internally); per-item iteration cap inherits from 2.7's `maxIterationsPerPhase` divided by item count (or a separate `maxIterationsPerItem` constant — default 5); `bun:test` with mocked `runRalphLoop` to verify item-by-item dispatch order; named exports; ESM `.js` imports.
