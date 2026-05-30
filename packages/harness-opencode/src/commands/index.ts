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
  const extPath = join(cwd, ".glrs", "extensions", `post-${commandName}.md`);
  if (!existsSync(extPath)) return "";
  try {
    const content = readFileSync(extPath, "utf8").trim();
    return `\n\n## Post-${commandName} extension (from .glrs/extensions/post-${commandName}.md)\n\n${content}`;
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

export function createCommands(cwd?: string): Record<string, CommandConfig> {
  const dir = cwd ?? process.cwd();
  return {
    ship: {
      template: shipPrompt + readExtension("ship", dir),
      description:
        "Finalize, commit, push, and open a PR/MR. Human-gated at each step.",
    },
    review: {
      template: reviewPrompt,
      description:
        "Adversarial read-only review of a PR, current branch, commit range, or file.",
    },
    "init-deep": {
      template: initDeepPrompt,
      description:
        "Generate hierarchical AGENTS.md files for the current repo.",
    },
    research: {
      template: researchPrompt,
      description: "Deep codebase exploration via parallel subagents.",
    },
    fresh: {
      template: freshPrompt,
      description:
        "Re-key the current worktree to a new task. Runs the repo's .glrs/hooks/fresh-reset if present; otherwise discards local changes and creates a new branch from latest origin/<default>. Then continues inline into the PRIME on the new task.",
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
