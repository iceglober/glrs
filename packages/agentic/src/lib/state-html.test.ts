import { describe, test, expect } from "bun:test";
import { renderStatePage } from "./state-html.js";

describe("renderStatePage", () => {
  test("returns valid HTML document", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  test("loads React from CDN", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("esm.sh/react@");
  });

  test("loads htm from CDN", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("esm.sh/htm");
  });

  test("loads marked from CDN for markdown rendering", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("esm.sh/marked");
  });

  test("uses correct API port", () => {
    const html = renderStatePage(4567);
    expect(html).toContain("127.0.0.1:4567");
  });

  test("all mode embeds all flag in fetch URL", () => {
    const html = renderStatePage(3000, { all: true });
    expect(html).toContain("all=true");
  });

  test("default mode does not include all param", () => {
    const html = renderStatePage(3000);
    expect(html).not.toContain("all=true");
  });

  test("no innerHTML usage except dangerouslySetInnerHTML for markdown", () => {
    const html = renderStatePage(3000);
    // Only allowed instance is React's dangerouslySetInnerHTML for rendered markdown
    const lines = html.split("\n");
    const innerHtmlLines = lines.filter(l => l.includes(".innerHTML"));
    expect(innerHtmlLines.length).toBe(0);
  });

  test("embeds CSS styles", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("<style>");
  });

  test("contains root mount point", () => {
    const html = renderStatePage(3000);
    expect(html).toContain('id="root"');
  });

  // Dark mode design system
  test("dark mode background colors", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("#0a0a0a");
    expect(html).toContain("#141414");
  });

  test("phase HSL colors defined", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("--phase-understand");
    expect(html).toContain("--phase-design");
    expect(html).toContain("--phase-implement");
    expect(html).toContain("--phase-verify");
    expect(html).toContain("--phase-ship");
    expect(html).toContain("--phase-done");
    expect(html).toContain("--phase-cancelled");
  });

  test("progress bar classes present", () => {
    const html = renderStatePage(3000);
    expect(html).toContain(".progress-bar");
    expect(html).toContain(".progress-segment");
  });

  test("detail panel classes present", () => {
    const html = renderStatePage(3000);
    expect(html).toContain(".detail-panel");
  });

  test("repo pill classes present", () => {
    const html = renderStatePage(3000);
    expect(html).toContain(".repo-pill");
  });

  test("phase pill classes for all phases", () => {
    const html = renderStatePage(3000);
    expect(html).toContain(".pill-understand");
    expect(html).toContain(".pill-design");
    expect(html).toContain(".pill-implement");
    expect(html).toContain(".pill-verify");
    expect(html).toContain(".pill-ship");
    expect(html).toContain(".pill-done");
    expect(html).toContain(".pill-cancelled");
  });

  // Component presence
  test("contains SummaryBar component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("SummaryBar");
  });

  test("contains DashboardView component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("DashboardView");
  });

  test("contains EpicDetail component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("EpicDetail");
  });

  test("contains TaskDetailPanel component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("TaskDetailPanel");
  });

  test("contains RepoPills component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("RepoPills");
  });

  test("contains SegmentedProgress component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("SegmentedProgress");
  });

  test("contains PhaseStepper component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("PhaseStepper");
  });

  test("contains SidebarSearch component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("SidebarSearch");
  });

  test("contains Timeline component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("Timeline");
  });

  test("contains ReadySection component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("ReadySection");
  });

  test("contains ReviewItemList component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("ReviewItemList");
  });

  test("contains DependencyPills component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("DependencyPills");
  });

  // Keyboard navigation
  test("keyboard handler registered", () => {
    const html = renderStatePage(3000);
    expect(html).toContain('addEventListener("keydown"');
  });

  test("contains ShortcutOverlay component", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("ShortcutOverlay");
  });

  test("escape key handling", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("Escape");
  });

  test("search focus on slash key", () => {
    const html = renderStatePage(3000);
    expect(html).toContain('.sidebar-search"');
  });

  // API endpoints
  test("fetches summary endpoint", () => {
    const html = renderStatePage(3000);
    expect(html).toContain("/api/state/summary");
  });

  test("summary URL includes all flag when all mode", () => {
    const html = renderStatePage(3000, { all: true });
    // Should have both state and summary URLs with all=true
    expect(html).toContain("/api/state?all=true");
    expect(html).toContain("/api/state/summary?all=true");
  });

  test("severity classes for review items", () => {
    const html = renderStatePage(3000);
    expect(html).toContain(".severity-CRITICAL");
    expect(html).toContain(".severity-HIGH");
    expect(html).toContain(".severity-MEDIUM");
    expect(html).toContain(".severity-LOW");
  });

  test("repoLabel splits on / not -", () => {
    const html = renderStatePage(3000, { all: true });
    expect(html).toContain('r.split("/")');
    expect(html).not.toContain('r.split("-")');
  });

  test("seeds selectedRepo from first fetch", () => {
    const html = renderStatePage(3000, { all: true });
    expect(html).toContain("prev => prev || data.repos[0].repo");
  });

  test("repo tabs require more than 1 repo", () => {
    const html = renderStatePage(3000, { all: true });
    // Tab rendering guard uses > 1, not > 0
    expect(html).toContain("isMultiRepo && state.repos.length > 1");
  });
});
