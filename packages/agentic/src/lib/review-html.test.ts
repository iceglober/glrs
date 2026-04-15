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

  test("Approve and Request Changes buttons present per tab", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "<p>content</p>" }], 3000);
    expect(html).toContain("Approve");
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

  test("escapeHtml escapes single quotes in planId in HTML context", () => {
    const html = renderReviewPage([{ planId: "e1'test", htmlContent: "" }], 3000);
    // HTML attributes should have escaped quotes
    expect(html).toContain('data-plan="e1&#39;test"');
    // Tab button onclick should have escaped quotes
    expect(html).toContain("switchTab('e1&#39;test')");
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

describe("renderReviewPage — review outcome", () => {
  test("HTML contains Approve button", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("Approve");
  });

  test("HTML contains Request Changes button", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("Request Changes");
  });

  test("Approve calls finishReview with approved", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("'approved'");
  });

  test("Request Changes calls finishReview with changes-requested", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("'changes-requested'");
  });
});

describe("renderReviewPage — dark mode", () => {
  test("CSS contains :root with custom properties", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain(":root");
    expect(html).toContain("--bg");
  });

  test("CSS contains prefers-color-scheme dark media query", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("prefers-color-scheme: dark");
  });

  test("body uses CSS variable for background", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("background: var(--bg)");
  });

  test("body uses CSS variable for color", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("color: var(--text)");
  });

  test("dark mode defines distinct background", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    const darkSection = html.slice(html.indexOf("prefers-color-scheme: dark"));
    expect(darkSection).toContain("--bg:");
  });

  test("pre blocks use surface variable", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("var(--surface)");
  });
});

describe("renderReviewPage — progress bar", () => {
  test("progress bar div exists", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain('id="progress-bar"');
  });

  test("progress bar is fixed positioned at top", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    const css = html.slice(html.indexOf("#progress-bar"), html.indexOf("#progress-bar") + 200);
    expect(css).toContain("position: fixed");
    expect(css).toContain("top: 0");
  });

  test("scroll listener updates progress bar", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("progress-bar");
    expect(html).toContain("scrollY");
    expect(html).toContain("scrollHeight");
  });
});

describe("renderReviewPage — TOC", () => {
  test("sidebar contains toc section element", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "<h2>Heading</h2>" }], 3000);
    expect(html).toContain('id="sidebar-toc"');
  });

  test("TOC section appears before textarea", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    const tocIdx = html.indexOf("sidebar-toc");
    const textareaIdx = html.indexOf("sidebar-text");
    expect(tocIdx).toBeLessThan(textareaIdx);
  });

  test("buildToc function exists in JS", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("function buildToc");
  });

  test("toc-item CSS class has pointer cursor", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain(".toc-item");
    expect(html).toContain("cursor: pointer");
  });

  test("TOC items use scrollIntoView", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("scrollIntoView");
  });

  test("switchTab triggers buildToc", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    const switchFn = html.slice(html.indexOf("function switchTab"), html.indexOf("// Arrow key"));
    expect(switchFn).toContain("buildToc()");
  });
});

describe("renderReviewPage — Cmd/Ctrl+Enter shortcut", () => {
  test("textarea has keydown listener for metaKey+Enter", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("metaKey");
    expect(html).toContain('"Enter"');
  });

  test("textarea has keydown listener for ctrlKey+Enter", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("ctrlKey");
  });

  test("keydown handler calls preventDefault", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    // Find the sidebar-text keydown section
    expect(html).toContain("preventDefault");
  });

  test("keydown handler calls submitFeedback", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("submitFeedback");
  });
});

describe("renderReviewPage — floating feedback widget", () => {
  test("feedback sidebar is position fixed", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("#feedback-sidebar");
    expect(html).toContain("position: fixed");
  });

  test("feedback sidebar anchored to bottom-right", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    const sidebarCss = html.slice(html.indexOf("#feedback-sidebar {"), html.indexOf("#feedback-sidebar {") + 500);
    expect(sidebarCss).toContain("bottom:");
    expect(sidebarCss).toContain("right:");
  });

  test("sidebar does not have top: 80px positioning", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    const sidebarCss = html.slice(html.indexOf("#feedback-sidebar {"), html.indexOf("#feedback-sidebar {") + 500);
    expect(sidebarCss).not.toContain("top: 80px");
  });

  test("sidebar has z-index above content", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("z-index: 100");
  });
});

describe("renderReviewPage — per-plan feedback", () => {
  test("parseFeedbackMarkdown present in rendered JS", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("parseFeedbackMarkdown");
  });

  test("page load fetches /api/feedback for each plan", () => {
    const html = renderReviewPage([
      { planId: "e1", htmlContent: "" },
      { planId: "e2", htmlContent: "" },
    ], 3000);
    expect(html).toContain("/api/feedback?planId=");
  });

  test("switchTab calls refreshSidebarHistory", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    const switchFn = html.slice(html.indexOf("function switchTab"), html.indexOf("// Arrow key"));
    expect(switchFn).toContain("refreshSidebarHistory");
  });

  test("feedback submission adds to feedbackMap", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("feedbackMap");
  });

  test("feedbackMap initialized as object", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).toContain("var feedbackMap = {}");
  });
});

describe("renderReviewPage — title and version", () => {
  test("tab shows title when provided", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "", title: "Auth Rewrite" }], 3000);
    expect(html).toContain("Auth Rewrite");
  });

  test("tab falls back to planId when no title", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    // Tab should contain planId text
    const tabMatch = html.match(/class="tab active"[^>]*>[^<]*e1/);
    expect(tabMatch).not.toBeNull();
  });

  test("long title truncated in tab with ellipsis", () => {
    const longTitle = "A".repeat(40);
    const html = renderReviewPage([{ planId: "e1", htmlContent: "", title: longTitle }], 3000);
    // Tab button text should be truncated
    const tabMatch = html.match(/class="tab active"[^>]*>([^<]+)</);
    expect(tabMatch).not.toBeNull();
    expect(tabMatch![1]).toBe("A".repeat(30) + "\u2026");
  });

  test("planId shown as title attribute on tab", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "", title: "My Plan" }], 3000);
    expect(html).toContain('title="e1"');
  });

  test("version badge displayed when version provided", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "<h1>X</h1>", version: 3 }], 3000);
    expect(html).toContain("version-badge");
    expect(html).toContain("v3");
  });

  test("no version badge when version is null", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "", version: null }], 3000);
    expect(html).not.toContain('<span class="version-badge">');
  });

  test("no version badge when version is undefined", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    expect(html).not.toContain('<span class="version-badge">');
  });

  test("document.title set in JS", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "", title: "My Plan" }], 3000);
    expect(html).toContain("document.title");
  });

  test("SSE new-plan handler reads title from API response", () => {
    const html = renderReviewPage([{ planId: "e1", htmlContent: "" }], 3000);
    // The new-plan handler should use the title field from the API
    const sseSection = html.slice(html.indexOf("new-plan"), html.indexOf("close-tab"));
    expect(sseSection).toContain(".title");
  });
});
