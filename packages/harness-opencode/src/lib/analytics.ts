/**
 * Privacy-first telemetry for the glrs OpenCode harness, via Counted.
 *
 * Mirrors the glrs CLI's analytics module (packages/cli/src/lib/analytics.ts)
 * but is tuned for the harness's *long-lived* process: the CLI flushes once on
 * exit, whereas the harness runs for the length of an agent session, so we lean
 * on the SDK's periodic flush to deliver events while the session is alive.
 *
 * No cookies, no fingerprinting, no PII. Event properties are restricted to
 * ids, enums, booleans, and counts — never names, paths, branch names, tokens,
 * prompts, or raw user/tool input. Model and provider ids are public identifiers
 * (e.g. "anthropic" / "claude-opus-4-8"), not PII.
 *
 * On by default. Disable entirely with the Console Do Not Track standard
 * (DO_NOT_TRACK) or the project opt-out (GLRS_NO_ANALYTICS=1), matching the CLI
 * and the GLRS_AUTO_UPDATE opt-out convention. COUNTED_KEY overrides the ingest
 * key.
 *
 * Tracking never blocks the agent loop and never throws. Events buffer in memory
 * and are delivered by the SDK's internal 30s flush timer (which we unref so it
 * can never hold the process open) plus a best-effort flush on `beforeExit`. If
 * delivery is missed, the event is silently dropped — telemetry failure must
 * never affect a session.
 */

import { Analytics, type EventProperties } from "@counted/sdk";

// Write-only Counted ingest key — the SAME project as the CLI, so harness
// session telemetry and CLI command telemetry land together. Safe to ship: it
// can only POST events, never read. COUNTED_KEY in the environment overrides it.
const DEFAULT_PROJECT_KEY = "ck_94C4F7AE8481D5C51695";

// Counted ingest host. The SDK defaults to `https://counted.dev`, which has no
// DNS record — so events posted there silently vanish. The live ingest host is
// `https://app.counted.dev`. COUNTED_HOST overrides it.
const DEFAULT_HOST = "https://app.counted.dev";

let client: Analytics | null = null;
let initialized = false;
let exitHookInstalled = false;

function isTrue(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function projectKey(): string {
  const fromEnv = process.env["COUNTED_KEY"];
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : DEFAULT_PROJECT_KEY;
}

function host(): string {
  const fromEnv = process.env["COUNTED_HOST"];
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : DEFAULT_HOST;
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
    client = new Analytics({ projectKey: projectKey(), host: host() });
    // The SDK starts a 30s flush interval in its constructor. Unref it so it can
    // never keep a finished process alive; while the harness session is running
    // the loop is alive for other reasons, so the timer still fires and delivers
    // events periodically. A best-effort flush on exit catches the tail.
    (client as unknown as { timer?: { unref?: () => void } }).timer?.unref?.();
    installExitHook();
  } catch {
    client = null;
  }
  return client;
}

/** Register a one-shot best-effort flush when the process is about to exit. */
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // `beforeExit` fires when the loop drains without a pending exit. It will not
  // fire on process.exit()/signals — that's acceptable, the periodic flush has
  // already delivered most events by then.
  process.once("beforeExit", () => {
    void flushAnalytics();
  });
}

/**
 * Record an event. Non-blocking and never throws. No-op when telemetry is off.
 * Properties must be non-PII primitives (ids, enums, booleans, counts).
 */
export function track(eventName: string, props?: EventProperties): void {
  try {
    getClient()?.track(eventName, props);
  } catch {
    // Telemetry must never break a session.
  }
}

/**
 * Deliver buffered events. Idempotent and bounded by `timeoutMs` so a slow or
 * dead network never blocks. Returns when the events are sent, the timeout
 * elapses, or there is nothing to send. Unlike the CLI, this does NOT destroy
 * the client — the harness keeps running and may emit more events.
 */
export async function flushAnalytics(timeoutMs = 1500): Promise<void> {
  const c = client;
  if (!c) return;
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
  }
}

// ---- test seam -------------------------------------------------------------
export const __test__ = { isTrue, analyticsEnabled, projectKey, host, DEFAULT_PROJECT_KEY, DEFAULT_HOST };
