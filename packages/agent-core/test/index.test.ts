import { describe, it, expect } from "bun:test";
import {
  AGENTS,
  AGENT_NAMES,
  AGENT_TIERS,
  AGENT_DOC_META,
  EXECUTOR_VARIANT_AGENT_NAMES,
  displayTier,
  type ModelTier,
} from "../src/index.js";

describe("@glrs-dev/agent-core", () => {
  it("AGENTS values are unique", () => {
    const values = Object.values(AGENTS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("AGENT_NAMES is exactly the AGENTS values", () => {
    expect(new Set<string>(AGENT_NAMES)).toEqual(new Set(Object.values(AGENTS)));
  });

  it("AGENT_TIERS keys exactly match AGENT_NAMES", () => {
    expect(new Set(Object.keys(AGENT_TIERS))).toEqual(new Set<string>(AGENT_NAMES));
  });

  it("every tier value is a valid ModelTier", () => {
    const valid = new Set<ModelTier>([
      "deep",
      "mid",
      "mid-execute",
      "autopilot-execute",
      "fast",
      "cheap",
    ]);
    for (const tier of Object.values(AGENT_TIERS)) {
      expect(valid.has(tier)).toBe(true);
    }
  });

  it("AGENT_DOC_META covers every agent with a valid category", () => {
    const categories = new Set([
      "user-selectable",
      "subagent",
      "autopilot",
      "cost-variant",
    ]);
    for (const name of AGENT_NAMES) {
      const meta = AGENT_DOC_META[name];
      expect(meta).toBeDefined();
      expect(categories.has(meta.category)).toBe(true);
    }
  });

  it("cost-variant agents reference a real base agent; others have a non-empty role", () => {
    const all = new Set<string>(AGENT_NAMES);
    for (const name of AGENT_NAMES) {
      const meta = AGENT_DOC_META[name];
      if (meta.category === "cost-variant") {
        expect(meta.base).toBeDefined();
        expect(all.has(meta.base as string)).toBe(true);
      } else {
        expect(meta.role.length).toBeGreaterThan(0);
      }
    }
  });

  it("EXECUTOR_VARIANT_AGENT_NAMES are all registered, mid-execute agents", () => {
    const all = new Set<string>(AGENT_NAMES);
    for (const name of EXECUTOR_VARIANT_AGENT_NAMES) {
      expect(all.has(name)).toBe(true);
      expect(AGENT_TIERS[name]).toBe("mid-execute");
    }
  });

  it("displayTier collapses execution tiers to user-facing tiers", () => {
    expect(displayTier("mid-execute")).toBe("mid");
    expect(displayTier("autopilot-execute")).toBe("mid");
    expect(displayTier("deep")).toBe("deep");
    expect(displayTier("mid")).toBe("mid");
    expect(displayTier("fast")).toBe("fast");
    expect(displayTier("cheap")).toBe("cheap");
  });
});
