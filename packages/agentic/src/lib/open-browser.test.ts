import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { setSettingsPath, setSetting } from "./settings.js";

const TEST_DIR = path.join(os.tmpdir(), "glorious-open-browser-test-" + process.pid);
const TEST_SETTINGS = path.join(TEST_DIR, "settings.json");

beforeEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  setSettingsPath(TEST_SETTINGS);
});

afterEach(() => {
  setSettingsPath(null);
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe("openBrowser", () => {
  test("calls exec when setting is default (true)", async () => {
    const { openBrowser } = await import("./open-browser.js");
    let called = false;
    const fakeExec = (() => { called = true; }) as any;
    const result = openBrowser("http://localhost:3000", "plan.auto-open", { exec: fakeExec });
    expect(result).toBe(true);
    expect(called).toBe(true);
  });

  test("skips exec when setting is 'false' and logs hint", async () => {
    const { openBrowser } = await import("./open-browser.js");
    setSetting("plan.auto-open", "false");
    let called = false;
    const fakeExec = (() => { called = true; }) as any;
    const logged: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => { logged.push(args.join(" ")); };
    try {
      const result = openBrowser("http://localhost:3000", "plan.auto-open", { exec: fakeExec });
      expect(result).toBe(false);
      expect(called).toBe(false);
      expect(logged.some((l) => l.includes("Browser auto-open disabled"))).toBe(true);
      expect(logged.some((l) => l.includes("plan.auto-open"))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  test("uses 'open' command on darwin", async () => {
    const { openBrowser } = await import("./open-browser.js");
    let capturedCmd = "";
    const fakeExec = ((cmd: string) => { capturedCmd = cmd; }) as any;
    openBrowser("http://localhost:3000", "plan.auto-open", { exec: fakeExec, platform: "darwin" });
    expect(capturedCmd).toBe("open");
  });

  test("uses 'xdg-open' on linux", async () => {
    const { openBrowser } = await import("./open-browser.js");
    let capturedCmd = "";
    const fakeExec = ((cmd: string) => { capturedCmd = cmd; }) as any;
    openBrowser("http://localhost:3000", "plan.auto-open", { exec: fakeExec, platform: "linux" });
    expect(capturedCmd).toBe("xdg-open");
  });

  test("passes URL as first argument to exec", async () => {
    const { openBrowser } = await import("./open-browser.js");
    let capturedArgs: string[] = [];
    const fakeExec = ((_cmd: string, args: string[]) => { capturedArgs = args; }) as any;
    openBrowser("http://localhost:9999", "plan.auto-open", { exec: fakeExec });
    expect(capturedArgs).toEqual(["http://localhost:9999"]);
  });

  test("does not throw when exec callback receives error", async () => {
    const { openBrowser } = await import("./open-browser.js");
    const fakeExec = ((_cmd: string, _args: string[], cb: Function) => {
      cb(new Error("command not found"));
    }) as any;
    expect(() => {
      openBrowser("http://localhost:3000", "plan.auto-open", { exec: fakeExec });
    }).not.toThrow();
  });

  test("uses 'xdg-open' on non-darwin platforms (win32)", async () => {
    const { openBrowser } = await import("./open-browser.js");
    let capturedCmd = "";
    const fakeExec = ((cmd: string) => { capturedCmd = cmd; }) as any;
    openBrowser("http://localhost:3000", "plan.auto-open", { exec: fakeExec, platform: "win32" });
    expect(capturedCmd).toBe("xdg-open");
  });
});
