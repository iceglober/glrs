// pilot-build-classify.test.ts — unit tests for the failure classifier.
//
// All tests use fixture inputs and mock LLM responses — no real API calls.

import { describe, test, expect } from "bun:test";
import {
  classifyFailure,
  type ClassifyInput,
  type ClassifyLLMClient,
  type FailureClass,
} from "../src/pilot/build/classify.js";

// --- Helpers ----------------------------------------------------------------

function makeInput(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    command: overrides.command ?? "bun test",
    exitCode: overrides.exitCode ?? 1,
    output: overrides.output ?? "test failed",
  };
}

// --- Transient failures -----------------------------------------------------

describe("classifyFailure — transient", () => {
  test("classifies ECONNRESET as transient", async () => {
    const result = await classifyFailure(
      makeInput({ output: "Error: read ECONNRESET\n  at Socket.ondata" }),
    );
    expect(result.failureClass).toBe("transient");
    expect(result.method).toBe("heuristic");
  });

  test("classifies ECONNREFUSED as transient", async () => {
    const result = await classifyFailure(
      makeInput({ output: "connect ECONNREFUSED 127.0.0.1:5432" }),
    );
    expect(result.failureClass).toBe("transient");
    expect(result.method).toBe("heuristic");
  });

  test("classifies ETIMEDOUT as transient", async () => {
    const result = await classifyFailure(
      makeInput({ output: "Error: ETIMEDOUT" }),
    );
    expect(result.failureClass).toBe("transient");
    expect(result.method).toBe("heuristic");
  });

  test("classifies socket hang up as transient", async () => {
    const result = await classifyFailure(
      makeInput({ output: "Error: socket hang up" }),
    );
    expect(result.failureClass).toBe("transient");
    expect(result.method).toBe("heuristic");
  });

  test("classifies exit code 124 (timeout) as transient", async () => {
    const result = await classifyFailure(
      makeInput({ exitCode: 124, output: "Command timed out after 30s" }),
    );
    expect(result.failureClass).toBe("transient");
    expect(result.method).toBe("heuristic");
  });
});

// --- Environmental failures -------------------------------------------------

describe("classifyFailure — environmental", () => {
  test("classifies missing binary as environmental", async () => {
    const result = await classifyFailure(
      makeInput({ output: "bun: command not found" }),
    );
    expect(result.failureClass).toBe("environmental");
    expect(result.method).toBe("heuristic");
  });

  test("classifies ENOENT as environmental", async () => {
    const result = await classifyFailure(
      makeInput({ output: "Error: ENOENT: no such file or directory, open '/app/dist/index.js'" }),
    );
    expect(result.failureClass).toBe("environmental");
    expect(result.method).toBe("heuristic");
  });

  test("classifies module not found as environmental", async () => {
    const result = await classifyFailure(
      makeInput({ output: "Cannot find module '@prisma/client'" }),
    );
    expect(result.failureClass).toBe("environmental");
    expect(result.method).toBe("heuristic");
  });

  test("classifies port in use as environmental", async () => {
    const result = await classifyFailure(
      makeInput({ output: "Error: listen EADDRINUSE: address already in use :::3000" }),
    );
    expect(result.failureClass).toBe("environmental");
    expect(result.method).toBe("heuristic");
  });

  test("classifies exit code 127 (command not found) as environmental", async () => {
    const result = await classifyFailure(
      makeInput({ exitCode: 127, output: "sh: 1: prisma: not found" }),
    );
    expect(result.failureClass).toBe("environmental");
    expect(result.method).toBe("heuristic");
  });

  test("classifies commit failure (pre-commit hook) as environmental", async () => {
    const result = await classifyFailure(
      makeInput({
        command: "git commit (pre-commit hook)",
        output: "lint-staged found errors",
      }),
    );
    expect(result.failureClass).toBe("environmental");
    expect(result.method).toBe("heuristic");
  });
});

// --- Logical failures -------------------------------------------------------

describe("classifyFailure — logical", () => {
  test("classifies test assertion failure as logical", async () => {
    const result = await classifyFailure(
      makeInput({
        output: "expect(received).toBe(expected)\n  Expected: 42\n  Received: 0",
      }),
    );
    expect(result.failureClass).toBe("logical");
    expect(result.method).toBe("heuristic");
  });

  test("classifies TypeScript type error as logical", async () => {
    const result = await classifyFailure(
      makeInput({
        output: "src/foo.ts(12,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
      }),
    );
    expect(result.failureClass).toBe("logical");
    expect(result.method).toBe("heuristic");
  });

  test("classifies SyntaxError as logical", async () => {
    const result = await classifyFailure(
      makeInput({ output: "SyntaxError: Unexpected token '}'" }),
    );
    expect(result.failureClass).toBe("logical");
    expect(result.method).toBe("heuristic");
  });

  test("classifies FAIL prefix as logical", async () => {
    const result = await classifyFailure(
      makeInput({ output: "FAIL test/api.test.ts\n  ● test suite failed to run" }),
    );
    expect(result.failureClass).toBe("logical");
    expect(result.method).toBe("heuristic");
  });
});

