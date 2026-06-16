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
 * This plugin adds the idle delivery channel. It hooks `session.idle`
 * (opencode's "agent finished its turn, now waiting" signal — the same one
 * `waitForIdle` settles on) and pushes a notice via `client.session.promptAsync`,
 * the proven idle-wake path also used by stall-detector. The push appends a new
 * user turn; it never mutates existing message parts (the schema break that
 * killed the chat.message banner).
 *
 * Why a poller and not just a one-shot check: `session.idle` fires ONCE, when
 * the turn ends. The common case is an agent that backgrounds a job and goes
 * idle *immediately*, while the job is still running — so a one-shot check at
 * idle finds nothing fresh and there is no later event when the job actually
 * exits. (That was the original bug: the agent was told it would be pinged,
 * stopped polling, and then waited forever.) So when the idle check sees jobs
 * still running for this session, it arms a short poller that watches the
 * on-disk job state and delivers the notice the moment they finish. The poller
 * is unref'd (never holds the process open) and self-limiting: it disarms after
 * delivering or once nothing is left running.
 *
 * Dedup is shared with the tool-output channel through `announcedFor` in
 * ../tools/background.js, so each completion is announced exactly once whichever
 * channel fires first. The announced-mark happens before the await, so a
 * concurrent poll tick or re-entrant idle can't double-announce.
 */

import type { Plugin } from "@opencode-ai/plugin";
import {
  listJobs,
  selectFreshCompletions,
  buildIdleNotice,
  announcedFor,
  selectSoftTimeoutNotices,
  buildHeartbeatNotice,
  softNotifiedPeriods,
} from "../tools/background.js";

/** Minimal slice of the opencode client this plugin needs. */
interface PromptClient {
  session: {
    promptAsync(args: {
      path: { id: string };
      body: { parts: { type: string; text: string }[] };
    }): Promise<unknown>;
  };
}

/** How often the idle poller re-checks on-disk job state for completions. */
let POLL_MS = 3000;

/** Active idle pollers, keyed by session id. One per session at most. */
const pollers = new Map<string, ReturnType<typeof setInterval>>();

function disarm(sessionID: string): void {
  const timer = pollers.get(sessionID);
  if (timer !== undefined) {
    clearInterval(timer);
    pollers.delete(sessionID);
  }
}

/**
 * Push the idle notice for any freshly-finished jobs in this session. Returns
 * whether a notice was sent and whether any of the session's jobs are still
 * running (so the caller knows if it's worth watching for more). Marks the
 * delivered jobs announced BEFORE the await so a concurrent tick/idle skips
 * them.
 */
async function deliverCompletions(
  client: PromptClient,
  sessionID: string,
): Promise<{ delivered: boolean; running: boolean }> {
  const announced = announcedFor(sessionID);
  const jobs = listJobs(sessionID);
  const fresh = selectFreshCompletions(jobs, sessionID, announced);
  const running = jobs.some(
    (j) => j.sessionID === sessionID && j.status === "running",
  );
  if (fresh.length === 0) return { delivered: false, running };

  for (const j of fresh) announced.add(j.id);
  await client.session.promptAsync({
    path: { id: sessionID },
    body: { parts: [{ type: "text", text: buildIdleNotice(fresh) }] },
  });
  return { delivered: true, running };
}

/**
 * Push a soft check-in for any of this session's jobs still running past a new
 * soft-timeout interval. The job is NOT touched — this only wakes the agent so
 * it can keep waiting or stop the job. Records each delivered period BEFORE the
 * await so a concurrent tick can't double-fire the same interval. Returns
 * whether a notice was sent.
 */
async function deliverHeartbeats(
  client: PromptClient,
  sessionID: string,
  now: number = Date.now(),
): Promise<{ delivered: boolean }> {
  const ledger = softNotifiedPeriods();
  const due = selectSoftTimeoutNotices(listJobs(sessionID), sessionID, now, ledger);
  if (due.length === 0) return { delivered: false };
  for (const d of due) ledger.set(d.job.id, d.period);
  await client.session.promptAsync({
    path: { id: sessionID },
    body: { parts: [{ type: "text", text: buildHeartbeatNotice(due, now) }] },
  });
  return { delivered: true };
}

/**
 * One poller iteration: deliver a completion if one is ready, else a soft
 * check-in if a running job has crossed its interval. Disarms after any delivery
 * (the push starts a new turn that ends in another `session.idle`, which re-arms
 * for still-running jobs) or once nothing is left running to wait for.
 */
async function pollOnce(client: PromptClient, sessionID: string): Promise<void> {
  try {
    const { delivered, running } = await deliverCompletions(client, sessionID);
    if (delivered) return disarm(sessionID);
    if (!running) return disarm(sessionID);
    const hb = await deliverHeartbeats(client, sessionID);
    if (hb.delivered) disarm(sessionID);
  } catch {
    disarm(sessionID);
  }
}

/** Start watching a session for completions, unless already watching it. */
function arm(client: PromptClient, sessionID: string): void {
  if (pollers.has(sessionID)) return;
  const timer = setInterval(() => {
    void pollOnce(client, sessionID);
  }, POLL_MS);
  // Never keep the process alive just to poll.
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
  pollers.set(sessionID, timer);
}

const plugin: Plugin = async (input) => {
  const client = input.client as unknown as PromptClient;

  return {
    event: async ({ event }: { event: { type: string; properties?: any } }) => {
      if (event.type !== "session.idle") return;
      const sessionID: string | undefined = event.properties?.sessionID;
      if (!sessionID) return;

      try {
        // A fresh idle supersedes any prior poller for this session.
        disarm(sessionID);

        const { delivered, running } = await deliverCompletions(client, sessionID);

        // No completion to report but a job's been running past its soft timeout?
        // Check in now (catch up if the agent was busy across an interval).
        if (!delivered && running) await deliverHeartbeats(client, sessionID);

        // Jobs still running? Watch for them to finish (or cross the next
        // interval) during this idle period — `session.idle` won't fire again on
        // its own when a job exits.
        if (running) arm(client, sessionID);
      } catch {
        // Best-effort — a session that's gone/busy or a job-state hiccup must
        // never throw out of the event hook.
      }
    },
  };
};

export default plugin;

/** Test-only hooks: drive the poller deterministically and tune the interval. */
export const __test__ = {
  deliverCompletions,
  deliverHeartbeats,
  pollOnce,
  setPollMs(ms: number) {
    POLL_MS = ms;
  },
  activePollers(): Set<string> {
    return new Set(pollers.keys());
  },
  clearPollers() {
    for (const t of pollers.values()) clearInterval(t);
    pollers.clear();
  },
};
