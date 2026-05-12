---
"@glrs-dev/harness-plugin-opencode": minor
---

Autopilot rewrite, pilot rip-out, Tier 1 visual capabilities, opencode-snip toggle, research-variant hiding.

**Breaking changes:**

- **Pilot subsystem removed.** The `glrs oc pilot` CLI subcommand, the four pilot agents (`pilot-scoper` / `planner` / `builder` / `assessor`), the pilot-planning skill references, the `pilot-plugin.ts` runtime enforcer, and all pilot state/docs are gone. Users on pilot should migrate to the CLI autopilot or plain PRIME workflow.
- **TUI `/autopilot` slash command removed.** Autopilot is now CLI-only: `glrs oc autopilot "<prompt>"`. Users who want autonomous looping run the CLI in any terminal; the TUI stays for interactive work.
- **Research-variant agents (`research-web`, `research-local`, `research-auto`) hidden from the primary-agent picker.** They now run only as subagents dispatched by `@research`. Users who previously selected them directly should select `@research` instead.

**New features:**

- **CLI autopilot (`glrs oc autopilot "<prompt>"`)** — Ralph-loop engine: sends your prompt each iteration, watches the agent's response for `<autopilot-done>` sentinel, retries the same prompt when absent. Budgets: 50 iterations / 4h / 3 zero-progress iterations / kill-switch file. Supports single-issue (`"ship ENG-1234"`) and multi-issue (`"ship every open ENG-* issue in project ROADMAP"`) prompts.
- **opencode-snip installer toggle** — new "Plugin add-ons" section in `glrs oc install` (parallel to existing MCP toggles). Opt-in adds `opencode-snip` to the user's `plugin` array via config-merge, no vendored code. Useful for token reduction on bash-heavy sessions. Requires the Go `snip` binary separately.
- **Tier 1 visual capabilities** — `@plan`, `@research`, `@gap-analyzer` now have Playwright MCP access (joining `@prime`, `@build`, `@assessor`, `@assessor-thorough`, `@plan-reviewer`). Enable via the installer's Playwright toggle.
- **UI evaluation ladder (graceful degradation)** — all visual-capable agents now carry a four-tier capability ladder (Playwright → curl → webfetch → source inspection). When Playwright is unavailable, agents fall through to the next tier and report which method they used. No hard failure on Playwright absence.

**Internal:**

- Server lifecycle helpers (`startServer` / `createSession` / `sendAndWait` / `getLastAssistantMessage`) moved from `src/pilot/server.ts` to `src/lib/opencode-server.ts` (consumed by the CLI autopilot).
- Agent roster reduced from 20 → 16. Net −5,308 lines across 91 files. Test count 536 → 462 (pilot tests removed, visual-capability tests added).
