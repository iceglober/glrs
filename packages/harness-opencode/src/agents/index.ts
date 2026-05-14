import type { AgentConfig } from "@opencode-ai/sdk";
import { WORKFLOW_MECHANICS_RULE, UI_EVALUATION_LADDER } from "./shared/index.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Read prompt files at runtime from the bundled location.
// We use readFileSync rather than static imports because bun's markdown
// handling converts .md files to HTML when imported, which breaks frontmatter
// parsing. tsup's text loader works correctly for the built dist, but during
// development/test bun intercepts the import.
const HERE = dirname(fileURLToPath(import.meta.url));

function readPrompt(name: string): string {
  // In the bundled dist/index.js, import.meta.url resolves to dist/,
  // but prompts are at dist/agents/prompts/. In dev, HERE is src/agents/.
  const candidates = [
    join(HERE, "prompts", name),                               // dev: src/agents/prompts/
    join(HERE, "agents", "prompts", name),                     // dist: dist/ → dist/agents/prompts/
    join(HERE, "..", "..", "src", "agents", "prompts", name),  // fallback dev
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      // try next
    }
  }
  throw new Error(`Could not find prompt file: ${name}`);
}

const primePrompt = readPrompt("prime.md");
const scoperPrompt = readPrompt("scoper.md");
const planPrompt = readPrompt("plan.md");
const buildPrompt = readPrompt("build.md");
const buildOpenPrompt = readPrompt("build.open.md");
const specReviewerPrompt = readPrompt("spec-reviewer.md");
const specReviewerOpenPrompt = readPrompt("spec-reviewer.open.md");
const codeReviewerPrompt = readPrompt("code-reviewer.md");
const codeReviewerOpenPrompt = readPrompt("code-reviewer.open.md");
const codeReviewerThoroughPrompt = readPrompt("code-reviewer-thorough.md");
const planReviewerPrompt = readPrompt("plan-reviewer.md");
const codeSearcherPrompt = readPrompt("code-searcher.md");
const gapAnalyzerPrompt = readPrompt("gap-analyzer.md");
const architectureAdvisorPrompt = readPrompt("architecture-advisor.md");
const docsMaintainerPrompt = readPrompt("docs-maintainer.md");
const libReaderPrompt = readPrompt("lib-reader.md");
const agentsMdWriterPrompt = readPrompt("agents-md-writer.md");
const researchPrompt = readPrompt("research.md");
const researchWebPrompt = readPrompt("research-web.md");
const researchLocalPrompt = readPrompt("research-local.md");
const researchAutoPrompt = readPrompt("research-auto.md");
const debrieferPrompt = readPrompt("debriefer.md");

/**
 * Agents that have a strict-executor prompt variant, used when the agent
 * is assigned to the `mid-execute` tier. The `reasoning` prompt is used
 * when the agent falls back to the `mid` tier (no `mid-execute` configured).
 */
const EXECUTOR_VARIANT_AGENTS: Record<string, { reasoning: string; strict: string }> = {
  build: { reasoning: buildPrompt, strict: buildOpenPrompt },
  "spec-reviewer": { reasoning: specReviewerPrompt, strict: specReviewerOpenPrompt },
  "code-reviewer": { reasoning: codeReviewerPrompt, strict: codeReviewerOpenPrompt },
};

/**
 * Returns the strict-executor prompt for an agent, or throws if the agent
 * has no strict variant registered.
 */
export function getStrictPrompt(agentName: string): string {
  const variants = EXECUTOR_VARIANT_AGENTS[agentName];
  if (!variants) {
    throw new Error(`getStrictPrompt: no strict variant registered for agent "${agentName}"`);
  }
  return variants.strict;
}

/**
 * Returns the reasoning (standard) prompt for an agent, or throws if the
 * agent has no variant registered.
 */
export function getReasoningPrompt(agentName: string): string {
  const variants = EXECUTOR_VARIANT_AGENTS[agentName];
  if (!variants) {
    throw new Error(`getReasoningPrompt: no variant registered for agent "${agentName}"`);
  }
  return variants.reasoning;
}

