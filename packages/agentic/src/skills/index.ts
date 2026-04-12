/**
 * Embedded skill files for the glorious workflow.
 * These get written to .claude/commands/ (commands) and .claude/skills/ (skills)
 * by `gs-agentic skills`.
 *
 * Commands are slash-invokable workflows (/work, /ship, /spec-make, etc.)
 * Skills are capabilities that activate automatically when relevant (/browser, etc.)
 */

import { research } from "./research.js";
import { researchLocal } from "./research-local.js";
import { researchWeb } from "./research-web.js";
import { specMake } from "./spec-make.js";
import { specRefine } from "./spec-refine.js";
import { specEnrich } from "./spec-enrich.js";
import { specReview } from "./spec-review.js";
import { specLab } from "./spec-lab.js";
import { researchAuto } from "./research-auto.js";
import { browser } from "./browser.js";
import { productManager } from "./product-manager.js";
import { productBuild } from "./product-build.js";
import { productAcceptance } from "./product-acceptance.js";
import { productEvaluate } from "./product-evaluate.js";
import { productEngineeringHandoff } from "./product-engineering-handoff.js";
import { productInterview } from "./product-interview.js";
import { productProblem } from "./product-problem.js";
import { productRequirements } from "./product-requirements.js";
import { productResearchBenchmarks } from "./product-research-benchmarks.js";
import { productResearchCompetitive } from "./product-research-competitive.js";
import { productResearchDomain } from "./product-research-domain.js";
import { productResearchMarket } from "./product-research-market.js";
import { productResearchTechnical } from "./product-research-technical.js";
import { writingSkills } from "./writing-skills.js";
import { gsThink } from "./gs-think.js";
import { gsFix } from "./gs-fix.js";
import { gsQa } from "./gs-qa.js";
import { gsWork } from "./gs-work.js";
import { gsShip } from "./gs-ship.js";
import { gsDeepPlan } from "./gs-deep-plan.js";
import { gsBuild } from "./gs-build.js";
import { gsBuildLoop } from "./gs-build-loop.js";
import { gsDeepReview } from "./gs-deep-review.js";
import { gsQuickReview } from "./gs-quick-review.js";
import { gsAddressFeedback } from "./gs-address-feedback.js";
import { gs } from "./gs.js";

/**
 * Mapping of gs-* skill internal keys to their canonical short filenames
 * and generator functions. The canonical name is what gets installed by default
 * (no prefix). With a prefix like "gs-", the installed name becomes "gs-think.md" etc.
 */
export const GS_SKILL_NAMES: Record<
  string,
  { canonical: string; generator: () => string }
> = {
  gs: { canonical: "gs.md", generator: gs },
  "gs-think": { canonical: "think.md", generator: gsThink },
  "gs-work": { canonical: "work.md", generator: gsWork },
  "gs-fix": { canonical: "fix.md", generator: gsFix },
  "gs-qa": { canonical: "qa.md", generator: gsQa },
  "gs-ship": { canonical: "ship.md", generator: gsShip },
  "gs-build": { canonical: "build.md", generator: gsBuild },
  "gs-build-loop": { canonical: "build-loop.md", generator: gsBuildLoop },
  "gs-deep-plan": { canonical: "deep-plan.md", generator: gsDeepPlan },
  "gs-deep-review": { canonical: "deep-review.md", generator: gsDeepReview },
  "gs-quick-review": {
    canonical: "quick-review.md",
    generator: gsQuickReview,
  },
  "gs-address-feedback": {
    canonical: "address-feedback.md",
    generator: gsAddressFeedback,
  },
};

/**
 * Claude Code built-in command names that must NOT be used as skill filenames.
 * Source: https://code.claude.com/docs/en/commands
 */
