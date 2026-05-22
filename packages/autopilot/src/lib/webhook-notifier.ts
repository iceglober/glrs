/**
 * Webhook notification helper for the autopilot loop.
 *
 * Posts a JSON payload to a webhook URL on lifecycle events:
 * iteration complete, phase complete, run complete, error, struggle, stall.
 *
 * Supports plain webhooks and Slack incoming webhooks (auto-detected by URL).
 * All errors are swallowed — a failing webhook must never fail the loop.
 */

import { formatSlackMessage } from "./slack-formatter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebhookEventType =
  | "iteration_complete"
  | "phase_complete"
  | "run_complete"
  | "error"
  | "struggle"
  | "stall";

export interface WebhookEvent {
  /** The event type. */
  event: WebhookEventType;
  /** Current iteration number (1-based). */
  iteration: number;
  /** Phase file path, if applicable. */
  phaseFile?: string;
  /** Cumulative cost in USD so far. */
  costUsd?: number;
  /** Number of files changed in this iteration. */
  filesChanged?: number;
  /** Most recent commit subject line. */
  commitSubject?: string;
  /** Error message (for error events). */
  errorMessage?: string;
  /** Human-readable summary message. */
  message: string;
  /** ISO timestamp of the event. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Slack URL detection
// ---------------------------------------------------------------------------

function isSlackWebhookUrl(url: string): boolean {
  return url.includes("hooks.slack.com/");
}

// ---------------------------------------------------------------------------
// notifyWebhook — fire-and-forget POST
// ---------------------------------------------------------------------------

/**
 * Post a webhook event to the given URL.
 *
 * - If the URL is a Slack incoming webhook, formats the payload as Slack
 *   Block Kit blocks via `formatSlackMessage`.
 * - Otherwise, posts the raw `WebhookEvent` JSON.
 * - If allowedEvents is provided and the event type is not in the list,
 *   silently drops the event before any network call.
 *
 * Never throws. Errors are written to stderr as warnings.
 *
 * @param url - Webhook URL to POST to
 * @param event - The webhook event to send
 * @param allowedEvents - Optional filter of event types to send; events outside this list are silently dropped
 */
export async function notifyWebhook(
  url: string,
  event: WebhookEvent,
  allowedEvents?: WebhookEventType[],
): Promise<void> {
  // Drop event if it's filtered out
  if (allowedEvents && !allowedEvents.includes(event.event)) {
    return;
  }

  try {
    const body = isSlackWebhookUrl(url)
      ? JSON.stringify(formatSlackMessage(event))
      : JSON.stringify(event);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!response.ok) {
      console.warn(
        `⚠ Webhook POST to ${url} returned ${response.status} ${response.statusText}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`⚠ Webhook notification failed (non-fatal): ${msg}`);
  }
}
