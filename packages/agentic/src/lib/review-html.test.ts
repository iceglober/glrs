import { describe, test, expect } from "bun:test";
import { renderReviewPage } from "./review-html.js";

describe("renderReviewPage", () => {
  test("returns valid HTML document", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "<h1>Plan</h1>" }], 3000);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  test("renders tab bar with plan IDs", () => {
    const html = renderReviewPage([
      { planId: "e1", htmlContent: "<h2>Plan 1</h2>" },
      { planId: "e2", htmlContent: "<h2>Plan 2</h2>" },
    ], 3000);
    expect(html).toContain("e1");
    expect(html).toContain("e2");
    // Both should have tab elements
    expect(html).toContain('data-plan="e1"');
    expect(html).toContain('data-plan="e2"');
  });

  test("first tab is active by default", () => {
    const html = renderReviewPage([
      { planId: "e1", htmlContent: "<h2>Plan 1</h2>" },
      { planId: "e2", htmlContent: "<h2>Plan 2</h2>" },
    ], 3000);
    // First tab should be active
    const firstTabMatch = html.match(/class="tab active"[^>]*data-plan="e1"/);
    expect(firstTabMatch).not.toBeNull();
  });

  test("plan content rendered inside tab panel", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "<h2>Step 1</h2>" }], 3000);
    expect(html).toContain("<h2>Step 1</h2>");
  });

  test("Finish Review button present per tab", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "<p>content</p>" }], 3000);
    expect(html).toContain("Finish Review");
    expect(html).toContain('data-plan="e1"');
  });

  test("first-time dialog markup present", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("plan.auto-open");
    expect(html).toContain("first-run-modal");
  });

  test("first-time dialog has dismiss button", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("Got it");
  });

  test("SSE EventSource connection code present", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("EventSource");
  });

  test("close-tab event handler calls window.close", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("window.close()");
  });

  test("server port embedded in API URLs", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 5555);
    expect(html).toContain("http://localhost:5555");
  });

  test("strips script tags from plan content (XSS)", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "<script>alert(1)</script><p>safe</p>" }], 3000);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("<p>safe</p>");
  });

  test("empty plans array renders empty state", () => {
    const html = renderReviewPage([], 3000);
    expect(html).toContain("No plans");
  });

  test("sidebar feedback textarea present", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("sidebar-text");
  });

  test("finish button posts to /api/finish", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("/api/finish");
  });

  test("SSE handler fetches individual plan endpoint", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain('/api/plans/" + encodeURIComponent(data.planId)');
  });

  test("SSE handler uses htmlContent not planContent", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    // Extract the new-plan handler section
    const sseSection = html.slice(html.indexOf("new-plan"), html.indexOf("close-tab"));
    expect(sseSection).toContain("htmlContent");
    expect(sseSection).not.toContain("planContent");
  });

  test("dynamic finish button uses addEventListener not inline onclick", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    const sseSection = html.slice(html.indexOf("new-plan"), html.indexOf("close-tab"));
    expect(sseSection).toContain("addEventListener");
    expect(sseSection).not.toContain('onclick="finishReview');
  });

  test("finishReview has .catch handler", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    const finishSection = html.slice(html.indexOf("function finishReview"), html.indexOf("// Section tracking"));
    expect(finishSection).toContain(".catch(");
  });

  test("catch handler creates error element in panel", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    const finishSection = html.slice(html.indexOf("function finishReview"), html.indexOf("// Section tracking"));
    expect(finishSection).toContain("Failed to finish review");
  });

  test("escapeHtml escapes single quotes in planId", () => {
    const html = renderReviewPage([{ planId: "e1'test", htmlContent: "" }], 3000);
    expect(html).toContain("e1&#39;test");
    expect(html).not.toContain("e1'test");
  });

  test("tab-bar has role=tablist", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain('role="tablist"');
  });

  test("tabs have role=tab and aria-selected", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }, { planId: "e2", htmlContent: "" }], 3000);
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
  });

  test("panels have role=tabpanel", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain('role="tabpanel"');
  });

  test("modal has role=dialog and aria-modal", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  test("JS contains arrow key handler", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("ArrowLeft");
    expect(html).toContain("ArrowRight");
  });

  test("JS contains Escape key handler for modal", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("Escape");
  });

  test("switchTab updates aria-selected", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain('setAttribute("aria-selected"');
  });
});
