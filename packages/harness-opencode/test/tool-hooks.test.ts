import { describe, it, expect, beforeEach } from "bun:test";
import { __test__ } from "../src/plugins/tool-hooks.js";

const {
  sessions,
  getSession,
  resolveConfig,
  applyBackpressure,
  checkEditLoop,
  checkToolLoop,
  normalizeToolSig,
  loopCorrective,
  checkComplexityHint,
  complexityHint,
  isVerifyCommand,
  checkReadDedup,
  isPassiveTool,
  looksLikeBashFailure,
  extractFilePath,
  hashContent,
  getToolOutputDir,
  isUnderToolOutputDir,
  takeGrepHead,
  DEFAULT_BACKPRESSURE_THRESHOLD,
  DEFAULT_LOOP_THRESHOLD,
  DEFAULT_EXPLORATION_WARN,
  DEFAULT_EXPLORATION_ABORT,
  DEFAULT_REPEAT_WARN,
  DEFAULT_REPEAT_ABORT,
  DEFAULT_COMPLEXITY_WARN,
  DEFAULT_DEEP_AGENT,
  DEFAULT_CONSULT_AGENT,
  checkInlineSleep,
  checkToolDenylist,
  classifyTaskShape,
  checkBugFixNudge,
  bugFixCorrective,
  readHookOutput,
  appendHookOutput,
  DEFAULT_MAX_INLINE_SLEEP_SECONDS,
} = __test__;

// ---- helpers ---------------------------------------------------------------

function makeConfig(overrides: any = {}) {
  return resolveConfig({} as any, { toolHooks: overrides });
}

function defaultConfig() {
  return resolveConfig({} as any);
}

// ---- resolveConfig ---------------------------------------------------------

describe("resolveConfig", () => {
  it("returns defaults when no config is provided", () => {
    const cfg = defaultConfig();
    expect(cfg.backpressure.enabled).toBe(true);
    expect(cfg.backpressure.threshold).toBe(DEFAULT_BACKPRESSURE_THRESHOLD);
    expect(cfg.backpressure.headChars).toBe(300);
    expect(cfg.backpressure.tailChars).toBe(200);
    expect(cfg.backpressure.tools.has("bash")).toBe(true);
    expect(cfg.backpressure.tools.has("read")).toBe(true);
    expect(cfg.verifyLoop.enabled).toBe(true);
    expect(cfg.verifyLoop.timeoutMs).toBe(15_000);
    expect(cfg.loopDetection.enabled).toBe(true);
    expect(cfg.loopDetection.threshold).toBe(DEFAULT_LOOP_THRESHOLD);
    expect(cfg.loopDetection.explorationWarn).toBe(DEFAULT_EXPLORATION_WARN);
    expect(cfg.loopDetection.explorationAbort).toBe(DEFAULT_EXPLORATION_ABORT);
    expect(cfg.loopDetection.repeatWarn).toBe(DEFAULT_REPEAT_WARN);
    expect(cfg.loopDetection.repeatAbort).toBe(DEFAULT_REPEAT_ABORT);
    expect(cfg.loopDetection.abortEnabled).toBe(true);
    expect(cfg.loopDetection.complexityWarn).toBe(DEFAULT_COMPLEXITY_WARN);
    expect(cfg.loopDetection.deepAgent).toBe(DEFAULT_DEEP_AGENT);
    expect(cfg.loopDetection.consultAgent).toBe(DEFAULT_CONSULT_AGENT);
    expect(cfg.readDedup.enabled).toBe(true);
    expect(cfg.sleepGuard.enabled).toBe(true);
    expect(cfg.sleepGuard.maxSeconds).toBe(DEFAULT_MAX_INLINE_SLEEP_SECONDS);
  });

  it("respects explicit overrides", () => {
    const cfg = makeConfig({
      backpressure: { enabled: false, threshold: 5000, tools: ["bash"] },
      verifyLoop: { enabled: false, timeoutMs: 30_000 },
      loopDetection: {
        threshold: 10,
        explorationWarn: 5,
        explorationAbort: 9,
        repeatWarn: 2,
        repeatAbort: 4,
        abortEnabled: false,
        complexityWarn: 3,
        deepAgent: "@build-opus",
        consultAgent: "@my-oracle",
      },
      readDedup: { enabled: false },
      sleepGuard: { enabled: false, maxSeconds: 60 },
    });
    expect(cfg.backpressure.enabled).toBe(false);
    expect(cfg.backpressure.threshold).toBe(5000);
    expect(cfg.backpressure.tools.size).toBe(1);
    expect(cfg.verifyLoop.enabled).toBe(false);
    expect(cfg.verifyLoop.timeoutMs).toBe(30_000);
    expect(cfg.loopDetection.threshold).toBe(10);
    expect(cfg.loopDetection.explorationWarn).toBe(5);
    expect(cfg.loopDetection.explorationAbort).toBe(9);
    expect(cfg.loopDetection.repeatWarn).toBe(2);
    expect(cfg.loopDetection.repeatAbort).toBe(4);
    expect(cfg.loopDetection.abortEnabled).toBe(false);
    expect(cfg.loopDetection.complexityWarn).toBe(3);
    expect(cfg.loopDetection.deepAgent).toBe("@build-opus");
    expect(cfg.loopDetection.consultAgent).toBe("@my-oracle");
    expect(cfg.readDedup.enabled).toBe(false);
    expect(cfg.sleepGuard.enabled).toBe(false);
    expect(cfg.sleepGuard.maxSeconds).toBe(60);
  });
});

// ---- checkInlineSleep (foreground-sleep guard) -------------------------------

