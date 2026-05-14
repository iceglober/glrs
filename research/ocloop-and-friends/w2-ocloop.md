# W2: OCLoop (d3vr/ocloop)

**Status:** COMPLETE  
**Last updated:** 2026-05-11  
**Sources:** GitHub repo, npm registry, full source read

---

## A. What Does It Do?

OCLoop is a **standalone TUI harness** that starts an OpenCode server, then repeatedly creates fresh sessions and sends a user-defined prompt (`.loop-prompt.md`) to each one. The prompt instructs the agent to pick the next unchecked task from a `PLAN.md` file, execute it, commit, and mark it done. When the session goes idle (agent finished), OCLoop checks whether the plan is complete (via a `<plan-complete>` sentinel tag the agent appends to PLAN.md). If not, it creates a new session and sends the same prompt again — looping until all automatable tasks are done. The user watches progress via a live TUI dashboard showing iteration timing, token counts, file diffs, and an activity log.

**Source:** [README.md](https://github.com/d3vr/OCLoop/blob/main/README.md), [src/App.tsx `startIteration()`](https://raw.githubusercontent.com/d3vr/ocloop/main/src/App.tsx)

---

## B. Mechanism

### Architecture

- **Standalone CLI** — not a plugin, not a slash command. It is a separate binary (`ocloop`) installed globally via `bun add -g ocloop`.
- **Language/Runtime:** TypeScript, Bun-only (uses `Bun.file()`, `Bun.build()`). SolidJS for the TUI (via `@opentui/solid`).
- **Integration:** Uses `@opencode-ai/sdk` (the official OpenCode TypeScript SDK) to:
  1. Start an OpenCode server process (`createOpencodeServer()` from `@opencode-ai/sdk/server`)
  2. Create sessions (`client.session.create()`)
  3. Send prompts asynchronously (`client.session.promptAsync()`)
  4. Subscribe to SSE events (`client.event.subscribe()`)
  5. Abort sessions (`client.session.abort()`)

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `@opencode-ai/sdk` | Official OpenCode SDK — server lifecycle, session API, SSE events |
| `@opentui/core` + `@opentui/solid` | Terminal UI framework (SolidJS-based) |
| `solid-js` | Reactive primitives for the TUI |
| `fuzzysort` | Fuzzy search in command palette |

**Source:** [package.json](https://raw.githubusercontent.com/d3vr/ocloop/main/package.json)

### Build

Single-file Bun bundle via `build.ts` using `@opentui/solid/bun-plugin` for SolidJS JSX transform. Output: `dist/index.js`.

**Source:** [build.ts](https://raw.githubusercontent.com/d3vr/ocloop/main/build.ts)

---

## C. Integration Surface with OpenCode

OCLoop talks to OpenCode **exclusively through the official SDK's HTTP API** — no TUI automation, no child-process stdin piping, no environment variable hacks.

### Specific API calls used:

1. **Server lifecycle:** `createOpencodeServer(options)` — spawns the OpenCode server as a child process, returns URL + close handle. ([src/hooks/useServer.ts](https://raw.githubusercontent.com/d3vr/ocloop/main/src/hooks/useServer.ts))

2. **Session management:** `client.session.create({})`, `client.session.promptAsync({sessionID, parts, agent})`, `client.session.abort({sessionID})`, `client.session.status({})` ([src/lib/api.ts](https://raw.githubusercontent.com/d3vr/ocloop/main/src/lib/api.ts))

3. **SSE event stream:** `client.event.subscribe({directory})` — subscribes to all events, filters by session ID. Events consumed: `session.created`, `session.idle`, `session.error`, `todo.updated`, `file.edited`, `session.status`, `message.updated`, `message.part.updated`, `session.updated`, `session.diff` ([src/hooks/useSSE.ts](https://raw.githubusercontent.com/d3vr/ocloop/main/src/hooks/useSSE.ts))

4. **Config read:** `client.config.get()` — reads active model from OpenCode config. `client.app.agents()` — validates agent name. ([src/App.tsx](https://raw.githubusercontent.com/d3vr/ocloop/main/src/App.tsx))

### Terminal integration (optional)

Pressing `T` launches an external terminal emulator with an `opencode attach` command so the user can interact with the running session mid-iteration. This is purely optional and uses `Bun.spawn()` to launch the terminal.

**Source:** [src/lib/terminal-launcher.ts](https://github.com/d3vr/OCLoop/blob/main/src/lib/terminal-launcher.ts)

---

## D. Invariants / Behavior

### Filesystem writes

| What | Where | Concern level |
|------|-------|---------------|
| Config file | `~/.config/ocloop/ocloop.json` | Low — only terminal preference |
| `.gitignore` modification | `<project>/.gitignore` — appends `.loop*` | **Medium** — writes to user project |
| `.loop.log` | `<project>/.loop.log` (verbose mode only) | Low — gitignored |
| Theme read | `~/.local/state/opencode/kv.json` (read-only) | None |

**Source:** [src/lib/config.ts](https://raw.githubusercontent.com/d3vr/ocloop/main/src/lib/config.ts), [src/lib/project.ts](https://raw.githubusercontent.com/d3vr/ocloop/main/src/lib/project.ts)

### Subprocesses

- Spawns the OpenCode server process (via SDK's `createOpencodeServer`)
- Optionally spawns a terminal emulator for interactive attach
- No containers

### Safety gates

- **Pause/resume:** User can press Space to pause after current task completes
- **Quit confirmation:** Q shows a confirmation dialog before aborting
- **`[MANUAL]` and `[BLOCKED]` markers:** Tasks can be excluded from automation
- **No auto-push:** The loop prompt explicitly says "NEVER push"
- **Session isolation:** Each iteration gets a fresh session (no context bleed)

### No built-in verification

OCLoop itself does NOT verify that a task was completed correctly. It trusts the agent's self-report (marking `[x]` in PLAN.md). The loop prompt can instruct the agent to run tests, but OCLoop doesn't enforce it.

### Typical failure modes

- Agent gets stuck (session never goes idle) — user must press T to inspect or Q to quit
- Agent marks task done but didn't actually complete it — no automated detection
- Server fails to start (port conflict, missing API keys)
- SSE connection drops — has exponential backoff reconnection

---

## E. Maturity

| Metric | Value |
|--------|-------|
| First commit | ~Jan 2026 (based on npm publish dates) |
| Last commit | Jan 6, 2026 (commit `39696cb` — "bump version: v0.2") |
| Total commits | 220 |
| Stars | 9 |
| Forks | 2 |
| Open issues | 1 |
| Contributors | 1 (d3vr / Fayçal Mitidji) |
| License | MIT |
| npm versions | 0.1.0, 0.1.1, 0.2.0 (all published Jan 6, 2026) |
| Archived | No |
| CI/CD | GitHub Actions configured (no visible workflow results without auth) |

**Assessment:** Very young (all activity in a single day — Jan 6, 2026). Single developer. Low community adoption. Actively developed (220 commits in one burst suggests AI-assisted development). Not archived but no activity since initial burst.

**Source:** [npm registry](https://registry.npmjs.org/ocloop), [GitHub commits](https://github.com/d3vr/OCLoop/commits/main)

---

## F. Relevance to Our Plugin

### What our plugin already has that overlaps:

| OCLoop capability | Our equivalent |
|-------------------|----------------|
| Loop over a task list | `/autopilot` — sequences through GitHub issues, invokes `/fresh --yes` between them |
| Fresh session per iteration | `/fresh` — creates new worktree + session |
| Plan → execute → verify cycle | PRIME/subagent arc: plan → build → verify internally |
| Knowledge persistence across iterations | `AGENTS.md` in our plugin (same concept) |
| Pause/resume | `/autopilot` has `--yes` for auto-confirm, otherwise waits |

### What OCLoop has that we DON'T:

1. **Live TUI dashboard with real-time observability** — iteration timing, token counts, file diffs, activity log, progress bar, ETA. Our `/autopilot` runs headless with no visual feedback beyond the OpenCode TUI itself.

2. **SSE-based event monitoring** — OCLoop subscribes to OpenCode's event stream and surfaces tool usage, file edits, reasoning, and token consumption in real time. Our plugin doesn't consume the SSE event stream for observability.

3. **Markdown-file-based plan format with structured markers** — `[MANUAL]`, `[BLOCKED: reason]`, `<plan-complete>` sentinel. Our `/autopilot` uses GitHub issues as the task source, not a local plan file.

4. **External terminal attach mid-iteration** — press T to open a terminal attached to the running session for manual intervention. We have no equivalent "peek into the running agent" capability.

5. **`@opencode-ai/sdk` usage pattern** — OCLoop demonstrates the full SDK integration surface (server lifecycle, session API, SSE subscription). This is a reference implementation for how to programmatically control OpenCode from TypeScript.

6. **Configurable agent per run** — `--agent` flag lets you pick which OpenCode agent handles each iteration. Our `/autopilot` always uses the same agent.

### What OCLoop lacks that we have:

- Git worktree isolation (our `/fresh` creates isolated worktrees)
- GitHub issue integration (our `/autopilot` pulls from issue queues)
- Multi-agent orchestration within a single iteration (our PRIME → subagent arc)
- Plugin-level integration (skills, commands, MCPs, prompt injection)
- Verification step enforcement (our pilot-builder has verify commands)

---

## Invariant Concerns

| Invariant | Risk |
|-----------|------|
| Zero user-filesystem-writes outside installer | **VIOLATED** — OCLoop writes `~/.config/ocloop/ocloop.json` and modifies project `.gitignore`. If vendored, these would need removal or gating. |
| Bin-name collision | `ocloop` bin name does not collide with any of our bins (`harness-opencode`, `glrs-oc`, `glrs`, `gs-assume`, `gsa`) |
| Skills-precedence conflict | N/A — OCLoop is not a plugin, has no skills/commands |
| Dependencies | `@opentui/core`, `@opentui/solid`, `solid-js` are TUI-specific deps we don't currently use. `@opencode-ai/sdk` is the official SDK we could adopt independently. |

---

## Key Takeaways for Synthesis

1. OCLoop is architecturally a **separate TUI application** that wraps OpenCode, not a plugin. It cannot be "installed into" our plugin without fundamental redesign.

2. The most transferable ideas are: (a) the **SDK usage patterns** for programmatic OpenCode control, (b) the **SSE event consumption** for observability, and (c) the **plan-file format** with structured markers.

3. The core loop mechanic (create session → send prompt → wait for idle → repeat) is conceptually identical to what our `/autopilot` does, but OCLoop adds a visual layer and uses the SDK API rather than spawning CLI processes.

4. If we wanted OCLoop's observability features, we'd build them as a dashboard component within our plugin or as a companion tool — not by vendoring OCLoop itself.
