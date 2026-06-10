/**
 * council — multi-model deliberation for high-stakes questions, after
 * karpathy/llm-council (https://github.com/karpathy/llm-council).
 *
 * Pipeline (all model calls are locked-down `@council-member` child sessions
 * with a per-message `model` override, so any provider the user has authed
 * in opencode works):
 *
 *   Stage 1 — every configured member answers the question independently.
 *   Stage 2 — every member reviews ALL stage-1 answers anonymized as
 *             "Response A/B/C…" and emits a parseable FINAL RANKING. Unlike
 *             upstream, label order is shuffled per reviewer (seeded, so
 *             deterministic in tests) — fixed label order gives every
 *             reviewer the same positional bias.
 *   Stage 3 — the chairman model sees the de-anonymized answers, the review
 *             prose, AND the aggregate ranking (upstream computes it but
 *             never shows the chairman) and synthesizes the final answer.
 *
 * A full run takes minutes; opencode cancels a tool call after ~30s. So the
 * `council` tool follows the background_run contract: it starts the pipeline
 * as an in-process job and returns a job id immediately. On completion the
 * result is pushed into the calling session via `client.session.promptAsync`
 * (the proven idle-wake path used by stall-detector and background-notifier).
 * `council_check` exists for on-demand polling. Jobs are in-memory only —
 * an opencode restart loses running councils (acceptable: minutes-scale work).
 */

import { tool } from "@opencode-ai/plugin";
import { AGENTS } from "@glrs-dev/agent-core";

// ---- config ----------------------------------------------------------------

export interface CouncilConfig {
  /** Member models as "provider/model-id" (opencode format). Min 2. */
  members: string[];
  /** Synthesis model, "provider/model-id". Defaults to the first member. */
  chairman?: string;
  /** Per model call. A member that exceeds this is dropped from the round. */
  timeoutMs?: number;
}

const DEFAULT_CALL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Read the council config from plugin options:
 *
 *   "plugin": [["@glrs-dev/harness-plugin-opencode", {
 *     "council": { "members": ["anthropic/claude-opus-4-7", "openai/gpt-5.1"],
 *                  "chairman": "anthropic/claude-opus-4-7" }
 *   }]]
 *
 * Returns null when the council is not (or not validly) configured — the
 * tools are simply not registered in that case. Chairman defaults to the
 * `deep` tier model when one is configured, else the first member.
 */
