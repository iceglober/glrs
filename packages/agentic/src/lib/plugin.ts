import { VERSION } from "./version.js";

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  skills: string;
}

/**
 * Generate a Claude Code plugin manifest for the glorious skills package.
 * The manifest is written to `.claude-plugin/plugin.json` and enables
 * namespaced skill invocation (e.g., `/glorious:deep-plan`).
 */
export function generatePluginManifest(): PluginManifest {
  return {
    name: "glorious",
    version: VERSION,
    description: "AI-native development workflow skills for product and engineering",
    skills: "./skills",
  };
}
