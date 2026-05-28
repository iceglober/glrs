---
title: '@glrs-dev/harness-plugin-opencode'
description: >-
  Opinionated agent harness for OpenCode. Agents, tools, slash commands, and an
  unattended autopilot loop — one package.
---
Opinionated agent harness for [OpenCode](https://opencode.ai). Agents, tools, slash commands, and an unattended autopilot loop — one package.

## Quick start

### CLI (recommended)

```bash
bun add -g @glrs-dev/harness-plugin-opencode
glrs-oc install-plugin
opencode
```

Gives you the full CLI (`glrs-oc`) plus all [plugin features](#what-the-plugin-provides) inside OpenCode.

### Plugin only

```bash
bunx @glrs-dev/harness-plugin-opencode install
opencode
```

No global install. All [plugin features](#what-the-plugin-provides) load automatically. You won't have the `glrs-oc` CLI, but you can add it later.

### Verifying the published tarball

This package publishes with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) via GitHub Actions OIDC. After installing, verify the provenance chain:

```bash
npm audit signatures
```

This confirms the tarball on npm was built from this repo's `release.yml` workflow on the canonical main branch — a malicious publish with a stolen npm token would fail this check.

## The Glorious workflow

### Interactive (plugin)

Open OpenCode in any repo. The `prime` agent handles everything end-to-end.

**Start a task from a ticket:**
```
/fresh ENG-1234
```
Wipes the worktree, creates a branch from the ticket ref, and begins the SPEAR workflow: scope → plan → execute → assess → resolve.

**Start a task from a description:**
```
/fresh add rate limiting to the upload endpoint
```

**Go hands-off with the Ralph loop (CLI, lights-out):**
```
glrs oc loop "ship ENG-1234"
```

Runs PRIME in a loop: sends your prompt each iteration, watches for `<autopilot-done>` in the response, exits when the sentinel appears or a budget is hit (50 iterations / 4h / 3 zero-progress iterations / kill-switch at `.agent/autopilot-disable`). Works with multi-issue prompts too: `glrs oc loop "ship every open issue in Linear project ENG-ROADMAP until the project is done"`. There is no TUI slash command — if you're in the TUI and don't want the loop, just type the task normally.

`glrs oc autopilot` is an alias for `glrs oc loop` during the current release cycle. A future release will make `autopilot` an interactive scoping walkthrough that produces a structured plan and then invokes `loop` against it; `loop` will stay as the raw-prompt runner.

**Ship when done:**
```
/ship ~/.glorious/opencode/repo/plans/feat-rate-limit.md
```
Squashes commits, pushes, opens a PR with the plan as the body.

**Review a PR:**
```
/review 87
```
Read-only adversarial review. Fetches the diff, runs typecheck/lint, delegates to `@assessor`, outputs a structured verdict.

**Deep codebase research:**
```
/research how does authentication work in this codebase?
```
Spawns parallel subagents, synthesizes findings with exact file:line references.

---

## What the plugin provides

16 agents, 7 slash commands, 5 tools, 5 MCPs, 11 skill bundles, 3 sub-plugins. Details below.

### Agents

| Agent | Tier | Role |
|-------|------|------|
| `prime` | deep | SPEAR end-to-end workflow (default agent) |
| `plan` | deep | Interactive planner with gap analysis and adversarial review |
| `build` | mid | Plan executor |
| `assessor` | mid | Fast adversarial code review |
| `assessor-thorough` | deep | Full-suite adversarial review |
| `plan-reviewer` | deep | Adversarial plan review |
| `gap-analyzer` | deep | Identifies gaps in plans |
| `architecture-advisor` | deep | Architecture guidance |
| `code-searcher` | fast | Codebase search specialist |
| `docs-maintainer` | mid | Documentation updates |
| `lib-reader` | mid | Library/dependency reader |
| `agents-md-writer` | mid | AGENTS.md generation |
| `research` | deep | Multi-workstream research orchestrator |
| `research-web` / `research-local` / `research-auto` | deep | Research subagents (dispatched by `@research`) |

Tiers: **deep** = opus-class, **mid** = sonnet-class, **fast** = haiku-class. Override with [`harness.models`](#model-overrides).

### Slash commands

| Command | What it does |
|---------|-------------|
| `/fresh <ref>` | Wipe worktree, branch from ticket or description, start PRIME |
| `/ship <plan>` | Squash, push, open PR |
| `/review <target>` | Read-only adversarial review (PR#, SHA, branch, or file) |
| `/research <topic>` | Parallel codebase exploration with file:line citations |
| `/init-deep` | Generate hierarchical AGENTS.md files |
| `/costs` | Show running LLM spend totals |

Autopilot is CLI-only: `glrs oc loop "<prompt>"` (or the `glrs oc autopilot` alias during the current release cycle — see above).

### Tools

`ast_grep` · `tsc_check` · `eslint_check` · `todo_scan` · `comment_check`

### MCP servers

| Server | Status | Backend |
|--------|--------|---------|
| `serena` | enabled | AST code intelligence via `uvx` |
| `memory` | enabled | Per-repo JSON memory |
| `git` | enabled | Structured blame/log via `uvx` |
| `playwright` | disabled | Browser automation — enable in opencode.json |
| `linear` | disabled | Linear issue tracker — enable in opencode.json |

### Sub-plugins

- **notify** — OS notifications when the agent asks a question
- **cost-tracker** — LLM spend by provider/model at `~/.glorious/opencode/costs.json`
- **tool-hooks** — post-edit verification loop (tsc, eslint) + output backpressure

### Skills

`adr` · `agent-estimation` · `code-quality` · `research` · `research-auto` · `research-local` · `research-web` · `review-plan` · `vercel-composition-patterns` · `vercel-react-best-practices` · `web-design-guidelines`

---

## Enabling visual UI capabilities

The `@plan`, `@research`, `@gap-analyzer`, `@prime`, `@build`, `@assessor`, `@assessor-thorough`, and `@plan-reviewer` agents can verify web UIs, rendered output, and visual components when Playwright is available.

### Enable Playwright MCP

During `glrs-oc install-plugin`, select **Playwright — browser automation + visual UI verification (requires Chromium)** in the MCP toggle list. Or enable it manually in `opencode.json`:

```json
{
  "mcp": {
    "playwright": { "enabled": true }
  }
}
```

Then install Chromium:

```bash
npx playwright install chromium
```

### Graceful degradation

Agents automatically fall back when Playwright is unavailable:

1. **Tier A (Playwright)** — navigate, screenshot, evaluate DOM. Best signal.
2. **Tier B (curl)** — parse returned HTML for structure and reachability.
3. **Tier C (webfetch)** — built-in tool for public URLs.
4. **Tier D (source inspection)** — read component files and reason about rendering. Agent flags "visual verification skipped" in its final message.

No configuration required — agents detect capability absence from MCP errors and fall through automatically.

---

## Configuration

### Model overrides

Override all agents in a tier, or target specific agents, via `harness.models` in `opencode.json`:

```json
{
  "harness": {
    "models": {
      "deep": ["bedrock/claude-opus-4"],
      "mid": ["bedrock/claude-sonnet-4"],
      "fast": ["bedrock/claude-haiku-4"],
      "prime": ["my-custom-model"]
    }
  }
}
```

**Precedence:** per-agent `harness.models.X` > tier `harness.models.deep` > plugin default. Direct `agent.<name>.model` in opencode.json wins over all.

### Agent/command/MCP overrides

Your opencode.json values win. Example:

```json
{
  "agent": {
    "prime": { "model": "anthropic/claude-sonnet-4-6" }
  }
}
```

### Enabling optional MCPs

```json
{
  "mcp": {
    "playwright": { "enabled": true },
    "linear": { "enabled": true }
  }
}
```

---

## CLI reference

| Command | Description |
|---------|-------------|
| `glrs-oc install-plugin [--pin] [--dry-run]` | Register plugin in opencode.json |
| `glrs-oc uninstall [--dry-run]` | Remove plugin from opencode.json |
| `glrs-oc doctor` | Check installation health |
| `glrs-oc loop "<prompt>"` | Run PRIME in a Ralph loop (lights-out). `autopilot` is an alias during the current release cycle. |

`install` is an alias for `install-plugin`.

---

## Maintenance

**Update:**
```bash
bun update -g @glrs-dev/harness-plugin-opencode
```

**Pin version:** `glrs-oc install-plugin --pin`

**Rollback:** `npm deprecate @glrs-dev/harness-plugin-opencode@<broken> "<reason>"` — then ship a patch.

**Uninstall:**
```bash
glrs-oc uninstall                           # remove from opencode.json
bun remove -g @glrs-dev/harness-plugin-opencode    # remove CLI
```

## Prerequisites

- [OpenCode](https://opencode.ai)
- `bun`
- `uvx` for serena + git MCPs (`brew install uv`)
- `node`/`npx` for memory MCP
- `git` for version control operations

## Security & threat boundaries

Report vulnerabilities privately per [`SECURITY.md`](./SECURITY.md) — do NOT open a public issue. Expected response: acknowledge within 72h, fix-or-disclose decision within 30 days.

### What this plugin can do on your machine

This is a plugin with broad local-machine access. Install it deliberately:

- **Reads and writes files** under your home directory (`~/.config/opencode/opencode.json`, `~/.cache/harness-opencode/*`, `~/.config/harness-opencode/install-id`, `~/.glorious/opencode/<repo>/*`).
- **Runs local subprocesses** during normal operation: `git`, `gh`, `npm`/`bun`, `ast-grep`, `tsc`, `opencode`, and project-specific verify commands.
- **Makes outbound HTTPS calls** (all opt-out-able):
  - `registry.npmjs.org` — daily version check. Opt out: `HARNESS_OPENCODE_UPDATE_CHECK=0`.
  - `catwalk.charm.land` — model catalog during interactive install only. Response is schema-validated before it reaches your `opencode.json`.
  - `us.i.posthog.com` — anonymous telemetry. Opt out: `HARNESS_OPENCODE_TELEMETRY=0`, `DO_NOT_TRACK=1`, or `CI=true`.
- **Configures MCP servers** in your OpenCode config that, on first use, download third-party code via `uvx` (Serena, `mcp-server-git`) or `npx` (`@playwright/mcp`, `@modelcontextprotocol/server-memory`). These MCPs run in their own subprocesses. Review them before enabling ones that ship disabled by default (`playwright`, `linear`).

### What is NOT a sandbox

The agent-bash **deny-list** in `src/agents/index.ts` (`rm -rf /*`, `chmod *`, `sudo *`, force-push variants, etc.) is a safety rail for common mistakes, not a sandbox. An agent can still:

- Read any file the user can read (including `~/.ssh/id_*`, `~/.aws/credentials`, etc.).
- Pipe arbitrary code to a shell (e.g., `curl <url> | sh`).
- Modify shell startup files (`.zshrc`, `.bashrc`) or your PATH.
- Run `npx <malicious-package>` and similar network-fetched executables.

If a prompt (your own, or an injected one from a web page, issue comment, or MCP response) tells the agent to do something malicious, the deny-list will not block many of the paths. Treat the agent like a junior dev with unrestricted shell access — be careful what you paste into the prompt, and do not run this plugin on machines with credentials you cannot afford to rotate.

A future release may sandbox the bash surface (filesystem allow-list, egress filter). Until then, the boundary is documented, not enforced.

### What this plugin does NOT do

- It does NOT ship any postinstall scripts. `bun add @glrs-dev/harness-plugin-opencode` mutates only `node_modules/`. All filesystem changes to your config happen in the explicit `glrs-oc install` / `bunx @glrs-dev/harness-plugin-opencode install` step.
- It does NOT write to `~/.config/opencode/agents/`, `~/.config/opencode/commands/`, `~/.config/opencode/skills/`, or `~/.config/opencode/tools/`. Agents, commands, and skills live in `node_modules` (read-only by design). The only config write is `~/.config/opencode/opencode.json` during `install`.
- It does NOT exfiltrate code, prompts, file paths, error messages, usernames, project names, or git remotes via telemetry. See the allow-list in `src/telemetry.ts`.

## Privacy & Telemetry

**Update check.** Daily version check against `registry.npmjs.org`. Opt out: `HARNESS_OPENCODE_UPDATE_CHECK=0`.

**Catwalk model catalog.** During interactive `install` only, fetches the provider list from `catwalk.charm.land/v2/providers`. The response is schema-validated (see `src/cli/catwalk.ts`) before any value reaches your `opencode.json`. If validation fails, the installer falls back to built-in presets.

**Telemetry.** `@glrs-dev/harness-plugin-opencode` collects anonymous usage data via [PostHog](https://posthog.com) to help improve reliability. The data is opt-out, contains no personal information, and has no stable user identifier.

**What gets sent:** package version, OS, Node version, which tools were invoked (hashline, serena, memory, custom tools), tool durations, file extensions of edited files (e.g. `.ts`), edit success/failure outcomes, and hashline mismatch rates.

**What never gets sent:** file paths, file contents, code, prompts, model outputs, error messages, project names, git remotes, usernames, or anything that could identify a user or codebase.

To disable, set any of these in your shell:

```bash
export HARNESS_OPENCODE_TELEMETRY=0
export DO_NOT_TRACK=1                   # standard cross-tool opt-out
```

Telemetry is also automatically disabled when `CI=true`.

## Migrating from clone+symlink install

See [docs/migration-from-clone-install.md](docs/migration-from-clone-install.md).

## Contributing

Read [`AGENTS.md`](./AGENTS.md) and [`CONTRIBUTING.md`](./CONTRIBUTING.md). All user-visible PRs need a changeset (`bunx changeset`).

## License

MIT
