import path from "node:path";
import fs from "node:fs";
import { plansDir } from "./state.js";

/** Path to the feedback file for an entity (epic or task). */
export function feedbackPath(id: string): string {
  return path.join(plansDir(), id, "feedback.md");
}

/** Load feedback content for an entity, or null if none exists. */
export function loadFeedback(id: string): string | null {
  const p = feedbackPath(id);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf-8");
}

/** Append a feedback entry anchored to a plan step. Creates file if needed. */
export function appendFeedback(id: string, step: string, text: string): void {
  const p = feedbackPath(id);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, "# Plan Feedback\n\n");
  }

  fs.appendFileSync(p, `## Step ${step}\n${text}\n\n`);
}

/** Remove the feedback file for an entity. No-op if it doesn't exist. */
export function clearFeedback(id: string): void {
  const p = feedbackPath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
