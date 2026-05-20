/**
 * Eval scorer — reads enriched spec YAML from a plan directory and computes
 * a composite quality score (0–1, higher is better).
 *
 * Usage: bun run packages/autopilot/eval/score.ts <plan-dir> [--cost <usd>] [--duration <seconds>]
 *
 * Outputs JSON to stdout:
 *   { score, accuracy, cost_score, speed_score, details }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";

const ENRICHMENT_FIELDS = ["mirror", "context", "conventions", "proof", "proof_type"] as const;
const COST_BUDGET_USD = 5.0;
const DURATION_BUDGET_S = 600;

interface SpecItem {
  id: string;
  intent?: string;
  checked?: boolean;
  files?: Array<{ path: string; isNew?: boolean; change?: string }>;
  tests?: string[];
  verify?: string;
  mirror?: string;
  context?: string;
  conventions?: string;
  proof?: string;
  proof_type?: string;
}

interface ScoreResult {
  score: number;
  accuracy: number;
  field_completeness: number;
  mirror_validity: number;
  context_depth: number;
  proof_quality: number;
  file_ref_validity: number;
  cost_score: number;
  speed_score: number;
  cost_usd: number;
  duration_s: number;
  items_total: number;
  items_with_all_fields: number;
  yaml_valid: boolean;
}

function readSpecItems(planDir: string): { items: SpecItem[]; yamlValid: boolean } {
  const specDir = path.join(planDir, "spec");
  if (!fs.existsSync(specDir)) return { items: [], yamlValid: false };

  const mainPath = path.join(specDir, "main.yaml");
  if (!fs.existsSync(mainPath)) return { items: [], yamlValid: false };

  let mainSpec: { phases?: Array<{ file: string }> };
  try {
    mainSpec = yamlParse(fs.readFileSync(mainPath, "utf-8"));
  } catch {
    return { items: [], yamlValid: false };
  }

  const phases = mainSpec.phases ?? [];
  const allItems: SpecItem[] = [];
  let yamlValid = true;

  for (const phase of phases) {
    const phasePath = path.join(specDir, phase.file);
    if (!fs.existsSync(phasePath)) {
      yamlValid = false;
      continue;
    }
    try {
      const parsed = yamlParse(fs.readFileSync(phasePath, "utf-8"));
      const items: SpecItem[] = Array.isArray(parsed?.items) ? parsed.items : [];
      allItems.push(...items);
    } catch {
      yamlValid = false;
    }
  }

  return { items: allItems, yamlValid };
}

export function scoreEnrichment(
  planDir: string,
  repoRoot: string,
  costUsd: number,
  durationS: number,
): ScoreResult {
  const { items, yamlValid } = readSpecItems(planDir);
  const total = items.length;

  if (total === 0) {
    return {
      score: 0, accuracy: 0, field_completeness: 0, mirror_validity: 0,
      context_depth: 0, proof_quality: 0, file_ref_validity: 0,
      cost_score: 0, speed_score: 0,
      cost_usd: costUsd, duration_s: durationS,
      items_total: 0, items_with_all_fields: 0, yaml_valid: yamlValid,
    };
  }

  let withAllFields = 0;
  let validMirrors = 0;
  let deepContexts = 0;
  let specificProofs = 0;
  let validFileRefs = 0;

  for (const item of items) {
    const hasAll = ENRICHMENT_FIELDS.every((f) => {
      const val = item[f];
      return typeof val === "string" && val.trim().length > 0;
    });
    if (hasAll) withAllFields++;

    if (typeof item.mirror === "string" && item.mirror.trim().length > 0) {
      const mirrorPath = path.join(repoRoot, item.mirror.trim());
      if (fs.existsSync(mirrorPath)) validMirrors++;
    }

    if (typeof item.context === "string" && item.context.trim().length > 100) {
      deepContexts++;
    }

    if (typeof item.proof === "string") {
      const p = item.proof.toLowerCase();
      const hasSpecifics = /\b(assert|expect|verify|should|must|test|check|confirm)\b/.test(p)
        && item.proof.trim().length > 50;
      if (hasSpecifics) specificProofs++;
    }

    if (Array.isArray(item.files) && item.files.length > 0) {
      const anyValid = item.files.some((f) => {
        const filePath = path.join(repoRoot, f.path);
        return fs.existsSync(filePath);
      });
      if (anyValid) validFileRefs++;
    }
  }

  const fieldCompleteness = withAllFields / total;
  const mirrorValidity = validMirrors / total;
  const contextDepth = deepContexts / total;
  const proofQuality = specificProofs / total;
  const fileRefValidity = validFileRefs / total;

  const accuracy = fieldCompleteness * 0.25 + mirrorValidity * 0.25 + contextDepth * 0.2 + proofQuality * 0.15 + fileRefValidity * 0.15;
  const costScore = 1 - Math.min(costUsd / COST_BUDGET_USD, 1.0);
  const speedScore = 1 - Math.min(durationS / DURATION_BUDGET_S, 1.0);

  const score = accuracy * 0.6 + costScore * 0.2 + speedScore * 0.2;

  return {
    score, accuracy, field_completeness: fieldCompleteness,
    mirror_validity: mirrorValidity, context_depth: contextDepth,
    proof_quality: proofQuality, file_ref_validity: fileRefValidity,
    cost_score: costScore, speed_score: speedScore,
    cost_usd: costUsd, duration_s: durationS,
    items_total: total, items_with_all_fields: withAllFields,
    yaml_valid: yamlValid,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const planDir = args[0];
  if (!planDir) {
    console.error("Usage: bun run score.ts <plan-dir> [--cost <usd>] [--duration <seconds>] [--repo <root>]");
    process.exit(1);
  }

  const costIdx = args.indexOf("--cost");
  const costUsd = costIdx >= 0 ? parseFloat(args[costIdx + 1]) : 0;
  const durIdx = args.indexOf("--duration");
  const durationS = durIdx >= 0 ? parseFloat(args[durIdx + 1]) : 0;
  const repoIdx = args.indexOf("--repo");
  const repoRoot = repoIdx >= 0 ? args[repoIdx + 1] : process.cwd();

  const result = scoreEnrichment(path.resolve(planDir), repoRoot, costUsd, durationS);
  console.log(JSON.stringify(result, null, 2));
}
