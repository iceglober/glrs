// pilot-status-mcp-server.test.ts — MCP server handler tests for
// src/pilot/mcp/status-server.ts
//
// Tests the MCP server by spawning it as a subprocess and communicating
// via stdin/stdout JSON-RPC. Uses a real SQLite DB and sessions.json file.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";

let tmpDir: string;
let dbPath: string;
let sessionsPath: string;

function createStateDb(dbFile: string): void {
  const db = new Database(dbFile);
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      task_id TEXT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL
    )
  `);
  db.close();
}

function writeSessionsFile(
  filePath: string,
  sessions: Record<string, { runId: string; taskId: string }>,
): void {
  fs.writeFileSync(filePath, JSON.stringify(sessions, null, 2));
}

function readEvents(dbFile: string): Array<{
  run_id: string;
  task_id: string | null;
  kind: string;
  payload: string;
}> {
  const db = new Database(dbFile, { readonly: true });
  const rows = db.query("SELECT * FROM events ORDER BY id").all() as Array<{
    run_id: string;
    task_id: string | null;
    kind: string;
    payload: string;
  }>;
  db.close();
  return rows;
}

/**
 * Spawn the MCP server subprocess and send/receive JSON-RPC messages.
 */
function spawnMcpServer(env: Record<string, string>): {
  send: (msg: object) => void;
  readResponse: () => Promise<object>;
  close: () => void;
} {
  const serverPath = path.resolve(
    __dirname,
    "../dist/pilot/mcp/status-server.js",
  );

  const proc = spawn("bun", ["run", serverPath], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  const responses: object[] = [];
  let resolveNext: ((v: object) => void) | null = null;

  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.length === 0) continue;
      try {
        const parsed = JSON.parse(line);
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r(parsed);
        } else {
          responses.push(parsed);
        }
      } catch {
        // ignore malformed
      }
    }
  });

  return {
    send(msg: object) {
      proc.stdin!.write(JSON.stringify(msg) + "\n");
    },
    readResponse(): Promise<object> {
      if (responses.length > 0) {
        return Promise.resolve(responses.shift()!);
      }
      return new Promise((resolve) => {
        resolveNext = resolve;
      });
    },
    close() {
      proc.stdin!.end();
      proc.kill();
    },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-mcp-server-"));
  dbPath = path.join(tmpDir, "state.db");
  sessionsPath = path.join(tmpDir, "sessions.json");
  createStateDb(dbPath);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("provide_status_update", () => {
  test("writes task.progress event for known session", async () => {
    writeSessionsFile(sessionsPath, {
      "sess-abc": { runId: "run-1", taskId: "T1-SETUP" },
    });

    const server = spawnMcpServer({
      PILOT_SESSIONS_PATH: sessionsPath,
      PILOT_STATE_DB_PATH: dbPath,
      PILOT_RUN_ID: "run-1",
    });

    try {
      // Initialize
      server.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      });
      const initResp = (await server.readResponse()) as { result?: { serverInfo?: { name?: string } } };
      expect(initResp.result?.serverInfo?.name).toBe("pilot-status-server");

      // Call provide_status_update
      server.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "provide_status_update",
          arguments: { message: "writing route handler" },
          _meta: { sessionId: "sess-abc" },
        },
      });
      const resp = (await server.readResponse()) as { result?: { success?: boolean; taskId?: string } };
      expect(resp.result?.success).toBe(true);
      expect(resp.result?.taskId).toBe("T1-SETUP");

      // Verify event was written to DB
      const events = readEvents(dbPath);
      expect(events).toHaveLength(1);
      expect(events[0].run_id).toBe("run-1");
      expect(events[0].task_id).toBe("T1-SETUP");
      expect(events[0].kind).toBe("task.progress");
      const payload = JSON.parse(events[0].payload);
      expect(payload.message).toBe("writing route handler");
      expect(payload.sessionId).toBe("sess-abc");
    } finally {
      server.close();
    }
  });

  test("rejects unknown sessionId with structured error", async () => {
    writeSessionsFile(sessionsPath, {
      "sess-abc": { runId: "run-1", taskId: "T1-SETUP" },
    });

    const server = spawnMcpServer({
      PILOT_SESSIONS_PATH: sessionsPath,
      PILOT_STATE_DB_PATH: dbPath,
      PILOT_RUN_ID: "run-1",
    });

    try {
      // Initialize
      server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      await server.readResponse();

      // Call with unknown session
      server.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "provide_status_update",
          arguments: { message: "hello" },
          _meta: { sessionId: "unknown-session" },
        },
      });
      const resp = (await server.readResponse()) as { error?: { code?: number; message?: string } };
      expect(resp.error).toBeDefined();
      expect(resp.error?.code).toBe(-32000);
      expect(resp.error?.message).toContain("Unknown session");

      // Verify no event was written
      const events = readEvents(dbPath);
      expect(events).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  test("truncates messages over 200 chars", async () => {
    writeSessionsFile(sessionsPath, {
      "sess-abc": { runId: "run-1", taskId: "T1-SETUP" },
    });

    const server = spawnMcpServer({
      PILOT_SESSIONS_PATH: sessionsPath,
      PILOT_STATE_DB_PATH: dbPath,
      PILOT_RUN_ID: "run-1",
    });

    try {
      server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      await server.readResponse();

      // Send a message that exceeds 200 chars
      const longMessage = "x".repeat(250);
      server.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "provide_status_update",
          arguments: { message: longMessage },
          _meta: { sessionId: "sess-abc" },
        },
      });
      const resp = (await server.readResponse()) as { error?: { code?: number; message?: string } };
      // The server rejects messages over 200 chars
      expect(resp.error).toBeDefined();
      expect(resp.error?.code).toBe(-32602);
      expect(resp.error?.message).toContain("200 characters");
    } finally {
      server.close();
    }
  });

  test("enforces 60-second throttle per task", async () => {
    writeSessionsFile(sessionsPath, {
      "sess-abc": { runId: "run-1", taskId: "T1-SETUP" },
    });

    const server = spawnMcpServer({
      PILOT_SESSIONS_PATH: sessionsPath,
      PILOT_STATE_DB_PATH: dbPath,
      PILOT_RUN_ID: "run-1",
    });

    try {
      server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      await server.readResponse();

      // First call should succeed
      server.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "provide_status_update",
          arguments: { message: "first update" },
          _meta: { sessionId: "sess-abc" },
        },
      });
      const resp1 = (await server.readResponse()) as { result?: { success?: boolean; throttled?: boolean } };
      expect(resp1.result?.success).toBe(true);
      expect(resp1.result?.throttled).toBe(false);

      // Second call within 60s should be throttled
      server.send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "provide_status_update",
          arguments: { message: "second update" },
          _meta: { sessionId: "sess-abc" },
        },
      });
      const resp2 = (await server.readResponse()) as { result?: { success?: boolean; throttled?: boolean; retryInMs?: number } };
      expect(resp2.result?.success).toBe(false);
      expect(resp2.result?.throttled).toBe(true);
      expect(resp2.result?.retryInMs).toBeGreaterThan(0);

      // Only one event should be in the DB
      const events = readEvents(dbPath);
      expect(events).toHaveLength(1);
    } finally {
      server.close();
    }
  });
});
