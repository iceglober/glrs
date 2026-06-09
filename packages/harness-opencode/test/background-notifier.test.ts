import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import backgroundNotifierPlugin from "../src/plugins/background-notifier.js";
import { announcedFor, buildIdleNotice, listJobs } from "../src/tools/background.js";

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
    if (prevXdg === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = prevXdg;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeJob(
    id: string,
    sessionID: string | null,
    opts: { exitCode?: number; pid?: number; title?: string | null; startedAt?: number } = {},
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

  it("does nothing when there are no fresh completions", async () => {
    const sid = "sess-running";
    makeJob("bg-live", sid, { pid: process.pid }); // alive → running, not finished
    const { client, calls } = fakeClient();
    const fire = await makeHook(client);

    await fire(sid);
    expect(calls.length).toBe(0);
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