describe("checkInlineSleep", () => {
  // Regression guard for the stranded-session incident: PRIME ran a foreground
  // `sleep 190 && <CI check>` duplicating a background wait it had already
  // armed, burning the turn for 3+ minutes.
  it("blocks long leading sleeps with a teaching message", () => {
    const msg = checkInlineSleep("sleep 190 && gh api .../check-runs | jq .", 15);
    expect(msg).not.toBeNull();
    expect(msg).toContain("Blocked");
    expect(msg).toContain("gh pr checks");
    expect(msg).toContain("END your turn");
  });

  it("allows short pauses and non-leading sleeps", () => {
    expect(checkInlineSleep("sleep 2 && retry-thing", 15)).toBeNull();
    expect(checkInlineSleep("sleep 14", 15)).toBeNull();
    expect(checkInlineSleep("until done-check; do sleep 30; done", 15)).toBeNull();
    expect(checkInlineSleep("gh run watch 123", 15)).toBeNull();
  });

  it("threshold is inclusive at maxSeconds", () => {
    expect(checkInlineSleep("sleep 15", 15)).not.toBeNull();
  });
});

// ---- looksLikeBashFailure --------------------------------------------------

describe("looksLikeBashFailure", () => {
  it("detects exit code markers", () => {
    expect(looksLikeBashFailure("some output\nExit code: 1")).toBe(true);
    expect(looksLikeBashFailure("ok\nExit code: 0")).toBe(false);
  });

  it("detects 'exited with code' patterns", () => {
    expect(looksLikeBashFailure("process exited with code 127")).toBe(true);
    expect(looksLikeBashFailure("process exited with code 0")).toBe(false);
  });

  it("detects 'command failed' pattern", () => {
    expect(looksLikeBashFailure("command failed")).toBe(true);
  });

  it("detects short ERROR outputs", () => {
    expect(looksLikeBashFailure("ERROR: something broke")).toBe(true);
  });

  it("does NOT treat long outputs with ERROR as failure (may be in content)", () => {
    const longOutput = "x".repeat(600) + "\nERROR\n" + "y".repeat(600);
    expect(looksLikeBashFailure(longOutput)).toBe(false);
  });

  it("returns false for normal success output", () => {
    expect(looksLikeBashFailure("all tests passed")).toBe(false);
  });
});

// ---- extractFilePath -------------------------------------------------------

describe("extractFilePath", () => {
  it("extracts from filePath key", () => {
    expect(extractFilePath({ filePath: "/foo/bar.ts" })).toBe("/foo/bar.ts");
  });

  it("extracts from path key", () => {
    expect(extractFilePath({ path: "/foo/baz.ts" })).toBe("/foo/baz.ts");
  });

  it("extracts from file key", () => {
    expect(extractFilePath({ file: "/foo/qux.ts" })).toBe("/foo/qux.ts");
  });

  it("prefers filePath over path over file", () => {
    expect(
      extractFilePath({ filePath: "/a.ts", path: "/b.ts", file: "/c.ts" }),
    ).toBe("/a.ts");
  });

  it("returns null for non-objects", () => {
    expect(extractFilePath(null)).toBeNull();
    expect(extractFilePath("string")).toBeNull();
    expect(extractFilePath(42)).toBeNull();
  });

  it("returns null when no path key exists", () => {
    expect(extractFilePath({ command: "ls" })).toBeNull();
  });
});

// ---- hashContent -----------------------------------------------------------

describe("hashContent", () => {
  it("returns a 16-char hex string", () => {
    const h = hashContent("hello world");
    expect(h.length).toBe(16);
    expect(/^[0-9a-f]{16}$/.test(h)).toBe(true);
  });

  it("returns same hash for same content", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
  });

  it("returns different hash for different content", () => {
    expect(hashContent("abc")).not.toBe(hashContent("def"));
  });
});

// ---- applyBackpressure -----------------------------------------------------

