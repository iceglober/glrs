import { sanitizeHtml, escapeHtml } from "./sanitize-html.js";

/** Render a multi-plan review page with tabs, feedback sidebar, first-run dialog, and finish button. */
export function renderReviewPage(
  plans: Array<{ planId: string; htmlContent: string }>,
  serverPort: number,
): string {
  const API = `http://localhost:${serverPort}`;

  if (plans.length === 0) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Plan Review</title>
<style>body { font-family: -apple-system, sans-serif; margin: 2rem; color: #1a1a1a; }</style>
</head>
<body><h1>No plans registered for review</h1><p>Run <code>gsag plan review --id &lt;epic-id&gt;</code> to start a review.</p></body>
</html>`;
  }

  const tabBar = plans.map((p, i) =>
    `<button class="tab${i === 0 ? " active" : ""}" data-plan="${escapeHtml(p.planId)}" onclick="switchTab('${escapeHtml(p.planId)}')">${escapeHtml(p.planId)}</button>`
  ).join("");

  const panels = plans.map((p, i) =>
    `<div class="panel${i === 0 ? " active" : ""}" data-plan="${escapeHtml(p.planId)}">
      ${sanitizeHtml(p.htmlContent)}
      <div style="margin-top:2rem;padding-top:1rem;border-top:2px solid #e0e0e0;">
        <button class="finish-btn" data-plan="${escapeHtml(p.planId)}" onclick="finishReview('${escapeHtml(p.planId)}')">Finish Review</button>
      </div>
    </div>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plan Review</title>
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
  pre { background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; padding: 1rem; overflow-x: auto; font-size: 0.85rem; }
  code { font-size: 0.85em; background: #f0f0f0; padding: 0.15em 0.3em; border-radius: 3px; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  tr:nth-child(even) { background: #fafafa; }
  ul, ol { padding-left: 1.5rem; }
  li { margin: 0.25rem 0; }
  input[type="checkbox"] { margin-right: 0.5rem; }

  /* Tab bar */
  .tab-bar { display: flex; gap: 0.25rem; margin-bottom: 1.5rem; border-bottom: 2px solid #e0e0e0; padding-bottom: 0; }
  .tab {
    padding: 0.5rem 1.25rem;
    border: 1px solid #ddd;
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    background: #f0f0f0;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    color: #666;
    position: relative;
    bottom: -2px;
  }
  .tab.active { background: #fff; color: #1a1a1a; border-color: #e0e0e0; border-bottom: 2px solid #fff; }
  .tab:hover:not(.active) { background: #e8e8e8; }

  /* Panels */
  .panel { display: none; }
  .panel.active { display: block; }

  /* Finish button */
  .finish-btn {
    padding: 0.6rem 1.5rem;
    background: #16a34a;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.95rem;
    font-weight: 500;
  }
  .finish-btn:hover { background: #15803d; }

  /* Feedback sidebar */
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
    z-index: 101;
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

  /* First-run modal */
  #first-run-modal {
    display: none;
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 200;
    align-items: center;
    justify-content: center;
  }
  #first-run-modal.visible { display: flex; }
  #first-run-dialog {
    background: white;
    border-radius: 12px;
    padding: 2rem;
    max-width: 480px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  }
  #first-run-dialog h2 { margin-top: 0; border: none; font-size: 1.3rem; }
  #first-run-dialog code { background: #f0f0f0; padding: 0.2em 0.4em; border-radius: 3px; }
  #first-run-dismiss {
    margin-top: 1rem;
    padding: 0.5rem 1.5rem;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.95rem;
  }
  #first-run-dismiss:hover { background: #1d4ed8; }
</style>
</head>
<body>
<div class="tab-bar">${tabBar}</div>
${panels}

<div id="feedback-sidebar">
  <div id="sidebar-section">Reading: Introduction</div>
  <textarea id="sidebar-text" placeholder="Your feedback..."></textarea>
  <button id="sidebar-submit">Submit Feedback</button>
  <div id="sidebar-history"></div>
</div>
<button id="sidebar-toggle">Feedback</button>

<div id="first-run-modal">
  <div id="first-run-dialog">
    <h2>Plan Review</h2>
    <p>This page opens automatically when you run <code>gsag plan review</code>.</p>
    <p>To disable auto-open, run:</p>
    <pre><code>gsag config set plan.auto-open false</code></pre>
    <button id="first-run-dismiss">Got it</button>
  </div>
</div>

<script>
var API = "${API}";
var activePlanId = "${escapeHtml(plans[0].planId)}";

// Tab switching
function switchTab(planId) {
  document.querySelectorAll(".tab, .panel").forEach(function(el) { el.classList.remove("active"); });
  document.querySelector('.tab[data-plan="' + planId + '"]').classList.add("active");
  document.querySelector('.panel[data-plan="' + planId + '"]').classList.add("active");
  activePlanId = planId;
}

// Finish review
function finishReview(planId) {
  fetch(API + "/api/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId: planId }),
  }).then(function(res) { return res.json(); }).then(function(data) {
    if (data.ok) {
      // Remove the tab and panel
      var tab = document.querySelector('.tab[data-plan="' + planId + '"]');
      var panel = document.querySelector('.panel[data-plan="' + planId + '"]');
      if (tab) tab.remove();
      if (panel) panel.remove();
      // Activate next tab if any
      var remainingTabs = document.querySelectorAll(".tab");
      if (remainingTabs.length > 0) {
        remainingTabs[0].classList.add("active");
        var nextPlanId = remainingTabs[0].dataset.plan;
        document.querySelector('.panel[data-plan="' + nextPlanId + '"]').classList.add("active");
        activePlanId = nextPlanId;
      }
      if (data.remaining === 0) {
        window.close();
      }
    }
  });
}

// Section tracking via IntersectionObserver
var headings = document.querySelectorAll("h1, h2, h3, h4");
var sectionLabel = document.getElementById("sidebar-section");
var currentSection = "Introduction";

var observer = new IntersectionObserver(function(entries) {
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].isIntersecting) {
      currentSection = entries[i].target.textContent.trim();
      sectionLabel.textContent = "Reading: " + currentSection;
    }
  }
}, { rootMargin: "-10% 0px -80% 0px" });

