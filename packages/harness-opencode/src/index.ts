/**
 * @glrs-dev/harness-plugin-opencode — OpenCode plugin entry point.
 *
 * Registers agents, commands, MCPs, tools, and skills at runtime via the
 * OpenCode plugin `config` hook. Zero filesystem writes to user space.
 *
 * Skills are registered by pushing the bundled dist/skills/ directory onto
 * config.skills.paths. OpenCode's scanner processes hardcoded paths first,
 * then config.skills.paths last — so plugin-bundled skills win on name
 * collision (plugin-wins precedence, empirically verified in Spike 1).
 *
 * Agents, commands, and MCPs use user-wins precedence:
 *   input.agent = { ...ourAgents, ...(input.agent ?? {}) }
 * so user's opencode.json overrides take effect.
 */

import type { Plugin, Hooks, PluginOptions } from "@opencode-ai/plugin";

// CRITICAL: do NOT add named exports to this file. OpenCode's plugin loader
// was observed to crash at startup (`TypeError: undefined is not an object
// (evaluating 'V[G]')` inside its minified bundle) whenever this module
// exposed anything besides `export default`. Keep config-hook logic in
// ./config-hook.ts and tool-factory logic in ./tools/, and import them
// here as internals. Regression: test/plugin-entry-single-default-export.test.ts.
import { applyConfig } from "./config-hook.js";
import { createTools } from "./tools/index.js";
import {
  PACKAGE_NAME,
  readOurPackageVersion,
  refreshPluginCache,
} from "./auto-update.js";

// Dotenv loader — injects .env / .env.local into process.env before MCP
// config interpolation resolves {env:VAR} references.
import { loadDotenv } from "./plugins/dotenv.js";

// Sub-plugins (OS notifications + cost tracking + tool output middleware +
// parallel dispatch + stall detection + dispatch tracking)
import notifyPlugin from "./plugins/notify.js";
import costTrackerPlugin from "./plugins/cost-tracker.js";
import toolHooksPlugin from "./plugins/tool-hooks.js";
import parallelDispatchPlugin from "./plugins/parallel-dispatch.js";
import stallDetectorPlugin from "./plugins/stall-detector.js";
import dispatchTrackerPlugin from "./plugins/dispatch-tracker.js";
import backgroundNotifierPlugin from "./plugins/background-notifier.js";

// ---- Update notification ----

/**
 * The version we're running as. Read at module load from our own
 * package.json so the release pipeline doesn't have to patch a constant.
 * Drift-proof — the source of truth is one file.
 */
const BUNDLED_VERSION = readOurPackageVersion(import.meta.url);

async function checkForUpdate(client: any): Promise<void> {
  if (process.env["HARNESS_OPENCODE_UPDATE_CHECK"] === "0") return;

  // Fetch latest version from npm registry (3s timeout).
  // Runs once per OpenCode process start (plugin init). No file-based rate
  // limit — one registry hit per launch is negligible and ensures same-day
  // publishes are picked up immediately on the next session.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      { signal: controller.signal },
    );
    clearTimeout(timer);

    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    const latest = data.version;

    if (latest && latest !== BUNDLED_VERSION) {
      // Attempt to self-heal the OpenCode plugin cache so the next restart
      // picks up the new version. Best-effort — any failure degrades
      // gracefully to the old "inform the user, they restart" path.
      const refresh = await refreshPluginCache(BUNDLED_VERSION, latest).catch(
        (err) => ({
          outcome: "error" as const,
          message: (err as Error).message,
          fromVersion: BUNDLED_VERSION,
          toVersion: latest,
        }),
      );

      const toastMessage =
        refresh.outcome === "refreshed"
          ? `You have ${BUNDLED_VERSION}. Next OpenCode restart will auto-update.`
          : refresh.outcome === "disabled"
            ? `You have ${BUNDLED_VERSION}. Auto-update disabled; restart to pick up the new version (cache may need refresh).`
            : refresh.outcome === "non-exact-pin"
              ? `You have ${BUNDLED_VERSION}. Cache uses a custom version spec — run: bun update ${PACKAGE_NAME}`
              : // cache-missing / not-our-package / already-current / error
                `You have ${BUNDLED_VERSION}. Restart OpenCode to refresh (${refresh.outcome}).`;

      try {
        await client.tui.showToast({
          body: {
            title: `${PACKAGE_NAME} ${latest} available`,
            message: toastMessage,
            variant: "info",
            duration: 8000,
          },
        });
      } catch {
        // Headless — no-op
      }
    }
  } catch {
    // Network error or abort — silently skip
  }
}

// ---- Plugin entry ----

