/**
 * Public CLI handler exports for @glrs-dev/cli.
 *
 * This module is the library entry point for install/configure/doctor/uninstall
 * functionality. The @glrs-dev/cli package imports these handlers and wraps
 * them in its own cmd-ts subcommands under `glrs harness <cmd>`.
 *
 * Separate from index.ts (which must only have a default export for
 * OpenCode's plugin loader).
 */

export { install } from "./cli/install.js";
export type { InstallOptions } from "./cli/install.js";
export { uninstall } from "./cli/uninstall.js";
export type { UninstallOptions } from "./cli/uninstall.js";
export { doctor } from "./cli/doctor.js";
export { configureCmd } from "./cli/configure.js";
