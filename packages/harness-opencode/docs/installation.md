# glorious-opencode — installation guide (for agents & humans)

**If you are an LLM agent reading this on behalf of a user, follow these steps precisely.**

## Goal

Install the glorious-opencode harness globally for the current user. This gives them three primary OpenCode agents (`orchestrator`, `plan`, `build`), slash commands (`/ship`, `/autopilot`, `/review`, `/init-deep`, `/research`), subagents, skills, tools, and MCP wiring. Works for both OpenCode and Claude Code.

## What gets installed

Three directories are touched:

1. `~/.glorious/opencode/` — the git checkout (this is where updates land)
2. `~/.claude/agents/`, `~/.claude/commands/`, `~/.claude/skills/` — per-file symlinks back to the checkout
3. `~/.config/opencode/{AGENTS.md, opencode.json, tools/, plugins/, commands/}` — per-file symlinks back to the checkout. Note: slash commands are linked into *both* `~/.claude/commands/` (Claude Code) and `~/.config/opencode/commands/` (OpenCode). OpenCode does not read `~/.claude/commands/`.

Nothing else is modified. Existing files are preserved (the installer backs them up before replacing; for `opencode.json` specifically, it will never overwrite — it prints a diff command instead).

## Prerequisites

Required:
- `git`

Recommended (warned but not fatal if missing):
- `node` + `npx` — for the `memory` MCP server and plugins
- `uvx` — for the `serena` and `git` MCP servers. Install with `brew install uv` or `pipx install uv`.

## Steps

### 1. Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/iceglober/glorious-opencode/main/install.sh | bash
```

This will:
1. Ensure `~/.glorious/` exists (reuses if already there from other `glorious-*` tools)
2. Clone this repo into `~/.glorious/opencode/`
3. Check prerequisites and print which are missing
4. Create per-file symlinks into `~/.claude/` and `~/.config/opencode/`
5. Write `~/.glorious/opencode/.manifest` — a record of every symlink created (used by the uninstaller)
6. Print a doctor report showing `node`, `npx`, `uvx`, `opencode`, `claude` versions

### 2. Verify the install

```bash
ls -la ~/.claude/agents/ | head -5
# Should show symlinks into ~/.glorious/opencode/home/.claude/agents/