/** Strip YAML frontmatter (--- ... ---) from a markdown string. */
function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return md;
  return md.slice(end + 4).trimStart();
}

/** Parse a simple YAML frontmatter block into a key→value map.
 * Handles multi-line values (indented continuation lines). */
function parseFrontmatter(md: string): Record<string, string> {
  if (!md.startsWith("---")) return {};
  const end = md.indexOf("\n---", 3);
  if (end === -1) return {};
  const block = md.slice(4, end);
  const result: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentValue: string[] = [];

  const flush = () => {
    if (currentKey) {
      result[currentKey] = currentValue.join(" ").trim();
    }
  };

  for (const line of block.split("\n")) {
    // Indented continuation line (multi-line value)
    if (currentKey && (line.startsWith("  ") || line.startsWith("\t"))) {
      currentValue.push(line.trim());
      continue;
    }
    // New key
    const colon = line.indexOf(":");
    if (colon === -1) {
      flush();
      currentKey = null;
      currentValue = [];
      continue;
    }
    flush();
    currentKey = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    currentValue = value ? [value] : [];
  }
  flush();
  return result;
}

/** Inject the WORKFLOW_MECHANICS_RULE into prompts that use the placeholder. */
function injectWorkflowMechanics(prompt: string): string {
  return prompt.replace("{WORKFLOW_MECHANICS_RULE}", WORKFLOW_MECHANICS_RULE);
}

/** Inject the UI_EVALUATION_LADDER into prompts that use the placeholder. */
function injectUIEvaluationLadder(prompt: string): string {
  return prompt.replace("{UI_EVALUATION_LADDER}", UI_EVALUATION_LADDER);
}

/** Build an AgentConfig from a prompt markdown file. */
function agentFromPrompt(
  raw: string,
  overrides: Partial<AgentConfig> = {},
): AgentConfig {
  const fm = parseFrontmatter(raw);
  const body = stripFrontmatter(raw);
  const prompt = injectUIEvaluationLadder(injectWorkflowMechanics(body));

  const base: AgentConfig = {
    description: fm["description"] ?? "",
    mode: (fm["mode"] as AgentConfig["mode"]) ?? "subagent",
    model: fm["model"] ?? undefined,
    prompt,
  };

  return { ...base, ...overrides };
}

// ---- Permission blocks (reused across primary agents) ----

// Root-cause finding (v0.7.0 bash-prompt fix, 2026-04-24):
//
// An upstream OpenCode layer (suspected to be the built-in "subagent"
// mode's permission defaults — exact source not pinpointed) injects
// `{permission: "bash", pattern: "*", action: "ask"}` into the effective
// ruleset passed to `Permission.evaluate` AFTER our agent config reaches
// OpenCode. We have hard evidence of this: user log at
//   ~/.local/share/opencode/log/2026-04-24T014426.log lines 40292-40293
//   (subagent with shape matching qa-reviewer: the agent-level block
//   ends `{bash, *, ask}` despite our source shipping `bash: "allow"`)
// and 46605-46606 (same ruleset wins `bash * ask` → prompt fires for
// `git merge-base main HEAD`).
//
// `Permission.evaluate` walks the merged ruleset top-to-bottom and the
// LAST matching rule wins. `Permission.fromConfig` sorts top-level
// permission keys as "wildcard-in-name first, specific-in-name last"
// before flattening into rules. Consequence: for the `bash` permission,
// specific-pattern keys like `"git log *"` sort AFTER the upstream
// `bash * ask` and win via last-match-wins for commands they match.
// The wildcard `"*"` key does NOT beat the upstream ask — their names
// are equally wildcard-only, so merge-position determines the winner
// and the upstream ask lands AFTER us.
//
// Mitigation: enumerated object-form bash maps. `CORE_BASH_ALLOW_LIST`
// contains the specific-pattern allows that cover the reported pain
// points (pnpm lint, tail, ls, git status/diff/log/merge-base, etc.).
// `CORE_DESTRUCTIVE_BASH_DENIES` contains the non-negotiable denies
// that every agent capable of running bash must carry. Both are
// shared across qa-reviewer, qa-thorough, prime, and build
// so the shape stays consistent as the allow-list evolves.
//
// Prior attempts (`c9a288d`, `3483448`) shipped scalar `bash: "allow"`
// on the reviewers and diagnosed the loss of that allow at the wrong
// layer (the global `permission.bash` map). That map was correctly
// removed, but the scalar allow on the agent itself is still losing
// to the upstream `bash * ask` — because the merge order puts their
// wildcard rule last. Specific patterns in our agent block win the
// evaluation; wildcards don't. See `docs/plugin-architecture.md`
// "Permission resolution" for the full writeup and do NOT simplify
// back to scalar `"allow"` without understanding this.