headings.forEach(function(h) { observer.observe(h); });

// Submit feedback
document.getElementById("sidebar-submit").onclick = function() {
  var textarea = document.getElementById("sidebar-text");
  var text = textarea.value.trim();
  if (!text) return;
  var stepMatch = currentSection.match(/(\\d+\\.\\d+)/);
  var step = stepMatch ? stepMatch[1] : "General";
  fetch(API + "/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId: activePlanId, step: step, text: text }),
  }).then(function(res) {
    if (res.ok) {
      textarea.value = "";
      var item = document.createElement("div");
      item.className = "sidebar-history-item";
      var label = document.createElement("strong");
      label.textContent = step + ": ";
      item.appendChild(label);
      item.appendChild(document.createTextNode(text.length > 80 ? text.substring(0, 80) + "..." : text));
      document.getElementById("sidebar-history").prepend(item);
    } else {
      var errItem = document.createElement("div");
      errItem.className = "sidebar-history-item";
      errItem.style.background = "#fee2e2";
      errItem.style.color = "#991b1b";
      errItem.textContent = "Error: server returned " + res.status;
      document.getElementById("sidebar-history").prepend(errItem);
    }
  }).catch(function(e) {
    alert("Failed to send feedback: " + e.message);
  });
};

// Toggle sidebar on narrow screens
document.getElementById("sidebar-toggle").onclick = function() {
  document.getElementById("feedback-sidebar").classList.toggle("open");
};

// SSE listener for live updates
var es = new EventSource(API + "/api/events?planId=_browser");
es.addEventListener("new-plan", function(e) {
  var data = JSON.parse(e.data);
  // Fetch individual plan (returns sanitized htmlContent)
  fetch(API + "/api/plans/" + encodeURIComponent(data.planId)).then(function(res) { return res.json(); }).then(function(newPlan) {
    if (newPlan && newPlan.htmlContent && !document.querySelector('.tab[data-plan="' + data.planId + '"]')) {
      var tab = document.createElement("button");
      tab.className = "tab";
      tab.dataset.plan = data.planId;
      tab.textContent = data.planId;
      tab.addEventListener("click", function() { switchTab(data.planId); });
      document.querySelector(".tab-bar").appendChild(tab);

      var panel = document.createElement("div");
      panel.className = "panel";
      panel.dataset.plan = data.planId;
      panel.innerHTML = newPlan.htmlContent;
      var btnWrap = document.createElement("div");
      btnWrap.style.cssText = "margin-top:2rem;padding-top:1rem;border-top:2px solid #e0e0e0;";
      var finBtn = document.createElement("button");
      finBtn.className = "finish-btn";
      finBtn.dataset.plan = data.planId;
      finBtn.textContent = "Finish Review";
      finBtn.addEventListener("click", function() { finishReview(data.planId); });
      btnWrap.appendChild(finBtn);
      panel.appendChild(btnWrap);
      document.querySelector(".tab-bar").parentNode.appendChild(panel);
    }
  });
});
es.addEventListener("close-tab", function() {
  window.close();
});

// First-run dialog
fetch(API + "/api/first-run").then(function(res) { return res.json(); }).then(function(data) {
  if (data.firstRun) {
    document.getElementById("first-run-modal").classList.add("visible");
  }
});

document.getElementById("first-run-dismiss").onclick = function() {
  fetch(API + "/api/first-run-dismiss", { method: "POST" });
  document.getElementById("first-run-modal").classList.remove("visible");
};
</script>
</body>
</html>`;
}
