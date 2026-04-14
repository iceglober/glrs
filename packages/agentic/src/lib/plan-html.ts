import { marked } from "marked";

/** Strip dangerous HTML from marked output (script tags and on* event handlers). */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
}

/** Render plan markdown into a self-contained HTML review page with floating feedback sidebar. */
export function renderPlanPage(planMarkdown: string, planId: string, serverPort: number): string {
  const html = sanitizeHtml(marked(planMarkdown) as string);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plan Review — ${escapeHtml(planId)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    max-width: 860px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    color: #1a1a1a;
    background: #fafafa;
  }
  h1 { font-size: 1.8rem; border-bottom: 2px solid #e0e0e0; padding-bottom: 0.5rem; }
  h2 { font-size: 1.4rem; margin-top: 2rem; border-bottom: 1px solid #e8e8e8; padding-bottom: 0.3rem; }
  h3 { font-size: 1.15rem; margin-top: 1.5rem; }
  pre {
    background: #f0f0f0;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 1rem;
    overflow-x: auto;
    font-size: 0.85rem;
  }
  code { font-size: 0.85em; background: #f0f0f0; padding: 0.15em 0.3em; border-radius: 3px; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  tr:nth-child(even) { background: #fafafa; }
  ul, ol { padding-left: 1.5rem; }
  li { margin: 0.25rem 0; }
  input[type="checkbox"] { margin-right: 0.5rem; }
  .feedback-sent { color: #16a34a; font-size: 0.85rem; margin: 0.25rem 0; }
  @media (min-width: 1300px) {
    body { margin-left: max(1.5rem, calc((100vw - 860px - 320px) / 2)); margin-right: auto; }
  }
  #feedback-sidebar {
    position: fixed;
    top: 80px;
    right: 20px;
    width: 280px;
    max-height: calc(100vh - 120px);
    overflow-y: auto;
    padding: 1rem;
    background: #f8f9fa;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    font-size: 0.85rem;
    z-index: 100;
  }
  #sidebar-section {
    font-size: 0.75rem;
    color: #666;
    margin-bottom: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #e0e0e0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #feedback-sidebar textarea {
    width: 100%;
    min-height: 100px;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.85rem;
    resize: vertical;
  }
  #sidebar-submit {
    margin-top: 0.5rem;
    width: 100%;
    padding: 0.4rem 1rem;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  #sidebar-submit:hover { background: #1d4ed8; }
  .sidebar-history-item {
    margin-top: 0.5rem;
    padding: 0.4rem 0.5rem;
    background: #eef6ee;
    border-radius: 3px;
    font-size: 0.8rem;
    color: #374151;
    word-break: break-word;
  }
  #sidebar-toggle {
    display: none;
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 0.5rem 1rem;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 20px;
    cursor: pointer;
    font-size: 0.85rem;
    z-index: 99;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  }
  #sidebar-toggle:hover { background: #1d4ed8; }
  @media (max-width: 1299px) {
    #feedback-sidebar { display: none; }
    #feedback-sidebar.open { display: block; }
    #sidebar-toggle { display: block; }
  }
  @media (min-width: 1300px) {
    #sidebar-toggle { display: none; }
  }
</style>
</head>
<body>
${html}
<div id="feedback-sidebar">
  <div id="sidebar-section">Reading: Introduction</div>
  <textarea id="sidebar-text" placeholder="Your feedback..."></textarea>
  <button id="sidebar-submit">Submit Feedback</button>
  <div id="sidebar-history"></div>
</div>
<button id="sidebar-toggle">Feedback</button>
<script>
const API = "http://localhost:${serverPort}/api/feedback";

// Section tracking via IntersectionObserver
const headings = document.querySelectorAll("h1, h2, h3, h4");
const sectionLabel = document.getElementById("sidebar-section");
let currentSection = "Introduction";

const observer = new IntersectionObserver(function(entries) {
  for (const e of entries) {
    if (e.isIntersecting) {
      currentSection = e.target.textContent.trim();
      sectionLabel.textContent = "Reading: " + currentSection;
    }
  }
}, { rootMargin: "-10% 0px -80% 0px" });

headings.forEach(function(h) { observer.observe(h); });

// Submit feedback tagged with current section
document.getElementById("sidebar-submit").onclick = async function() {
  const textarea = document.getElementById("sidebar-text");
  const text = textarea.value.trim();
  if (!text) return;
  const stepMatch = currentSection.match(/(\\d+\\.\\d+)/);
  const step = stepMatch ? stepMatch[1] : "General";
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: step, text: text }),
    });
    if (res.ok) {
      textarea.value = "";
      const item = document.createElement("div");
      item.className = "sidebar-history-item";
      const label = document.createElement("strong");
      label.textContent = step + ": ";
      item.appendChild(label);
      item.appendChild(document.createTextNode(text.length > 80 ? text.substring(0, 80) + "..." : text));
      document.getElementById("sidebar-history").prepend(item);
    }
  } catch (e) {
    alert("Failed to send feedback: " + e.message);
  }
};

// Toggle sidebar on narrow screens
document.getElementById("sidebar-toggle").onclick = function() {
  document.getElementById("feedback-sidebar").classList.toggle("open");
};
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
