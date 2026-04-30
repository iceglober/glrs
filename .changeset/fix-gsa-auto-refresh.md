---
"@glrs-dev/assume": patch
"@glrs-dev/assume-darwin-arm64": patch
"@glrs-dev/assume-darwin-x64": patch
"@glrs-dev/assume-linux-x64": patch
"@glrs-dev/assume-linux-arm64": patch
---

Fix gs-assume daemon auto-refresh — stop launchd respawn loop, verify PID ownership, enable default tracing, truncate oversized log.

- `gs-assume serve --foreground` now exits 0 (not error) when a healthy daemon is already running, breaking the launchd KeepAlive tight-respawn loop
- `is_daemon_running()` now verifies process identity via `ps -p <pid> -o comm=` to detect recycled PIDs
- Added `RUST_LOG=info,hyper=warn` to launchd plist EnvironmentVariables and as default tracing filter
- Added `ThrottleInterval=10` to launchd plist as defense-in-depth
- Added log truncation on startup if `daemon.stderr.log` exceeds 10 MB
- After successful session refresh, credentials are now re-fetched in the same tick (eliminating the 60s dead window)
