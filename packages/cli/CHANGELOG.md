# @glrs-dev/cli

## 3.6.1

### Patch Changes

- Updated dependencies [[`020048c`](https://github.com/iceglober/glrs/commit/020048ce087a93d6ef0f2cab40f1f08508393ce1)]:
  - @glrs-dev/harness-plugin-opencode@3.6.1

## 3.6.0

### Patch Changes

- Updated dependencies [[`a95b653`](https://github.com/iceglober/glrs/commit/a95b6538f466320e7ed64b392814fae00358a890)]:
  - @glrs-dev/harness-plugin-opencode@3.6.0

## 3.5.3

### Patch Changes

- [#283](https://github.com/iceglober/glrs/pull/283) [`d10a642`](https://github.com/iceglober/glrs/commit/d10a6427e538ada504cdd87e3b0797b57b48c7bf) Thanks [@iceglober](https://github.com/iceglober)! - fix(cli): make `glrs assume` install resilient to a missing npm, and idempotent

  `glrs assume <cmd>` hardcoded `npm i -g @glrs-dev/assume`, so on a Bun-only
  machine — where `glrs` itself runs — the one package manager guaranteed present
  was never tried, and install dead-ended at "npm not found".

  - Probe `npm → bun → pnpm → yarn` and install with the first that exists. Bun
    is always available under `glrs`, so a working install can't hit a true dead
    end. If none exist, fail with a copy-pasteable `bun add -g @glrs-dev/assume`.
  - Lazy install (`glrs assume login`, etc.) is idempotent: a working `gsa` on
    PATH short-circuits to a no-op; after installing it re-verifies `gsa` is
    reachable and otherwise prints PATH guidance for the chosen manager.
  - `glrs assume init` stays convergent — legacy `@glorious/assume` cleanup still
    runs (npm-only, since that's the only way it could have been installed).

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@3.5.3

## 3.5.2

### Patch Changes

- Updated dependencies [[`96d5509`](https://github.com/iceglober/glrs/commit/96d5509facb3a4fd03c4df577124c71e82dcfe2e)]:
  - @glrs-dev/harness-plugin-opencode@3.5.2

## 3.5.1

### Patch Changes

- [#279](https://github.com/iceglober/glrs/pull/279) [`2d66f85`](https://github.com/iceglober/glrs/commit/2d66f85fd9f6a050134c503ac868ea860f8f6f75) Thanks [@iceglober](https://github.com/iceglober)! - Fix telemetry: send events to the live Counted ingest host.

  The `@counted/sdk` defaults its ingest host to `https://counted.dev`, which has
  no DNS record — so every tracked event silently vanished into a failed POST. Both
  the CLI and harness analytics now point at the live host `https://app.counted.dev`
  (verified to return HTTP 202), overridable via `COUNTED_HOST`. No events were
  delivered before this fix.

- Updated dependencies [[`2d66f85`](https://github.com/iceglober/glrs/commit/2d66f85fd9f6a050134c503ac868ea860f8f6f75)]:
  - @glrs-dev/harness-plugin-opencode@3.5.1

## 3.5.0

### Patch Changes

- Updated dependencies [[`beafa60`](https://github.com/iceglober/glrs/commit/beafa60492ee983ba23e52ab5fb7c1780861b28c)]:
  - @glrs-dev/harness-plugin-opencode@3.5.0

## 3.4.0

### Minor Changes

- [#275](https://github.com/iceglober/glrs/pull/275) [`f818869`](https://github.com/iceglober/glrs/commit/f818869bff4ebeb882bf1c241438c1f5a33b02c5) Thanks [@iceglober](https://github.com/iceglober)! - Add privacy-first product analytics via Counted.

  `glrs` now sends anonymous usage events (which command ran, plus non-PII flags
  like success/failure and counts) to help prioritize work. No cookies, no
  fingerprinting, no PII — never repo names, branch names, paths, or arguments.
  Tracking never blocks or fails a command, and a dead network can never delay
  exit. Opt out with `DO_NOT_TRACK=1` or `GLRS_NO_ANALYTICS=1`.

### Patch Changes

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@3.4.0

## 3.3.1

### Patch Changes

- Updated dependencies [[`f48ef1c`](https://github.com/iceglober/glrs/commit/f48ef1c27a6c76f5a3d4d422190b7f5d6297d5c4)]:
  - @glrs-dev/harness-plugin-opencode@3.3.1

## 3.3.0

### Patch Changes

- Updated dependencies [[`3aff060`](https://github.com/iceglober/glrs/commit/3aff060ec80e239ce0f50a747371b50ab7e8f96a)]:
  - @glrs-dev/harness-plugin-opencode@3.3.0

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

### Patch Changes

- Updated dependencies [[`97f9637`](https://github.com/iceglober/glrs/commit/97f9637e8a01f41b3d71f65924c594862e1f49b3)]:
  - @glrs-dev/harness-plugin-opencode@3.2.0

## 3.1.0

### Minor Changes

- [#258](https://github.com/iceglober/glrs/pull/258) [`a4cf228`](https://github.com/iceglober/glrs/commit/a4cf228c995dd3de2fe60d79a533d18f09aedf36) Thanks [@iceglober](https://github.com/iceglober)! - feat(assume): `gsa init` requires a default context, gates all commands until set up, and self-repairs broken installs

  `gsa init` now requires choosing a default context (what the bare credential
  endpoint and `gsa exec`/agents resolve to when none is pinned). Pick it
  interactively or pass `--default-context <pattern>`.

  `glrs assume init` repairs and migrates in one shot: it removes the deprecated
  `@glorious/assume` package (whose stale `gsa`/`gs-assume` bins shadow the
  current install), installs the latest `@glrs-dev/assume`, and migrates a
  pre-rebrand `gs-assume` config directory forward (copy, never delete) so you
  keep providers, contexts, and credentials.

  Breaking: until `gsa init` completes, gsa is non-functional — every command
  except `init`, `upgrade`, `shell-init`, `status`, and `config` refuses with a
  pointer to `gsa init`. This prevents the half-configured state where the daemon
  is running but no default context exists. Existing users must run `gsa init`
  once after upgrading to write the new init marker.

### Patch Changes

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@3.1.0

## 3.0.1

### Patch Changes

- [#254](https://github.com/iceglober/glrs/pull/254) [`ba7a0c0`](https://github.com/iceglober/glrs/commit/ba7a0c059cbe64a9c9696562a1d4c8aa595a15b1) Thanks [@iceglober](https://github.com/iceglober)! - refactor: extract agent identity into `@glrs-dev/agent-core` and generate reference docs from code

  - New private, framework-agnostic package `@glrs-dev/agent-core` holds the single source of truth for agent names, tiers, and doc metadata (`AGENTS`, `AGENT_TIERS`, `AGENT_DOC_META`). It's bundled into the published harness and CLI (no new runtime dependency), and is ready to be shared by a future Claude Code harness plugin.
  - The OpenCode harness, autopilot, and the CLI adapters now import these constants instead of hard-coding agent-name strings, so a rename is a single edit.
  - `dispatch-tracker` now derives an agent's tier from the authoritative `AGENT_TIERS` map (covering every registered agent) before falling back to name-suffix heuristics.
  - New `bun run gen-docs` regenerates the docs-site agent, command, and skills reference pages from code (`bun run gen-docs:check` guards drift), and a new Skills page is added to the docs site.

  No public API changes to the published packages.

- Updated dependencies [[`ba7a0c0`](https://github.com/iceglober/glrs/commit/ba7a0c059cbe64a9c9696562a1d4c8aa595a15b1)]:
  - @glrs-dev/harness-plugin-opencode@3.0.1

## 3.0.0

### Patch Changes

- Updated dependencies [[`58c9b49`](https://github.com/iceglober/glrs/commit/58c9b4979606ab9d071420b0dbcd0fa960e188ec)]:
  - @glrs-dev/harness-plugin-opencode@3.0.0

## 2.31.0

### Patch Changes

- Updated dependencies [[`9576a7f`](https://github.com/iceglober/glrs/commit/9576a7fa541c35a8e4ca784e0d2091e52b106512)]:
  - @glrs-dev/harness-plugin-opencode@2.31.0

## 2.30.0

### Patch Changes

- [#247](https://github.com/iceglober/glrs/pull/247) [`67f2f2b`](https://github.com/iceglober/glrs/commit/67f2f2b064eee92578385eb5e5d16668bb5b0528) Thanks [@iceglober](https://github.com/iceglober)! - feat(harness): headroom tool-output compression — provider-agnostic

  The harness now compresses large tool outputs through headroom's local compression
  service (if running). Works with any LLM provider (Bedrock, Anthropic, OpenAI).
  Falls back to built-in truncation when headroom isn't available.

  Also removes the old proxy-redirect approach from `glrs headroom init` — headroom
  is now a compression service, not an API proxy.

- Updated dependencies [[`67f2f2b`](https://github.com/iceglober/glrs/commit/67f2f2b064eee92578385eb5e5d16668bb5b0528)]:
  - @glrs-dev/harness-plugin-opencode@2.30.0

## 2.29.3

### Patch Changes

- [#245](https://github.com/iceglober/glrs/pull/245) [`19f80b2`](https://github.com/iceglober/glrs/commit/19f80b2c7707265eafb4295d8839e0d38cfef519) Thanks [@iceglober](https://github.com/iceglober)! - fix(cli): auto-update uses npm when installed via npm (stops update loop)

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.29.3

## 2.29.2

### Patch Changes

- [#243](https://github.com/iceglober/glrs/pull/243) [`a0f0e15`](https://github.com/iceglober/glrs/commit/a0f0e15cad83a74ea1a0b3d004e3a6017aeacf1e) Thanks [@iceglober](https://github.com/iceglober)! - fix(cli): auto-update uses npm when installed via npm (stops update loop)

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.29.2

## 2.29.1

### Patch Changes

- [#238](https://github.com/iceglober/glrs/pull/238) [`bff2816`](https://github.com/iceglober/glrs/commit/bff2816144a57ddad4c283be86a60caf4f20f2ee) Thanks [@iceglober](https://github.com/iceglober)! - fix(cli): headroom install uses uv with Python 3.13 + auto-installs uv if missing

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.29.1

## 2.29.0

### Minor Changes

- [#236](https://github.com/iceglober/glrs/pull/236) [`186e86c`](https://github.com/iceglober/glrs/commit/186e86cdac5f1e594175e422f4b26acf1cd58db8) Thanks [@iceglober](https://github.com/iceglober)! - feat(cli): add `glrs headroom` subcommand for context compression via headroom-ai

### Patch Changes

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.29.0

## 2.28.2

### Patch Changes

- Updated dependencies [[`468560c`](https://github.com/iceglober/glrs/commit/468560c8a0109aea43c336cb075679525bc3557c)]:
  - @glrs-dev/harness-plugin-opencode@2.28.2

## 2.28.1

### Patch Changes

- Updated dependencies [[`0e76646`](https://github.com/iceglober/glrs/commit/0e766469bbde0ac4ce554cac2985bdbecaa3a24c)]:
  - @glrs-dev/harness-plugin-opencode@2.28.1

## 2.28.0

### Patch Changes

- Updated dependencies [[`c123106`](https://github.com/iceglober/glrs/commit/c123106b52cb902517af466521ecc1a1e610217d)]:
  - @glrs-dev/harness-plugin-opencode@2.28.0

## 2.27.2

### Patch Changes

- Updated dependencies [[`32b4f27`](https://github.com/iceglober/glrs/commit/32b4f2731055fadd850c94408a4b0a08478034b7)]:
  - @glrs-dev/harness-plugin-opencode@2.27.2

## 2.27.1

### Patch Changes

- Updated dependencies [[`cf0cfc2`](https://github.com/iceglober/glrs/commit/cf0cfc2e1135000cea242c74ad9e4658757e5c14)]:
  - @glrs-dev/harness-plugin-opencode@2.27.1

## 2.27.0

### Minor Changes

- [#209](https://github.com/iceglober/glrs/pull/209) [`8189f66`](https://github.com/iceglober/glrs/commit/8189f6627cc84597102a16cc113033317b6efe59) Thanks [@iceglober](https://github.com/iceglober)! - feat(cli): `glrs harness hooks init` scaffolds example hooks and extensions

  - Add `glrs harness hooks init` — writes example `.glrs/hooks/` and `.glrs/extensions/` files to the current repo. Does not overwrite existing files.
  - Rename hooks to snake_case: `wt-new` → `wt_new`, `fresh-reset` → `fresh_init`
  - Wire all workflow commands (/ship, /fresh, /review, /research, /init-deep) to read `.glrs/extensions/<command>.md`

### Patch Changes

- Updated dependencies [[`8189f66`](https://github.com/iceglober/glrs/commit/8189f6627cc84597102a16cc113033317b6efe59)]:
  - @glrs-dev/harness-plugin-opencode@2.27.0

## 2.26.2

### Patch Changes

- Updated dependencies [[`d25067e`](https://github.com/iceglober/glrs/commit/d25067e7d6a93afc0a98325d86acbf7af35f6762)]:
  - @glrs-dev/harness-plugin-opencode@2.26.2

## 2.26.1

### Patch Changes

- Updated dependencies [[`5b53b96`](https://github.com/iceglober/glrs/commit/5b53b96aed800aa4dc8353bd5e7ca4e443824209)]:
  - @glrs-dev/harness-plugin-opencode@2.26.1

## 2.26.0

### Patch Changes

- Updated dependencies [[`5446a11`](https://github.com/iceglober/glrs/commit/5446a1189ce74861374438e876f9100911ab43c9)]:
  - @glrs-dev/harness-plugin-opencode@2.26.0

## 2.25.0

### Patch Changes

- Updated dependencies [[`4b073bf`](https://github.com/iceglober/glrs/commit/4b073bf5d8388c9fa4e14bf5e1fd0287dcf79fff)]:
  - @glrs-dev/harness-plugin-opencode@2.25.0

## 2.24.2

### Patch Changes

- Updated dependencies [[`bb98089`](https://github.com/iceglober/glrs/commit/bb98089db8dc62594d45e3fc65f3251bd49c6f3b)]:
  - @glrs-dev/harness-plugin-opencode@2.24.2

## 2.24.1

### Patch Changes

- [#197](https://github.com/iceglober/glrs/pull/197) [`04765b3`](https://github.com/iceglober/glrs/commit/04765b36fb49780143c66d3d0a4f87f0446ba5f6) Thanks [@iceglober](https://github.com/iceglober)! - fix(cli): `glrs upgrade` now writes fresh registry result to auto-update state

  Previously, `upgrade` and `autoUpdate` maintained separate state. If `upgrade`
  ran during npm CDN propagation delay and cached a stale version, the 1-hour
  rate limit prevented `autoUpdate` from re-checking on the next command.
  Now `upgrade` writes the registry result to the shared state file so both
  paths stay in sync.

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.24.1

## 2.24.0

### Patch Changes

- Updated dependencies [[`6244a31`](https://github.com/iceglober/glrs/commit/6244a31f733cd54529b12906726139bb4e925f78)]:
  - @glrs-dev/harness-plugin-opencode@2.24.0

## 2.23.1

### Patch Changes

- Updated dependencies [[`1461ca7`](https://github.com/iceglober/glrs/commit/1461ca7d78e473545799a2ad13798114cb87e8cd)]:
  - @glrs-dev/harness-plugin-opencode@2.23.1

## 2.23.0

### Patch Changes

- Updated dependencies [[`e4fb192`](https://github.com/iceglober/glrs/commit/e4fb1921cd21ff792bc2b1d50404b5c929e691ca)]:
  - @glrs-dev/harness-plugin-opencode@2.23.0

## 2.22.0

### Patch Changes

- Updated dependencies [[`0fd62f4`](https://github.com/iceglober/glrs/commit/0fd62f44d8317b864a4954f7c48a04ca3aad9b24), [`c4a2455`](https://github.com/iceglober/glrs/commit/c4a2455f3eb050f3925cb57e6ae29c037e284df2)]:
  - @glrs-dev/harness-plugin-opencode@2.22.0

## 2.21.1

### Patch Changes

- Updated dependencies [[`120a068`](https://github.com/iceglober/glrs/commit/120a068f4bd2f3a542bb6d1d4a049785f4082260)]:
  - @glrs-dev/harness-plugin-opencode@2.21.1

## 2.21.0

### Minor Changes

- [#184](https://github.com/iceglober/glrs/pull/184) [`3b95289`](https://github.com/iceglober/glrs/commit/3b95289255af646ee4d83827acddd63ad63b74f6) Thanks [@iceglober](https://github.com/iceglober)! - feat: add .glrs/hooks/ and .glrs/extensions/ system

  **Hooks** (shell scripts, run by the CLI):

  - `.glrs/hooks/wt-new` — runs after `glrs wt new` creates a worktree. Receives the worktree path as $1 and WORKTREE_DIR + REPO_NAME as env vars. Use for: installing deps, setting up .env, running migrations, starting dev services.

  **Extensions** (agent prompt fragments, loaded by the harness):

  - `.glrs/extensions/post-ship.md` — appended to the `/ship` command's prompt. Use for: custom post-PR-creation behavior like "wait for auto-review, address feedback, monitor checks, get PR mergeable."

  Hooks are executable files that run synchronously with a 2-minute timeout. Extensions are markdown files whose content is injected into the agent's prompt at command dispatch time. Both are repo-level (committed, shared across worktrees).

### Patch Changes

- Updated dependencies [[`3b95289`](https://github.com/iceglober/glrs/commit/3b95289255af646ee4d83827acddd63ad63b74f6)]:
  - @glrs-dev/harness-plugin-opencode@2.21.0

## 2.20.0

### Patch Changes

- Updated dependencies [[`60700e1`](https://github.com/iceglober/glrs/commit/60700e107163126c211cd0b439b1bccdda717623)]:
  - @glrs-dev/harness-plugin-opencode@2.20.0

## 2.19.0

### Patch Changes

- Updated dependencies [[`f635283`](https://github.com/iceglober/glrs/commit/f63528302ca53a858321e2bd522b027cc6668e33)]:
  - @glrs-dev/harness-plugin-opencode@2.19.0

## 2.18.0

### Patch Changes

- Updated dependencies [[`aa77f41`](https://github.com/iceglober/glrs/commit/aa77f4189a802644703440f65e01f9ba971f3ed1)]:
  - @glrs-dev/harness-plugin-opencode@2.18.0

## 2.17.0

### Patch Changes

- Updated dependencies [[`7cef98d`](https://github.com/iceglober/glrs/commit/7cef98de31bc6f6dab4f13aa2f8ac2348ad08f2a)]:
  - @glrs-dev/harness-plugin-opencode@2.17.0

## 2.16.0

### Patch Changes

- Updated dependencies [[`d071813`](https://github.com/iceglober/glrs/commit/d0718131f883abeea1f8e3fd664d39dd27b4c27c)]:
  - @glrs-dev/harness-plugin-opencode@2.16.0

## 2.15.0

### Patch Changes

- Updated dependencies [[`2f18be5`](https://github.com/iceglober/glrs/commit/2f18be5d900d971d8519c66e741b387329c07609)]:
  - @glrs-dev/harness-plugin-opencode@2.15.0

## 2.14.0

### Patch Changes

- Updated dependencies [[`67510c4`](https://github.com/iceglober/glrs/commit/67510c462b5cd2e40a6f95e992c5096b4c4a12a9)]:
  - @glrs-dev/harness-plugin-opencode@2.14.0

## 2.13.0

### Patch Changes

- Updated dependencies [[`d2d4c26`](https://github.com/iceglober/glrs/commit/d2d4c260347d85bba77f50d4ddafef54ad877cc0), [`d2d4c26`](https://github.com/iceglober/glrs/commit/d2d4c260347d85bba77f50d4ddafef54ad877cc0)]:
  - @glrs-dev/harness-plugin-opencode@2.13.0

## 2.12.0

### Patch Changes

- Updated dependencies [[`037a9c1`](https://github.com/iceglober/glrs/commit/037a9c1cc0a42eefd58a75a2fc0efc54547f902b)]:
  - @glrs-dev/harness-plugin-opencode@2.12.0

## 2.11.2

### Patch Changes

- Updated dependencies [[`45a7550`](https://github.com/iceglober/glrs/commit/45a7550e64b9dd06fe677fe2f551e2a348c43fba)]:
  - @glrs-dev/harness-plugin-opencode@2.11.2

## 2.11.1

### Patch Changes

- Updated dependencies [[`3459b1e`](https://github.com/iceglober/glrs/commit/3459b1effa931753ebc044ddcb87e8f3db32f100)]:
  - @glrs-dev/harness-plugin-opencode@2.11.1

## 2.11.0

### Patch Changes

- Updated dependencies [[`c7d206e`](https://github.com/iceglober/glrs/commit/c7d206e3a6e48d555b9561cb8821634c7483280c)]:
  - @glrs-dev/harness-plugin-opencode@2.11.0

## 2.10.26

### Patch Changes

- [#155](https://github.com/iceglober/glrs/pull/155) [`c521908`](https://github.com/iceglober/glrs/commit/c5219089e081cae7abe930dcd59e601ddd3a4884) Thanks [@iceglober](https://github.com/iceglober)! - Prompt forbids branch switching — agent was creating branches from plan metadata, losing all prior work

- Updated dependencies [[`c521908`](https://github.com/iceglober/glrs/commit/c5219089e081cae7abe930dcd59e601ddd3a4884)]:
  - @glrs-dev/autopilot@0.7.7
  - @glrs-dev/adapter-claude-code@0.1.21
  - @glrs-dev/adapter-opencode@0.1.23
  - @glrs-dev/harness-plugin-opencode@2.10.26

## 2.10.25

### Patch Changes

- [#153](https://github.com/iceglober/glrs/pull/153) [`ed41724`](https://github.com/iceglober/glrs/commit/ed41724ecacd8126f27049fc3a302335fc5b02aa) Thanks [@iceglober](https://github.com/iceglober)! - Hard per-iteration timeout via AbortController — guarantees hung connections are killed even when SSE stream stays alive

- Updated dependencies [[`ed41724`](https://github.com/iceglober/glrs/commit/ed41724ecacd8126f27049fc3a302335fc5b02aa)]:
  - @glrs-dev/autopilot@0.7.6
  - @glrs-dev/adapter-claude-code@0.1.20
  - @glrs-dev/adapter-opencode@0.1.22
  - @glrs-dev/harness-plugin-opencode@2.10.25

## 2.10.24

### Patch Changes

- [#151](https://github.com/iceglober/glrs/pull/151) [`8e329ce`](https://github.com/iceglober/glrs/commit/8e329cea5a47e5784c4ec0956964975a2008abd5) Thanks [@iceglober](https://github.com/iceglober)! - Fix stall detection: remove blanket resetStall on SSE heartbeats — only tool calls and text deltas indicate real activity

- Updated dependencies [[`8e329ce`](https://github.com/iceglober/glrs/commit/8e329cea5a47e5784c4ec0956964975a2008abd5)]:
  - @glrs-dev/adapter-opencode@0.1.21
  - @glrs-dev/harness-plugin-opencode@2.10.24

## 2.10.23

### Patch Changes

- [#149](https://github.com/iceglober/glrs/pull/149) [`6cc8977`](https://github.com/iceglober/glrs/commit/6cc897792d887db0c4a2628ad7eecb1c7a4b2e7f) Thanks [@iceglober](https://github.com/iceglober)! - Fix status file: subscribe bridge to wildcard event channel so it receives iteration/cost events from inside the loop

- Updated dependencies [[`6cc8977`](https://github.com/iceglober/glrs/commit/6cc897792d887db0c4a2628ad7eecb1c7a4b2e7f)]:
  - @glrs-dev/autopilot@0.7.5
  - @glrs-dev/adapter-claude-code@0.1.19
  - @glrs-dev/adapter-opencode@0.1.20
  - @glrs-dev/harness-plugin-opencode@2.10.23

## 2.10.22

### Patch Changes

- [#147](https://github.com/iceglober/glrs/pull/147) [`46f40bb`](https://github.com/iceglober/glrs/commit/46f40bbcfe5df62c94e5f286ba70f0e6f69ebd8d) Thanks [@iceglober](https://github.com/iceglober)! - Fix stall timer: cost polling events no longer reset the timer, so hung connections are detected within 90 seconds

- Updated dependencies [[`46f40bb`](https://github.com/iceglober/glrs/commit/46f40bbcfe5df62c94e5f286ba70f0e6f69ebd8d)]:
  - @glrs-dev/adapter-opencode@0.1.19
  - @glrs-dev/harness-plugin-opencode@2.10.22

## 2.10.21

### Patch Changes

- [#145](https://github.com/iceglober/glrs/pull/145) [`94af32b`](https://github.com/iceglober/glrs/commit/94af32b00cbde60ef210b49e4e0c4db1f76254f2) Thanks [@iceglober](https://github.com/iceglober)! - Fix: commit checked state after verify passes, not before — prevents false-positive item completion on verify failure

- Updated dependencies [[`94af32b`](https://github.com/iceglober/glrs/commit/94af32b00cbde60ef210b49e4e0c4db1f76254f2)]:
  - @glrs-dev/autopilot@0.7.4
  - @glrs-dev/adapter-claude-code@0.1.18
  - @glrs-dev/adapter-opencode@0.1.18
  - @glrs-dev/harness-plugin-opencode@2.10.21

## 2.10.20

### Patch Changes

- [#141](https://github.com/iceglober/glrs/pull/141) [`a90c16e`](https://github.com/iceglober/glrs/commit/a90c16e0826dffa755c64bc0e3e021824fe4280d) Thanks [@iceglober](https://github.com/iceglober)! - Agent prompt requires running verify command before emitting sentinel — catches test failures during development, not after

- Updated dependencies [[`a90c16e`](https://github.com/iceglober/glrs/commit/a90c16e0826dffa755c64bc0e3e021824fe4280d)]:
  - @glrs-dev/autopilot@0.7.3
  - @glrs-dev/adapter-claude-code@0.1.17
  - @glrs-dev/adapter-opencode@0.1.17
  - @glrs-dev/harness-plugin-opencode@2.10.20

## 2.10.19

### Patch Changes

- [#139](https://github.com/iceglober/glrs/pull/139) [`db2a2ae`](https://github.com/iceglober/glrs/commit/db2a2aef8c6761d7383ca28a608842568ae56620) Thanks [@iceglober](https://github.com/iceglober)! - Aggressive stall timeouts: 90s default, 3m deep — hung API connections fail fast instead of blocking 10-30 minutes

- Updated dependencies [[`db2a2ae`](https://github.com/iceglober/glrs/commit/db2a2aef8c6761d7383ca28a608842568ae56620)]:
  - @glrs-dev/autopilot@0.7.2
  - @glrs-dev/adapter-claude-code@0.1.16
  - @glrs-dev/adapter-opencode@0.1.16
  - @glrs-dev/harness-plugin-opencode@2.10.19

## 2.10.18

### Patch Changes

- [#136](https://github.com/iceglober/glrs/pull/136) [`302ebab`](https://github.com/iceglober/glrs/commit/302ebab7c56c357f3827190a013d9fd7398ba9f8) Thanks [@iceglober](https://github.com/iceglober)! - Snapshot spec files before phase attempts to survive agent branch switches and git rollbacks

- Updated dependencies [[`302ebab`](https://github.com/iceglober/glrs/commit/302ebab7c56c357f3827190a013d9fd7398ba9f8)]:
  - @glrs-dev/autopilot@0.7.1
  - @glrs-dev/adapter-claude-code@0.1.15
  - @glrs-dev/adapter-opencode@0.1.15
  - @glrs-dev/harness-plugin-opencode@2.10.18

## 2.10.17

### Patch Changes

- [#133](https://github.com/iceglober/glrs/pull/133) [`bdd69cd`](https://github.com/iceglober/glrs/commit/bdd69cd460f3ea9d3945080a70934cb48544b3e3) Thanks [@iceglober](https://github.com/iceglober)! - Smart-optional workflow features: per-phase stacked PRs, Linear issue status management, dependency auto-installation, per-item commit boundaries

- Updated dependencies [[`bdd69cd`](https://github.com/iceglober/glrs/commit/bdd69cd460f3ea9d3945080a70934cb48544b3e3)]:
  - @glrs-dev/autopilot@0.7.0
  - @glrs-dev/adapter-claude-code@0.1.14
  - @glrs-dev/adapter-opencode@0.1.14
  - @glrs-dev/harness-plugin-opencode@2.10.17

## 2.10.16

### Patch Changes

- [#131](https://github.com/iceglober/glrs/pull/131) [`e74a396`](https://github.com/iceglober/glrs/commit/e74a396925b567ce194345a8248db076dbc44ef0) Thanks [@iceglober](https://github.com/iceglober)! - Autopilot iteration architecture: orchestrator-owned checkboxes, tool-call-aware struggle detection, item-level phase timeout, per-item cap floor, and in-flight spec adjustment via deep-model review

- Updated dependencies [[`e74a396`](https://github.com/iceglober/glrs/commit/e74a396925b567ce194345a8248db076dbc44ef0)]:
  - @glrs-dev/autopilot@0.6.0
  - @glrs-dev/adapter-claude-code@0.1.13
  - @glrs-dev/adapter-opencode@0.1.13
  - @glrs-dev/harness-plugin-opencode@2.10.16

## 2.10.15

### Patch Changes

- [#129](https://github.com/iceglober/glrs/pull/129) [`3e818da`](https://github.com/iceglober/glrs/commit/3e818daebc6d114a5bf7e24a2d28826b2d23528b) Thanks [@iceglober](https://github.com/iceglober)! - Per-item rollback, checkpoint.json removal, and dead code cleanup — commits are the checkpoint mechanism now

- Updated dependencies [[`3e818da`](https://github.com/iceglober/glrs/commit/3e818daebc6d114a5bf7e24a2d28826b2d23528b)]:
  - @glrs-dev/autopilot@0.5.0
  - @glrs-dev/adapter-claude-code@0.1.12
  - @glrs-dev/adapter-opencode@0.1.12
  - @glrs-dev/harness-plugin-opencode@2.10.15

## 2.10.14

### Patch Changes

- [#127](https://github.com/iceglober/glrs/pull/127) [`8a0ce16`](https://github.com/iceglober/glrs/commit/8a0ce167bcbf94e3eea4bec2222a05ed56ffe442) Thanks [@iceglober](https://github.com/iceglober)! - Add autopilot observability: recovery event rendering, 30s heartbeat timer, per-phase wall-clock timeout (30 min default)

- Updated dependencies [[`8a0ce16`](https://github.com/iceglober/glrs/commit/8a0ce167bcbf94e3eea4bec2222a05ed56ffe442), [`8a0ce16`](https://github.com/iceglober/glrs/commit/8a0ce167bcbf94e3eea4bec2222a05ed56ffe442)]:
  - @glrs-dev/autopilot@0.4.2
  - @glrs-dev/adapter-claude-code@0.1.11
  - @glrs-dev/adapter-opencode@0.1.11
  - @glrs-dev/harness-plugin-opencode@2.10.14

## 2.10.13

### Patch Changes

- [#125](https://github.com/iceglober/glrs/pull/125) [`9b0524a`](https://github.com/iceglober/glrs/commit/9b0524a0b7d3cd8b73d6bfc0883c0d960a24ad8f) Thanks [@iceglober](https://github.com/iceglober)! - Add autopilot observability: recovery event rendering, 30s heartbeat timer, per-phase wall-clock timeout (30 min default)

- Updated dependencies [[`9b0524a`](https://github.com/iceglober/glrs/commit/9b0524a0b7d3cd8b73d6bfc0883c0d960a24ad8f)]:
  - @glrs-dev/autopilot@0.4.1
  - @glrs-dev/adapter-claude-code@0.1.10
  - @glrs-dev/adapter-opencode@0.1.10
  - @glrs-dev/harness-plugin-opencode@2.10.13

## 2.10.12

### Patch Changes

- [#122](https://github.com/iceglober/glrs/pull/122) [`088dcd8`](https://github.com/iceglober/glrs/commit/088dcd8a2cbf40e2e83271d1f8dc794fceeee2b5) Thanks [@iceglober](https://github.com/iceglober)! - Autopilot recovery: 5 evolving retry attempts on every failure mode (verify, crash, stall, max-iterations) with progressive strategy changes and deep-model escalation. Phases never skip on failure — the run halts if all attempts exhaust.

  CLI: fix preflight validation blocking unenriched plans (single-file and directory without spec/) from reaching the enrichment step.

- Updated dependencies [[`088dcd8`](https://github.com/iceglober/glrs/commit/088dcd8a2cbf40e2e83271d1f8dc794fceeee2b5)]:
  - @glrs-dev/autopilot@0.4.0
  - @glrs-dev/adapter-claude-code@0.1.9
  - @glrs-dev/adapter-opencode@0.1.9
  - @glrs-dev/harness-plugin-opencode@2.10.12

## 2.10.11

### Patch Changes

- Updated dependencies [[`d1ce47e`](https://github.com/iceglober/glrs/commit/d1ce47e8e1846587dfe0bc7fef2cf5e486464f38)]:
  - @glrs-dev/autopilot@0.3.0
  - @glrs-dev/adapter-claude-code@0.1.8
  - @glrs-dev/adapter-opencode@0.1.8
  - @glrs-dev/harness-plugin-opencode@2.10.11

## 2.10.10

### Patch Changes

- Updated dependencies [[`6eeda55`](https://github.com/iceglober/glrs/commit/6eeda55873110c7732eacb611b43df08c03e6350)]:
  - @glrs-dev/harness-plugin-opencode@2.10.10

## 2.10.9

### Patch Changes

- Updated dependencies [[`d987e11`](https://github.com/iceglober/glrs/commit/d987e1197e8ee62cbd40dad8e9f4f3cfc5944c07)]:
  - @glrs-dev/harness-plugin-opencode@2.10.9
  - @glrs-dev/autopilot@0.2.5
  - @glrs-dev/adapter-claude-code@0.1.7
  - @glrs-dev/adapter-opencode@0.1.7

## 2.10.8

### Patch Changes

- [#111](https://github.com/iceglober/glrs/pull/111) [`d2c6b97`](https://github.com/iceglober/glrs/commit/d2c6b9781e5b77c42a336dad8103b7a059d3e898) Thanks [@iceglober](https://github.com/iceglober)! - Fix autopilot plan picker ignoring `.glrs` directory and add `--target` as alias for `--adapter`.

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.10.8

## 2.10.7

### Patch Changes

- Updated dependencies [[`39a16fb`](https://github.com/iceglober/glrs/commit/39a16fb66ffd817ef82436106d8d6fa1b78bc0e9)]:
  - @glrs-dev/harness-plugin-opencode@2.10.7

## 2.10.6

### Patch Changes

- Updated dependencies [[`bc09feb`](https://github.com/iceglober/glrs/commit/bc09feb97fa1988054400d725c3617267cd4f4a1), [`bc09feb`](https://github.com/iceglober/glrs/commit/bc09feb97fa1988054400d725c3617267cd4f4a1), [`bc09feb`](https://github.com/iceglober/glrs/commit/bc09feb97fa1988054400d725c3617267cd4f4a1)]:
  - @glrs-dev/autopilot@0.2.4
  - @glrs-dev/adapter-claude-code@0.1.6
  - @glrs-dev/adapter-opencode@0.1.6
  - @glrs-dev/harness-plugin-opencode@2.10.6

## 2.10.5

### Patch Changes

- Updated dependencies [[`82b1221`](https://github.com/iceglober/glrs/commit/82b122100ecb67edd01fcc169f43fcaab55f4108), [`82b1221`](https://github.com/iceglober/glrs/commit/82b122100ecb67edd01fcc169f43fcaab55f4108)]:
  - @glrs-dev/autopilot@0.2.3
  - @glrs-dev/adapter-claude-code@0.1.5
  - @glrs-dev/adapter-opencode@0.1.5
  - @glrs-dev/harness-plugin-opencode@2.10.5

## 2.10.4

### Patch Changes

- Updated dependencies [[`05c5fa7`](https://github.com/iceglober/glrs/commit/05c5fa76322634bfa1ec08594d7dff0127404c45)]:
  - @glrs-dev/autopilot@0.2.2
  - @glrs-dev/adapter-claude-code@0.1.4
  - @glrs-dev/adapter-opencode@0.1.4
  - @glrs-dev/harness-plugin-opencode@2.10.4

## 2.10.3

### Patch Changes

- Updated dependencies [[`6d307dc`](https://github.com/iceglober/glrs/commit/6d307dc93011603d1b031ac757ed3d6e94ebffa4)]:
  - @glrs-dev/autopilot@0.2.1
  - @glrs-dev/adapter-claude-code@0.1.3
  - @glrs-dev/adapter-opencode@0.1.3
  - @glrs-dev/harness-plugin-opencode@2.10.3

## 2.10.2

### Patch Changes

- Updated dependencies [[`a230910`](https://github.com/iceglober/glrs/commit/a23091090be18f567a924bdd8ccbaa81f9942e64)]:
  - @glrs-dev/harness-plugin-opencode@2.10.2

## 2.10.1

### Patch Changes

- [#95](https://github.com/iceglober/glrs/pull/95) [`d171c97`](https://github.com/iceglober/glrs/commit/d171c97d6126bd415e994e2cb629ca2735be6d8b) Thanks [@iceglober](https://github.com/iceglober)! - Fix two autopilot bugs that surfaced as "Phase file referenced in spec/main.yaml does not exist": pre-flight validation now auto-recovers from stale `spec/` directories, and orphaned phase references in `main.md` are auto-decomposed before enrichment (with a precise actionable error on decomposition failure).

- Updated dependencies [[`07b0f45`](https://github.com/iceglober/glrs/commit/07b0f4574dfd87209d4375bcf4ec2a97c46c8749)]:
  - @glrs-dev/harness-plugin-opencode@2.10.1

## 2.10.0

### Minor Changes

- [#93](https://github.com/iceglober/glrs/pull/93) [`8213a53`](https://github.com/iceglober/glrs/commit/8213a531bee0a4cd11ce46fe373e5ecdd485bce6) Thanks [@iceglober](https://github.com/iceglober)! - Add live stderr output to `glrs loop` so users get at-least-once-per-minute feedback (iteration progress, tool calls, cost, thinking indicators) instead of silence until the loop exits.

### Patch Changes

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.10.0

## 2.9.2

### Patch Changes

- [#90](https://github.com/iceglober/glrs/pull/90) [`8c5b629`](https://github.com/iceglober/glrs/commit/8c5b629ceb9155421fb2ecb7c25a98b3d503d034) Thanks [@iceglober](https://github.com/iceglober)! - Autopilot now auto-recovers when a prior crashed run left an inconsistent `spec/` directory (stale spec — no more "phase file referenced in spec/main.yaml does not exist" deadlock). When the loop fails, the CLI now prints the actual error Reason and exits with a non-zero exit code so CI and shell scripts can detect failure.

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.9.2

## 2.9.1

### Patch Changes

- [#87](https://github.com/iceglober/glrs/pull/87) [`bf6bfe4`](https://github.com/iceglober/glrs/commit/bf6bfe49b631fa86711d7d6259c6826d574406c4) Thanks [@iceglober](https://github.com/iceglober)! - Fix `glrs autopilot --plan …` failing with `Unknown enrichment strategy "default"` on clean installs. The autopilot package's tsup build now correctly bundles `strategies/default.md` and `prompt-template.md` into `dist/`, so the vendored CLI artifact ships with the runtime markdown assets it needs.

- Updated dependencies []:
  - @glrs-dev/harness-plugin-opencode@2.9.1

## 2.9.0

### Minor Changes

- [#85](https://github.com/iceglober/glrs/pull/85) [`e008596`](https://github.com/iceglober/glrs/commit/e008596aba81fa0942c9299f74c35be922e85a80) Thanks [@iceglober](https://github.com/iceglober)! - Add `glrs upgrade` command (bypasses bun's stale cache). PRIME now dispatches parallel @build subagents for multi-phase plans with disjoint file sets.

### Patch Changes

- Updated dependencies [[`e008596`](https://github.com/iceglober/glrs/commit/e008596aba81fa0942c9299f74c35be922e85a80)]:
  - @glrs-dev/harness-plugin-opencode@2.9.0

## 2.8.0

### Minor Changes

- [#83](https://github.com/iceglober/glrs/pull/83) [`407e0a5`](https://github.com/iceglober/glrs/commit/407e0a5b20c96474c556a88e45ae9e0dcde8cc36) Thanks [@iceglober](https://github.com/iceglober)! - Remove `--fast` flag. Enrichment now runs unconditionally (idempotent skip when specs already enriched). Per-item execution is the sole strategy with 25-iteration budget and 5-min stall timeout.

### Patch Changes

- Updated dependencies [[`407e0a5`](https://github.com/iceglober/glrs/commit/407e0a5b20c96474c556a88e45ae9e0dcde8cc36)]:
  - @glrs-dev/autopilot@0.2.0
  - @glrs-dev/adapter-claude-code@0.1.2
  - @glrs-dev/adapter-opencode@0.1.2
  - @glrs-dev/harness-plugin-opencode@2.8.0

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

### Patch Changes

- Updated dependencies [[`b0d02dc`](https://github.com/iceglober/glrs/commit/b0d02dcb3ab8636445c4d0317ccd61dc9581bdff)]:
  - @glrs-dev/harness-plugin-opencode@2.7.0

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

### Patch Changes

- [#77](https://github.com/iceglober/glrs/pull/77) [`d684392`](https://github.com/iceglober/glrs/commit/d68439287a0a4bd9496011232e3e81d72bbda398) Thanks [@iceglober](https://github.com/iceglober)! - Fix phase cost summaries showing $0.00 by returning cumulativeCostUsd from all runRalphLoop exit paths. Route `glrs autopilot` through cmd-ts so --plan, --fast, and other flags are parsed.

- Updated dependencies [[`d684392`](https://github.com/iceglober/glrs/commit/d68439287a0a4bd9496011232e3e81d72bbda398)]:
  - @glrs-dev/autopilot@0.1.1
  - @glrs-dev/adapter-claude-code@0.1.1
  - @glrs-dev/adapter-opencode@0.1.1

## 2.4.1

### Patch Changes

- [#75](https://github.com/iceglober/glrs/pull/75) [`9532a63`](https://github.com/iceglober/glrs/commit/9532a63157cc0edad7822452e710848052dde9fa) Thanks [@iceglober](https://github.com/iceglober)! - Fix `@glrs-dev/cli@2.4.0` install failure caused by `workspace:*` references to private packages leaking into the published tarball. The cli now vendors `@glrs-dev/autopilot` and `@glrs-dev/adapter-opencode` into its `dist/node_modules/` and strips workspace references from the published `package.json`.

## 2.4.0

## 2.3.0

## 2.2.0

## 2.1.0

### Minor Changes

- [#51](https://github.com/iceglober/glrs/pull/51) [`c3c6be8`](https://github.com/iceglober/glrs/commit/c3c6be8fb21052275f0ff4c60ba1ed3d93d5532f) Thanks [@iceglober](https://github.com/iceglober)! - Add auto-update to the `glrs` CLI. On every invocation (rate-limited to once per hour), checks the npm registry for a newer version. If found, installs it globally via `bun add -g` and re-execs the command so the user always runs the latest version. Disable with `GLRS_AUTO_UPDATE=0`.

## 2.0.1

## 2.0.0

## 1.2.0

## 1.1.0

### Patch Changes

- [#38](https://github.com/iceglober/glrs/pull/38) [`cedbc0a`](https://github.com/iceglober/glrs/commit/cedbc0a6d98fb5b91c78ec6168322593c4c98b20) Thanks [@iceglober](https://github.com/iceglober)! - Fix `glrs wt` subcommand dispatch (was printing help instead of executing) and replace Bun APIs unavailable in released versions with Node.js fs equivalents.

## 1.0.1

### Patch Changes

- [#33](https://github.com/iceglober/glrs/pull/33) [`b3a79cc`](https://github.com/iceglober/glrs/commit/b3a79cc0a9ad2f6247c4d889ee9a08a3cf0f8b41) Thanks [@iceglober](https://github.com/iceglober)! - Rewrite `packages/cli/README.md` as the single source of truth for CLI documentation. Document the bare-`glrs wt` interactive picker behavior (previously undocumented). Content for `glrs.dev/cli/` is now generated from this README via the docs-site custom content loader; there is no longer a separate site overview page to drift from.

## 1.0.0

### Patch Changes

- [#27](https://github.com/iceglober/glrs/pull/27) [`cf74f2d`](https://github.com/iceglober/glrs/commit/cf74f2dca60ee099a92a500d90de1c1886b6aed0) Thanks [@iceglober](https://github.com/iceglober)! - chore(changesets): move @glrs-dev/cli and @glrs-dev/harness-plugin-opencode from `linked` to `fixed`

  The `linked` group synchronizes versions only among packages that are ALREADY being bumped — it does not force a package into a release. A changeset that named only the harness (as most of our changesets do) would ship a new harness on npm without republishing the CLI, even though the CLI vendors the harness `dist/` at build time (`packages/cli/scripts/vendor-harness.ts`). End users running `glrs oc ...` would keep getting the old vendored harness until somebody remembered to write a no-op CLI changeset.

  Moving the pair to `fixed` guarantees any harness publish drags the CLI along at a matching version, so a fresh CLI tarball always re-vendors the latest harness `dist/`. The trade-off — CLI-only changesets now also force a no-op harness republish — is cheap because CLI-only changes are rare in this repo.

## 0.3.1

### Patch Changes

- [#19](https://github.com/iceglober/glrs/pull/19) [`6e942c5`](https://github.com/iceglober/glrs/commit/6e942c5099a535a7d1cda161a1bbc1692f937008) Thanks [@iceglober](https://github.com/iceglober)! - Link `@glrs-dev/cli` and `@glrs-dev/harness-plugin-opencode` versions in Changesets config so they always release together. The CLI vendors the harness plugin's `dist/` at build time (via `packages/cli/scripts/vendor-harness.ts`), so plugin fixes don't reach users running `glrs oc install` until a CLI release is cut. Linking the two ensures every harness-plugin bump produces a matching CLI bump, closing the gap where a plugin fix sat on npm without a CLI tarball that bundled it.

  This bump also forces a CLI republish that vendors `@glrs-dev/harness-plugin-opencode@0.3.0` so users get the recent `glrs oc install` reconfigure fix via `glrs oc install`, not just `glrs-oc install` directly.

## 0.1.1

### Patch Changes

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

## 0.1.0

### Minor Changes

- [`37da38d`](https://github.com/iceglober/glrs/commit/37da38d0c0ffebf6758ef696644be3c79203eb4d) Thanks [@iceglober](https://github.com/iceglober)! - **First release of `@glrs-dev/cli` as the unified entry point for the @glrs-dev ecosystem.**

  ## What's included

  - `glrs oc <args>` — dispatches to a vendored copy of `@glrs-dev/harness-opencode` (the OpenCode agent harness). The harness-opencode bin is bundled inside this tarball at `dist/vendor/harness-opencode/`; no separate install needed.
  - `glrs wt <args>` — worktree management (create, list, switch, delete, cleanup). Stores worktrees under `~/.glorious/worktrees/<repo>/<name>/`.

  ## Install

  ```bash
  npm i -g @glrs-dev/cli
  ```

  Requires Bun >= 1.2.0 on PATH — the CLI and the vendored harness use Bun-native APIs (`bun:sqlite`, `Bun.spawn`).

  ## Migration

  - `@glrs-dev/harness-opencode` on npm is being deprecated. Its final published version (`0.16.2` or later) should be the last. Users should migrate to `glrs oc <args>`.
  - `@glrs-dev/agentic` has been removed from the repo. Its worktree-management commands live natively under `glrs wt`.
  - `@glrs-dev/assume` remains a separate, standalone package — install it independently if you need the SSO credential manager.

- [`b3ff224`](https://github.com/iceglober/glrs/commit/b3ff2249da36abb6669588ddf08d57c2d3b00464) Thanks [@iceglober](https://github.com/iceglober)! - Add `@research` agent and four bundled research skills (`research`, `research-web`, `research-local`, `research-auto`) to the vendored harness-opencode. `@research` is an Opus-class, `mode: all` orchestrator that decomposes research queries into parallel workstreams, dispatches per-workstream sub-agents using one of the four skills (multi-round umbrella, local codebase, web, or autonomous `.lab/` experimentation), reviews findings for gaps, iterates, and synthesizes. The existing `/research` slash command is rewritten as a thin delegator to `@research`; PRIME's subagent-reference recap gains an `@research` entry so its task-tool picker surfaces the agent alongside `@plan`, `@build`, `@code-searcher`, `@qa-reviewer`, etc.

## 0.0.1

### Patch Changes

- Updated dependencies [[`689c103`](https://github.com/iceglober/glrs/commit/689c1034bd2b5f5c54af40b18b3c1d3bb3db4bb4), [`054cf1a`](https://github.com/iceglober/glrs/commit/054cf1ad516c171a93a1383aacd318ca670155fa)]:
  - @glrs-dev/harness-opencode@1.0.0

## 1.0.0

### Major Changes

- Initial release. Unified CLI for the `@glrs-dev` ecosystem.
- Provides a single `glrs` binary with three subcommands:
  - `glrs oc` → `harness-opencode` (OpenCode agent harness)
  - `glrs agentic` → `gs-agentic` / `gsag` (agentic workflows)
  - `glrs assume` → `gs-assume` / `gsa` (SSO credential manager)
- Pure dispatcher — no CLI logic duplication. Each subtool retains its own direct bin for power users.
