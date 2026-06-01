import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

function readPrompt(name: string): string {
  const candidates = [
    join(HERE, "prompts", name),
    join(HERE, "commands", "prompts", name),
    join(HERE, "..", "..", "src", "commands", "prompts", name),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      // try next
    }
  }
  throw new Error(`Could not find command prompt: ${name}`);
}

function readExtension(commandName: string, cwd: string): string {
  const extPath = join(cwd, ".glrs", "extensions", `${commandName}.md`);
  if (!existsSync(extPath)) return "";
  try {
    const content = readFileSync(extPath, "utf8").trim();
    return `\n\n## Extension (from .glrs/extensions/${commandName}.md)\n\n${content}`;
  } catch {
    return "";
  }
}

const shipPrompt = readPrompt("ship.md");
const reviewPrompt = readPrompt("review.md");
const initDeepPrompt = readPrompt("init-deep.md");
const researchPrompt = readPrompt("research.md");
const freshPrompt = readPrompt("fresh.md");
const costsPrompt = readPrompt("costs.md");
const dispatchesPrompt = readPrompt("dispatches.md");

type CommandConfig = {
  template: string;
  description?: string;
  agent?: string;
};

/**
 * Display order for the docs-site command reference (scripts/gen-docs.ts).
 * `/fresh` leads because it's the usual entry point. The generator asserts
 * this list covers exactly the commands returned by `createCommands()`, so
 * adding or renaming a command without updating docs fails the doc check.
 */
export const COMMAND_DOC_ORDER = [
  "fresh",
  "ship",
  "review",
  "research",
  "init-deep",
  "costs",
  "dispatches",
] as const;

export function createCommands(cwd?: string): Record<string, CommandConfig> {
  const dir = cwd ?? process.cwd();
  return {
    ship: {
      template: shipPrompt + readExtension("ship", dir),
      description:
        "Finalize, commit, push, and open a PR/MR. Human-gated at each step.",
    },
    review: {
      template: reviewPrompt + readExtension("review", dir),
      description:
        "Adversarial read-only review of a PR, current branch, commit range, or file.",
    },
    "init-deep": {
      template: initDeepPrompt + readExtension("init-deep", dir),
      description:
        "Generate hierarchical AGENTS.md files for the current repo.",
    },
    research: {
      template: researchPrompt + readExtension("research", dir),
      description: "Deep codebase exploration via parallel subagents.",
    },
    fresh: {
      template: freshPrompt + readExtension("fresh", dir),
      description:
        "Re-key the current worktree to a new task. Runs the repo's .glrs/hooks/fresh_init if present; otherwise discards local changes and creates a new branch from latest origin/<default>. Then continues inline into the PRIME on the new task.",
    },
    costs: {
      template: costsPrompt,
      description:
        "Show running LLM cost totals accrued by the cost-tracker plugin. Pass --json or --log for raw data.",
    },
    dispatches: {
      template: dispatchesPrompt,
      description:
        "Show subagent dispatch totals accrued by the dispatch-tracker plugin. Pass --json, --log, or --reset.",
    },
  };
}