export const BUILTIN_COLLISIONS = new Set([
  "add-dir.md",
  "agents.md",
  "autofix-pr.md",
  "btw.md",
  "branch.md",
  "chrome.md",
  "clear.md",
  "color.md",
  "compact.md",
  "config.md",
  "context.md",
  "copy.md",
  "cost.md",
  "desktop.md",
  "diff.md",
  "doctor.md",
  "effort.md",
  "exit.md",
  "export.md",
  "extra-usage.md",
  "fast.md",
  "feedback.md",
  "help.md",
  "hooks.md",
  "ide.md",
  "init.md",
  "insights.md",
  "install-github-app.md",
  "install-slack-app.md",
  "keybindings.md",
  "login.md",
  "logout.md",
  "mcp.md",
  "memory.md",
  "mobile.md",
  "model.md",
  "passes.md",
  "permissions.md",
  "plan.md",
  "plugin.md",
  "powerup.md",
  "privacy-settings.md",
  "release-notes.md",
  "reload-plugins.md",
  "remote-control.md",
  "remote-env.md",
  "rename.md",
  "resume.md",
  "review.md",
  "rewind.md",
  "sandbox.md",
  "schedule.md",
  "security-review.md",
  "setup-bedrock.md",
  "setup-vertex.md",
  "skills.md",
  "stats.md",
  "status.md",
  "statusline.md",
  "stickers.md",
  "tasks.md",
  "teleport.md",
  "terminal-setup.md",
  "theme.md",
  "ultraplan.md",
  "upgrade.md",
  "usage.md",
  "voice.md",
  "web-setup.md",
  // Aliases
  "settings.md",
  "reset.md",
  "new.md",
  "fork.md",
  "quit.md",
  "bug.md",
  "app.md",
  "checkpoint.md",
  "rc.md",
  "tp.md",
  "continue.md",
  "allowed-tools.md",
  "bashes.md",
  "ios.md",
  "android.md",
  // Bundled skills
  "batch.md",
  "claude-api.md",
  "debug.md",
  "loop.md",
  "simplify.md",
]);

/** Non-gs commands that are always installed with their original names. */
const STATIC_COMMANDS: Record<string, string> = {
  // Research
  "research.md": research(),
  "research-local.md": researchLocal(),
  "research-auto.md": researchAuto(),

  // Design pipeline
  "research-web.md": researchWeb(),
  "spec-make.md": specMake(),
  "spec-refine.md": specRefine(),
  "spec-enrich.md": specEnrich(),
  "spec-review.md": specReview(),
  "spec-lab.md": specLab(),

  // Product management suite
  "product-manager.md": productManager(),
  "product-build.md": productBuild(),
  "product-acceptance.md": productAcceptance(),
  "product-evaluate.md": productEvaluate(),
  "product-engineering-handoff.md": productEngineeringHandoff(),
  "product-interview.md": productInterview(),
  "product-problem.md": productProblem(),
  "product-requirements.md": productRequirements(),
  "product-research-benchmarks.md": productResearchBenchmarks(),
  "product-research-competitive.md": productResearchCompetitive(),
  "product-research-domain.md": productResearchDomain(),
  "product-research-market.md": productResearchMarket(),
  "product-research-technical.md": productResearchTechnical(),
};

/**
 * Build the COMMANDS map with an optional prefix for gs-* skill names.
 *
 * - No prefix (default): canonical short names (think.md, work.md, deep-plan.md)
 * - With prefix "gs-": legacy names (gs-think.md, gs-work.md, gs-deep-plan.md)
 * - With custom prefix: custom names (my-think.md, my-work.md, my-deep-plan.md)
 *
 * Non-gs skills (research-*, spec-*, product-*) are always installed unchanged.
 */
export function buildCommands(prefix?: string): Record<string, string> {
  const p = prefix || "";
  const gsCommands: Record<string, string> = {};

  for (const entry of Object.values(GS_SKILL_NAMES)) {
    const filename = p + entry.canonical;
    gsCommands[filename] = entry.generator();
  }

  return { ...STATIC_COMMANDS, ...gsCommands };
}

/**
 * Default COMMANDS export for backward compatibility.
 * Uses canonical short names (no prefix).
 */
export const COMMANDS: Record<string, string> = buildCommands();

/** Skills — activate automatically when relevant */
export const SKILLS: Record<string, string> = {
  "browser.md": browser(),
  ...Object.fromEntries(
    Object.entries(writingSkills()).map(([f, c]) => [`writing-skills/${f}`, c]),
  ),
};
