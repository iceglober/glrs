/**
 * classify.ts — failure classifier for the pilot retry engine.
 *
 * Maps raw verify-command output to a `FailureClass` that drives downstream
 * retry decisions:
 *
 *   transient       → retry immediately, no critic needed
 *   environmental   → retry with critic; likely a missing tool/dep/env issue
 *   logical         → retry with critic; agent made a wrong code change
 *   plan-divergent  → retry with critic; task scope may be wrong
 *   budget          → trip circuit breaker immediately
 *
 * Classification is heuristic-first (pattern matching on output strings).
 * An optional LLM fallback handles ambiguous cases when a client is provided.
 *
 * All heuristics are pure functions — no I/O, no side effects.
 */

// --- Types ------------------------------------------------------------------

/**
 * The five failure classes the retry engine understands.
 *
 *   transient      — network blip, flaky test, race condition. Retry immediately.
 *   environmental  — missing binary, wrong Node version, missing env var.
 *                    Retry with critic; may need agent to fix setup.
 *   logical        — test assertion failure, type error, wrong output.
 *                    Retry with critic; agent needs targeted fix guidance.
 *   plan-divergent — scope violation hint, contradictory requirements.
 *                    Retry with critic; may need plan-level intervention.
 *   budget         — cost exceeded, turn limit hit. Trip circuit breaker.
 */
export type FailureClass =
  | "transient"
  | "environmental"
  | "logical"
  | "plan-divergent"
  | "budget";

/**
 * Input to the classifier. Mirrors the shape of a verify failure from
 * `RunVerifyResult` plus the commit-failure path in worker.ts.
 */
export interface ClassifyInput {
  /** The command that failed (e.g. `bun test`, `git commit (pre-commit hook)`). */
  command: string;
  /** Exit code from the command. */
  exitCode: number;
  /**
   * Combined stdout+stderr output. The classifier only reads the first
   * 4096 bytes for heuristics — callers need not pre-truncate.
   */
  output: string;
}

/**
 * Optional LLM client interface for the fallback path.
 * Injected as a dependency so tests can mock it without real API calls.
 */
export interface ClassifyLLMClient {
  /**
   * Ask the LLM to classify the failure. Returns one of the five
   * FailureClass strings, or null if the call fails/times out.
   */
  classify(input: ClassifyInput): Promise<FailureClass | null>;
}

/**
 * Result of classification.
 */
export interface ClassifyResult {
  /** The assigned failure class. */
  failureClass: FailureClass;
  /**
   * How the classification was determined.
   *   heuristic — matched a pattern rule
   *   llm       — LLM fallback was used
   *   default   — fell through to the default (logical)
   */
  method: "heuristic" | "llm" | "default";
  /** The heuristic rule name that matched, if method === "heuristic". */
  matchedRule?: string;
}

// --- Heuristic rules --------------------------------------------------------

interface HeuristicRule {
  name: string;
  failureClass: FailureClass;
  /** Test the combined output (lowercased) and/or command. */
  test: (output: string, command: string, exitCode: number) => boolean;
}

/**
 * Ordered list of heuristic rules. First match wins.
 *
 * Rules are ordered from most-specific to least-specific to avoid
 * false positives (e.g. "budget" before "transient" so a cost-exceeded
 * message isn't misclassified as a network error).
 */
