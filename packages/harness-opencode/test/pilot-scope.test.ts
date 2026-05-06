/**
 * Tests for pilot v2 scope phase.
 * Tests the artifact schema validation and the scope.json parsing.
 * The full runScopePhase() requires a live OpenCode server — not tested here.
 */

import { describe, test, expect } from "bun:test";
import { parseScopeArtifact, type ScopeArtifact } from "../src/pilot/scope.js";

const VALID_SCOPE: ScopeArtifact = {
  workflow_id: "01JTEST123456789ABCDEFGHIJ",
  goal: "Add dark mode toggle to settings page",
  framing: "Users want to reduce eye strain. The settings page is the right place for this toggle.",
  acceptance_criteria: [
    {
      id: "AC-001",
      description: "A dark mode toggle appears in the settings page",
      verifiable: "shell",
    },
    {
      id: "AC-002",
      description: "The toggle persists across page reloads",
      verifiable: "llm",
    },
    {
      id: "AC-003",
      description: "Dark mode applies to all pages, not just settings",
      verifiable: "manual",
    },
  ],
  non_goals: ["Mobile-specific dark mode", "System preference detection"],
  context: "The app uses CSS variables for theming. See src/styles/theme.css.",
};

describe("pilot scope — schema validation", () => {
  test("scope.json schema validates a valid artifact", () => {
    const result = parseScopeArtifact(VALID_SCOPE);
    expect(result).not.toBeNull();
    expect(result!.workflow_id).toBe(VALID_SCOPE.workflow_id);
    expect(result!.goal).toBe(VALID_SCOPE.goal);
    expect(result!.acceptance_criteria.length).toBe(3);
  });

  test("scope.json contains framing and acceptance criteria", () => {
    const result = parseScopeArtifact(VALID_SCOPE);
    expect(result!.framing).toBeTruthy();
    expect(result!.acceptance_criteria.length).toBeGreaterThan(0);
    for (const ac of result!.acceptance_criteria) {
      expect(ac.id).toMatch(/^AC-\d+$/);
      expect(ac.description).toBeTruthy();
      expect(["shell", "llm", "manual"]).toContain(ac.verifiable);
    }
  });

  test("rejects null", () => {
    expect(parseScopeArtifact(null)).toBeNull();
  });

  test("rejects missing workflow_id", () => {
    const { workflow_id: _, ...rest } = VALID_SCOPE;
    expect(parseScopeArtifact(rest)).toBeNull();
  });

  test("rejects missing goal", () => {
    const { goal: _, ...rest } = VALID_SCOPE;
    expect(parseScopeArtifact(rest)).toBeNull();
  });

  test("rejects missing framing", () => {
    const { framing: _, ...rest } = VALID_SCOPE;
    expect(parseScopeArtifact(rest)).toBeNull();
  });

  test("rejects missing acceptance_criteria", () => {
    const { acceptance_criteria: _, ...rest } = VALID_SCOPE;
    expect(parseScopeArtifact(rest)).toBeNull();
  });

  test("rejects invalid verifiable value", () => {
    const invalid = {
      ...VALID_SCOPE,
      acceptance_criteria: [
        { id: "AC-001", description: "test", verifiable: "invalid" },
      ],
    };
    expect(parseScopeArtifact(invalid)).toBeNull();
  });

  test("accepts scope without context (optional field)", () => {
    const { context: _, ...rest } = VALID_SCOPE;
    const result = parseScopeArtifact(rest);
    expect(result).not.toBeNull();
    expect(result!.context).toBeUndefined();
  });

  test("accepts empty non_goals array", () => {
    const result = parseScopeArtifact({ ...VALID_SCOPE, non_goals: [] });
    expect(result).not.toBeNull();
    expect(result!.non_goals).toEqual([]);
  });

  test("accepts missing non_goals (defaults to empty)", () => {
    const { non_goals: _, ...rest } = VALID_SCOPE;
    const result = parseScopeArtifact(rest);
    expect(result).not.toBeNull();
    expect(result!.non_goals).toEqual([]);
  });
});
