# TUI background-jobs sidebar — SPIKE

A minimal opencode **TUI plugin** that adds a "background jobs" section to the
sidebar, listing the harness's background jobs (`background_run`) with live
status, refreshed every 2s.

**This is a spike**, not a shipped feature. Its purpose is to confirm opencode's
sidebar slot API works on your build before any real investment.

## Status / caveats (read first)

- **Unverified by the author.** It was written against the typed
  `@opencode-ai/plugin/tui` API and the reference plugin
  [streetturtle/opencode-better-sidebar](https://github.com/streetturtle/opencode-better-sidebar),
  but could not be run here (no TUI in the build environment). **You verify it.**
- The `tui` / `slots.register` surface is **typed but not part of opencode's
  stable plugin contract** — it can change between opencode versions.
- It reads job state straight from disk
  (`$XDG_STATE_HOME/harness-opencode/background-jobs/`), the same dir
  `background_run` writes — no coupling to the harness server plugin.

## How it works

Registers a `sidebar_content` slot (`api.slots.register({ order, slots })`) whose
Solid component reads the job dirs, derives status (running / exit code /
stopped) from each job's `meta.json` + `exit_code` file, and renders `<box>` /
`<text>` rows. A `setInterval` drives the 2s refresh; `onCleanup` clears it.

## Try it

opencode loads TUI plugins from a package that exposes a `./tui` export. Two paths:

1. **Local, by path** — add this directory to your `opencode.json` `plugin` array
   (a file/dir path is accepted for local plugins), then restart the TUI:
   ```jsonc
   { "plugin": ["./examples/tui-background-sidebar"] }
   ```
2. **Installed** — publish/pack it and `opencode plugin --global <spec>`, or use
   the TUI installer (`ctrl+p` → Install Plugin).

If opencode rejects the raw `.tsx`, it likely needs the same JSX build step the
reference plugin uses (build `tui.tsx` → `dist/tui.tsx` and point `exports["./tui"]`
at the built file). The reference repo's build script is the template.

## What to look for

- A **"background jobs"** heading in the sidebar.
- Start a job (`background_run`) and watch a `running …` row appear, then flip to
  `exit 0` (green) / `exit N` (red) when it finishes; `(none)` when there are no jobs.

If that renders, the slot API is viable and the full widget is worth building
(grouping, click-to-check, stop button, per-session filtering via `props.session_id`).

## Easiest path: `try-local.sh`

```bash
bash examples/tui-background-sidebar/try-local.sh
```

One isolated command: installs the spike's deps, seeds 3 demo jobs (running /
exit 0 / exit 2) into a temp `XDG_STATE_HOME`, launches opencode in a throwaway
project whose `opencode.json` loads only this plugin, and cleans up on quit. Your
real `~/.config/opencode` (auth, models, your other plugins) is left intact;
nothing persists.

## Troubleshooting

- **No "background jobs" section appears** → the plugin didn't load. Most likely:
  - opencode doesn't resolve a local **directory** path in `plugin`. Try an
    absolute path to the dir; if that fails, `opencode plugin add "$PWD/examples/tui-background-sidebar"`.
  - It needs the JSX **built** like the reference plugin (build `tui.tsx` →
    `dist/tui.tsx`, point `exports["./tui"]` at the built file).
- **It loads but errors** → capture what opencode prints (a load/transpile error
  naming `@opentui/solid`, JSX, or `slots`) and share it — that tells us whether
  the slot signature or JSX runtime differs on your opencode build.
- **Section shows but empty** → the seeded jobs are under the temp
  `XDG_STATE_HOME` the script sets; confirm opencode inherited that env.
