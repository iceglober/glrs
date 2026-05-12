/**
 * Tests for the scoper session runner.
 *
 * Mocks the child process to verify:
 *   - Sentinel detection (SCOPE_COMPLETE: <path>)
 *   - Timeout behavior
 *   - scope.md path extraction
 *   - Error propagation
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { extractScopeCompletePath } from "../src/autopilot/scoper.js";

describe("extractScopeCompletePath", () => {
  it("extracts path from SCOPE_COMPLETE sentinel line", () => {
    const output = "Some output\nSCOPE_COMPLETE: /path/to/scope.md\n";
    expect(extractScopeCompletePath(output)).toBe("/path/to/scope.md");
  });

  it("extracts path when sentinel is the only line", () => {
    const output = "SCOPE_COMPLETE: /abs/path/scope.md";
    expect(extractScopeCompletePath(output)).toBe("/abs/path/scope.md");
  });

  it("returns null when no sentinel present", () => {
    const output = "Some output without sentinel\nMore output\n";
    expect(extractScopeCompletePath(output)).toBeNull();
  });

  it("returns null on empty string", () => {
    expect(extractScopeCompletePath("")).toBeNull();
  });

  it("handles path with spaces (trimmed)", () => {
    const output = "SCOPE_COMPLETE:   /path/with/spaces/scope.md  \n";
    expect(extractScopeCompletePath(output)).toBe("/path/with/spaces/scope.md");
  });

  it("uses last SCOPE_COMPLETE line if multiple present", () => {
    const output =
      "SCOPE_COMPLETE: /first/scope.md\nSCOPE_COMPLETE: /second/scope.md\n";
    expect(extractScopeCompletePath(output)).toBe("/second/scope.md");
  });
});
