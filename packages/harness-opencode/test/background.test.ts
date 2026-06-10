import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  __test__,
  listJobs,
  jobLabel,
  selectFreshCompletions,
  buildCompletionNotice,
  leadingSleepSeconds,
  timerPollRejection,
} from "../src/tools/background.js";

const { buildSpawnPlan, readJobState, tailFile, shQuote, fmtRuntime } = __test__;

type JobSummary = ReturnType<typeof listJobs>[number];
function job(p: Partial<JobSummary>): JobSummary {
  return {
    id: "bg-x",
    command: "pnpm test",
    title: null,
    sessionID: null,
    status: "running",
    exitCode: null,
    startedAt: 0,
    ...p,
  };
}

describe("leadingSleepSeconds — timer-poll detection", () => {
  // Regression guard for the stranded-session incident: PRIME backgrounded
  // `sleep 180 && <CI check>`, the job fired before CI settled, no watcher
  // remained, and the arc hung until the user poked it.
  it("detects sleep-then-check timer polls", () => {
    expect(leadingSleepSeconds("sleep 180 && gh api .../check-runs | jq .")).toBe(180);
    expect(leadingSleepSeconds("  sleep 30; gh pr checks 42")).toBe(30);
    expect(leadingSleepSeconds("sleep 5")).toBe(5);
    expect(leadingSleepSeconds("sleep 2.5 && foo")).toBe(2.5);
  });

  it("does NOT flag watcher loops or commands that merely contain sleep", () => {
    // until-loop watchers sleep INSIDE the loop — the command exits when the
    // condition settles, which is exactly the pattern we want.
    expect(leadingSleepSeconds("until gh pr checks 42 | grep -qv pending; do sleep 30; done")).toBeNull();
    expect(leadingSleepSeconds("gh run watch 123")).toBeNull();
    expect(leadingSleepSeconds("while true; do sleep 5; done")).toBeNull();
    expect(leadingSleepSeconds("./sleep-study.sh")).toBeNull();
    expect(leadingSleepSeconds("sleeper --daemon")).toBeNull();
  });

  it("rejection message teaches the watcher patterns", () => {
    const msg = timerPollRejection(180);
    expect(msg).toContain("Rejected");
    expect(msg).toContain("gh pr checks");
    expect(msg).toContain("until <settled-check>");
    expect(msg).toContain("nothing will ever wake you");
  });
});

describe("buildSpawnPlan", () => {
  it("plain command: sh -c wrapper that records the exit code", () => {
    const plan = buildSpawnPlan("pnpm test", "/jobs/x/exit_code");
    expect(plan.file).toBe("sh");
    expect(plan.argv[0]).toBe("-c");
    expect(plan.argv[1]).toContain("pnpm test");
    // command runs in a subshell so a bare `exit` can't skip the capture
    expect(plan.argv[1]).toContain("(\npnpm test\n)");
    // exit code of the command is captured to the file
    expect(plan.argv[1]).toContain(`printf '%s' "$?" > '/jobs/x/exit_code'`);
  });

  it("with_gsa: wraps in glrs-assume exec -c <context>", () => {
    const plan = buildSpawnPlan("./run.sh", "/jobs/y/exit_code", "production / developer", "glrs-assume");
    expect(plan.file).toBe("glrs-assume");
    expect(plan.argv.slice(0, 4)).toEqual(["exec", "-c", "production / developer", "sh"]);
    expect(plan.argv[4]).toBe("-c");
    expect(plan.argv[5]).toContain("./run.sh");
    expect(plan.argv[5]).toContain("exit_code");
  });

  it("shQuote escapes embedded single quotes", () => {
    expect(shQuote("/a/b")).toBe("'/a/b'");
    expect(shQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("readJobState", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgjob-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeMeta(pid: number) {
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({ id: "t", command: "x", withGsa: null, cwd: ".", pid, startedAt: Date.now() }),
    );
  }

  it("exited with code when exit_code file present", () => {
    writeMeta(999999);
    fs.writeFileSync(path.join(dir, "exit_code"), "0");
    expect(readJobState(dir)).toEqual({ status: "exited", exitCode: 0 });
    fs.writeFileSync(path.join(dir, "exit_code"), "2");
    expect(readJobState(dir)).toEqual({ status: "exited", exitCode: 2 });
  });

  it("running when pid is alive and no exit code", () => {
    writeMeta(process.pid); // this test process is definitely alive
    expect(readJobState(dir)).toEqual({ status: "running", exitCode: null });
  });

  it("failed when pid is dead and no exit code", () => {
    writeMeta(999999); // not a live pid
    expect(readJobState(dir).status).toBe("failed");
  });

  it("unknown when no meta", () => {
    expect(readJobState(dir).status).toBe("unknown");
  });
});

describe("tailFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgtail-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns whole file when short, truncates when long", () => {
    const p = path.join(dir, "out.log");
    fs.writeFileSync(p, "short");
    expect(tailFile(p, 100)).toBe("short");
    fs.writeFileSync(p, "x".repeat(50));
    const t = tailFile(p, 10);
    expect(t).toContain("truncated");
    expect(t.endsWith("x".repeat(10))).toBe(true);
  });

  it("returns empty string for a missing file", () => {
    expect(tailFile(path.join(dir, "nope.log"))).toBe("");
  });
});

describe("fmtRuntime", () => {
  it("formats seconds and minutes", () => {
    const now = 1_000_000;
    expect(fmtRuntime(now - 5_000, now)).toBe("5s");
    expect(fmtRuntime(now - 95_000, now)).toBe("1m 35s");
  });
});

describe("jobLabel", () => {
  it("prefers a non-empty title, else falls back to the command", () => {
    expect(jobLabel({ title: "Deploy prod", command: "./deploy.sh" })).toBe("Deploy prod");
    expect(jobLabel({ title: null, command: "./deploy.sh" })).toBe("./deploy.sh");
    expect(jobLabel({ title: "  ", command: "./deploy.sh" })).toBe("./deploy.sh");
  });
});

describe("selectFreshCompletions", () => {
  it("returns only THIS session's finished, un-announced jobs", () => {
    const jobs = [
      job({ id: "a", sessionID: "s1", status: "exited", exitCode: 0 }),
      job({ id: "b", sessionID: "s1", status: "running" }), // not finished
      job({ id: "c", sessionID: "s2", status: "exited", exitCode: 0 }), // other session
      job({ id: "d", sessionID: null, status: "exited", exitCode: 0 }), // global/legacy — excluded
      job({ id: "e", sessionID: "s1", status: "failed" }),
    ];
    const announced = new Set<string>();
    const fresh = selectFreshCompletions(jobs, "s1", announced);
    expect(fresh.map((j) => j.id).sort()).toEqual(["a", "e"]);
  });

  it("excludes already-announced jobs", () => {
    const jobs = [job({ id: "a", sessionID: "s1", status: "exited", exitCode: 0 })];
    expect(selectFreshCompletions(jobs, "s1", new Set(["a"]))).toEqual([]);
  });
});

describe("buildCompletionNotice", () => {
  it("formats title + exit status, points at background_check", () => {
    const n = buildCompletionNotice([
      job({ id: "bg-1", title: "Poll PR #2478", status: "exited", exitCode: 0 }),
    ]);
    expect(n).toContain("[background] 1 job finished");
    expect(n).toContain("Poll PR #2478 — exited 0");
    expect(n).toContain("background_check job_id: bg-1");
  });

  it("marks non-zero exits as FAILED and pluralizes", () => {
    const n = buildCompletionNotice([
      job({ id: "bg-1", command: "./a.sh", status: "exited", exitCode: 0 }),
      job({ id: "bg-2", command: "./b.sh", status: "exited", exitCode: 2 }),
    ]);
    expect(n).toContain("2 jobs finished");
    expect(n).toContain("exited 2 — FAILED");
  });

  it("caps the list and notes the overflow", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      job({ id: `bg-${i}`, command: `c${i}`, status: "exited", exitCode: 0 }),
    );
    const n = buildCompletionNotice(many, 3);
    expect(n).toContain("5 jobs finished");
    expect((n.match(/background_check job_id/g) ?? []).length).toBe(3);
    expect(n).toContain("(+2 more — background_list)");
  });
});

