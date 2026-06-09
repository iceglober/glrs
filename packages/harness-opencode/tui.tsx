/**
 * opencode TUI sidebar widget for the harness's background jobs.
 *
 * The `./tui` entrypoint of @glrs-dev/harness-plugin-opencode. opencode treats
 * this package as having two targets: the server plugin (`.` → dist/index.js,
 * the hooks/tools/agents) and this TUI plugin. They load via separate paths —
 * the server via the config `plugin` array, this via opencode's TUI registry —
 * so the sidebar is activated by registering the package as a TUI plugin:
 *
 *     opencode plugin @glrs-dev/harness-plugin-opencode
 *
 * Registers a `sidebar_content` slot that reads background-job state from disk
 * (`$XDG_STATE_HOME/harness-opencode/background-jobs/`, the same dir
 * `background_run` writes — no coupling to the server plugin), filters by the
 * slot's `session_id`, and renders a live, 2s-refreshed list. opencode
 * transpiles this Solid `.tsx` and provides the runtime; it is not built by the
 * harness's tsup pipeline.
 *
 * The `slots`/`tui` surface is typed (`@opencode-ai/plugin/tui`) but not part of
 * opencode's stable plugin contract — it may change between opencode versions.
 */

import { createSignal, For, onCleanup } from "solid-js";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface JobRow {
  id: string;
  label: string;
  startedAt: number;
}

/** Compact elapsed-time label, e.g. "5s" / "3m" / "1h12m". */
function fmtElapsed(startedAt: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - startedAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

// Mirror of the harness's job dir (packages/harness-opencode/src/tools/background.ts).
function jobsRoot(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "harness-opencode", "background-jobs");
}

// Read the current session's *running* background jobs. The sidebar is a
// live-activity widget, so it shows only active work — finished jobs are
// reported to the agent via the completion channel and would otherwise pile up
// here for 24h until the TTL purges them. `sessionID` scopes strictly to jobs
// this session launched; an unstamped/legacy job (no sessionID) is NOT shown
// when a session is known, so other sessions' old jobs never leak in. Pass
// undefined (no active session) to show all running jobs.
function readJobs(sessionID?: string): JobRow[] {
  let ids: string[];
  try {
    ids = readdirSync(jobsRoot());
  } catch {
    return [];
  }
  const rows: JobRow[] = [];
  for (const id of ids) {
    const dir = join(jobsRoot(), id);
    let meta: {
      command?: string;
      title?: string | null;
      sessionID?: string | null;
      pid?: number;
      startedAt?: number;
    };
    try {
      meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    } catch {
      continue;
    }
    // Strict per-session isolation: only this session's own jobs.
    if (sessionID !== undefined && (meta.sessionID ?? null) !== sessionID) continue;
    // Active jobs only: skip anything that has recorded an exit code (finished)
    // or whose pid is no longer alive (crashed/killed).
    if (existsSync(join(dir, "exit_code"))) continue;
    if (meta.pid) {
      try {
        process.kill(meta.pid, 0);
      } catch {
        continue; // dead pid, no exit code → not active
      }
    }
    // Prefer the caller-supplied title; fall back to the command.
    const label = (meta.title && meta.title.trim()) || String(meta.command ?? "");
    rows.push({
      id,
      label: label.replace(/\s+/g, " ").trim().slice(0, 36),
      startedAt: meta.startedAt ?? 0,
    });
  }
  // Newest first.
  return rows.sort((a, b) => b.startedAt - a.startedAt);
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  api.slots.register({
    order: 250,
    slots: {
      sidebar_content(_ctx, props) {
        const sid = props.session_id;
        const [jobs, setJobs] = createSignal<JobRow[]>(readJobs(sid));
        const timer = setInterval(() => setJobs(readJobs(sid)), 2000);
        onCleanup(() => clearInterval(timer));

        const t = api.theme.current;

        return (
          <box flexDirection="column" gap={0}>
            <text fg={t.textMuted}>{`background jobs (${jobs().length} running)`}</text>
            <For each={jobs()} fallback={<text fg={t.textMuted}>{"  (none running)"}</text>}>
              {(j) => <text fg={t.info}>{`  ${fmtElapsed(j.startedAt).padEnd(6)} ${j.label}`}</text>}
            </For>
          </box>
        );
      },
    },
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: "glrs.background-sidebar",
  tui,
};

export default plugin;