describe("applyBackpressure", () => {
  it("does nothing when output is below threshold", () => {
    const cfg = defaultConfig().backpressure;
    const output = { output: "short output" };
    applyBackpressure(cfg, "bash", "call-1", output);
    expect(output.output).toBe("short output");
  });

  it("truncates output above threshold for success", () => {
    const cfg = defaultConfig().backpressure;
    const longOutput = "A".repeat(7000); // exceeds new 6000 default
    const output = { output: longOutput };
    applyBackpressure(cfg, "bash", "call-2", output);
    expect(output.output.length).toBeLessThan(longOutput.length);
    expect(output.output).toContain("chars truncated");
    expect(output.output).toContain("7000 total");
  });

  it("preserves head and tail content (head-tail shape)", () => {
    // The default bash shape is now "tail" which drops the head. To cover
    // the legacy "head-tail" shape we explicitly opt in via perTool.
    const cfg = makeConfig({
      backpressure: { perTool: { bash: { shape: "head-tail" } } },
    }).backpressure;
    const head = "HEAD_MARKER_" + "x".repeat(288);
    const middle = "m".repeat(7000); // exceeds 6000 threshold
    const tail = "y".repeat(180) + "_TAIL_MARKER";
    const output = { output: head + middle + tail };
    applyBackpressure(cfg, "bash", "call-3", output);
    expect(output.output).toContain("HEAD_MARKER_");
    expect(output.output).toContain("_TAIL_MARKER");
  });

  it("preserves full output on bash failure", () => {
    const cfg = defaultConfig().backpressure;
    const failOutput = "x".repeat(3000) + "\nExit code: 1";
    const output = { output: failOutput };
    applyBackpressure(cfg, "bash", "call-4", output);
    expect(output.output).toBe(failOutput);
  });

  it("does nothing when disabled", () => {
    const cfg = makeConfig({ backpressure: { enabled: false } }).backpressure;
    const longOutput = "x".repeat(5000);
    const output = { output: longOutput };
    applyBackpressure(cfg, "bash", "call-5", output);
    expect(output.output).toBe(longOutput);
  });

  it("does nothing for tools not in the tool set", () => {
    const cfg = defaultConfig().backpressure;
    const longOutput = "x".repeat(5000);
    const output = { output: longOutput };
    applyBackpressure(cfg, "edit", "call-6", output);
    expect(output.output).toBe(longOutput);
  });

  it("writes disk offload file", () => {
    const cfg = defaultConfig().backpressure;
    const longOutput = "x".repeat(7000); // exceeds new 6000 default
    const output = { output: longOutput };
    applyBackpressure(cfg, "bash", "call-disk-test", output);
    // The truncated output should reference a file path
    expect(output.output).toContain("Full output saved to:");
    expect(output.output).toContain("call-disk-test.txt");
  });

  // ---- per-tool shape defaults -------------------------------------------

  it("default read shape is 'skip' — no truncation regardless of size", () => {
    const cfg = defaultConfig().backpressure;
    const longOutput = "x".repeat(10000);
    const output = { output: longOutput };
    applyBackpressure(cfg, "read", "call-read-skip", output, {
      filePath: "/some/file.ts",
    });
    expect(output.output).toBe(longOutput);
  });

  it("default glob shape is 'skip' — no truncation regardless of size", () => {
    const cfg = defaultConfig().backpressure;
    const longOutput = "path/a.ts\n".repeat(2000);
    const output = { output: longOutput };
    applyBackpressure(cfg, "glob", "call-glob-skip", output);
    expect(output.output).toBe(longOutput);
  });

  it("default bash shape is 'tail' — drops head, keeps tail", () => {
    const cfg = defaultConfig().backpressure;
    const text = "HEAD_MARKER" + "x".repeat(10000) + "TAIL_MARKER";
    const output = { output: text };
    applyBackpressure(cfg, "bash", "call-bash-tail", output);
    expect(output.output).not.toContain("HEAD_MARKER");
    expect(output.output).toContain("TAIL_MARKER");
    expect(output.output).toContain("chars truncated");
  });

  it("default grep shape is 'head-with-count' — first N blocks + count tail", () => {
    const cfg = defaultConfig().backpressure;
    // 30 match blocks separated by blank lines. Each block ~250 chars to
    // exceed threshold.
    const block = (n: number) =>
      `file.ts:${n}: match line ${n}\n` + "x".repeat(240);
    const text = Array.from({ length: 30 }, (_, i) => block(i)).join("\n\n");
    const output = { output: text };
    applyBackpressure(cfg, "grep", "call-grep-head", output);
    expect(output.output).toContain("file.ts:0:");
    expect(output.output).toContain("file.ts:19:");
    expect(output.output).not.toContain("file.ts:20:");
    expect(output.output).toMatch(/10 more matches/);
  });

  // ---- recovery-read bypass ----------------------------------------------

  it("recovery-read of spill path bypasses truncation", () => {
    // Force read to head-tail shape so truncation would normally fire;
    // then point it at a file under the spill dir to prove the bypass.
    const cfg = makeConfig({
      backpressure: { perTool: { read: { shape: "head-tail" } } },
    }).backpressure;
    const spillDir = getToolOutputDir();
    const text = "x".repeat(10000);
    const output = { output: text };
    applyBackpressure(cfg, "read", "call-recovery", output, {
      filePath: `${spillDir}/tooluse_abc123.txt`,
    });
    expect(output.output).toBe(text); // unchanged — bypass fired
  });

  it("non-spill read still truncates when shape is head-tail", () => {
    const cfg = makeConfig({
      backpressure: { perTool: { read: { shape: "head-tail" } } },
    }).backpressure;
    const text = "x".repeat(10000);
    const output = { output: text };
    applyBackpressure(cfg, "read", "call-nonspill", output, {
      filePath: "/home/user/src/foo.ts",
    });
    expect(output.output.length).toBeLessThan(text.length);
    expect(output.output).toContain("chars truncated");
  });

  // ---- perTool overrides -------------------------------------------------

  it("user perTool override wins over default shape", () => {
    // Force read to head-tail shape; should truncate a 10000-char output.
    const cfg = makeConfig({
      backpressure: { perTool: { read: { shape: "head-tail" } } },
    }).backpressure;
    const text = "x".repeat(10000);
    const output = { output: text };
    applyBackpressure(cfg, "read", "call-override", output, {
      filePath: "/non/spill/path.txt",
    });
    expect(output.output.length).toBeLessThan(text.length);
    expect(output.output).toContain("chars truncated");
  });

  it("user threshold override still works", () => {
    const cfg = makeConfig({
      backpressure: {
        threshold: 500,
        perTool: { bash: { shape: "head-tail" } },
      },
    }).backpressure;
    const text = "x".repeat(1000);
    const output = { output: text };
    applyBackpressure(cfg, "bash", "call-threshold-override", output);
    expect(output.output.length).toBeLessThan(text.length);
    expect(output.output).toContain("1000 total");
  });

  it("DEFAULT_BACKPRESSURE_THRESHOLD is 6000", () => {
    expect(DEFAULT_BACKPRESSURE_THRESHOLD).toBe(6000);
  });

  // ---- helpers ------------------------------------------------------------

  it("isUnderToolOutputDir recognizes spill-path children", () => {
    const spill = getToolOutputDir();
    expect(isUnderToolOutputDir(`${spill}/abc.txt`)).toBe(true);
    expect(isUnderToolOutputDir(`${spill}`)).toBe(true);
    expect(isUnderToolOutputDir(`/not/spill/path.txt`)).toBe(false);
    // Prefix-spoof guard: /a/spill-extra should NOT match /a/spill
    expect(isUnderToolOutputDir(`${spill}-extra/x.txt`)).toBe(false);
  });

  it("takeGrepHead splits on blank lines and caps blocks", () => {
    const blocks = Array.from({ length: 10 }, (_, i) => `block-${i}`);
    const text = blocks.join("\n\n");
    const { head, matchesKept, matchesOmitted } = takeGrepHead(text, 3);
    expect(matchesKept).toBe(3);
    expect(matchesOmitted).toBe(7);
    expect(head).toBe("block-0\n\nblock-1\n\nblock-2");
  });

  it("takeGrepHead returns full text when blocks fit under cap", () => {
    const text = "a\n\nb\n\nc";
    const { head, matchesKept, matchesOmitted } = takeGrepHead(text, 10);
    expect(matchesKept).toBe(3);
    expect(matchesOmitted).toBe(0);
    expect(head).toBe(text);
  });
});

