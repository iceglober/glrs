/**
 * Slack Block Kit formatter for autopilot webhook events.
 *
 * Converts a WebhookEvent into a Slack incoming webhook payload using
 * Block Kit structured blocks. Produces compact, readable messages:
 *   - One message per phase completion
 *   - One on error
 *   - One on run complete
 *   - Thread replies for iteration details (not implemented here — the
 *     caller is responsible for threading if desired)
 */

import type { WebhookEvent, WebhookEventType } from "./webhook-notifier.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlackTextObject {
  type: "plain_text" | "mrkdwn";
  text: string;
  emoji?: boolean;
}

export interface SlackHeaderBlock {
  type: "header";
  text: SlackTextObject;
}

export interface SlackSectionBlock {
  type: "section";
  fields?: SlackTextObject[];
  text?: SlackTextObject;
}

export interface SlackContextBlock {
  type: "context";
  elements: SlackTextObject[];
}

export type SlackBlock = SlackHeaderBlock | SlackSectionBlock | SlackContextBlock;

export interface SlackBlocks {
  blocks: SlackBlock[];
}

// ---------------------------------------------------------------------------
// Event-type labels
// ---------------------------------------------------------------------------

const EVENT_LABELS: Record<WebhookEventType, string> = {
  iteration_complete: "✅ Iteration Complete",
  phase_complete: "🏁 Phase Complete",
  run_complete: "🎉 Run Complete",
  error: "❌ Error",
  struggle: "⚠️ Struggle Detected",
  stall: "⏸️ Stall Detected",
};

// ---------------------------------------------------------------------------
// formatSlackMessage
// ---------------------------------------------------------------------------

/**
 * Format a WebhookEvent as a Slack Block Kit payload.
 *
 * Structure:
 *   - Header block: event type label
 *   - Section block: key fields (iteration, cost, files changed)
 *   - Context block: timestamp + message
 */
export function formatSlackMessage(event: WebhookEvent): SlackBlocks {
  const label = EVENT_LABELS[event.event] ?? event.event;

  const fields: SlackTextObject[] = [
    { type: "mrkdwn", text: `*Iteration:* ${event.iteration}` },
  ];

  if (event.costUsd !== undefined && event.costUsd > 0) {
    fields.push({ type: "mrkdwn", text: `*Cost so far:* $${event.costUsd.toFixed(3)}` });
  }

  if (event.filesChanged !== undefined && event.filesChanged > 0) {
    fields.push({ type: "mrkdwn", text: `*Files changed:* ${event.filesChanged}` });
  }

  if (event.phaseFile) {
    fields.push({ type: "mrkdwn", text: `*Phase:* ${event.phaseFile}` });
  }

  if (event.commitSubject) {
    fields.push({ type: "mrkdwn", text: `*Last commit:* ${event.commitSubject}` });
  }

  if (event.errorMessage) {
    fields.push({ type: "mrkdwn", text: `*Error:* ${event.errorMessage}` });
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: label, emoji: true },
    },
  ];

  if (fields.length > 0) {
    blocks.push({
      type: "section",
      fields,
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `${event.message} · ${event.timestamp}`,
      },
    ],
  });

  return { blocks };
}
