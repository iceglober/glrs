// pilot-setup-hook.test.ts — unit tests for runSetupHook.
//
// Covers: missing (skip), success, non-zero exit, not-executable (POSIX),
// timeout, stream-line capture.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  runSetupHook,
  SETUP_HOOK_RELATIVE_PATH,
} from "../src/pilot/worker/setup-hook.js";

// --- Fixtures --------------------------------------------------------------

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-setup-hook-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeHook(
  cwd: string,
  script: string,
  opts: { executable?: boolean } = {},
): string {
  const hookDir = path.join(cwd, ".glrs", "hooks");
  fs.mkdirSync(hookDir, { recursive: true });
  const hookPath = path.join(hookDir, "pilot_setup");
  fs.writeFileSync(hookPath, script);
  if (opts.executable !== false) {
    fs.chmodSync(hookPath, 0o755);
  } else {
    fs.chmodSync(hookPath, 0o644);
  }
  return hookPath;
}

// --- Tests ----------------------------------------------------------------

describe("runSetupHook — missing file", () => {
  test("returns skipped when .glrs/hooks/pilot_setup does not exist", async () => {
    const r = await runSetupHook({ cwd: tmp });
    expect(r.kind).toBe("skipped");
  });

  test("returns skipped when .glrs/hooks/ dir exists but file does not", async () => {
    fs.mkdirSync(path.join(tmp, ".glrs", "hooks"), { recursive: true });
    const r = await runSetupHook({ cwd: tmp });
    expect(r.kind).toBe("skipped");
  });
});

describe("runSetupHook — success", () => {
  test("returns ok when hook exits 0", async () => {
    writeHook(tmp, "#!/bin/sh\necho 'hello from setup'\nexit 0\n");
    const r = await runSetupHook({ cwd: tmp, onLine: () => {} });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("streams stdout lines to the onLine callback", async () => {
    writeHook(
      tmp,
      "#!/bin/sh\necho 'line 1'\necho 'line 2'\nexit 0\n",
    );
    const lines: string[] = [];
    const r = await runSetupHook({
      cwd: tmp,
      onLine: (c) => lines.push(c),
    });
    expect(r.kind).toBe("ok");
    const joined = lines.join("");
    expect(joined).toMatch(/line 1/);
    expect(joined).toMatch(/line 2/);
  });

  test("streams stderr lines to the onLine callback", async () => {
    writeHook(
      tmp,
      "#!/bin/sh\necho 'oh no' 1>&2\nexit 0\n",
    );
    const lines: string[] = [];
    await runSetupHook({
      cwd: tmp,
      onLine: (c) => lines.push(c),
    });
    expect(lines.join("")).toMatch(/oh no/);
  });
});

describe("runSetupHook — failure", () => {
  test("returns failed with the exit code when hook exits non-zero", async () => {
    writeHook(tmp, "#!/bin/sh\necho 'bad'\nexit 17\n");
    const r = await runSetupHook({ cwd: tmp, onLine: () => {} });
    expect(r.kind).toBe("failed");
    if (r.kind !== "failed") return;
    expect(r.exitCode).toBe(17);
  });

  test("returns not-executable when file exists but chmod +x missing (POSIX)", async () => {
    if (process.platform === "win32") return; // windows has no x-bit
    writeHook(tmp, "#!/bin/sh\nexit 0\n", { executable: false });
    const r = await runSetupHook({ cwd: tmp });
    expect(r.kind).toBe("not-executable");
    if (r.kind !== "not-executable") return;
    expect(r.hookPath).toMatch(/\.glrs\/hooks\/pilot_setup$/);
  });
});

describe("runSetupHook — timeout", () => {
  test("returns timed-out when hook runs longer than timeoutMs", async () => {
    // Use a trap-based script that ignores SIGTERM briefly so we exercise
    // the SIGKILL escalation path. Total budget: 100ms timeout + 500ms
    // SIGKILL grace + some slack = well under bun's 5s test timeout.
    writeHook(
      tmp,
      "#!/bin/sh\ntrap '' TERM\nwhile true; do sleep 0.01; done\n",
    );
    const r = await runSetupHook({
      cwd: tmp,
      onLine: () => {},
      timeoutMs: 100,
    });
    expect(r.kind).toBe("timed-out");
    if (r.kind !== "timed-out") return;
    expect(r.timeoutMs).toBe(100);
  });
});

describe("runSetupHook — path resolution", () => {
  test("resolves to <cwd>/.glrs/hooks/pilot_setup", () => {
    // SETUP_HOOK_RELATIVE_PATH is the contract.
    expect(SETUP_HOOK_RELATIVE_PATH).toBe(".glrs/hooks/pilot_setup");
  });
});
