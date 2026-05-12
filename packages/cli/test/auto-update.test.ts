/**
 * Tests for auto-update's dev-checkout detection.
 *
 * Regression guard: a developer running the CLI from a source tree
 * (symlinked dev bundle, bun link, etc.) must NOT have auto-update
 * hijack the invocation by installing the published version globally
 * and re-exec'ing via PATH. The heuristic: installed packages have
 * `/node_modules/` in their resolved path; source trees do not.
 *
 * This test suite exercises the env-var opt-outs and the dev-checkout
 * detection via the real module. It does NOT test the network fetch
 * or the update spawn — those are integration concerns.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { autoUpdate } from "../src/lib/auto-update.js";

describe("autoUpdate", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env to a known state. Crucially, clear GLRS_UPDATING and
    // GLRS_AUTO_UPDATE so each test controls its own opt-outs.
    delete process.env["GLRS_UPDATING"];
    delete process.env["GLRS_AUTO_UPDATE"];
    delete process.env["CI"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("respects GLRS_AUTO_UPDATE=0 opt-out", async () => {
    process.env["GLRS_AUTO_UPDATE"] = "0";
    expect(await autoUpdate()).toBe(false);
  });

  it("skips when CI=1", async () => {
    process.env["CI"] = "1";
    expect(await autoUpdate()).toBe(false);
  });

  it("skips when already updating (recursion guard)", async () => {
    process.env["GLRS_UPDATING"] = "1";
    expect(await autoUpdate()).toBe(false);
  });

  it("skips when running from a dev checkout (not from node_modules)", async () => {
    // This test is running `bun test` inside the source tree, so
    // import.meta.dir for the auto-update module resolves to
    // <repo>/packages/cli/src/lib/ — no /node_modules/ segment.
    // Therefore autoUpdate must return false without making network
    // calls or spawning child processes.
    //
    // If this test starts failing in CI because the test runner
    // installs @glrs-dev/cli into node_modules somewhere, that's a
    // signal the heuristic needs refinement (e.g., also check for a
    // sibling package.json with a "workspaces" field).
    const result = await autoUpdate();
    expect(result).toBe(false);
  });
});
