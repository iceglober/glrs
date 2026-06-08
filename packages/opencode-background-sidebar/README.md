# @glrs-dev/opencode-background-sidebar

An opencode **TUI sidebar plugin** that adds a **"background jobs"** section to
the sidebar, listing **this session's** harness background jobs
(`background_run`) with live status, refreshed every 2s.

- 🟦 `running` · 🟩 `exit 0` · 🟥 `exit N` / `stopped`
- Shows each job's `title` (falls back to its command).
- **Per-session** — only jobs launched in the current session (session-less
  jobs are shown as global).

## Install

```bash
opencode plugin @glrs-dev/opencode-background-sidebar          # this project
opencode plugin @glrs-dev/opencode-background-sidebar --global # everywhere
```

`opencode plugin` detects the `./tui` export, installs it into `.opencode/tui.json`,
and packages it (opencode transpiles the Solid `.tsx` and provides the runtime —
no build step on your side). Open a session and the section appears in the sidebar.

Pairs with the harness background tools (`@glrs-dev/harness-plugin-opencode` ≥ 3.11):
`background_run` / `background_check` / `background_list` / `background_stop`.

## How it works

Registers a `sidebar_content` slot (`api.slots.register({ order, slots })`) whose
Solid component reads job state straight from disk
(`$XDG_STATE_HOME/harness-opencode/background-jobs/`, the same dir `background_run`
writes — no coupling to the harness server plugin), filters by the slot's
`session_id`, derives status from each job's `meta.json` + `exit_code`, and
renders `<box>` / `<text>` rows. A `setInterval` drives the 2s refresh;
`onCleanup` clears it.

Note: the `tui` / `slots.register` surface is typed (`@opencode-ai/plugin/tui`)
but not part of opencode's stable plugin contract — it may change between
opencode versions.

## Local development

To try changes before publishing, install from the source directory and run in
an isolated sandbox (seeds demo jobs, doesn't touch your real config):

```bash
bash packages/opencode-background-sidebar/try-local.sh
```

That runs `opencode plugin <this dir>` (local scope → `.opencode/tui.json`) with
a temp `XDG_STATE_HOME`, seeds running/exited/failed demo jobs, launches
opencode, and cleans up on quit.

## Troubleshooting

- **No "background jobs" section** → confirm it installed (`◇ Detected tui target`
  during `opencode plugin …`) and that you're inside a session (the slot only
  renders in session view).
- **Section shows but empty** → no jobs for this session yet; start one with
  `background_run`, or (demo) check `XDG_STATE_HOME` is inherited.
