/**
 * Regression test for the random-token helper. Runs under Bun, so it guards the
 * exact bug it was written for: detaching `globalThis.crypto.randomUUID` from
 * its receiver throws "Expected this to be instanceof Crypto" on Bun. If that
 * form is ever reintroduced, `randomToken()` throws here and this fails.
 */

import { describe, it, expect } from "bun:test";
import { randomToken } from "../src/lib/id.js";

describe("randomToken", () => {
  it("returns a 32-char lowercase-hex token without throwing", () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is unique across calls", () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});
