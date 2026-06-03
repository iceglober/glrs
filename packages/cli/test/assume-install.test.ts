/**
 * Tests for the `glrs assume` install/repair routines. They drive the logic
 * through injected runners — no real package-manager calls — asserting package
 * manager detection/fallback, legacy-package handling, and idempotency.
 */

import { describe, it, expect } from "bun:test";
import {
  repairAssumeInstall,
  ensureGsaInstalled,
  detectPackageManager,
  isGlobalPackageInstalled,
  CURRENT_PACKAGE,
  type Runner,
} from "../src/lib/assume-install.js";

/**
 * A runner that records calls and returns scripted exit codes by command key.
 * Unscripted keys default to exit 0 (present/success). To mark a command
 * absent/failing, give its key a non-zero code.
 */
function makeRunner(codes: Record<string, number> = {}): {
  run: Runner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const run: Runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = [cmd, ...args].join(" ");
    return codes[key] ?? 0;
  };
  return { run, calls };
}

const noop = () => {};

/** Mark npm absent so detection/fallback skips it. */
const NPM_ABSENT = { "npm --version": 1 };

describe("detectPackageManager", () => {
  it("prefers npm when present", () => {
    const { run } = makeRunner();
    expect(detectPackageManager(run)?.name).toBe("npm");
  });

  it("falls back to bun when npm is absent", () => {
    const { run } = makeRunner(NPM_ABSENT);
    expect(detectPackageManager(run)?.name).toBe("bun");
  });

  it("returns null when no package manager is installed", () => {
    const { run } = makeRunner({
      "npm --version": 1,
      "bun --version": 1,
      "pnpm --version": 1,
      "yarn --version": 1,
    });
    expect(detectPackageManager(run)).toBeNull();
  });
});

describe("repairAssumeInstall", () => {
  it("removes a present legacy package, then installs the current one (npm)", async () => {
    const { run, calls } = makeRunner({
      "npm ls -g @glorious/assume --depth=0": 0,
    });
    await repairAssumeInstall({ run, probe: run, log: noop });

    expect(calls).toContainEqual(["npm", "rm", "-g", "@glorious/assume"]);
    expect(calls).toContainEqual(["npm", "i", "-g", `${CURRENT_PACKAGE}@latest`]);
    const rmIdx = calls.findIndex((c) => c[1] === "rm");
    const iIdx = calls.findIndex((c) => c[1] === "i");
    expect(rmIdx).toBeLessThan(iIdx);
  });

  it("skips removal when no legacy package is installed", async () => {
    const { run, calls } = makeRunner({
      "npm ls -g @glorious/assume --depth=0": 1,
    });
    await repairAssumeInstall({ run, probe: run, log: noop });

    expect(calls.some((c) => c[1] === "rm")).toBe(false);
    expect(calls).toContainEqual(["npm", "i", "-g", `${CURRENT_PACKAGE}@latest`]);
  });

  it("throws when the current-package install fails", async () => {
    const { run } = makeRunner({
      "npm ls -g @glorious/assume --depth=0": 1,
      [`npm i -g ${CURRENT_PACKAGE}@latest`]: 1,
    });
    await expect(
      repairAssumeInstall({ run, probe: run, log: noop }),
    ).rejects.toThrow(/Failed to install/);
  });

  it("proceeds to install even if legacy removal fails", async () => {
    const { run, calls } = makeRunner({
      "npm ls -g @glorious/assume --depth=0": 0,
      "npm rm -g @glorious/assume": 1,
    });
    await repairAssumeInstall({ run, probe: run, log: noop });
    expect(calls).toContainEqual(["npm", "i", "-g", `${CURRENT_PACKAGE}@latest`]);
  });

  it("installs via bun when npm is absent", async () => {
    const { run, calls } = makeRunner(NPM_ABSENT);
    await repairAssumeInstall({ run, probe: run, log: noop });

    expect(calls).toContainEqual(["bun", "add", "-g", `${CURRENT_PACKAGE}@latest`]);
    // npm absent ⇒ no legacy ls/rm attempted.
    expect(calls.some((c) => c[0] === "npm" && c[1] === "ls")).toBe(false);
    expect(calls.some((c) => c[0] === "npm" && c[1] === "rm")).toBe(false);
  });

  it("throws an actionable error when no package manager exists", async () => {
    const { run } = makeRunner({
      "npm --version": 1,
      "bun --version": 1,
      "pnpm --version": 1,
      "yarn --version": 1,
    });
    await expect(
      repairAssumeInstall({ run, probe: run, log: noop }),
    ).rejects.toThrow(/No JavaScript package manager found/);
  });
});

describe("ensureGsaInstalled", () => {
  it("is a no-op when gsa is already on PATH", async () => {
    const { run, calls } = makeRunner();
    await ensureGsaInstalled({
      run,
      probe: run,
      log: noop,
      gsaReady: () => true,
    });
    expect(calls).toEqual([]); // never probes or installs
  });

  it("installs the current package when gsa is missing", async () => {
    const { run, calls } = makeRunner(NPM_ABSENT);
    // gsaReady: false before install, true after.
    let installed = false;
    await ensureGsaInstalled({
      run: (cmd, args) => {
        if (cmd === "bun" && args[0] === "add") installed = true;
        return run(cmd, args);
      },
      probe: run,
      log: noop,
      gsaReady: () => installed,
    });
    expect(calls).toContainEqual(["bun", "add", "-g", CURRENT_PACKAGE]);
  });

  it("throws if gsa is still missing after a successful install", async () => {
    const { run } = makeRunner(NPM_ABSENT);
    await expect(
      ensureGsaInstalled({
        run,
        probe: run,
        log: noop,
        gsaReady: () => false, // never becomes ready
      }),
    ).rejects.toThrow(/still not on PATH/);
  });
});

describe("isGlobalPackageInstalled", () => {
  it("maps exit 0 to true and non-zero to false", () => {
    expect(isGlobalPackageInstalled("x", () => 0)).toBe(true);
    expect(isGlobalPackageInstalled("x", () => 1)).toBe(false);
  });
});
