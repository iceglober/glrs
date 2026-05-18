/**
 * Interactive file picker for plan files.
 *
 * Starts at the given root directory, shows .md files and subdirectories.
 * The user can drill into directories or select a file. Returns the
 * absolute path to the selected file, or null if cancelled.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Browse for a plan file starting at `rootDir`.
 * Returns the absolute path to the selected .md file or directory
 * (if it contains main.md), or null if the user cancels.
 */
export async function pickPlanFile(rootDir: string): Promise<string | null> {
  const { select } = await import("@inquirer/prompts");

  let currentDir = path.resolve(rootDir);

  while (true) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return null;
    }

    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();

    if (dirs.length === 0 && files.length === 0) {
      process.stderr.write(`  No .md files found in ${currentDir}\n`);
      return null;
    }

    type Choice = { name: string; value: string };
    const choices: Choice[] = [];

    // Directories — check if they contain main.md (multi-file plan)
    for (const d of dirs) {
      const dirPath = path.join(currentDir, d);
      const hasMain = fs.existsSync(path.join(dirPath, "main.md"));
      if (hasMain) {
        const phaseCount = fs.readdirSync(dirPath).filter((f) =>
          f.endsWith(".md") && f !== "main.md" && f !== "scope.md" && f !== "scope-seed.md"
        ).length;
        choices.push({
          name: `📋 ${d}/  (plan: main.md + ${phaseCount} phases)`,
          value: `plan:${dirPath}`,
        });
      } else {
        choices.push({
          name: `📁 ${d}/`,
          value: `dir:${dirPath}`,
        });
      }
    }

    // Files
    for (const f of files) {
      choices.push({
        name: `  ${f}`,
        value: `file:${path.join(currentDir, f)}`,
      });
    }

    // Navigation
    if (currentDir !== path.resolve(rootDir)) {
      choices.push({ name: "↩ Back", value: "back" });
    }
    choices.push({ name: "✕ Cancel", value: "cancel" });

    const relDir = path.relative(rootDir, currentDir) || ".";
    const answer = await select({
      message: `Select a plan (${relDir}):`,
      choices,
    });

    if (answer === "cancel") return null;
    if (answer === "back") {
      currentDir = path.dirname(currentDir);
      continue;
    }
    if (answer.startsWith("plan:")) {
      return answer.slice("plan:".length);
    }
    if (answer.startsWith("file:")) {
      return answer.slice("file:".length);
    }
    if (answer.startsWith("dir:")) {
      currentDir = answer.slice("dir:".length);
      continue;
    }
  }
}
