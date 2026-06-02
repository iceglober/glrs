# Changelog

## 3.5.2

### Patch Changes

- [#281](https://github.com/iceglober/glrs/pull/281) [`96d5509`](https://github.com/iceglober/glrs/commit/96d5509facb3a4fd03c4df577124c71e82dcfe2e) Thanks [@iceglober](https://github.com/iceglober)! - Reliably deliver telemetry on short and interrupted sessions.

  The Counted SDK only flushes buffered events on a 30s timer or once 50 events
  accumulate. A session that ends sooner — or is Ctrl-C'd (SIGINT discards the
  buffer and `beforeExit` never fires) — lost all of its events. The harness now
  flushes on `session.idle` (fired when the agent finishes a turn, before the user
  interrupts or closes) and on `session.error`, so events from any real session
  actually reach Counted. Bounded and fail-silent; never blocks the session.

## 3.5.1

### Patch Changes

- [#279](https://github.com/iceglober/glrs/pull/279) [`2d66f85`](https://github.com/iceglober/glrs/commit/2d66f85fd9f6a050134c503ac868ea860f8f6f75) Thanks [@iceglober](https://github.com/iceglober)! - Fix telemetry: send events to the live Counted ingest host.

  The `@counted/sdk` defaults its ingest host to `https://counted.dev`, which has
  no DNS record — so every tracked event silently vanished into a failed POST. Both
  the CLI and harness analytics now point at the live host `https://app.counted.dev`
  (verified to return HTTP 202), overridable via `COUNTED_HOST`. No events were
  delivered before this fix.

## 3.5.0

### Minor Changes

- [#277](https://github.com/iceglober/glrs/pull/277) [`beafa60`](https://github.com/iceglober/glrs/commit/beafa60492ee983ba23e52ab5fb7c1780861b28c) Thanks [@iceglober](https://github.com/iceglober)! - Add privacy-first session telemetry via Counted.

  The harness now emits anonymous events to help prioritize work:

  - `model_turn` — per finalized assistant message: token speed (tps), cost, token
    counts, and outcome, all keyed by provider/model.
  - `tool_used` — per tool call: the tool name, a best-effort success flag, and the
    skill name when the call is a skill invocation.
  - `post_edit_verify` — the result of the automatic post-edit `tsc` check
    (clean vs. error count).

  No cookies, no fingerprinting, no PII — never repo names, branch names, paths,
  prompts, or arguments; properties are public model/provider ids, enums,
  booleans, and counts only. Tracking never blocks or breaks a session and a dead
  network can never delay it. On by default with an embedded write-only ingest key
  (POST-only, cannot read data); `COUNTED_KEY` overrides it. Opt out with
  `DO_NOT_TRACK=1` or `GLRS_NO_ANALYTICS=1`.

## 3.4.0

## 3.3.1

### Patch Changes

- [#264](https://github.com/iceglober/glrs/pull/264) [`f48ef1c`](https://github.com/iceglober/glrs/commit/f48ef1c27a6c76f5a3d4d422190b7f5d6297d5c4) Thanks [@iceglober](https://github.com/iceglober)! - fix(harness): plugin failed to load in opencode ("Cannot find module '@opencode-ai/plugin'")

  The published plugin's `dist/index.js` did runtime imports of `@opencode-ai/plugin`
  (the `tool` helper used by the custom tools) and `zod`, both left external. opencode
  installs each plugin into its own cache, but a `@glrs-dev/agent-core: "workspace:*"`
  spec leaking into the published `devDependencies` made that install abort
  (`EUNSUPPORTEDPROTOCOL workspace:`), so no deps — including `zod` — were present at
  load time. The whole harness then failed to load: no agents, commands, or MCPs.

  Fix: bundle `@opencode-ai/plugin` and `zod` into the plugin entry (tsup `noExternal`),
  so `dist/index.js` has zero third-party runtime dependencies and loads even when
  opencode's cache dep-install fails. (`@opencode-ai/sdk` stays external — every import
  of it is type-only and erased at build.)

  This makes the published plugin self-contained and robust to the dep-install failure;
  the `workspace:*` leak is now harmless to loading. (Removing the leak itself requires a
  publish-time manifest fix — `agent-core` is a build-time-only workspace dep — tracked
  separately so it doesn't risk this hotfix.)

## 3.3.0

### Minor Changes

- [#262](https://github.com/iceglober/glrs/pull/262) [`3aff060`](https://github.com/iceglober/glrs/commit/3aff060ec80e239ce0f50a747371b50ab7e8f96a) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): make scoper, plan, and build non-primary agents

  `scoper`, `plan`, and `build` move from `mode: "all"` to `mode: "subagent"`, so
  they no longer appear in OpenCode's interactive primary-agent picker (Tab). This
  declutters the picker down to the true entry points: `prime`, `prime-heavy`,
  `designer`, and `research`.

  They remain fully dispatchable — `@prime` delegates to them via the task tool,
  the scoper wizard and autopilot drive them programmatically (agent selection by
  name works regardless of mode), and you can still invoke them directly with
  `@scoper` / `@plan` / `@build`. The docs agent table now lists them under
  Subagents. No change to model tiers, prompts, or permissions.

## 3.2.0

### Minor Changes

- [#260](https://github.com/iceglober/glrs/pull/260) [`97f9637`](https://github.com/iceglober/glrs/commit/97f9637e8a01f41b3d71f65924c594862e1f49b3) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): internal dev presets for A/B-ing per-agent models/prompts

  Adds `glrs harness dev-preset <id> -- <command>` (internal/dev — hidden from
  `glrs harness --help`). A preset is a named set of per-agent `{model, prompt}`
  overrides; the command exports it as `GLRS_AGENT_OVERRIDES` plus a
  `GLRS_DEV_PRESET=<id>` tag and runs the given command, e.g.
  `glrs harness dev-preset 1 -- opencode`.

  Presets are bundled in the package and overridable/extendable via
  `~/.glrs/dev-presets.json`. The cost-tracker and dispatch-tracker now stamp a
  `preset` field into their JSONL logs, so spend, speed, and dispatch counts can
  be correlated per preset by a downstream analytics tool.

## 3.1.0

## 3.0.1

### Patch Changes

- [#254](https://github.com/iceglober/glrs/pull/254) [`ba7a0c0`](https://github.com/iceglober/glrs/commit/ba7a0c059cbe64a9c9696562a1d4c8aa595a15b1) Thanks [@iceglober](https://github.com/iceglober)! - refactor: extract agent identity into `@glrs-dev/agent-core` and generate reference docs from code

  - New private, framework-agnostic package `@glrs-dev/agent-core` holds the single source of truth for agent names, tiers, and doc metadata (`AGENTS`, `AGENT_TIERS`, `AGENT_DOC_META`). It's bundled into the published harness and CLI (no new runtime dependency), and is ready to be shared by a future Claude Code harness plugin.
  - The OpenCode harness, autopilot, and the CLI adapters now import these constants instead of hard-coding agent-name strings, so a rename is a single edit.
  - `dispatch-tracker` now derives an agent's tier from the authoritative `AGENT_TIERS` map (covering every registered agent) before falling back to name-suffix heuristics.
  - New `bun run gen-docs` regenerates the docs-site agent, command, and skills reference pages from code (`bun run gen-docs:check` guards drift), and a new Skills page is added to the docs site.

  No public API changes to the published packages.

## 3.0.0

### Major Changes

- [#251](https://github.com/iceglober/glrs/pull/251) [`58c9b49`](https://github.com/iceglober/glrs/commit/58c9b4979606ab9d071420b0dbcd0fa960e188ec) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): prime-ultra is now the default `prime` agent

  Breaking: `prime` is now the Sonnet orchestrator (was Opus). Opus orchestration is available as `prime-heavy`. Legacy agents removed: `prime-legacy`, `plan-legacy`, `plan-legacy-cheap`.

## 2.31.0

### Minor Changes

- [#249](https://github.com/iceglober/glrs/pull/249) [`9576a7f`](https://github.com/iceglober/glrs/commit/9576a7fa541c35a8e4ca784e0d2091e52b106512) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): prime-ultra proactive delegation to Opus

  Research-validated improvement to prime-ultra's escalation judgment (5.05 → 9.05/10):

  - Proactive Opus escalation for known-hard problem classes: concurrency/race conditions, deep dependency chains, state machine logic, correctness proofs
  - Reasoning-depth test before every @build dispatch: "Can I articulate root cause in one sentence?"
  - Mandatory deep-dispatch context block: structured handoff with symptom, call chain, prior attempts, hypothesis, and constraints

## 2.30.0

### Minor Changes

- [#247](https://github.com/iceglober/glrs/pull/247) [`67f2f2b`](https://github.com/iceglober/glrs/commit/67f2f2b064eee92578385eb5e5d16668bb5b0528) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): headroom tool-output compression — provider-agnostic

  The harness now compresses large tool outputs through headroom's local compression
  service (if running). Works with any LLM provider (Bedrock, Anthropic, OpenAI).
  Falls back to built-in truncation when headroom isn't available.

  Also removes the old proxy-redirect approach from `glrs headroom init` — headroom
  is now a compression service, not an API proxy.

## 2.29.3

## 2.29.2

## 2.29.1

## 2.29.0

## 2.28.2

### Patch Changes

- [#233](https://github.com/iceglober/glrs/pull/233) [`468560c`](https://github.com/iceglober/glrs/commit/468560c8a0109aea43c336cb075679525bc3557c) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): repeated-failure escalation rule for prime-ultra
  fix(docs): SPA routing on GCS (404 → index.html)

## 2.28.1

### Patch Changes

- [#216](https://github.com/iceglober/glrs/pull/216) [`0e76646`](https://github.com/iceglober/glrs/commit/0e766469bbde0ac4ce554cac2985bdbecaa3a24c) Thanks [@iceglober](https://github.com/iceglober)! - docs: comprehensive documentation revamp + brutalist docs site redesign

## 2.28.0

### Minor Changes

- [#218](https://github.com/iceglober/glrs/pull/218) [`c123106`](https://github.com/iceglober/glrs/commit/c123106b52cb902517af466521ecc1a1e610217d) Thanks [@iceglober](https://github.com/iceglober)! - Add cost-optimized ultra agent series alongside standard agents

  **New agent tiers:**

  - **Standard** (default): `prime` and `plan` now use the wave-based DAG execution prompt (promoted from former `prime-ultra`/`plan-ultra`). Opus orchestration — same behavior as before, now the default.

  - **Ultra** (cost-optimized): `prime-ultra` runs the same prompt on Sonnet (~5x cheaper orchestration), delegating planning to `@plan-ultra` (Opus) and execution to `@build-cheap` (GLM) or `@build` (Sonnet). Validated at 50-60% lower total cost with identical test pass rates.

  - **Legacy** (fallback): `prime-legacy` and `plan-legacy` preserve the original non-DAG prompts for workflows that don't need parallel wave dispatch.

  **Tier routing architecture:**

  - Opus for planning + judgment (high-value architectural reasoning)
  - Sonnet for orchestration (rule-following, context construction, dispatch routing)
  - GLM for pattern-matching execution (when mirrors exist)

  Also includes cascade decomposition prompt improvements and new eval infrastructure for testing cheap model accuracy on real codebases.

## 2.27.2

### Patch Changes

- [#214](https://github.com/iceglober/glrs/pull/214) [`32b4f27`](https://github.com/iceglober/glrs/commit/32b4f2731055fadd850c94408a4b0a08478034b7) Thanks [@iceglober](https://github.com/iceglober)! - fix(harness): reduce stall detector false positives — require intent language, suppress during tool/subagent execution

## 2.27.1

### Patch Changes

- [#211](https://github.com/iceglober/glrs/pull/211) [`cf0cfc2`](https://github.com/iceglober/glrs/commit/cf0cfc2e1135000cea242c74ad9e4658757e5c14) Thanks [@iceglober](https://github.com/iceglober)! - fix(harness): suppress stall detector on completion messages

  The stall detector was nudging sessions that had legitimately finished — "STATUS: DONE", "no further action", "PR is open". Now checks the last message text for completion signals before firing the watchdog.

## 2.27.0

### Patch Changes

- [#209](https://github.com/iceglober/glrs/pull/209) [`8189f66`](https://github.com/iceglober/glrs/commit/8189f6627cc84597102a16cc113033317b6efe59) Thanks [@iceglober](https://github.com/iceglober)! - feat(cli): `glrs harness hooks init` scaffolds example hooks and extensions

  - Add `glrs harness hooks init` — writes example `.glrs/hooks/` and `.glrs/extensions/` files to the current repo. Does not overwrite existing files.
  - Rename hooks to snake_case: `wt-new` → `wt_new`, `fresh-reset` → `fresh_init`
  - Wire all workflow commands (/ship, /fresh, /review, /research, /init-deep) to read `.glrs/extensions/<command>.md`

## 2.26.2

### Patch Changes

- [#207](https://github.com/iceglober/glrs/pull/207) [`d25067e`](https://github.com/iceglober/glrs/commit/d25067e7d6a93afc0a98325d86acbf7af35f6762) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): all commands read `.glrs/extensions/<command>.md`

  All workflow commands (/ship, /fresh, /review, /research, /init-deep) now read an optional extension file from the repo and append it to the command prompt. Repos can customize command behavior without forking the harness.

## 2.26.1

### Patch Changes

- [#205](https://github.com/iceglober/glrs/pull/205) [`5b53b96`](https://github.com/iceglober/glrs/commit/5b53b96aed800aa4dc8353bd5e7ca4e443824209) Thanks [@iceglober](https://github.com/iceglober)! - fix(harness): suppress stall detector during in-flight tool calls, add PRIME decomposition rules

  - Stall detector now tracks `activeToolCalls` per session — suppresses false-positive nudges while subagents, long-running bash commands, or background tasks are in-flight
  - Add mandatory task decomposition guidance to PRIME prompts: per-file subtask rule, multi-package split requirement, concrete examples, and explicit anti-pattern (never dispatch entire phase as one call)

## 2.26.0

### Minor Changes

- [#203](https://github.com/iceglober/glrs/pull/203) [`5446a11`](https://github.com/iceglober/glrs/commit/5446a1189ce74861374438e876f9100911ab43c9) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): local dispatch tracker, remove TelemetryDeck, disable cheap cascading

  - Remove TelemetryDeck telemetry entirely — no data leaves the machine
  - Replace telemetry-based dispatch tracking with local file-based tracker (`~/.glrs/opencode/dispatches.jsonl` + `dispatches.json`)
  - Add `/dispatches` command to view agent dispatch counts by tier and agent
  - Disable cheap-tier cascading in PRIME prompts — @build/@plan (standard tier) is now the default dispatch target. Cheap cascading caused production failures (git conflicts, scope confusion, truncated output from GLM models on multi-package tasks)

## 2.25.0

### Minor Changes

- [#201](https://github.com/iceglober/glrs/pull/201) [`4b073bf`](https://github.com/iceglober/glrs/commit/4b073bf5d8388c9fa4e14bf5e1fd0287dcf79fff) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): switch cheap tier to GLM 4.7 Flash and add tier to telemetry

  - Default cheap-tier model changed from `zai.glm-5` ($1/$3.20) to `zai.glm-4.7-flash` ($0.07/$0.40) — ~12x cheaper than Haiku
  - Add `tier` to the telemetry allowlist so `subagent.dispatch` events include the resolved tier (cheap/mid-execute/fast/deep) in TelemetryDeck
  - Enables cascade efficacy measurement: correlate cheap-tier dispatches with escalation patterns

## 2.24.2

### Patch Changes

- [#199](https://github.com/iceglober/glrs/pull/199) [`bb98089`](https://github.com/iceglober/glrs/commit/bb98089db8dc62594d45e3fc65f3251bd49c6f3b) Thanks [@iceglober](https://github.com/iceglober)! - fix(harness): redesign `configure` TUI for clarity and usability

  - Model search shows `provider/model_id` (the actual config value) instead of `provider/Model Name`
  - Tier list uses aligned two-column layout: tier name left, value right, with agent list shown on focus
  - Configured tiers display in cyan, unconfigured show fallback chain in dim
  - Cost display uses explicit `in: $X  out: $Y` format instead of cryptic `$X/$Y`
  - Main menu shows compact two-line Models summary (deep + mid) instead of all 6 tiers
  - Add `promptSelect` helper supporting rich choices with descriptions and separators

## 2.24.1

## 2.24.0

### Minor Changes

- [#195](https://github.com/iceglober/glrs/pull/195) [`6244a31`](https://github.com/iceglober/glrs/commit/6244a31f733cd54529b12906726139bb4e925f78) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): searchable model picker and full tier coverage in `configure`

  - Replace the two-step provider→model selection with a single searchable list (type to filter by provider, model name, or cost)
  - Add missing `cheap` tier so cascading-first-pass models are configurable
  - Show all 6 tiers (deep, mid, mid-execute, autopilot, fast, cheap) with their agent lists and fallback chains
  - Fetch models once per session instead of per-tier-change

## 2.23.1

### Patch Changes

- [#193](https://github.com/iceglober/glrs/pull/193) [`1461ca7`](https://github.com/iceglober/glrs/commit/1461ca7d78e473545799a2ad13798114cb87e8cd) Thanks [@iceglober](https://github.com/iceglober)! - Fix self-update cache-dir path. `getOpenCodeCachePackageDir()` was looking at `~/.cache/opencode/packages/@glrs-dev/harness-opencode@latest/`, but opencode actually writes the cache at `harness-plugin-opencode@latest/` (matching the package name). The mismatch made every release return `cache-missing` and silently fall through, forcing users to manually `rm -rf` the cache after each release. The self-update hook already ran every session and did the right thing — it was just pointed at a non-existent directory.

## 2.23.0

### Minor Changes

- [#191](https://github.com/iceglober/glrs/pull/191) [`e4fb192`](https://github.com/iceglober/glrs/commit/e4fb1921cd21ff792bc2b1d50404b5c929e691ca) Thanks [@iceglober](https://github.com/iceglober)! - Add `@plan-ultra-cheap` agent — preserves PRIME-ULTRA's wave-based DAG dispatch when cascading to the cheap tier. Same DAG-writing prompt as `@plan-ultra`, runs on `amazon-bedrock/zai.glm-5`. PRIME-ULTRA's cascading table now points to `@plan-ultra-cheap` instead of `@plan-cheap` so the cheap-tier plan still includes `## Execution DAG`. `@plan-cheap` remains for standard PRIME, which doesn't need DAG output.

## 2.22.0

### Minor Changes

- [#190](https://github.com/iceglober/glrs/pull/190) [`0fd62f4`](https://github.com/iceglober/glrs/commit/0fd62f44d8317b864a4954f7c48a04ca3aad9b24) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): cost-aware model cascading via cheap-tier agents

  Implements [FrugalGPT](https://arxiv.org/abs/2305.05176) (Chen et al. 2023) cost-cascading by adding three new subagents that share prompts with existing agents but run on different models:

  - `@build-cheap` — same prompt as `@build`, runs on `amazon-bedrock/zai.glm-5`. Default first dispatch for cost-aware cascading.
  - `@build-deep` — same prompt as `@build`, runs on `anthropic/claude-opus-4-7`. Deep escalation tier.
  - `@plan-cheap` — same prompt as `@plan`, runs on GLM. For trivial-to-medium plans.

  New `cheap` model tier added to `AGENT_TIERS`. Users can override the cheap-tier model in opencode.json via `harness.models.cheap`. Falls back to `fast` tier if unconfigured.

  PRIME and PRIME-ultra prompts updated with cascading rules:

  - Default dispatch to cheap tier
  - Escalate to standard tier on `[FAIL_SPEC]` from `@spec-reviewer`, `BLOCKED` with model-capability signals, or empty output
  - Escalate to deep tier on second failure
  - Skip cheap entirely for high-risk paths (security/auth/migrations/>10 files of substantial logic)

  New `dispatch-tracker` plugin emits `subagent.dispatch` telemetry (subagent name + tier) on every task tool call. Combined with existing `model.token_speed` and `tool.call` outcome events, this gives empirical data to tune cascading thresholds over time.

  **Why cheap-tier as separate agents (not a model-override parameter):** OpenCode's `task` tool does not accept a `model` parameter — each AgentConfig has a single hardcoded model. Implementing cascading at the agent level is the only mechanism the platform actually exposes.

### Patch Changes

- [#188](https://github.com/iceglober/glrs/pull/188) [`c4a2455`](https://github.com/iceglober/glrs/commit/c4a2455f3eb050f3925cb57e6ae29c037e284df2) Thanks [@iceglober](https://github.com/iceglober)! - fix(harness): recover stall-detector plugin dropped from PR [#186](https://github.com/iceglober/glrs/issues/186) squash merge

  The stall-detector plugin was added in PR [#186](https://github.com/iceglober/glrs/issues/186) but the squash merge captured only the first commit of the branch, dropping the plugin file. This PR restores it: a watchdog timer that fires after each assistant message finalization and nudges the session via `client.session.promptAsync()` if no tool call arrives within 45 seconds. Based on Wink (2026) — 94% recovery rate for stalled agents using asynchronous message injection.

## 2.21.1

### Patch Changes

- [#186](https://github.com/iceglober/glrs/pull/186) [`120a068`](https://github.com/iceglober/glrs/commit/120a068f4bd2f3a542bb6d1d4a049785f4082260) Thanks [@iceglober](https://github.com/iceglober)! - fix(harness): add anti-stall rules to all primary and executor agents

  Adds explicit anti-stall instructions to prime, prime-ultra, plan, plan-ultra, build, and build.open prompts. The stall pattern: the model describes what it will do next ("Let me check X", "Now I'll run Y") then stops generating without making the tool call. The anti-stall rules:

  - Iron-law fenced block: "NEVER STOP MID-TASK"
  - Self-check instruction: verify last output completed the described action
  - Common stall patterns enumerated (plan-without-execute, prose-instead-of-tool-call)
  - Subagent stall detection guidance for PRIME: re-dispatch or proceed without result
  - Build agents: every turn must end with a completed action or explicit STOP/DONE/BLOCKED

## 2.21.0

### Minor Changes

- [#184](https://github.com/iceglober/glrs/pull/184) [`3b95289`](https://github.com/iceglober/glrs/commit/3b95289255af646ee4d83827acddd63ad63b74f6) Thanks [@iceglober](https://github.com/iceglober)! - feat: add .glrs/hooks/ and .glrs/extensions/ system

  **Hooks** (shell scripts, run by the CLI):

  - `.glrs/hooks/wt-new` — runs after `glrs wt new` creates a worktree. Receives the worktree path as $1 and WORKTREE_DIR + REPO_NAME as env vars. Use for: installing deps, setting up .env, running migrations, starting dev services.

  **Extensions** (agent prompt fragments, loaded by the harness):

  - `.glrs/extensions/post-ship.md` — appended to the `/ship` command's prompt. Use for: custom post-PR-creation behavior like "wait for auto-review, address feedback, monitor checks, get PR mergeable."

  Hooks are executable files that run synchronously with a 2-minute timeout. Extensions are markdown files whose content is injected into the agent's prompt at command dispatch time. Both are repo-level (committed, shared across worktrees).

## 2.20.0

### Minor Changes

- [#182](https://github.com/iceglober/glrs/pull/182) [`60700e1`](https://github.com/iceglober/glrs/commit/60700e107163126c211cd0b439b1bccdda717623) Thanks [@iceglober](https://github.com/iceglober)! - refactor(harness): rename .glorious to .glrs across all paths

  Migrates all internal references from `~/.glorious/` to `~/.glrs/`:

  - Plan storage: `~/.glrs/opencode/<repo>/plans/`
  - Cost tracker: `~/.glrs/opencode/costs.json`
  - Hooks: `.glrs/hooks/fresh-reset` (repo-level)
  - Worktrees: `~/.glrs/worktrees/`
  - Env vars: `GLRS_PLAN_DIR`, `GLRS_COST_TRACKER_DIR`, `GLRS_COST_TRACKER` (legacy `GLORIOUS_*` vars still read as fallback)

  External directory permissions allow both `~/.glrs/` and `~/.glorious/` paths for backward compat during migration. Source code, prompts, and tests all updated.

## 2.19.0

### Minor Changes

- [#180](https://github.com/iceglober/glrs/pull/180) [`f635283`](https://github.com/iceglober/glrs/commit/f63528302ca53a858321e2bd522b027cc6668e33) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): add plan-ultra agent, promote designer to primary, demote scoper

  - Add `plan-ultra` subagent — writes execution DAGs for wave-based dispatch by prime-ultra. Decoupled from standard `plan` so the two systems don't cross-contaminate.
  - Revert DAG additions from standard `plan.md` — standard plan stays clean for standard prime.
  - Promote `designer` to primary mode — user-selectable in TUI for direct UI/UX work.
  - Demote `scoper` from primary to all — still invocable by users via @scoper, but not in the primary agent selector.
  - Demote `plan-ultra` to subagent — only dispatched by prime-ultra, not user-selectable.

  Primary agents (TUI selector): prime, prime-ultra, designer.

## 2.18.0

### Minor Changes

- [#178](https://github.com/iceglober/glrs/pull/178) [`aa77f41`](https://github.com/iceglober/glrs/commit/aa77f4189a802644703440f65e01f9ba971f3ed1) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): add prime-ultra agent with wave-based DAG execution

  New `prime-ultra` primary agent that decomposes work into dependency waves and dispatches each wave in parallel. Instead of treating parallelism as all-or-nothing, prime-ultra constructs a full execution DAG before dispatching: `1 → (2,3) → 4 → (5,6,7) → 8` becomes four waves with maximal parallelism at each step.

  Wave-based execution applies across ALL SPEAR stages — not just Execute. Scope grounding, planning, building, and verification can all be interleaved as serial and parallel waves.

  Also extends the plan format with an `## Execution DAG` section that the @plan agent writes for multi-file plans. The DAG specifies which phases depend on which, enabling prime-ultra to dispatch mechanically rather than re-deriving dependencies at execution time.

  Standard `prime` agent is unchanged — users can switch between `prime` and `prime-ultra` in their agent selector.

## 2.17.0

### Minor Changes

- [#176](https://github.com/iceglober/glrs/pull/176) [`7cef98d`](https://github.com/iceglober/glrs/commit/7cef98de31bc6f6dab4f13aa2f8ac2348ad08f2a) Thanks [@iceglober](https://github.com/iceglober)! - feat(telemetry): migrate from PostHog to TelemetryDeck

  Replaces the PostHog telemetry backend with TelemetryDeck. Same privacy guarantees (property allowlist, no PII, opt-out via env vars). TelemetryDeck uses a public write-only App ID (no secret needed), making it suitable for open-source distribution. Events use TelemetryDeck's `isTestMode` flag for dev/production separation and `floatValue` for numeric aggregation of durations.

## 2.16.0

### Minor Changes

- [#174](https://github.com/iceglober/glrs/pull/174) [`d071813`](https://github.com/iceglober/glrs/commit/d0718131f883abeea1f8e3fd664d39dd27b4c27c) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): add @designer agent + ux-for-ai skill

  New `@designer` subagent for UI/UX design work. PRIME dispatches it for building interfaces, auditing designs, choosing typography/color/layout, or diagnosing UX issues. Loads both `design-for-ai` and `ux-for-ai` skills for principle-driven design grounded in Kadavy, Tufte, Refactoring UI, Every Layout, and Norman. Runs on Sonnet tier with BUILD_PERMISSIONS.

  Also bundles the `ux-for-ai` skill (Norman's Design of Everyday Things + Emotional Design) with 8 chapter reference files covering the two gulfs, discoverability, feedback, mental models, constraints, and the visceral/behavioral/reflective joy layers.

## 2.15.0

### Minor Changes

- [#172](https://github.com/iceglober/glrs/pull/172) [`2f18be5`](https://github.com/iceglober/glrs/commit/2f18be5d900d971d8519c66e741b387329c07609) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): add design-for-ai skill — visual design principles for building organic-feeling UI

  Bundled skill that teaches agents to apply real design theory (Kadavy, Tufte, Refactoring UI, Every Layout) when building or reviewing frontend code. Includes CHECKER mode (10-category audit) and APPLIER mode (8-phase gated workflow). Research-tested: live agent evaluation scored 8.45/10 on organic feel, visual system coherence, code quality, and craft details.

## 2.14.0

### Minor Changes

- [#170](https://github.com/iceglober/glrs/pull/170) [`67510c4`](https://github.com/iceglober/glrs/commit/67510c462b5cd2e40a6f95e992c5096b4c4a12a9) Thanks [@iceglober](https://github.com/iceglober)! - feat(telemetry): migrate from Aptabase to PostHog

  Replaces the Aptabase telemetry backend with PostHog. Same privacy guarantees (property allowlist, no PII, opt-out via env vars), but PostHog supports property-level breakdowns, filtering, and grouping in the dashboard — enabling analysis like token speed by model.

## 2.13.0

### Minor Changes

- [#168](https://github.com/iceglober/glrs/pull/168) [`d2d4c26`](https://github.com/iceglober/glrs/commit/d2d4c260347d85bba77f50d4ddafef54ad877cc0) Thanks [@iceglober](https://github.com/iceglober)! - feat(telemetry): emit token speed per model as Aptabase events

  On each finalized assistant message, emits a `model.token_speed` event with: model ID, provider ID, output token count, generation duration, and tokens/second (tps). No file paths, prompts, or content — just model performance metrics.

### Patch Changes

- [#168](https://github.com/iceglober/glrs/pull/168) [`d2d4c26`](https://github.com/iceglober/glrs/commit/d2d4c260347d85bba77f50d4ddafef54ad877cc0) Thanks [@iceglober](https://github.com/iceglober)! - fix(auto-update): handle caret/tilde ranges in plugin cache

  The auto-updater skipped caret (`^2.10.10`) and tilde (`~2.10.10`) ranges as "user-managed", but OpenCode's default cache uses `^` ranges. The lockfile pins the resolved version, so updates never landed — users stayed on the version from their first install indefinitely. Now treats `^`/`~` ranges the same as exact pins: extracts the base version, compares, and triggers a refresh when a newer version is available. Also deletes all lockfile formats (npm, bun) instead of rewriting just `package-lock.json`.

## 2.12.0

### Minor Changes

- [#166](https://github.com/iceglober/glrs/pull/166) [`037a9c1`](https://github.com/iceglober/glrs/commit/037a9c1cc0a42eefd58a75a2fc0efc54547f902b) Thanks [@iceglober](https://github.com/iceglober)! - feat(telemetry): emit token speed per model as Aptabase events

  On each finalized assistant message, emits a `model.token_speed` event with: model ID, provider ID, output token count, generation duration, and tokens/second (tps). No file paths, prompts, or content — just model performance metrics.

## 2.11.2

### Patch Changes

- [#164](https://github.com/iceglober/glrs/pull/164) [`45a7550`](https://github.com/iceglober/glrs/commit/45a7550e64b9dd06fe677fe2f551e2a348c43fba) Thanks [@iceglober](https://github.com/iceglober)! - fix(telemetry): use correct Aptabase batch endpoint

  The ingestion endpoint was `/api/v0/event` (singular, single object body) — Aptabase's actual API is `/api/v0/events` (plural, array body). The old endpoint returned 200 but silently dropped every event. This is why no events appeared in either the debug or production dashboard.

## 2.11.1

### Patch Changes

- [#162](https://github.com/iceglober/glrs/pull/162) [`3459b1e`](https://github.com/iceglober/glrs/commit/3459b1effa931753ebc044ddcb87e8f3db32f100) Thanks [@iceglober](https://github.com/iceglober)! - fix(telemetry): use production mode for published builds

  `isDebug` was keyed off `NODE_ENV !== "production"`, which is never true in a user's terminal — so every event was tagged as debug and filtered from Aptabase's production dashboard. Now uses `PKG_VERSION === "dev"` instead: published npm builds (where tsup bakes in the real version) report as production; unbundled dev/test runs report as debug.

## 2.11.0

### Minor Changes

- [#161](https://github.com/iceglober/glrs/pull/161) [`c7d206e`](https://github.com/iceglober/glrs/commit/c7d206e3a6e48d555b9561cb8821634c7483280c) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): more aggressive delegation from PRIME to subagents

  - Replace context firewall with deterministic delegation decision tree (evaluate in order, stop at first match)
  - Add `DEFAULT: DELEGATE` iron-law framing with concrete thresholds at every rule
  - Add @plan to routing table, multi-file tiebreaker, 2-file edge case handling
  - Make reviewer sequencing conditional-explicit with "never batch spec + code reviewer" carve-out
  - Add Scope-stage and Plan-stage delegation sections for parallel @code-searcher + @lib-reader dispatch
  - Broaden parallel-dispatch plugin to track all subagent types and nudge batching
  - Add telemetry for general subagent serial vs parallel dispatch patterns

## 2.10.26

## 2.10.25

## 2.10.24

## 2.10.23

## 2.10.22

## 2.10.21

## 2.10.20

## 2.10.19

## 2.10.18

## 2.10.17

## 2.10.16

## 2.10.15

## 2.10.14

## 2.10.13

## 2.10.12

## 2.10.11

## 2.10.10

### Patch Changes

- [#116](https://github.com/iceglober/glrs/pull/116) [`6eeda55`](https://github.com/iceglober/glrs/commit/6eeda55873110c7732eacb611b43df08c03e6350) Thanks [@iceglober](https://github.com/iceglober)! - Add Aptabase telemetry to parallel-dispatch hook: emits `subagent.dispatch.serial` or `subagent.dispatch.parallel` with `ops_count` on each Execute batch to track how often PRIME uses parallel subagents in production.

## 2.10.9

### Patch Changes

- [#114](https://github.com/iceglober/glrs/pull/114) [`d987e11`](https://github.com/iceglober/glrs/commit/d987e1197e8ee62cbd40dad8e9f4f3cfc5944c07) Thanks [@iceglober](https://github.com/iceglober)! - Speed up PRIME sessions: downgrade gap-analyzer and plan-reviewer to Sonnet, add pre-Assess session-green timestamps, and add sisyphus-style parallel-dispatch enforcement hook. Fix autopilot conflict graph silently falling back to sequential for enriched YAML specs.

## 2.10.8

## 2.10.7

### Patch Changes

- [#109](https://github.com/iceglober/glrs/pull/109) [`39a16fb`](https://github.com/iceglober/glrs/commit/39a16fb66ffd817ef82436106d8d6fa1b78bc0e9) Thanks [@iceglober](https://github.com/iceglober)! - Restructure PRIME Execute supplements to make parallel subagent dispatch the default path and require explicit justification for sequential. Replace conditional "conflict graph" analysis with a mandatory dispatch-mode gate that biases toward parallel.

## 2.10.6

## 2.10.5

## 2.10.4

## 2.10.3

## 2.10.2

### Patch Changes

- [#98](https://github.com/iceglober/glrs/pull/98) [`a230910`](https://github.com/iceglober/glrs/commit/a23091090be18f567a924bdd8ccbaa81f9942e64) Thanks [@iceglober](https://github.com/iceglober)! - fix(harness): resolve plan directory at config time instead of via bash snippet

  The plan agent's bash permissions blocked compound commands, preventing it from
  running the inline plan-dir resolution snippet. The plan directory is now resolved
  synchronously at plugin config time and injected into the plan and scoper prompts
  as a pre-resolved path. The plan agent's bash permission is simplified to a flat
  deny since it no longer needs bash for plan-dir resolution.

## 2.10.1

### Patch Changes

- [#96](https://github.com/iceglober/glrs/pull/96) [`07b0f45`](https://github.com/iceglober/glrs/commit/07b0f4574dfd87209d4375bcf4ec2a97c46c8749) Thanks [@iceglober](https://github.com/iceglober)! - Enable task tool on PRIME agents so parallel subagent dispatch actually works

  PR [#85](https://github.com/iceglober/glrs/issues/85) added parallel build dispatch instructions to the PRIME prompt but
  never added `tools: { task: true }` to the agent config. The OpenCode SDK
  strips the task tool by default — without explicit opt-in, PRIME could not
  dispatch `@build` subagents at all. Fixed for `prime`, `autopilot-prime`,
  and `autopilot-fast`.

## 2.10.0

## 2.9.2

## 2.9.1

## 2.9.0

### Minor Changes

- [#85](https://github.com/iceglober/glrs/pull/85) [`e008596`](https://github.com/iceglober/glrs/commit/e008596aba81fa0942c9299f74c35be922e85a80) Thanks [@iceglober](https://github.com/iceglober)! - Add `glrs upgrade` command (bypasses bun's stale cache). PRIME now dispatches parallel @build subagents for multi-phase plans with disjoint file sets.

## 2.8.0

## 2.7.0

### Minor Changes

- [#81](https://github.com/iceglober/glrs/pull/81) [`b0d02dc`](https://github.com/iceglober/glrs/commit/b0d02dcb3ab8636445c4d0317ccd61dc9581bdff) Thanks [@iceglober](https://github.com/iceglober)! - Simplify CLI deployment model and fix runtime module resolution.

  **Breaking (harness-plugin-opencode):**

  - Remove `bin` field — the package no longer ships standalone `glrs-oc` / `harness-opencode` binaries. Users should install `@glrs-dev/cli` and use `glrs harness install|configure|doctor|uninstall`.
  - Add `./cli` subpath export for CLI handler functions consumed by `@glrs-dev/cli`.

  **CLI:**

  - Add `glrs harness` subcommand (install, configure, uninstall, doctor) — replaces the old `glrs oc` subprocess dispatch.
  - Deprecate `glrs oc` with a redirect notice pointing to `glrs harness`.
  - Fix deep import (`@glrs-dev/autopilot/src/model-resolver.js`) that crashed `glrs loop` when installed from npm.
  - Vendor harness-plugin-opencode into `dist/node_modules/` (same as autopilot/adapter) instead of the old `dist/vendor/` subprocess path.

  **CI:**

  - Skip Rust (gs-assume) build/test/clippy/fmt unless `packages/assume/**` files are touched.

## 2.6.0

### Minor Changes

- [#79](https://github.com/iceglober/glrs/pull/79) [`3d19166`](https://github.com/iceglober/glrs/commit/3d1916633ff6796238f08616c88038fd5b734174) Thanks [@iceglober](https://github.com/iceglober)! - Refactor harness subagent prompts for consistency and register `glrs loop` CLI subcommand.

  **Harness prompt refactor:**

  - Remove inline SPEAR protocol from prime.md (41% reduction); spear-protocol skill is now the sole canonical source
  - Consolidate three identical reviewer permission blocks into one shared `REVIEWER_PERMISSIONS` constant
  - Remove UI evaluation ladder from plan-reviewer and gap-analyzer (neither verifies web UI)
  - Remove repo-specific assumptions from docs-maintainer prompt
  - Fix broken bash snippet reference in scoper.md (was a placeholder, now the actual snippet)
  - Fix circular self-reference in plan.md defensive posture section
  - Standardize question-tool phrasing across all utility agents
  - Clean up research.md self-reference and redundant invocation docs
  - Update test assertions to match refactored content

  **CLI:**

  - Register `glrs loop` as a top-level subcommand (was defined but never routed)
  - Add `glrs autopilot` and `glrs loop` to help text

## 2.5.0

### Minor Changes

- [#74](https://github.com/iceglober/glrs/pull/74) [`65f9f2c`](https://github.com/iceglober/glrs/commit/65f9f2ce7fc0876aa69fdab1c789caaa927affc4) Thanks [@iceglober](https://github.com/iceglober)! - Make the autopilot workflow fully configurable via `.glrs/autopilot.yaml` so different teams, repos, and plans can customize behavior without code changes.

## 2.4.1

### Patch Changes

- [#75](https://github.com/iceglober/glrs/pull/75) [`9532a63`](https://github.com/iceglober/glrs/commit/9532a63157cc0edad7822452e710848052dde9fa) Thanks [@iceglober](https://github.com/iceglober)! - Fix `@glrs-dev/cli@2.4.0` install failure caused by `workspace:*` references to private packages leaking into the published tarball. The cli now vendors `@glrs-dev/autopilot` and `@glrs-dev/adapter-opencode` into its `dist/node_modules/` and strips workspace references from the published `package.json`.

## 2.4.0

### Minor Changes

- [#72](https://github.com/iceglober/glrs/pull/72) [`0aa23d4`](https://github.com/iceglober/glrs/commit/0aa23d432d92f9349dc3f3c37994e336dc19d197) Thanks [@iceglober](https://github.com/iceglober)! - Wave 2 — autopilot execution reliability and resume.

  - **Transient error retry.** `sendAndWait` errors classified as transient (network blips, 429, 5xx, throttling) trigger up to 3 attempts with exponential backoff (1s → 2s → 4s, capped at 30s). Permanent errors (400, validation) fail immediately.
  - **Resume from checkpoint.** `--resume` reads `.agent/autopilot-checkpoint.json` and skips already-completed phases (when the checkpoint's `planPath` matches the current `--plan`). The checkpoint is written atomically after each phase and deleted on successful run completion.
  - **Adaptive stall timeout.** The per-iteration stall timeout now adapts to the model tier: deep=30m, mid=15m, mid-execute/autopilot-execute=10m, fast=5m. Override with `--stall-timeout <ms>`.
  - **Graceful shutdown.** SIGINT/SIGTERM triggers a graceful shutdown: aborts the current iteration, commits any working-tree changes as `[WIP] autopilot interrupted`, writes a checkpoint, then exits. A second signal force-exits with code 130.
  - **Phase-level git safety.** In `--fast` mode, a failed phase soft-resets to the pre-phase HEAD so the user gets a clean state with all changes preserved in staging. Interactive mode leaves the work in place for manual review.
  - **Credential refresh detection.** API errors classified as `credential-expired` (AWS STS, Azure token) write a checkpoint and exit with code 2 + a clear message: "Run `gs-assume` and then `glrs oc autopilot --resume`."
  - **Per-phase iteration budget.** `--max-iterations-per-phase` (default: deep=5, mid-execute/fast=10) caps a single phase's iteration count. A phase that hits its budget without completing logs a warning, writes a checkpoint, and the run continues to the next phase rather than terminating.

## 2.3.0

### Minor Changes

- [#71](https://github.com/iceglober/glrs/pull/71) [`94704ad`](https://github.com/iceglober/glrs/commit/94704adf36b5ea36fde4557cfd7b1d8494d0e68b) Thanks [@iceglober](https://github.com/iceglober)! - Add `@debriefer` agent and post-run debrief to the autopilot CLI

  After the Ralph loop exits (any exit reason — sentinel, struggle, timeout, max-iterations, kill-switch, stall, or error), the CLI now optionally spawns a `@debriefer` agent session that produces a structured five-section summary:

  1. **What was accomplished** — files changed, commits made, PRs opened
  2. **What wasn't finished** — unchecked plan items
  3. **Cost summary** — total USD, iterations completed, exit reason
  4. **What to do next** — actionable suggestions based on exit reason
  5. **Session artifacts** — log file path, plan file path, session ID

  The debrief runs by default. Skip it with `--no-debrief` on the CLI or by setting `GLRS_AUTOPILOT_DEBRIEF=off` in the environment.

  The `@debriefer` agent is mid-tier (Sonnet-class), read-only (no file edits, bash limited to git read commands), and never throws — if the debrief session fails, a warning is printed and the CLI exits normally based on the loop result.

- [#68](https://github.com/iceglober/glrs/pull/68) [`a5bbbba`](https://github.com/iceglober/glrs/commit/a5bbbba3819b2ba8b08bd8baed8af69670895ca9) Thanks [@iceglober](https://github.com/iceglober)! - Autopilot rewrite, pilot rip-out, Tier 1 visual capabilities, opencode-snip toggle, research-variant hiding.

  **Breaking changes:**

  - **Pilot subsystem removed.** The `glrs oc pilot` CLI subcommand, the four pilot agents (`pilot-scoper` / `planner` / `builder` / `assessor`), the pilot-planning skill references, the `pilot-plugin.ts` runtime enforcer, and all pilot state/docs are gone. Users on pilot should migrate to the CLI autopilot or plain PRIME workflow.
  - **TUI `/autopilot` slash command removed.** Autopilot is now CLI-only: `glrs oc autopilot "<prompt>"`. Users who want autonomous looping run the CLI in any terminal; the TUI stays for interactive work.
  - **Research-variant agents (`research-web`, `research-local`, `research-auto`) hidden from the primary-agent picker.** They now run only as subagents dispatched by `@research`. Users who previously selected them directly should select `@research` instead.

  **New features:**

  - **CLI autopilot (`glrs oc autopilot "<prompt>"`)** — Ralph-loop engine: sends your prompt each iteration, watches the agent's response for `<autopilot-done>` sentinel, retries the same prompt when absent. Budgets: 50 iterations / 4h / 3 zero-progress iterations / kill-switch file. Supports single-issue (`"ship ENG-1234"`) and multi-issue (`"ship every open ENG-* issue in project ROADMAP"`) prompts.
  - **opencode-snip installer toggle** — new "Plugin add-ons" section in `glrs oc install` (parallel to existing MCP toggles). Opt-in adds `opencode-snip` to the user's `plugin` array via config-merge, no vendored code. Useful for token reduction on bash-heavy sessions. Requires the Go `snip` binary separately.
  - **Tier 1 visual capabilities** — `@plan`, `@research`, `@gap-analyzer` now have Playwright MCP access (joining `@prime`, `@build`, `@assessor`, `@assessor-thorough`, `@plan-reviewer`). Enable via the installer's Playwright toggle.
  - **UI evaluation ladder (graceful degradation)** — all visual-capable agents now carry a four-tier capability ladder (Playwright → curl → webfetch → source inspection). When Playwright is unavailable, agents fall through to the next tier and report which method they used. No hard failure on Playwright absence.

  **Internal:**

  - Server lifecycle helpers (`startServer` / `createSession` / `sendAndWait` / `getLastAssistantMessage`) moved from `src/pilot/server.ts` to `src/lib/opencode-server.ts` (consumed by the CLI autopilot).
  - Agent roster reduced from 20 → 16. Net −5,308 lines across 91 files. Test count 536 → 462 (pilot tests removed, visual-capability tests added).

- [#68](https://github.com/iceglober/glrs/pull/68) [`a5bbbba`](https://github.com/iceglober/glrs/commit/a5bbbba3819b2ba8b08bd8baed8af69670895ca9) Thanks [@iceglober](https://github.com/iceglober)! - Add `glrs oc loop` as the canonical name for the Ralph-loop CLI runner (previously `glrs oc autopilot`). `autopilot` continues to work as an alias during this release cycle — no user scripts break.

  A future release will diverge the two: `loop` stays as the raw-prompt Ralph-loop runner, and `autopilot` becomes an interactive scoping walkthrough that generates a structured multi-file plan and then invokes `loop` against it. This change (PR 2 of 3) lays the CLI plumbing for that split; PR 3 ships the interactive walkthrough and the structured plan format.

  No behavior change in this release — both `glrs oc loop "<prompt>"` and `glrs oc autopilot "<prompt>"` do exactly what `autopilot` did before.

- [#65](https://github.com/iceglober/glrs/pull/65) [`4e20574`](https://github.com/iceglober/glrs/commit/4e205745f9d8c46180d99b3237fc038a62cf94f1) Thanks [@iceglober](https://github.com/iceglober)! - Remove the broken `plan-dir` and `plan-check` CLI subcommands and fix `@plan`'s write permission

  The `bunx @glrs-dev/harness-plugin-opencode plan-dir` and `plan-check` subcommands had been dead since the standalone-invocation redirect guard was introduced in April 2026 — they exit 1 with a deprecation banner and produce no stdout when an agent invokes them via `bunx`. Every caller silently fell through, so this surface was not load-bearing. This release rips both subcommands (and the bundled `plan-check.sh` script) out of the CLI. Agents that previously resolved the plan directory via `plan-dir` now use a four-line inline bash snippet that composes `git rev-parse --git-common-dir`, `dirname`, `basename`, and `mkdir -p` to compute `~/.glorious/opencode/<repo-folder>/plans/` directly (honoring `$GLORIOUS_PLAN_DIR` as an override base). The `plan-paths.ts` library module and its `getRepoFolder`, `getPlanDir`, `migratePlans` exports remain — they were never the broken piece.

  Companion fix: `@plan`'s permission block was missing `write: "allow"`, which prevented the agent from ever creating a plan file even when `plan-dir` was conceptually working. The permission now grants `write: "allow"` plus a four-entry bash allow-list covering only the commands the inline snippet needs. The "plan writes only plan files" invariant is preserved at the prompt layer (hard-rules section).

  If you were calling `bunx @glrs-dev/harness-plugin-opencode plan-dir` or `plan-check` directly in a script, switch to either (a) the inline bash snippet above or (b) importing `getPlanDir` / `migratePlans` from the library if you're writing TypeScript.

- [#68](https://github.com/iceglober/glrs/pull/68) [`a5bbbba`](https://github.com/iceglober/glrs/commit/a5bbbba3819b2ba8b08bd8baed8af69670895ca9) Thanks [@iceglober](https://github.com/iceglober)! - Add multi-file structured plan schema, @scoper agent for interactive scoping, and plan-aware progress reporting in the autopilot plugin.

  - New `@scoper` primary agent for first-principles alignment before planning
  - Multi-file plan schema: `plans/<slug>/main.md` + `phase_N.md` files for complex features
  - `plan-parser` module: parses both single-file and multi-file plans, returns structured progress data
  - Plan-aware heartbeat: status messages include phase progress for multi-file plans
  - `glrs oc autopilot` is now its own interactive subcommand (diverged from `loop`)
  - `@plan` agent updated with multi-file decision heuristic
  - `@build` agent updated with multi-file plan navigation instructions
  - `@plan-reviewer` agent updated with multi-file consistency validation

## 2.2.0

### Minor Changes

- [#58](https://github.com/iceglober/glrs/pull/58) [`2720440`](https://github.com/iceglober/glrs/commit/2720440e76ed76f95a59b77525cb140bd673d669) Thanks [@iceglober](https://github.com/iceglober)! - Autopilot rewrite, pilot rip-out, Tier 1 visual capabilities, opencode-snip toggle, research-variant hiding.

  **Breaking changes:**

  - **Pilot subsystem removed.** The `glrs oc pilot` CLI subcommand, the four pilot agents (`pilot-scoper` / `planner` / `builder` / `assessor`), the pilot-planning skill references, the `pilot-plugin.ts` runtime enforcer, and all pilot state/docs are gone. Users on pilot should migrate to the CLI autopilot or plain PRIME workflow.
  - **TUI `/autopilot` slash command removed.** Autopilot is now CLI-only: `glrs oc autopilot "<prompt>"`. Users who want autonomous looping run the CLI in any terminal; the TUI stays for interactive work.
  - **Research-variant agents (`research-web`, `research-local`, `research-auto`) hidden from the primary-agent picker.** They now run only as subagents dispatched by `@research`. Users who previously selected them directly should select `@research` instead.

  **New features:**

  - **CLI autopilot (`glrs oc autopilot "<prompt>"`)** — Ralph-loop engine: sends your prompt each iteration, watches the agent's response for `<autopilot-done>` sentinel, retries the same prompt when absent. Budgets: 50 iterations / 4h / 3 zero-progress iterations / kill-switch file. Supports single-issue (`"ship ENG-1234"`) and multi-issue (`"ship every open ENG-* issue in project ROADMAP"`) prompts.
  - **opencode-snip installer toggle** — new "Plugin add-ons" section in `glrs oc install` (parallel to existing MCP toggles). Opt-in adds `opencode-snip` to the user's `plugin` array via config-merge, no vendored code. Useful for token reduction on bash-heavy sessions. Requires the Go `snip` binary separately.
  - **Tier 1 visual capabilities** — `@plan`, `@research`, `@gap-analyzer` now have Playwright MCP access (joining `@prime`, `@build`, `@assessor`, `@assessor-thorough`, `@plan-reviewer`). Enable via the installer's Playwright toggle.
  - **UI evaluation ladder (graceful degradation)** — all visual-capable agents now carry a four-tier capability ladder (Playwright → curl → webfetch → source inspection). When Playwright is unavailable, agents fall through to the next tier and report which method they used. No hard failure on Playwright absence.

  **Internal:**

  - Server lifecycle helpers (`startServer` / `createSession` / `sendAndWait` / `getLastAssistantMessage`) moved from `src/pilot/server.ts` to `src/lib/opencode-server.ts` (consumed by the CLI autopilot).
  - Agent roster reduced from 20 → 16. Net −5,308 lines across 91 files. Test count 536 → 462 (pilot tests removed, visual-capability tests added).

- [#55](https://github.com/iceglober/glrs/pull/55) [`8099c49`](https://github.com/iceglober/glrs/commit/8099c498fa6a9c05c8880bfd09cb2c4fd7d1721c) Thanks [@iceglober](https://github.com/iceglober)! - Rename PRIME arc phases to SPEAR model (Scope → Plan → Execute → Assess → Resolve). Rename @qa-reviewer → @assessor, @qa-thorough → @assessor-thorough. Resolve stage auto-ships (pushes branch, opens PR) — /ship becomes a resume path for interrupted sessions.

- [#57](https://github.com/iceglober/glrs/pull/57) [`6212c48`](https://github.com/iceglober/glrs/commit/6212c483efa2cc8f0407bc6a0d8c23110498eb21) Thanks [@iceglober](https://github.com/iceglober)! - Restructure the SPEAR protocol (PRIME's five-stage arc) across four areas: Assess quality, failure discipline, skill modularity, and agent-contract hygiene.

  **Breaking changes** (match the prior `@assessor` rename's hard-break pattern):

  - `@assessor` is replaced by `@spec-reviewer` (first pass, returns `[PASS_SPEC]` or `[FAIL_SPEC]`) and `@code-reviewer` (second pass, runs only on PASS_SPEC, returns `[PASS]` / `[LOOP-TO-PLAN]` / `[FIX-INLINE]`). User configs referencing `@assessor` by name will fail to resolve — update to the appropriate replacement.
  - `@assessor-thorough` is renamed to `@code-reviewer-thorough` (same role: opus-tier backstop for high-risk diffs that re-runs the full suite unconditionally).
  - Registered agent count: 20 → 21.

  **Assess rigor (two-stage review + MECE rubric):**

  - Every Assess cycle now dispatches two subagents sequentially instead of one, roughly doubling the subagent calls per review cycle. The spec pass is cheaper; the code-quality pass runs only if spec passed.
  - Assess delegations carry a five-dimension MECE rubric (Correctness, Completeness, Consistency, Safety, Scope) and a progressive-strictness signal (Level 1/2/3) that tightens across Assess iterations.
  - PRs with red CI (typecheck, lint, or tests failing) now fail Assess regardless of whether the failure appears pre-existing. "Pre-existing" claims require three-part evidence: a specific commit SHA, `git log` output showing the failure pre-dates the branch, and merge-base reproduction. Claims without all three are auto-rejected.

  **Failure discipline (no-defer policy):**

  - The hard rule that allowed logging pre-existing failures to a plan's `## Open questions` section and deferring them is removed.
  - `@build` now runs a mandatory root-cause diagnosis protocol on any unexpected test/lint/typecheck failure: merge-base reproduction, `git blame`, rationalization table countering common excuse patterns ("likely pre-existing", "unrelated to my change", etc.).
  - If fixing a failure would require touching more than ~5 files outside the plan's `## File-level changes`, `@build` STOPs with a reorganization proposal for PRIME to present to the user — there is no autonomous deferral path.

  **TDD enforcement:**

  - For any plan with a `## Test plan` entry or a `tests:` field in the acceptance-criteria fence, `@build` now enforces TDD order: write the test first, verify it fails, then implement. Tests in a just-written RED state are explicitly carved out of the failure-diagnosis protocol — they're expected failures, not unexpected ones.

  **New bundled skills:**

  - `spear-protocol` — the full SPEAR stage logic (Bootstrap, Scope, Plan, Execute, Assess, Resolve). Loaded by PRIME at session start. Inline fallback retained in `prime.md` in case skill-loading is unavailable.
  - `root-cause-diagnosis` — the failure-diagnosis protocol + rationalization table. Loaded by `@build` and its strict-executor variant on unexpected failures.
  - `adversarial-review-rubric` — the MECE rubric, progressive strictness levels, Red-CI-blocks-merge rule, and three-part evidence test. Loaded by all Assess-layer agents before reviewing.

  **Agent-contract changes:**

  - `@build` gains a four-status return protocol: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
  - `@build` now reports guidance deviations (item (e) of its return payload) when PRIME's Execute-prompt guidance permits multiple readings and `@build` picked one. Same "silence is not acceptable" bar as plan-file mutations.
  - PRIME runs a pre-dispatch consistency check before every `@build` dispatch: re-read the Execute prompt against the plan and against any already-drafted follow-up prompts. Contradictions caught pre-dispatch avoid the downstream blame-misattribution pattern where faithful agent execution gets narrated as deviation.
  - `@plan` bans placeholder phrases (TBD, TODO, "implement later", etc.) and runs a self-review checklist (spec coverage, placeholder scan, type/name consistency) before handing to `@plan-reviewer`.
  - `@build`'s prompt is trimmed of orchestration context per the Minimal Contract principle (subagents perform worse when carrying parent-level workflow philosophy).

  **Other refinements:**

  - PRIME's Scope grounding dispatches parallel `@code-searcher` calls in a single message when grounding touches 3+ independent subsystems.
  - PRIME's Plan stage detects multi-subsystem requests (3+ independent subsystems with no shared interface) and asks whether to split into separate plans.
  - Delegation prompts apply the Minimal Contract minimality test: remove any sentence that doesn't help the subagent produce a better result. Non-goals prefer positive-instruction form ("Only modify files listed above") over negative lists when the positive form is shorter.

## 2.1.0

## 2.0.1

### Patch Changes

- [#49](https://github.com/iceglober/glrs/pull/49) [`4d75141`](https://github.com/iceglober/glrs/commit/4d75141f7a2f4ca9fe0496cc3fb630b3a549a125) Thanks [@iceglober](https://github.com/iceglober)! - Fix `pilot scope` TUI spawn — remove invalid `--directory` flag and positional project path that caused opencode to print help text and exit with code 1. Goal argument is now optional (prompts interactively if not provided).

## 2.0.0

### Major Changes

- [#47](https://github.com/iceglober/glrs/pull/47) [`19ec568`](https://github.com/iceglober/glrs/commit/19ec56803336f95ad571a291e9eebef7c388564b) Thanks [@iceglober](https://github.com/iceglober)! - **Pilot v2: SPEAR-based autonomous execution (breaking change)**

  Replaces the pilot v1 subsystem (plan-based DAG executor) with a clean SPEAR-based system (Scope → Plan → Execute → Assess → Resolve).

  **Breaking changes:**

  - `pilot build`, `pilot validate`, `pilot status`, `pilot logs`, `pilot cost`, `pilot build-resume`, `pilot plan` commands removed
  - `pilot.yaml` format no longer supported
  - Old state DBs under `~/.glorious/opencode/<repo>/pilot/` are orphaned (not migrated)
  - `pilot-builder` and `pilot-planner` agents replaced by `pilot-scoper`, `pilot-planner`, `pilot-builder`, `pilot-assessor`

  **New commands:**

  - `pilot scope "<goal>"` — interactive scoping session (conversational, produces `scope.json`)
  - `pilot go` — autonomous execution (Plan → Execute → Assess → Resolve loop)
  - `pilot configure` — interactive per-phase model selection and behavior config
  - `pilot status` — workflow status from SQLite

  **Key improvements:**

  - Subagent-per-phase for context isolation (each SPEAR phase gets its own OpenCode session)
  - Deployment-risk reflection in Assess phase (what could break, unexpected consequences, what could go wrong) — actionable risks feed back into the re-plan loop
  - Simple SQLite state (2 tables: workflows + events) instead of 6-table schema
  - Config in `.glrs/pilot.json` (not per-plan YAML) with searchable model selection
  - Playwright MCP support in Assess phase for visual verification (optional, graceful degradation)

## 1.2.0

### Minor Changes

- [#43](https://github.com/iceglober/glrs/pull/43) [`f59c543`](https://github.com/iceglober/glrs/commit/f59c543959e3c7e870976ebee5852e73d9fd72f6) Thanks [@iceglober](https://github.com/iceglober)! - Pilot redesign Steps 1–2: introduce polymorphic Gate abstraction (`shell`, `all`, `any` composite gates with `evalGate` dispatcher) and add v2 SQLite migration for multi-phase workflow state (`workflows`, `phases`, `artifacts` tables). Existing `runs`/`tasks`/`events` schema and accessors preserved with `@deprecated` markers; backfill creates synthetic single-build-phase workflows from legacy rows.

- [#44](https://github.com/iceglober/glrs/pull/44) [`31534aa`](https://github.com/iceglober/glrs/commit/31534aa57af44be2afb5d45174e5181bd0d44303) Thanks [@iceglober](https://github.com/iceglober)! - Add `code-quality` bundled skill with per-phase rule files for gap-analysis, planning, building, and review. Four principles (think before coding, simplicity first, surgical changes, goal-driven execution) derived from empirical analysis of recurring review feedback on agent-authored PRs.

## 1.1.0

### Minor Changes

- [#39](https://github.com/iceglober/glrs/pull/39) [`e4a5b67`](https://github.com/iceglober/glrs/commit/e4a5b678d4d04f54f77586fb32021aef1b3f17ae) Thanks [@iceglober](https://github.com/iceglober)! - Add `mid-execute` model tier for strict-executor agents. When configured via `glrs oc install` or `models["mid-execute"]` in plugin options, `build`, `qa-reviewer`, and `pilot-builder` agents use strict-executor prompts (narrower scope, escalation-first, no self-correction). When not configured, those agents fall back to the `mid` tier model with reasoning prompts (existing behavior). Installer now asks an optional "Use a strict executor for build agents?" question after the standard deep/mid/fast picker.

## 1.0.1

## 1.0.0

### Major Changes

- [#26](https://github.com/iceglober/glrs/pull/26) [`6cec227`](https://github.com/iceglober/glrs/commit/6cec227eeb4360344a8a5cb9b944f3070459084c) Thanks [@iceglober](https://github.com/iceglober)! - pilot: scorched-earth rollback of worktree isolation — cwd mode is the only execution shape

  **Breaking change.** The pilot subsystem no longer manages a per-task worktree pool. `pilot build` now runs each task directly in the user's current worktree (`process.cwd()`), committing on HEAD of the user's feature branch after each task's verify passes.

  User-visible changes:

  - **Pre-flight safety gate.** `pilot build` refuses to run when the working tree is on `main`/`master`/the remote's default branch, outside a git repo, or has uncommitted changes. Match `/fresh --yes` semantics.
  - **`setup:` field removed.** Plans that declare a top-level `setup:` array fail `pilot validate` with a friendly message pointing at `src/pilot/AGENTS.md`. Users should run setup manually (install, compose, migrate, seed) before invoking `pilot build`.
  - **CLI verbs removed.** `pilot resume`, `pilot retry`, and `pilot worktrees` are deleted. cwd-mode resume/retry semantics are future work.
  - **No `PILOT_*` env injection.** Verify commands inherit `process.env` verbatim. The COMPOSE_PROJECT_NAME default is gone.
  - **Auto-commit contract preserved.** The worker still auto-commits after each successful task — just on HEAD of the user's current branch instead of a throwaway per-task branch.

  Internal:

  - Deleted `src/pilot/worktree/` directory and its `pool.ts`/`git.ts` modules.
  - New `src/pilot/worker/safety-gate.ts` with `checkCwdSafety()`.
  - `enforceTouches()` now takes `cwd` instead of `worktree`.
  - Plan schema uses `.passthrough().superRefine(...)` to surface the friendly setup-removal message alongside standard unknown-key rejection.
  - `pilot-planning` skill is now 9 rules (was 10); `setup-authoring.md` deleted.

### Minor Changes

- [#26](https://github.com/iceglober/glrs/pull/26) [`6cec227`](https://github.com/iceglober/glrs/commit/6cec227eeb4360344a8a5cb9b944f3070459084c) Thanks [@iceglober](https://github.com/iceglober)! - pilot: add `pilot build-resume` — continue a partially-completed run

  When `pilot build` fails mid-run (task failure, stall, abort), previously the only recovery was to rerun from scratch or finish manually. `pilot build-resume` picks up where the run left off:

  - Discovers the latest non-terminal run in the repo (or honors `--run <id>`).
  - Skips `succeeded` tasks — their commits are already on HEAD.
  - Resets every non-succeeded task (failed/blocked/aborted/running) to `pending` with `attempts=0` and a fresh retry budget. Cost is preserved.
  - Re-marks the run as `running`, clears `finished_at`.
  - Pre-flight: same safety gate as `pilot build` (clean tree, feature branch) PLUS a branch-match check — refuses if the current branch name doesn't equal the branch recorded on any succeeded task from the run. Prevents "I switched branches since" mistakes.
  - Loads the plan from the path recorded on the run row. If the user edited the plan between runs, the resume picks up the edited version.

  Usage:

  ```bash
  # resume the latest failed/blocked run in this repo
  pilot build-resume

  # or target a specific run
  pilot build-resume --run 01KQDEDKGMAF6NGSKNS2H8QB4V
  ```

  Exit codes:

  - `0` — resume succeeded (every remaining task completed).
  - `1` — wiring failure, branch mismatch, or safety gate refusal.
  - `2` — no resumable tasks (all succeeded, or no runs found).
  - `3` — resume ran but at least one task failed.
  - `130` — SIGINT.

  New state accessors: `resetTasksForResume()`, `markRunResumed()`.

- [#26](https://github.com/iceglober/glrs/pull/26) [`6cec227`](https://github.com/iceglober/glrs/commit/6cec227eeb4360344a8a5cb9b944f3070459084c) Thanks [@iceglober](https://github.com/iceglober)! - pilot: clean the working tree after every task (success OR failure)

  The worker now guarantees the tree is pristine between tasks. After every task the worker runs `git reset --hard HEAD && git clean -fd` (preserves `.gitignored`). This makes the tree-clean-between-tasks invariant explicit: `git status --porcelain` is empty before the next task starts.

  - **Success paths** already had this implicitly via `commitAll`. No behavior change — the reset is a no-op on an already-clean tree.
  - **Failure paths** previously left partial agent edits in the working tree. Now they're reverted. The forensic record of what the failed task did lives in `runs/<runId>/tasks/<taskId>/session.jsonl` — unchanged.

  Consequences:

  1. `pilot build-resume` no longer trips on a dirty tree left behind by the failed run — the failed task's own cleanup already handled it. Resume just works.
  2. Subsequent tasks in the same run start from a known-clean state. No more "task B silently ran on top of task A's partial edits."
  3. If the post-task cleanup itself fails (locked ref, permissions), the worker halts the whole run with a clear error and emits a `run.cleanup.failed` event. Subsequent tasks cannot safely run on a mixed tree.

  Users who need to inspect what a failed task produced should open the session's JSONL log under `~/.glorious/opencode/<repo>/pilot/runs/<runId>/tasks/<taskId>/session.jsonl` — the git diff is no longer the canonical record.

- [#26](https://github.com/iceglober/glrs/pull/26) [`6cec227`](https://github.com/iceglober/glrs/commit/6cec227eeb4360344a8a5cb9b944f3070459084c) Thanks [@iceglober](https://github.com/iceglober)! - pilot-planner: accept multi-issue cross-cutting plans as a first-class shape

  The pilot-planning skill previously encouraged the planner to refuse
  ambitious multi-issue scopes — pushing users to run multiple pilot
  sessions with 3× the setup cost. Skill rework:

  - `decomposition.md` gains a "Plan sizing" section: 5–30 tasks is the
    sweet spot, and bundling 2–4 related issues into one plan is first-
    class when they share repo + package manager + docker-compose + test
    runner. Cross-references `dag-shape.md`'s "Disconnected" pattern.
  - `SKILL.md` gains a "When to bundle vs. split plans" section placed
    before "When to refuse". The refuse section is rewritten to refuse
    ONLY for underspecified / ambiguous / no-concrete-acceptance work
    (e.g., "refactor auth", "clean up tech debt"), explicitly stating
    plan size, multi-issue scope, and disconnected-subtree shape are
    NOT refusal reasons.
  - `self-review.md` question 6 is rewritten: task-level `cascadeFail`
    only blocks DEPENDENTS of the failing task, not siblings in
    disconnected subtrees. The question now asks whether the dependency
    graph concentrates too much value in one critical task (a real
    anti-pattern), not whether the plan is "too big" (a false one).

  Observable effect: the planner now bundles cross-cutting work like
  "rule-engine cleanup + cache invalidation + admin UI" into one plan
  instead of refusing the scope.

- [#26](https://github.com/iceglober/glrs/pull/26) [`6cec227`](https://github.com/iceglober/glrs/commit/6cec227eeb4360344a8a5cb9b944f3070459084c) Thanks [@iceglober](https://github.com/iceglober)! - pilot: safety gate tolerates framework-owned dirty files (`.opencode/**`, `next-env.d.ts`, etc.)

  When opencode auto-updates its plugin dep in the background, it bumps `.opencode/package.json` + `.opencode/package-lock.json`. Previously the pilot safety gate rejected those dirty files as "user uncommitted work," blocking `pilot build` on something the user didn't do and couldn't preempt.

  **Fix:** A new `SAFETY_GATE_TOLERATE` list mirrors the post-task `DEFAULT_TOLERATE` pattern. Dirt ONLY in these paths is allowed; pilot proceeds with a one-line warning showing which framework-owned files were modified. Genuine user dirt (anywhere else) still refuses as before. Mixed dirty trees (framework + user) refuse and surface the user-owned path in the error message.

  Tolerated paths:

  - `.opencode/**` — opencode plugin installer churn.
  - `**/next-env.d.ts`, `**/.next/types/**`, `**/.next/dev/types/**` — Next.js artifacts.
  - `**/*.tsbuildinfo` — TypeScript incremental build cache.
  - `**/__snapshots__/**`, `**/*.snap` — test snapshot files.

  User-visible:

  - `pilot build` prints `[pilot] working tree has N modified file(s) in framework-owned paths; treating tree as clean:` followed by the first 5 paths before starting.
  - `pilot build-resume` does the same.

  Also fixed a porcelain-parser bug that ate the leading space off `git status --porcelain` lines; new tests cover the round-trip.

- [#26](https://github.com/iceglober/glrs/pull/26) [`6cec227`](https://github.com/iceglober/glrs/commit/6cec227eeb4360344a8a5cb9b944f3070459084c) Thanks [@iceglober](https://github.com/iceglober)! - pilot: add `.glrs/hooks/pilot_setup` — repo-level setup hook

  A user-authored shell script at `.glrs/hooks/pilot_setup` (relative to the repo root) is auto-invoked once at the start of `pilot build` and `pilot build-resume`, before any task runs. Its job is to make the dev stack ready: install deps, start docker services, run migrations, seed data — whatever the plan's verify commands expect to already be running.

  Contract:

  - **Missing file → skip silently.** No hook = no setup = the old behavior.
  - **Present + executable → run it.** stdout/stderr stream live to the terminal so the user sees install progress.
  - **Non-zero exit → abort the pilot run.** User fixes their env first.
  - **10-minute timeout → abort.** Prevents hung installs from blocking indefinitely.
  - **Not executable → abort with a clear message** (`chmod +x .glrs/hooks/pilot_setup`).

  Why this instead of the old plan-level `setup:` field:

  - It's version-controlled in the user's repo, not LLM-authored.
  - One hook per repo covers every plan — no cross-plan drift.
  - The user controls exactly what runs (no pilot-opinionated defaults).
  - It's idempotent by convention — safe to re-run on resume.

  Example `.glrs/hooks/pilot_setup`:

  ```bash
  #!/bin/sh
  set -e
  pnpm install --frozen-lockfile
  docker compose up -d postgres redis
  pnpm prisma migrate dev --skip-generate
  ```

- [#26](https://github.com/iceglober/glrs/pull/26) [`6cec227`](https://github.com/iceglober/glrs/commit/6cec227eeb4360344a8a5cb9b944f3070459084c) Thanks [@iceglober](https://github.com/iceglober)! - pilot: add `tolerate:` task field + default allowlist for framework-generated files

  **Problem:** Tasks with verify steps like `next build` would fail touches-enforcement on files the framework itself rewrites (`next-env.d.ts`, `.next/types/**`), not files the agent edited. The fix-loop couldn't recover — reverting the file just made the next verify regenerate it.

  **Fix:** Two complementary escape hatches.

  1. **Built-in default allowlist.** `enforceTouches` now accepts a small, opinionated set of framework-generated globs without requiring plan authors to list them:

     - `**/next-env.d.ts`
     - `**/.next/types/**`, `**/.next/dev/types/**`
     - `**/*.tsbuildinfo`
     - `**/__snapshots__/**`, `**/*.snap`

  2. **Task-level `tolerate:` field.** Plan authors can extend the allowlist per-task for project-specific codegen (prisma/client, graphql/generated, etc.). `tolerate:` is unioned with `touches:` and defaults at enforcement time.

  **Behavior change:** Tasks that previously failed touches-enforcement on these paths will now pass. `touches: []` (verify-only) tasks where ONLY tolerated/default-allowed files change also pass. Real drift (file outside touches + tolerate + defaults) still fails as before.

  Planner prompt and `pilot-planning/rules/touches-scope.md` both updated with the new `tolerate:` contract and examples.

- [#26](https://github.com/iceglober/glrs/pull/26) [`6cec227`](https://github.com/iceglober/glrs/commit/6cec227eeb4360344a8a5cb9b944f3070459084c) Thanks [@iceglober](https://github.com/iceglober)! - pilot: inject PILOT\_\* env vars into setup and verify commands

  Pilot setup and per-task verify commands now run with a fixed set of `PILOT_*` env vars plus a default `COMPOSE_PROJECT_NAME` injected by the harness. This lets plan authors isolate per-worktree local infrastructure (docker-compose projects, host ports, named volumes) so parallel and retried pilot worktrees don't collide with each other or with a developer's background dev stack.

  Injected vars:

  - `PILOT_RUN_ID` — ULID of the current run.
  - `PILOT_TASK_ID` — stable task id.
  - `PILOT_SLOT_INDEX` — pool slot index (0 in v0.1).
  - `PILOT_SLOT_SEQ` — unique sequence `= slot_index * 100 + retry_counter`.
  - `PILOT_WORKTREE_DIR` — absolute worktree path.
  - `PILOT_PORT_BASE` — opinionated port base `= 10000 + PILOT_SLOT_SEQ * 100`.
  - `COMPOSE_PROJECT_NAME` — default `pilot-<runIdShort>-<slotSeq>`, only when unset (user/CI intent preserved).

  Plan authors using docker-compose for local infra no longer need to hand-roll slot-unique project names or port offsets. See `src/skills/pilot-planning/rules/setup-authoring.md` (updated) for a worked example.

### Patch Changes

- [#27](https://github.com/iceglober/glrs/pull/27) [`cf74f2d`](https://github.com/iceglober/glrs/commit/cf74f2dca60ee099a92a500d90de1c1886b6aed0) Thanks [@iceglober](https://github.com/iceglober)! - chore(changesets): move @glrs-dev/cli and @glrs-dev/harness-plugin-opencode from `linked` to `fixed`

  The `linked` group synchronizes versions only among packages that are ALREADY being bumped — it does not force a package into a release. A changeset that named only the harness (as most of our changesets do) would ship a new harness on npm without republishing the CLI, even though the CLI vendors the harness `dist/` at build time (`packages/cli/scripts/vendor-harness.ts`). End users running `glrs oc ...` would keep getting the old vendored harness until somebody remembered to write a no-op CLI changeset.

  Moving the pair to `fixed` guarantees any harness publish drags the CLI along at a matching version, so a fresh CLI tarball always re-vendors the latest harness `dist/`. The trade-off — CLI-only changesets now also force a no-op harness republish — is cheap because CLI-only changes are rare in this repo.

## 0.3.1

### Patch Changes

- [#19](https://github.com/iceglober/glrs/pull/19) [`6e942c5`](https://github.com/iceglober/glrs/commit/6e942c5099a535a7d1cda161a1bbc1692f937008) Thanks [@iceglober](https://github.com/iceglober)! - Link `@glrs-dev/cli` and `@glrs-dev/harness-plugin-opencode` versions in Changesets config so they always release together. The CLI vendors the harness plugin's `dist/` at build time (via `packages/cli/scripts/vendor-harness.ts`), so plugin fixes don't reach users running `glrs oc install` until a CLI release is cut. Linking the two ensures every harness-plugin bump produces a matching CLI bump, closing the gap where a plugin fix sat on npm without a CLI tarball that bundled it.

  This bump also forces a CLI republish that vendors `@glrs-dev/harness-plugin-opencode@0.3.0` so users get the recent `glrs oc install` reconfigure fix via `glrs oc install`, not just `glrs-oc install` directly.

## 0.3.0

### Minor Changes

- [#18](https://github.com/iceglober/glrs/pull/18) [`3384687`](https://github.com/iceglober/glrs/commit/3384687debcf601d1134434531895330731442d8) Thanks [@iceglober](https://github.com/iceglober)! - The pilot-planner agent now detects package managers, docker-compose services, migration tooling, and UI/API/DB test frameworks during planning, and proposes a top-level `setup:` block + per-surface `verify:` patterns for user confirmation before writing the YAML. Two new rule files (`setup-authoring.md`, `qa-expectations.md`) back the new behaviour.

- [#15](https://github.com/iceglober/glrs/pull/15) [`eadb193`](https://github.com/iceglober/glrs/commit/eadb193092001cd15c5e70dd3bfb2034c614977b) Thanks [@iceglober](https://github.com/iceglober)! - Register `research-web`, `research-local`, `research-auto` as OpenCode agents (previously bundled only as skills). `@research` now dispatches by name instead of via a generic subagent loading the Skill tool. Direct invocation (`@research-web`, task-tool dispatch) now works.

### Patch Changes

- [#17](https://github.com/iceglober/glrs/pull/17) [`0bb833f`](https://github.com/iceglober/glrs/commit/0bb833fa00a943cb325404156d0f6b5cf70ca50c) Thanks [@iceglober](https://github.com/iceglober)! - Fix `glrs-oc install` silently dropping reconfigured models and MCPs on re-run. When a user answers "Yes, reconfigure models" (or the new "Yes, reconfigure MCPs") prompt, the installer now writes the new selections into `opencode.json` via an imperative-edit path rather than letting the non-destructive merge policy preserve the existing values. Other plugin options and user-authored MCPs are preserved; a `.bak.<epoch>-<pid>` sibling is written before mutation.

- [#18](https://github.com/iceglober/glrs/pull/18) [`3384687`](https://github.com/iceglober/glrs/commit/3384687debcf601d1134434531895330731442d8) Thanks [@iceglober](https://github.com/iceglober)! - pilot: add top-level `setup:` for environment bootstrap + relax builder rule 4 to let environmental fumbles self-heal during the fix-loop

  - **Harness-level**: Added `setup:` field to `pilot.yaml` schema. Commands run once per fresh worktree slot before any task uses that slot. Cached across tasks; re-run on slot retirement after `preserveOnFailure`. Setup failure hard-aborts the run with all pending tasks marked `blocked`.

  - **Agent-level**: Rewrote pilot-builder rule 4 to distinguish task-level dependency additions (still require task prompt approval) from environment bootstrap (expected during fix-loop when verify fails with obvious environmental errors like missing `node_modules`). Recognises canonical install commands: `pnpm install`, `bun install`, `npm install`, `npm ci`, `cargo fetch` / `cargo build`.

  - **Defence-in-depth**: Added tests ensuring the plugin bash-deny list continues to permit standard install commands.

## 0.2.0

### Minor Changes

- [`050f4b9`](https://github.com/iceglober/glrs/commit/050f4b9bf2304dd5fb5031c38e7fe247b68ead07) Thanks [@iceglober](https://github.com/iceglober)! - **Rename `@glrs-dev/harness-opencode` → `@glrs-dev/harness-plugin-opencode` and republish.**

  ## Why

  OpenCode resolves plugins by npm-installing them into `~/.cache/opencode/packages/<plugin>@<version>/` at plugin-load time. The previous plan — marking `@glrs-dev/harness-opencode` as `private: true` and vendoring it only into `@glrs-dev/cli` — broke OpenCode's plugin loader because the package wasn't published on npm, causing `ETARGET: No matching version found for @glrs-dev/harness-opencode@1.0.0`.

  The fix: publish the plugin under a new name (`@glrs-dev/harness-plugin-opencode`) so OpenCode can resolve it normally. The old name stays deprecated at its last published version (`0.16.2`).

  ## What changed

  - `packages/harness-opencode/package.json`: renamed from `@glrs-dev/harness-opencode` to `@glrs-dev/harness-plugin-opencode`, `private: true` removed, `publishConfig.access: public` + `provenance: true` added, version reset to `0.1.0` (fresh name on npm).
  - The `install` / `uninstall` / `doctor` flows now write the new name to `opencode.json`'s plugin array.
  - `@glrs-dev/cli` still bundles a vendored copy of the plugin for standalone subprocess dispatch (`glrs oc`), but the npm-resolved copy is what OpenCode's plugin runtime loads.
  - Bin names unchanged — `harness-opencode` and `glrs-oc` still work.

  ## Migration for existing users

  Re-run `glrs oc install` to update your `opencode.json` plugin array from `@glrs-dev/harness-opencode` to `@glrs-dev/harness-plugin-opencode`. The old entry will be replaced; no data loss.

## 1.0.0

### Major Changes

- [#6](https://github.com/iceglober/glrs/pull/6) [`689c103`](https://github.com/iceglober/glrs/commit/689c1034bd2b5f5c54af40b18b3c1d3bb3db4bb4) Thanks [@iceglober](https://github.com/iceglober)! - **Breaking change: standalone bin invocation now exits 1 with a redirect notice.**

  The `harness-opencode` and `glrs-oc` bins now print a one-line redirect to stderr and exit with code 1 when invoked directly (i.e., not via `@glrs-dev/cli`'s dispatcher). This is intentional — `@glrs-dev/cli` is the new single install path.

  ## Migration

  ```bash
  # Before
  npm i -g @glrs-dev/harness-opencode
  harness-opencode install
  glrs-oc pilot run

  # After
  npm i -g @glrs-dev/cli
  glrs oc install
  glrs oc pilot run
  ```

  The `harness-opencode` and `glrs-oc` bin names continue to exist (bin-name stability is a contract), but they redirect when invoked standalone. When dispatched by `glrs oc`, they run normally.

  ## Why

  `@glrs-dev/cli` is now the unified entry point for the entire `@glrs-dev` ecosystem. Installing one package gives you `glrs oc`, `glrs agentic`, and `glrs assume`. The three sub-packages (`@glrs-dev/harness-opencode`, `@glrs-dev/agentic`, `@glrs-dev/assume`) are now private and will no longer publish to npm. Version `0.16.2` of `@glrs-dev/harness-opencode` is the last published version.

  See [https://glrs.dev/install](https://glrs.dev/install) for the updated install instructions.

### Minor Changes

- [#2](https://github.com/iceglober/glrs/pull/2) [`054cf1a`](https://github.com/iceglober/glrs/commit/054cf1ad516c171a93a1383aacd318ca670155fa) Thanks [@iceglober](https://github.com/iceglober)! - Pilot build: richer stdout progress. `task.verify.failed` now shows attempt/command/exit; `task.failed`/`task.stopped` emit a `pilot logs` breadcrumb; cascade-blocked tasks render inline with the failed upstream dep; retry attempts surface a low-key tick. No config or payload breaking changes.

## 0.16.2

### Patch Changes

- [#128](https://github.com/iceglober/harness-opencode/pull/128) [`3f34e76`](https://github.com/iceglober/harness-opencode/commit/3f34e762a4fba0dbf14009445a5a478ba01888d9) Thanks [@iceglober](https://github.com/iceglober)! - Fix pilot build stalling with "0 events" at 5min.

  Two independent bugs that both blocked pilot from ever running:

  1. **Pilot's opencode server had no pilot-builder / pilot-planner
     agents.** `opencode serve` (spawned by the SDK's
     `createOpencodeServer`) does not load external plugins — only the
     interactive `opencode` TUI does. Verified via `opencode serve
--print-logs --log-level DEBUG`: zero `service=plugin` lines. The
     pilot worker's `session.promptAsync({ agent: "pilot-builder" })`
     was accepted by the server but the prompt went nowhere, because
     no agent was registered under that name. Fix: inject the two
     pilot agents into the spawned server's config via the SDK's
     `createOpencodeServer({ config })` option (forwarded to the server
     as `OPENCODE_CONFIG_CONTENT` env var).

  2. **EventBus received only server-wide events (heartbeats,
     file-watcher), never session-level events.** opencode's SSE
     `/event` endpoint scopes session events (message.updated,
     message.part.updated, session.idle) by subscriber directory, and
     the match is **exact**, not prefix. The EventBus was constructed
     once per run without a directory, so the SSE stream dropped every
     session event the server published. Verified empirically: a 15s
     window over a live pilot-builder session with no directory yielded
     2 events (heartbeats); with the task's exact worktree directory,
     27 events including session.idle. Fix: construct a new EventBus
     per task, scoped to the task's worktree. `WorkerDeps.bus` became
     `WorkerDeps.busFactory: (directory: string) => EventBus`.

  Also:

  - Default `stallMs` raised from 5min to 60min. The 5min default was
    calibrated against a broken stream — with events actually flowing,
    legitimate inter-event gaps during deep subagent work can exceed
    5min. User-override still honored.

  - New diagnostic: when `PILOT_EVENT_LOG` env var is set, EventBus
    dumps every raw SSE event (with extracted sessionID, live
    subscriber IDs, and matched-subscriber count) as JSONL to that
    path. Zero overhead when unset.

  - Regression tests: `EventBus — directory scoping` (3 tests locking
    the subscribe-call contract) and `buildPilotServerConfig` (4 tests
    locking the injected-agents contract).

## 0.16.1

### Patch Changes

- [#127](https://github.com/iceglober/harness-opencode/pull/127) [`afe4f8e`](https://github.com/iceglober/harness-opencode/commit/afe4f8e8cdfc360fc8b3b169f1d385db97f84eb4) Thanks [@iceglober](https://github.com/iceglober)! - Fix PRIME dispatching to `pilot-planner` (or falling back to `general`) instead of `@plan` during normal sessions. The `@plan` agent was registered as `mode: "primary"` — which meant it wasn't visible to other agents' `task`-tool subagent picker — so when PRIME reached Phase 2 and tried to "delegate to @plan via the task tool", the only planner-shaped subagent it could see was `pilot-planner` (whose description also led with "Interactive planner…"). Switch `@plan` to `mode: "all"` — which per OpenCode's agent docs means the agent is both a primary (Tab-cycleable, top-level `@plan` invocation works) AND a subagent (visible to other agents' task-tool picker). No user-visible regression. Also rewrite `pilot-planner`'s description to remove the "Interactive planner" prefix collision. Two regression tests lock the fix.

- [#125](https://github.com/iceglober/harness-opencode/pull/125) [`f4c6905`](https://github.com/iceglober/harness-opencode/commit/f4c69051e23d6519d1db1f6591cc41562d2339bf) Thanks [@iceglober](https://github.com/iceglober)! - Make `pilot build` failures diagnosable from the terminal alone: failure phase and reason now print inline beneath each `task.failed` line, the run summary includes a per-failed-task detail block with session id and preserved worktree path, and the blocked-cascade is de-noised to one summary line instead of one scary line per blocked task.

  Also fixes two supporting bugs: a preserved-on-failure worktree slot no longer poisons every subsequent task in the run, and `pilot status --run <id>` / `pilot logs --run <id>` now resolve the state DB from any worktree (or any repo under the same pilot base), so you can investigate a failed run from wherever you happen to be checked out.

- [#127](https://github.com/iceglober/harness-opencode/pull/127) [`afe4f8e`](https://github.com/iceglober/harness-opencode/commit/afe4f8e8cdfc360fc8b3b169f1d385db97f84eb4) Thanks [@iceglober](https://github.com/iceglober)! - PRIME now delegates Phase 3 (plan execution) to `@build` via the task tool instead of executing file edits itself. This moves the highest-volume token-consumer in the five-phase workflow off the `deep`/Opus tier and onto the `mid` tier — users can swap Sonnet for Kimi K2, GLM-4.6, Haiku, or any other cheap mid-tier model and see a significant cost reduction on substantial work.

  `@build` now uses `mode: "all"` (same pattern as `@plan`): top-level `@build <plan-path>` invocation still works for users who want to execute a plan directly, AND the agent is visible to PRIME's task-tool picker for delegation. `@build`'s prompt is reshaped for the dual invocation: sections trimmed to avoid duplicating PRIME's Phase 4 QA delegation (full-suite test runs + qa-reviewer dispatch moved to PRIME), a structured "Return payload" section added for PRIME-relayed summaries, and the `question` tool is scoped to top-level invocations only (subagent-mode invocations STOP with a blocker payload that PRIME relays). Three regression tests lock the behavioral changes.

## 0.16.0

### Minor Changes

- [#124](https://github.com/iceglober/harness-opencode/pull/124) [`fafe250`](https://github.com/iceglober/harness-opencode/commit/fafe25009a584f2110a2f6b2fd907649bbf95ed8) Thanks [@iceglober](https://github.com/iceglober)! - Pivot the installer's provider/model data source from Catwalk (`catwalk.charm.land`) to Models.dev (`models.dev/api.json`), matching what OpenCode's runtime uses to validate model IDs.

  Previously, the installer emitted provider IDs from Catwalk's registry (`bedrock/anthropic.claude-opus-4-6`, `vertexai/claude-opus-4-6@20250610`) that OpenCode's runtime rejects at agent invocation with `Agent <name>'s configured model <id> is not valid`. Models.dev uses different provider IDs (`amazon-bedrock`, `google-vertex-anthropic`) for the same providers. The AWS Bedrock and Google Vertex presets have been broken out of the box since this ID schism was introduced upstream; only the Anthropic preset happened to work because its provider ID is identical in both registries.

  The Bedrock preset now emits `amazon-bedrock/global.anthropic.claude-*` IDs (using AWS CRIS global cross-region inference for the broadest availability). The Vertex preset now emits `google-vertex-anthropic/claude-*@default` IDs. The Anthropic preset is unchanged.

  The plugin's runtime validator (`src/model-validator.ts`) now flags any model override starting with `bedrock/` or `vertex(ai)/` as invalid and suggests the Models.dev-valid replacement. If you hit `ProviderModelNotFoundError` or `Agent ... configured model ... is not valid` after a recent OpenCode upgrade, run `bunx @glrs-dev/harness-opencode doctor` — it enumerates the bad overrides and the correct Models.dev IDs.

  **Note for existing installations:** your opencode.json is never auto-rewritten. The doctor tells you the exact line to change. If you had a working `anthropic/*` or `amazon-bedrock/*` config, nothing changes. If you had a Catwalk-style `bedrock/anthropic.*` or `vertexai/claude-*@<date>` config, you will now see warnings until you update it — those configs never actually worked at runtime against current OpenCode versions.

### Patch Changes

- [#122](https://github.com/iceglober/harness-opencode/pull/122) [`d433060`](https://github.com/iceglober/harness-opencode/commit/d433060149bdde3134ce1ad07deb8ea7d0536ee5) Thanks [@iceglober](https://github.com/iceglober)! - fix(pilot): prevent `git worktree add -B` collision between runs of the same plan.

  Previously, every `pilot build` of the same plan constructed identical per-task branch names (`pilot/<slug>/<taskId>`). An aborted or failed prior run left `preserveOnFailure` worktrees alive (by design — so users can inspect), but those worktrees held the branch refs. The next `pilot build` tripped on `fatal: '<branch>' is already used by worktree at <prior-run-dir>`, failing T1 and cascade-blocking every downstream task.

  Branch names now include the runId: `pilot/<slug>/<runId>/<taskId>`. Runs of the same plan no longer share a branch namespace; preserved worktrees from prior runs stay on disk for inspection but don't block new runs.

  **Note on existing branches:** branches created by earlier pilot versions (without the runId segment) remain on disk as orphans. They won't be touched or reused by new runs. To clean up manually: `git branch --list 'pilot/*' | xargs -n1 git branch -D` (after confirming nothing valuable lives under those refs, and pruning any orphan worktrees with `git worktree prune`).

## 0.15.0

### Minor Changes

- [#121](https://github.com/iceglober/harness-opencode/pull/121) [`6089f8e`](https://github.com/iceglober/harness-opencode/commit/6089f8e1b84875aca549b2e1ce64c7beeeefcab5) Thanks [@iceglober](https://github.com/iceglober)! - Pilot UX overhaul: interactive plan picker, positional path resolution, and streaming progress.
  - **`pilot build` plan selection** now accepts a positional arg that resolves smartly: absolute path, cwd-relative, plans-dir-relative (with or without `.yaml`/`.yml` suffix). When no arg is given and stdin is a TTY, an `@inquirer/prompts` `select()` picker lists plans from the plans dir sorted by mtime (newest first), labelled with filename + plan name + relative time. `--plan <path>` still works for scripts. Non-TTY with no args falls back to "newest in plans dir" (unchanged v0.1 behavior).
  - **Streaming per-task progress** on stderr during `pilot build`. Lines like `[HH:MM:SS] task.started T1`, `task.verify.passed T1`, `task.succeeded T1 in 42s`, `run.progress 2/7 succeeded`. Suppressed by `--quiet`. Chatty kinds (`task.session.created`, `task.attempt`) stay in the DB; `pilot logs --run` surfaces them. stdout stays clean for the final summary.
  - **Task-level `context:` field** on `pilot.yaml` tasks — optional rich markdown block rendered into the builder's kickoff as a `## Context` section between verify and the task directive. Planner skill gets a new rule (`rules/task-context.md`) and pilot-planner.md tells the planner to populate it for non-trivial tasks. Cover outcome, rationale, code pointers, acceptance shorthand.
  - Exit code change: missing plan via `--plan <path>` now exits 2 (resolution surface) instead of 1 (generic error). Consistent with schema-invalid plans.

### Patch Changes

- [#115](https://github.com/iceglober/harness-opencode/pull/115) [`4d537c0`](https://github.com/iceglober/harness-opencode/commit/4d537c0184a08fdef03f6255d5922f28fb302e08) Thanks [@iceglober](https://github.com/iceglober)! - Security & OSS hygiene — PR1 of a 3-part remediation (follow-ups tracked in [#113](https://github.com/iceglober/harness-opencode/issues/113) and [#114](https://github.com/iceglober/harness-opencode/issues/114)):
  - Add `SECURITY.md` with private disclosure channel, response SLA, scope statement, and safe-harbor clause.
  - Validate Catwalk model-catalog responses with a zod schema before any value reaches `opencode.json`; malformed responses fail closed and the installer falls back to built-in presets.
  - Document the threat boundary, outbound network calls, and the explicit "agent bash deny-list is not a sandbox" limit in the README.
  - Add npm provenance verification instructions (`npm audit signatures`) to the README.
  - Declare `engines.node >= 20.10` in `package.json` and add a runtime guard at the top of the CLI binary so users on unsupported runtimes get an actionable error instead of a cryptic stack trace.
  - Include `SECURITY.md` in the published tarball.

## 0.14.0

### Minor Changes

- [#109](https://github.com/iceglober/harness-opencode/pull/109) [`10c5a82`](https://github.com/iceglober/harness-opencode/commit/10c5a8218cff54a458c5b6adf3bf8562e437f5d4) Thanks [@iceglober](https://github.com/iceglober)! - Add `agent-estimation` bundled skill. Teaches agents to estimate task effort in tool-call rounds first (with a structured module-breakdown table and risk coefficients) and convert to human wallclock only at the final step. Avoids the systematic overestimation that happens when agents anchor to human-developer timelines absorbed from training data. Adapted from https://openclawlaunch.com/skills/agent-estimation.

### Patch Changes

- [#110](https://github.com/iceglober/harness-opencode/pull/110) [`467df1d`](https://github.com/iceglober/harness-opencode/commit/467df1d4fcdecdc34830ca85b8530ea5272a9be5) Thanks [@iceglober](https://github.com/iceglober)! - Detect pre-[#100](https://github.com/iceglober/harness-opencode/issues/100) legacy model-override IDs at runtime and in `doctor`.

  Before PR [#100](https://github.com/iceglober/harness-opencode/issues/100), the installer suggested stale model IDs like `bedrock/claude-opus-4` (no `anthropic.` subpath, no minor-version digit). These IDs never resolved in OpenCode, so any user who kept their pre-[#100](https://github.com/iceglober/harness-opencode/issues/100) `options.models` block saw agents crash with `ProviderModelNotFoundError` at the first subagent invocation — most visibly on `pilot-planner` and `qa-reviewer`, whose tier overrides get stomped first.

  The plugin now runs a conservative offline pattern validator on every override it applies in `resolveHarnessModels()`. On invalid IDs it emits a single-line warn (deduped per unique bad value) naming the offending key (`models.deep`, `models.pilot-planner`, etc.) and suggesting the Catwalk-canonical replacement. The user's config is never auto-rewritten.

  `bunx @glrs-dev/harness-opencode doctor` now includes a model-overrides check: it reads both `plugin options.models` and legacy `harness.models`, prints a red-X line with the full remediation hint for each invalid entry, and a green check when everything resolves cleanly.

  Unknown or CRIS-prefixed IDs (`global.anthropic.*`, `openai/*`, etc.) stay silent — the validator flags only the specific pre-[#100](https://github.com/iceglober/harness-opencode/issues/100) legacy pattern. No behavior change to the happy path.

- [#112](https://github.com/iceglober/harness-opencode/pull/112) [`8e89895`](https://github.com/iceglober/harness-opencode/commit/8e898955ea0cb1a30c15a82983b508e35cdd4071) Thanks [@iceglober](https://github.com/iceglober)! - Make tool-output truncation per-tool-shape-aware and widen the permission allowlist to cover the plugin's own spill path.

  Before this change, every `bash`/`read`/`glob`/`grep` output over 2000 chars was truncated to a 300-char head + 200-char tail with the full text spilled to `~/.local/state/harness-opencode/tool-output/<callID>.txt` — but that spill path was not in the external_directory allowlist, so the PRIME hit a permission prompt on every recovery read. The recovery read then re-truncated, compounding. On any file >~50 lines or grep with >~15 matches, a session spent 3-5 turns ping-ponging between truncation and permission prompts.

  **Allowlist:** `~/.local/state/**` and `~/.config/crush/**` are now in the default `permission.external_directory` map (before `...existingExtDir`, so user overrides still win).

  **Truncation:** raised the base threshold from 2000 → 6000 chars (~150 lines of code) and added per-tool shapes:

  - `read`: `"skip"` — Read's own `limit`/`offset` is the single bound.
  - `glob`: `"skip"` — path lists aren't useful when middle-truncated.
  - `bash`: `"tail"` (default 4000 chars) — failures and exit codes are at the end; keeping head loses signal.
  - `grep`: `"head-with-count"` — first 20 match blocks verbatim + `"... N more matches — full output at <path>"` footer. Middle-truncation breaks match blocks.

  The bash-failure bypass (`looksLikeBashFailure`) is preserved as the first check among truncation paths. A new recovery-read bypass skips truncation entirely when Read is targeting a file under the spill dir. Users can override per-tool shape/threshold/head/tail/grepHeadMatches via `toolHooks.backpressure.perTool.<tool>` in `opencode.json`; user values always win.

## 0.13.3

### Patch Changes

- [#106](https://github.com/iceglober/harness-opencode/pull/106) [`a95bf9f`](https://github.com/iceglober/harness-opencode/commit/a95bf9f289b396e3e4067fd811acc42a98c22ba7) Thanks [@iceglober](https://github.com/iceglober)! - Stop auto-defaulting model selections in the installer. Users now pick models per tier (deep/mid/fast) from the provider's model list, with the default choice set to "Keep defaults (no model config)" so no paid models are configured without explicit user action.

## 0.13.2

### Patch Changes

- [#103](https://github.com/iceglober/harness-opencode/pull/103) [`0990a03`](https://github.com/iceglober/harness-opencode/commit/0990a0326c3b9b098aab2ce49cd7a1086af8cf55) Thanks [@iceglober](https://github.com/iceglober)! - Add "Reconfigure models?" prompt to installer when models are already configured, so users can update their provider/model selection without hand-editing opencode.json.

- [#105](https://github.com/iceglober/harness-opencode/pull/105) [`f68fa3f`](https://github.com/iceglober/harness-opencode/commit/f68fa3f6d6f301d4dfef18e55438e888a34e298d) Thanks [@iceglober](https://github.com/iceglober)! - Check for plugin updates on every OpenCode session start instead of rate-limiting to once per 24 hours. The file-based rate limit caused same-day publishes to go undetected until the next day, delaying auto-update of the plugin cache.

## 0.13.1

### Patch Changes

- [#101](https://github.com/iceglober/harness-opencode/pull/101) [`db74676`](https://github.com/iceglober/harness-opencode/commit/db746761906a725a3d70496c1b5ba0f58bd84b61) Thanks [@iceglober](https://github.com/iceglober)! - Fix agent config and installer model IDs
  - Rename remaining "orchestrator" references to "PRIME" in the PRIME agent prompt.
  - Demote pilot-builder and pilot-planner from primary to subagent mode so they no longer appear as tab-selectable agents.
  - Fix docs-maintainer model from bare "sonnet" to "anthropic/claude-sonnet-4-6".
  - Correct Bedrock and Vertex model IDs in installer presets to match Crush's Catwalk registry (e.g. bedrock/claude-opus-4 → bedrock/anthropic.claude-opus-4-6).
  - Add Catwalk API client that fetches live providers during install with graceful fallback to hardcoded presets when offline.

## 0.13.0

### Minor Changes

- [#99](https://github.com/iceglober/harness-opencode/pull/99) [`0a9e824`](https://github.com/iceglober/harness-opencode/commit/0a9e824b294c84c4ddb6d676db4e4150a1327d59) Thanks [@iceglober](https://github.com/iceglober)! - Add anonymous, opt-out usage telemetry via Aptabase. Tracks tool invocation counts, durations, file extensions, and success/failure rates — no file paths, code, prompts, or identifying information. Disabled automatically in CI and via `HARNESS_OPENCODE_TELEMETRY=0` or `DO_NOT_TRACK=1`.

### Patch Changes

- [#97](https://github.com/iceglober/harness-opencode/pull/97) [`d497c80`](https://github.com/iceglober/harness-opencode/commit/d497c80cd503fd1468301d6541ecec91bb8ecc61) Thanks [@iceglober](https://github.com/iceglober)! - Fix auto-update leaving plugin cache without node_modules. The cache refresh deleted node_modules and assumed OpenCode would reinstall on next start — it doesn't. Now runs `npm install` after rewriting the pin so the new version is immediately available.

## 0.12.1

### Patch Changes

- [#95](https://github.com/iceglober/harness-opencode/pull/95) [`238cf5c`](https://github.com/iceglober/harness-opencode/commit/238cf5cbb8fbcae12380b25351d5f4930484e6ff) Thanks [@iceglober](https://github.com/iceglober)! - Fix OpenCode startup crash caused by unrecognized `harness` top-level key in opencode.json. Move plugin config (model tiers, toolHooks) into the SDK plugin options tuple form. Auto-migrate legacy config on install. Replace readline number-input prompts with @inquirer/prompts (arrow-key select, checkbox, confirm). Fix plugin detection to handle tuple entries in install/uninstall/doctor.

## 0.12.0

### Minor Changes

- [#93](https://github.com/iceglober/harness-opencode/pull/93) [`c70f525`](https://github.com/iceglober/harness-opencode/commit/c70f5258788f8bd720b115060c052b9f009e18a5) Thanks [@iceglober](https://github.com/iceglober)! - Add tool-hooks sub-plugin with four context-saving optimizations: output backpressure (truncate successful tool output above threshold, write full to disk), post-edit verification loop (auto-run tsc after TS/JS edits), loop detection (warn after N edits to same file), and read deduplication (skip re-reads of unchanged files). Add context firewall section to orchestrator prompt mandating sub-agent delegation for high-output operations.

### Patch Changes

- [#93](https://github.com/iceglober/harness-opencode/pull/93) [`c70f525`](https://github.com/iceglober/harness-opencode/commit/c70f5258788f8bd720b115060c052b9f009e18a5) Thanks [@iceglober](https://github.com/iceglober)! - Fix OpenCode startup crash caused by unrecognized `harness` top-level key in opencode.json. Move plugin config (model tiers, toolHooks) into the SDK plugin options tuple form. Auto-migrate legacy config on install. Replace readline number-input prompts with @inquirer/prompts (arrow-key select, checkbox, confirm). Fix plugin detection to handle tuple entries in install/uninstall/doctor.

## 0.11.0

### Minor Changes

- [#88](https://github.com/iceglober/harness-opencode/pull/88) [`f79857c`](https://github.com/iceglober/harness-opencode/commit/f79857c2ccb2afac33e4c7307145f0d9d0239659) Thanks [@iceglober](https://github.com/iceglober)! - feat: interactive `install-plugin` with model provider and MCP prompts

  `glrs-oc install-plugin` now walks users through model provider selection (Anthropic direct, AWS Bedrock, Google Vertex, or keep defaults) and optional MCP toggles (Playwright, Linear). Choices are written to `opencode.json` via non-destructive merge. Non-interactive terminals skip prompts and use defaults.

  Also adds `promptChoice` and `promptMulti` helpers to `plugin-check.ts`, and updates the README with progressive disclosure (quick start → workflow examples → detailed reference).

## 0.10.1

### Patch Changes

- [#85](https://github.com/iceglober/harness-opencode/pull/85) [`a4e5709`](https://github.com/iceglober/harness-opencode/commit/a4e5709abbe24c385d788c4a9598847b2846103d) Thanks [@iceglober](https://github.com/iceglober)! - fix: change CLI shebang from `node` to `bun` to fix ERR_UNSUPPORTED_ESM_URL_SCHEME

  The CLI binary (`dist/cli.js`) used `#!/usr/bin/env node`, causing `bunx` and global installs to spawn Node.js instead of Bun. Node.js cannot resolve `bun:sqlite` imports used by the pilot subsystem, producing `ERR_UNSUPPORTED_ESM_URL_SCHEME` on every CLI invocation — including commands that don't touch SQLite (`install`, `doctor`, etc.) because ESM evaluates all static imports eagerly.

## 0.10.0

### Minor Changes

- [#83](https://github.com/iceglober/harness-opencode/pull/83) [`fb5b7c9`](https://github.com/iceglober/harness-opencode/commit/fb5b7c9f9ed27097d7617415b769a44b46a2a9c4) Thanks [@iceglober](https://github.com/iceglober)! - feat: add `glrs-oc` CLI alias for global install usage

  Adds a second `bin` entry (`glrs-oc`) alongside the existing `harness-opencode`, both pointing to `dist/cli.js`. After `bun add -g @glrs-dev/harness-opencode`, users can invoke the CLI as `glrs-oc install`, `glrs-oc doctor`, `glrs-oc pilot plan`, etc. — shorter than `bunx @glrs-dev/harness-opencode ...` and avoids the Node.js runtime mismatch that `bunx` can trigger.

  Permission maps for CORE_BASH_ALLOW_LIST, PLAN_PERMISSIONS, and PILOT_PLANNER_PERMISSIONS now also allow `glrs-oc *` variants so agents can invoke the short-name CLI.

## 0.9.0

### Minor Changes

- [#80](https://github.com/iceglober/harness-opencode/pull/80) [`6b3f9f6`](https://github.com/iceglober/harness-opencode/commit/6b3f9f69bb24abd41908f7c3c8f439d9a8c1b494) Thanks [@iceglober](https://github.com/iceglober)! - Add the pilot subsystem (v0.1+v0.2) — autonomous task execution from a YAML plan.

  **New CLI surface**: `bunx @glrs-dev/harness-opencode pilot <verb>` with verbs `validate`, `plan`, `build`, `status`, `resume`, `retry`, `logs`, `worktrees`, `cost`, and `plan-dir`. Migrated the entire CLI to `cmd-ts` for declarative argument parsing and auto-generated `--help`.

  **Two new agents** registered via `createAgents()`:

  - **`pilot-builder`** (mid tier, `claude-sonnet-4-6`): unattended task executor. Runs one task at a time inside a per-task git worktree. Permission map denies `git commit/push/tag/branch/checkout/switch/restore/reset` and `gh pr/release` so the worker — not the agent — owns commits. Also denies the `question` tool (unattended invariant). Uses the STOP protocol when blocked.

  - **`pilot-planner`** (deep tier, `claude-opus-4-7`): interactive planner. Decomposes a Linear ticket / GitHub issue / free-form description into a `pilot.yaml` task DAG. Edits restricted to the pilot plans directory by both the agent's permission map and the new `pilot-plugin` runtime hook (belt-and-suspenders).

  **One new skill** (`src/skills/pilot-planning/`): SKILL.md + 7 rules covering first-principles task framing, decomposition, verify-command design, touches-scope tightness, DAG shape, milestone grouping, and self-review.

  **One new sub-plugin** (`src/plugins/pilot-plugin.ts`): hooks `tool.execute.before` to enforce builder/planner invariants at runtime. Classifies sessions by title prefix (`pilot/<runId>/<taskId>`) and working directory; non-pilot sessions pass through unchanged.

  **Persistent state** lives under `~/.glorious/opencode/<repo>/pilot/` (NOT in `~/.config/opencode/`) — SQLite state DB, git worktrees, JSONL worker logs, YAML plan artifacts. Per-repo derivation matches `src/plan-paths.ts`.

  **Doctor** (`bunx @glrs-dev/harness-opencode doctor`) now reports git/bash availability and pilot agent registration status.

  **Tested**: 740+ tests, all green. Pre-implementation spikes documented under `docs/pilot/spikes/`.

  **Known limitations** (deferred to v0.3+):

  - Single-worker only (`--workers >1` clamps to 1 with a warning).
  - No PR creation (pilot stops at committed branches; use `/ship` separately).
  - No cost-cap preemption (cost is reporting-only).
  - No Slack notifications, no Ink TUI for `pilot status --watch`.

## 0.8.0

### Minor Changes

- [#79](https://github.com/iceglober/harness-opencode/pull/79) [`e05bfe8`](https://github.com/iceglober/harness-opencode/commit/e05bfe802a9ad5fca1d68c2954b55c547e998eaf) Thanks [@iceglober](https://github.com/iceglober)! - Add dotenv loader plugin for MCP config interpolation

  Loads `.env` and `.env.local` into `process.env` at plugin-init time so `{env:VAR}` references in MCP server config resolve project-local secrets without a shell-side `source .env` ritual. Shell exports still win (never overwritten), `.env.local` overrides `.env`, missing files silently skipped. Zero external dependencies — inline parser only.

- [#79](https://github.com/iceglober/harness-opencode/pull/79) [`e05bfe8`](https://github.com/iceglober/harness-opencode/commit/e05bfe802a9ad5fca1d68c2954b55c547e998eaf) Thanks [@iceglober](https://github.com/iceglober)! - Add `harness.models` config for tier-based and per-agent model overrides

  Introduces a `harness.models` key in `opencode.json` that lets users override which LLM model each agent uses, either by tier (`deep`, `mid`, `fast`) or per-agent name. Tier assignments cover all 12 agents; per-agent overrides win over tier. No change for users who don't set the key — all agents keep their plugin defaults.

### Patch Changes

- [#75](https://github.com/iceglober/harness-opencode/pull/75) [`01dd824`](https://github.com/iceglober/harness-opencode/commit/01dd82470f24ac542467b1624d0250fd90f12ed5) Thanks [@iceglober](https://github.com/iceglober)! - Autopilot hardening: silent circuit breakers against umbrella plans, wrong-branch work, and stuck loops

  The autopilot plugin previously nudged on every unchecked `- [ ]` in `## Acceptance criteria` regardless of plan shape. When pointed at an umbrella plan (18 Linear issues across 7+ branches, multi-week roadmap with production-measurement ACs), it would keep nudging past explicit STOP reports until the 20-iteration cap fired. The cap had a quiet bug: if the "stopped, something's stuck" nudge hit the debounce window, `stopped` stayed unset and the cap could be re-tested on the next idle.

  This adds six silent circuit breakers — no user prompts, no permission checks, matching the design rule that autopilot never asks for anything:

  - **Plan-shape classifier.** `classifyPlan()` detects **umbrella** plans (has `## Chunks`/`## Milestones`/`## Workstreams` headers, 3+ distinct Linear IDs, or > 50KB), **measurement-gated** plans (phrases like `7-day`, `post-deploy`, `SLO`, `success rate reaches`, `bake time` in the AC section), and **opt-out** plans (magic comment `<!-- autopilot: skip -->`). Non-unit plans stop the session silently with a shape-specific reason.
  - **Branch/plan alignment.** Extracts the first Linear ID from the plan's `## Goal` and compares (case-insensitive) against `git branch --show-current`. Mismatch → silent stop.
  - **PR-state short-circuit.** Shells out to `gh pr view --json state` for the current branch; `MERGED` → silent stop. Cached for 5 minutes per session. Graceful degrade when `gh` is unavailable.
  - **Kill switch.** File at `.agent/autopilot-disable` → silent stop. `touch .agent/autopilot-disable` from any terminal kills the loop; `rm` to re-enable for future sessions.
  - **STOP-report backoff.** Two consecutive assistant messages matching `^STOP[:.\s—]` → silent stop. Counter resets when the unchecked-box count drops (agent made real progress).
  - **Iteration-cap fix.** `stopped: true` is set unconditionally at the cap, regardless of whether the final nudge was debounced.

  Prompt (`autopilot.md`) now documents the plan-shape contract, the `[~]` (pending) and `[-]` (blocked) AC markers (which `countUnchecked` already ignored but the orchestrator didn't know to write), and the full expanded stop-conditions list.

  New `SessionState` fields: `stopReason`, `consecutiveStops`, `prState`, `prCheckedAt`, `lastUncheckedCount`. All optional; unaffected sessions migrate in place.

  No user-facing workflow changes for well-formed unit plans — they nudge exactly as before.

- [#73](https://github.com/iceglober/harness-opencode/pull/73) [`d35f93d`](https://github.com/iceglober/harness-opencode/commit/d35f93da26859c3b509641170f64bf226cda358e) Thanks [@iceglober](https://github.com/iceglober)! - Fix: silence bash ask-prompts for qa-reviewer, qa-thorough, orchestrator, and build

  Switch the agent-level `permission.bash` from scalar `"allow"` to an object-form map with an enumerated allow-list of non-destructive commands (`pnpm lint *`, `tail *`, `ls *`, `git diff *`, `git merge-base *`, `git log *`, `bunx *`, etc.). Live log evidence (commits c9a288d/3483448 notwithstanding) confirmed an upstream OpenCode layer injects `{bash, *, ask}` that beats our scalar `allow` via last-match-wins in `Permission.evaluate`. Specific-pattern keys sort later in the ruleset and win.

  Destructive-command denies (`rm -rf /`, `chmod`, `chown`, `sudo`, `git push --force`) are preserved; `git push --force-with-lease` remains an explicit re-allow.

  Also ships a gated diagnostic probe: set `HARNESS_OPENCODE_PERM_DEBUG=1` to dump every agent's final permission block to `$XDG_STATE_HOME/harness-opencode/perm-debug.json`. Silent and zero-overhead when unset. Use it to verify the fix on your machine or to diagnose future permission-resolution issues.

## 0.7.0

### Minor Changes

- [#69](https://github.com/iceglober/harness-opencode/pull/69) [`a65f944`](https://github.com/iceglober/harness-opencode/commit/a65f9448d43e733279056b3331032d163e2a7cc0) Thanks [@iceglober](https://github.com/iceglober)! - Simplify `/autopilot` to the canonical Ralph loop. The previous implementation had grown to a 1344-line plugin, a 227-line prompt, a 9-rule orchestrator carve-out, and a 13-field per-session state machine with five independent "exit detectors." A recent failure session showed the plugin fighting the orchestrator for control and firing stale nudges on a non-autopilot session. The architecture had drifted far from the Ralph pattern it was modeled on (`while :; do cat PROMPT.md | claude-code ; done` — one prompt, stateless agent, filesystem is the state).

  This release strips autopilot to what `/autopilot` actually needs to do: detect the slash-command invocation, send one kind of nudge while the plan has unchecked boxes, stop when the boxes are checked or when a max-iterations cap fires.

  **What changed**

  - `src/plugins/autopilot.ts`: 1344 → 292 lines. One activation gate (`/autopilot` or `AUTOPILOT mode` in the session's first user message only), one nudge string, one max-iterations cap, one debounce. Removed the completion-promise sentinel (`<promise>DONE</promise>`), the orchestrator EXIT sentinel (`<autopilot>EXIT</autopilot>`), the verifier-verdict tokens (`[AUTOPILOT_VERIFIED]` / `[AUTOPILOT_UNVERIFIED]`), the `@autopilot-verifier` delegation, the shipped-probe (spawning `git merge-base` + `gh pr list`), the substrate-hash stagnation detector, the user-stop-token detection, and every piece of state that supported them. Stop conditions now come from the plan file on disk: zero unchecked `- [ ]` under `## Acceptance criteria` → silent stop; max iterations → one final "stopped" nudge, then silence; user types anything → iterations reset.
  - `src/commands/prompts/autopilot.md`: 227 → 77 lines. Replaced the 9-rule preamble with a single paragraph describing the contract. Kept issue-ref classification (Linear, GitHub, Jira MCPs), the five-phase handoff, and the guardrails that matter (never ask scoping questions, never commit/push/open-PR, never invoke `/ship` yourself). Removed the sequence-loop-of-issues feature — it was never actually exercised and the queue file (`.agent/autopilot-queue.json`) added more state drift than it solved.
  - `src/agents/prompts/orchestrator.md`: removed the 3-paragraph `# Autopilot mode` self-check section, the Phase 1.5 autopilot carve-out explaining forbidden tokens, the Phase 4 autopilot-conditional completion-promise emission, and the hard rule forbidding self-activation. Replaced with a 2-paragraph section: autopilot activates only via `/autopilot`; idle nudges are "keep going" signals; stop when all boxes are `[x]`.
  - `src/agents/prompts/autopilot-verifier.md`: deleted. The agent was only called from the now-removed completion-promise protocol.
  - `src/agents/index.ts`: dropped the `autopilot-verifier` registration and the `AUTOPILOT_VERIFIER_PERMISSIONS` constant.
  - `src/index.ts`: dropped the dead `chat.params` and `experimental.session.compacting` hook references (the autopilot plugin never actually implemented them).
  - `test/autopilot-plugin.test.js`: 1389 → 469 lines. Rewrote to exercise the new surface: activation gate, idle-nudge firing, plan-done silence, max-iterations cap, debounce, user-message reset, non-target-agent ignore.
  - `test/qa-reviewer-flow.sh`: deleted. The script targeted paths under `home/.claude/agents/` that stopped existing when the repo migrated to the npm plugin layout.
  - `test/agents.test.ts`: updated expected subagent count 13 → 12, dropped `autopilot-verifier`-specific assertions.
  - `README.md`: removed `autopilot-verifier` from the subagent list.

  **Behavior notes**

  - Autopilot activation remains strictly opt-in via `/autopilot`. The `detectActivation` helper still scans only the session's FIRST user message, so pasted transcripts or prose that descriptively mention `/autopilot` or `AUTOPILOT mode` do not retroactively activate a vanilla session.
  - `/ship` stays the human gate. The orchestrator prints "Done. Run `/ship <plan>`" and stops.
  - On stop, the plugin no longer writes acknowledgement nudges to the session. Exits are silent — the signal is the plan's boxes or the single max-iterations message.
  - If you relied on the `<promise>DONE</promise>` sentinel or `@autopilot-verifier` in a custom workflow, that workflow needs rework. They are gone.

- [#71](https://github.com/iceglober/harness-opencode/pull/71) [`154af1a`](https://github.com/iceglober/harness-opencode/commit/154af1ad439ca13d8987f31bb27167fcdf18cf25) Thanks [@iceglober](https://github.com/iceglober)! - **Plans are now repo-shared instead of per-worktree.** Agent-written plans move from `$WORKTREE/.agent/plans/<slug>.md` to `~/.glorious/opencode/<repo-folder>/plans/<slug>.md` — visible from every worktree of the same repo, survive `/fresh`, no longer entangled with the transient worktree they happened to be drafted in.

  ## Why

  A plan describes work against a codebase, not against a worktree. Tying plan storage to the transient worktree wasted the plan when the worktree rotated and fragmented visibility across terminal tabs. If you drafted a plan in tab A and later switched to tab B (same repo, different worktree), the plan was invisible. If tab A ran `/fresh`, the plan vanished. This change fixes both.

  ## What moved

  - **Storage location:** `$WORKTREE/.agent/plans/<slug>.md` → `~/.glorious/opencode/<repo-folder>/plans/<slug>.md`.
  - **`<repo-folder>` derivation:** `git rev-parse --git-common-dir` → `basename(dirname(...))`. Two worktrees of the same repo produce the same key, so plans are truly repo-scoped.
  - **Env override:** `$GLORIOUS_PLAN_DIR` overrides the base (default `~/.glorious/opencode`), matching the existing `$GLORIOUS_COST_TRACKER_DIR` precedent. Leading `~` tilde-expands via `os.homedir()`.

  ## Migration

  On the first invocation of `bunx @glrs-dev/harness-opencode plan-dir` inside a given worktree (which the plan agent runs at plan-write time), any existing `.agent/plans/*.md` files are automatically moved to the new location. A `.migrated` marker is written to prevent re-runs. Collisions are handled safely — identical content is deduped (source removed), differing content leaves the source in place with a stderr warning so you can resolve manually.

  No manual action required for users on floating semver; next `bun update` picks up the new behavior, and the first plan-related command in each worktree completes the migration.

  ## Backward compatibility

  Legacy `.agent/plans/<slug>.md` references in older chat transcripts continue to work. The autopilot plugin's `findPlanPath` regex matches both shapes, and the runtime reader uses `path.isAbsolute` to anchor relative paths against the worktree (legacy) or pass absolute paths through as-is (new). The prior `/autopilot` / `/ship` invocations on older references still resolve correctly.

  ## New CLI subcommand

  ```
  bunx @glrs-dev/harness-opencode plan-dir
  ```

  Prints the absolute resolved plan directory for the current working directory, creates it if missing, runs one-shot migration if needed, exits 0. Prompts now use this to resolve the repo-specific storage path at runtime:

  ```bash
  PLAN_DIR="$(bunx @glrs-dev/harness-opencode plan-dir)"
  echo "$PLAN_DIR/my-slug.md"
  ```

  The plan agent's permission block is narrowed to allow exactly this command (`*` → deny, `bunx @glrs-dev/harness-opencode plan-dir*` → allow). Every other bash invocation from the plan agent is still denied — the "plan agent writes only plan files" invariant is preserved.

  ## New permission allowlist entry

  `~/.glorious/opencode/**` is added to the `external_directory` allowlist so agents can read/write plans outside the worktree without OpenCode prompting on every access. User values in `opencode.json` continue to win.

  ## Tests

  47 new tests:

  - 21 for `src/plan-paths.ts` helpers — `getRepoFolder` (canonical / worktree / non-git / bare / whitespace), `getPlanDir` (default / env / tilde / create / idempotent), `migratePlans` (no-op / move / idempotent / collision-same / collision-differ / partial / non-markdown), plus 4 for the CLI subcommand.
  - 9 for autopilot regex + integration — 5 regex coverage, 3 absolute-path integration (including a regression guard for the `path.isAbsolute` reader bug), plus 1 legacy-path backward-compat assertion.
  - 3 for agent prompt content + the new plan-dir permission shape.
  - 1 for the `external_directory` allowlist entry + its user-wins case.
  - 3 for the fallback-string templates in `AUTOPILOT_VERIFICATION_PROMPT` and `AUTOPILOT_COMPLETE_MESSAGE`.
  - 1 CI guard blocking future prompt regressions that would re-introduce `.agent/plans` references.

  Full suite: 209/209 pass. Typecheck clean. Build clean.

  ## Dog-food proof

  The plan describing this migration was written to the old location (`.agent/plans/plans-repo-shared-storage.md`), then migrated to the new location (`~/.glorious/opencode/glorious-opencode/plans/plans-repo-shared-storage.md`) by the CLI it defines, during final verification. The plan ate its own tail.

### Patch Changes

- [#72](https://github.com/iceglober/harness-opencode/pull/72) [`e63bcf6`](https://github.com/iceglober/harness-opencode/commit/e63bcf6cd289ea45899e409f197a84cd9f672d09) Thanks [@iceglober](https://github.com/iceglober)! - Orchestrator now recognizes plugin-provided slash commands (`/fresh`, `/ship`, `/review`, `/autopilot`, `/research`, `/init-deep`, `/costs`) when they appear as the first token of the first user message and weren't dispatched by the OpenCode TUI. In that case the orchestrator reads the command template from the bundled plugin cache, substitutes `$ARGUMENTS`, and executes it inline — same as if the TUI had dispatched normally.

  Context: some sessions receive the raw slash-command text as a plain user message (TUI dispatch silently misses for reasons we haven't pinned down — copy-paste, certain keyboard shortcuts, etc.). Without a fallback, the orchestrator would improvise, e.g. interpret `/fresh meeting prep` as "do something fresh-ish" and go hunting for `gs wt` subcommands instead of running `/fresh`. Prompt-only change; no runtime behavior outside the orchestrator prompt itself. Unknown `/<token>` commands and mid-message slashes still fall through to normal Phase 1 — fallback is scoped tightly to the seven shipped commands at start-of-first-message only.

## 0.6.1

### Patch Changes

- [#65](https://github.com/iceglober/harness-opencode/pull/65) [`c59c875`](https://github.com/iceglober/harness-opencode/commit/c59c8757bfca0311d6eb5de146ae6c46bdd8dd8b) Thanks [@iceglober](https://github.com/iceglober)! - Two friction fixes so `/fresh` is actually friction-free, not just nominally so:

  1. **`/fresh` no longer asks to confirm discarding uncommitted changes.** Running `/fresh` is itself the intent to discard; the interactive default has always been "wipe silently" per spec, but the prompt was hedged enough that the agent kept synthesizing a confirmation anyway (notably for untracked non-gitignored files like `.opencode/package-lock.json`). Added a loud top-of-prompt directive enumerating the only two permissible `question`-tool cases (`--confirm` was passed, or the input had no ref) and reinforced the "only under `--confirm`" guard at §3. No behavior change in `--confirm` or `--yes` modes.

  2. **Plugin now self-updates the OpenCode cache instead of asking users to run `bun update`.** Context: OpenCode caches the plugin at `~/.cache/opencode/packages/@glrs-dev/harness-opencode@latest/` with an exact version pin baked into that dir's `package.json` and `package-lock.json` — so `bun update` from anywhere else is a no-op, and users silently drift behind for releases. (Symptom: users on 0.1.2 still hitting the `/tmp/**` external-directory prompts that were fixed in 0.3.0.) The daily update check now rewrites that cache dir's pin to the latest version and removes its `node_modules/`, so the next OpenCode restart re-installs fresh. The toast copy is now "next restart will auto-update" instead of "run bun update." Writes are atomic (tmp + rename), skip non-exact user-managed pins, and require name-match against our package. `HARNESS_OPENCODE_AUTO_UPDATE=0` disables just the rewrite; `HARNESS_OPENCODE_UPDATE_CHECK=0` still disables the whole thing.

  Bonus: fixes a drift bug where `BUNDLED_VERSION` was hardcoded to `"0.1.2"` in source (comment lied — release pipeline never actually patched it). It's now read from `package.json` at module load, so the running version always matches the shipped package.

- [#68](https://github.com/iceglober/harness-opencode/pull/68) [`03d5352`](https://github.com/iceglober/harness-opencode/commit/03d5352ba1ed92d4c69452ed7dc9d01148a9194d) Thanks [@iceglober](https://github.com/iceglober)! - **Fix: OpenCode no longer crashes at startup with `TypeError: undefined is not an object (evaluating 'V[G]' / 'S.auth' / 'M.config')` when the harness plugin is enabled.**

  This has been silently broken since **v0.3.0** (~commit `e5ffb7c`). Users on v0.3.0–v0.6.0 saw one of several minified-variable error shapes depending on OpenCode version:

  - `TypeError: undefined is not an object (evaluating 'V[G]')`
  - `TypeError: undefined is not an object (evaluating 'f.auth')`
  - `TypeError: undefined is not an object (evaluating 'M.config')`

  All the same bug. The `oc` command would refuse to start in any worktree with the plugin enabled via `~/.config/opencode/opencode.json`.

  ## Root cause

  In commit `e5ffb7c` (v0.3.0, "wire subagent permissions via TS overrides + allow scratch/XDG paths"), `applyConfig` in `src/index.ts` was changed from `function applyConfig(...)` to `export function applyConfig(...)` purely so tests could import it directly.

  OpenCode's plugin loader (1.14.x line) probes named exports on the plugin module looking for `PluginModule`-shaped entries (`{ id?, server, tui? }`). When it encountered the plain `applyConfig` function as a named export, the probe crashed inside OpenCode's minified bundle — fatal at plugin-load time, which cascaded into provider init (`S.auth`) and TUI bootstrap failing entirely.

  Bisect walked every published version (v0.1.2 works, v0.2.0 works, v0.3.0 onward crashes) and isolated the crash to the single `export` keyword on line 137 of `src/index.ts`.

  ## Fix

  Moved `applyConfig` into a dedicated module `src/config-hook.ts`. `src/index.ts` now imports it as a runtime internal and has exactly **one** export — the plugin factory `default`. Tests import `applyConfig` from `src/config-hook.ts`.

  ## Regression guard

  New test file `test/plugin-entry-single-default-export.test.ts` enforces three invariants:

  1. `src/index.ts` has no `export function/const/let/var/class/enum/namespace/{...}` — only `export default`.
  2. `src/index.ts` has exactly one `export default`.
  3. The built `dist/index.js` exposes only `default` on its runtime surface (guards against bundler quirks that might re-surface internals).

  Any future commit that adds a named export to `src/index.ts` will fail CI with a message pointing at this changelog entry.

  ## Bonus

  Also hardens the returned `Hooks` object to omit keys whose values are `undefined` (defensive against a separate class of OpenCode-loader edge case observed while bisecting). New test file `test/plugin-hooks-no-undefined.test.ts` locks that in too.

  ## Upgrade path

  Users on floating semver (`bun add @glrs-dev/harness-opencode`) auto-recover on next `bun update`. Users stuck on `@latest` in the OpenCode cache already benefit from the self-update mechanism added in v0.6.0 ([#65](https://github.com/iceglober/harness-opencode/issues/65)) — next OpenCode restart re-installs the fixed version.

  For users who can't wait for the release: edit `~/.config/opencode/opencode.json` and remove the `plugin` array temporarily, then restore it after `bun update` completes. `oc` works without the harness; you just lose the custom agents/skills until the update lands.

- [#67](https://github.com/iceglober/harness-opencode/pull/67) [`3483448`](https://github.com/iceglober/harness-opencode/commit/3483448281f3652d803067dff1bda2687bdace0e) Thanks [@iceglober](https://github.com/iceglober)! - **Fix: reviewers no longer prompt for permission on trivial read-only git commands (`git branch --show-current`, `git status`, etc.).**

  Context: users kept hitting `Permission required` asks inside `qa-reviewer`, `qa-thorough`, and `autopilot-verifier` for commands that were explicitly supposed to be allowed. v0.6.0 (commit `c9a288d`) tried to fix this by simplifying the agent-level `permission.bash` from an object-form rule-map to the scalar `"allow"`, but the prompts kept coming.

  Root cause: OpenCode's permission resolver merges agent-level `permission.bash` with the **global** `permission.bash` from `applyConfig`. When the agent level was scalar `"allow"` and the global was an object-form rule-map (`{"*": "allow", "git push --force*": "deny", ...}`), the global map was still being re-evaluated on each bash invocation and fell through to an ask for some command shapes — even commands as trivial as `git branch --show-current`. The agent-level scalar was not winning the resolution.

  Fix: removed the global `permission.bash` default in `applyConfig` entirely. Subagents that declare `bash: "allow"` now get an unambiguous allow with nothing to fight against. Destructive-command safety is preserved at two surviving layers:

  1. **Primary agents (`orchestrator`, `build`) keep their own object-form bash rule-maps** with explicit denies for `rm -rf`, `sudo`, `chmod`, `chown`, `git push --force`, `git push * main`, `git push * master`. These are the only agents that routinely run shell commands with mutation potential, so the safety net is exactly where it's needed.
  2. **Read-only subagents (`plan-reviewer`, `code-searcher`, `gap-analyzer`, `architecture-advisor`, `lib-reader`) declare `bash: "deny"`** entirely — bash is off for them regardless.

  Reviewers (`qa-reviewer`, `qa-thorough`, `autopilot-verifier`) are read-only by role; their system prompts forbid destructive operations and they never reach for them. The risk surface from dropping the global deny net for them is negligible; the productivity cost of the ask-prompts was severe.

  Also updated: relevant test assertions (`applyConfig — permission.bash behavior` block), and the explanatory comments in `src/index.ts` + `src/agents/index.ts` that referenced the now-removed global layer so future maintainers don't try to re-add it without reading the history.

## 0.6.0

### Minor Changes

- [#64](https://github.com/iceglober/harness-opencode/pull/64) [`e75d75b`](https://github.com/iceglober/harness-opencode/commit/e75d75ba8b694fdd15eeca61befdb958320443fb) Thanks [@iceglober](https://github.com/iceglober)! - Decouple `/fresh` from the autopilot plugin. `/fresh` is now a pure workspace-cleanup command — parse args, clean the tree, create the branch, optionally dispatch to the repo's `.glorious/hooks/fresh-reset`, then continue inline into the orchestrator on the new task. It no longer writes a handoff brief, no longer touches `.agent/autopilot-state.json`, and no longer coordinates with the autopilot plugin in any way.

  This is the architectural fix for the class of "duplicate autopilot nudge" bug where the plugin's `[autopilot] /fresh re-keyed this worktree to a new task...` message fired twice per session — once legitimately after `/fresh`, and once spuriously after the user had already shipped a PR. The `lastNudgedHandoffMtime` idempotency gate (briefly shipped on a dev branch but never released) was hardening code that shouldn't have existed in the first place.

  **Deleted from the plugin (`src/plugins/autopilot.ts`):**

  - `lastHandoffMtime` field on `SessionAutopilot` and its 14 preservation sites across every state-write path
  - `HANDOFF_PATH` constant and `getHandoffMtime` helper
  - Signal 2 (fresh-handoff transition) in `detectActivation` — the function is now a one-line first-user-message scan for the `/autopilot` marker
  - The fresh-transition branch in the `session.idle` handler (~40 lines, including the nudge body that referenced `.agent/fresh-handoff.md`)
  - The first-time-seed branch that populated `lastHandoffMtime` from the brief's mtime on first idle
  - Exit-message `/fresh` references — shipped-exit, user-stop, and stagnation messages now direct the user to open a new session and invoke `/autopilot` instead of suggesting `/fresh` as a re-enable path

  **Deleted from the `/fresh` prompt (`src/commands/prompts/fresh.md`):**

  - §6 "Write the handoff brief" — the entire markdown template, atomic-write semantics, brief-archival-to-tmp fallback
  - §6a "Reset autopilot state" — the `jq` rewrite of `.agent/autopilot-state.json`, the fallback-to-empty-sessions path, the whole rationale about iteration counters
  - The "read the brief you just wrote" circular step in the orchestrator-kickoff section (§7, formerly §8)
  - Every mention of `.agent/fresh-handoff.md`, `handoff brief`, and `autopilot-state.json` across the failure-mode table, the `/autopilot` integration section, and the philosophy statement

  Sections renumbered: old §7 (summary) is now §6; old §8 (orchestrator kickoff) is now §7. `RESET_STATUS` labels now go into the summary instead of the brief. The orchestrator-kickoff step uses the user's original input directly (no brief to re-read).

  **Deleted from the `/autopilot` prompt (`src/commands/prompts/autopilot.md`):**

  - Step 3 of the sequence loop no longer claims `/fresh` writes a brief or resets autopilot state — it now accurately describes `/fresh` as "re-key the worktree and auto-continue into the orchestrator"
  - Step 4 no longer references "the autopilot plugin's continuation nudges now reference the fresh handoff brief" — there are no such nudges

  **Deleted from tests (`test/autopilot-plugin.test.js`, `test/fresh-prompt.test.ts`):**

  - 5 obsolete `detectActivation` tests exercising Signal 2 (fresh-handoff activation)
  - 1 obsolete `session.idle` integration test for the fresh-transition nudge
  - 1 obsolete "fresh-transition after shipped-exit" regression test
  - 2 obsolete handoff-brief-field assertions in the /fresh prompt contract
  - `lastHandoffMtime` preservation assertions in chat.message tests

  **Added:**

  - 2 new /fresh prompt assertions that fail if the coupling is reintroduced: no reference to `.agent/fresh-handoff.md`, and no reference to `.agent/autopilot-state.json`

  **Behavior change for users:**

  - `/fresh` is faster and simpler — one less file write, no jq invocation, no autopilot coordination.
  - The autopilot plugin activates ONLY via explicit `/autopilot` invocation. The fresh-handoff activation path is gone. Users who want autopilot run `/autopilot`; users who want a clean workspace run `/fresh`; the two commands are orthogonal.
  - `/autopilot` sequence mode continues to work — its per-iteration loop already drives everything inline: pop ref → `/fresh --yes <ref>` → orchestrator runs on the new ref → loop. No plugin-mediated handoff was ever actually needed.
  - Terminal exits from autopilot (shipped, user-stop, orchestrator EXIT, max-iter, stagnation) are now truly terminal for the current session. Users open a new session and invoke `/autopilot` to resume — previously the messaging mentioned `/fresh` as a re-enable path, which was misleading (post-[#60](https://github.com/iceglober/harness-opencode/issues/60) `/fresh` would auto-continue into the orchestrator, not the autopilot arc).

  **Backward compatibility:**

  - State files written by older versions with `lastHandoffMtime` keys are still readable — the field is simply ignored (JSON.parse tolerates unknown keys, TypeScript-level shape is structural).
  - Existing handoff-brief files at `.agent/fresh-handoff.md` are left untouched by the new `/fresh`. They're orphaned documentation, safe to delete manually.
  - No migration required.

  Minor bump because the autopilot plugin's activation contract is narrowing (Signal 2 removed). Users who were relying on fresh-handoff-based activation (e.g., a hypothetical `/plan-loop` skill writing the brief as a cross-session signal) would break — but `/plan-loop` does not exist in this repo; the activation path existed only in plugin comments. Patch-adjacent in practice, but the contract narrowing deserves explicit signaling.

  Net diff: −346 lines across plugin, prompts, and tests. Removes a bug class, not just a bug.

### Patch Changes

- [#62](https://github.com/iceglober/harness-opencode/pull/62) [`c9a288d`](https://github.com/iceglober/harness-opencode/commit/c9a288daf1ef023dbfa910dcd138ea4a6c2b66bd) Thanks [@iceglober](https://github.com/iceglober)! - Simplify `bash` permission for `qa-reviewer`, `qa-thorough`, and `autopilot-verifier` to the plain string `"allow"`, removing the agent-level object-form rule-map. Eliminates a recurring permission-ask prompt on read-only pipelined commands (e.g. `git show <ref>:<path> | sed -n 'N,Mp'`) during review runs — the OpenCode runtime was apparently misfiring on pipelined shapes despite the catch-all `"*": "allow"` rule, and the agent-level deny list was defense-in-depth anyway.

  Destructive-command safety is retained at two layers:

  - **Global layer:** the `permission.bash` block in `applyConfig` (src/index.ts) continues to deny `git push --force*`, `rm -rf /*`, `rm -rf ~*`, `chmod *`, `chown *`, `sudo *` for every agent that doesn't override it. A new regression test locks this safety net in place.
  - **Agent-prompt layer:** each read-only reviewer's system prompt explicitly forbids mutating history, force-pushing, or touching the filesystem root.

  Other subagents are unchanged: `plan-reviewer`, `code-searcher`, `gap-analyzer`, `architecture-advisor`, and `lib-reader` keep `bash: "deny"`; `agents-md-writer` keeps `bash: "ask"`; `orchestrator` and `build` (primary agents) keep their object-form bash maps.

  Plan: `.agent/plans/qa-reviewer-bash-allow.md` (7/8 ACs [x] — a8 is this changeset).

## 0.5.0

### Minor Changes

- [#60](https://github.com/iceglober/harness-opencode/pull/60) [`6ece868`](https://github.com/iceglober/harness-opencode/commit/6ece86849bc94d6b7aa716365106b83813217c3b) Thanks [@iceglober](https://github.com/iceglober)! - Make `/fresh` faster and lower-friction. Three user-visible changes:

  - **`/fresh` now wipes by default in interactive mode.** Previously, a dirty working tree triggered a mandatory `question`-tool prompt ("Worktree is dirty. /fresh will hard-discard ALL uncommitted changes. Proceed?") before any reset ran. The new default trusts the human who typed `/fresh` — if you ran the command, you've already decided you want a fresh workspace. The wipe happens silently; the post-hoc summary in §7 lists what was discarded so there's still a visible receipt. `--confirm` is a new flag that restores the old ask-first behavior for paranoid runs. `--yes` (autopilot) semantics are unchanged — it stays strict, aborting on tracked changes or non-gitignored untracked files to protect unattended loops from silent data loss.

  - **`/fresh` auto-continues into the orchestrator on the new task.** New §8 "Kick off the orchestrator on the new task (in the SAME turn)": after printing the summary, `/fresh` reads the handoff brief it just wrote and enters the orchestrator arc inline (Phase 0 → Phase 1 → …) on the new request. You no longer have to type "work on it" after `/fresh`; the re-key and the start-working are one uninterrupted turn. The autopilot plugin's "session idle → nudge to read handoff brief" path becomes a fallback for the interrupted-continuation case rather than the primary mechanism — autopilot loops gain one round-trip saved per issue.

  - **Permission defaults relax for `git reset --hard` and `git clean`.** Shipped defaults in `src/index.ts` now `allow` both patterns (previously `ask` and `deny` respectively). The old defaults blocked `/fresh`'s own built-in reset flow and produced a permission prompt on every `git reset --hard` anywhere — exactly the "answer a question every time" friction that `/fresh` is supposed to eliminate. Destructive-push patterns (`git push --force`, `git push -f`, `rm -rf /`, `sudo`, `chmod`, `chown`) remain denied.

  Existing tests all pass (146 tests, 513 expects). The interactive-default flip is a behavior change for humans at the terminal — if you rely on the old ask-first prompt as a safety gate, add `--confirm` to your `/fresh` invocations or (for the habitual case) alias `/fresh` in your own notes to `/fresh --confirm`.

## 0.4.0

### Minor Changes

- [#58](https://github.com/iceglober/harness-opencode/pull/58) [`9f650b9`](https://github.com/iceglober/harness-opencode/commit/9f650b95e4300da0b09251d538cf08d99fcd1898) Thanks [@iceglober](https://github.com/iceglober)! - Cut qa-reviewer latency on typical diffs and preserve thorough review as an explicit opt-in. Four user-visible changes:

  - **qa-reviewer dropped to Sonnet + trust-recent-green.** `qa-reviewer` now runs on `anthropic/claude-sonnet-4-6` (was Opus) and trusts the orchestrator's recent green test/lint/typecheck output within the session when the diff hasn't changed since. Semantic verification and scope-creep checks are unchanged. The trust-recent-green heuristic keys on three literal phrases the orchestrator now emits in its delegation prompt: `tests passed at <timestamp>`, `lint passed at <timestamp>`, `typecheck passed at <timestamp>`. Missing any of the three → qa-reviewer re-runs that specific command itself.

  - **New `qa-thorough` subagent for high-risk cases.** Identical-shape permission block, Opus model, re-runs the full lint/test/typecheck suite unconditionally — i.e., the old qa-reviewer behavior. The orchestrator picks this variant automatically for diffs touching >10 files, >500 lines, any file marked `Risk: high` in the plan, or security/auth/crypto/billing/migration paths.

  - **Orchestrator packages session-green timestamps into the qa-reviewer delegation prompt.** This is the load-bearing signal qa-reviewer's trust-recent-green heuristic keys on — without it, qa-reviewer re-runs everything. The orchestrator also now picks between fast and thorough variants deterministically via a documented heuristic in Phase 4 "Verify".

  - **Orchestrator hard rule: log confirmed pre-existing failures to the plan's `## Open questions` section** via the `edit` tool before proceeding. Bullet format: `- Pre-existing failure confirmed in <file>::<test-name> — not introduced by this change. Recommend separate cleanup.` Prevents the finding from dying with the session and the next qa run re-investigating the same failure.

  Plus strengthened scope-creep rules on BOTH qa variants: `git status` untracked files not in the plan must be verified via `git log --oneline -- <file>` (orchestrator's verbal "pre-existing" claim is not accepted), and modified files not in the plan's `## File-level changes` are AUTO-FAIL regardless of how "implicit" the coverage is.

  13 new tests in `test/agents.test.ts` lock the load-bearing phrases on both sides of the contract (qa-reviewer, qa-thorough, orchestrator) so the two prompts cannot drift apart without test failure.

## 0.3.0

### Minor Changes

- [#52](https://github.com/iceglober/harness-opencode/pull/52) [`62fbbda`](https://github.com/iceglober/harness-opencode/commit/62fbbda1f767b41ef97c926f7d6dc43c0502025f) Thanks [@iceglober](https://github.com/iceglober)! - Harden the autopilot loop against the class of bug where it pressures the orchestrator into user-defying behavior. Introduces the **continuation-guard**: a per-session terminal-exit latch (`exited_reason`) fronted by a single short-circuit at the top of the idle handler, with five independent detectors that can fire it.

  **The five detectors:**

  - **shipped-probe** — `git merge-base --is-ancestor HEAD origin/main` then `gh pr list --head <branch> --state merged`. Detects when the underlying work has already landed via a different branch / merged PR. Cached 60 s per session; 2 s `AbortController` timeout per subprocess; ENOENT / timeout / invalid JSON collapse to `"unknown"`. Originally motivated by a session where the loop kept firing "Plan has 22 unchecked acceptance criteria" nudges _after_ the work shipped, pressuring the orchestrator into ticking checkboxes on a stale local file to silence the plugin.
  - **user-stop** — `chat.message` handler scans the latest user message for explicit stop signals: uppercase bare `STOP` / `HALT`, plus case-insensitive phrases `stop autopilot` / `kill autopilot` / `disable autopilot` / `exit autopilot`. User-stop always wins.
  - **orchestrator-EXIT sentinel** — `<autopilot>EXIT</autopilot>` on its own line, emitted by the orchestrator when it recognizes the loop is wrong. Cooperative self-cancel. Detected by `AUTOPILOT_EXIT_RE`; wins over `<promise>DONE</promise>` when both appear.
  - **max-iterations** — 20-iteration budget. Funneled through the same exit latch so subsequent idles don't silently re-enter the legacy nudge branch at iteration 0 (a subtle re-entry bug in the prior implementation).
  - **stagnation** — snapshots the substrate (`git rev-parse HEAD` ⊕ `git status --porcelain`) on each idle. If the substrate hash is unchanged across 5 consecutive nudges, exits with `"stagnation"`. Catches the failure mode that shipped-probe misses (loop firing but nothing landing on disk) and that plan-checkbox-counting misses (boxes ticked without code changing). Snapshot failure (no git, not a repo, timeout) resets the counter rather than accumulating false stagnation evidence.

  The `/autopilot` slash-command prompt gains **Rule 9 — Autopilot exit**, teaching the orchestrator to emit `<autopilot>EXIT</autopilot>` when the loop is wrong (plan targets shipped work, user said stop, or the nudge is pressuring a scope violation) — rather than rationalizing "it's just a local gitignored file, ticking boxes is reversible" to silence the plugin.

  **Naming:** the original draft borrowed the omo marketing term "IntentGate" for this work. After researching the actual omo source (the term turns out to have no implementation behind it; omo's real hooks are `todo-continuation-enforcer` and `stop-continuation-guard`), this PR uses the indigenous **continuation-guard** vocabulary throughout — matching omo's documented `-guard` suffix convention and our codebase's existing hyphenated-plain-English style (`target-agent guard`, `fresh-transition`, `Phase 0: Bootstrap probe`).

  No migration required — the new `exited_reason`, `last_shipped_check_at`, `last_shipped_check_result`, `last_substrate_hash`, and `consecutive_stagnant_iterations` fields are optional additions to `SessionAutopilot`. Existing `.agent/autopilot-state.json` files continue to work unchanged. `/fresh` re-keys clear all five fields so a new task starts from a clean slate even after a terminal exit.

### Patch Changes

- [#55](https://github.com/iceglober/harness-opencode/pull/55) [`c518169`](https://github.com/iceglober/harness-opencode/commit/c518169aa9b4a7b26fdaebbcb3c7567fc589eaa3) Thanks [@iceglober](https://github.com/iceglober)! - Close a self-activation loophole in autopilot mode. The orchestrator was occasionally emitting `<promise>DONE</promise>` and delegating to `@autopilot-verifier` in sessions that were NOT invoked via `/autopilot` — symptoms of the orchestrator self-diagnosing into autopilot mode from ambient text (descriptive references to `/autopilot` or `AUTOPILOT mode` in prompt files, plan files, PR descriptions, etc.).

  Two-layer fix:

  - **Orchestrator prompt (primary)** — `src/agents/prompts/orchestrator.md` § `# Autopilot mode` rewritten. The activation clause is narrowed from "incoming message body contains the phrase" to "the session's FIRST user message was `/autopilot <args>` or contains the literal marker `AUTOPILOT mode` that the `/autopilot` command injects." An explicit non-trigger list enumerates the false-positive sources (reading prompt files, plan files, PR descriptions, session transcripts of other sessions, prior assistant messages, documents that mention the marker descriptively). A new self-check principle states: _"If you are unsure whether you are in autopilot mode, you are not."_ A new hard rule at the top of `# Hard rules` forbids emitting `<promise>DONE</promise>`, `<autopilot>EXIT</autopilot>`, or delegating to `@autopilot-verifier` outside a user-invoked `/autopilot` session. The Phase 4 description gains a clarifying negation so the `[PASS]` → `<promise>DONE</promise>` + verifier delegation path is explicitly gated on autopilot mode being active.

  - **Plugin (defense in depth)** — `src/plugins/autopilot.ts` `detectActivation` Signal 1 is tightened to check ONLY the first user message in the session for the activation marker, rather than scanning every user message. A marker appearing in a later user message is treated as either quoted context, a subsequent turn in an already-activated session (handled by the monotonic `enabled` flag), or a prompt-injection attempt — none of which should retroactively activate a non-`/autopilot`-initiated session. Signal 2 (fresh-handoff transition via `/plan-loop`) is unchanged; it's independent of user-message content.

  No migration required — the `/autopilot` slash command always lands in the first user message, so legitimate autopilot sessions are unaffected. Sessions that were wrongly self-activating now proceed through the normal five-phase workflow without firing completion-promise + verifier rituals. 6 new tests lock in the tightened gate (`test/autopilot-plugin.test.js`, 110 total tests now pass).

- [#56](https://github.com/iceglober/harness-opencode/pull/56) [`05c1feb`](https://github.com/iceglober/harness-opencode/commit/05c1feba0501e2d04911a3c93cf2148ecc391d1b) Thanks [@iceglober](https://github.com/iceglober)! - Fix two P0 bugs in `/fresh` reported in [#54](https://github.com/iceglober/harness-opencode/issues/54):

  - **Rendered prompt coherence.** OpenCode substitutes `$ARGUMENTS` into slash-command prompts wherever the token appears. Our prompts embedded it multiple times as self-reference ("Parse `$ARGUMENTS`", "If `$ARGUMENTS` is empty"), which turned long inputs (URLs, full sentences) into gibberish in the rendered prompt body. Rewrote `fresh.md`, `ship.md`, `autopilot.md`, `review.md`, and `costs.md` to substitute `$ARGUMENTS` exactly once at the top of each file and use semantic referents ("the user's input", "the plan path") everywhere else. Matches the pattern already used in `research.md` and `init-deep.md`. New CI test (`test/prompts-no-dangling-paths.test.ts`) enforces `$ARGUMENTS` occurs at most once per command prompt.
  - **`/fresh` unblocked under default permissions.** Orchestrator permissions now `allow` `git clean *` and `git reset --hard*` (previously `deny` and `ask`). `/fresh`'s destructive-reset step couldn't complete because `git clean` was hard-denied; and `git reset --hard` double-confirmed on top of `/fresh`'s own `question`-tool gate. Both permission-layer prompts were redundant noise for an orchestrator-scoped invocation. Global bash permissions (for user-typed commands) and build-agent permissions are unchanged — the relaxation is orchestrator-scoped.

- [#57](https://github.com/iceglober/harness-opencode/pull/57) [`e5ffb7c`](https://github.com/iceglober/harness-opencode/commit/e5ffb7ccea3be3a089948009c5a8ab0511cd1acc) Thanks [@iceglober](https://github.com/iceglober)! - Fix two permission-layer bugs that caused friction during subagent-delegated work (notably `/qa` runs hitting prompts on `git log`, `git merge-base`, `git diff --name-only`, `git branch --show-current`, and `/tmp/*`):

  - **Subagent permissions are now actually wired up.** The nested `permission:` YAML blocks declared in subagent prompt frontmatter (`src/agents/prompts/*.md`) were silently dropped by the flat frontmatter parser, and `agentFromPrompt` never read them. Subagents including `qa-reviewer`, `autopilot-verifier`, `plan-reviewer`, `gap-analyzer`, `code-searcher`, `architecture-advisor`, `lib-reader`, and `agents-md-writer` ran with no declared permissions, falling back to session defaults that prompt on read-only git operations. Fix: per-subagent permission constants (`QA_REVIEWER_PERMISSIONS`, `AUTOPILOT_VERIFIER_PERMISSIONS`, etc.) now live in `src/agents/index.ts` and are passed via the existing `overrides` arg on `agentFromPrompt()` — the same mechanism primary agents use. The dead `permission:` blocks have been stripped from the `.md` files so there's one source of truth.

  - **Scratch and XDG directories no longer prompt by default.** Added six paths to the plugin's `external_directory` defaults: `/tmp/**`, `/private/tmp/**` (macOS `/tmp` symlink target), `/var/folders/**/T/**` (macOS `$TMPDIR` expansion), `~/.config/opencode/**` (OpenCode's own config dir — agents read it to inspect current config), `~/.cache/**` (XDG cache; npm/pip/bun write here), and `~/.local/share/**` (XDG data; Linear MCP cache, etc.). Agents read these paths routinely with no security upside to prompting (the user already has access). User values in `opencode.json` still win — set e.g. `"/tmp/**": "deny"` or `"~/.cache/**": "deny"` to clamp any of them back down.

  `applyConfig` is now exported from `src/index.ts` to enable direct test coverage of the merge semantics. No behavior change to the `config` hook path. 9 new tests (`test/agents.test.ts` + new `test/external-directory.test.ts`) lock in the permission shape, regression-test read-only git commands in qa-reviewer, and verify user-wins precedence on `external_directory`.

- [#51](https://github.com/iceglober/harness-opencode/pull/51) [`9c5a152`](https://github.com/iceglober/harness-opencode/commit/9c5a1522cf6db842e8b3ce00b5535266b1479c06) Thanks [@iceglober](https://github.com/iceglober)! - `/ship` now executes end-to-end without firing OS-notification approval prompts at commit, squash, push, or PR creation. Only the declared Stop conditions (non-fast-forward push, pre-commit/pre-push hook failure, unknown working-tree shape, unstaged changes unrelated to the plan) still surface a `question` prompt.

  Root cause was a contradiction in the orchestrator prompt, which had a carve-out stating `/ship`'s per-step prompts were "legitimate and stay" — directly overriding ship.md's "no confirmation prompts, just do it" instruction. The carve-out and a related commit-message-review bullet are rewritten to match ship.md's actual contract. ship.md's top-of-file rule also now explicitly suspends the global "YOU MUST use the `question` tool" orchestrator rule for the duration of the command.

  Closes [#21](https://github.com/iceglober/harness-opencode/issues/21).

## 0.2.0

### Minor Changes

- [#44](https://github.com/iceglober/harness-opencode/pull/44) [`950d638`](https://github.com/iceglober/harness-opencode/commit/950d6380958459c5565f4dbbd9b65524db39e4ea) Thanks [@iceglober](https://github.com/iceglober)! - **BREAKING (hook authors only):** `/fresh` no longer runs its built-in reset flow when `.glorious/hooks/fresh-reset` is present and executable. The hook now OWNS the reset strategy end-to-end (discard working tree, switch branch, run project-specific cleanup). Previously the hook was an augment that ran _after_ the built-in flow. Hooks that relied on the built-in flow running first must update to do their own `git reset --hard`, `git clean -fdx`, and `git checkout -b origin/<base>` — or users can pass `--skip-hook` on a case-by-case basis to force the built-in flow. Env-var inputs (`OLD_BRANCH`, `NEW_BRANCH`, `BASE_BRANCH`, `WORKTREE_DIR`, `WORKTREE_NAME`, `FRESH_PASSTHROUGH_ARGS`), pass-through positional args, exit-code semantics, and stdout-JSON-tail-for-enrichment convention are unchanged.

  Additional changes that ride along:

  - `/fresh` hook invocation now respects the hook's shebang (previously forced `bash <path>` even for hooks with `#!/usr/bin/env python3`, `#!/usr/bin/env zsh`, etc.). This was a latent bug; non-bash hooks now run correctly.
  - `/fresh` `--skip-hook` semantics: "bypass the hook and use the built-in reset." Functionally equivalent for users who only relied on augment-mode hooks (both skip the hook; built-in runs either way). Mental-model rename, not a behavior break for that case.
  - Non-executable `.glorious/hooks/fresh-reset` (hook file present, `+x` bit unset) now emits a WARN in the `/fresh` summary and handoff brief and falls back to the built-in flow. Previously the hook was silently skipped, surprising users who `chmod -x`'d their hook as a kill-switch but got no visible feedback.
  - `/fresh` command description rewritten to reflect actual behavior (re-keys an existing worktree, does not create one, does not require `gsag`).
  - Removed dangling reference to `docs/fresh.md` in `src/commands/prompts/fresh.md` (the doc was deleted in v0.1.0 rename but the reference in the prompt survived).

### Patch Changes

- [#41](https://github.com/iceglober/harness-opencode/pull/41) [`d53c9bb`](https://github.com/iceglober/harness-opencode/commit/d53c9bbc37eacd3ce8e397d4b6c5342077ab4b2c) Thanks [@iceglober](https://github.com/iceglober)! - Automate releases with Changesets. Every PR now declares its version impact via `bunx changeset`; merges to `main` open a "Version Packages" PR that aggregates pending changesets; merging that PR auto-publishes to npm with provenance. No runtime behavior change for end users.

All notable changes to `@glrs-dev/harness-opencode` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-04-21

### Fixed

- **Plugin failed to load in production.** When tsup bundles `src/agents/shared/index.ts`, `src/agents/index.ts`, `src/commands/index.ts`, and `src/bin/plan-check.ts` into `dist/index.js`, `import.meta.url` resolves to `dist/` — not the original module's subdirectory. All `readFileSync`-based path resolution was looking for `dist/prompts/<file>` instead of `dist/agents/prompts/<file>`, causing `Could not find shared file: workflow-mechanics.md` on every session start. Agents, commands, and plan-check all failed to load; only `plan` and `build` (which come from OpenCode's built-in agents, not our plugin) were visible.
- **Migration docs used GNU-only `find -xtype l`** which fails on macOS's BSD `find`. Replaced with portable `find -type l ! -exec test -e {} \; -print -delete`.

## [0.1.1] — 2026-04-21

### Changed

- Version bump to exercise the release CI pipeline end-to-end. No functional changes from 0.1.0.

## [0.1.0] — 2026-04-21

### Added

- Initial npm release. Pivoted from the clone+symlink installer model to an npm-delivered OpenCode plugin.
- 12 agents (3 primary + 9 subagents) registered via the plugin `config` hook.
- 7 slash commands: `/ship`, `/autopilot`, `/review`, `/init-deep`, `/research`, `/fresh`, `/costs`.
- 5 custom tools: `ast_grep`, `tsc_check`, `eslint_check`, `todo_scan`, `comment_check`.
- 4 bundled skills: `review-plan`, `web-design-guidelines`, `vercel-react-best-practices`, `vercel-composition-patterns`.
- MCP server wiring for `serena`, `memory`, `git` (enabled), `playwright`, `linear` (disabled by default).
- Bundled sub-plugins: `notify` (OS notifications), `autopilot` (completion-tag loop), `cost-tracker` (LLM spend tracking).
- CLI: `bunx @glrs-dev/harness-opencode install`, `uninstall`, `doctor`, `plan-check`.

### Migration from clone+symlink install

See [MIGRATION.md](./MIGRATION.md) and [docs/migration-from-clone-install.md](./docs/migration-from-clone-install.md).
The last pre-pivot state is tagged `v0-legacy-clone-install` with the retired installer scripts attached as release assets.
