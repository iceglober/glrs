/**
 * Privacy-first product analytics for the glrs CLI, via Counted.
 *
 * No cookies, no fingerprinting, no PII. Event properties are restricted to
 * ids, enums, booleans, and counts — never names, paths, branch names, tokens,
 * or raw user input. The SDK adds no cookies and no device fingerprint.
 *
 * On by default. Disable entirely with the Console Do Not Track standard
 * (DO_NOT_TRACK) or a project opt-out (GLRS_NO_ANALYTICS=1), matching the
 * GLRS_AUTO_UPDATE opt-out convention. COUNTED_KEY overrides the ingest key.
 *
 * Tracking never blocks a command and never throws. Events buffer in memory;
 * flushAnalytics() delivers them before the CLI exits, bounded by a timeout so
 * a dead network can never delay exit. If delivery is missed, the event is
 * silently dropped — analytics failure must never affect a command.
 */

import { Analytics, type EventProperties } from "@counted/sdk";

// Write-only Counted ingest key. Safe to ship: it can only POST events, it
// cannot read any data. Embedding it is what makes analytics work on real
// installs; COUNTED_KEY in the environment overrides it.
const DEFAULT_PROJECT_KEY = "ck_94C4F7AE8481D5C51695";

let client: Analytics | null = null;
let initialized = false;

function isTrue(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function projectKey(): string {
  const fromEnv = process.env["COUNTED_KEY"];
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : DEFAULT_PROJECT_KEY;
}

function analyticsEnabled(): boolean {
  if (isTrue(process.env["DO_NOT_TRACK"])) return false;
  if (isTrue(process.env["GLRS_NO_ANALYTICS"])) return false;
  return Boolean(projectKey());
}

function getClient(): Analytics | null {
  if (initialized) return client;
  initialized = true;
  if (!analyticsEnabled()) return (client = null);
  try {
    client = new Analytics({ projectKey: projectKey() });
    // The SDK starts a 30s flush interval in its constructor. For a short-lived
    // CLI that timer would keep the event loop alive (delaying natural exit by
    // up to 30s). Unref it so it never holds the process open; flushAnalytics()
    // delivers events explicitly before we exit.
    (client as unknown as { timer?: { unref?: () => void } }).timer?.unref?.();
  } catch {
    client = null;
  }
  return client;
}

/**
 * Record an event. Non-blocking and never throws. No-op when analytics is off.
 * Properties must be non-PII primitives (ids, enums, booleans, counts).
 */
export function track(eventName: string, props?: EventProperties): void {
  try {
    getClient()?.track(eventName, props);
  } catch {
    // Analytics must never break a command.
  }
}

/**
 * Deliver buffered events before the process exits. Idempotent and bounded by
 * `timeoutMs` so a slow or dead network never delays exit. Returns when the
 * events are sent, the timeout elapses, or there is nothing to send.
 */
export async function flushAnalytics(timeoutMs = 1500): Promise<void> {
  const c = client;
  if (!c) return;
  client = null; // make repeat calls cheap no-ops
  try {
    await Promise.race([
      c.flush(),
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, timeoutMs);
        (t as unknown as { unref?: () => void }).unref?.();
      }),
    ]);
  } catch {
    // fail silently
  } finally {
    try {
      c.destroy(); // clears the SDK's flush interval
    } catch {
      // ignore
    }
  }
}
