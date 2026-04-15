import { sanitizeHtml, escapeHtml } from "./sanitize-html.js";

function truncateTitle(title: string, max: number = 30): string {
  return title.length > max ? title.slice(0, max) + "\u2026" : title;
}

/** Render a multi-plan review page with tabs, feedback sidebar, first-run dialog, and finish button. */
export function renderReviewPage(
  plans: Array<{ planId: string; htmlContent: string; title?: string; version?: number | null }>,
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

  const tabBar = plans.map((p, i) => {
    const label = p.title ? escapeHtml(truncateTitle(p.title)) : escapeHtml(p.planId);
    return `<button class="tab${i === 0 ? " active" : ""}" role="tab" aria-selected="${i === 0 ? "true" : "false"}" aria-controls="panel-${escapeHtml(p.planId)}" data-plan="${escapeHtml(p.planId)}" title="${escapeHtml(p.planId)}" onclick="switchTab('${escapeHtml(p.planId)}')">${label}</button>`;
  }).join("");

  const panels = plans.map((p, i) => {
    const versionBadge = (p.version != null) ? `<span class="version-badge">v${p.version}</span>` : "";
    return `<div class="panel${i === 0 ? " active" : ""}" id="panel-${escapeHtml(p.planId)}" role="tabpanel" aria-labelledby="tab-${escapeHtml(p.planId)}" data-plan="${escapeHtml(p.planId)}">
      ${versionBadge}
      ${sanitizeHtml(p.htmlContent)}
      <div class="outcome-bar">
        <button class="approve-btn" onclick="finishReview('${escapeHtml(p.planId)}', 'approved')">Approve</button>
        <button class="changes-btn" onclick="finishReview('${escapeHtml(p.planId)}', 'changes-requested')">Request Changes</button>
      </div>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(plans[0].title || plans[0].planId)} — Plan Review</title>
<style>
  :root {
    --bg: #fafafa;
    --text: #1a1a1a;
    --text-muted: #666;
    --border: #e0e0e0;
    --border-light: #e8e8e8;
    --surface: #f0f0f0;
    --surface-alt: #f5f5f5;
    --surface-hover: #e8e8e8;
    --card-bg: #f8f9fa;
    --accent: #2563eb;
    --accent-hover: #1d4ed8;
    --success: #16a34a;
    --success-hover: #15803d;
    --badge-bg: #e0e7ff;
    --badge-text: #3730a3;
    --feedback-bg: #eef6ee;
    --error-bg: #fee2e2;
    --error-text: #991b1b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1a1a2e;
      --text: #e0e0e0;
      --text-muted: #999;
      --border: #333;
      --border-light: #2a2a3a;
      --surface: #252540;
      --surface-alt: #2a2a45;
      --surface-hover: #333355;
      --card-bg: #222240;
      --accent: #60a5fa;
      --accent-hover: #3b82f6;
      --success: #22c55e;
      --success-hover: #16a34a;
      --badge-bg: #312e81;
      --badge-text: #a5b4fc;
      --feedback-bg: #1a2e1a;
      --error-bg: #3b1111;
      --error-text: #fca5a5;
    }
  }

  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    max-width: 860px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    color: var(--text);
    background: var(--bg);
  }
  h1 { font-size: 1.8rem; border-bottom: 2px solid var(--border); padding-bottom: 0.5rem; }
  h2 { font-size: 1.4rem; margin-top: 2rem; border-bottom: 1px solid var(--border-light); padding-bottom: 0.3rem; }
  h3 { font-size: 1.15rem; margin-top: 1.5rem; }
  pre { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 1rem; overflow-x: auto; font-size: 0.85rem; }
  code { font-size: 0.85em; background: var(--surface); padding: 0.15em 0.3em; border-radius: 3px; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; }
  th { background: var(--surface-alt); font-weight: 600; }
  tr:nth-child(even) { background: var(--bg); }
  ul, ol { padding-left: 1.5rem; }
  li { margin: 0.25rem 0; }
  input[type="checkbox"] { margin-right: 0.5rem; }

  /* Tab bar */
  .tab-bar { display: flex; gap: 0.25rem; margin-bottom: 1.5rem; border-bottom: 2px solid var(--border); padding-bottom: 0; }
  .tab {
    padding: 0.5rem 1.25rem;
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    background: var(--surface);
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-muted);
    position: relative;
    bottom: -2px;
  }
  .tab.active { background: var(--bg); color: var(--text); border-color: var(--border); border-bottom: 2px solid var(--bg); }
  .tab:hover:not(.active) { background: var(--surface-hover); }

  /* Panels */
  .panel { display: none; }
  .panel.active { display: block; }

  /* Finish button */
  .outcome-bar {
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 2px solid var(--border);
    display: flex;
    gap: 0.75rem;
  }
  .approve-btn, .changes-btn {
    padding: 0.6rem 1.5rem;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.95rem;
    font-weight: 500;
  }
  .approve-btn { background: var(--success); }
  .approve-btn:hover { background: var(--success-hover); }
  .changes-btn { background: #d97706; }
  .changes-btn:hover { background: #b45309; }

  /* Version badge */
  .version-badge {
    display: inline-block;
    padding: 0.15em 0.5em;
    background: var(--badge-bg);
    color: var(--badge-text);
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  /* Progress bar */
  #progress-bar {
    position: fixed;
    top: 0;
    left: 0;
    height: 3px;
    background: var(--accent);
    z-index: 300;
    transition: width 50ms;
    width: 0;
  }

  /* TOC */
  #sidebar-toc {
    margin-bottom: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
    max-height: 150px;
    overflow-y: auto;
    font-size: 0.75rem;
  }
  #sidebar-toc:empty { display: none; }
  .toc-item {
    display: block;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0.15rem 0;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .toc-item:hover { color: var(--accent); }
  .toc-item.active { color: var(--accent); font-weight: 600; }
  .toc-item[data-level="3"] { padding-left: 0.75rem; }

  /* Feedback widget */
  #feedback-sidebar {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 300px;
    max-height: 400px;
    overflow-y: auto;
    padding: 1rem;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    font-size: 0.85rem;
    z-index: 100;
  }
  #sidebar-section {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #feedback-sidebar textarea {
    width: 100%;
    min-height: 100px;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.85rem;
    resize: vertical;
    background: var(--bg);
    color: var(--text);
  }
  #sidebar-submit {
    margin-top: 0.5rem;
    width: 100%;
    padding: 0.4rem 1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  #sidebar-submit:hover { background: var(--accent-hover); }
  .sidebar-history-item {
    margin-top: 0.5rem;
    padding: 0.4rem 0.5rem;
    background: var(--feedback-bg);
    border-radius: 3px;
    font-size: 0.8rem;
    color: var(--text);
    word-break: break-word;
  }
  @media (max-width: 1100px) {
    #feedback-sidebar { display: none; }
    #feedback-sidebar.open { display: block; }
    #sidebar-toggle { display: block; position: fixed; bottom: 20px; right: 20px; padding: 0.5rem 1rem; background: var(--accent); color: white; border: none; border-radius: 20px; cursor: pointer; font-size: 0.85rem; z-index: 101; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    #sidebar-toggle:hover { background: var(--accent-hover); }
  }
  @media (min-width: 1101px) {
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
    background: var(--card-bg);
    color: var(--text);
    border-radius: 12px;
    padding: 2rem;
    max-width: 480px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  }
  #first-run-dialog h2 { margin-top: 0; border: none; font-size: 1.3rem; }
  #first-run-dialog code { background: var(--surface); padding: 0.2em 0.4em; border-radius: 3px; }
  #first-run-dismiss {
    margin-top: 1rem;
    padding: 0.5rem 1.5rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.95rem;
  }
  #first-run-dismiss:hover { background: var(--accent-hover); }
</style>
</head>
<body>
<div id="progress-bar"></div>
<div class="tab-bar" role="tablist">${tabBar}</div>
${panels}

<div id="feedback-sidebar">
  <div id="sidebar-toc"></div>
  <div id="sidebar-section">Reading: Introduction</div>
  <textarea id="sidebar-text" placeholder="Your feedback..."></textarea>
  <button id="sidebar-submit">Submit Feedback</button>
  <div id="sidebar-history"></div>
</div>
<button id="sidebar-toggle">Feedback</button>

<div id="first-run-modal" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
  <div id="first-run-dialog">
    <h2 id="first-run-title">Plan Review</h2>
    <p>This page opens automatically when you run <code>gsag plan review</code>.</p>
    <p>To disable auto-open, run:</p>
    <pre><code>gsag config set plan.auto-open false</code></pre>
    <button id="first-run-dismiss">Got it</button>
  </div>
</div>

<script>
var API = "${API}";
var activePlanId = "${escapeHtml(plans[0].planId)}";
var planTitles = ${JSON.stringify(Object.fromEntries(plans.map(p => [p.planId, p.title || p.planId]))).replace(/<\//g, "<\\/")};
var feedbackMap = {};

function updateDocTitle(planId) {
  var t = planTitles[planId] || planId;
  document.title = t + " \\u2014 Plan Review";
}

function parseFeedbackMarkdown(content) {
  if (!content) return [];
  var items = [];
  var sections = content.split(/^## Step /m);
  for (var i = 1; i < sections.length; i++) {
    var nl = sections[i].indexOf("\\n");
    if (nl < 0) continue;
    var step = sections[i].substring(0, nl).trim();
    var text = sections[i].substring(nl + 1).trim();
    if (text) items.push({ step: step, text: text });
  }
  return items;
}

function refreshSidebarHistory() {
  var hist = document.getElementById("sidebar-history");
  hist.innerHTML = "";
  var items = feedbackMap[activePlanId] || [];
  for (var i = items.length - 1; i >= 0; i--) {
    var item = document.createElement("div");
    item.className = "sidebar-history-item";
    var label = document.createElement("strong");
    label.textContent = items[i].step + ": ";
    item.appendChild(label);
    var t = items[i].text;
    item.appendChild(document.createTextNode(t.length > 80 ? t.substring(0, 80) + "..." : t));
    hist.appendChild(item);
  }
}

function loadFeedbackForPlan(planId) {
  fetch(API + "/api/feedback?planId=" + encodeURIComponent(planId))
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.content) {
        feedbackMap[planId] = parseFeedbackMarkdown(data.content);
        if (planId === activePlanId) refreshSidebarHistory();
      }
    }).catch(function() {});
}

// Tab switching
function switchTab(planId) {
  document.querySelectorAll(".tab").forEach(function(el) { el.classList.remove("active"); el.setAttribute("aria-selected", "false"); });
  document.querySelectorAll(".panel").forEach(function(el) { el.classList.remove("active"); });
  var activeTab = document.querySelector('.tab[data-plan="' + planId + '"]');
  activeTab.classList.add("active");
  activeTab.setAttribute("aria-selected", "true");
  document.querySelector('.panel[data-plan="' + planId + '"]').classList.add("active");
  activePlanId = planId;
  updateDocTitle(planId);
  refreshSidebarHistory();
  buildToc();
  observeActivePanel();
}

function buildToc() {
  var toc = document.getElementById("sidebar-toc");
  toc.innerHTML = "";
  var panel = document.querySelector('.panel[data-plan="' + activePlanId + '"]');
  if (!panel) return;
  var hds = panel.querySelectorAll("h2, h3");
  hds.forEach(function(h) {
    var a = document.createElement("a");
    a.className = "toc-item";
    a.dataset.level = h.tagName === "H3" ? "3" : "2";
    a.textContent = h.textContent.trim();
    a.onclick = function(e) { e.preventDefault(); h.scrollIntoView({ behavior: "smooth", block: "start" }); };
    toc.appendChild(a);
  });
}

function highlightTocItem(sectionText) {
  document.querySelectorAll(".toc-item").forEach(function(el) {
    el.classList.toggle("active", el.textContent.trim() === sectionText);
  });
}

// Arrow key navigation between tabs
document.querySelector(".tab-bar").addEventListener("keydown", function(e) {
  var tabs = Array.from(document.querySelectorAll(".tab"));
  var idx = tabs.indexOf(document.activeElement);
  if (idx < 0) return;
  if (e.key === "ArrowRight") { e.preventDefault(); var next = tabs[(idx + 1) % tabs.length]; next.focus(); switchTab(next.dataset.plan); }
  if (e.key === "ArrowLeft") { e.preventDefault(); var prev = tabs[(idx - 1 + tabs.length) % tabs.length]; prev.focus(); switchTab(prev.dataset.plan); }
});

// Finish review
function finishReview(planId, outcome) {
  fetch(API + "/api/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId: planId, outcome: outcome || "approved" }),
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
        switchTab(remainingTabs[0].dataset.plan);
      }
      if (data.remaining === 0) {
        window.close();
      }
    }
  }).catch(function(err) {
    var errDiv = document.createElement("div");
    errDiv.style.cssText = "margin:1rem 0;padding:0.75rem;background:#fee2e2;color:#991b1b;border-radius:6px;";
    errDiv.textContent = "Failed to finish review: " + err.message;
    var panel = document.querySelector('.panel[data-plan="' + planId + '"]');
    if (panel) panel.prepend(errDiv);
  });
}

// Section tracking via IntersectionObserver
var sectionLabel = document.getElementById("sidebar-section");
var currentSection = "Introduction";

var observer = new IntersectionObserver(function(entries) {
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].isIntersecting) {
      currentSection = entries[i].target.textContent.trim();
      sectionLabel.textContent = "Reading: " + currentSection;
      highlightTocItem(currentSection);
    }
  }
}, { rootMargin: "-10% 0px -80% 0px" });

function observeActivePanel() {
  observer.disconnect();
  var panel = document.querySelector('.panel[data-plan="' + activePlanId + '"]');
  if (!panel) return;
  panel.querySelectorAll("h1, h2, h3, h4").forEach(function(h) { observer.observe(h); });
}

observeActivePanel();

// Submit feedback
function submitFeedback() {
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
      if (!feedbackMap[activePlanId]) feedbackMap[activePlanId] = [];
      feedbackMap[activePlanId].push({ step: step, text: text });
      refreshSidebarHistory();
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
}
document.getElementById("sidebar-submit").onclick = submitFeedback;
document.getElementById("sidebar-text").addEventListener("keydown", function(e) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitFeedback();
  }
});

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
      var tabLabel = newPlan.title || data.planId;
      if (tabLabel.length > 30) tabLabel = tabLabel.slice(0, 30) + "\u2026";
      planTitles[data.planId] = newPlan.title || data.planId;
      var tab = document.createElement("button");
      tab.className = "tab";
      tab.dataset.plan = data.planId;
      tab.title = data.planId;
      tab.textContent = tabLabel;
      tab.addEventListener("click", function() { switchTab(data.planId); });
      document.querySelector(".tab-bar").appendChild(tab);

      var panel = document.createElement("div");
      panel.className = "panel";
      panel.dataset.plan = data.planId;
      panel.innerHTML = newPlan.htmlContent;
      var btnWrap = document.createElement("div");
      btnWrap.className = "outcome-bar";
      var approveBtn = document.createElement("button");
      approveBtn.className = "approve-btn";
      approveBtn.textContent = "Approve";
      approveBtn.addEventListener("click", function() { finishReview(data.planId, "approved"); });
      var changesBtn = document.createElement("button");
      changesBtn.className = "changes-btn";
      changesBtn.textContent = "Request Changes";
      changesBtn.addEventListener("click", function() { finishReview(data.planId, "changes-requested"); });
      btnWrap.appendChild(approveBtn);
      btnWrap.appendChild(changesBtn);
      panel.appendChild(btnWrap);
      document.querySelector(".tab-bar").parentNode.appendChild(panel);
      loadFeedbackForPlan(data.planId);
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

function dismissFirstRun() {
  fetch(API + "/api/first-run-dismiss", { method: "POST" });
  document.getElementById("first-run-modal").classList.remove("visible");
}
document.getElementById("first-run-dismiss").onclick = dismissFirstRun;
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape" && document.getElementById("first-run-modal").classList.contains("visible")) {
    dismissFirstRun();
  }
});

// Scroll progress bar
window.addEventListener("scroll", function() {
  var bar = document.getElementById("progress-bar");
  var max = document.documentElement.scrollHeight - window.innerHeight;
  bar.style.width = max > 0 ? ((window.scrollY / max) * 100) + "%" : "0";
});

// Build initial TOC
buildToc();

// Load existing feedback for all plans
${plans.map(p => `loadFeedbackForPlan("${escapeHtml(p.planId)}");`).join("\n")}
</script>
</body>
</html>`;
}
