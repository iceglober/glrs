/**
 * Real integration test for src/lib/opencode-server.ts.
 *
 * Starts an actual OpenCode server, creates a session, and calls every
 * function exposed by the module. NO mocks — this exists because the
 * previous unit tests stubbed the SDK and missed four separate
 * wrong-shape bugs that only surfaced at runtime:
 *
 *   1. createOpencodeClient({ url }) should be { baseUrl }
 *   2. session.chat() doesn't exist; correct method is session.prompt()
 *   3. session.create's body doesn't accept `directory`/`agentID`
 *   4. event.subscribe() returns { stream }, not an AsyncIterable directly
 *   5. SDK responses come wrapped as { data, request, response } by default
 *
 * The unit tests typechecked and passed green against the wrong-shape
 * code because every call was wrapped in `as unknown as` casts that
 * hid the real SDK signatures. Never again: this test exercises the
 * full path and only trusts the ACTUAL SDK.
 *
 * Skipped if opencode isn't on PATH. Expected duration: ~5-15s (depends
 * on server startup + first prompt round-trip).
 */

import { describe, it, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  startServer,
  selfTest,
  createSession,
  getSessionCost,
  getLastAssistantMessage,
} from "../src/lib/opencode-server.js";

function opencodeAvailable(): boolean {
  try {
    execFileSync("opencode", ["--version"], { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

describe("opencode-server: real integration", () => {
  it.skipIf(!opencodeAvailable())(
    "startServer → selfTest → createSession → getSessionCost → getLastAssistantMessage",
    async () => {
      const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-server-test-"));
      const server = await startServer({ cwd: tmpCwd, timeoutMs: 30_000 });

      try {
        // Guards: server started and client can list sessions.
        expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        await selfTest(server.client);

        // Guards: session creation returns a string ID (not null/undefined,
        // not an object, not the full { data, ... } wrapper bleeding through).
        const sessionId = await createSession(server.client, { cwd: tmpCwd });
        expect(typeof sessionId).toBe("string");
        expect(sessionId.length).toBeGreaterThan(0);

        // Guards: session.get works with { path: { id } } shape and
        // returns a session object whose cost is a number (or 0 on empty).
        const cost = await getSessionCost(server.client, sessionId);
        expect(typeof cost).toBe("number");

        // Guards: session.messages works and returns an array (empty
        // for a fresh session, not null/undefined).
        const lastMsg = await getLastAssistantMessage(server.client, sessionId);
        expect(typeof lastMsg).toBe("string");
        expect(lastMsg).toBe(""); // no messages yet on a fresh session

        // We deliberately do NOT call sendAndWait here — that would
        // make a real API call to the model provider and spend tokens.
        // The wrong-shape bugs in session.prompt's argument structure
        // are caught at typecheck time now that the `as unknown as`
        // casts are gone (see typecheck passing on this file).
        // A longer-duration test that exercises sendAndWait lives in
        // the autopilot smoke-test workflow (outside CI).
      } finally {
        await server.shutdown();
        fs.rmSync(tmpCwd, { recursive: true, force: true });
      }
    },
    60_000, // 60s timeout — server startup on a cold system can be slow
  );
});
