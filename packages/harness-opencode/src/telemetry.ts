// telemetry.ts — anonymous, opt-out usage telemetry via TelemetryDeck.
//
// Sends fire-and-forget events to TelemetryDeck's ingestion endpoint.
// No SDK dependency — raw fetch against the public HTTP API.
//
// Privacy guarantees:
//   - Write-only App ID embedded in source (public, no secret needed)
//   - Install ID is SHA-256 hashed + truncated to 8 chars as clientUser
//   - No file paths, contents, prompts, model outputs, error messages, or
//     git remotes are ever collected
//   - Property allowlist enforced — unknown keys are stripped before send
//   - Fire-and-forget: fetch().catch(() => {}) — never throws, never blocks
//
// Opt-out: HARNESS_OPENCODE_TELEMETRY=0|false, DO_NOT_TRACK=1, CI=true

import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const APP_ID = "BA5189DD-2BB8-4DCC-88B0-F3769D0208FB";
const ENDPOINT = "https://nom.telemetrydeck.com/v2/namespace/glrs.dev/";
const PKG_NAME = "@glrs-dev/harness-plugin-opencode";

// Replaced at build time by tsup's `define` option. Falls back to "dev"
// if running unbundled (tests, direct ts-node execution).
declare const __PKG_VERSION__: string;
const PKG_VERSION =
  typeof __PKG_VERSION__ !== "undefined" ? __PKG_VERSION__ : "dev";

export const DISABLED =
  process.env.HARNESS_OPENCODE_TELEMETRY === "0" ||
  process.env.HARNESS_OPENCODE_TELEMETRY === "false" ||
  process.env.DO_NOT_TRACK === "1" ||
  process.env.CI === "true";

const SESSION_ID = randomUUID();

function getInstallId(): string {
  const dir = join(homedir(), ".config", "harness-opencode");
  const file = join(dir, "install-id");
  try {
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
    mkdirSync(dir, { recursive: true });
    const id = createHash("sha256")
      .update(randomUUID())
      .digest("hex")
      .slice(0, 16);
    writeFileSync(file, id, { mode: 0o600 });
    return id;
  } catch {
    return "anon";
  }
}

// The allowlist is the firewall. If it's not on this list, it doesn't ship.
// Add new keys deliberately, never with a wildcard.
const ALLOWED_PROPS = new Set([
  "tool",
  "outcome",
  "duration_ms",
  "edit_kind",
  "ops_count",
  "retry_count",
  "diagnostics_count",
  "ext",
  "stale",
  "error_class",
  "subagent",
  "tier",
  "memory_op",
  "tool_category",
  "model",
  "provider",
  "output_tokens",
  "tps",
]);

export function clean(
  p: Record<string, unknown>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) {
    if (!ALLOWED_PROPS.has(k)) continue;
    if (typeof v === "string" || typeof v === "number") out[k] = v;
    else if (typeof v === "boolean") out[k] = v ? 1 : 0;
  }
  return out;
}

const installId = DISABLED ? "" : getInstallId();

export function track(
  eventName: string,
  props: Record<string, unknown> = {},
): void {
  if (DISABLED) return;

  const cleaned = clean(props);
  const payload: Record<string, string> = {};
  for (const [k, v] of Object.entries(cleaned)) {
    payload[`Harness.${k}`] = String(v);
  }
  payload["Harness.app_version"] = PKG_VERSION;
  payload["Harness.os"] = process.platform;
  payload["Harness.node_version"] = process.version;

  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify([{
      appID: APP_ID,
      clientUser: installId.slice(0, 8),
      sessionID: SESSION_ID,
      type: eventName,
      isTestMode: PKG_VERSION === "dev",
      floatValue: typeof cleaned.duration_ms === "number" ? cleaned.duration_ms : undefined,
      payload,
    }]),
  }).catch(() => {});
}
