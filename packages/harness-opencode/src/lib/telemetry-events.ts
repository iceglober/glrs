/**
 * Pure builders for harness telemetry event properties.
 *
 * Kept separate from the plugins (cost-tracker, tool-hooks) and from the Counted
 * transport (analytics.ts) so the event *shape* can be unit-tested without a
 * network or the OpenCode runtime. Every value returned here is a non-PII
 * primitive: ids, public model/provider names, enums, booleans, or counts.
 *
 * Event names emitted by the harness:
 *   - `model_turn`        one per finalized assistant message — cost, token
 *                         speed (tps), and turn outcome, all keyed by model.
 *   - `tool_used`         one per tool call — tool name + best-effort success.
 *   - `post_edit_verify`  the result of the automatic post-edit tsc check.
 */

import type { EventProperties } from "@counted/sdk";

export type TurnTokens = {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
};

/** Round to `dp` decimal places, returning a finite number (0 for NaN/∞). */
export function round(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Finish reasons we recognise. Anything else collapses to "other" so we never
// emit an arbitrary, possibly-sensitive string as a property value.
const KNOWN_FINISH = new Set([
  "stop",
  "length",
  "tool-calls",
  "tool_calls",
  "content-filter",
  "content_filter",
  "error",
  "aborted",
  "cancelled",
  "canceled",
  "unknown",
]);

export function normalizeFinish(finish: string | undefined | null): string {
  if (!finish || typeof finish !== "string") return "unknown";
  const f = finish.toLowerCase();
  return KNOWN_FINISH.has(f) ? f.replace(/_/g, "-") : "other";
}

/**
 * Build properties for the `model_turn` event from a finalized assistant
 * message. `tps` (GENERATED tokens per second — output + reasoning; providers
 * like google-vertex/azure report reasoning separately, and excluding it
 * understated their generation rate ~2x) and `duration_ms` are omitted when
 * timing is unavailable or non-positive, rather than emitting a bogus 0/∞.
 * Note: the duration window includes TTFT/prefill, so tps is an effective
 * end-to-end rate, biased below pure decode speed — comparable across
 * models/presets, not an absolute decode benchmark.
 *
 * `unpriced: true` marks turns that consumed tokens but report zero cost —
 * the provider/model has no pricing entry in the models.dev catalog (e.g.
 * azure-foundry), so dashboards can distinguish "missing price" from "free".
 */
export function buildModelTurnProps(args: {
  provider: string;
  model: string;
  cost: number;
  tokens: TurnTokens;
  createdMs?: number | null;
  completedMs?: number | null;
  errorKind?: string | null;
  finish?: string | null;
  preset?: string;
}): EventProperties {
  const props: EventProperties = {
    provider: args.provider || "unknown",
    model: args.model || "unknown",
    cost: round(args.cost || 0, 6),
    input_tokens: Math.max(0, Math.round(args.tokens.input || 0)),
    output_tokens: Math.max(0, Math.round(args.tokens.output || 0)),
    reasoning_tokens: Math.max(0, Math.round(args.tokens.reasoning || 0)),
    cache_read: Math.max(0, Math.round(args.tokens.cache?.read || 0)),
    cache_write: Math.max(0, Math.round(args.tokens.cache?.write || 0)),
    outcome: args.errorKind ? "error" : "ok",
    finish: normalizeFinish(args.finish),
  };

  const genTokens = (args.tokens.output || 0) + (args.tokens.reasoning || 0);
  const anyTokens =
    (args.tokens.input || 0) +
      (args.tokens.cache?.read || 0) +
      (args.tokens.cache?.write || 0) +
      genTokens >
    0;
  if (!(args.cost > 0) && anyTokens) props.unpriced = true;

  const durationMs =
    args.createdMs != null && args.completedMs != null
      ? args.completedMs - args.createdMs
      : null;
  if (durationMs != null && durationMs > 0) {
    props.duration_ms = Math.round(durationMs);
    const seconds = durationMs / 1000;
    props.tps = round(genTokens / seconds, 1);
  }

  if (args.errorKind) props.error_kind = args.errorKind;
  if (args.preset) props.preset = args.preset;
  return props;
}

// Bash failure signals — kept in sync with tool-hooks' own heuristic. Used to
// label tool success conservatively: we only mark a call failed when we have a
// positive failure signal, so successful calls are never mislabelled.
const BASH_FAILURE_PATTERNS: RegExp[] = [
  /Exit code:\s*[1-9]\d*/i,
  /\bexited with code [1-9]/i,
  /\bcommand failed\b/i,
];

/**
 * Best-effort: did this tool call succeed? Conservative — defaults to `true`
 * and only returns `false` on a positive failure signal (bash non-zero exit, a
 * truthy `metadata.error`, or a short output that is clearly an error). The
 * OpenCode `tool.execute.after` hook carries no explicit success flag, so this
 * is a heuristic, not ground truth.
 */
export function inferToolOk(
  tool: string,
  output: string,
  metadata?: unknown,
): boolean {
  if (metadata && typeof metadata === "object") {
    const m = metadata as Record<string, unknown>;
    if (m.error) return false;
  }
  const text = output ?? "";
  if (tool === "bash") {
    if (BASH_FAILURE_PATTERNS.some((re) => re.test(text))) return false;
    if (/\bERROR\b/.test(text) && text.length < 500) return false;
  }
  return true;
}

/** Lowercase, keep only kebab-slug chars — never emit an arbitrary string. */
function sanitizeSlug(s: string): string | null {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || null;
}

/**
 * Best-effort skill-name extraction for a tool call. OpenCode surfaces a skill
 * invocation as a tool whose name identifies the skill (commonly a `skill` /
 * `skills_<name>` tool, or the skill name passed in args). Returns the skill
 * slug, or null when the call is not a skill invocation. The raw tool name is
 * always emitted regardless, so correlation still works when this returns null.
 */
export function extractSkillName(tool: string, args?: unknown): string | null {
  const t = (tool || "").toLowerCase();
  if (t === "skill" || t === "skills") {
    if (args && typeof args === "object") {
      const a = args as Record<string, unknown>;
      const name = a.name ?? a.skill ?? a.skill_name ?? a.skillName;
      if (typeof name === "string" && name) return sanitizeSlug(name);
    }
    return null;
  }
  const m = /^skills?[_-](.+)$/.exec(t);
  if (m && m[1]) return sanitizeSlug(m[1]);
  return null;
}

/** Properties for the `tool_used` event. `skill` is set when the tool is a skill invocation. */
export function buildToolUsedProps(args: {
  tool: string;
  ok: boolean;
  provider?: string;
  model?: string;
  skill?: string | null;
  preset?: string;
}): EventProperties {
  const props: EventProperties = {
    provider: args.provider || "unknown",
    model: args.model || "unknown",
    tool: args.tool || "unknown",
    ok: args.ok,
  };
  if (args.skill) props.skill = args.skill;
  if (args.preset) props.preset = args.preset;
  return props;
}

/**
 * Properties for the `loop_detected` event — emitted when the tool-loop guard
 * warns or aborts a session that is spinning. `kind` distinguishes the
 * signatures: `explore` (long passive read/search streak), `repeat` (same call
 * repeated), or `complexity` (repeated failing verify runs → suggest deeper
 * agent). `level` is the escalation stage; `count` is the streak/repeat/fail
 * score that tripped it.
 */
export function buildLoopProps(args: {
  tool: string;
  kind: "explore" | "repeat" | "complexity";
  level: "warn" | "abort";
  count: number;
  provider?: string;
  model?: string;
  preset?: string;
}): EventProperties {
  const props: EventProperties = {
    provider: args.provider || "unknown",
    model: args.model || "unknown",
    tool: args.tool || "unknown",
    kind: args.kind,
    level: args.level,
    count: Math.max(0, Math.round(args.count || 0)),
  };
  if (args.preset) props.preset = args.preset;
  return props;
}

/** Properties for the `post_edit_verify` event (TS/JS post-edit tsc check). */
export function buildVerifyProps(args: {
  errorCount: number;
  tool: string;
  provider?: string;
  model?: string;
  preset?: string;
}): EventProperties {
  const props: EventProperties = {
    ok: args.errorCount === 0,
    errors: Math.max(0, Math.round(args.errorCount || 0)),
    lang: "ts",
    provider: args.provider || "unknown",
    model: args.model || "unknown",
    tool: args.tool || "unknown",
  };
  if (args.preset) props.preset = args.preset;
  return props;
}