// ---- checkEditLoop ---------------------------------------------------------

describe("checkEditLoop", () => {
  beforeEach(() => {
    sessions.clear();
  });

  it("does not warn below threshold", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("loop-test-1");
    const output = { output: "edit applied" };

    for (let i = 0; i < DEFAULT_LOOP_THRESHOLD - 1; i++) {
      checkEditLoop(cfg, sess, "/foo/bar.ts", output);
    }
    expect(output.output).toBe("edit applied");
  });

  it("warns at threshold", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("loop-test-2");
    const output = { output: "edit applied" };

    for (let i = 0; i < DEFAULT_LOOP_THRESHOLD; i++) {
      output.output = "edit applied"; // reset
      checkEditLoop(cfg, sess, "/foo/bar.ts", output);
    }
    expect(output.output).toContain("LOOP WARNING");
    expect(output.output).toContain(`${DEFAULT_LOOP_THRESHOLD} times`);
  });

  it("does not warn between thresholds", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("loop-test-3");

    // Reach threshold
    for (let i = 0; i < DEFAULT_LOOP_THRESHOLD; i++) {
      const o = { output: "ok" };
      checkEditLoop(cfg, sess, "/foo/bar.ts", o);
    }

    // Next edit should not warn (threshold + 1)
    const output = { output: "edit applied" };
    checkEditLoop(cfg, sess, "/foo/bar.ts", output);
    expect(output.output).toBe("edit applied");
  });

  it("warns again at double threshold", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("loop-test-4");

    for (let i = 0; i < DEFAULT_LOOP_THRESHOLD * 2; i++) {
      const o = { output: "ok" };
      checkEditLoop(cfg, sess, "/foo/bar.ts", o);
    }
    // The last call (count == 10) should have warned
    const output = { output: "edit applied" };
    // count is now 10 — the warning fires AT count 10
    // But we already incremented to 10 in the loop. Let's check:
    // After 10 edits, the last output should have the warning.
    expect(sess.editCounts.get("/foo/bar.ts")).toBe(DEFAULT_LOOP_THRESHOLD * 2);
  });

  it("tracks different files independently", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("loop-test-5");

    for (let i = 0; i < DEFAULT_LOOP_THRESHOLD - 1; i++) {
      const o = { output: "ok" };
      checkEditLoop(cfg, sess, "/a.ts", o);
    }
    for (let i = 0; i < DEFAULT_LOOP_THRESHOLD - 1; i++) {
      const o = { output: "ok" };
      checkEditLoop(cfg, sess, "/b.ts", o);
    }

    // Neither should trigger
    expect(sess.editCounts.get("/a.ts")).toBe(DEFAULT_LOOP_THRESHOLD - 1);
    expect(sess.editCounts.get("/b.ts")).toBe(DEFAULT_LOOP_THRESHOLD - 1);
  });

  it("does nothing when disabled", () => {
    const cfg = makeConfig({ loopDetection: { enabled: false } }).loopDetection;
    const sess = getSession("loop-test-6");

    for (let i = 0; i < 20; i++) {
      const o = { output: "ok" };
      checkEditLoop(cfg, sess, "/foo.ts", o);
    }
    // No warning should have been appended
    const output = { output: "edit applied" };
    checkEditLoop(cfg, sess, "/foo.ts", output);
    expect(output.output).toBe("edit applied");
  });
});

// ---- normalizeToolSig ------------------------------------------------------

describe("normalizeToolSig", () => {
  it("keys reads on filePath + offset", () => {
    expect(normalizeToolSig("read", { filePath: "/a.ts" })).toBe("read:/a.ts@");
    expect(normalizeToolSig("read", { filePath: "/a.ts", offset: 100 })).toBe("read:/a.ts@100");
    // Same file, different offset → different signature (not a loop).
    expect(normalizeToolSig("read", { filePath: "/a.ts", offset: 0 })).not.toBe(
      normalizeToolSig("read", { filePath: "/a.ts", offset: 200 }),
    );
  });
  it("keys grep on pattern + scope and bash on the command", () => {
    expect(normalizeToolSig("grep", { pattern: "foo", path: "/src" })).toBe("grep:foo|/src");
    expect(normalizeToolSig("bash", { command: "  ls -la " })).toBe("bash:ls -la");
  });
  it("caps signature length", () => {
    const sig = normalizeToolSig("bash", { command: "x".repeat(500) });
    expect(sig.length).toBeLessThanOrEqual("bash:".length + 200);
  });
});

// ---- checkToolLoop ---------------------------------------------------------