/** Non-destructive commands the reviewers/primary agents need to run
 * freely. Each entry is a glob-style pattern matching the FULL command
 * string (tokens separated by spaces; trailing `*` matches any args).
 * Keep entries specific enough that a destructive form (e.g. `rm -rf`)
 * is NOT inadvertently matched — those live in `CORE_DESTRUCTIVE_BASH_DENIES`.
 */
const CORE_BASH_ALLOW_LIST = {
  // File inspection — safe read-only commands the reviewers use heavily.
  "ls *": "allow",
  "cat *": "allow",
  "head *": "allow",
  "tail *": "allow",
  "wc *": "allow",
  "grep *": "allow",
  "rg *": "allow",
  "find *": "allow",
  "file *": "allow",
  "stat *": "allow",
  "which *": "allow",
  "whereis *": "allow",
  "basename *": "allow",
  "dirname *": "allow",
  "realpath *": "allow",
  "readlink *": "allow",
  "diff *": "allow",
  "sort *": "allow",
  "uniq *": "allow",
  "xxd *": "allow",
  "tree *": "allow",
  "date *": "allow",
  "echo *": "allow",
  // Git read-only subcommands (explicit rather than `git *` so we don't
  // accidentally whitelist `git push` variants the destructive-deny
  // table counteracts via longer-pattern matches — but clarity > trust).
  "git status *": "allow",
  "git log *": "allow",
  "git diff *": "allow",
  "git show *": "allow",
  "git branch *": "allow",
  "git merge-base *": "allow",
  "git rev-parse *": "allow",
  "git rev-list *": "allow",
  "git blame *": "allow",
  "git config --get *": "allow",
  "git config --get": "allow",
  "git remote *": "allow",
  "git stash list *": "allow",
  "git stash list": "allow",
  "git ls-files *": "allow",
  "git describe *": "allow",
  "git tag *": "allow",
  "git fetch *": "allow",
  // Package/build tooling — the reviewers run lint/test/typecheck.
  "pnpm lint *": "allow",
  "pnpm test *": "allow",
  "pnpm typecheck *": "allow",
  "pnpm build *": "allow",
  "pnpm run *": "allow",
  "pnpm install *": "allow",
  "pnpm --filter *": "allow",
  "pnpm -w *": "allow",
  "bun run *": "allow",
  "bun test *": "allow",
  "bun install *": "allow",
  "bunx *": "allow",
  "npm run *": "allow",
  "npm test *": "allow",
  "npx *": "allow",
  "yarn *": "allow",
  "tsc *": "allow",
  "eslint *": "allow",
  "prettier *": "allow",
  "biome *": "allow",
  // Our own CLI (install, doctor, autopilot, etc.) — reviewer/build invocations.
  "bunx @glrs-dev/harness-plugin-opencode *": "allow",
  "glrs-oc *": "allow",
  // GitHub CLI — read-only gh calls are fine; destructive `gh pr merge`
  // is gated at the PRIME level by human intent (user runs /ship).
  "gh pr view *": "allow",
  "gh pr list *": "allow",
  "gh issue view *": "allow",
  "gh issue list *": "allow",
  "gh api *": "allow",
};

/** Destructive-command denies. Applied to EVERY agent block that allows
 * bash at all. Pattern order matters for readability, not for evaluation
 * (findLast doesn't care about insertion order within the same specific
 * pattern; it matches the LAST rule whose both permission AND pattern
 * match). Each pattern here is specific enough to beat `"*": "allow"`.
 */
