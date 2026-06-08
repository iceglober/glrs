import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { __test__, buildJobsBanner, listJobs } from "../src/tools/background.js";

const { buildSpawnPlan, readJobState, tailFile, shQuote, fmtRuntime } = __test__;

type JobSummary = ReturnType<typeof listJobs>[number];
function job(p: Partial<JobSummary>): JobSummary {
  return { id: "bg-x", command: "pnpm test", status: "running", exitCode: null, startedAt: 0, ...p };
}

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

describe("buildJobsBanner", () => {
  const now = 1_000_000;

  it("returns null when nothing is running and nothing is newly finished", () => {
    expect(buildJobsBanner([], new Set(), now)).toBeNull();
    // a finished job already surfaced → still null
    const j = job({ id: "bg-done", status: "exited", exitCode: 0 });
    expect(buildJobsBanner([j], new Set(["bg-done"]), now)).toBeNull();
  });

  it("lists running jobs with runtime", () => {
    const b = buildJobsBanner([job({ id: "bg-r", startedAt: now - 130_000 })], new Set(), now)!;
    expect(b).toContain("[background jobs]");
    expect(b).toContain("bg-r");
    expect(b).toContain("running 2m 10s");
    expect(b).toContain("background_check");
  });

  it("surfaces a finished job once, marking failure", () => {
    const surfaced = new Set<string>();
    const j = job({ id: "bg-f", status: "exited", exitCode: 2, command: "./migrate.sh" });
    const first = buildJobsBanner([j], surfaced, now)!;
    expect(first).toContain("exited(2) — FAILED");
    expect(first).toContain("./migrate.sh");
    // caller would now mark it surfaced; once surfaced it drops out
    surfaced.add("bg-f");
    expect(buildJobsBanner([j], surfaced, now)).toBeNull();
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

  function makeJob(id: string, pid: number, startedAt: number, exitCode?: number) {
    const dir = path.join(root, "harness-opencode", "background-jobs", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({ id, command: `cmd ${id}`, withGsa: null, cwd: ".", pid, startedAt }),
    );
    if (exitCode !== undefined) fs.writeFileSync(path.join(dir, "exit_code"), String(exitCode));
  }

  it("enumerates jobs with status, newest first", () => {
    makeJob("bg-old", process.pid, 1000); // alive pid, no exit → running
    makeJob("bg-new", 999999, 2000, 0); // exit_code present → exited
    const jobs = listJobs();
    expect(jobs.map((j) => j.id)).toEqual(["bg-new", "bg-old"]); // sorted by startedAt desc
    expect(jobs.find((j) => j.id === "bg-old")!.status).toBe("running");
    const done = jobs.find((j) => j.id === "bg-new")!;
    expect(done.status).toBe("exited");
    expect(done.exitCode).toBe(0);
  });

  it("returns empty when the jobs dir is absent", () => {
    fs.rmSync(root, { recursive: true, force: true });
    expect(listJobs()).toEqual([]);
  });
});
