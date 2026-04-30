#!/usr/bin/env node
/**
 * MCP Status Server for pilot progress updates.
 *
 * This is a stdio-based MCP server that exposes a single tool:
 *   `provide_status_update(message: string)`
 *
 * When called, it:
 *   1. Reads the session ID from the MCP protocol context
 *   2. Looks up the session in the sessions.json registry
 *   3. Applies a 60-second throttle per (runId, taskId)
 *   4. Writes a `task.progress` event to the state DB via appendEvent
 *
 * Environment variables (set by the worker before spawning):
 *   - PILOT_SESSIONS_PATH: Absolute path to the sessions.json registry
 *   - PILOT_STATE_DB_PATH: Absolute path to the state.db file
 *   - PILOT_RUN_ID: The current run ID
 *
 * The server implements a minimal JSON-RPC over stdio subset inline.
 * No external MCP SDK dependencies — this is a standalone script.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { readSessions, type SessionEntry } from "./session-registry.js";
import { canEmit, recordEmission, type ThrottleState } from "./throttle.js";

// --- Types -----------------------------------------------------------------

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type ToolCallParams = {
  name: string;
  arguments?: Record<string, unknown>;
  _meta?: {
    sessionId?: string;
    [key: string]: unknown;
  };
};

// --- Configuration ---------------------------------------------------------

const SESSIONS_PATH = process.env.PILOT_SESSIONS_PATH;
const STATE_DB_PATH = process.env.PILOT_STATE_DB_PATH;
const RUN_ID = process.env.PILOT_RUN_ID;

// Throttle state (in-memory, per-process)
const throttleState: ThrottleState = new Map();
const MIN_INTERVAL_MS = 60_000;
const MAX_MESSAGE_LENGTH = 200;

// --- Startup validation ----------------------------------------------------

if (!SESSIONS_PATH || !STATE_DB_PATH || !RUN_ID) {
  console.error(
    "Missing required environment variables: " +
      "PILOT_SESSIONS_PATH, PILOT_STATE_DB_PATH, PILOT_RUN_ID",
  );
  process.exit(1);
}

// --- JSON-RPC helpers ------------------------------------------------------

function sendResponse(resp: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(resp) + "\n");
}

function sendError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): void {
  sendResponse({
    jsonrpc: "2.0",
    id,
    error: { code, message, data },
  });
}

function sendResult(id: number | string | null, result: unknown): void {
  sendResponse({
    jsonrpc: "2.0",
    id,
    result,
  });
}

// --- Tool implementation ---------------------------------------------------

/**
 * Handle the provide_status_update tool call.
 */