const CORE_DESTRUCTIVE_BASH_DENIES = {
  "rm -rf /*": "deny",
  "rm -rf ~*": "deny",
  "chmod *": "deny",
  "chown *": "deny",
  "sudo *": "deny",
  "git push --force*": "deny",
  "git push -f *": "deny",
  "git push * --force*": "deny",
  "git push * -f": "deny",
  "git push * main*": "deny",
  "git push * master*": "deny",
  // --force-with-lease is the safe variant — explicit allow rule sorts
  // after the broad --force deny so the lease variant survives.
  "git push --force-with-lease*": "allow",
  "git push * --force-with-lease*": "allow",
};

const PRIME_PERMISSIONS = {
  edit: "allow" as const,
  bash: {
    "*": "allow",
    ...CORE_BASH_ALLOW_LIST,
    ...CORE_DESTRUCTIVE_BASH_DENIES,
    // git clean & git reset --hard are allowed for prime because
    // /fresh runs them after its own question-tool confirmation gate;
    // a permission-layer prompt on top is redundant noise (see issue #54).
    // BUILD keeps the stricter default (deny/ask).
    "git clean *": "allow",
    "git reset --hard*": "allow",
  },
  webfetch: "allow" as const,
  // Per-tool permissions (index signature on AgentConfig allows these)
  ast_grep: "allow",
  tsc_check: "allow",
  eslint_check: "allow",
  todo_scan: "allow",
  comment_check: "allow",
  question: "allow",
  serena: "allow",
  memory: "allow",
  git: "allow",
  playwright: "allow",
  linear: "allow",
};

const SCOPER_PERMISSIONS = {
  ...PRIME_PERMISSIONS,
};

/**
 * The @scoper agent runs in an inquirer-driven wizard loop — the wizard
 * handles user input via inquirer, not via the question tool. Disabling
 * the question tool here prevents the agent from accidentally calling it
 * (which would deadlock the wizard since no TUI is attached).
 */
const SCOPER_DISABLED_TOOLS = {
  question: false,
} as const;

/**
 * Autopilot sessions run without a user, so any tool that blocks on
 * user input deadlocks the loop forever. The `question` tool is the
 * canonical example (observed: 5 question-tool calls in iteration 1
 * followed by a 6th that prompted and hung the session).
 *
 * The fix is at the `tools` map (not the `permission` map — verified
 * that OpenCode's runtime only honors a narrow set of permission keys:
 * edit/bash/webfetch/doom_loop/external_directory. `question` in the
 * permission map is a silent no-op). Setting `tools.question = false`
 * disables the tool at agent-config time so it's never registered for
 * the session in the first place. No runtime enforcement needed.
 */
const AUTOPILOT_PRIME_DISABLED_TOOLS = {
  question: false,
} as const;

const PLAN_PERMISSIONS = {
  edit: "allow" as const,
  write: "allow" as const,
  // Plan agent is read-only aside from writing under the plan dir. It
  // resolves the plan dir inline (see src/agents/prompts/plan.md
  // `## 4. Write the plan`): `$HOME/.glorious/opencode/<repo-folder>/plans/`,
  // where `<repo-folder>` comes from
  // `basename(dirname(git rev-parse --git-common-dir))`. The object-form
  // denies bash broadly and re-allows only the four commands that snippet
  // needs. Everything else remains denied, preserving the "plan writes only
  // plan files" invariant (the write-scope constraint is prompt-enforced,
  // not permission-enforced).
  bash: {
    "*": "deny",
    "git rev-parse --git-common-dir": "allow",
    "basename *": "allow",
    "dirname *": "allow",
    "mkdir -p *": "allow",
  },
  webfetch: "allow" as const,
  ast_grep: "deny",
  tsc_check: "deny",
  eslint_check: "deny",
  todo_scan: "allow",
  comment_check: "allow",
  question: "allow",
  serena: "allow",
  memory: "allow",
  git: "allow",
  playwright: "allow",
  linear: "allow",
};