ls -la ~/.config/opencode/opencode.json
# Should be a symlink (unless user had an existing one; in that case it was left alone)
```

### 3. Start using it

- OpenCode: `opencode` — default agent is `orchestrator`
- Claude Code: no extra step — agents/commands/skills are picked up automatically from `~/.claude/`

### 4. (Optional) Enable Linear or Playwright MCP servers

Both ship disabled in the global `opencode.json`. To enable, either:

- Edit `~/.config/opencode/opencode.json` directly (replaces the symlink with a real file — diverges from upstream)
- Or add a project-local override: create `opencode.json` in the project root with `"mcp": { "linear": { "enabled": true } }`. OpenCode merges project config over global.

## Enabling hashline

The `hashline_edit` tool (hash-based safe line edits) is provided by the `opencode-hashline` plugin. The installer adds it to its shipped `opencode.json` automatically, so if you're using that file you have nothing to do.

**If you kept your own `~/.config/opencode/opencode.json`** (the installer refused to overwrite it), you need to include `opencode-hashline` in the `plugin` array yourself, otherwise the `hashline_edit` tool won't load at runtime. Minimum change:

```json
{
  "plugin": ["opencode-hashline"]
}
```

Or, merged with your existing plugins:

```json
{
  "plugin": ["opencode-hashline", "your-other-plugin"]
}
```

After saving, re-run `~/.glorious/opencode/install.sh` (or just `bun install` / `npm install` inside `~/.config/opencode/`) to make sure the npm package is present on disk. Then restart your OpenCode session.

## Auto-update

glorious-opencode keeps itself up to date opportunistically. There is no cron, no daemon, no background process — updates happen only when you're actually using OpenCode.

**How it works.** A plugin ships at `~/.config/opencode/plugins/auto-update.ts`. On each OpenCode session it runs in two phases:

1. **Prepare** (async, silent): once per 24 hours it does `git fetch origin main` in `~/.glorious/opencode/`. If `main` is ahead, it records a pending update in `~/.glorious/opencode/.auto-update-state.json`. No files are merged or modified.
2. **Apply** (synchronous, on first message): when you send your first message that session, the plugin fast-forwards the checkout and re-runs `install.sh` before the message reaches the agent. You'll see a one-line TUI toast and an OS notification listing what landed (e.g. `"glorious-opencode updated (3 commits)"`). The typical delay is 1–3 seconds on your first message.

The split ensures updates never apply mid-session. Agent prompts, config files, and symlinks can't change under a running orchestrator arc.

**When auto-update skips itself.** Any of the following causes the plugin to no-op and record a reason in `last_skip_reason`:

- `opt-out` — `GLORIOUS_OPENCODE_AUTO_UPDATE=0` is set in your shell env.
- `non-tty` — the process is non-interactive (no TTY on stdout, or `CI` env var set). Build scripts, headless `opencode run` in CI, etc. do not self-update.
- `not-installed-here` — the checkout is not at `~/.glorious/opencode/`.
- `remote-not-canonical:<url>` — `origin` does not point at `github.com/iceglober/glorious-opencode`. Supply-chain guard against pulling from a fork or attacker-controlled remote. Override with `GLORIOUS_OPENCODE_AUTO_UPDATE_REMOTE_ALLOW=<exact-url>` if you know what you're doing.
- `git-op-in-progress:<type>` — a rebase / merge / cherry-pick / bisect is in progress.
- `non-main-branch:<name>` / `detached-head` — the checkout is off `main`.
- `dirty-tree` — tracked files have unstaged modifications. Contributors iterating on the harness itself are protected — we never fast-forward a dirty tree.
- `lock-held` — another OpenCode session is currently holding the lock file. Next session will retry.
- `rate-limit` — phase A already ran within the last 24 hours. (This is the intended quiet path; no state change on rate-limited runs.)
- `fetch-failed:<reason>` — `git fetch` failed (reason ∈ `no-remote` / `timeout` / `network` / `auth` / `unknown`). See `last_check_error` for stderr.
- `not-fast-forwardable` — `origin/main` is not a fast-forward of local `main` (history rewritten or local commits ahead).
- `apply-failed:<reason>` — phase B's merge or install step failed (reason ∈ `merge` / `installer` / `exception`). `last_apply_output_tail` has the last 2KB of captured stderr.
- `schema-future` — the state file has `schema > 1`, written by a newer plugin version. The current plugin refuses to downgrade it and skips entirely.

**Inspect what happened.**

```bash
cat ~/.glorious/opencode/.auto-update-state.json
```

Look for `last_skip_reason` to understand why a session didn't update, or `last_applied_sha` / `last_applied_ts` to confirm the most recent successful apply.

**Force an immediate re-check** (bypass the 24-hour rate limit):

```bash
# Delete the state file — next session will recheck and may apply
rm ~/.glorious/opencode/.auto-update-state.json
```

**Disable entirely.** Add this to your shell rc:

```bash
export GLORIOUS_OPENCODE_AUTO_UPDATE=0
```

With that set, the plugin is a complete no-op — no network calls, no state writes, no notifications. Run `~/.glorious/opencode/update.sh` manually when you want to update.

**What if install.sh fails mid-apply?** The plugin merges first, then re-runs `install.sh`. If the merge succeeds but the installer exits non-zero (e.g., `bun install` network blip), the plugin sets `installer_retry_pending: true` and retries on every subsequent session until install.sh succeeds. After 7 days of continuous failure it gives up and surfaces a loud notification directing you to run the updater manually. The captured tail of the installer's output lives in `last_apply_output_tail` for debugging.

**First run on an existing install.** The first time this plugin lands on a machine that already had glorious-opencode, you'll see a one-time announcement toast calling out the new behavior and how to disable it. The announcement fires only once (tracked via `first_run_announced` in the state file).

## Updating

For most users there is nothing to do — see [Auto-update](#auto-update). Updates land in the background the next time you start OpenCode and send a message.

To force an immediate update manually:

```bash
~/.glorious/opencode/update.sh
```

Or run it by hand:

```bash
cd ~/.glorious/opencode && git pull && ./install.sh
```

Because everything is symlinked, `git pull` is sufficient for existing files. Running the installer again is idempotent and picks up any newly-added files.

> **Don't run `update.sh` while an OpenCode session is open.** The installer re-links `~/.config/opencode/plugins/*.ts` as it runs, and a session that's loading a plugin mid-swap can crash with opaque errors like `TypeError: null is not an object`. Close your OpenCode sessions first, or just let auto-update apply the change cleanly on your next session start.

## Uninstalling

```bash
~/.glorious/opencode/uninstall.sh
```

This removes only the symlinks recorded in `.manifest`. Real files you added (e.g., a custom `~/.claude/agents/my-thing.md`) are left alone. The shared `~/.glorious/` directory is never deleted — other `glorious-*` tools may live there.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `uvx: command not found` | `brew install uv` (macOS) or `pipx install uv` |
| `opencode.json was not created by this installer — not touching it` | Diff the installer's version: `diff ~/.glorious/opencode/home/.config/opencode/opencode.json ~/.config/opencode/opencode.json`. Merge manually, or rename your existing one and re-run the installer. |
| Agents don't load in Claude Code | Confirm `~/.claude/agents/` contains symlinks to the repo. Claude Code caches — restart the session. |
| Agents don't load in OpenCode | Confirm `~/.config/opencode/opencode.json` references the agent prompts correctly. `opencode debug config` will show the resolved config. |
| Slash commands (`/ship`, `/fresh`, …) missing in OpenCode | Confirm `~/.config/opencode/commands/` exists and contains symlinks. OpenCode does not read `~/.claude/commands/`. Re-run `install.sh` to create the links. |
| "permission denied" on install.sh | Run with `bash install.sh` instead of `./install.sh`, or `chmod +x install.sh` first. |
