import { randomUUID } from "node:crypto";

/**
 * A 32-char lowercase-hex token: a UUIDv4 with the dashes stripped. Used for
 * stub bearer tokens and message ids.
 *
 * Uses `node:crypto`'s standalone `randomUUID`. The WebCrypto
 * `globalThis.crypto.randomUUID` is a *method* that checks `this` is a `Crypto`
 * instance — detaching it (`const u = crypto.randomUUID; u()`) throws
 * "Expected this to be instanceof Crypto" on Bun, where cmprss runs. Node
 * tolerates the detached call, which is why that form passed Node testing but
 * crashed on a Bun-only machine.
 */
export function randomToken(): string {
  return randomUUID().replaceAll("-", "");
}
