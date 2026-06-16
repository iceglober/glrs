import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import backgroundNotifierPlugin, { __test__ } from "../src/plugins/background-notifier.js";
import {
  announcedFor,
  buildIdleNotice,
  listJobs,
  softNotifiedPeriods,
} from "../src/tools/background.js";

// ---- harness ---------------------------------------------------------------

type PromptCall = { path: { id: string }; body: { parts: { type: string; text: string }[] } };

/** A fake opencode client whose session.promptAsync records (or rejects) calls. */
function fakeClient(opts: { reject?: boolean } = {}) {
  const calls: PromptCall[] = [];
  const client = {
    session: {
      async promptAsync(call: PromptCall) {
        calls.push(call);
        if (opts.reject) throw new Error("session busy");
        return {};
      },
    },
  };
  return { client, calls };
}

/** Build the plugin's event hook bound to a given client. */
async function makeHook(client: unknown) {
  const hooks = await backgroundNotifierPlugin({ client } as any);
  return (sessionID: string | undefined) =>
    hooks.event!({ event: { type: "session.idle", properties: { sessionID } } } as any);
}

type JobSummary = ReturnType<typeof listJobs>[number];
function idleText(calls: PromptCall[]): string {
  return calls[0]!.body.parts[0]!.text;
}

// ---- disk-backed jobs (mirrors background.test.ts listJobs suite) ----------