function handleStatusUpdate(
  requestId: number | string | null,
  params: ToolCallParams,
): void {
  const sessionId = params._meta?.sessionId;
  const message = params.arguments?.message;

  // Validate sessionId
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    sendError(requestId, -32602, "Invalid params: missing or invalid sessionId in _meta");
    return;
  }

  // Validate message
  if (typeof message !== "string" || message.length === 0) {
    sendError(requestId, -32602, "Invalid params: message must be a non-empty string");
    return;
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    sendError(
      requestId,
      -32602,
      `Invalid params: message exceeds ${MAX_MESSAGE_LENGTH} characters`,
    );
    return;
  }

  // Look up session in registry
  const runDir = path.dirname(SESSIONS_PATH!);
  const registry = readSessions(runDir);
  const session = registry[sessionId];

  if (!session) {
    sendError(
      requestId,
      -32000,
      "Unknown session: session not found in registry",
      { sessionId },
    );
    return;
  }

  // Verify the session belongs to this run
  if (session.runId !== RUN_ID) {
    sendError(
      requestId,
      -32000,
      "Session belongs to a different run",
      { sessionId, expectedRunId: RUN_ID, actualRunId: session.runId },
    );
    return;
  }

  // Apply throttle
  const now = Date.now();
  const throttleKey = { runId: session.runId, taskId: session.taskId };
  const throttleResult = canEmit(throttleKey, now, throttleState, MIN_INTERVAL_MS);

  if (!throttleResult.ok) {
    sendResult(requestId, {
      success: false,
      throttled: true,
      retryInMs: throttleResult.retryInMs,
      message: `Throttled: try again in ${Math.ceil(throttleResult.retryInMs / 1000)}s`,
    });
    return;
  }

  // Write event to DB.
  // NOTE: We use raw SQL here (not the `appendEvent` accessor) because this
  // is a separate subprocess — the in-process fan-out in the `pilot build`
  // process can't be triggered from here. The streaming logger in `pilot build`
  // compensates by polling the DB for `task.progress` events written by this
  // subprocess. This is the correct architecture for cross-process event flow.
  try {
    const db = new Database(STATE_DB_PATH!, { readwrite: true });
    try {
      const ts = now;
      const payload = { message, sessionId };
      db.run(
        `INSERT INTO events (run_id, task_id, ts, kind, payload) VALUES (?, ?, ?, ?, ?)`,
        [session.runId, session.taskId, ts, "task.progress", JSON.stringify(payload)],
      );
    } finally {
      db.close();
    }

    // Record emission for throttle
    recordEmission(throttleKey, now, throttleState);

    sendResult(requestId, {
      success: true,
      throttled: false,
      taskId: session.taskId,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    sendError(
      requestId,
      -32000,
      `Failed to write event: ${errorMessage}`,
      { sessionId, taskId: session.taskId },
    );
  }
}

// --- MCP protocol handlers -------------------------------------------------

const TOOLS_LIST = {
  tools: [
    {
      name: "provide_status_update",
      description:
        "Emit a one-sentence progress update for the current task. " +
        "Use this to inform the user what you're working on during long-running operations. " +
        "Keep messages under 200 characters. Rate limited to once per 60 seconds.",
      inputSchema: {
        type: "object" as const,
        properties: {
          message: {
            type: "string" as const,
            description: "A one-sentence description of current progress (max 200 chars)",
          },
        },
        required: ["message"],
      },
    },
  ],
};

function handleRequest(req: JsonRpcRequest): void {
  switch (req.method) {
    case "initialize": {
      sendResult(req.id, {
        protocolVersion: "2024-11-05",
        capabilities: {},
        serverInfo: {
          name: "pilot-status-server",
          version: "0.1.0",
        },
      });
      break;
    }

    case "tools/list": {
      sendResult(req.id, TOOLS_LIST);
      break;
    }

    case "tools/call": {
      const params = req.params as ToolCallParams | undefined;
      if (!params || typeof params.name !== "string") {
        sendError(req.id, -32602, "Invalid params: expected { name: string, arguments?: object }");
        return;
      }

      if (params.name === "provide_status_update") {
        handleStatusUpdate(req.id, params);
      } else {
        sendError(req.id, -32601, `Unknown tool: ${params.name}`);
      }
      break;
    }

    default: {
      sendError(req.id, -32601, `Method not found: ${req.method}`);
    }
  }
}

// --- Main loop -------------------------------------------------------------

let buffer = "";

process.stdin.setEncoding("utf8");

process.stdin.on("data", (chunk: string) => {
  buffer += chunk;

  // Process complete lines (JSON-RPC messages are newline-delimited)
  let newlineIndex: number;
  while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);

    if (line.length === 0) continue;

    try {
      const req = JSON.parse(line) as JsonRpcRequest;
      if (req.jsonrpc !== "2.0") {
        sendError(req.id ?? null, -32600, "Invalid Request: jsonrpc must be '2.0'");
        continue;
      }
      handleRequest(req);
    } catch {
      sendError(null, -32700, "Parse error: invalid JSON");
    }
  }
});

process.stdin.on("end", () => {
  // Process any remaining data
  if (buffer.trim().length > 0) {
    try {
      const req = JSON.parse(buffer.trim()) as JsonRpcRequest;
      if (req.jsonrpc === "2.0") {
        handleRequest(req);
      }
    } catch {
      sendError(null, -32700, "Parse error: invalid JSON");
    }
  }
  process.exit(0);
});

process.stdin.on("error", (err) => {
  console.error("stdin error:", err);
  process.exit(1);
});
