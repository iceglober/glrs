import { bold, dim, cyan } from "./lib/fmt.js";
import { VERSION } from "./lib/version.js";

export const HELP_TEXT = `
${bold("glorious")} ${dim(`v${VERSION}`)}
AI-native development workflow — design, implement, test, and ship with Claude Code.

${bold("USAGE")}

  ${cyan("gs-agentic")} <command> [arguments] [flags]

${bold("COMMANDS")}

  ${bold("Workflow")}

  start ["description"] [--quick] [--id <task-id>]
      Start a new task pipeline or resume an existing one. Claude guides you
      through: understand → design → implement → verify → ship.

      With no args, detects stalled tasks and offers to resume them.
      With --id, resumes a specific task from any directory.
      With --quick, skips design phases for small bugs and features.

      Examples:
        gs-agentic start                           (find stalled tasks or prompt)
        gs-agentic start "add user auth"           (starts full pipeline)
        gs-agentic start --quick "fix login bug"   (skips design, straight to implement)
        gs-agentic start --id t1                   (resume task t1 from anywhere)

  status [--json]
      Show all tasks in a tree view with phases, branches, and progress.

  skills [--user | --project] [--force] [--prefix]
      Install glorious workflow skills as Claude Code slash commands.

      With no flags, shows an interactive picker to choose scope.
      --user     Install to ~/.claude/ (available in all projects)
      --project  Install to .claude/ (committed to this repo)
      Falls back to project scope when stdin is not a TTY.

      Engineering skills:
        /think          Product strategy session before building
        /work           Implement a task (from spec or ad-hoc)
        /fix            Fix bugs, update task if needed
        /qa             QA the diff against acceptance criteria
        /ship           Typecheck, review, commit, push, PR
        /research-auto  Autonomous experimentation (think-test-reflect)
        /browser        Browse and interact with web pages

      Design pipeline:
        /research-web   Multi-agent web research orchestrator
        /spec-make      Create product spec from research or description
        /spec-enrich    Autonomous spec enrichment from codebase
        /spec-refine    Interactive spec refinement
        /spec-review    Spec gap analysis after refinement
        /spec-lab       Validation experiments against spec unknowns

  ${bold("Worktree management")} ${dim("(gs-agentic wt ...)")}

  wt
      Interactive worktree picker — select a worktree to open a shell in.
      Works from any directory. Worktrees are tracked globally across repos.

  wt create <name> [--from <branch>]
      Create a new worktree with a fresh branch forked from <branch>
      (defaults to main/master). Opens a shell inside the worktree.

  wt checkout <branch>
      Create a worktree from an existing remote branch.

  wt list
      Show all worktrees across all repos, grouped by repository.

  wt delete [name] [--force]
      Remove worktrees and their branches. Without a name, opens an
      interactive multi-select picker for bulk deletion.

  wt cleanup [--base <branch>] [--dry-run] [--yes]
      Delete worktrees whose branches are merged or whose remote is deleted.

  wt hooks
      Create .glorious/hooks/ with a post_create template.

  upgrade
      Check for a newer version and self-update.

  ${bold("Advanced")} ${dim("(internal — used by skills and orchestrator)")}

  state task create --title "..."
      Create a new task (returns task ID).

  state task <id> show [--json]
      Display task details.

  state task <id> transition <phase> [--force]
      Move task to a new phase.

  state task <id> update --<field> <value>
      Update task metadata.

  state task <id> cancel
      Cancel a task.

  state task list [--phase <p>] [--parent <id>] [--json]
      List tasks with optional filters.

  state spec <id> show
      Display a task's spec.

  state spec <id> set --file <path> | --content "..."
      Write a task's spec.

  state spec <id> add-workstream --title "..." [--depends-on <ids>]
      Add a workstream to an epic.

  state qa <id> report --status pass|fail --summary "..."
      Record a QA result.

  state log <id>
      Show phase transition history.

${bold("FLAGS")}

  --version, -V    Print version
  --help, -h       Show this help

${bold("ENVIRONMENT")}

  GLORIOUS_DIR Override where worktrees are stored. By default, worktrees
               are created as siblings of the repo.
`.trimStart();
