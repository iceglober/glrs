/**
 * @glrs-dev/agent-core — framework-agnostic single source of truth for
 * agent identity.
 *
 * Every agent name string lives here exactly once. The OpenCode harness
 * (`createAgents`, config-hook, dispatch plugins), a future
 * harness-plugin-claude-code, the CLI adapters, autopilot, and the docs
 * generator (`bun run gen-docs`) all import from this package. Renaming an
 * agent is a single edit to the value below plus an IDE rename-symbol.
 *
 * This module is intentionally dependency-free and side-effect-free (no
 * prompt-file reads, no framework SDK imports) so any consumer can import
 * the data without pulling in a specific harness's machinery. It is the
 * portable layer; framework-specific agent *config* (permissions, prompt
 * wiring, AgentConfig shape) stays in each plugin package.
 */

/** Canonical agent identifiers. Declaration order matches the docs-site
 * agent-table order so the generator can filter by category in place. */
export const AGENTS = {
  // User-selectable (mode primary or all)
  PRIME: "prime",
  PRIME_HEAVY: "prime-heavy",
  DESIGNER: "designer",
  RESEARCH: "research",
  // Subagents (dispatched, not user-picked). plan/build/scoper lead this group:
  // they're prominent, directly @mentionable, but no longer in the primary picker.
  PLAN: "plan",
  BUILD: "build",
  SCOPER: "scoper",
  CODE_REVIEWER: "code-reviewer",
  CODE_REVIEWER_THOROUGH: "code-reviewer-thorough",
  SPEC_REVIEWER: "spec-reviewer",
  PLAN_REVIEWER: "plan-reviewer",
  PLAN_ULTRA: "plan-ultra",
  GAP_ANALYZER: "gap-analyzer",
  ARCHITECTURE_ADVISOR: "architecture-advisor",
  ORACLE: "oracle",
  CODE_SEARCHER: "code-searcher",
  DOCS_MAINTAINER: "docs-maintainer",
  LIB_READER: "lib-reader",
  AGENTS_MD_WRITER: "agents-md-writer",
  DEBRIEFER: "debriefer",
  RESEARCH_WEB: "research-web",
  RESEARCH_LOCAL: "research-local",
  RESEARCH_AUTO: "research-auto",
  // Autopilot-only (not user-selectable; driven by the Ralph loop)
  AUTOPILOT_PRIME: "autopilot-prime",
  AUTOPILOT_FAST: "autopilot-fast",
  // Cost-optimized variants (automatic cost cascading)
  BUILD_CHEAP: "build-cheap",
  BUILD_DEEP: "build-deep",
  PLAN_ULTRA_CHEAP: "plan-ultra-cheap",
} as const;

/** Union of every valid agent name. */
export type AgentName = (typeof AGENTS)[keyof typeof AGENTS];

/** All agent names, in docs-table order. */
export const AGENT_NAMES = Object.values(AGENTS) as AgentName[];

// ---- Tier map ----

export type ModelTier =
  | "deep"
  | "mid"
  | "mid-execute"
  | "autopilot-execute"
  | "fast"
  | "cheap";

/**
 * Maps every agent name to its model tier. Used by the harness.models
 * config resolution in src/config-hook.ts.
 *
 * - deep:        expensive, high-capability models (opus-class)
 * - mid:         balanced cost/capability, reasoning builder (sonnet-class)
 * - mid-execute: optional strict executor tier — narrower prompts, no
 *                self-correction, escalation-first. Falls back to `mid`
 *                if not configured.
 * - autopilot-execute: fast executor for autopilot --fast sessions. Falls
 *                back to mid-execute → mid.
 * - fast:        cheap, low-latency (haiku-class)
 * - cheap:       very cheap cascading tier (GLM 4.7 Flash via Bedrock).
 *                Falls back to fast if not configured.
 *
 * Adding an agent to createAgents() without adding it here will fail
 * the AGENT_TIERS completeness test — that's intentional.
 */
export const AGENT_TIERS: Record<AgentName, ModelTier> = {
  // Standard series — Opus orchestration (promoted from former ultra)
  prime: "mid-execute",
  plan: "deep",
  // Ultra series — cost-optimized (Sonnet orchestration, Opus for planning only)
  "prime-heavy": "deep",
  "plan-ultra": "deep",
  "plan-ultra-cheap": "cheap",
  // Shared agents
  scoper: "deep",
  "autopilot-prime": "deep",
  "autopilot-fast": "autopilot-execute",
  "architecture-advisor": "deep",
  oracle: "deep",
  "plan-reviewer": "mid",
  "gap-analyzer": "mid",
  research: "deep",
  "research-web": "deep",
  "research-local": "deep",
  "research-auto": "deep",
  build: "mid-execute",
  "build-cheap": "cheap",
  "build-deep": "deep",
  "spec-reviewer": "mid-execute",
  "code-reviewer": "mid-execute",
  "code-reviewer-thorough": "deep",
  "docs-maintainer": "mid",
  "lib-reader": "mid",
  "agents-md-writer": "mid",
  debriefer: "mid",
  designer: "mid",
  "code-searcher": "fast",
};