// --- Plan-divergent failures ------------------------------------------------

describe("classifyFailure — plan-divergent", () => {
  test("classifies scope-violation hint as plan-divergent", async () => {
    const result = await classifyFailure(
      makeInput({ output: "out-of-scope edits detected: src/unrelated.ts" }),
    );
    expect(result.failureClass).toBe("plan-divergent");
    expect(result.method).toBe("heuristic");
  });

  test("classifies touches violation as plan-divergent", async () => {
    const result = await classifyFailure(
      makeInput({ output: "touches violation: src/other.ts is outside declared scope" }),
    );
    expect(result.failureClass).toBe("plan-divergent");
    expect(result.method).toBe("heuristic");
  });

  test("classifies STOP signal as plan-divergent", async () => {
    const result = await classifyFailure(
      makeInput({ output: "STOP: contradictory requirements — cannot implement X without Y" }),
    );
    expect(result.failureClass).toBe("plan-divergent");
    expect(result.method).toBe("heuristic");
  });
});

// --- Budget failures --------------------------------------------------------

describe("classifyFailure — budget", () => {
  test("classifies cost-exceeded as budget", async () => {
    const result = await classifyFailure(
      makeInput({ output: "cost exceeded: $5.23 > $5.00 max_cost_usd" }),
    );
    expect(result.failureClass).toBe("budget");
    expect(result.method).toBe("heuristic");
  });

  test("classifies turn limit as budget", async () => {
    const result = await classifyFailure(
      makeInput({ output: "turn limit reached: 50/50 max_turns" }),
    );
    expect(result.failureClass).toBe("budget");
    expect(result.method).toBe("heuristic");
  });
});

// --- LLM fallback -----------------------------------------------------------

describe("classifyFailure — LLM fallback", () => {
  test("falls back to LLM for ambiguous output", async () => {
    const mockLLM: ClassifyLLMClient = {
      classify: async (_input) => "environmental" as FailureClass,
    };
    const result = await classifyFailure(
      makeInput({ output: "something completely ambiguous with no known patterns" }),
      mockLLM,
    );
    expect(result.failureClass).toBe("environmental");
    expect(result.method).toBe("llm");
  });

  test("falls back to default (logical) when LLM returns null", async () => {
    const mockLLM: ClassifyLLMClient = {
      classify: async () => null,
    };
    const result = await classifyFailure(
      makeInput({ output: "something completely ambiguous" }),
      mockLLM,
    );
    expect(result.failureClass).toBe("logical");
    expect(result.method).toBe("default");
  });

  test("falls back to default (logical) when LLM throws", async () => {
    const mockLLM: ClassifyLLMClient = {
      classify: async () => {
        throw new Error("LLM unavailable");
      },
    };
    const result = await classifyFailure(
      makeInput({ output: "something completely ambiguous" }),
      mockLLM,
    );
    expect(result.failureClass).toBe("logical");
    expect(result.method).toBe("default");
  });

  test("does not call LLM when heuristic matches", async () => {
    let called = false;
    const mockLLM: ClassifyLLMClient = {
      classify: async () => {
        called = true;
        return "transient" as FailureClass;
      },
    };
    await classifyFailure(
      makeInput({ output: "ECONNRESET" }),
      mockLLM,
    );
    expect(called).toBe(false);
  });

  test("falls back to default (logical) when no LLM provided and no heuristic matches", async () => {
    const result = await classifyFailure(
      makeInput({ output: "something completely ambiguous with no known patterns" }),
    );
    expect(result.failureClass).toBe("logical");
    expect(result.method).toBe("default");
  });
});

// --- ANSI stripping ---------------------------------------------------------

describe("classifyFailure — ANSI stripping", () => {
  test("strips ANSI codes before matching", async () => {
    // ANSI-colored ECONNRESET output
    const result = await classifyFailure(
      makeInput({ output: "\x1b[31mError: read ECONNRESET\x1b[0m" }),
    );
    expect(result.failureClass).toBe("transient");
  });
});
