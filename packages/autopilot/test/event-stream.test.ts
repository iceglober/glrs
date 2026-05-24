import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { EventStreamWriter, EventStreamReader } from "../src/event-stream.js";
import type { SessionEvent } from "../src/session-events.js";

const ts = "2026-01-01T00:00:00.000Z";

function makeSessionStart(planPath = "/plans/foo"): SessionEvent {
  return {
    type: "session:start",
    timestamp: ts,
    planPath,
    cwd: "/repo",
    resume: false,
  };
}

function makeIterationDone(iteration: number): SessionEvent {
  return {
    type: "iteration:done",
    timestamp: ts,
    iteration,
    durationMs: 1000,
    madeProgress: true,
  };
}

describe("EventStreamWriter", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-stream-test-"));
    filePath = path.join(tmpDir, ".agent", "autopilot-events.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the parent directory if it does not exist", () => {
    const writer = new EventStreamWriter(filePath);
    writer.close();
    expect(fs.existsSync(path.dirname(filePath))).toBe(true);
  });

  it("creates the file on construction", () => {
    const writer = new EventStreamWriter(filePath);
    writer.close();
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("writes a single event as a JSON line", () => {
    const writer = new EventStreamWriter(filePath);
    const event = makeSessionStart();
    writer.emit(event);
    writer.close();

    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(event);
  });

  it("writes multiple events as separate JSON lines", () => {
    const writer = new EventStreamWriter(filePath);
    const events: SessionEvent[] = [
      makeSessionStart(),
      makeIterationDone(1),
      makeIterationDone(2),
    ];
    for (const e of events) writer.emit(e);
    writer.close();

    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    for (let i = 0; i < events.length; i++) {
      expect(JSON.parse(lines[i])).toEqual(events[i]);
    }
  });

  it("appends to an existing file (does not truncate)", () => {
    // First writer
    const w1 = new EventStreamWriter(filePath);
    w1.emit(makeSessionStart());
    w1.close();

    // Second writer — should append
    const w2 = new EventStreamWriter(filePath);
    w2.emit(makeIterationDone(1));
    w2.close();

    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe("session:start");
    expect(JSON.parse(lines[1]).type).toBe("iteration:done");
  });

  it("each line ends with a newline", () => {
    const writer = new EventStreamWriter(filePath);
    writer.emit(makeSessionStart());
    writer.close();

    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("close() is idempotent (no throw on double close)", () => {
    const writer = new EventStreamWriter(filePath);
    writer.emit(makeSessionStart());
    writer.close();
    expect(() => writer.close()).not.toThrow();
  });
});

describe("EventStreamReader", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-stream-reader-test-"));
    filePath = path.join(tmpDir, "events.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("readAll()", () => {
    it("returns empty array when file does not exist", () => {
      const reader = new EventStreamReader(filePath);
      expect(reader.readAll()).toEqual([]);
    });

    it("returns empty array for an empty file", () => {
      fs.writeFileSync(filePath, "");
      const reader = new EventStreamReader(filePath);
      expect(reader.readAll()).toEqual([]);
    });

    it("parses a single event", () => {
      const event = makeSessionStart();
      fs.writeFileSync(filePath, JSON.stringify(event) + "\n");
      const reader = new EventStreamReader(filePath);
      const events = reader.readAll();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event);
    });

    it("parses multiple events", () => {
      const events: SessionEvent[] = [
        makeSessionStart(),
        makeIterationDone(1),
        makeIterationDone(2),
      ];
      fs.writeFileSync(filePath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
      const reader = new EventStreamReader(filePath);
      const parsed = reader.readAll();
      expect(parsed).toHaveLength(3);
      expect(parsed).toEqual(events);
    });

    it("skips blank lines", () => {
      const event = makeSessionStart();
      fs.writeFileSync(filePath, "\n" + JSON.stringify(event) + "\n\n");
      const reader = new EventStreamReader(filePath);
      const events = reader.readAll();
      expect(events).toHaveLength(1);
    });

    it("skips truncated/malformed last line (crash-safe)", () => {
      const event = makeSessionStart();
      // Simulate a crash mid-write: valid line + truncated line
      const truncated = '{"type":"iteration:done","timestamp":"2026-01-01T00:00:00.000Z","iter';
      fs.writeFileSync(filePath, JSON.stringify(event) + "\n" + truncated);
      const reader = new EventStreamReader(filePath);
      const events = reader.readAll();
      // Only the complete line should be returned
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event);
    });
  });

  describe("readFrom()", () => {
    it("returns empty array and offset 0 when file does not exist", () => {
      const reader = new EventStreamReader(filePath);
      const result = reader.readFrom(0);
      expect(result.events).toEqual([]);
      expect(result.newOffset).toBe(0);
    });

    it("returns all events when byteOffset is 0", () => {
      const events: SessionEvent[] = [makeSessionStart(), makeIterationDone(1)];
      fs.writeFileSync(filePath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
      const reader = new EventStreamReader(filePath);
      const result = reader.readFrom(0);
      expect(result.events).toHaveLength(2);
      expect(result.events).toEqual(events);
    });

    it("returns only new events when byteOffset is past first event", () => {
      const e1 = makeSessionStart();
      const e2 = makeIterationDone(1);
      const line1 = JSON.stringify(e1) + "\n";
      const line2 = JSON.stringify(e2) + "\n";
      fs.writeFileSync(filePath, line1 + line2);

      const reader = new EventStreamReader(filePath);
      // Read from after the first line
      const result = reader.readFrom(Buffer.byteLength(line1, "utf8"));
      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toEqual(e2);
    });

    it("newOffset equals file size after read", () => {
      const event = makeSessionStart();
      const content = JSON.stringify(event) + "\n";
      fs.writeFileSync(filePath, content);

      const reader = new EventStreamReader(filePath);
      const result = reader.readFrom(0);
      expect(result.newOffset).toBe(Buffer.byteLength(content, "utf8"));
    });

    it("returns empty events when byteOffset equals file size (no new data)", () => {
      const event = makeSessionStart();
      const content = JSON.stringify(event) + "\n";
      fs.writeFileSync(filePath, content);

      const reader = new EventStreamReader(filePath);
      const fileSize = Buffer.byteLength(content, "utf8");
      const result = reader.readFrom(fileSize);
      expect(result.events).toEqual([]);
      expect(result.newOffset).toBe(fileSize);
    });

    it("supports incremental tail reads (simulates polling)", () => {
      const writer = new EventStreamWriter(filePath);
      const reader = new EventStreamReader(filePath);

      // First batch
      writer.emit(makeSessionStart());
      writer.emit(makeIterationDone(1));
      const r1 = reader.readFrom(0);
      expect(r1.events).toHaveLength(2);

      // Second batch — only new events
      writer.emit(makeIterationDone(2));
      writer.emit(makeIterationDone(3));
      const r2 = reader.readFrom(r1.newOffset);
      expect(r2.events).toHaveLength(2);
      expect(r2.events[0].type).toBe("iteration:done");
      expect((r2.events[0] as { iteration: number }).iteration).toBe(2);

      writer.close();
    });

    it("skips truncated last line in tail mode", () => {
      const event = makeSessionStart();
      const truncated = '{"type":"iteration:done","timestamp":"2026-01-01T00:00:00.000Z","iter';
      fs.writeFileSync(filePath, JSON.stringify(event) + "\n" + truncated);

      const reader = new EventStreamReader(filePath);
      const result = reader.readFrom(0);
      expect(result.events).toHaveLength(1);
    });
  });

  describe("writer + reader round-trip", () => {
    it("all written events are readable", () => {
      const events: SessionEvent[] = [
        makeSessionStart(),
        { type: "enrich:start", timestamp: ts, planPath: "/plans/foo", fileCount: 2 },
        makeIterationDone(1),
        { type: "session:done", timestamp: ts, exitReason: "sentinel", iterations: 1, message: "done" },
      ];

      const writer = new EventStreamWriter(filePath);
      for (const e of events) writer.emit(e);
      writer.close();

      const reader = new EventStreamReader(filePath);
      const parsed = reader.readAll();
      expect(parsed).toHaveLength(events.length);
      expect(parsed).toEqual(events);
    });
  });
});