const plugin: Plugin = async (input, options) => {
  // Plugin options come from the opencode.json tuple:
  //   "plugin": [["@glrs-dev/harness-plugin-opencode", { models: {...}, toolHooks: {...} }]]
  // This is where users configure model tiers and tool-hooks behavior.
  // The options object is passed through to config-hook and sub-plugins.
  const pluginOptions = options ?? {};

  // Load .env / .env.local into process.env before anything else —
  // MCP config {env:VAR} interpolation reads process.env, so this must
  // run before sub-plugins and before OpenCode resolves MCP server config.
  loadDotenv(input.directory);

  // Fire update check in background (non-blocking)
  checkForUpdate(input.client).catch(() => {});

  // Load sub-plugins
  const notifyHooks = await notifyPlugin(input);
  const costTrackerHooks = await costTrackerPlugin(input);
  const toolHooks = await toolHooksPlugin(input, pluginOptions);
  const parallelDispatchHooks = await parallelDispatchPlugin(input);
  const stallDetectorHooks = await stallDetectorPlugin(input);
  const dispatchTrackerHooks = await dispatchTrackerPlugin(input);
  const backgroundNotifierHooks = await backgroundNotifierPlugin(input);

  // Merge all hooks.
  //
  // Defensively omit hook keys whose values are `undefined` — some
  // OpenCode loader paths iterate returned hooks by key and would
  // dereference an undefined slot. Prior release cycles chased two
  // related-looking errors (`M.config` / `S.auth` / `V[G]` inside the
  // minified OpenCode bundle) to this shape before the real culprit —
  // a non-default named export on this file — was identified. Keeping
  // the hooks object shape tight is cheap correctness insurance either
  // way.
  const hooks: Hooks = {
    // Config hook: register agents, commands, MCPs, skills
    config: async (config) => {
      applyConfig(config, pluginOptions);
      // Let sub-plugins also mutate config if they need to
      if (notifyHooks.config) await notifyHooks.config(config);
      if (costTrackerHooks.config) await costTrackerHooks.config(config);
      if (toolHooks.config) await toolHooks.config(config);
    },

    // Custom tools
    tool: createTools(),

    // Event handlers from sub-plugins
    event: async (input) => {
      if (notifyHooks.event) await notifyHooks.event(input);
      if (costTrackerHooks.event) await costTrackerHooks.event(input);
      if (stallDetectorHooks.event) await stallDetectorHooks.event(input);
    },
  };

  // chat.message — append a background-jobs banner so the model sees live job
  // state on each user turn (surface-once for finished jobs).
  if (backgroundNotifierHooks["chat.message"]) {
    hooks["chat.message"] = async (input, output) => {
      await backgroundNotifierHooks["chat.message"]!(input, output);
    };
  }

  // tool.execute.before — block question tool in headless mode + stall detector.
  // Throwing from tool.execute.before is the documented "deny this tool execution"
  // signal. The LLM gets an error response instead of a blocking prompt.
  hooks["tool.execute.before"] = async (input, output) => {
    // Block the question tool in headless autopilot mode. The Ralph loop
    // sets GLRS_AUTOPILOT_HEADLESS=1; throwing here prevents the tool from
    // executing at all — the LLM sees an error and adapts, no session hang.
    if (
      process.env["GLRS_AUTOPILOT_HEADLESS"] === "1" &&
      input.tool === "question"
    ) {
      throw new Error(
        "The question tool is not available in autopilot mode. " +
        "Pick a sensible default and continue without asking the user.",
      );
    }
    if (stallDetectorHooks["tool.execute.before"]) await stallDetectorHooks["tool.execute.before"]!(input, output);
  };

  // tool.execute.after — chain tool-hooks middleware (backpressure, verify
  // loop, loop detection, read dedup) + parallel dispatch + dispatch tracking.
  // tool-hooks runs first so its output mutations (e.g. backpressure
  // truncation) are visible to the agent.
  const hasToolHooksAfter = toolHooks["tool.execute.after"] !== undefined;
  const hasParallelAfter = parallelDispatchHooks["tool.execute.after"] !== undefined;
  const hasDispatchAfter = dispatchTrackerHooks["tool.execute.after"] !== undefined;
  const hasStallAfter = stallDetectorHooks["tool.execute.after"] !== undefined;
  if (hasToolHooksAfter || hasParallelAfter || hasDispatchAfter || hasStallAfter) {
    hooks["tool.execute.after"] = async (input, output) => {
      if (hasToolHooksAfter) await toolHooks["tool.execute.after"]!(input, output);
      if (hasParallelAfter) await parallelDispatchHooks["tool.execute.after"]!(input, output);
      if (hasDispatchAfter) await dispatchTrackerHooks["tool.execute.after"]!(input, output);
      if (hasStallAfter) await stallDetectorHooks["tool.execute.after"]!(input, output);
    };
  }

  return hooks;
};

export default plugin;
