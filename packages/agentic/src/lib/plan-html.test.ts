import { describe, test, expect } from "bun:test";
import { renderPlanPage } from "./plan-html.js";

describe("renderPlanPage", () => {
  test("returns valid HTML document", () => {
    const html = renderPlanPage("# Test", "e1", 3000);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  test("renders markdown headings to HTML", () => {
    const html = renderPlanPage("## Step 1.1 — Do thing", "e1", 3000);
    expect(html).toContain("<h2");
    expect(html).toContain("Step 1.1");
  });

  test("step headings render without feedback buttons", () => {
    const html = renderPlanPage("## 1.1 — Do thing", "e1", 3000);
    expect(html).toContain("<h2");
    expect(html).toContain("1.1");
    expect(html).not.toContain('data-step="1.1"');
    expect(html).not.toContain("feedback-btn");
  });

  test("no toggleForm function in output", () => {
    const html = renderPlanPage("### 1.1 — A", "e1", 3000);
    expect(html).not.toContain("toggleForm");
  });

  test("no submitFeedback function in output", () => {
    const html = renderPlanPage("### 1.1 — A", "e1", 3000);
    expect(html).not.toContain("submitFeedback");
  });

  test("no cancelFeedback function in output", () => {
    const html = renderPlanPage("### 1.1 — A", "e1", 3000);
    expect(html).not.toContain("cancelFeedback");
  });

  test("no feedback-form CSS class in output", () => {
    const html = renderPlanPage("### 1.1 — A", "e1", 3000);
    expect(html).not.toContain(".feedback-form");
  });

  test("renders fenced code blocks", () => {
    const html = renderPlanPage("```ts\nconst x = 1;\n```", "e1", 3000);
    expect(html).toContain("<code");
  });

  test("renders markdown tables", () => {
    const html = renderPlanPage("| A | B |\n|---|---|\n| 1 | 2 |", "e1", 3000);
    expect(html).toContain("<table>");
  });

  test("embeds CSS styles", () => {
    const html = renderPlanPage("# T", "e1", 3000);
    expect(html).toContain("<style>");
  });

  test("includes fetch-based feedback JS", () => {
    const html = renderPlanPage("# T", "e1", 3000);
    expect(html).toContain("fetch(");
    expect(html).toContain("/api/feedback");
  });

  test("handles empty markdown", () => {
    const html = renderPlanPage("", "e1", 3000);
    expect(html).toContain("<!DOCTYPE html>");
  });

  test("multiple step headings have no buttons", () => {
    const md = "### 1.1 — A\n\n### 1.2 — B\n\n### 2.1 — C";
    const html = renderPlanPage(md, "e1", 3000);
    expect(html).not.toContain("data-step");
    expect(html).not.toContain("feedback-btn");
  });

  test("general feedback section still present", () => {
    const html = renderPlanPage("# Test", "e1", 3000);
    expect(html).toContain("general-feedback");
    expect(html).toContain("General Feedback");
  });

  test("strips script tags from markdown", () => {
    const html = renderPlanPage("<script>alert(1)</script># Hello", "e1", 3000);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Hello");
  });

  test("strips onerror handlers from markdown", () => {
    const html = renderPlanPage('<img onerror="alert(1)" src=x>', "e1", 3000);
    expect(html).not.toContain("onerror");
  });

  test("preserves safe HTML from markdown", () => {
    const html = renderPlanPage("**bold** text", "e1", 3000);
    expect(html).toContain("<strong>bold</strong>");
  });
});
