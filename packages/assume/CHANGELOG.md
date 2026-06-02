# @glrs-dev/assume

## 0.10.2

### Patch Changes

- [#269](https://github.com/iceglober/glrs/pull/269) [`b5467c0`](https://github.com/iceglober/glrs/commit/b5467c0697a5ef57d283f49c4de9b2dcd767273f) Thanks [@iceglober](https://github.com/iceglober)! - fix(assume): `gsa upgrade` checked the wrong repo and never updated

  `gsa upgrade` still pointed at the pre-rename repo (`iceglober/glorious`, tag
  prefix `assume-v`), which froze at ~0.6.x. It reported that stale release as
  "latest version: 0.6.4" and — since the installed 0.10.x is numerically newer —
  declared "already up to date", so it could never actually upgrade.

  - Point at the current repo and changesets tag format: `iceglober/glrs`,
    `@glrs-dev/assume@<version>`.
  - Select the highest-semver matching release (not the first in list order) in
    both the gh-CLI and REST paths.
  - npm installs now upgrade via `npm i -g @glrs-dev/assume@latest` instead of a
    GitHub binary-swap into node_modules, which would desync the binary from the
    package manifest.

## 0.10.1

### Patch Changes

- [#267](https://github.com/iceglober/glrs/pull/267) [`d7cc1ef`](https://github.com/iceglober/glrs/commit/d7cc1ef9a4b342cbc00cbd3766fa5185381e4996) Thanks [@iceglober](https://github.com/iceglober)! - fix(assume): write the opencode MCP config to the path opencode actually reads

  `gsa init` resolved OpenCode's config via `dirs::config_dir()`, which on macOS is
  `~/Library/Application Support` — so it wrote the gsa MCP entry to
  `~/Library/Application Support/opencode/opencode.json`, a file OpenCode never
  reads. The "OpenCode: gsa MCP configured" message was a false read of that wrong
  path, and the credential MCP never actually loaded.

  OpenCode reads `$XDG_CONFIG_HOME/opencode/opencode.json` (default
  `~/.config/opencode/opencode.json`) on every platform, matching the harness
  installer. `gsa init` now resolves the same path. Other tools (claude-code,
  gemini, cursor) were already correct (home-relative).

## 0.10.0

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

## 0.9.0

### Minor Changes

- [#256](https://github.com/iceglober/glrs/pull/256) [`610eae0`](https://github.com/iceglober/glrs/commit/610eae0e865ce33e1f8c757e35493268df75a899) Thanks [@iceglober](https://github.com/iceglober)! - `gsa init`: prompt to select which agent tools to configure, and fix the MCP writers

  - `gsa init` now shows a multi-select of supported agent tools (OpenCode, Claude Code, Gemini CLI, Cursor) instead of silently auto-detecting one. Installed tools are pre-checked; you choose which to wire the `gsa` MCP server into.
  - Fix OpenCode MCP entry: it now writes the correct `mcp` schema (`{ "type": "local", "command": ["gsa", "agent", "mcp"], "enabled": true }`) instead of the stdio `command`/`args` shape OpenCode ignores.
  - Fix Claude Code target: MCP servers are written to `~/.claude.json` (`mcpServers`), not `~/.claude/settings.json`.
  - Add Gemini CLI (`~/.gemini/settings.json`) and Cursor (`~/.cursor/mcp.json`) support, creating the config file when absent and preserving existing keys.

## 0.8.0

### Minor Changes

- [#230](https://github.com/iceglober/glrs/pull/230) [`129e479`](https://github.com/iceglober/glrs/commit/129e479bf7b8f7381458fbc02125cf52110d1166) Thanks [@iceglober](https://github.com/iceglober)! - feat(assume): rename `gsa profiles` → `gsa contexts`, unify "context" terminology

  Breaking: `gsa profiles` is now `gsa contexts`. `gsa exec -p` is now `gsa exec -c` (`-p` still works as alias).

## 0.7.3

### Patch Changes

- [#227](https://github.com/iceglober/glrs/pull/227) [`67a5627`](https://github.com/iceglober/glrs/commit/67a56276c8ca47a7497672fe7dfd58d78541b01c) Thanks [@iceglober](https://github.com/iceglober)! - fix(assume): suppress migration nag in shell-init wrapper + fix daemon detection on macOS

## 0.7.2

### Patch Changes

- [#225](https://github.com/iceglober/glrs/pull/225) [`f2129eb`](https://github.com/iceglober/glrs/commit/f2129eb779d0a255fe0b2b7488e5c2fbd6bd112d) Thanks [@iceglober](https://github.com/iceglober)! - fix(assume): suppress migration nag in shell-init wrapper + fix daemon detection on macOS

## 0.7.1

### Patch Changes

- [#223](https://github.com/iceglober/glrs/pull/223) [`a6132bd`](https://github.com/iceglober/glrs/commit/a6132bd13a85bad9d8055c979e08c734a0420a5b) Thanks [@iceglober](https://github.com/iceglober)! - fix(assume): publish platform packages with glrs-assume binary (was gs-assume)

## 0.7.0

### Minor Changes

- [#220](https://github.com/iceglober/glrs/pull/220) [`1a68158`](https://github.com/iceglober/glrs/commit/1a681582d60c40c048d166245e75bc5b0497a6db) Thanks [@iceglober](https://github.com/iceglober)! - Reliable auto-refresh and rebrand to glrs-assume

  **Auto-refresh reliability** — SSO sessions now stay alive for the full 7-day refresh window without manual intervention:

  - Inline refresh in every CLI command: when the daemon isn't running and the session is expired but the refresh token is valid, any `gsa` command refreshes inline instead of showing "expired"
  - Credential endpoint retry: when AWS CLI/SDK hits the daemon's HTTP endpoint with an expired session, the endpoint refreshes the token and retries automatically (no more 503s)
  - `status` and `shell-init` now restart the daemon if it's dead (`BackgroundEnsure`), so every new terminal and every status check keeps the daemon alive
  - Auto-install launchd agent on `gsa login` — the daemon survives reboots without requiring `gsa serve --install`
  - SIGTERM handling in the daemon for clean shutdown when launchd stops the service
  - launchd plist improvements: `KeepAlive.SuccessfulExit=false` (eliminates 10s respawn polling loop), `ProcessType=Background` (prevents App Nap from suspending the refresh loop), `AbandonProcessGroup` (clean shutdown)

  **Rebrand** — `gs-assume` renamed to `glrs-assume` across binary names, config paths (`~/.config/glrs-assume`), env vars (`GLRS_ASSUME_*`), launchd label, shell functions, and all user-facing output. The `gsa` short alias is unchanged.

## 0.6.6

### Patch Changes

- [#54](https://github.com/iceglober/glrs/pull/54) [`54cf566`](https://github.com/iceglober/glrs/commit/54cf5667b65d9701f9fccff283d5f0d0b0a03346) Thanks [@iceglober](https://github.com/iceglober)! - Add daemon auto-restart for exec/credential_process commands. When the daemon dies (e.g., macOS kills it during sleep), the next credential request now silently restarts it without blocking (~1ms overhead). Also adds a containerized test harness with 13 deterministic tests covering the full daemon refresh lifecycle.

## 0.6.5

### Patch Changes

- [#35](https://github.com/iceglober/glrs/pull/35) [`1bcd92c`](https://github.com/iceglober/glrs/commit/1bcd92c55c15b5c5947f445ec75e8afb12b4cd1f) Thanks [@iceglober](https://github.com/iceglober)! - Remove standalone invocation guard that blocked direct gsa/gs-assume usage with exit(1). Replace with a non-blocking nudge toward npm install. Fix release workflow to upload platform binaries with correct filenames.

## 0.6.4

### Patch Changes

- [#21](https://github.com/iceglober/glrs/pull/21) [`4db487c`](https://github.com/iceglober/glrs/commit/4db487ce0b6e13cbee62c2f6a88be5574649b4b2) Thanks [@iceglober](https://github.com/iceglober)! - Fix gs-assume daemon auto-refresh — stop launchd respawn loop, verify PID ownership, enable default tracing, truncate oversized log.

  - `gs-assume serve --foreground` now exits 0 (not error) when a healthy daemon is already running, breaking the launchd KeepAlive tight-respawn loop
  - `is_daemon_running()` now verifies process identity via `ps -p <pid> -o comm=` to detect recycled PIDs
  - Added `RUST_LOG=info,hyper=warn` to launchd plist EnvironmentVariables and as default tracing filter
  - Added `ThrottleInterval=10` to launchd plist as defense-in-depth
  - Added log truncation on startup if `daemon.stderr.log` exceeds 10 MB
  - After successful session refresh, credentials are now re-fetched in the same tick (eliminating the 60s dead window)

## 0.6.3

### Major Changes

- First release under the `@glrs-dev` npm scope. Rust crate renamed from `assume` to `glrs-assume` for crates.io publishing; npm package name is `@glrs-dev/assume`.
- Bins `gs-assume` and `gsa` are preserved — existing shell aliases and muscle memory keep working.
- Source moved from [`iceglober/glorious`](https://github.com/iceglober/glorious) (now archived) to [`iceglober/glrs/packages/assume/`](https://github.com/iceglober/glrs/tree/main/packages/assume). Full git history preserved via `git-filter-repo`.

### Packaging

- npm package ships via the prebuilt-binary `optionalDependencies` pattern: five platform packages (`@glrs-dev/assume-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,win32-x64}`) each carry the prebuilt binary; the main `@glrs-dev/assume` package selects the right one at runtime via its TypeScript shim. No postinstall scripts.
- Rust crate also publishes to crates.io as `glrs-assume` — `cargo install glrs-assume` still works.

### Install

```bash
# Prebuilt binary via npm (recommended for most users)
npm i -g @glrs-dev/assume

# Build from source via cargo
cargo install glrs-assume
```

---

_For version history before the monorepo consolidation, see [`iceglober/glorious/releases`](https://github.com/iceglober/glorious/releases) (filter: `assume-*`)._
