// pilot-gates.test.ts — tests for src/pilot/gates/*.
//
// Covers the gate abstraction introduced in step 1 of the pilot
// redesign:
//   - shell gate: pass / fail / timeout / abort + evidence shape
//   - all composite: pass / first-fail-short-circuits / empty-passes
//   - any composite: first-pass-short-circuits / all-fail / empty-fails
//   - nested composites: all-of-anys, any-of-alls
//   - evidence type guards
//   - back-compat: runVerify (in verify/runner.ts) delegates correctly

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  asCompositeEvidence,
  asShellEvidence,
  evalGate,
  type Gate,
} from "../src/pilot/gates/index.js";
import { runVerify } from "../src/pilot/verify/runner.js";

// --- Fixtures --------------------------------------------------------------

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-gates-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- Shell gate ------------------------------------------------------------

describe("shell gate", () => {
  test("pass on exit 0, evidence carries CommandResult", async () => {
    const r = await evalGate(
      { kind: "shell", command: "true" },
      { cwd: tmp },
    );
    expect(r.ok).toBe(true);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    const ev = asShellEvidence(r.evidence);
    expect(ev).not.toBeNull();
    expect(ev?.kind).toBe("shell");
    expect(ev?.result.ok).toBe(true);
    if (ev?.result.ok) {
      expect(ev.result.exitCode).toBe(0);
      expect(ev.result.command).toBe("true");
    }
  });

  test("fail on non-zero exit, reason mentions exit code", async () => {
    const r = await evalGate(
      { kind: "shell", command: "exit 42" },
      { cwd: tmp },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("exit 42");
    const ev = asShellEvidence(r.evidence);
    expect(ev?.result.ok).toBe(false);
    if (ev?.result.ok === false) {
      expect(ev.result.exitCode).toBe(42);
      expect(ev.result.timedOut).toBe(false);
      expect(ev.result.aborted).toBe(false);
    }
  });

  test("timeout flag surfaces in reason and evidence", async () => {
    const r = await evalGate(
      { kind: "shell", command: "sleep 5", timeoutMs: 100 },
      { cwd: tmp },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("timed-out");
    const ev = asShellEvidence(r.evidence);
    expect(ev?.result.ok).toBe(false);
    if (ev?.result.ok === false) {
      expect(ev.result.timedOut).toBe(true);
    }
  });

  test("abort signal kills in-flight command", async () => {
    const ac = new AbortController();
    const promise = evalGate(
      { kind: "shell", command: "sleep 5" },
      { cwd: tmp, abortSignal: ac.signal },
    );
    setTimeout(() => ac.abort(), 50);
    const r = await promise;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("aborted");
    const ev = asShellEvidence(r.evidence);
    if (ev?.result.ok === false) {
      expect(ev.result.aborted).toBe(true);
    }
  });

  test("onShellLine streams output line-by-line", async () => {
    const lines: string[] = [];
    await evalGate(
      { kind: "shell", command: "echo hello; echo world" },
      {
        cwd: tmp,
        onShellLine: ({ line }) => lines.push(line),
      },
    );
    expect(lines).toContain("hello");
    expect(lines).toContain("world");
  });
});

// --- All composite ---------------------------------------------------------

describe("all composite", () => {
  test("all sub-gates pass → ok=true, evidence has every result", async () => {
    const gate: Gate = {
      kind: "all",
      gates: [
        { kind: "shell", command: "true" },
        { kind: "shell", command: "exit 0" },
        { kind: "shell", command: "echo ok" },
      ],
    };
    const r = await evalGate(gate, { cwd: tmp });
    expect(r.ok).toBe(true);
    const ev = asCompositeEvidence(r.evidence);
    expect(ev?.kind).toBe("all");
    expect(ev?.results).toHaveLength(3);
    expect(ev?.results.every((e) => e.result.ok)).toBe(true);
  });

  test("first failure short-circuits — later gates don't run", async () => {
    const sentinel = path.join(tmp, "shouldnt-exist.txt");
    const gate: Gate = {
      kind: "all",
      gates: [
        { kind: "shell", command: "true" },
        { kind: "shell", command: "exit 7" },
        { kind: "shell", command: `touch ${sentinel}` },
      ],
    };
    const r = await evalGate(gate, { cwd: tmp });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("exit 7");
    const ev = asCompositeEvidence(r.evidence);
    expect(ev?.results).toHaveLength(2); // short-circuit
    expect(ev?.failure?.ok).toBe(false);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  test("empty all-gate returns ok=true (vacuous)", async () => {
    const r = await evalGate({ kind: "all", gates: [] }, { cwd: tmp });
    expect(r.ok).toBe(true);
    const ev = asCompositeEvidence(r.evidence);
    expect(ev?.results).toHaveLength(0);
  });
});

// --- Any composite ---------------------------------------------------------

describe("any composite", () => {
  test("first pass short-circuits", async () => {
    const sentinel = path.join(tmp, "third.txt");
    const gate: Gate = {
      kind: "any",
      gates: [
        { kind: "shell", command: "exit 1" },
        { kind: "shell", command: "true" },
        { kind: "shell", command: `touch ${sentinel}` },
      ],
    };
    const r = await evalGate(gate, { cwd: tmp });
    expect(r.ok).toBe(true);
    const ev = asCompositeEvidence(r.evidence);
    expect(ev?.kind).toBe("any");
    expect(ev?.results).toHaveLength(2); // short-circuit on second
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  test("all sub-gates fail → ok=false with exhaustion reason", async () => {
    const gate: Gate = {
      kind: "any",
      gates: [
        { kind: "shell", command: "exit 1" },
        { kind: "shell", command: "exit 2" },
      ],
    };
    const r = await evalGate(gate, { cwd: tmp });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("exhausted");
    const ev = asCompositeEvidence(r.evidence);
    expect(ev?.results).toHaveLength(2);
    expect(ev?.failure?.ok).toBe(false);
  });

  test("empty any-gate fails (no sub-gate to satisfy)", async () => {
    const r = await evalGate({ kind: "any", gates: [] }, { cwd: tmp });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("no sub-gates");
  });
});

// --- Nested composites -----------------------------------------------------

describe("nested composites", () => {
  test("all-of-anys: every any-branch must have one passing sub-gate", async () => {
    const gate: Gate = {
      kind: "all",
      gates: [
        {
          kind: "any",
          gates: [
            { kind: "shell", command: "exit 1" },
            { kind: "shell", command: "true" },
          ],
        },
        {
          kind: "any",
          gates: [
            { kind: "shell", command: "exit 2" },
            { kind: "shell", command: "exit 0" },
          ],
        },
      ],
    };
    const r = await evalGate(gate, { cwd: tmp });
    expect(r.ok).toBe(true);
  });

  test("any-of-alls: succeeds if any all-branch fully passes", async () => {
    const gate: Gate = {
      kind: "any",
      gates: [
        {
          kind: "all",
          gates: [
            { kind: "shell", command: "true" },
            { kind: "shell", command: "exit 1" }, // breaks first branch
          ],
        },
        {
          kind: "all",
          gates: [
            { kind: "shell", command: "true" },
            { kind: "shell", command: "true" }, // second branch passes
          ],
        },
      ],
    };
    const r = await evalGate(gate, { cwd: tmp });
    expect(r.ok).toBe(true);
  });
});

// --- runVerify back-compat -------------------------------------------------

describe("runVerify (legacy shim) — delegates to evalGate, preserves shape", () => {
  test("empty commands → ok=true with empty results", async () => {
    const r = await runVerify([], { cwd: tmp });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results).toHaveLength(0);
  });

  test("single passing command → success result with ok=true", async () => {
    const r = await runVerify(["echo hi"], { cwd: tmp });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results).toHaveLength(1);
    expect(r.results[0]!.ok).toBe(true);
    expect(r.results[0]!.command).toBe("echo hi");
  });

  test("first failure preserves results-up-to-failure + failure shape", async () => {
    const r = await runVerify(
      ["true", "exit 9", "echo never"],
      { cwd: tmp },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.results).toHaveLength(2); // short-circuit
    expect(r.results[0]!.ok).toBe(true);
    expect(r.results[1]!.ok).toBe(false);
    expect(r.failure.command).toBe("exit 9");
    expect(r.failure.exitCode).toBe(9);
    expect(r.failure.timedOut).toBe(false);
    expect(r.failure.aborted).toBe(false);
  });

  test("timeout flag preserved through the gate translation", async () => {
    const r = await runVerify(["sleep 5"], {
      cwd: tmp,
      timeoutMs: 100,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failure.timedOut).toBe(true);
  });

  test("onLine callback wired through gate context", async () => {
    const lines: string[] = [];
    await runVerify(["echo first; echo second"], {
      cwd: tmp,
      onLine: ({ line }) => lines.push(line),
    });
    expect(lines).toContain("first");
    expect(lines).toContain("second");
  });
});

// --- Evidence type guards --------------------------------------------------

describe("evidence type guards", () => {
  test("asShellEvidence narrows shell evidence, returns null for others", async () => {
    const shell = await evalGate(
      { kind: "shell", command: "true" },
      { cwd: tmp },
    );
    expect(asShellEvidence(shell.evidence)).not.toBeNull();
    expect(asCompositeEvidence(shell.evidence)).toBeNull();
  });

  test("asCompositeEvidence narrows all/any evidence", async () => {
    const all = await evalGate({ kind: "all", gates: [] }, { cwd: tmp });
    expect(asCompositeEvidence(all.evidence)).not.toBeNull();
    expect(asShellEvidence(all.evidence)).toBeNull();
  });

  test("type guards reject malformed inputs without throwing", () => {
    expect(asShellEvidence(null)).toBeNull();
    expect(asShellEvidence(undefined)).toBeNull();
    expect(asShellEvidence("string")).toBeNull();
    expect(asShellEvidence({})).toBeNull();
    expect(asShellEvidence({ kind: "other" })).toBeNull();
    expect(asCompositeEvidence(null)).toBeNull();
    expect(asCompositeEvidence({ kind: "shell" })).toBeNull();
  });
});