describe("listJobs", () => {
  let prevXdg: string | undefined;
  let root: string;
  beforeEach(() => {
    prevXdg = process.env["XDG_STATE_HOME"];
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bglist-"));
    process.env["XDG_STATE_HOME"] = root;
  });
  afterEach(() => {
    if (prevXdg === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = prevXdg;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeJob(
    id: string,
    pid: number,
    startedAt: number,
    exitCode?: number,
    title: string | null = null,
    sessionID: string | null = null,
  ) {
    const dir = path.join(root, "harness-opencode", "background-jobs", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({ id, command: `cmd ${id}`, title, sessionID, withGsa: null, cwd: ".", pid, startedAt }),
    );
    if (exitCode !== undefined) fs.writeFileSync(path.join(dir, "exit_code"), String(exitCode));
  }

  it("enumerates jobs with status + title, newest first", () => {
    makeJob("bg-old", process.pid, 1000, undefined, "watch tests"); // alive pid, no exit → running
    makeJob("bg-new", 999999, 2000, 0); // exit_code present → exited; no title
    const jobs = listJobs();
    expect(jobs.map((j) => j.id)).toEqual(["bg-new", "bg-old"]); // sorted by startedAt desc
    const old = jobs.find((j) => j.id === "bg-old")!;
    expect(old.status).toBe("running");
    expect(old.title).toBe("watch tests");
    const done = jobs.find((j) => j.id === "bg-new")!;
    expect(done.status).toBe("exited");
    expect(done.exitCode).toBe(0);
    expect(done.title).toBeNull();
  });

  it("returns empty when the jobs dir is absent", () => {
    fs.rmSync(root, { recursive: true, force: true });
    expect(listJobs()).toEqual([]);
  });

  it("isolates by session, treating session-less jobs as global", () => {
    makeJob("bg-s1", 999999, 100, 0, null, "sess-1");
    makeJob("bg-s2", 999999, 200, 0, null, "sess-2");
    makeJob("bg-global", 999999, 300, 0, null, null); // no session → global
    // unfiltered: all three
    expect(listJobs().map((j) => j.id).sort()).toEqual(["bg-global", "bg-s1", "bg-s2"]);
    // session 1: its own + the global one, NOT session 2's
    expect(listJobs("sess-1").map((j) => j.id).sort()).toEqual(["bg-global", "bg-s1"]);
    expect(listJobs("sess-2").map((j) => j.id).sort()).toEqual(["bg-global", "bg-s2"]);
    expect(listJobs("sess-1").find((j) => j.id === "bg-s1")!.sessionID).toBe("sess-1");
  });
});
