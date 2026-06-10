import type { ToolDefinition } from "@opencode-ai/plugin";
import astGrepTool from "./ast_grep.js";
import tscCheckTool from "./tsc_check.js";
import eslintCheckTool from "./eslint_check.js";
import todoScanTool from "./todo_scan.js";
import commentCheckTool from "./comment_check.js";
import { backgroundTools } from "./background.js";
import {
  createCouncilTools,
  resolveCouncilConfig,
  type CouncilClient,
} from "./council.js";

export interface CreateToolsDeps {
  /** Opencode client from the plugin input — needed by the council tools. */
  client?: CouncilClient;
  /** Raw plugin options tuple payload from opencode.json. */
  pluginOptions?: Record<string, unknown>;
}

export function createTools(deps: CreateToolsDeps = {}): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {
    ast_grep: astGrepTool,
    tsc_check: tscCheckTool,
    eslint_check: eslintCheckTool,
    todo_scan: todoScanTool,
    comment_check: commentCheckTool,
    ...backgroundTools,
  };

  // Council tools exist only when the user configured members — an
  // unconfigured install never shows the model a tool it can't use.
  const councilConfig = resolveCouncilConfig(deps.pluginOptions);
  if (councilConfig && deps.client) {
    Object.assign(tools, createCouncilTools({ client: deps.client, config: councilConfig }));
  }

  return tools;
}
