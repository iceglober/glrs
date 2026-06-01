/**
 * dispatch-tracker — logs subagent dispatches to local files.
 *
 * Follows the cost-tracker pattern: append-only JSONL event log plus a
 * rollup snapshot, both under ~/.glrs/opencode/ (or $GLRS_COST_TRACKER_DIR).
 *
 * Files:
 *   - dispatches.jsonl : one JSON line per dispatch (source of truth)
 *   - dispatches.json  : rollup snapshot (total, byAgent, byTier)
 *
 * On startup, replays dispatches.jsonl to rebuild the rollup. Writes the
 * rollup on every dispatch (dispatches are infrequent enough not to need
 * debouncing). Uses atomic rename for rollup writes. Swallows all fs
 * errors with stderr warnings.
 */

import type { Plugin } from "@opencode-ai/plugin";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AGENT_TIERS, type AgentName } from "@glrs-dev/agent-core";

type DispatchLine = {
  ts: string;
  sessionID?: string;
  agent: string;
  tier: string | undefined;
};

type DispatchRollup = {
  version: 1;
  updatedAt: string;
  total: number;
  byAgent: Record<string, number>;
  byTier: Record<string, number>;
};

function extractAgentName(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const a = args as Record<string, unknown>;
  // OpenCode's task tool uses `subagent_type` per the binary inspection.
  // We also check `agent`/`agentName` defensively for older shapes.
  const direct =
    (a.subagent_type as string | undefined) ??
    (a.agent as string | undefined) ??
    (a.agentName as string | undefined);
  if (direct && typeof direct === "string") return direct.replace(/^@/, "");
  // Fall back to parsing @agent-name from the prompt's first line
  const prompt = (a.prompt ?? a.message ?? a.content ?? "") as string;
  const match = /(?:^|\s)@([\w-]+)\b/.exec(prompt);
  return match ? match[1] : undefined;
}

function tierFromAgentName(agent: string): string | undefined {
  // Authoritative: a registered agent's tier comes straight from the map.
  const known = AGENT_TIERS[agent as AgentName];
  if (known) return known;
  // Heuristics for unregistered (e.g. user-custom) agents by name suffix.
  if (agent.endsWith("-cheap")) return "cheap";
  if (agent.endsWith("-deep") || agent.endsWith("-thorough")) return "deep";
  // Default: don't guess
  return undefined;
}

function resolveDataDir(): string {
  const override = process.env.GLRS_COST_TRACKER_DIR;
  if (override) {
    if (override.startsWith("~")) {
      return path.join(os.homedir(), override.slice(1));
    }
    return override;
  }
  return path.join(os.homedir(), ".glrs", "opencode");
}

function emptyRollup(): DispatchRollup {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    total: 0,
    byAgent: {},
    byTier: {},
  };
}

const plugin: Plugin = async () => {
  const dataDir = resolveDataDir();
  const jsonlPath = path.join(dataDir, "dispatches.jsonl");
  const rollupPath = path.join(dataDir, "dispatches.json");

  const rollup: DispatchRollup = emptyRollup();

  // ---- error-debounce flags (warn once per category per session) ----
  const warned = new Set<string>();
  function warnOnce(category: string, err: unknown) {
    if (warned.has(category)) return;
    warned.add(category);
    const msg =
      err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
    process.stderr.write(`[dispatch-tracker] ${category}: ${msg}\n`);
  }

  let disabled = false;

  async function ensureDir(): Promise<boolean> {
    if (disabled) return false;
    try {
      await fs.mkdir(dataDir, { recursive: true });
      return true;
    } catch (err) {
      warnOnce("mkdir", err);
      disabled = true;
      return false;
    }
  }

  // ---- rollup mutation ----
  function applyToRollup(agent: string, tier: string | undefined) {
    rollup.total++;
    rollup.byAgent[agent] = (rollup.byAgent[agent] ?? 0) + 1;
    if (tier) {
      rollup.byTier[tier] = (rollup.byTier[tier] ?? 0) + 1;
    }
    rollup.updatedAt = new Date().toISOString();
  }

  // ---- rollup persistence (atomic rename) ----
  async function writeRollup() {
    if (disabled) return;
    if (!(await ensureDir())) return;
    const tmp = `${rollupPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
    try {
      await fs.writeFile(tmp, JSON.stringify(rollup, null, 2) + "\n", "utf8");
      await fs.rename(tmp, rollupPath);
    } catch (err) {
      warnOnce("rollup-write", err);
      try {
        await fs.unlink(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  // ---- jsonl append ----
  async function appendJsonl(line: DispatchLine) {
    if (disabled) return;
    if (!(await ensureDir())) return;
    const text = JSON.stringify(line) + "\n";
    try {
      await fs.appendFile(jsonlPath, text, "utf8");
    } catch (err) {
      warnOnce("jsonl-append", err);
    }
  }

  // ---- startup warm-up ----
  async function warmUp() {
    try {
      const raw = await fs.readFile(jsonlPath, "utf8");
      for (const rawLine of raw.split("\n")) {
        if (!rawLine) continue;
        let parsed: DispatchLine;
        try {
          parsed = JSON.parse(rawLine) as DispatchLine;
        } catch {
          // Corrupt line — skip.
          continue;
        }
        if (!parsed.agent) continue;
        rollup.total++;
        rollup.byAgent[parsed.agent] = (rollup.byAgent[parsed.agent] ?? 0) + 1;
        if (parsed.tier) {
          rollup.byTier[parsed.tier] = (rollup.byTier[parsed.tier] ?? 0) + 1;
        }
      }
      rollup.updatedAt = new Date().toISOString();
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e && e.code === "ENOENT") {
        // Fresh install — no prior log. Normal.
        return;
      }
      warnOnce("warmup", err);
    }
  }

  await warmUp();

  return {
    "tool.execute.after": async (input) => {
      if (input.tool !== "task") return;
      const agent = extractAgentName(input.args);
      if (!agent) return;
      const tier = tierFromAgentName(agent);

      const line: DispatchLine = {
        ts: new Date().toISOString(),
        ...(input.sessionID ? { sessionID: input.sessionID } : {}),
        agent,
        tier,
      };

      applyToRollup(agent, tier);
      await appendJsonl(line);
      await writeRollup();
    },
  };
};

export default plugin;
