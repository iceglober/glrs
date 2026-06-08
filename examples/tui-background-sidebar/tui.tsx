/**
 * SPIKE — opencode TUI sidebar widget for harness background jobs.
 *
 * Goal: confirm opencode's (experimental, community-demonstrated) sidebar slot
 * API works on your build before investing in a full widget. It registers a
 * `sidebar_content` slot that reads the harness background-jobs state from disk
 * and renders a live, auto-refreshing list.
 *
 * NOT verified end-to-end by the author (no TUI available in the build env) and
 * NOT published. The `slots`/`tui` surface is typed via `@opencode-ai/plugin/tui`
 * but is not part of opencode's stable plugin contract — treat as a spike.
 *
 * Modeled on streetturtle/opencode-better-sidebar (plugins/open-in).
 */

import { createSignal, For, onCleanup } from "solid-js";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface JobRow {
  id: string;
  command: string;
  status: "running" | "exited" | "failed";
  exitCode: number | null;
}

// Mirror of the harness's job dir (packages/harness-opencode/src/tools/background.ts).
function jobsRoot(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "harness-opencode", "background-jobs");
}

function readJobs(): JobRow[] {
  let ids: string[];
  try {
    ids = readdirSync(jobsRoot());
  } catch {
    return [];
  }
  const rows: JobRow[] = [];
  for (const id of ids) {
    const dir = join(jobsRoot(), id);
    let meta: { command?: string; pid?: number; startedAt?: number };
    try {
      meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    } catch {
      continue;
    }
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
    rows.push({
      id,
      command: String(meta.command ?? "").replace(/\s+/g, " ").trim().slice(0, 36),
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
      sidebar_content() {
        const [jobs, setJobs] = createSignal<JobRow[]>(readJobs());
        const timer = setInterval(() => setJobs(readJobs()), 2000);
        onCleanup(() => clearInterval(timer));

        const t = api.theme.current;
        const color = (j: JobRow) =>
          j.status === "running" ? t.info : j.status === "exited" && j.exitCode === 0 ? t.success : t.error;
        const label = (j: JobRow) =>
          j.status === "running"
            ? "running"
            : j.status === "exited"
              ? `exit ${j.exitCode ?? "?"}`
              : "stopped";

        return (
          <box flexDirection="column" gap={0}>
            <text fg={t.textMuted}>background jobs</text>
            <For each={jobs()} fallback={<text fg={t.textMuted}>{"  (none)"}</text>}>
              {(j) => (
                <text fg={color(j)}>{`  ${label(j).padEnd(8)} ${j.id.replace(/^bg-/, "")}  ${j.command}`}</text>
              )}
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