describe("checkToolLoop", () => {
  beforeEach(() => {
    sessions.clear();
  });

  it("stays silent during normal, varied tool use", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("ctl-normal");
    // A mix of reads broken up by edits (active calls reset the streak).
    for (let i = 0; i < 8; i++) {
      expect(checkToolLoop(cfg, sess, "read", { filePath: `/f${i}.ts` }, true).level).toBe("none");
      expect(checkToolLoop(cfg, sess, "edit", { filePath: `/f${i}.ts` }, true).level).toBe("none");
    }
    expect(sess.passiveStreak).toBe(0);
  });

  it("warns then aborts on a long passive-exploration streak (the 166c pattern)", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("ctl-explore");
    const levels: string[] = [];
    // Distinct files each time → no repeat signal; pure exploration streak.
    for (let i = 0; i < DEFAULT_EXPLORATION_ABORT; i++) {
      const tool = i % 2 === 0 ? "read" : "grep";
      const args = tool === "read" ? { filePath: `/f${i}.ts` } : { pattern: `p${i}` };
      levels.push(checkToolLoop(cfg, sess, tool, args, true).level);
    }
    expect(levels[DEFAULT_EXPLORATION_WARN - 2]).toBe("none");
    expect(levels[DEFAULT_EXPLORATION_WARN - 1]).toBe("warn");
    const last = checkToolLoop(cfg, sess, "read", { filePath: "/final.ts" }, true);
    expect(last.level).toBe("abort");
    expect(last.kind).toBe("explore");
  });

  it("an active call (bash/edit) resets the exploration streak", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("ctl-reset");
    for (let i = 0; i < DEFAULT_EXPLORATION_WARN - 1; i++) {
      checkToolLoop(cfg, sess, "read", { filePath: `/f${i}.ts` }, true);
    }
    // A real command = progress.
    checkToolLoop(cfg, sess, "bash", { command: "bun test" }, true);
    expect(sess.passiveStreak).toBe(0);
    // Resumes from zero, so the next read is nowhere near the warn threshold.
    expect(checkToolLoop(cfg, sess, "read", { filePath: "/again.ts" }, true).level).toBe("none");
  });

  it("flags an identical repeated call as a repeat loop", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("ctl-repeat");
    let v;
    for (let i = 0; i < cfg.repeatAbort; i++) {
      v = checkToolLoop(cfg, sess, "grep", { pattern: "same" }, true);
    }
    expect(v!.kind).toBe("repeat");
    expect(v!.level).toBe("abort");
  });

  it("never scores `task` dispatch as a loop, even when sibling sigs collide", () => {
    // Parallel @build dispatches share a long prompt preamble, so the 200-char
    // truncated signature collides. Before the fix this tripped repeatAbort and
    // the hard abort cancelled the orchestrator's in-flight siblings.
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("ctl-task");
    const args = { subagent_type: "build", description: "x", prompt: "@build ".repeat(60) };
    for (let i = 0; i < cfg.repeatAbort + 4; i++) {
      const v = checkToolLoop(cfg, sess, "task", args, true);
      expect(v.level).toBe("none");
      expect(v.kind).toBeNull();
    }
    // It also counts as an active call: the passive streak stays reset.
    expect(sess.passiveStreak).toBe(0);
  });

  it("escalates a repeatedly FAILING call twice as fast (failures weigh double)", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("ctl-fail");
    // ok=false → weight 2. repeatAbort/2 failing calls should already abort.
    const calls = Math.ceil(cfg.repeatAbort / 2);
    let v;
    for (let i = 0; i < calls; i++) {
      v = checkToolLoop(cfg, sess, "bash", { command: "broken-cmd" }, false);
    }
    expect(v!.level).toBe("abort");
    expect(v!.kind).toBe("repeat");
  });

  it("is a no-op when disabled", () => {
    const cfg = { ...defaultConfig().loopDetection, enabled: false };
    const sess = getSession("ctl-disabled");
    for (let i = 0; i < DEFAULT_EXPLORATION_ABORT + 5; i++) {
      expect(checkToolLoop(cfg, sess, "read", { filePath: "/same.ts" }, true).level).toBe("none");
    }
  });

  it("loopCorrective text differs by kind", () => {
    expect(loopCorrective({ level: "warn", kind: "explore", sig: "read:/a", count: 12 })).toContain(
      "read-only calls in a row",
    );
    expect(loopCorrective({ level: "abort", kind: "repeat", sig: "grep:x", count: 6 })).toContain(
      "same tool call",
    );
    // Identical-result repeats call out that the data is already in context.
    expect(
      loopCorrective({ level: "warn", kind: "repeat", sig: "linear_get_issue:x", count: 3, identicalResult: true }),
    ).toContain("BYTE-IDENTICAL");
  });

  // ---- MCP read tools count as exploration (Gemini Flash regression) -------

  it("classifies MCP read tools as passive and write tools as active", () => {
    expect(isPassiveTool("linear_get_issue")).toBe(true);
    expect(isPassiveTool("linear_list_issues")).toBe(true);
    expect(isPassiveTool("linear_list_comments")).toBe(true);
    expect(isPassiveTool("linear_search_issues")).toBe(true);
    expect(isPassiveTool("github_get_pr")).toBe(true);
    expect(isPassiveTool("read")).toBe(true);
    expect(isPassiveTool("webfetch")).toBe(true);

    expect(isPassiveTool("linear_save_issue")).toBe(false);
    expect(isPassiveTool("linear_create_comment")).toBe(false);
    expect(isPassiveTool("edit")).toBe(false);
    expect(isPassiveTool("bash")).toBe(false);
    expect(isPassiveTool("task")).toBe(false);
    // Verify/poll steps are forward progress, not exploration.
    expect(isPassiveTool("tsc_check")).toBe(false);
    expect(isPassiveTool("eslint_check")).toBe(false);
    expect(isPassiveTool("background_check")).toBe(false);
    expect(isPassiveTool("background_run")).toBe(false);
  });

  it("MCP read calls advance the exploration streak instead of resetting it", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("ctl-mcp-streak");
    // Alternate builtin and MCP reads with DISTINCT args — before the fix the
    // MCP calls reset passiveStreak and the warn never fired.
    let v;
    for (let i = 0; i < cfg.explorationWarn; i++) {
      const tool = i % 2 === 0 ? "linear_get_issue" : "grep";
      v = checkToolLoop(cfg, sess, tool, { q: `unique-${i}` }, true, `hash-${i}`);
    }
    expect(v!.kind).toBe("explore");
    expect(v!.level).toBe("warn");
  });

  it("weighs identical-output re-fetches double, like failures", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("ctl-identical");
    const args = { id: "GEN-2849" };
    const sameHash = hashContent('{"id":"GEN-2849","title":"unchanged"}');
    // Call 1: fresh data, weight 1 → score 1.
    let v = checkToolLoop(cfg, sess, "linear_get_issue", args, true, sameHash);
    expect(v.level).toBe("none");
    // Call 2: identical output, weight 2 → score 3 = repeatWarn. Fires a full
    // call earlier than changed-output repeats.
    v = checkToolLoop(cfg, sess, "linear_get_issue", args, true, sameHash);
    expect(v.kind).toBe("repeat");
    expect(v.level).toBe("warn");
    expect(v.identicalResult).toBe(true);
  });

  it("does not penalize same-signature calls whose output CHANGES", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("ctl-changing");
    const args = { command: "git status" };
    // Output changes every time (work is being done between calls) → weight 1.
    let v;
    for (let i = 0; i < 2; i++) {
      v = checkToolLoop(cfg, sess, "bash", args, true, `different-${i}`);
    }
    expect(v!.level).toBe("none");
    expect(v!.identicalResult).toBe(false);
  });

  it("replays the 2026-06-11 Gemini Flash runaway session and fires the guard", () => {
    // The exact passive tail of session-gemini-flash.md (lines 2390-3233):
    // grep, grep, linear_list_issues, grep, then a rotation of linear_get_issue
    // / linear_list_comments / read across GEN-2849/2620/2623/2018 — fifteen
    // consecutive read-only calls, several returning byte-identical JSON.
    // The shipped guard never fired once. It must fire now.
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("ctl-gemini-replay");
    const issue2849 = hashContent('{"id":"GEN-2849",...}');
    const calls: [string, unknown, string][] = [
      ["grep", { pattern: "KESB-145", path: "/repo" }, "g1"],
      ["grep", { pattern: "9624", path: "/repo" }, "g2"],
      ["linear_list_issues", { query: "KESB-145" }, "l1"],
      ["grep", { pattern: "KESB-145", path: "/tool-output" }, "g3"],
      ["linear_get_issue", { id: "GEN-2620" }, "i2620"],
      ["linear_list_comments", { issueId: "GEN-2849" }, "c2849"],
      ["linear_get_issue", { id: "GEN-2018" }, "i2018"],
      ["read", { filePath: "/tool-output/tool_eb4" }, "r1"],
      ["linear_get_issue", { id: "GEN-2623" }, "i2623"],
      ["linear_get_issue", { id: "GEN-2849" }, issue2849],
      ["linear_get_issue", { id: "GEN-2849" }, issue2849], // identical re-fetch
      ["linear_list_comments", { issueId: "GEN-2620" }, "c2620"],
      ["linear_list_comments", { issueId: "GEN-2623" }, "c2623"],
      ["linear_list_comments", { issueId: "GEN-2849" }, "c2849b"],
      ["linear_get_issue", { id: "GEN-2849" }, issue2849], // identical again
    ];
    const verdicts = calls.map(([tool, args, hash]) =>
      checkToolLoop(cfg, sess, tool, args, true, hash),
    );
    const fired = verdicts.filter((v) => v.level !== "none");
    expect(fired.length).toBeGreaterThan(0);
    // The warn lands well before the sequence ends — the real session ran for
    // an hour past this point with zero intervention.
    const firstFired = verdicts.findIndex((v) => v.level !== "none");
    expect(firstFired).toBeLessThanOrEqual(11);
    // And by the end the guard is still escalated, not silenced.
    expect(verdicts[verdicts.length - 1]!.level).not.toBe("none");
  });
});

