/**
 * Fixture manifest — the contract every eval task ships.
 *
 * A fixture directory looks like:
 *
 *   fixtures/<name>/
 *     manifest.json        — this schema
 *     task.md              — the prompt given to the agent (verbatim)
 *     ground-truth.md      — what a correct run contains (fed ONLY to evaluators)
 *     rubric.json          — criteria/weights/scale for blind scoring
 *     linear/              — optional: frozen tracker data for the mock Linear MCP
 *       issues/<ID>.json
 *       comments/<ID>.json
 *       search-index.json
 *
 * Hermeticity rules the runner enforces:
 *   - the workspace repo is pinned (repo.ref checked out into a throwaway worktree)
 *   - tracker access goes through the fixture-backed mock MCP, never the real one
 *   - mutations (mock-tracker writes, git pushes) are recorded, not performed
 */

export interface RubricCriterion {
  key: string;
  weight: number;
  /** One-sentence definition shown to evaluators. */
  definition: string;
}

export interface Rubric {
  scaleMax: number;
  criteria: RubricCriterion[];
}

export interface FixtureManifest {
  name: string;
  /** One line shown in reports. */
  summary: string;
  /** Task shape tag for slicing results: triage | bugfix | feature | question | refactor. */
  shape: string;
  repo: {
    /** "glrs" (this repo) or an absolute path to another local repo. */
    source: string;
    /** Commit/ref to pin the eval worktree at. */
    ref: string;
    /** Commands to run in the worktree after checkout (e.g. revert a fix). */
    setup?: string[];
  };
  /** Hard wall-clock budget per run, minutes. */
  budgetMin: number;
  /** Register the fixture-backed mock Linear MCP for this run. */
  mockLinear: boolean;
  /** Extra tool-name globs to deny beyond the default mutation set. */
  extraDenyTools?: string[];
  /** Deterministic assertions evaluated by the runner (not the panel). */
  checks?: {
    /** Fail the run outright if any real mutation escaped (always on). */
    requireFinalAnswer?: boolean;
    /** Grep patterns that MUST appear in the final answer (case-insensitive). */
    finalAnswerMustMatch?: string[];
    /** Shell command run in the worktree post-run; exit 0 = pass (e.g. bun test for bugfix fixtures). */
    verifyCommand?: string;
  };
}

export function validateManifest(m: unknown): asserts m is FixtureManifest {
  const o = m as Partial<FixtureManifest>;
  const fail: (msg: string) => never = (msg) => {
    throw new Error(`manifest invalid: ${msg}`);
  };
  if (!o || typeof o !== "object") fail("not an object");
  if (!o.name || !/^[a-z0-9-]+$/.test(o.name)) fail("name must be kebab-case");
  if (!o.summary) fail("summary required");
  if (!o.shape) fail("shape required");
  if (!o.repo || !o.repo.source || !o.repo.ref) fail("repo.source and repo.ref required");
  if (typeof o.budgetMin !== "number" || o.budgetMin <= 0) fail("budgetMin must be > 0");
  if (typeof o.mockLinear !== "boolean") fail("mockLinear must be boolean");
}

export function validateRubric(r: unknown): asserts r is Rubric {
  const o = r as Partial<Rubric>;
  const fail: (msg: string) => never = (msg) => {
    throw new Error(`rubric invalid: ${msg}`);
  };
  if (!o || typeof o !== "object") fail("not an object");
  if (typeof o.scaleMax !== "number" || o.scaleMax < 2) fail("scaleMax must be >= 2");
  if (!Array.isArray(o.criteria) || o.criteria.length === 0) fail("criteria required");
  let total = 0;
  for (const c of o.criteria) {
    if (!c.key || typeof c.weight !== "number" || !c.definition) {
      fail(`criterion needs key/weight/definition (got ${JSON.stringify(c)})`);
    }
    total += c.weight;
  }
  if (Math.abs(total - 1) > 1e-6) fail(`criterion weights must sum to 1 (got ${total})`);
}