describe("background-notifier (idle channel)", () => {
  let prevXdg: string | undefined;
  let root: string;

  beforeEach(() => {
    prevXdg = process.env["XDG_STATE_HOME"];
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bgnotify-"));
    process.env["XDG_STATE_HOME"] = root;
  });
  afterEach(() => {
    __test__.clearPollers(); // a running-job idle arms a poller; don't leak timers
    softNotifiedPeriods().clear(); // module-level ledger — isolate between tests
    if (prevXdg === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = prevXdg;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeJob(
    id: string,
    sessionID: string | null,
    opts: {
      exitCode?: number;
      pid?: number;
      title?: string | null;
      startedAt?: number;
      // Soft-timeout cadence in ms; null (default) disables it so these
      // completion-channel fixtures don't accidentally fire check-ins.
      softTimeoutMs?: number | null;
    } = {},
  ) {
    const dir = path.join(root, "harness-opencode", "background-jobs", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({
        id,
        command: `cmd ${id}`,
        title: opts.title ?? null,
        sessionID,
        withGsa: null,
        cwd: ".",
        pid: opts.pid ?? 999999, // dead pid by default
        startedAt: opts.startedAt ?? 1000,
        softTimeoutMs: opts.softTimeoutMs ?? null,
      }),
    );
    if (opts.exitCode !== undefined)
      fs.writeFileSync(path.join(dir, "exit_code"), String(opts.exitCode));
  }

  it("pushes one idle notice when a finished job exists for the session", async () => {
    const sid = "sess-push";
    makeJob("bg-1", sid, { exitCode: 0, title: "Poll rollout" });
    const { client, calls } = fakeClient();
    const fire = await makeHook(client);

    await fire(sid);

    expect(calls.length).toBe(1);
    expect(calls[0]!.path.id).toBe(sid);
    const text = idleText(calls);
    expect(text).toContain("while you were idle");
    expect(text).toContain("Poll rollout — exited 0");
    expect(text).toContain("background_check job_id: bg-1");
  });

  it("does not push when there are no fresh completions, but arms a poller for running jobs", async () => {
    const sid = "sess-running";
    makeJob("bg-live", sid, { pid: process.pid }); // alive → running, not finished
    const { client, calls } = fakeClient();
    const fire = await makeHook(client);

    await fire(sid);
    expect(calls.length).toBe(0);
    // The job is still running, so the notifier must keep watching for it to
    // finish — `session.idle` won't fire again on its own when it exits.
    expect(__test__.activePollers().has(sid)).toBe(true);
  });

  it("delivers a completion that finishes AFTER the agent went idle (the regression)", async () => {
    const sid = "sess-late-finish";
    // Agent backgrounds a job and goes idle while it's still running.
    makeJob("bg-late", sid, { pid: process.pid, title: "Typecheck" });
    const { client, calls } = fakeClient();
    const fire = await makeHook(client);

    await fire(sid); // idle: nothing to push yet, poller armed
    expect(calls.length).toBe(0);
    expect(__test__.activePollers().has(sid)).toBe(true);

    // The job finishes during the idle window (exit_code appears on disk).
    fs.writeFileSync(
      path.join(root, "harness-opencode", "background-jobs", "bg-late", "exit_code"),
      "0",
    );

    // The poller's next tick delivers the notice and disarms.
    await __test__.pollOnce(client, sid);
    expect(calls.length).toBe(1);
    expect(idleText(calls)).toContain("Typecheck — exited 0");
    expect(__test__.activePollers().has(sid)).toBe(false);
  });

  it("keeps polling while a job is still running, without pushing", async () => {
    const sid = "sess-still-running";
    makeJob("bg-slow", sid, { pid: process.pid });
    const { client, calls } = fakeClient();
    const fire = await makeHook(client);

    await fire(sid);
    await __test__.pollOnce(client, sid); // job still alive → no push, stay armed
    expect(calls.length).toBe(0);
    expect(__test__.activePollers().has(sid)).toBe(true);
  });

  it("disarms the poller when the running job vanishes with no completion to report", async () => {
    const sid = "sess-vanish";
    makeJob("bg-live", sid, { pid: process.pid });
    const { client, calls } = fakeClient();
    const fire = await makeHook(client);
    await fire(sid);
    expect(__test__.activePollers().has(sid)).toBe(true);

    // The job is already announced (e.g. the tool-output channel got it) and is
    // no longer running. The poller should find nothing fresh, nothing running,
    // and stop.
    announcedFor(sid).add("bg-live");
    fs.rmSync(path.join(root, "harness-opencode", "background-jobs", "bg-live"), {
      recursive: true,
      force: true,
    });
    await __test__.pollOnce(client, sid);
    expect(calls.length).toBe(0);
    expect(__test__.activePollers().has(sid)).toBe(false);
  });

  it("ignores events without a sessionID and non-idle events", async () => {
    const sid = "sess-noid";
    makeJob("bg-x", sid, { exitCode: 0 });
    const { client, calls } = fakeClient();
    const hooks = await backgroundNotifierPlugin({ client } as any);

    await hooks.event!({ event: { type: "session.idle", properties: {} } } as any);
    await hooks.event!({ event: { type: "message.updated", properties: { sessionID: sid } } } as any);
    expect(calls.length).toBe(0);
  });

  it("does not re-announce a job already surfaced by the tool-output channel", async () => {
    const sid = "sess-dedup-tool";
    makeJob("bg-shared", sid, { exitCode: 0 });
    // Simulate the tool-output channel having already announced it.
    announcedFor(sid).add("bg-shared");

    const { client, calls } = fakeClient();
    const fire = await makeHook(client);
    await fire(sid);
    expect(calls.length).toBe(0);
  });

  it("marks jobs announced so the tool-output channel won't repeat them", async () => {
    const sid = "sess-dedup-idle";
    makeJob("bg-once", sid, { exitCode: 0 });

    const { client, calls } = fakeClient();
    const fire = await makeHook(client);
    await fire(sid);

    expect(calls.length).toBe(1);
    expect(announcedFor(sid).has("bg-once")).toBe(true);
  });

  it("converges: a second idle after a push produces no further notice", async () => {
    const sid = "sess-converge";
    makeJob("bg-c", sid, { exitCode: 0 });

    const { client, calls } = fakeClient();
    const fire = await makeHook(client);
    await fire(sid); // first idle → push
    await fire(sid); // re-entrant idle (the push's own turn ending) → nothing
    expect(calls.length).toBe(1);
  });

  it("is fail-silent when promptAsync rejects", async () => {
    const sid = "sess-reject";
    makeJob("bg-r", sid, { exitCode: 0 });

    const { client, calls } = fakeClient({ reject: true });
    const fire = await makeHook(client);
    await expect(fire(sid)).resolves.toBeUndefined();
    expect(calls.length).toBe(1); // attempted once, error swallowed
  });

  it("isolates by session: another session's finished job is not pushed", async () => {
    const sid = "sess-A";
    makeJob("bg-other", "sess-B", { exitCode: 0 });
    const { client, calls } = fakeClient();
    const fire = await makeHook(client);
    await fire(sid);
    expect(calls.length).toBe(0);
  });

  // ---- soft-timeout check-ins (the running-job heartbeat) ------------------

  it("pushes a soft check-in for a job still running past its interval", async () => {
    const sid = "sess-hb";
    const now = 1_000_000;
    // Started 5 intervals (5s) ago with a 1s cadence → period 5, overdue.
    makeJob("bg-hb", sid, { pid: process.pid, title: "Backfill", startedAt: now - 5000, softTimeoutMs: 1000 });
    const { client, calls } = fakeClient();

    const r = await __test__.deliverHeartbeats(client, sid, now);
    expect(r.delivered).toBe(true);
    expect(calls.length).toBe(1);
    const text = idleText(calls);
    expect(text).toContain("still running");
    expect(text).toContain("soft timeout, not a deadline");
    expect(text).toContain("Backfill");
    expect(text).toContain("background_check job_id: bg-hb");
  });

  it("does not re-fire within the same interval, but fires again at the next", async () => {
    const sid = "sess-hb2";
    const now = 1_000_000;
    makeJob("bg-hb2", sid, { pid: process.pid, startedAt: now - 5000, softTimeoutMs: 1000 });
    const { client, calls } = fakeClient();

    await __test__.deliverHeartbeats(client, sid, now); // period 5 → push
    await __test__.deliverHeartbeats(client, sid, now + 500); // still period 5 → nothing
    expect(calls.length).toBe(1);

    await __test__.deliverHeartbeats(client, sid, now + 1000); // period 6 → push
    expect(calls.length).toBe(2);
  });

  it("never checks in before one full interval has elapsed", async () => {
    const sid = "sess-hb3";
    const now = 1_000_000;
    makeJob("bg-young", sid, { pid: process.pid, startedAt: now - 500, softTimeoutMs: 1000 }); // period 0
    const { client, calls } = fakeClient();
    await __test__.deliverHeartbeats(client, sid, now);
    expect(calls.length).toBe(0);
  });

  it("does not check in when the cadence is disabled (softTimeoutMs null)", async () => {
    const sid = "sess-hb4";
    const now = 1_000_000;
    makeJob("bg-off", sid, { pid: process.pid, startedAt: now - 999999, softTimeoutMs: null });
    const { client, calls } = fakeClient();
    await __test__.deliverHeartbeats(client, sid, now);
    expect(calls.length).toBe(0);
  });

  it("does not check in on a job that already finished", async () => {
    const sid = "sess-hb5";
    const now = 1_000_000;
    makeJob("bg-done", sid, { exitCode: 0, startedAt: now - 999999, softTimeoutMs: 1000 });
    const { client, calls } = fakeClient();
    await __test__.deliverHeartbeats(client, sid, now);
    expect(calls.length).toBe(0);
  });

  it("idle handler delivers a soft check-in (not a completion) for an overdue running job", async () => {
    const sid = "sess-hb-idle";
    // startedAt deep in the past with a 1-min cadence → overdue under any real clock.
    makeJob("bg-idle-hb", sid, { pid: process.pid, title: "Watcher", startedAt: 1000, softTimeoutMs: 60_000 });
    const { client, calls } = fakeClient();
    const fire = await makeHook(client);

    await fire(sid);
    expect(calls.length).toBe(1);
    expect(idleText(calls)).toContain("still running");
    // Still running → keeps watching for completion / the next interval.
    expect(__test__.activePollers().has(sid)).toBe(true);
  });
});

describe("buildIdleNotice", () => {
  function job(p: Partial<JobSummary>): JobSummary {
    return {
      id: "bg-x",
      command: "cmd",
      title: null,
      sessionID: "s",
      status: "exited",
      exitCode: 0,
      startedAt: 0,
      softTimeoutMs: null,
      ...p,
    };
  }

  it("wraps the completion notice with idle framing and a how-to-react line", () => {
    const n = buildIdleNotice([job({ id: "bg-1", title: "Backfill", exitCode: 0 })]);
    expect(n).toContain("1 background job you launched finished while you were idle");
    expect(n).toContain("Backfill — exited 0");
    expect(n).toContain("background_check job_id: bg-1");
    expect(n).toContain("If this completes what you were waiting on");
  });

  it("pluralizes the job count", () => {
    const n = buildIdleNotice([
      job({ id: "bg-1", exitCode: 0 }),
      job({ id: "bg-2", exitCode: 1 }),
    ]);
    expect(n).toContain("2 background jobs you launched finished");
  });
});
