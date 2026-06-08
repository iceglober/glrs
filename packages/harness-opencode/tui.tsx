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
  status: "running" | "exited" | "failed";
  exitCode: number | null;
}

// Mirror of the harness's job dir (packages/harness-opencode/src/tools/background.ts).
function jobsRoot(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "harness-opencode", "background-jobs");
}

// `sessionID` filters to jobs launched by the current session (per-session
// isolation); pass undefined to show all.
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
    // Per-session isolation; a session-less job (null) is treated as global.
    const ms = meta.sessionID ?? null;
    if (sessionID !== undefined && ms !== null && ms !== sessionID) continue;
    let status: JobRow["status"] = "running";
    let exitCode: number | null = null;
    if (existsSync(join(dir, "exit_code"))) {
      const raw = readFileSync(join(dir, "exit_code"), "utf8").trim();
      exitCode = Number.parseInt(raw, 10);
      status = "exited";
    } else if (meta.pid) {
      try {
        process.kill(meta.pid, 0);
      } catch {
        status = "failed";
      }
    }
    // Prefer the caller-supplied title; fall back to the command.
    const label = (meta.title && meta.title.trim()) || String(meta.command ?? "");
    rows.push({
      id,
      label: label.replace(/\s+/g, " ").trim().slice(0, 36),
      status,
      exitCode,
    });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
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
        const color = (j: JobRow) =>
          j.status === "running" ? t.info : j.status === "exited" && j.exitCode === 0 ? t.success : t.error;
        const statusLabel = (j: JobRow) =>
          j.status === "running"
            ? "running"
            : j.status === "exited"
              ? `exit ${j.exitCode ?? "?"}`
              : "stopped";

        return (
          <box flexDirection="column" gap={0}>
            <text fg={t.textMuted}>background jobs</text>
            <For each={jobs()} fallback={<text fg={t.textMuted}>{"  (none)"}</text>}>
              {(j) => <text fg={color(j)}>{`  ${statusLabel(j).padEnd(8)} ${j.label}`}</text>}
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
