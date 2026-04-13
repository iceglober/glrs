import { marked } from "marked";

/** Strip dangerous HTML from marked output (script tags and on* event handlers). */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
}

/** Render plan markdown into a self-contained HTML review page with per-step feedback buttons. */
export function renderPlanPage(planMarkdown: string, planId: string, serverPort: number): string {
  const rawHtml = sanitizeHtml(marked(planMarkdown) as string);
  const html = injectFeedbackButtons(rawHtml);

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
  .feedback-btn {
    display: inline-block;
    margin: 0.5rem 0;
    padding: 0.3rem 0.75rem;
    font-size: 0.8rem;
    background: #e8f4fd;
    border: 1px solid #b8d9f0;
    border-radius: 4px;
    color: #1a6fa8;
    cursor: pointer;
  }
  .feedback-btn:hover { background: #d0ebfa; }
  .feedback-form {
    display: none;
    margin: 0.5rem 0 1rem;
    padding: 0.75rem;
    background: #f8f9fa;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
  }
  .feedback-form.open { display: block; }
  .feedback-form textarea {
    width: 100%;
    min-height: 80px;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.9rem;
    resize: vertical;
  }
  .feedback-form .submit-btn {
    margin-top: 0.5rem;
    padding: 0.4rem 1rem;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .feedback-form .submit-btn:hover { background: #1d4ed8; }
  .feedback-form .cancel-btn {
    margin-top: 0.5rem;
    margin-left: 0.5rem;
    padding: 0.4rem 1rem;
    background: #e5e7eb;
    color: #374151;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .feedback-sent { color: #16a34a; font-size: 0.85rem; margin: 0.25rem 0; }
  #general-feedback {
    margin-top: 3rem;
    padding: 1.5rem;
    background: #f0f7ff;
    border: 1px solid #b8d9f0;
    border-radius: 6px;
  }
  #general-feedback h2 { margin-top: 0; border: none; }
  #general-feedback textarea {
    width: 100%;
    min-height: 100px;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.9rem;
    resize: vertical;
  }
  #general-feedback .submit-btn {
    margin-top: 0.5rem;
    padding: 0.4rem 1rem;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  #general-feedback .submit-btn:hover { background: #1d4ed8; }
</style>
</head>
<body>
${html}
<div id="general-feedback">
  <h2>General Feedback</h2>
  <textarea id="general-text" placeholder="Overall comments on the plan..."></textarea>
  <br>
  <button class="submit-btn" onclick="submitGeneral()">Submit</button>
</div>
<script>
const API = "http://localhost:${serverPort}/api/feedback";

function toggleForm(btn) {
  const form = btn.nextElementSibling;
  form.classList.toggle("open");
  if (form.classList.contains("open")) {
    form.querySelector("textarea").focus();
  }
}

async function submitFeedback(btn, step) {
  const form = btn.closest(".feedback-form");
  const textarea = form.querySelector("textarea");
  const text = textarea.value.trim();
  if (!text) return;
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, text }),
    });
    if (res.ok) {
      textarea.value = "";
      form.classList.remove("open");
      const msg = document.createElement("div");
      msg.className = "feedback-sent";
      msg.textContent = "Feedback sent for step " + step;
      form.parentElement.insertBefore(msg, form.nextSibling);
    }
  } catch (e) {
    alert("Failed to send feedback: " + e.message);
  }
}

function cancelFeedback(btn) {
  const form = btn.closest(".feedback-form");
  form.classList.remove("open");
}

async function submitGeneral() {
  const textarea = document.getElementById("general-text");
  const text = textarea.value.trim();
  if (!text) return;
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "General", text }),
    });
    if (res.ok) {
      textarea.value = "";
      const msg = document.createElement("div");
      msg.className = "feedback-sent";
      msg.textContent = "General feedback sent";
      document.getElementById("general-feedback").appendChild(msg);
    }
  } catch (e) {
    alert("Failed to send feedback: " + e.message);
  }
}
</script>
</body>
</html>`;
}

/** Post-process marked HTML to inject feedback buttons after step headings. */
function injectFeedbackButtons(html: string): string {
  // Match h2/h3/h4 tags whose content contains a step number pattern (N.M)
  return html.replace(
    /(<h[234][^>]*>)(.*?)(<\/h[234]>)/gi,
    (match, openTag, content, closeTag) => {
      const stepMatch = content.match(/(\d+\.\d+)/);
      if (!stepMatch) return match;
      const step = stepMatch[1];
      return `${openTag}${content}${closeTag}
<button class="feedback-btn" data-step="${step}" onclick="toggleForm(this)">Comment on ${step}</button>
<div class="feedback-form">
  <textarea placeholder="Your feedback on step ${step}..."></textarea>
  <br>
  <button class="submit-btn" onclick="submitFeedback(this, '${step}')">Submit</button>
  <button class="cancel-btn" onclick="cancelFeedback(this)">Cancel</button>
</div>`;
    },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