const BUILD_PERMISSIONS = {
  edit: "allow" as const,
  bash: {
    "*": "allow",
    ...CORE_BASH_ALLOW_LIST,
    ...CORE_DESTRUCTIVE_BASH_DENIES,
    // Build is stricter than prime on mutation: no `git clean`
    // (build shouldn't wipe worktree mid-execution), and
    // `git reset --hard` must prompt explicitly.
    "git clean *": "deny",
    "git reset --hard*": "ask",
  },
  webfetch: "allow" as const,
  ast_grep: "allow",
  tsc_check: "allow",
  eslint_check: "allow",
  todo_scan: "allow",
  comment_check: "allow",
  question: "allow",
  serena: "allow",
  memory: "allow",
  git: "allow",
  playwright: "allow",
  linear: "allow",
};

// ---- Subagent permission blocks ----
// Values mirror what was previously (ineffectively) declared in each
// subagent's `.md` frontmatter. Moving to TS constants so overrides
// actually reach AgentConfig — the flat YAML parser silently dropped
// the nested `permission:` maps, and `agentFromPrompt` never read them.

// spec-reviewer and code-reviewer have identical permission shapes to assessor —
// both are read-only adversarial reviewers that need bash access for git log
// scope-creep verification and running lint/test/typecheck.
const SPEC_REVIEWER_PERMISSIONS = {
  edit: "deny" as const,
  bash: {
    "*": "allow",
    ...CORE_BASH_ALLOW_LIST,
    ...CORE_DESTRUCTIVE_BASH_DENIES,
  },
  webfetch: "deny" as const,
  ast_grep: "allow",
  tsc_check: "allow",
  eslint_check: "allow",
  todo_scan: "allow",
  comment_check: "allow",
  question: "allow",
  serena: "allow",
  memory: "deny",
  git: "allow",
  playwright: "allow",
  linear: "deny",
};

const CODE_REVIEWER_PERMISSIONS = {
  edit: "deny" as const,
  bash: {
    "*": "allow",
    ...CORE_BASH_ALLOW_LIST,
    ...CORE_DESTRUCTIVE_BASH_DENIES,
  },
  webfetch: "deny" as const,
  ast_grep: "allow",
  tsc_check: "allow",
  eslint_check: "allow",
  todo_scan: "allow",
  comment_check: "allow",
  question: "allow",
  serena: "allow",
  memory: "deny",
  git: "allow",
  playwright: "allow",
  linear: "deny",
};

const CODE_REVIEWER_THOROUGH_PERMISSIONS = {
  edit: "deny" as const,
  bash: {
    "*": "allow",
    ...CORE_BASH_ALLOW_LIST,
    ...CORE_DESTRUCTIVE_BASH_DENIES,
  },
  webfetch: "deny" as const,
  ast_grep: "allow",
  tsc_check: "allow",
  eslint_check: "allow",
  todo_scan: "allow",
  comment_check: "allow",
  question: "allow",
  serena: "allow",
  memory: "deny",
  git: "allow",
  playwright: "allow",
  linear: "deny",
};

const PLAN_REVIEWER_PERMISSIONS = {
  edit: "deny" as const,
  bash: "deny" as const,
  webfetch: "deny" as const,
  ast_grep: "allow",
  tsc_check: "deny",
  eslint_check: "deny",
  todo_scan: "allow",
  comment_check: "allow",
  question: "allow",
  serena: "allow",
  memory: "deny",
  git: "allow",
  playwright: "deny",
  linear: "deny",
};

const GAP_ANALYZER_PERMISSIONS = {
  edit: "deny" as const,
  bash: "deny" as const,
  webfetch: "deny" as const,
  ast_grep: "deny",
  tsc_check: "deny",
  eslint_check: "deny",
  todo_scan: "allow",
  comment_check: "allow",
  question: "allow",
  serena: "allow",
  memory: "allow",
  git: "deny",
  playwright: "allow",
  linear: "allow",
};

const CODE_SEARCHER_PERMISSIONS = {
  edit: "deny" as const,
  bash: "deny" as const,
  webfetch: "deny" as const,
  ast_grep: "allow",
  tsc_check: "deny",
  eslint_check: "deny",
  todo_scan: "deny",
  comment_check: "deny",
  question: "allow",
  serena: "allow",
  memory: "deny",
  git: "deny",
  playwright: "deny",
  linear: "deny",
};

