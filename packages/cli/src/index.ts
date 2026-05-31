/**
 * @glrs-dev/cli — unified CLI for the glrs ecosystem.
 *
 * Provides a single `glrs` binary with subcommands:
 *
 *   glrs harness <cmd>  → harness plugin management (install, configure, etc.)
 *   glrs wt <args>      → worktree management commands
 *   glrs autopilot      → three-phase orchestrator (scope → plan → execute)
 *   glrs loop           → raw Ralph loop runner
 *   glrs dashboard      → live TUI for autopilot sessions
 *
 * Runtime: Bun >= 1.2.0.
 */

export const HELP_TEXT = `glrs — unified CLI for the @glrs-dev ecosystem

USAGE
  glrs <subcommand> [args...]

SUBCOMMANDS
  harness    Harness plugin management (install, configure, uninstall, doctor)
  assume     Cloud credentials (login, contexts, agent MCP setup)
  wt         Worktree management (create, list, switch, delete, cleanup)
  autopilot  Run the autopilot orchestrator (scope → plan → execute)
  loop       Run the Ralph loop with a raw prompt
  upgrade    Upgrade glrs to the latest published version

Run 'glrs <subcommand> --help' for per-command help.

EXAMPLES
  glrs harness install
  glrs assume init
  glrs wt new
  glrs wt list
  glrs autopilot --plan docs/plans/my-plan/
  glrs loop "implement the auth middleware"

REQUIREMENTS
  Bun >= 1.2.0 on PATH (install: https://bun.sh)

DOCS  https://glrs.dev
ISSUES https://github.com/iceglober/glrs/issues
`;

export const WORKTREE_HELP_TEXT = `glrs wt — worktree management

USAGE
  glrs wt <command> [args...]

COMMANDS
  new              Create a new worktree (auto-named from origin/default)
  list, ls         List all worktrees across repos
  switch, sw       Interactively select and switch to a worktree
  delete, rm       Remove worktrees (interactive or by name)
  cleanup          Delete merged/stale worktrees

EXAMPLES
  glrs wt new                    # Create worktree in current repo
  glrs wt new myrepo             # Create worktree for named repo
  glrs wt list                   # Show all worktrees
  glrs wt list -i                # Interactive picker
  glrs wt switch                 # Interactive switcher
  glrs wt delete my-branch       # Delete specific worktree
  glrs wt cleanup                # Clean up merged worktrees

Worktrees are stored in ~/.glrs/worktrees/<repo>/<name>/
`;
