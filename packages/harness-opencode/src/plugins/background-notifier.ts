/**
 * background-notifier — wake an idle agent when one of its background jobs
 * finishes.
 *
 * The completion-notice work (#323) surfaces a finished background job by
 * appending to the *next tool's* output. That's invisible when the agent is
 * idle: the turn ended, no tool call is coming, so a job that finishes during
 * the lull is never announced until the user pokes the session. The motivating
 * case is an agent that backgrounds a poller and then has nothing to do but wait
 * — exactly where it shouldn't have to babysit `background_check`.
 *
 * This plugin adds the idle delivery channel. On `session.idle` (opencode's
 * "agent finished its turn, now waiting" signal — the same one `waitForIdle`
 * settles on), it checks for that session's freshly-finished jobs and pushes a
 * notice via `client.session.promptAsync`, the proven idle-wake path also used
 * by stall-detector. The push appends a new user turn; it never mutates existing
 * message parts (the schema break that killed the chat.message banner).
 *
 * Dedup is shared with the tool-output channel through `announcedFor` in
 * ../tools/background.js, so each completion is announced exactly once whichever
 * channel fires first. That also makes this self-limiting: the push starts a new
 * turn that ends in another `session.idle`, but the job is now marked announced,
 * so the next idle finds nothing fresh and stops.
 */

import type { Plugin } from "@opencode-ai/plugin";
import {
  listJobs,
  selectFreshCompletions,
  buildIdleNotice,
  announcedFor,
} from "../tools/background.js";

const plugin: Plugin = async (input) => {
  const client = input.client;

  return {
    event: async ({ event }: { event: { type: string; properties?: any } }) => {
      if (event.type !== "session.idle") return;
      const sessionID: string | undefined = event.properties?.sessionID;
      if (!sessionID) return;

      try {
        const announced = announcedFor(sessionID);
        const fresh = selectFreshCompletions(
          listJobs(sessionID),
          sessionID,
          announced,
        );
        if (fresh.length === 0) return;

        // Mark announced before the push so a re-entrant idle (the push's own
        // turn completing) doesn't re-announce the same jobs.
        for (const j of fresh) announced.add(j.id);

        await client.session.promptAsync({
          path: { id: sessionID },
          body: { parts: [{ type: "text", text: buildIdleNotice(fresh) }] },
        });
      } catch {
        // Best-effort — a session that's gone/busy or a job-state hiccup must
        // never throw out of the event hook.
      }
    },
  };
};

export default plugin;