const HEURISTIC_RULES: HeuristicRule[] = [
  // --- Budget ---------------------------------------------------------------
  {
    name: "cost-exceeded",
    failureClass: "budget",
    test: (out) =>
      /cost.{0,30}exceeded|budget.{0,30}exceeded|max.{0,20}cost|spending.{0,20}limit/i.test(out),
  },
  {
    name: "turn-limit",
    failureClass: "budget",
    test: (out) =>
      /turn.{0,20}limit|max.{0,20}turns|exceeded.{0,20}turn/i.test(out),
  },

  // --- Plan-divergent -------------------------------------------------------
  {
    name: "scope-violation-hint",
    failureClass: "plan-divergent",
    test: (out) =>
      /out.of.scope|scope.violation|touches.violation|contradictory.{0,30}require|cannot.{0,30}implement.{0,30}without/i.test(
        out,
      ),
  },
  {
    name: "stop-signal",
    failureClass: "plan-divergent",
    test: (out) => /^STOP:/m.test(out),
  },

  // --- Environmental --------------------------------------------------------
  {
    name: "missing-binary",
    failureClass: "environmental",
    test: (out) =>
      /command not found|no such file or directory|ENOENT|not found: \w|cannot find module|module not found/i.test(
        out,
      ),
  },
  {
    name: "missing-env-var",
    failureClass: "environmental",
    test: (out) =>
      /missing.{0,30}env|env.{0,30}not.{0,20}set|required.{0,30}environment|DATABASE_URL.{0,30}not|API_KEY.{0,30}not/i.test(
        out,
      ),
  },
  {
    name: "port-in-use",
    failureClass: "environmental",
    test: (out) =>
      /EADDRINUSE|address already in use|port.{0,20}in use/i.test(out),
  },
  {
    name: "permission-denied",
    failureClass: "environmental",
    test: (out, _cmd, exitCode) =>
      exitCode === 126 ||
      exitCode === 127 ||
      /permission denied|EACCES/i.test(out),
  },
  {
    name: "commit-failure",
    failureClass: "environmental",
    test: (_out, command) =>
      /git commit|pre-commit hook/i.test(command),
  },

  // --- Transient ------------------------------------------------------------
  {
    name: "network-reset",
    failureClass: "transient",
    test: (out) =>
      /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network.{0,20}error|connection.{0,20}refused|socket hang up/i.test(
        out,
      ),
  },
  {
    name: "flaky-test",
    failureClass: "transient",
    test: (out) =>
      /flaky|intermittent|race condition|timing.{0,20}issue|retry.{0,20}attempt/i.test(
        out,
      ),
  },
  {
    name: "timeout",
    failureClass: "transient",
    test: (out, _cmd, exitCode) =>
      exitCode === 124 || /timed? out|timeout exceeded/i.test(out),
  },

  // --- Logical (catch-all for test/type failures) ---------------------------
  {
    name: "test-assertion",
    failureClass: "logical",
    test: (out) =>
      /expect\(|\.toBe\(|\.toEqual\(|AssertionError|assertion failed|test failed|FAIL\s/i.test(
        out,
      ),
  },
  {
    name: "type-error",
    failureClass: "logical",
    test: (out) =>
      /TypeScript|TS\d{4}|type error|type '.*' is not assignable|Property '.*' does not exist/i.test(
        out,
      ),
  },
  {
    name: "syntax-error",
    failureClass: "logical",
    test: (out) =>
      /SyntaxError|syntax error|unexpected token|unexpected end of/i.test(out),
  },
];

// --- Classifier function ----------------------------------------------------

/**
 * Classify a verify failure into one of five categories.
 *
 * Algorithm:
 *   1. Run heuristic rules against the first 4096 bytes of output.
 *   2. If a rule matches, return immediately.
 *   3. If an LLM client is provided, call it for ambiguous cases.
 *   4. Fall back to "logical" (the most common non-transient failure).
 *
 * @param input   The failure to classify.
 * @param llm     Optional LLM client for ambiguous cases. If omitted or if
 *                the LLM call fails, falls back to "logical".
 */
export async function classifyFailure(
  input: ClassifyInput,
  llm?: ClassifyLLMClient,
): Promise<ClassifyResult> {
  // Normalize: lowercase, strip ANSI escape codes, limit to 4096 bytes.
  const normalized = stripAnsi(input.output.slice(0, 4096)).toLowerCase();

  for (const rule of HEURISTIC_RULES) {
    if (rule.test(normalized, input.command, input.exitCode)) {
      return {
        failureClass: rule.failureClass,
        method: "heuristic",
        matchedRule: rule.name,
      };
    }
  }

  // LLM fallback for ambiguous cases.
  if (llm) {
    try {
      const result = await llm.classify(input);
      if (result !== null) {
        return { failureClass: result, method: "llm" };
      }
    } catch {
      // LLM call failed — fall through to default.
    }
  }

  return { failureClass: "logical", method: "default" };
}

// --- Helpers ----------------------------------------------------------------

/**
 * Strip ANSI escape codes from a string.
 * Covers the common SGR sequences (colors, bold, reset) and cursor movement.
 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
}
