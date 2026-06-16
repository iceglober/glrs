---
"@glrs-dev/assume": patch
---

fix(assume): make the daemon a singleton so it can't pile up orphan processes

The daemon wrote its PID file *before* binding the credential port, and a bind failure was only logged, not fatal. When two daemons raced (e.g. a bun-global and an nvm install each firing `ensure_daemon_running`), the loser overwrote the PID file and then kept running headless instead of exiting — leaving the real port-owner unkillable via the PID file, so every subsequent restart spawned another doomed daemon that lingered. Result: a slowly growing pile of orphaned `serve --foreground` processes.

Now the credential port is the singleton gate: the daemon binds it **before** claiming the PID file, exits cleanly (status 0) if another daemon already owns the port, and only the true port-owner writes the PID file. `spawn_daemon_if_dead` also treats a healthy port as "already served" so it won't spawn duplicates. Any existing orphans can be swept once with `pkill -f "glrs-assume serve"` followed by any `gsa` command.
