import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { __test__ } from "../src/tools/background.js";

const { buildSpawnPlan, readJobState, tailFile, shQuote, fmtRuntime } = __test__;

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
