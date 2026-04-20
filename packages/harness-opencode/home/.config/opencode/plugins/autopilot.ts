import type { Plugin } from "@opencode-ai/plugin";
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface SessionAutopilot {
  iterations: number;
  lastPlanPath?: string;
}

interface AutopilotState {
  sessions: Record<string, SessionAutopilot>;
}

const STATE_PATH = ".agent/autopilot-state.json";
const MAX_ITERATIONS = 10;
const TARGET_AGENTS = new Set(["build", "orchestrator"]);
const MESSAGE_LIMIT = 60;

async function readState(dir: string): Promise<AutopilotState> {
  try {
    const raw = await fs.readFile(path.join(dir, STATE_PATH), "utf8");
    const parsed = JSON.parse(raw) as AutopilotState;
    return { sessions: parsed.sessions ?? {} };
  } catch {
    return { sessions: {} };
  }
}

async function writeState(dir: string, state: AutopilotState): Promise<void> {
  const p = path.join(dir, STATE_PATH);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(state, null, 2) + "\n", "utf8");
}

type RawMessage = { info: any; parts: Array<any> };

function findPlanPath(messages: RawMessage[]): string | null {
  const re = /\.agent\/plans\/[\w-]+\.md/;
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].parts ?? [];
    for (const part of parts) {
      if (part.type === "text" && typeof part.text === "string") {
        const m = part.text.match(re);
        if (m) return m[0];
      }
    }
  }
  return null;
}

function countUnchecked(planContent: string): number {
  const section = /## Acceptance criteria([\s\S]*?)(?=\n##|$)/.exec(planContent);
  if (!section) return 0;
  const matches = section[1].match(/^- \[ \]/gm);
  return matches?.length ?? 0;
}

function lastAssistantFailed(messages: RawMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.info?.role !== "assistant") continue;
    const text = (msg.parts ?? [])
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n");
    return /\b(test failed|tests? failed|lint error|typecheck failed|FAIL\b|error:)/i.test(
      text,
    );
  }
  return false;
}

function latestUserAgent(messages: RawMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i].info;
    if (info?.role === "user" && typeof info.agent === "string") {
      return info.agent;
    }
  }
  return undefined;
}

const plugin: Plugin = async ({ client, directory }) => {
  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return;
      const sessionID = event.properties.sessionID;

      const msgsResp = await client.session.messages({
        path: { id: sessionID },
        query: { limit: MESSAGE_LIMIT },
      });
      const messages = (msgsResp.data ?? []) as RawMessage[];

      const agent = latestUserAgent(messages);
      if (!agent || !TARGET_AGENTS.has(agent)) return;

      const state = await readState(directory);
      const sessState: SessionAutopilot = state.sessions[sessionID] ?? { iterations: 0 };

      if (sessState.iterations >= MAX_ITERATIONS) {
        await client.session.promptAsync({
          path: { id: sessionID },
          body: {
            parts: [
              {
                type: "text",
                text:
                  `[autopilot] Stopped: hit max iterations (${MAX_ITERATIONS}). ` +
                  `Either the work is complete or stuck. Review and resume manually if needed.`,
              },
            ],
          },
        });
        state.sessions[sessionID] = { iterations: 0 };
        await writeState(directory, state);
        return;
      }

      const planPath = findPlanPath(messages);
      if (!planPath) return;

      let planContent: string;
      try {
        planContent = await fs.readFile(path.join(directory, planPath), "utf8");
      } catch {
        return;
      }

      const unchecked = countUnchecked(planContent);
      const failed = lastAssistantFailed(messages);

      if (unchecked === 0 && !failed) {
        state.sessions[sessionID] = { iterations: 0 };
        await writeState(directory, state);
        return;
      }

      const reason =
        unchecked > 0
          ? `Plan has ${unchecked} unchecked acceptance criteria.`
          : "Last verification step failed.";

      await client.session.promptAsync({
        path: { id: sessionID },
        body: {
          parts: [
            {
              type: "text",
              text:
                `[autopilot] ${reason} Continue execution. Re-read the plan at ${planPath} ` +
                `and resume from where you left off. If the plan itself is wrong, STOP and report.`,
            },
          ],
        },
      });

      state.sessions[sessionID] = {
        iterations: sessState.iterations + 1,
        lastPlanPath: planPath,
      };
      await writeState(directory, state);
    },

    "chat.message": async ({ sessionID, agent }) => {
      if (!agent || !TARGET_AGENTS.has(agent)) return;
      const state = await readState(directory);
      if (state.sessions[sessionID]) {
        state.sessions[sessionID] = { iterations: 0 };
        await writeState(directory, state);
      }
    },
  };
};

export default plugin;
