# @glrs-dev/assume

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
