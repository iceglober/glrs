/**
 * background-notifier — surfaces background-job state to the model.
 *
 * On every user message (`chat.message`), appends a compact banner of running
 * jobs plus any just-finished job (surfaced once, then dropped) to the outgoing
 * message parts. This is why the agent notices a backfill finished without
 * being told: it sees the status inline on its next turn — no idle timer, no
 * out-of-band injection. Fail-silent: a hiccup here must never break a message.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { listJobs, buildJobsBanner } from "../tools/background.js";

const plugin: Plugin = async () => {
  // Finished jobs already shown to the model — so each completion is mentioned
  // once. Per OpenCode process (one plugin instance), which is the right scope.
  const surfaced = new Set<string>();

  return {
    "chat.message": async (_input, output) => {
      try {
        const jobs = listJobs();
        const banner = buildJobsBanner(jobs, surfaced, Date.now());
        if (!banner) return;
        // Mark every finished job surfaced now (whether or not it was new this
        // turn) so it isn't repeated next turn.
        for (const j of jobs) {
          if (j.status === "exited" || j.status === "failed") surfaced.add(j.id);
        }
        const part = { type: "text", text: `\n\n${banner}` } as (typeof output.parts)[number];
        output.parts.push(part);
      } catch {
        // never break the message flow
      }
    },
  };
};

export default plugin;