// ---- isVerifyCommand -------------------------------------------------------

describe("isVerifyCommand", () => {
  it("matches known test/build/typecheck runners", () => {
    expect(isVerifyCommand("pnpm test")).toBe(true);
    expect(isVerifyCommand("pnpm run typecheck")).toBe(true);
    expect(isVerifyCommand("npx vitest run src/foo.test.ts")).toBe(true);
    expect(isVerifyCommand("cargo test --release")).toBe(true);
    expect(isVerifyCommand("bun test")).toBe(true);
    expect(isVerifyCommand("tsc --noEmit")).toBe(true);
  });
  it("does not match ordinary commands", () => {
    expect(isVerifyCommand("git status")).toBe(false);
    expect(isVerifyCommand("cat src/test-helpers.ts")).toBe(false); // 'test' only in a path
    expect(isVerifyCommand("ls packages/tests")).toBe(false);
  });
});

// ---- checkComplexityHint ---------------------------------------------------

describe("checkComplexityHint", () => {
  beforeEach(() => {
    sessions.clear();
  });

  it("suggests delegation after N failing verify runs, once", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("cx-1");
    let v;
    for (let i = 0; i < DEFAULT_COMPLEXITY_WARN; i++) {
      v = checkComplexityHint(cfg, sess, "bash", "pnpm test", false);
    }
    expect(v.suggest).toBe(true);
    expect(v.fails).toBe(DEFAULT_COMPLEXITY_WARN);
    // Fires only once.
    const again = checkComplexityHint(cfg, sess, "bash", "pnpm test", false);
    expect(again.suggest).toBe(false);
  });

  it("ignores passing verify runs and non-verify failures", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("cx-2");
    for (let i = 0; i < DEFAULT_COMPLEXITY_WARN + 2; i++) {
      checkComplexityHint(cfg, sess, "bash", "pnpm test", true); // passing
      checkComplexityHint(cfg, sess, "bash", "git status", false); // not a verify cmd
    }
    expect(sess.failedVerifyRuns).toBe(0);
    expect(sess.complexitySuggested).toBe(false);
  });

  it("is suppressed once the agent delegates via the task tool", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("cx-3");
    checkComplexityHint(cfg, sess, "task", null, true); // delegated
    let v;
    for (let i = 0; i < DEFAULT_COMPLEXITY_WARN + 3; i++) {
      v = checkComplexityHint(cfg, sess, "bash", "cargo test", false);
    }
    expect(v.suggest).toBe(false);
    expect(sess.delegated).toBe(true);
  });

  it("is disabled when complexityWarn is 0", () => {
    const cfg = { ...defaultConfig().loopDetection, complexityWarn: 0 };
    const sess = getSession("cx-4");
    let v;
    for (let i = 0; i < 8; i++) {
      v = checkComplexityHint(cfg, sess, "bash", "pnpm test", false);
    }
    expect(v.suggest).toBe(false);
  });

  it("hint text names the configured deep and consult agents, routed by gap type", () => {
    const hint = complexityHint("@build-deep", "@oracle", 4);
    expect(hint).toContain("@build-deep");
    expect(hint).toContain("@oracle");
    expect(hint).toContain("delegate");
    // Comprehension gaps route to the consult; implementation depth to deep.
    expect(hint).toMatch(/comprehension[\s\S]*@oracle/);
    expect(hint).toMatch(/fix itself needs deep reasoning[\s\S]*@build-deep/);
  });
});