export function resolveCouncilConfig(
  pluginOptions: Record<string, unknown> | undefined,
): CouncilConfig | null {
  const raw = pluginOptions?.["council"];
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as Record<string, unknown>;

  const members = (Array.isArray(cfg["members"]) ? cfg["members"] : []).filter(
    (m): m is string => typeof m === "string" && m.indexOf("/") > 0,
  );
  if (members.length < 2) {
    console.warn(
      `[council] config present but fewer than 2 valid "provider/model-id" members — council tools disabled`,
    );
    return null;
  }

  const models = pluginOptions?.["models"] as
    | Record<string, string | string[]>
    | undefined;
  const deepRaw = models?.["deep"];
  const deepDefault = Array.isArray(deepRaw) ? deepRaw[0] : deepRaw;
  const chairman =
    typeof cfg["chairman"] === "string" && (cfg["chairman"] as string).indexOf("/") > 0
      ? (cfg["chairman"] as string)
      : (deepDefault ?? members[0]!);

  const timeoutMs =
    typeof cfg["timeoutMs"] === "number" && cfg["timeoutMs"] > 0
      ? (cfg["timeoutMs"] as number)
      : undefined;

  return { members, chairman, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
}

/** Parse "provider/model-id" into opencode's prompt-body model shape.
 * Splits on the FIRST slash — model ids may contain slashes. */
export function parseModelId(full: string): { providerID: string; modelID: string } {
  const slash = full.indexOf("/");
  if (slash <= 0 || slash === full.length - 1) {
    throw new Error(`council: invalid model id "${full}" (expected "provider/model-id")`);
  }
  return { providerID: full.slice(0, slash), modelID: full.slice(slash + 1) };
}

// ---- model-call seam --------------------------------------------------------

/** One council model call. Production impl spawns a child session; tests fake it. */
export type CouncilCaller = (call: {
  model: string;
  title: string;
  text: string;
  timeoutMs: number;
}) => Promise<string>;

/** Minimal client surface the production caller and notifier need. */
export interface CouncilClient {
  session: {
    create(args: {
      query?: { directory?: string };
      body: { parentID?: string; title?: string };
    }): Promise<{ data?: { id: string } }>;
    prompt(args: {
      path: { id: string };
      query?: { directory?: string };
      body: {
        model?: { providerID: string; modelID: string };
        agent?: string;
        parts: { type: "text"; text: string }[];
      };
    }): Promise<{ data?: { parts?: { type: string; text?: string }[] } }>;
    abort(args: { path: { id: string } }): Promise<unknown>;
    promptAsync(args: {
      path: { id: string };
      body: { parts: { type: string; text: string }[] };
    }): Promise<unknown>;
  };
}

/**
 * Production caller: one throwaway child session per model call, parented to
 * the invoking session so it nests in the UI like a task dispatch. The
 * `@council-member` agent supplies the lockdown (no tools, all-deny
 * permissions); the per-message `model` field supplies the member identity.
 */
export function opencodeCaller(
  client: CouncilClient,
  opts: { directory: string; parentSessionID?: string },
): CouncilCaller {
  return async ({ model, title, text, timeoutMs }) => {
    const { providerID, modelID } = parseModelId(model);
    const created = await client.session.create({
      query: { directory: opts.directory },
      body: { parentID: opts.parentSessionID, title },
    });
    const id = created.data?.id;
    if (!id) throw new Error(`council: session.create returned no id for ${model}`);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Best-effort: don't leave the child session generating into the void.
        void client.session.abort({ path: { id } }).catch(() => {});
        reject(new Error(`council: ${model} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
    });

    try {
      const res = await Promise.race([
        client.session.prompt({
          path: { id },
          query: { directory: opts.directory },
          body: {
            model: { providerID, modelID },
            agent: AGENTS.COUNCIL_MEMBER,
            parts: [{ type: "text", text }],
          },
        }),
        timeout,
      ]);
      const out = (res.data?.parts ?? [])
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text as string)
        .join("\n\n")
        .trim();
      if (!out) throw new Error(`council: ${model} returned an empty response`);
      return out;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

// ---- stage prompts ----------------------------------------------------------

export interface MemberAnswer {
  model: string;
  text: string;
}

export function buildStage1Prompt(question: string, context?: string): string {
  return context && context.trim()
    ? `Background context:\n\n${context.trim()}\n\n---\n\nQuestion: ${question}`
    : question;
}

/** Label text used in stage 2, "Response A" … "Response Z". */
export function labelFor(i: number): string {
  return `Response ${String.fromCharCode(65 + i)}`;
}

// Prompt kept close to upstream llm-council verbatim — its rigid FINAL
// RANKING contract is what makes the parse reliable.
export function buildStage2Prompt(
  question: string,
  labeled: { label: string; text: string }[],
): string {
  const responsesText = labeled
    .map((r) => `${r.label}:\n${r.text}`)
    .join("\n\n");
  const labels = labeled.map((r) => r.label);
  return `You are evaluating different responses to the following question:

Question: ${question}

Here are the responses from different models (anonymized):

${responsesText}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. ${labels[0]}")
- Do not add any other text or explanations in the ranking section

Now provide your evaluation and ranking:`;
}

// ---- deterministic per-reviewer shuffle --------------------------------------

/** mulberry32 — tiny seeded PRNG, deterministic across runs/platforms. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Order in which reviewer `reviewerIndex` sees the answers (indices into the
 * answers array). Seeded Fisher–Yates: each reviewer gets a different order,
 * so positional bias doesn't land on the same answer for every reviewer, and
 * tests stay deterministic.
 */
export function reviewerOrder(answerCount: number, reviewerIndex: number): number[] {
  const order = Array.from({ length: answerCount }, (_, i) => i);
  const rand = mulberry32(0x9e3779b9 ^ (reviewerIndex + 1));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

// ---- ranking parse + aggregation ---------------------------------------------

/**
 * Extract the ranked labels (best→worst) from a stage-2 review. Upstream
 * semantics: split on "FINAL RANKING:" and read "N. Response X" lines from
 * the tail; if the header is missing, fall back to label mentions anywhere
 * in the text, in order of appearance. Unknown labels are ignored;
 * duplicates keep their first position.
 */
export function parseRankingLabels(text: string, validLabels: string[]): string[] {
  const valid = new Set(validLabels);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (label: string) => {
    if (valid.has(label) && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  };

  const headerIdx = text.lastIndexOf("FINAL RANKING:");
  if (headerIdx !== -1) {
    const tail = text.slice(headerIdx);
    for (const m of tail.matchAll(/\d+\.\s*(Response [A-Z])/g)) push(m[1]!);
    if (out.length > 0) return out;
  }
  for (const m of text.matchAll(/(Response [A-Z])/g)) push(m[1]!);
  return out;
}

export interface ParsedReview {
  reviewer: string;
  text: string;
  /** Models best→worst, de-anonymized; empty when the parse found nothing. */
  ranking: string[];
}

export interface AggregateEntry {
  model: string;
  /** Mean 1-based position across reviews that ranked this model. */
  averageRank: number;
  votes: number;
}

export function aggregateRanks(reviews: ParsedReview[]): AggregateEntry[] {
  const positions = new Map<string, number[]>();
  for (const review of reviews) {
    review.ranking.forEach((model, idx) => {
      const arr = positions.get(model) ?? [];
      arr.push(idx + 1);
      positions.set(model, arr);
    });
  }
  return [...positions.entries()]
    .map(([model, pos]) => ({
      model,
      averageRank: pos.reduce((a, b) => a + b, 0) / pos.length,
      votes: pos.length,
    }))
    .sort((a, b) => a.averageRank - b.averageRank);
}

export function buildChairmanPrompt(
  question: string,
  answers: MemberAnswer[],
  reviews: ParsedReview[],
  aggregate: AggregateEntry[],
  context?: string,
): string {
  const stage1Text = answers
    .map((a) => `Model: ${a.model}\nResponse: ${a.text}`)
    .join("\n\n---\n\n");
  const stage2Text =
    reviews.length > 0
      ? reviews
          .map((r) => `Model: ${r.reviewer}\nReview: ${r.text}`)
          .join("\n\n---\n\n")
      : "(no peer reviews completed)";
  const aggregateText =
    aggregate.length > 0
      ? aggregate
          .map(
            (e, i) =>
              `${i + 1}. ${e.model} (average rank ${e.averageRank.toFixed(2)} across ${e.votes} vote${e.votes === 1 ? "" : "s"})`,
          )
          .join("\n")
      : "(no rankings could be parsed)";

  return `You are the Chairman of an LLM Council. Multiple AI models have provided responses to a question, and then ranked each other's responses anonymously.

Original Question: ${question}
${context && context.trim() ? `\nBackground context:\n${context.trim()}\n` : ""}
STAGE 1 - Individual Responses:

${stage1Text}

STAGE 2 - Peer Reviews:

${stage2Text}

AGGREGATE PEER RANKING (mean position, best first):

${aggregateText}

Your task as Chairman is to synthesize all of this into a single, comprehensive, accurate answer to the original question. Consider:
- The individual responses and their insights
- The peer reviews, the aggregate ranking, and what they reveal about response quality
- Any patterns of agreement or disagreement — flag genuine disagreement rather than papering over it

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:`;
}

// ---- pipeline ----------------------------------------------------------------

export interface CouncilRunResult {
  question: string;
  answers: MemberAnswer[];
  reviews: ParsedReview[];
  aggregate: AggregateEntry[];
  chairman: string;
  synthesis: string;
  /** "model: reason" strings for members that failed/timed out, per stage. */
  failures: string[];
  /** True when the chairman call failed and `synthesis` is a fallback. */
  chairmanFallback: boolean;
}

export async function runCouncil(
  call: CouncilCaller,
  config: CouncilConfig,
  question: string,
  context?: string,
): Promise<CouncilRunResult> {
  const members = config.members;
  if (!Array.isArray(members) || members.length < 2) {
    throw new Error("council: at least 2 members must be configured");
  }
  const chairman = config.chairman ?? members[0]!;
  const timeoutMs = config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const failures: string[] = [];

  // Stage 1 — independent answers, in parallel. Failures drop (upstream
  // behavior) but are reported.
  const stage1Prompt = buildStage1Prompt(question, context);
  const stage1 = await Promise.allSettled(
    members.map((model) =>
      call({ model, title: `council answer: ${model}`, text: stage1Prompt, timeoutMs }),
    ),
  );
  const answers: MemberAnswer[] = [];
  stage1.forEach((res, i) => {
    if (res.status === "fulfilled") {
      answers.push({ model: members[i]!, text: res.value });
    } else {
      failures.push(`${members[i]} (stage 1): ${res.reason?.message ?? res.reason}`);
    }
  });
  if (answers.length < 2) {
    throw new Error(
      `council: only ${answers.length}/${members.length} members answered — not enough for a council round.\n${failures.join("\n")}`,
    );
  }

  // Stage 2 — anonymized peer review, every member reviews all answers
  // (including unknowingly its own). Per-reviewer shuffled label order.
  const reviewerMaps = members.map((_, reviewerIndex) => {
    const order = reviewerOrder(answers.length, reviewerIndex);
    const labeled = order.map((answerIdx, displayIdx) => ({
      label: labelFor(displayIdx),
      text: answers[answerIdx]!.text,
      model: answers[answerIdx]!.model,
    }));
    return { labeled, labelToModel: new Map(labeled.map((l) => [l.label, l.model])) };
  });
  const stage2 = await Promise.allSettled(
    members.map((model, reviewerIndex) =>
      call({
        model,
        title: `council review: ${model}`,
        text: buildStage2Prompt(question, reviewerMaps[reviewerIndex]!.labeled),
        timeoutMs,
      }),
    ),
  );
  const reviews: ParsedReview[] = [];
  stage2.forEach((res, i) => {
    if (res.status === "fulfilled") {
      const { labeled, labelToModel } = reviewerMaps[i]!;
      const labels = parseRankingLabels(
        res.value,
        labeled.map((l) => l.label),
      );
      reviews.push({
        reviewer: members[i]!,
        text: res.value,
        ranking: labels.map((label) => labelToModel.get(label)!),
      });
    } else {
      failures.push(`${members[i]} (stage 2): ${res.reason?.message ?? res.reason}`);
    }
  });

  const aggregate = aggregateRanks(reviews);

  // Stage 3 — chairman synthesis. On failure, fall back to the top-ranked
  // (or first) answer instead of upstream's literal error string.
  let synthesis: string;
  let chairmanFallback = false;
  try {
    synthesis = await call({
      model: chairman,
      title: `council chairman: ${chairman}`,
      text: buildChairmanPrompt(question, answers, reviews, aggregate, context),
      timeoutMs,
    });
  } catch (err) {
    chairmanFallback = true;
    failures.push(`${chairman} (chairman): ${(err as Error).message}`);
    const topModel = aggregate[0]?.model;
    const top = answers.find((a) => a.model === topModel) ?? answers[0]!;
    synthesis = top.text;
  }

  return { question, answers, reviews, aggregate, chairman, synthesis, failures, chairmanFallback };
}

// ---- report formatting ---------------------------------------------------------

export function formatCouncilReport(result: CouncilRunResult): string {
  const lines: string[] = [];
  if (result.chairmanFallback) {
    lines.push(
      `> Chairman (${result.chairman}) failed — showing the top peer-ranked answer instead of a synthesis.`,
      "",
    );
  }
  lines.push(`## Council synthesis`, "", result.synthesis, "", "---", "");
  lines.push(`**Chairman:** ${result.chairman}`);
  lines.push(`**Members answered:** ${result.answers.map((a) => a.model).join(", ")}`);
  if (result.aggregate.length > 0) {
    lines.push("", "**Aggregate peer ranking** (mean position, best first):");
    result.aggregate.forEach((e, i) => {
      lines.push(`${i + 1}. ${e.model} — avg rank ${e.averageRank.toFixed(2)} (${e.votes} vote${e.votes === 1 ? "" : "s"})`);
    });
  }
  if (result.failures.length > 0) {
    lines.push("", "**Failures:**");
    for (const f of result.failures) lines.push(`- ${f}`);
  }
  return lines.join("\n");
}

// ---- job registry + tools -------------------------------------------------------

type CouncilJobStatus = "running" | "done" | "error";

interface CouncilJob {
  id: string;
  sessionID: string;
  question: string;
  startedAt: number;
  status: CouncilJobStatus;
  report?: string;
  error?: string;
}

/** In-memory; lost on opencode restart (council runs are minutes-scale). */
const jobs = new Map<string, CouncilJob>();

function newCouncilJobId(): string {
  return `council-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function jobSummary(job: CouncilJob): string {
  const age = Math.round((Date.now() - job.startedAt) / 1000);
  return `${job.id} [${job.status}] (${age}s ago): ${job.question.slice(0, 100)}`;
}

export interface CouncilToolDeps {
  client: CouncilClient;
  config: CouncilConfig;
  /** Test seam — defaults to the real opencode child-session caller. */
  makeCaller?: (
    client: CouncilClient,
    opts: { directory: string; parentSessionID?: string },
  ) => CouncilCaller;
}

export function createCouncilTools(deps: CouncilToolDeps) {
  const { client, config } = deps;
  const makeCaller = deps.makeCaller ?? opencodeCaller;
  const memberList = config.members.join(", ");
  const chairman = config.chairman ?? config.members[0]!;

  const councilTool = tool({
    description:
      "Convene the LLM council on ONE hard question: each configured member model answers " +
      "independently, members peer-review the anonymized answers, and a chairman model " +
      "synthesizes a final answer with an aggregate peer ranking. " +
      `Members: ${memberList}. Chairman: ${chairman}. ` +
      "Use for high-stakes judgment calls where single-model reasoning is the bottleneck — " +
      "architecture choices, contested tradeoffs, 'is this approach sound' — NOT for anything " +
      "you can verify empirically (tests, types, docs) and NOT for routine decisions. " +
      "Runs take several minutes, so this returns a job id immediately and the full council " +
      "report is PUSHED to this session as a message when ready. Do NOT poll council_check in " +
      "a loop — continue other work (or wrap up) and the result will reach you.",
    args: {
      question: tool.schema
        .string()
        .describe("The single question to put to the council. Self-contained — members cannot see this session."),
      context: tool.schema
        .string()
        .optional()
        .describe(
          "Background the members need to answer well: constraints, relevant code excerpts, " +
            "options already considered. Members have NO tools and NO access to the repo — " +
            "everything they need must be in here.",
        ),
    },
    async execute(args, context) {
      const job: CouncilJob = {
        id: newCouncilJobId(),
        sessionID: context.sessionID,
        question: args.question,
        startedAt: Date.now(),
        status: "running",
      };
      jobs.set(job.id, job);
      context.metadata({ title: `council: ${args.question.slice(0, 60)}` });

      const call = makeCaller(client, {
        directory: context.directory,
        parentSessionID: context.sessionID,
      });

      // Detached pipeline — the tool call returns immediately; the result is
      // pushed to the session when ready (background_run contract).
      void runCouncil(call, config, args.question, args.context)
        .then((result) => {
          job.status = "done";
          job.report = formatCouncilReport(result);
        })
        .catch((err) => {
          job.status = "error";
          job.error = (err as Error).message;
        })
        .then(() =>
          client.session.promptAsync({
            path: { id: job.sessionID },
            body: {
              parts: [
                {
                  type: "text",
                  text:
                    job.status === "done"
                      ? `[council] Job ${job.id} finished. Question: ${job.question}\n\n${job.report}`
                      : `[council] Job ${job.id} FAILED: ${job.error}`,
                },
              ],
            },
          }),
        )
        .catch(() => {
          // Delivery failed (session gone?). The result stays available via
          // council_check; never throw from a floating promise.
        });

      return (
        `Council convened (job ${job.id}) — ${config.members.length} members, chairman ${chairman}. ` +
        `The full report will be pushed to this session when deliberation finishes (typically 2-5 min). ` +
        `Continue other work; check on demand with council_check(job_id: "${job.id}").`
      );
    },
  });

  const councilCheckTool = tool({
    description:
      "Check on a council deliberation started with the council tool. With job_id, returns " +
      "that job's status or full report; without, lists this session's council jobs.",
    args: {
      job_id: tool.schema
        .string()
        .optional()
        .describe("Job id returned by the council tool. Omit to list jobs for this session."),
    },
    async execute(args, context) {
      if (!args.job_id) {
        const mine = [...jobs.values()].filter((j) => j.sessionID === context.sessionID);
        if (mine.length === 0) return "No council jobs in this session.";
        return mine.map(jobSummary).join("\n");
      }
      const job = jobs.get(args.job_id);
      if (!job) {
        return `Unknown council job "${args.job_id}" (jobs do not survive an opencode restart).`;
      }
      if (job.status === "running") {
        return `${jobSummary(job)}\nStill deliberating — the report will be pushed to this session when ready.`;
      }
      if (job.status === "error") return `${jobSummary(job)}\nError: ${job.error}`;
      return job.report ?? "(report missing)";
    },
  });

  return { council: councilTool, council_check: councilCheckTool };
}

/** Test-only: reset the in-memory job registry. */
export const __test__ = {
  jobs,
  clearJobs() {
    jobs.clear();
  },
};
