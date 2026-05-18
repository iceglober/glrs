# Wave 4 — Ink TUI: Dashboard + Session Cards

**Focus:** The visual layer. Render the multi-session dashboard with live status from the SessionManager. The TUI reads Channel 2 (event stream files) via the SessionManager — it never touches Channel 1 (EventEmitter, in-process only) or Channel 3 (debug log).

---

## Items

- [ ] 4.1 **Add Ink + React dependencies.** Add `ink` (^5.x), `react` (^18.x), `@types/react`, `@inkjs/ui` to `packages/cli/`. Configure tsconfig for JSX. Add `.tsx` to tsup entry patterns. These deps only exist in the CLI package — not in autopilot or adapters.

  - files (MODIFIED):
    - `packages/cli/package.json`
    - `packages/cli/tsconfig.json`
    - `packages/cli/tsup.config.ts` (if applicable)
  - verify: `cd packages/cli && bun run build`

- [ ] 4.2 **Dashboard app shell.** `<Dashboard>` root component. Renders to stderr via `render(<Dashboard />, { stdout: process.stderr, exitOnCtrlC: false })`. Accepts `SessionManager` as prop. Polls `manager.getSessions()` every 1s via `useEffect` + `setInterval`. Renders a list of `<SessionCard>` components. The SessionManager internally tails event stream files — the React tree just reads the derived state.

  - files (NEW):
    - `packages/cli/src/tui/components/Dashboard.tsx`
    - `packages/cli/src/tui/index.ts` — `startDashboard(manager): Promise<void>`
  - verify: `cd packages/cli && bun run build`

- [ ] 4.3 **Session card component.** `<SessionCard handle={session} selected={boolean}>` renders one session. Shows: repo/branch, phase progress, iteration N/M, cost, elapsed, last tool, status badge. Uses `@inkjs/ui` `<Spinner>` for running, colored borders for status (green=complete, blue=running, yellow=stale, red=error).

  - files (NEW):
    - `packages/cli/src/tui/components/SessionCard.tsx`
  - verify: `cd packages/cli && bun run build`

- [ ] 4.4 **Keyboard navigation.** `useInput` in `<Dashboard>` for: ↑↓ (select), enter (expand — wave 5), n (new session — wave 5), k (kill), q (quit). `exitOnCtrlC: false` — SIGINT handled by the existing signal infrastructure, not Ink.

  - files (MODIFIED):
    - `packages/cli/src/tui/components/Dashboard.tsx`
  - verify: `cd packages/cli && bun run build`

- [ ] 4.5 **`glrs oc dashboard` CLI command.** New subcommand: creates `SessionManager`, calls `startDashboard(manager)`, awaits exit. Non-TTY fallback: print plain-text session summary and exit.

  - files (NEW):
    - `packages/cli/src/commands/dashboard.ts`
  - files (MODIFIED):
    - `packages/cli/src/cli.ts` — register dashboard subcommand
  - verify: `cd packages/cli && bun run build`
