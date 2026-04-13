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

  test("injects feedback button for h3 step heading", () => {
    const html = renderPlanPage("### Step 1.1 — Create module\n\nText", "e1", 3000);
    expect(html).toContain('data-step="1.1"');
  });

  test("injects feedback button for h2 step heading", () => {
    const html = renderPlanPage("## 1.1 — Create module", "e1", 3000);
    expect(html).toContain('data-step="1.1"');
  });

  test("no button for non-step headings", () => {
    const html = renderPlanPage("## Overview\n\nSome text", "e1", 3000);
    expect(html).not.toContain("data-step");
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

  test("multiple steps get separate buttons", () => {
    const md = "### 1.1 — A\n\n### 1.2 — B\n\n### 2.1 — C";
    const html = renderPlanPage(md, "e1", 3000);
    expect(html).toContain('data-step="1.1"');
    expect(html).toContain('data-step="1.2"');
    expect(html).toContain('data-step="2.1"');
  });

  test("general feedback section exists", () => {
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
