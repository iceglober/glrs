// pilot-build-diversify.test.ts — unit tests for the diversification ladder.
//
// Pure function tests — no I/O, no mocks needed.

import { describe, test, expect } from "bun:test";
import {
  computeDiversify,
  type DiversifyInput,
  type DiversifyMode,
} from "../src/pilot/build/diversify.js";
import type { FailureClass } from "../src/pilot/build/classify.js";

// --- Helpers ----------------------------------------------------------------

function makeInput(overrides: Partial<DiversifyInput> = {}): DiversifyInput {
  return {
    attempt: overrides.attempt ?? 1,
    maxAttempts: overrides.maxAttempts ?? 5,
    failureClass: overrides.failureClass ?? "logical",
    mode: overrides.mode ?? "standard",
  };
}

// --- none mode --------------------------------------------------------------

describe("computeDiversify — none mode", () => {
  test("none mode returns same-strategy for all attempts", () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = computeDiversify(makeInput({ attempt, mode: "none" }));
      expect(result.action).toBe("same-strategy");
      expect(result.runCritic).toBe(false);
      expect(result.useAltModel).toBe(false);
      expect(result.freshSubagent).toBe(false);
    }
  });

  test("none mode returns same-strategy for all failure classes", () => {
    const classes: FailureClass[] = [
      "transient",
      "environmental",
      "logical",
      "plan-divergent",
      "budget",
    ];
    for (const failureClass of classes) {
      const result = computeDiversify(makeInput({ mode: "none", failureClass }));
      expect(result.action).toBe("same-strategy");
    }
  });
});

// --- standard mode ----------------------------------------------------------

describe("computeDiversify — standard mode", () => {
  test("standard mode escalates through critic then narrow-scope", () => {
    const attempt1 = computeDiversify(makeInput({ attempt: 1, mode: "standard" }));
    expect(attempt1.action).toBe("same-strategy");
    expect(attempt1.runCritic).toBe(false);

    const attempt2 = computeDiversify(makeInput({ attempt: 2, mode: "standard" }));
    expect(attempt2.action).toBe("run-critic");
    expect(attempt2.runCritic).toBe(true);

    const attempt3 = computeDiversify(makeInput({ attempt: 3, mode: "standard" }));
    expect(attempt3.action).toBe("narrow-scope");
    expect(attempt3.runCritic).toBe(true);

    const attempt4 = computeDiversify(makeInput({ attempt: 4, mode: "standard" }));
    expect(attempt4.action).toBe("narrow-scope");
    expect(attempt4.runCritic).toBe(true);
  });

  test("standard mode does not reach model-swap or fresh-subagent", () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const result = computeDiversify(makeInput({ attempt, mode: "standard" }));
      expect(result.action).not.toBe("model-swap");
      expect(result.action).not.toBe("fresh-subagent");
      expect(result.useAltModel).toBe(false);
      expect(result.freshSubagent).toBe(false);
    }
  });

  test("transient failures skip critic step in standard mode", () => {
    const result = computeDiversify(
      makeInput({ attempt: 2, mode: "standard", failureClass: "transient" }),
    );
    expect(result.action).toBe("same-strategy");
    expect(result.runCritic).toBe(false);
  });
});

// --- aggressive mode --------------------------------------------------------

describe("computeDiversify — aggressive mode", () => {
  test("aggressive mode reaches model-swap and fresh-subagent", () => {
    const attempt1 = computeDiversify(makeInput({ attempt: 1, mode: "aggressive" }));
    expect(attempt1.action).toBe("same-strategy");

    const attempt2 = computeDiversify(makeInput({ attempt: 2, mode: "aggressive" }));
    expect(attempt2.action).toBe("run-critic");
    expect(attempt2.runCritic).toBe(true);

    const attempt3 = computeDiversify(makeInput({ attempt: 3, mode: "aggressive" }));
    expect(attempt3.action).toBe("narrow-scope");
    expect(attempt3.runCritic).toBe(true);

    const attempt4 = computeDiversify(makeInput({ attempt: 4, mode: "aggressive" }));
    expect(attempt4.action).toBe("model-swap");
    expect(attempt4.useAltModel).toBe(true);
    expect(attempt4.runCritic).toBe(false);

    const attempt5 = computeDiversify(makeInput({ attempt: 5, mode: "aggressive" }));
    expect(attempt5.action).toBe("fresh-subagent");
    expect(attempt5.freshSubagent).toBe(true);

    const attempt6 = computeDiversify(makeInput({ attempt: 6, mode: "aggressive" }));
    expect(attempt6.action).toBe("fresh-subagent");
    expect(attempt6.freshSubagent).toBe(true);
  });

  test("transient failures skip critic step in aggressive mode", () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = computeDiversify(
        makeInput({ attempt, mode: "aggressive", failureClass: "transient" }),
      );
      expect(result.action).toBe("same-strategy");
      expect(result.runCritic).toBe(false);
    }
  });
});

// --- Transient skip ---------------------------------------------------------

describe("computeDiversify — transient failures skip critic step", () => {
  test("transient failures skip critic step in all modes", () => {
    const modes: DiversifyMode[] = ["none", "standard", "aggressive"];
    for (const mode of modes) {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const result = computeDiversify(
          makeInput({ attempt, mode, failureClass: "transient" }),
        );
        expect(result.runCritic).toBe(false);
        expect(result.useAltModel).toBe(false);
        expect(result.freshSubagent).toBe(false);
      }
    }
  });
});

// --- Result shape -----------------------------------------------------------

describe("computeDiversify — result shape invariants", () => {
  test("runCritic is true iff action is run-critic or narrow-scope", () => {
    const modes: DiversifyMode[] = ["none", "standard", "aggressive"];
    const classes: FailureClass[] = ["transient", "environmental", "logical", "plan-divergent", "budget"];
    for (const mode of modes) {
      for (const failureClass of classes) {
        for (let attempt = 1; attempt <= 5; attempt++) {
          const result = computeDiversify(makeInput({ attempt, mode, failureClass }));
          const expectCritic = result.action === "run-critic" || result.action === "narrow-scope";
          expect(result.runCritic).toBe(expectCritic);
        }
      }
    }
  });

  test("useAltModel is true iff action is model-swap", () => {
    const result = computeDiversify(makeInput({ attempt: 4, mode: "aggressive" }));
    expect(result.action).toBe("model-swap");
    expect(result.useAltModel).toBe(true);
  });

  test("freshSubagent is true iff action is fresh-subagent", () => {
    const result = computeDiversify(makeInput({ attempt: 5, mode: "aggressive" }));
    expect(result.action).toBe("fresh-subagent");
    expect(result.freshSubagent).toBe(true);
  });
});