/**
 * The set of agents that ship a strict-executor prompt variant, used when
 * the agent is assigned to the `mid-execute` tier with an explicitly
 * configured executor model. config-hook reads this when swapping prompts.
 */
export const EXECUTOR_VARIANT_AGENT_NAMES: AgentName[] = [
  AGENTS.BUILD,
  AGENTS.SPEC_REVIEWER,
  AGENTS.CODE_REVIEWER,
];

// ---- Documentation metadata ----
// Curated, presentation-facing data the docs generator (scripts/gen-docs.ts)
// consumes. Kept here so a rename touches one file and the docs-site agent
// table regenerates in sync. The `role` text is the short doc-table blurb,
// distinct from the verbose runtime `description` in createAgents().

export type AgentCategory =
  | "user-selectable"
  | "subagent"
  | "autopilot"
  | "cost-variant";

export interface AgentDocMeta {
  category: AgentCategory;
  /** Short role blurb for the docs-site agent table (may contain markdown). */
  role: string;
  /** For cost-variant agents: the base agent they derive from. */
  base?: AgentName;
}

export const AGENT_DOC_META: Record<AgentName, AgentDocMeta> = {
  prime: {
    category: "user-selectable",
    role: "[SPEAR](https://www.edge.ceo/p/introducing-spear-the-management) end-to-end workflow (default). Sonnet orchestrator — delegates planning to Opus and hard problems to @build-deep.",
  },
  "prime-heavy": {
    category: "user-selectable",
    role: "PRIME on Opus. Use when the task itself needs deep reasoning at the orchestration level.",
  },
  plan: {
    category: "subagent",
    role: "Interactive planner with gap analysis (DAG-based). Dispatched by @prime; invoke directly via @plan.",
  },
  build: {
    category: "subagent",
    role: "Plan executor. @prime's Execute stage delegates here; invoke directly via @build.",
  },
  scoper: {
    category: "subagent",
    role: "Codebase scoping and context gathering. Dispatched by @prime / the scoper wizard; invoke via @scoper.",
  },
  designer: { category: "user-selectable", role: "UI/UX design" },
  research: {
    category: "user-selectable",
    role: "Multi-workstream research orchestrator",
  },
  "code-reviewer": { category: "subagent", role: "Adversarial code review" },
  "code-reviewer-thorough": {
    category: "subagent",
    role: "Full-suite adversarial review",
  },
  "spec-reviewer": {
    category: "subagent",
    role: "Spec and requirements review",
  },
  "plan-reviewer": { category: "subagent", role: "Adversarial plan review" },
  "plan-ultra": {
    category: "subagent",
    role: "DAG planner for wave-based dispatch",
  },
  "gap-analyzer": { category: "subagent", role: "Identifies gaps in plans" },
  "architecture-advisor": {
    category: "subagent",
    role: "Architecture guidance",
  },
  oracle: {
    category: "subagent",
    role: "Bounded deep-reasoning consult — one hard question, ~5 tool calls, direct answer with evidence",
  },
  "code-searcher": { category: "subagent", role: "Codebase search" },
  "docs-maintainer": { category: "subagent", role: "Documentation updates" },
  "lib-reader": { category: "subagent", role: "Library/dependency reader" },
  "agents-md-writer": { category: "subagent", role: "AGENTS.md generation" },
  debriefer: { category: "subagent", role: "Post-run summary" },
  "research-web": { category: "subagent", role: "Web search subagent" },
  "research-local": {
    category: "subagent",
    role: "Local codebase exploration subagent",
  },
  "research-auto": {
    category: "subagent",
    role: "Auto-selecting research subagent",
  },
  "autopilot-prime": {
    category: "autopilot",
    role: "PRIME without question [tool](/harness/tools)",
  },
  "autopilot-fast": {
    category: "autopilot",
    role: "Fast executor for `--fast` sessions",
  },
  "build-cheap": { category: "cost-variant", role: "", base: "build" },
  "build-deep": { category: "cost-variant", role: "", base: "build" },
  "plan-ultra-cheap": {
    category: "cost-variant",
    role: "",
    base: "plan-ultra",
  },
};

/**
 * Collapse internal execution tiers to the user-facing tier shown in the
 * docs-site agent table. `mid-execute` and `autopilot-execute` are
 * implementation tiers that resolve to a Sonnet-class (`mid`) model.
 */
export function displayTier(tier: ModelTier): "deep" | "mid" | "fast" | "cheap" {
  if (tier === "mid-execute" || tier === "autopilot-execute") return "mid";
  return tier;
}
