---
"@glrs-dev/harness-plugin-opencode": minor
---

The background-jobs sidebar is now part of the harness package itself, as its `./tui` export — no separate package to install or version. The harness is now a dual-target opencode plugin: the server plugin (hooks/tools/agents) and the TUI sidebar.

Because opencode loads server and TUI plugins via separate registries, activate the sidebar once with:

```
opencode plugin @glrs-dev/harness-plugin-opencode
```

The standalone `@glrs-dev/opencode-background-sidebar` package is superseded and will be deprecated on npm.
