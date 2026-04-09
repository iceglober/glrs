/**
 * Embedded skill files for the glorious workflow.
 * These get written to .claude/commands/ (commands) and .claude/skills/ (skills)
 * by `gs-agentic skills`.
 *
 * Commands are slash-invokable workflows (/work, /ship, /spec-make, etc.)
 * Skills are capabilities that activate automatically when relevant (/browser, etc.)
 */

import { think } from "./think.js";
import { work } from "./work.js";
import { fix } from "./fix.js";
import { qa } from "./qa.js";
import { ship } from "./ship.js";
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

/** Slash commands — invoked explicitly via /name */
export const COMMANDS: Record<string, string> = {
  // Engineering
  "think.md": think(),
  "work.md": work(),
  "fix.md": fix(),
  "qa.md": qa(),
  "ship.md": ship(),
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

/** Skills — activate automatically when relevant */
export const SKILLS: Record<string, string> = {
  "browser.md": browser(),
  ...Object.fromEntries(
    Object.entries(writingSkills()).map(([f, c]) => [`writing-skills/${f}`, c]),
  ),
};
