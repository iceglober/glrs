/**
 * Typed SessionEvent discriminated union for the autopilot event stream.
 *
 * Every event has `type` (the discriminant) and `timestamp` (ISO 8601 string).
 * Consumers narrow to a specific variant via the exported type guards.
 *
 * Channel 1: EventEmitter (in-process, consumed by CLI renderer)
 * Channel 2: NDJSON file at .agent/autopilot-events.jsonl (consumed by TUI / --status)
 */

// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------

export interface SessionStartEvent {
  type: "session:start";
  timestamp: string;
  planPath: string;
  cwd: string;
  fast: boolean;
  resume: boolean;
  enrichModel?: string;
  executeModel?: string;
}

export interface SessionDoneEvent {
  type: "session:done";
  timestamp: string;
  exitReason: string;
  iterations: number;
  cumulativeCostUsd?: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Enrichment events
// ---------------------------------------------------------------------------

export interface EnrichStartEvent {
  type: "enrich:start";
  timestamp: string;
  planPath: string;
  fileCount: number;
}

export interface EnrichFileStartEvent {
  type: "enrich:file:start";
  timestamp: string;
  file: string;
}

export interface EnrichFileDoneEvent {
  type: "enrich:file:done";
  timestamp: string;
  file: string;
  toolCalls: number;
  specFile?: string;
}

export interface EnrichFileSkipEvent {
  type: "enrich:file:skip";
  timestamp: string;
  file: string;
  reason: string;
}

export interface EnrichFileErrorEvent {
  type: "enrich:file:error";
  timestamp: string;
  file: string;
  error: string;
}

export interface EnrichDoneEvent {
  type: "enrich:done";
  timestamp: string;
  filesProcessed: number;
}

// ---------------------------------------------------------------------------
// Execution events
// ---------------------------------------------------------------------------

export interface PhaseStartEvent {
  type: "phase:start";
  timestamp: string;
  phase: string;
  laneId: string;
  current: number;
  total: number;
}

export interface PhaseDoneEvent {
  type: "phase:done";
  timestamp: string;
  phase: string;
  laneId: string;
  completed: boolean;
  iterations: number;
  costUsd: number;
}

export interface IterationStartEvent {
  type: "iteration:start";
  timestamp: string;
  iteration: number;
  maxIterations: number;
  laneId?: string;
}

export interface IterationDoneEvent {
  type: "iteration:done";
  timestamp: string;
  iteration: number;
  durationMs: number;
  madeProgress: boolean;
  filesChanged?: number;
  commitSubject?: string;
  costUsd?: number;
  cumulativeCostUsd?: number;
  laneId?: string;
}

export interface ToolCallEvent {
  type: "tool:call";
  timestamp: string;
  toolName: string;
  firstArg?: string;
  iteration: number;
  laneId?: string;
}

export interface CostUpdateEvent {
  type: "cost:update";
  timestamp: string;
  cumulativeCostUsd: number;
  isEstimated: boolean;
  iteration: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ThinkingEvent {
  type: "thinking";
  timestamp: string;
  iteration: number;
  /** Cumulative characters streamed in the current reasoning block. */
  chars: number;
  /** Seconds since the last tool call (or iteration start). */
  elapsedSec: number;
  laneId?: string;
}

// ---------------------------------------------------------------------------
// Error events
// ---------------------------------------------------------------------------

export interface ErrorEvent {
  type: "error";
  timestamp: string;
  message: string;
  iteration?: number;
  phase?: string;
}

export interface CredentialExpiredEvent {
  type: "credential:expired";
  timestamp: string;
  provider: string;
  message: string;
  iteration: number;
}

// ---------------------------------------------------------------------------
// Verify events
// ---------------------------------------------------------------------------

export interface VerifyStartEvent {
  type: "verify:start";
  timestamp: string;
  phase: string;
  itemCount: number;
}

export interface VerifyResultEvent {
  type: "verify:result";
  timestamp: string;
  phase: string;
  itemId: string;
  command: string;
  passed: boolean;
  stderr?: string;
}

export interface VerifyDoneEvent {
  type: "verify:done";
  timestamp: string;
  phase: string;
  passed: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type SessionEvent =
  | SessionStartEvent
  | SessionDoneEvent
  | EnrichStartEvent
  | EnrichFileStartEvent
  | EnrichFileDoneEvent
  | EnrichFileSkipEvent
  | EnrichFileErrorEvent
  | EnrichDoneEvent
  | PhaseStartEvent
  | PhaseDoneEvent
  | IterationStartEvent
  | IterationDoneEvent
  | ToolCallEvent
  | CostUpdateEvent
  | ThinkingEvent
  | ErrorEvent
  | CredentialExpiredEvent
  | VerifyStartEvent
  | VerifyResultEvent
  | VerifyDoneEvent;

// ---------------------------------------------------------------------------
// String literal union of all event type names
// ---------------------------------------------------------------------------

export type SessionEventType = SessionEvent["type"];

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isSessionStart(e: SessionEvent): e is SessionStartEvent {
  return e.type === "session:start";
}

export function isSessionDone(e: SessionEvent): e is SessionDoneEvent {
  return e.type === "session:done";
}

export function isEnrichStart(e: SessionEvent): e is EnrichStartEvent {
  return e.type === "enrich:start";
}

export function isEnrichFileStart(e: SessionEvent): e is EnrichFileStartEvent {
  return e.type === "enrich:file:start";
}

export function isEnrichFileDone(e: SessionEvent): e is EnrichFileDoneEvent {
  return e.type === "enrich:file:done";
}

export function isEnrichFileSkip(e: SessionEvent): e is EnrichFileSkipEvent {
  return e.type === "enrich:file:skip";
}

export function isEnrichFileError(e: SessionEvent): e is EnrichFileErrorEvent {
  return e.type === "enrich:file:error";
}

export function isEnrichDone(e: SessionEvent): e is EnrichDoneEvent {
  return e.type === "enrich:done";
}

/** True for any enrich:* event */
export function isEnrichEvent(
  e: SessionEvent,
): e is
  | EnrichStartEvent
  | EnrichFileStartEvent
  | EnrichFileDoneEvent
  | EnrichFileSkipEvent
  | EnrichFileErrorEvent
  | EnrichDoneEvent {
  return e.type.startsWith("enrich:");
}

export function isPhaseStart(e: SessionEvent): e is PhaseStartEvent {
  return e.type === "phase:start";
}

export function isPhaseDone(e: SessionEvent): e is PhaseDoneEvent {
  return e.type === "phase:done";
}

export function isIterationStart(e: SessionEvent): e is IterationStartEvent {
  return e.type === "iteration:start";
}

export function isIterationDone(e: SessionEvent): e is IterationDoneEvent {
  return e.type === "iteration:done";
}

export function isToolCall(e: SessionEvent): e is ToolCallEvent {
  return e.type === "tool:call";
}

export function isCostUpdate(e: SessionEvent): e is CostUpdateEvent {
  return e.type === "cost:update";
}

export function isThinking(e: SessionEvent): e is ThinkingEvent {
  return e.type === "thinking";
}

export function isError(e: SessionEvent): e is ErrorEvent {
  return e.type === "error";
}

export function isCredentialExpired(e: SessionEvent): e is CredentialExpiredEvent {
  return e.type === "credential:expired";
}

export function isVerifyStart(e: SessionEvent): e is VerifyStartEvent {
  return e.type === "verify:start";
}

export function isVerifyResult(e: SessionEvent): e is VerifyResultEvent {
  return e.type === "verify:result";
}

export function isVerifyDone(e: SessionEvent): e is VerifyDoneEvent {
  return e.type === "verify:done";
}

/** True for any verify:* event */
export function isVerifyEvent(
  e: SessionEvent,
): e is VerifyStartEvent | VerifyResultEvent | VerifyDoneEvent {
  return e.type.startsWith("verify:");
}
