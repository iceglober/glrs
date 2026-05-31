# @glrs-dev/harness-plugin-opencode

Opinionated agent harness for [OpenCode](https://opencode.ai). Agents, tools, slash commands, and an unattended autopilot loop — one package.

## Quick start

### Via the unified CLI (recommended)

```bash
npm i -g @glrs-dev/cli
glrs harness install
opencode
```

Gives you the full CLI (`glrs`) plus all [plugin features](#what-the-plugin-provides) inside OpenCode.

### Plugin only

```bash
bunx @glrs-dev/harness-plugin-opencode install
opencode
```

No global install. All [plugin features](#what-the-plugin-provides) load automatically. You won't have the `glrs` CLI, but you can add it later.

### Verifying the published tarball

This package publishes with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) via GitHub Actions OIDC. After installing, verify the provenance chain:

```bash
npm audit signatures
```

## The Glorious workflow

### Interactive (plugin)

Open OpenCode in any repo. The `prime` agent handles everything end-to-end.

**Start a task from a ticket:**
```
/fresh ENG-1234
```
Creates a branch from the ticket ref and begins the SPEAR workflow: scope → plan → execute → assess → resolve.

**Start a task from a description:**
```
/fresh add rate limiting to the upload endpoint
```

**Go hands-off with the Ralph loop (CLI, lights-out):**
```
glrs loop "ship ENG-1234"
```

Runs PRIME in a loop: sends your prompt each iteration, watches for `<autopilot-done>` in the response, exits when the sentinel appears or a budget is hit (50 iterations / 4h / 3 zero-progress iterations / kill-switch at `.agent/autopilot-disable`).

**Ship when done:**
```
/ship
```
Squashes commits, pushes, opens a PR.

**Review a PR:**
```
/review 87
```
Read-only adversarial review. Fetches the diff, runs typecheck/lint, delegates to `@code-reviewer`, outputs a structured verdict.

**Deep codebase research:**
```
/research how does authentication work in this codebase?
```
Spawns parallel subagents, synthesizes findings with exact file:line references.

---

## What the plugin provides

### Agents

User-selectable agents (available via Tab in OpenCode):

| Agent | Tier | Role |
|-------|------|------|
| `prime` | deep | SPEAR end-to-end workflow with wave-based DAG execution (default agent) |
| `prime-ultra` | mid | Cost-optimized PRIME variant for fast execution |
| `plan` | deep | Interactive planner with gap analysis and adversarial review |
| `build` | mid | Plan executor |
| `scoper` | deep | Codebase scoping and context gathering |
| `designer` | mid | UI/UX design agent |
| `research` | deep | Multi-workstream research orchestrator |

Subagents (dispatched automatically by user-selectable agents):

| Agent | Tier | Role |
|-------|------|------|
| `code-reviewer` | mid | Fast adversarial code review |
| `code-reviewer-thorough` | deep | Full-suite adversarial review |
| `spec-reviewer` | mid | Spec and requirements review |
| `plan-reviewer` | mid | Adversarial plan review |
| `plan-ultra` | deep | DAG planner for wave-based dispatch |
| `gap-analyzer` | mid | Identifies gaps in plans |
| `architecture-advisor` | deep | Architecture guidance |
| `code-searcher` | fast | Codebase search specialist |
| `docs-maintainer` | mid | Documentation updates |
| `lib-reader` | mid | Library/dependency reader |
| `agents-md-writer` | mid | AGENTS.md generation |
| `debriefer` | mid | Post-run summary agent |
| `research-web` / `research-local` / `research-auto` | deep | Research subagents (dispatched by `@research`) |

Autopilot-only agents (used by the Ralph loop):

| Agent | Tier | Role |
|-------|------|------|
| `autopilot-prime` | deep | PRIME without the question tool (no user to answer) |
| `autopilot-fast` | mid | Fast executor for `--fast` autopilot sessions |

Legacy agents: `prime-legacy`, `plan-legacy` — previous-generation prompts, available as fallbacks.

Cost-optimized variants: `build-cheap`, `build-deep`, `plan-ultra-cheap`, `plan-legacy-cheap` — used for automatic cost cascading.

Tiers: **deep** = opus-class, **mid** = sonnet-class, **fast** = haiku-class. Override with [`harness.models`](#model-overrides).

### Slash commands

| Command | What it does |
|---------|-------------|
| `/fresh <ref>` | Branch from ticket or description, start PRIME |
| `/ship` | Squash, push, open PR |
| `/review <target>` | Read-only adversarial review (PR#, SHA, branch, or file) |
| `/research <topic>` | Parallel codebase exploration with file:line citations |
| `/init-deep` | Generate hierarchical AGENTS.md files |
| `/costs` | Show running LLM spend totals |
| `/dispatches` | Show subagent dispatch history |

Autopilot is CLI-only: `glrs loop "<prompt>"`.

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

- **cost-tracker** — LLM spend by provider/model
- **dispatch-tracker** — subagent dispatch logging
- **dotenv** — `.env` file loading
- **notify** — OS notifications when the agent asks a question
- **parallel-dispatch** — subagent batching optimization
- **stall-detector** — watchdog that nudges stalled agents
- **tool-hooks** — post-edit verification loop (tsc, eslint) + output backpressure

### Skills

`adr` · `adversarial-review-rubric` · `agent-estimation` · `code-quality` · `design-for-ai` · `research` · `research-auto` · `research-local` · `research-web` · `researcher` · `review-plan` · `root-cause-diagnosis` · `spear-protocol` · `ux-for-ai` · `vercel-composition-patterns` · `vercel-react-best-practices` · `web-design-guidelines`

---

## Enabling visual UI capabilities

The `@plan`, `@research`, `@gap-analyzer`, `@prime`, `@build`, `@code-reviewer`, `@code-reviewer-thorough`, and `@plan-reviewer` agents can verify web UIs when Playwright is available.

### Enable Playwright MCP

During install, select **Playwright** in the MCP toggle list. Or enable it manually in `opencode.json`:

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

1. **Tier A (Playwright)** — navigate, screenshot, evaluate DOM.
2. **Tier B (curl)** — parse returned HTML for structure and reachability.
3. **Tier C (webfetch)** — built-in tool for public URLs.
4. **Tier D (source inspection)** — read component files and reason about rendering.

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
| `glrs harness install [--pin] [--dry-run]` | Register plugin in opencode.json |
| `glrs harness uninstall [--dry-run]` | Remove plugin from opencode.json |
| `glrs harness doctor` | Check installation health |
| `glrs harness configure` | Interactive harness configuration |
| `glrs loop "<prompt>"` | Run PRIME in a Ralph loop (lights-out) |
| `glrs autopilot --plan <path>` | Scope → plan → execute orchestrator |
| `glrs dashboard` | Live TUI for all running autopilot sessions |

---

## Maintenance

**Update:**
```bash
npm update -g @glrs-dev/cli
```

**Pin version:** `glrs harness install --pin`

**Rollback:** `npm deprecate @glrs-dev/harness-plugin-opencode@<broken> "<reason>"` — then ship a patch.

**Uninstall:**
```bash
glrs harness uninstall          # remove from opencode.json
npm rm -g @glrs-dev/cli    # remove CLI
```

## Prerequisites

- [OpenCode](https://opencode.ai)
- [Bun](https://bun.sh) ≥ 1.2.0
- `uvx` for serena + git MCPs (`brew install uv`)
- `node`/`npx` for memory MCP
- `git` for version control operations

## Security & threat boundaries

Report vulnerabilities privately per [`SECURITY.md`](./SECURITY.md) — do NOT open a public issue. Expected response: acknowledge within 72h, fix-or-disclose decision within 30 days.

### What this plugin can do on your machine

This is a plugin with broad local-machine access. Install it deliberately:

- **Reads and writes files** under your home directory (`~/.config/opencode/opencode.json`, `~/.cache/harness-opencode/*`, `~/.config/harness-opencode/install-id`).
- **Runs local subprocesses** during normal operation: `git`, `gh`, `npm`/`bun`, `ast-grep`, `tsc`, `opencode`, and project-specific verify commands.
- **Makes outbound HTTPS calls** (all opt-out-able):
  - `registry.npmjs.org` — daily version check. Opt out: `HARNESS_OPENCODE_UPDATE_CHECK=0`.
  - `catwalk.charm.land` — model catalog during interactive install only. Response is schema-validated before it reaches your `opencode.json`.
- **Configures MCP servers** in your OpenCode config that, on first use, download third-party code via `uvx` (Serena, `mcp-server-git`) or `npx` (`@playwright/mcp`, `@modelcontextprotocol/server-memory`). These MCPs run in their own subprocesses. Review them before enabling ones that ship disabled by default (`playwright`, `linear`).

### What is NOT a sandbox

The agent-bash **deny-list** in `src/agents/index.ts` (`rm -rf /*`, `chmod *`, `sudo *`, force-push variants, etc.) is a safety rail for common mistakes, not a sandbox. An agent can still:

- Read any file the user can read (including `~/.ssh/id_*`, `~/.aws/credentials`, etc.).
- Pipe arbitrary code to a shell (e.g., `curl <url> | sh`).
- Modify shell startup files (`.zshrc`, `.bashrc`) or your PATH.
- Run `npx <malicious-package>` and similar network-fetched executables.

Treat the agent like a junior dev with unrestricted shell access — be careful what you paste into the prompt, and do not run this plugin on machines with credentials you cannot afford to rotate.

### What this plugin does NOT do

- It does NOT ship any postinstall scripts. `npm i @glrs-dev/harness-plugin-opencode` mutates only `node_modules/`. All filesystem changes to your config happen in the explicit `glrs harness install` step.
- It does NOT write to `~/.config/opencode/agents/`, `~/.config/opencode/commands/`, `~/.config/opencode/skills/`, or `~/.config/opencode/tools/`. Agents, commands, and skills live in `node_modules` (read-only by design). The only config write is `~/.config/opencode/opencode.json` during `install`.
- It does NOT exfiltrate code, prompts, file paths, error messages, usernames, project names, or git remotes. All tracking data stays local on disk.

## Privacy

**Update check.** Daily version check against `registry.npmjs.org`. Opt out: `HARNESS_OPENCODE_UPDATE_CHECK=0`.

**Catwalk model catalog.** During interactive `install` only, fetches the provider list from `catwalk.charm.land/v2/providers`. The response is schema-validated (see `src/cli/catwalk.ts`) before any value reaches your `opencode.json`. If validation fails, the installer falls back to built-in presets.

## Migrating from clone+symlink install

See [docs/migration-from-clone-install.md](docs/migration-from-clone-install.md).

## Contributing

Read [`AGENTS.md`](./AGENTS.md) and [`CONTRIBUTING.md`](./CONTRIBUTING.md). All user-visible PRs need a changeset (`bunx changeset`).

## License

MIT
