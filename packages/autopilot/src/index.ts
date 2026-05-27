/**
 * @glrs-dev/autopilot — core autopilot engine.
 *
 * Agent-agnostic autopilot loop, plan parsing, spec management,
 * session orchestration, and all supporting utilities.
 */

// Adapter interface
export type { AgentAdapter, AgentHandle, SessionResult as AdapterSessionResult } from "./adapter.js";

// Session events
export type {
  SessionEvent,
  SessionStartEvent,
  SessionDoneEvent,
  EnrichStartEvent,
  EnrichFileStartEvent,
  EnrichFileDoneEvent,
  EnrichFileSkipEvent,
  EnrichFileErrorEvent,
  EnrichDoneEvent,
  PhaseStartEvent,
  PhaseDoneEvent,
  IterationStartEvent,
  IterationDoneEvent,
  ToolCallEvent,
  CostUpdateEvent,
  ThinkingEvent,
  ErrorEvent,
  CredentialExpiredEvent,
  VerifyStartEvent,
  VerifyResultEvent,
  VerifyDoneEvent,
} from "./session-events.js";

// Event stream
export { EventStreamWriter, EventStreamReader } from "./event-stream.js";

// Session runner
export { SessionRunner, SessionEventEmitter } from "./session-runner.js";
export type { SessionRunnerOptions, SessionResult, SessionRunnerDeps } from "./session-runner.js";

// Loop engine
export { runRalphLoop } from "./loop.js";
export type { LoopResult, LoopExitReason, RalphLoopOptions } from "./loop.js";

// Loop session orchestrator
export { runLoopSession, isSuccessExitReason } from "./loop-session.js";
export type { LoopSessionDeps } from "./loop-session.js";

// Plan parser
export { parsePlanState, parseItems } from "./plan-parser.js";
export type { PlanState, PlanItem } from "./plan-parser.js";

// Model resolver
export { resolveModel } from "./model-resolver.js";
export type { AdapterName } from "./model-resolver.js";

// Plan enrichment
export { enrichPlan, enrichPlanForFastModel } from "./plan-enrichment.js";

// Spec schema/parser/writer
export { validateMainSpec, validatePhaseSpec } from "./spec-schema.js";
export { hasSpec, readSpecGoal, readSpecConstraints, detectSpecPhases, filterUncheckedSpecPhases, parseSpecItems } from "./spec-parser.js";
export { markPhaseCompleted } from "./spec-writer.js";

// Verify runner
export { runVerifyCommands } from "./verify-runner.js";
export type { VerifyResult } from "./verify-runner.js";

// Checkpoint
export { writeCheckpoint, readCheckpoint, deleteCheckpoint } from "./checkpoint.js";
export type { Checkpoint } from "./checkpoint.js";

// Config
export {
  MAX_ITERATIONS,
  STRUGGLE_THRESHOLD,
  TIMEOUT_MS,
  STALL_MS,
  STALL_MS_DEFAULT,
  STALL_MS_BY_TIER,
  STATUS_INTERVAL_MS,
  MAX_ITERATIONS_PER_PHASE,
  MAX_ITERATIONS_PER_PHASE_BY_TIER,
} from "./config.js";

// CLI flag overrides
export { applyCLIOverrides } from "./config-reader.js";
export type { CLIFlags } from "./config-reader.js";

// Status
export { createStatusHeartbeat, formatElapsed, formatCost } from "./status.js";

// Sentinel
export { detectSentinel } from "./sentinel.js";

// Struggle
export { StruggleDetector, checkKillSwitch } from "./struggle.js";

// Git safety
export { recordHead, resetSoft } from "./git-safety.js";

// Conflict graph
export { buildConflictGraph, hasParallelism } from "./conflict-graph.js";

// Lane orchestrator
export { runLanes } from "./lane-orchestrator.js";
export type { PhaseResult } from "./lane-orchestrator.js";

// Scope validator
export { getChangedFiles, validateScope } from "./scope-validator.js";

// Plan validator
export { validatePlan } from "./plan-validator.js";

// Worktree
export { createWorktree, mergeWorktree } from "./worktree.js";
export type { WorktreeHandle } from "./worktree.js";

// Auto-ship
export { autoShip } from "./auto-ship.js";

// Session state derivation
export { deriveState } from "./session-state.js";
export type { SessionHandle, SessionStatus } from "./session-state.js";

// Changeset generator
export { generateChangeset } from "./changeset-generator.js";

// Plan session
export { runPlanSession } from "./plan-session.js";

// Loop session types (shared between loop-session.ts, plan-session.ts and CLI)
export type { LoopSessionOptions, PlanSessionOptions, PlanSessionResult } from "./loop-session-types.js";

// Scoper types (shared between interactive.ts in CLI and autopilot)
export type { ScoperSessionOptions, ScoperSessionResult } from "./scoper-types.js";

// Logger
export { createAutopilotLogger, childLogger } from "./lib/logger.js";
export type { AutopilotLogger } from "./lib/logger.js";
