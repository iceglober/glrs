/**
 * Tests for the `glrs assume init` repair routine. They drive the logic
 * through an injected runner — no real npm calls — asserting the command
 * sequence and the legacy-package handling.
 */

import { describe, it, expect } from "bun:test";
import {
  repairAssumeInstall,
  isGlobalPackageInstalled,
  CURRENT_PACKAGE,
  type Runner,
} from "../src/lib/assume-install.js";

/** A runner that records calls and returns scripted exit codes by command key. */
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

describe("repairAssumeInstall", () => {
  it("removes a present legacy package, then installs the current one", async () => {
    // @glorious/assume present (ls exits 0); everything else succeeds.
    const { run, calls } = makeRunner({
      "npm ls -g @glorious/assume --depth=0": 0,
    });
    await repairAssumeInstall({ run, log: noop });

    expect(calls).toContainEqual(["npm", "rm", "-g", "@glorious/assume"]);
    expect(calls).toContainEqual(["npm", "i", "-g", `${CURRENT_PACKAGE}@latest`]);
    // Removal must precede install.
    const rmIdx = calls.findIndex((c) => c[1] === "rm");
    const iIdx = calls.findIndex((c) => c[1] === "i");
    expect(rmIdx).toBeLessThan(iIdx);
  });

  it("skips removal when no legacy package is installed", async () => {
    // ls exits non-zero → not installed.
    const { run, calls } = makeRunner({
      "npm ls -g @glorious/assume --depth=0": 1,
    });
    await repairAssumeInstall({ run, log: noop });

    expect(calls.some((c) => c[1] === "rm")).toBe(false);
    expect(calls).toContainEqual(["npm", "i", "-g", `${CURRENT_PACKAGE}@latest`]);
  });

  it("throws when the current-package install fails", async () => {
    const { run } = makeRunner({
      "npm ls -g @glorious/assume --depth=0": 1,
      [`npm i -g ${CURRENT_PACKAGE}@latest`]: 1,
    });
    await expect(repairAssumeInstall({ run, log: noop })).rejects.toThrow(
      /Failed to install/,
    );
  });

  it("proceeds to install even if legacy removal fails", async () => {
    const { run, calls } = makeRunner({
      "npm ls -g @glorious/assume --depth=0": 0,
      "npm rm -g @glorious/assume": 1, // removal fails
    });
    await repairAssumeInstall({ run, log: noop });
    expect(calls).toContainEqual(["npm", "i", "-g", `${CURRENT_PACKAGE}@latest`]);
  });
});

describe("isGlobalPackageInstalled", () => {
  it("maps exit 0 to true and non-zero to false", () => {
    expect(isGlobalPackageInstalled("x", () => 0)).toBe(true);
    expect(isGlobalPackageInstalled("x", () => 1)).toBe(false);
  });
});