const ARCHITECTURE_ADVISOR_PERMISSIONS = {
  edit: "deny" as const,
  bash: "deny" as const,
  webfetch: "deny" as const,
  ast_grep: "allow",
  tsc_check: "deny",
  eslint_check: "deny",
  todo_scan: "allow",
  comment_check: "allow",
  question: "allow",
  serena: "allow",
  memory: "allow",
  git: "allow",
  playwright: "deny",
  linear: "allow",
};

const LIB_READER_PERMISSIONS = {
  edit: "deny" as const,
  bash: "deny" as const,
  webfetch: "deny" as const,
  ast_grep: "deny",
  tsc_check: "deny",
  eslint_check: "deny",
  todo_scan: "deny",
  comment_check: "deny",
  question: "allow",
  serena: "deny",
  memory: "allow",
  git: "deny",
  playwright: "deny",
  linear: "deny",
};

const AGENTS_MD_WRITER_PERMISSIONS = {
  edit: "allow" as const,
  bash: "ask" as const,         // preserve ask-semantics from frontmatter
  webfetch: "deny" as const,
  ast_grep: "allow",
  tsc_check: "deny",
  eslint_check: "deny",
  todo_scan: "allow",
  comment_check: "allow",
  question: "allow",
  serena: "allow",
  memory: "deny",
  git: "allow",
  playwright: "deny",
  linear: "deny",
};

// ---- Research agent permissions ----
// Research agent needs allow-by-default bash because research-auto dispatches
// arbitrary user-supplied run/measure commands that a deny-by-default enumerated
// allow-list would block. Destructive patterns remain denied via shared constants.

const RESEARCH_PERMISSIONS = {
  edit: "allow" as const,
  bash: {
    "*": "allow",
    ...CORE_BASH_ALLOW_LIST,
    ...CORE_DESTRUCTIVE_BASH_DENIES,
  },
  webfetch: "allow" as const,
  ast_grep: "allow",
  tsc_check: "deny",
  eslint_check: "deny",
  todo_scan: "allow",
  comment_check: "allow",
  question: "allow",
  serena: "allow",
  memory: "allow",
  git: "allow",
  playwright: "allow",
  linear: "allow",
};

const DEBRIEFER_PERMISSIONS = {
  edit: "deny" as const,
  bash: {
    "*": "deny",
    "git log *": "allow",
    "git diff *": "allow",
    "git show *": "allow",
    "git status *": "allow",
    "git rev-parse *": "allow",
    "git branch *": "allow",
    "cat *": "allow",
    "head *": "allow",
    "tail *": "allow",
    "ls *": "allow",
    "wc *": "allow",
  },
  webfetch: "deny" as const,
  ast_grep: "deny",
  tsc_check: "deny",
  eslint_check: "deny",
  todo_scan: "deny",
  comment_check: "deny",
  question: "deny",
  serena: "deny",
  memory: "deny",
  git: "allow",
  playwright: "deny",
  linear: "deny",
};


// ---- Tier map ----

export type ModelTier = "deep" | "mid" | "mid-execute" | "fast";

/**
 * Maps every agent name to its model tier. Used by the harness.models
 * config resolution in src/config-hook.ts.
 *
 * - deep:        expensive, high-capability models (opus-class)
 * - mid:         balanced cost/capability, reasoning builder (sonnet-class)
 * - mid-execute: optional strict executor tier — narrower prompts, no
 *                self-correction, escalation-first. Falls back to `mid`
 *                if not configured. Use for Kimi K2.x, Qwen3-Coder, or
 *                any model the user wants to run as a strict executor.
 * - fast:        cheap, low-latency (haiku-class)
 *
 * Adding an agent to createAgents() without adding it here will fail
 * the AGENT_TIERS completeness test — that's intentional.
 */
export const AGENT_TIERS: Record<string, ModelTier> = {
  prime: "deep",
  scoper: "deep",
  "autopilot-prime": "deep",
  plan: "deep",
  "architecture-advisor": "deep",
  "plan-reviewer": "deep",
  "gap-analyzer": "deep",
  research: "deep",
  "research-web": "deep",
  "research-local": "deep",
  "research-auto": "deep",
  build: "mid-execute",
  "spec-reviewer": "mid-execute",
  "code-reviewer": "mid-execute",
  "code-reviewer-thorough": "deep",
  "docs-maintainer": "mid",
  "lib-reader": "mid",
  "agents-md-writer": "mid",
  debriefer: "mid",
  "code-searcher": "fast",
};

