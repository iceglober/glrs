import { describe, it, expect } from "bun:test";
import { createAgents } from "../src/agents/index.js";
import {
  AGENTS,
  AGENT_NAMES,
  AGENT_TIERS,
  AGENT_DOC_META,
  EXECUTOR_VARIANT_AGENT_NAMES,
  displayTier,
  type AgentName,
} from "@glrs-dev/agent-core";

describe("agent name constants (names.ts)", () => {
  it("AGENTS values are unique", () => {
    const values = Object.values(AGENTS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("AGENT_NAMES exactly matches the keys createAgents() registers", () => {
    const registered = new Set(Object.keys(createAgents()));
    const constants = new Set<string>(AGENT_NAMES);
    expect(constants).toEqual(registered);
  });

  it("AGENT_TIERS keys exactly match AGENT_NAMES", () => {
    expect(new Set(Object.keys(AGENT_TIERS))).toEqual(new Set<string>(AGENT_NAMES));
  });

  it("AGENT_DOC_META covers every agent", () => {
    for (const name of AGENT_NAMES) {
      expect(AGENT_DOC_META[name]).toBeDefined();
      expect(typeof AGENT_DOC_META[name].category).toBe("string");
    }
  });

  it("cost-variant agents declare a base that is itself a real agent", () => {
    const all = new Set<string>(AGENT_NAMES);
    for (const name of AGENT_NAMES) {
      const meta = AGENT_DOC_META[name];
      if (meta.category === "cost-variant") {
        expect(meta.base).toBeDefined();
        expect(all.has(meta.base as string)).toBe(true);
      }
    }
  });

  it("non-cost-variant agents have a non-empty doc role", () => {
    for (const name of AGENT_NAMES) {
      const meta = AGENT_DOC_META[name];
      if (meta.category !== "cost-variant") {
        expect(meta.role.length).toBeGreaterThan(0);
      }
    }
  });

  it("EXECUTOR_VARIANT_AGENT_NAMES are all registered agents", () => {
    const all = new Set<string>(AGENT_NAMES);
    for (const name of EXECUTOR_VARIANT_AGENT_NAMES) {
      expect(all.has(name)).toBe(true);
    }
  });

  it("displayTier collapses execution tiers to user-facing tiers", () => {
    expect(displayTier("mid-execute")).toBe("mid");
    expect(displayTier("autopilot-execute")).toBe("mid");
    expect(displayTier("deep")).toBe("deep");
    expect(displayTier("fast")).toBe("fast");
    expect(displayTier("cheap")).toBe("cheap");
  });

  it("AGENTS named constants resolve to live agent configs", () => {
    const agents = createAgents();
    const sample: AgentName[] = [AGENTS.PRIME, AGENTS.BUILD, AGENTS.CODE_REVIEWER];
    for (const name of sample) {
      expect(agents[name]).toBeDefined();
    }
  });
});
