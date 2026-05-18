/**
 * Tests for the webhook-notifier helper.
 *
 * Covers:
 *   - notifyWebhook posts JSON to a plain webhook URL
 *   - notifyWebhook routes Slack URLs through formatSlackMessage
 *   - notifyWebhook swallows fetch errors (non-fatal)
 *   - notifyWebhook warns on non-2xx responses
 */

import { describe, it, expect } from "bun:test";
import { notifyWebhook, type WebhookEvent } from "../src/lib/webhook-notifier.js";

function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    event: "iteration_complete",
    iteration: 1,
    message: "Iteration 1 complete",
    timestamp: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("notifyWebhook — plain webhook", () => {
  it("POSTs JSON with the event payload", async () => {
    const received: { url: string; body: unknown; headers: Record<string, string> }[] = [];

    // Intercept fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = init?.body ? JSON.parse(init.body as string) : null;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      received.push({ url, body, headers });
      return new Response(null, { status: 200 });
    };

    try {
      const event = makeEvent({ iteration: 3, costUsd: 0.042 });
      await notifyWebhook("https://example.com/webhook", event);

      expect(received.length).toBe(1);
      expect(received[0]!.url).toBe("https://example.com/webhook");
      expect(received[0]!.body).toMatchObject({
        event: "iteration_complete",
        iteration: 3,
        costUsd: 0.042,
        message: "Iteration 1 complete",
      });
      expect(received[0]!.headers["Content-Type"]).toBe("application/json");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("swallows fetch errors without throwing", async () => {
    const originalFetch = globalThis.fetch;
    const warnMessages: string[] = [];
    const originalWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      warnMessages.push(args.map(String).join(" "));
    };

    globalThis.fetch = async () => {
      throw new Error("Network unreachable");
    };

    try {
      // Should not throw
      await notifyWebhook("https://example.com/webhook", makeEvent());
      expect(warnMessages.some((w) => w.includes("non-fatal"))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
    }
  });

  it("warns on non-2xx response without throwing", async () => {
    const originalFetch = globalThis.fetch;
    const warnMessages: string[] = [];
    const originalWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      warnMessages.push(args.map(String).join(" "));
    };

    globalThis.fetch = async () => new Response(null, { status: 500, statusText: "Internal Server Error" });

    try {
      await notifyWebhook("https://example.com/webhook", makeEvent());
      expect(warnMessages.some((w) => w.includes("500"))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
    }
  });
});

describe("notifyWebhook — Slack webhook", () => {
  it("routes Slack URLs through Block Kit formatter", async () => {
    const received: { body: unknown }[] = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : null;
      received.push({ body });
      return new Response(null, { status: 200 });
    };

    try {
      const event = makeEvent({ event: "run_complete", iteration: 5, costUsd: 1.23 });
      await notifyWebhook("https://hooks.slack.com/services/T00/B00/xxx", event);

      expect(received.length).toBe(1);
      const body = received[0]!.body as { blocks: unknown[] };
      expect(Array.isArray(body.blocks)).toBe(true);
      expect(body.blocks.length).toBeGreaterThan(0);
      // Header block should contain the event label
      const header = body.blocks[0] as { type: string; text: { text: string } };
      expect(header.type).toBe("header");
      expect(header.text.text).toContain("Run Complete");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
