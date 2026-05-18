/**
 * Conflict-graph builder for parallel phase scheduling.
 *
 * Two phases conflict if they share any file path in their `files:` lists
 * (parsed via `plan-parser`'s `parseItems` from each phase's plan-state
 * fence). Phases with no shared files are independent and can run in
 * parallel lanes.
 *
 * Conservative fallback: when a phase yields zero parsed items (e.g., no
 * fenced plan-state block, or the phase is written as plain markdown
 * checkboxes with `mirror:` / `files:` as prose) it is treated as
 * conflicting with EVERY other phase. The runtime then collapses to
 * sequential execution for that phase — which preserves correctness at
 * the cost of opportunistic parallelism. Explicit, machine-parseable
 * `files:` entries inside a plan-state fence are required to unlock
 * parallel scheduling.
 *
 * Pure module — no I/O, no logging. Inputs are already-parsed PlanItems.
 */

import type { PlanItem } from "./plan-parser.js";

export interface PhaseInput {
  /** Phase filename (e.g., "wave_1.md"). */
  file: string;
  /** Items parsed from this phase's plan-state fence. */
  items: PlanItem[];
}

export interface ConflictGraph {
  /** Phase filenames in input order. */
  phases: string[];
  /** Map: phase -> set of phases it conflicts with. */
  conflicts: Map<string, Set<string>>;
}

/**
 * Collect the unique set of file paths referenced by a phase's items.
 * Returns null when the phase has zero items (signalling "unknown footprint
 * — conservative conflict with everything").
 */
function collectPhaseFiles(items: PlanItem[]): Set<string> | null {
  if (items.length === 0) return null;
  const paths = new Set<string>();
  for (const item of items) {
    for (const file of item.files) {
      if (file.path) paths.add(file.path);
    }
  }
  // Items existed but none declared files — also conservative.
  if (paths.size === 0) return null;
  return paths;
}

/**
 * Build a conflict graph from a list of phases.
 *
 * Two phases A and B conflict iff:
 *   - either phase has unknown file footprint (null from collectPhaseFiles), OR
 *   - their file sets share at least one path.
 *
 * Self-conflicts are not recorded (a phase doesn't conflict with itself).
 */
export function buildConflictGraph(phases: PhaseInput[]): ConflictGraph {
  const phaseNames: string[] = phases.map((p) => p.file);
  const fileSets = new Map<string, Set<string> | null>();
  for (const p of phases) {
    fileSets.set(p.file, collectPhaseFiles(p.items));
  }

  const conflicts = new Map<string, Set<string>>();
  for (const name of phaseNames) {
    conflicts.set(name, new Set());
  }

  for (let i = 0; i < phaseNames.length; i++) {
    for (let j = i + 1; j < phaseNames.length; j++) {
      const a = phaseNames[i];
      const b = phaseNames[j];
      const setA = fileSets.get(a) ?? null;
      const setB = fileSets.get(b) ?? null;
      let conflict = false;
      if (setA === null || setB === null) {
        conflict = true;
      } else {
        for (const p of setA) {
          if (setB.has(p)) {
            conflict = true;
            break;
          }
        }
      }
      if (conflict) {
        conflicts.get(a)!.add(b);
        conflicts.get(b)!.add(a);
      }
    }
  }

  return { phases: phaseNames, conflicts };
}

/**
 * Compute groups of phases that can run together (no pairwise conflicts
 * within a group). Greedy graph coloring: visit phases in order, place
 * each into the first existing group that contains no conflict, otherwise
 * start a new group.
 *
 * Result: array of arrays of phase filenames. Each inner array is a
 * cohort that can run in parallel. The number of arrays is the chromatic
 * number under this greedy ordering — not necessarily optimal, but
 * deterministic and good enough for the common case.
 */
export function findIndependentPhases(graph: ConflictGraph): string[][] {
  const groups: string[][] = [];
  for (const phase of graph.phases) {
    const conflictsWith = graph.conflicts.get(phase) ?? new Set<string>();
    let placed = false;
    for (const group of groups) {
      let ok = true;
      for (const member of group) {
        if (conflictsWith.has(member)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        group.push(phase);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push([phase]);
    }
  }
  return groups;
}

/**
 * Convenience: returns true if the graph has any independent pair —
 * i.e., at least one group from `findIndependentPhases` has size > 1.
 * Used by the orchestrator to decide whether parallel scheduling can
 * yield any speedup, vs. falling back to sequential to skip overhead.
 */
export function hasParallelism(graph: ConflictGraph): boolean {
  return findIndependentPhases(graph).some((g) => g.length > 1);
}
