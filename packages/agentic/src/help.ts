import { bold, dim, cyan } from "./lib/fmt.js";
import { VERSION } from "./lib/version.js";

export const HELP_TEXT = `
${bold("glorious")} ${dim(`v${VERSION}`)}
AI-native development workflow — design, implement, test, and ship with Claude Code.

${bold("USAGE")}

  ${cyan("gs-agentic")} <command> [arguments] [flags]

${bold("COMMANDS")}

  ${bold("Workflow")}

  status [--json]
      Show all tasks in a tree view with phases, branches, and progress.

  skills [--user | --project] [--force] [--prefix <string>]
      Install glorious workflow skills as Claude Code slash commands.

      With no flags, shows an interactive picker to choose scope.
      --user     Install to ~/.claude/ (available in all projects)
      --project  Install to .claude/ (committed to this repo)
      --prefix   Prefix for skill names (e.g. --prefix gs- for legacy names).
                 Default: no prefix (short canonical names).
      Falls back to project scope when stdin is not a TTY.

      Engineering skills (default names shown; use --prefix gs- for gs-* names):
        /gs                General workflow assistant
        /think             Product strategy session before building
        /work              Implement a task (from spec or ad-hoc)
        /fix               Fix bugs, update task if needed
        /qa                QA the diff against acceptance criteria
        /ship              Typecheck, review, commit, push, PR
        /build             Implement a specific gs-agentic task
        /build-loop        Loop through an epic's tasks automatically
        /deep-plan         Zero-ambiguity implementation plan
        /deep-review       6-agent parallel code review
        /quick-review      Fast single-pass code review
        /address-feedback  Resolve PR review feedback

      Utility skills:
        /research-auto  Autonomous experimentation (think-test-reflect)
        /browser        Browse and interact with web pages

      Design pipeline:
        /research-web   Multi-agent web research orchestrator
        /spec-make      Create product spec from research or description
        /spec-enrich    Autonomous spec enrichment from codebase
        /spec-refine    Interactive spec refinement
        /spec-review    Spec gap analysis after refinement
        /spec-lab       Validation experiments against spec unknowns

  ${bold("Plan review")} ${dim("(gs-agentic plan ...)")}

  plan review --id <id> [--port <n>]
      Open a plan in the browser for review with inline feedback buttons.
      Starts a local server, opens the rendered plan page, and saves
      per-step feedback that skills can read via state plan feedback.

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

  wt root
      Print the main repo root path (useful from inside a worktree).

  wt hooks
      Create .glorious/hooks/ with a post_create template.

  upgrade
      Check for a newer version and self-update.

  ready [--all] [--json]
      Show tasks that are ready to work on (dependencies met, non-terminal).
      --all shows tasks across all repos.

  ${bold("Configuration")}

  config list
      Show all settings with their values and sources.

  config get <key>
      Get a config value. Example: gs-agentic config get plan.auto-open

  config set <key> <value>
      Set a config value. Example: gs-agentic config set plan.auto-open false

  config unset <key>
      Reset a config value to its default.

      Available settings:
        plan.auto-open   Open browser automatically in plan review (default: true)

  ${bold("Advanced")} ${dim("(internal — used by skills and orchestrator)")}

  state task create --title "..." [--epic <id>]
      Create a new task (returns task ID). Optionally link to an epic.

  state task show --id <id> [--json] [--with-spec] [--fields ...]
      Display task details. --with-spec inlines the spec content.

  state task current [--json] [--with-spec] [--fields ...]
      Show the task for the current worktree/branch.

  state task next --epic <id> [--claim <actor>] [--json] [--with-spec] [--fields ...]
      Find the next ready task in an epic.
      --claim atomically transitions the task to implement, preventing races.

  state task transition --id <id> --phase <phase> [--force] [--actor <name>]
      Move task to a new phase.

  state task update --id <id> [--title "..."] [--description "..."] [--branch <b>] [--worktree <path>] [--pr <url>] [--unclaim]
      Update task metadata. --unclaim clears the claimed_by field.

  state task cancel --id <id>
      Cancel a task.

  state task list [--phase <p>] [--epic <id>] [--all] [--json]
      List tasks with optional filters.

  state epic create --title "..." [--description "..."]
      Create a new epic (returns epic ID).

  state epic show --id <id> [--json]
      Display epic details with derived phase and task list.

  state epic list [--json]
      List all epics.

  state plan show --id <id>
      Display plan content for a task or epic.

  state plan set --id <id> --file <path> | --content "..." | --stdin
      Write plan content for a task or epic.

  state plan add-task --id <epic-id> --title "..." [--depends-on <ids>]
      Add a task to an epic.

  state review create --task <id> --source <source> --commit-sha <sha> [--epic <id>] [--pr-number <n>] [--summary "..."]
      Create a review record (returns review ID).

  state review add-item --review <id> --body "..." [--severity <sev>] [--agents <names>] [--file <path>] [--line <n>] [--impact "..."] [--suggested-fix "..."] [--pr-comment-id <id>]
      Add a finding to a review.

  state review resolve --item <id> --status <status> --resolution "..."
      Resolve a review item.

  state review list [--task <id>] [--status <s>] [--severity <sev>] [--json] [--summary]
      List review items.

  state review summary [--task <id>] [--json]
      Show review summary counts.

  state qa --id <id> --status pass|fail --summary "..."
      Record a QA result.

  state log --id <id>
      Show phase transition history.

  state web [--port <n>]
      Open a read-only dashboard in the browser showing all epics, tasks,
      plans, and reviews. Auto-refreshes every 5 seconds.

${bold("FLAGS")}

  --version, -V    Print version
  --help, -h       Show this help

${bold("ENVIRONMENT")}

  GLORIOUS_DIR Override where worktrees are stored. By default, worktrees
               are created as siblings of the repo.
`.trimStart();