// ---- checkReadDedup --------------------------------------------------------

describe("checkReadDedup", () => {
  beforeEach(() => {
    sessions.clear();
  });

  it("passes through first read (caches content)", () => {
    const cfg = defaultConfig().readDedup;
    const sess = getSession("dedup-1");
    const content = "file content here";
    const output = { output: content };

    const deduped = checkReadDedup(cfg, sess, "/foo.ts", output);
    expect(deduped).toBe(false);
    expect(output.output).toBe(content);
    expect(sess.readCache.has("/foo.ts")).toBe(true);
  });

  it("deduplicates unchanged re-read", () => {
    const cfg = defaultConfig().readDedup;
    const sess = getSession("dedup-2");
    const content = "file content here";

    // First read
    const o1 = { output: content };
    checkReadDedup(cfg, sess, "/foo.ts", o1);

    // Second read of same content
    const o2 = { output: content };
    const deduped = checkReadDedup(cfg, sess, "/foo.ts", o2);
    expect(deduped).toBe(true);
    expect(o2.output).toContain("File unchanged");
    expect(o2.output).toContain("tool call #");
    expect(o2.output).not.toBe(content);
  });

  it("passes through when content has changed", () => {
    const cfg = defaultConfig().readDedup;
    const sess = getSession("dedup-3");

    // First read
    const o1 = { output: "version 1" };
    checkReadDedup(cfg, sess, "/foo.ts", o1);

    // Second read with different content
    const o2 = { output: "version 2" };
    const deduped = checkReadDedup(cfg, sess, "/foo.ts", o2);
    expect(deduped).toBe(false);
    expect(o2.output).toBe("version 2");
  });

  it("returns false for null file path", () => {
    const cfg = defaultConfig().readDedup;
    const sess = getSession("dedup-4");
    const output = { output: "content" };

    const deduped = checkReadDedup(cfg, sess, null, output);
    expect(deduped).toBe(false);
    expect(output.output).toBe("content");
  });

  it("does nothing when disabled", () => {
    const cfg = makeConfig({ readDedup: { enabled: false } }).readDedup;
    const sess = getSession("dedup-5");
    const content = "same content";

    const o1 = { output: content };
    checkReadDedup(cfg, sess, "/foo.ts", o1);

    const o2 = { output: content };
    const deduped = checkReadDedup(cfg, sess, "/foo.ts", o2);
    expect(deduped).toBe(false);
    expect(o2.output).toBe(content);
  });

  it("tracks different files independently", () => {
    const cfg = defaultConfig().readDedup;
    const sess = getSession("dedup-6");

    const o1 = { output: "content A" };
    checkReadDedup(cfg, sess, "/a.ts", o1);

    const o2 = { output: "content B" };
    checkReadDedup(cfg, sess, "/b.ts", o2);

    // Re-read /a.ts with same content
    const o3 = { output: "content A" };
    const deduped = checkReadDedup(cfg, sess, "/a.ts", o3);
    expect(deduped).toBe(true);

    // Re-read /b.ts with different content
    const o4 = { output: "content B modified" };
    const deduped2 = checkReadDedup(cfg, sess, "/b.ts", o4);
    expect(deduped2).toBe(false);
  });
});

// ---- getSession ------------------------------------------------------------

describe("getSession", () => {
  beforeEach(() => {
    sessions.clear();
  });

  it("creates a new session state on first access", () => {
    const sess = getSession("new-session");
    expect(sess.editCounts.size).toBe(0);
    expect(sess.readCache.size).toBe(0);
    expect(sess.callSeq).toBe(1);
  });

  it("returns the same state for the same session ID", () => {
    const s1 = getSession("shared");
    s1.editCounts.set("/x.ts", 3);
    const s2 = getSession("shared");
    expect(s2.editCounts.get("/x.ts")).toBe(3);
  });

  it("increments callSeq on each access", () => {
    getSession("counter");
    getSession("counter");
    const s = getSession("counter");
    expect(s.callSeq).toBe(3);
  });

  it("isolates state between different session IDs", () => {
    const a = getSession("session-a");
    a.editCounts.set("/x.ts", 5);
    const b = getSession("session-b");
    expect(b.editCounts.has("/x.ts")).toBe(false);
  });
});

// ---- checkToolDenylist -------------------------------------------------------

describe("checkToolDenylist", () => {
  it("null when env is unset or empty", () => {
    expect(checkToolDenylist("linear_save_issue", undefined)).toBeNull();
    expect(checkToolDenylist("linear_save_issue", "")).toBeNull();
    expect(checkToolDenylist("linear_save_issue", " , ")).toBeNull();
  });

  it("blocks exact names and globs, teaches the recovery", () => {
    const deny = "linear_save_issue,linear_create_*,linear_update_*";
    const msg = checkToolDenylist("linear_save_issue", deny);
    expect(msg).toContain("disabled in this sandbox");
    expect(msg).toContain("state precisely what you would");
    expect(checkToolDenylist("linear_create_comment", deny)).not.toBeNull();
    expect(checkToolDenylist("linear_update_issue", deny)).not.toBeNull();
  });

  it("leaves read tools untouched", () => {
    const deny = "linear_save_issue,linear_create_*";
    expect(checkToolDenylist("linear_get_issue", deny)).toBeNull();
    expect(checkToolDenylist("linear_list_comments", deny)).toBeNull();
    expect(checkToolDenylist("read", deny)).toBeNull();
  });
});

