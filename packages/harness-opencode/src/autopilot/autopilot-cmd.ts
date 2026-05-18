/**
 * Autopilot command handler utilities.
 *
 * Provides validation and error reporting for autopilot configuration.
 */

import { validateConfig, type AutopilotConfig } from "./config-reader.js";

/**
 * Validates the autopilot config and exits with an error message if invalid.
 * On success, returns without error.
 *
 * @param config The fully-merged config (project + plan + phase + CLI overrides)
 */
export function validateConfigOrExit(config: AutopilotConfig): void {
  const result = validateConfig(config);

  if (result.ok) {
    return;
  }

  // Write error header
  process.stderr.write(`\n\x1b[31m✗ Config validation failed:\x1b[0m\n`);

  // Write each error with two-space indent
  for (const error of result.errors) {
    process.stderr.write(`  ✗ ${error.path}: ${error.message}\n`);
  }

  process.stderr.write("\n");
  process.exit(1);
}