// ---- Public API ----

export function createAgents(): Record<string, AgentConfig> {
  return {
    // Primary agents
    prime: agentFromPrompt(primePrompt, {
      description: "End-to-end PRIME (Primary Routing and Intelligence Management Entity). Takes a request from intent to ready-to-ship in one session. Default primary agent.",
      mode: "primary",
      model: "anthropic/claude-opus-4-7",
      temperature: 0.2,
      permission: PRIME_PERMISSIONS as AgentConfig["permission"],
    }),
    scoper: agentFromPrompt(scoperPrompt, {
      description: "Interactive scoping agent. Runs an inquirer-driven wizard loop — asks short questions via assistant text, collects answers via inquirer, then writes scope.md. Use at the start of a new feature to align on intent, constraints, and acceptance criteria before planning.",
      mode: "primary",
      model: "anthropic/claude-opus-4-7",
      temperature: 0.3,
      permission: SCOPER_PERMISSIONS as AgentConfig["permission"],
      tools: SCOPER_DISABLED_TOOLS as AgentConfig["tools"],
    }),
    "autopilot-prime": agentFromPrompt(primePrompt, {
      description: "PRIME for unattended autopilot sessions. Identical to `prime` except the `question` tool is disabled — autopilot has no user to answer interactive prompts, and a blocking question deadlocks the session. Not user-selectable; invoked by the Ralph loop.",
      mode: "subagent",
      model: "anthropic/claude-opus-4-7",
      temperature: 0.2,
      permission: PRIME_PERMISSIONS as AgentConfig["permission"],
      tools: AUTOPILOT_PRIME_DISABLED_TOOLS as AgentConfig["tools"],
    }),
    plan: agentFromPrompt(planPrompt, {
      description: "Interactive planner. Orchestrates gap analysis and adversarial review. Produces a written plan in the repo-shared plan directory (`~/.glorious/opencode/<repo-folder>/plans/`, resolved inline via `git rev-parse --git-common-dir`).",
      mode: "all",
      model: "anthropic/claude-opus-4-7",
      temperature: 0.3,
      // @plan dispatches @gap-analyzer, @code-searcher, and @plan-reviewer
      // as subagents. OpenCode strips the `task` tool from subagent contexts
      // by default; explicit opt-in re-enables it.
      tools: { task: true },
      permission: PLAN_PERMISSIONS as AgentConfig["permission"],
    }),
    build: agentFromPrompt(buildPrompt, {
      description: "Executes a written plan. Runs tests inline, gates completion on QA review.",
      mode: "all",
      model: "anthropic/claude-sonnet-4-6",
      temperature: 0.1,
      permission: BUILD_PERMISSIONS as AgentConfig["permission"],
    }),

    // Subagents — model/mode/description from frontmatter, permissions
    // via overrides (see permission blocks above). docs-maintainer has no
    // frontmatter permission declaration and keeps that behavior.
    "spec-reviewer": agentFromPrompt(specReviewerPrompt, {
      permission: SPEC_REVIEWER_PERMISSIONS as AgentConfig["permission"],
    }),
    "code-reviewer": agentFromPrompt(codeReviewerPrompt, {
      permission: CODE_REVIEWER_PERMISSIONS as AgentConfig["permission"],
    }),
    "code-reviewer-thorough": agentFromPrompt(codeReviewerThoroughPrompt, {
      permission: CODE_REVIEWER_THOROUGH_PERMISSIONS as AgentConfig["permission"],
    }),
    "plan-reviewer": agentFromPrompt(planReviewerPrompt, {
      permission: PLAN_REVIEWER_PERMISSIONS as AgentConfig["permission"],
    }),
    "code-searcher": agentFromPrompt(codeSearcherPrompt, {
      permission: CODE_SEARCHER_PERMISSIONS as AgentConfig["permission"],
    }),
    "gap-analyzer": agentFromPrompt(gapAnalyzerPrompt, {
      permission: GAP_ANALYZER_PERMISSIONS as AgentConfig["permission"],
    }),
    "architecture-advisor": agentFromPrompt(architectureAdvisorPrompt, {
      permission: ARCHITECTURE_ADVISOR_PERMISSIONS as AgentConfig["permission"],
    }),
    "docs-maintainer": agentFromPrompt(docsMaintainerPrompt),
    "lib-reader": agentFromPrompt(libReaderPrompt, {
      permission: LIB_READER_PERMISSIONS as AgentConfig["permission"],
    }),
    "agents-md-writer": agentFromPrompt(agentsMdWriterPrompt, {
      permission: AGENTS_MD_WRITER_PERMISSIONS as AgentConfig["permission"],
    }),

    // Research agent — mode:all for both primary invocation and task-tool dispatch
    research: agentFromPrompt(researchPrompt, {
      description: "Research orchestrator — decomposes a research query into parallel workstreams, dispatches research skills (research / research-web / research-local / research-auto) as subagents, reviews findings for gaps, iterates, and synthesizes. Use when the user asks to investigate, explore, deep-dive, or understand a complex topic that needs multiple workstreams.",
      mode: "all",
      model: "anthropic/claude-opus-4-7",
      temperature: 0.3,
      // @research dispatches @research-web, @research-local, @research-auto.
      tools: { task: true },
      permission: RESEARCH_PERMISSIONS as AgentConfig["permission"],
    }),

    // Research subagents — thin shims that load the bundled skills.
    // mode: "subagent" — these are internal implementation details of
    // @research's orchestration; users should invoke @research (mode:all)
    // as the primary entry point, not these directly.
    "research-web": agentFromPrompt(researchWebPrompt, {
      description: "Research orchestrator subagent — Multi-agent web research orchestrator. Decomposes a research question into parallel agent workstreams, launches them, monitors progress, and synthesizes results. Use when user says 'research this topic', 'I need to understand', 'deep dive into', 'investigate the market for', 'what do we know about'. Provide the research topic and context.",
      mode: "subagent",
      model: "anthropic/claude-opus-4-7",
      temperature: 0.3,
      // @research-web dispatches its own parallel workstream agents.
      tools: { task: true },
      permission: RESEARCH_PERMISSIONS as AgentConfig["permission"],
    }),
    "research-local": agentFromPrompt(researchLocalPrompt, {
      description: "Research orchestrator subagent — Deep codebase research using parallel Explore subagents. Decomposes a question about the local codebase into research tasks, launches parallel explorations, reviews for gaps, iterates, and synthesizes findings with specific file paths and line numbers. Use when user says 'how does X work in this codebase', 'where is Y implemented', 'trace the data flow for Z', 'what patterns does this repo use', 'explain the architecture of'. Provide the research topic as arguments.",
      mode: "subagent",
      model: "anthropic/claude-opus-4-7",
      temperature: 0.3,
      // @research-local dispatches parallel Explore subagents.
      tools: { task: true },
      permission: RESEARCH_PERMISSIONS as AgentConfig["permission"],
    }),
    "research-auto": agentFromPrompt(researchAutoPrompt, {
      description: "Research orchestrator subagent — Autonomous experimentation skill. Agent interviews the user, sets up a lab, then explores freely (think, test, reflect) until stopped or a target is hit. Works for any domain where you can measure or evaluate a result. Use when user says 'optimize this', 'experiment with', 'find the best approach', 'iterate on', 'research mode'. Do NOT use for binary validation tests (use /spec-lab instead). Based on ResearcherSkill v1.4.4 by krzysztofdudek.",
      mode: "subagent",
      model: "anthropic/claude-opus-4-7",
      temperature: 0.3,
      permission: RESEARCH_PERMISSIONS as AgentConfig["permission"],
    }),

    // Debriefer — post-run summary agent for the autopilot CLI
    debriefer: agentFromPrompt(debrieferPrompt, {
      permission: DEBRIEFER_PERMISSIONS as AgentConfig["permission"],
    }),

  };
}