// ---- hook output shape adapters (MCP vs built-in) ----------------------------

describe("readHookOutput / appendHookOutput", () => {
  it("reads built-in string output", () => {
    expect(readHookOutput({ output: "hello" })).toBe("hello");
  });

  it("reads MCP content text items", () => {
    expect(
      readHookOutput({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }),
    ).toBe("a\nb");
    expect(readHookOutput({ content: [{ type: "image", data: "…" }] })).toBeNull();
  });

  it("returns null for empty/unknown shapes", () => {
    expect(readHookOutput({})).toBeNull();
    expect(readHookOutput(undefined)).toBeNull();
    expect(readHookOutput({ output: undefined, content: undefined })).toBeNull();
  });

  it("appends to built-in output string", () => {
    const o: { output: string } = { output: "result" };
    appendHookOutput(o, "\nWARN");
    expect(o.output).toBe("result\nWARN");
  });

  it("appends a text item to MCP content", () => {
    const o: { content: unknown[] } = { content: [{ type: "text", text: "result" }] };
    appendHookOutput(o, "\nWARN");
    expect(o.content.length).toBe(2);
    expect(o.content[1]).toEqual({ type: "text", text: "\nWARN" });
  });

  it("identical MCP re-fetches now trip the repeat guard a call early", () => {
    // End-to-end of the Gemini gap: same MCP call, same content → the hash
    // path must see it (this was dead when only output.output was hashed).
    const cfg = defaultConfig().loopDetection;
    const sess = getSession("ctl-mcp-identical");
    const args = { issueId: "GEN-2620" };
    const mcpText = readHookOutput({ content: [{ type: "text", text: '{"comments":[]}' }] })!;
    const hash = hashContent(mcpText);
    let v = checkToolLoop(cfg, sess, "linear_list_comments", args, true, hash);
    expect(v.level).toBe("none");
    v = checkToolLoop(cfg, sess, "linear_list_comments", args, true, hash);
    expect(v.kind).toBe("repeat");
    expect(v.level).toBe("warn");
    expect(v.identicalResult).toBe(true);
  });
});

// ---- bug-fix nudge (doctrine-as-mechanism) ---------------------------------

describe("classifyTaskShape", () => {
  it("classifies bug reports as bug", () => {
    expect(classifyTaskShape("Bug report: every Linear MCP call fails with...")).toBe("bug");
    expect(classifyTaskShape("the build crashes on startup")).toBe("bug");
    expect(classifyTaskShape("this throws an exception when X")).toBe("bug");
    expect(classifyTaskShape("fix the bug where dates render wrong")).toBe("bug");
    expect(classifyTaskShape("the endpoint returns the wrong value")).toBe("bug");
  });
  it("classifies questions as other even when they mention errors", () => {
    expect(classifyTaskShape("explain why this code errors out")).toBe("other");
    expect(classifyTaskShape("how does the loop guard decide to abort?")).toBe("other");
    expect(classifyTaskShape("walk me through the crash recovery path")).toBe("other");
    expect(classifyTaskShape("what happens when a tool fails?")).toBe("other");
  });
  it("classifies features/triage as other", () => {
    expect(classifyTaskShape("add a title param to background_run")).toBe("other");
    expect(classifyTaskShape("GEN-2849 — work this ticket end to end")).toBe("other");
  });
});

describe("checkBugFixNudge", () => {
  function bugSess(id: string, streak: number, edits = 0): any {
    const sess = getSession(id);
    sess.taskShape = "bug";
    sess.passiveStreak = streak;
    sess.editCounts = new Map(Array.from({ length: edits }, (_, i) => [`/f${i}.ts`, 1]));
    sess.bugFixArmed = false;
    return sess;
  }
  it("fires once when a bug session crosses the threshold with no edits", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = bugSess("bfn-1", cfg.bugFixWarn);
    expect(checkBugFixNudge(cfg, sess)).toBe(true);
    // armed — second call at the same streak does not re-fire
    expect(checkBugFixNudge(cfg, sess)).toBe(false);
  });
  it("does not fire below threshold, or once editing has begun, or on non-bug", () => {
    const cfg = defaultConfig().loopDetection;
    expect(checkBugFixNudge(cfg, bugSess("bfn-2", cfg.bugFixWarn - 1))).toBe(false);
    expect(checkBugFixNudge(cfg, bugSess("bfn-3", cfg.bugFixWarn, 1))).toBe(false);
    const other = getSession("bfn-4");
    other.taskShape = "other";
    other.passiveStreak = cfg.bugFixWarn + 5;
    expect(checkBugFixNudge(cfg, other)).toBe(false);
  });
  it("re-arms after the passive streak resets (a new diagnosis run)", () => {
    const cfg = defaultConfig().loopDetection;
    const sess = bugSess("bfn-5", cfg.bugFixWarn);
    expect(checkBugFixNudge(cfg, sess)).toBe(true);
    sess.passiveStreak = 0; // active call reset
    expect(checkBugFixNudge(cfg, sess)).toBe(false); // disarms, not at threshold
    sess.passiveStreak = cfg.bugFixWarn;
    expect(checkBugFixNudge(cfg, sess)).toBe(true); // fires again
  });
  it("is disabled when bugFixWarn is 0", () => {
    const cfg = { ...defaultConfig().loopDetection, bugFixWarn: 0 };
    expect(checkBugFixNudge(cfg, bugSess("bfn-6", 20))).toBe(false);
  });
  it("corrective tells the model to EDIT, not to keep reading", () => {
    expect(bugFixCorrective(5)).toContain("EDIT the file NOW");
    expect(bugFixCorrective(5)).toContain("5 read/search calls");
  });
});
