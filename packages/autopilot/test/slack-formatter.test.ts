/**
 * Tests for the Slack Block Kit formatter.
 *
 * Covers:
 *   - formatSlackMessage returns a blocks array
 *   - Header block contains the event label
 *   - Section fields include iteration, cost, files changed, phase, commit, error
 *   - Context block contains the message and timestamp
 *   - Optional fields are omitted when absent/zero
 */

import { describe, it, expect } from "bun:test";
import { formatSlackMessage } from "../src/lib/slack-formatter.js";
import type { WebhookEvent } from "../src/lib/webhook-notifier.js";

function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    event: "iteration_complete",
    iteration: 2,
    message: "Iteration 2 complete",
    timestamp: "2024-06-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("formatSlackMessage", () => {
  it("returns a blocks array", () => {
    const result = formatSlackMessage(makeEvent());
    expect(Array.isArray(result.blocks)).toBe(true);
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it("header block contains the event label for iteration_complete", () => {
    const result = formatSlackMessage(makeEvent({ event: "iteration_complete" }));
    const header = result.blocks[0] as { type: string; text: { text: string } };
    expect(header.type).toBe("header");
    expect(header.text.text).toContain("Iteration Complete");
  });

  it("header block contains the event label for run_complete", () => {
    const result = formatSlackMessage(makeEvent({ event: "run_complete" }));
    const header = result.blocks[0] as { type: string; text: { text: string } };
    expect(header.text.text).toContain("Run Complete");
  });

  it("header block contains the event label for error", () => {
    const result = formatSlackMessage(makeEvent({ event: "error" }));
    const header = result.blocks[0] as { type: string; text: { text: string } };
    expect(header.text.text).toContain("Error");
  });

  it("section fields include iteration number", () => {
    const result = formatSlackMessage(makeEvent({ iteration: 7 }));
    const section = result.blocks.find((b) => b.type === "section") as
      | { type: "section"; fields?: Array<{ text: string }> }
      | undefined;
    expect(section).toBeDefined();
    const fieldTexts = section!.fields?.map((f) => f.text) ?? [];
    expect(fieldTexts.some((t) => t.includes("7"))).toBe(true);
  });

  it("includes cost field when costUsd > 0", () => {
    const result = formatSlackMessage(makeEvent({ costUsd: 0.125 }));
    const section = result.blocks.find((b) => b.type === "section") as
      | { type: "section"; fields?: Array<{ text: string }> }
      | undefined;
    const fieldTexts = section!.fields?.map((f) => f.text) ?? [];
    expect(fieldTexts.some((t) => t.includes("0.125"))).toBe(true);
  });

  it("omits cost field when costUsd is 0", () => {
    const result = formatSlackMessage(makeEvent({ costUsd: 0 }));
    const section = result.blocks.find((b) => b.type === "section") as
      | { type: "section"; fields?: Array<{ text: string }> }
      | undefined;
    const fieldTexts = section!.fields?.map((f) => f.text) ?? [];
    expect(fieldTexts.some((t) => t.includes("Cost"))).toBe(false);
  });

  it("includes filesChanged field when > 0", () => {
    const result = formatSlackMessage(makeEvent({ filesChanged: 3 }));
    const section = result.blocks.find((b) => b.type === "section") as
      | { type: "section"; fields?: Array<{ text: string }> }
      | undefined;
    const fieldTexts = section!.fields?.map((f) => f.text) ?? [];
    expect(fieldTexts.some((t) => t.includes("3"))).toBe(true);
  });

  it("includes phaseFile when provided", () => {
    const result = formatSlackMessage(makeEvent({ phaseFile: "plans/v1/wave_1.md" }));
    const section = result.blocks.find((b) => b.type === "section") as
      | { type: "section"; fields?: Array<{ text: string }> }
      | undefined;
    const fieldTexts = section!.fields?.map((f) => f.text) ?? [];
    expect(fieldTexts.some((t) => t.includes("wave_1.md"))).toBe(true);
  });

  it("includes commitSubject when provided", () => {
    const result = formatSlackMessage(makeEvent({ commitSubject: "feat: add webhook notifier" }));
    const section = result.blocks.find((b) => b.type === "section") as
      | { type: "section"; fields?: Array<{ text: string }> }
      | undefined;
    const fieldTexts = section!.fields?.map((f) => f.text) ?? [];
    expect(fieldTexts.some((t) => t.includes("webhook notifier"))).toBe(true);
  });

  it("includes errorMessage when provided", () => {
    const result = formatSlackMessage(makeEvent({ event: "error", errorMessage: "Something went wrong" }));
    const section = result.blocks.find((b) => b.type === "section") as
      | { type: "section"; fields?: Array<{ text: string }> }
      | undefined;
    const fieldTexts = section!.fields?.map((f) => f.text) ?? [];
    expect(fieldTexts.some((t) => t.includes("Something went wrong"))).toBe(true);
  });

  it("context block contains the message and timestamp", () => {
    const result = formatSlackMessage(makeEvent({
      message: "Run finished successfully",
      timestamp: "2024-06-01T12:00:00.000Z",
    }));
    const context = result.blocks.find((b) => b.type === "context") as
      | { type: "context"; elements: Array<{ text: string }> }
      | undefined;
    expect(context).toBeDefined();
    const text = context!.elements[0]?.text ?? "";
    expect(text).toContain("Run finished successfully");
    expect(text).toContain("2024-06-01T12:00:00.000Z");
  });
});
