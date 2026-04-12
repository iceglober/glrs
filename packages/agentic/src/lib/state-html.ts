/** Render a self-contained HTML dashboard for the state viewer. */
export function renderStatePage(serverPort: number, opts?: { all?: boolean }): string {
  const apiUrl = opts?.all ? `/api/state?all=true` : `/api/state`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>gsag state</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    margin: 0;
    padding: 0;
    color: #1a1a1a;
    background: #f5f5f5;
  }
  .layout { display: flex; min-height: 100vh; }
  .sidebar {
    width: 280px;
    background: #1e1e2e;
    color: #cdd6f4;
    padding: 1rem;
    overflow-y: auto;
    flex-shrink: 0;
  }
  .sidebar h1 { font-size: 1.1rem; color: #cba6f7; margin: 0 0 1rem; }
  .sidebar .epic-item {
    padding: 0.4rem 0.6rem;
    margin: 0.15rem 0;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .sidebar .epic-item:hover { background: #313244; }
  .sidebar .epic-item.active { background: #45475a; color: #f5e0dc; }
  .main { flex: 1; padding: 1.5rem 2rem; overflow-y: auto; }
  .main h2 { font-size: 1.4rem; margin: 0 0 0.5rem; }
  .main .epic-desc { color: #555; margin-bottom: 1rem; }

  .task-card {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    margin-bottom: 0.5rem;
    cursor: pointer;
  }
  .task-card:hover { border-color: #b0b0b0; }
  .task-card .task-header { display: flex; align-items: center; gap: 0.5rem; }
  .task-card .task-id { font-size: 0.75rem; color: #888; font-family: monospace; }
  .task-card .task-title { font-weight: 600; font-size: 0.9rem; }
  .task-card .task-meta { font-size: 0.75rem; color: #888; margin-top: 0.25rem; }

  .badge {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 10px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .badge-understand { background: #e0f7fa; color: #00838f; }
  .badge-design { background: #f3e5f5; color: #7b1fa2; }
  .badge-implement { background: #fff9c4; color: #f57f17; }
  .badge-verify { background: #e0f2f1; color: #00695c; }
  .badge-ship { background: #e8f5e9; color: #2e7d32; }
  .badge-done { background: #eeeeee; color: #616161; }
  .badge-cancelled { background: #ffebee; color: #c62828; text-decoration: line-through; }

  .claim-badge {
    display: inline-block;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    background: #fff3e0;
    color: #e65100;
  }

  .detail-panel {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 1rem 1.25rem;
    margin-top: 1rem;
  }
  .detail-panel h3 { margin: 0 0 0.5rem; font-size: 1.1rem; }
  .detail-panel .plan-content {
    background: #fafafa;
    border: 1px solid #eee;
    border-radius: 4px;
    padding: 0.75rem;
    font-size: 0.85rem;
    white-space: pre-wrap;
    font-family: monospace;
    max-height: 400px;
    overflow-y: auto;
  }

  .review-summary {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
    font-size: 0.8rem;
  }
  .review-summary .rs-item { padding: 0.2rem 0.5rem; border-radius: 4px; background: #f5f5f5; }

  .standalone-header { margin-top: 2rem; color: #888; font-size: 0.9rem; border-bottom: 1px solid #e0e0e0; padding-bottom: 0.25rem; }

  .empty-state { color: #999; font-style: italic; padding: 2rem; text-align: center; }

  .refresh-indicator {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    font-size: 0.7rem;
    color: #aaa;
  }
</style>
</head>
<body>
<div class="layout">
  <div class="sidebar" id="sidebar">
    <h1>gsag state</h1>
    <div id="epic-list"></div>
  </div>
  <div class="main" id="main">
    <div class="empty-state">Loading...</div>
  </div>
</div>
<div class="refresh-indicator" id="refresh">Auto-refresh: 5s</div>
<div id="app"></div>
<script>
const API = "http://localhost:${serverPort}";
let state = null;
let selectedEpic = null;
let selectedTask = null;
let planCache = {};

async function fetchState() {
  try {
    const res = await fetch(API + "${apiUrl}");
    state = await res.json();
    renderSidebar();
    renderMain();
    document.getElementById("refresh").textContent = "Updated: " + new Date().toLocaleTimeString();
  } catch (e) {
    document.getElementById("refresh").textContent = "Fetch failed: " + e.message;
  }
}

function badgeClass(phase) {
  return "badge badge-" + phase;
}

function renderSidebar() {
  const el = document.getElementById("epic-list");
  if (!state) { el.innerHTML = ""; return; }
  let html = "";
  for (const epic of state.epics) {
    const active = selectedEpic === epic.id ? " active" : "";
    const taskCount = epic.tasks ? epic.tasks.length : 0;
    const doneCount = epic.tasks ? epic.tasks.filter(t => t.phase === "done").length : 0;
    html += '<div class="epic-item' + active + '" onclick="selectEpic(\\'' + epic.id + '\\')">';
    html += '<span class="' + badgeClass(epic.derivedPhase || epic.phase) + '">' + (epic.derivedPhase || epic.phase) + '</span> ';
    html += '<strong>' + esc(epic.id) + '</strong> ' + esc(epic.title);
    html += ' <span style="color:#888;font-size:0.7rem">(' + doneCount + '/' + taskCount + ')</span>';
    html += '</div>';
  }
  if (state.standalone && state.standalone.length > 0) {
    html += '<div style="margin-top:1rem;font-size:0.75rem;color:#888">Standalone tasks: ' + state.standalone.length + '</div>';
  }
  el.innerHTML = html;
}

function renderMain() {
  const el = document.getElementById("main");
  if (!state) { el.innerHTML = '<div class="empty-state">No data</div>'; return; }

  if (selectedEpic) {
    const epic = state.epics.find(e => e.id === selectedEpic);
    if (!epic) { el.innerHTML = '<div class="empty-state">Epic not found</div>'; return; }
    let html = '<h2><span class="' + badgeClass(epic.derivedPhase || epic.phase) + '">' + (epic.derivedPhase || epic.phase) + '</span> ' + esc(epic.id) + ': ' + esc(epic.title) + '</h2>';
    if (epic.description) html += '<div class="epic-desc">' + esc(epic.description) + '</div>';
    if (epic.reviewSummary && epic.reviewSummary.total > 0) {
      html += '<div class="review-summary">';
      html += '<span class="rs-item">Reviews: ' + epic.reviewSummary.total + ' total</span>';
      html += '<span class="rs-item">Open: ' + epic.reviewSummary.open + '</span>';
      html += '<span class="rs-item">Fixed: ' + epic.reviewSummary.fixed + '</span>';
      html += '</div>';
    }
    html += renderTasks(epic.tasks || []);

    if (selectedTask) {
      const task = (epic.tasks || []).find(t => t.id === selectedTask);
      if (task) html += renderTaskDetail(task);
    }

    el.innerHTML = html;
    return;
  }

  // Default: overview
  let html = '<h2>Overview</h2>';
  const active = state.epics.filter(e => (e.derivedPhase || e.phase) !== "done" && (e.derivedPhase || e.phase) !== "cancelled");
  const completed = state.epics.filter(e => (e.derivedPhase || e.phase) === "done" || (e.derivedPhase || e.phase) === "cancelled");

  if (active.length > 0) {
    html += '<h3>Active (' + active.length + ')</h3>';
    for (const epic of active) {
      const taskCount = epic.tasks ? epic.tasks.length : 0;
      const doneCount = epic.tasks ? epic.tasks.filter(t => t.phase === "done").length : 0;
      html += '<div class="task-card" onclick="selectEpic(\\'' + epic.id + '\\')">';
      html += '<div class="task-header"><span class="' + badgeClass(epic.derivedPhase || epic.phase) + '">' + (epic.derivedPhase || epic.phase) + '</span>';
      html += '<span class="task-id">' + esc(epic.id) + '</span>';
      html += '<span class="task-title">' + esc(epic.title) + '</span></div>';
      html += '<div class="task-meta">' + doneCount + '/' + taskCount + ' tasks done</div>';
      html += '</div>';
    }
  }

  if (completed.length > 0) {
    html += '<h3 style="color:#888">Completed (' + completed.length + ')</h3>';
    for (const epic of completed) {
      html += '<div class="task-card" onclick="selectEpic(\\'' + epic.id + '\\')" style="opacity:0.6">';
      html += '<div class="task-header"><span class="' + badgeClass(epic.derivedPhase || epic.phase) + '">' + (epic.derivedPhase || epic.phase) + '</span>';
      html += '<span class="task-id">' + esc(epic.id) + '</span>';
      html += '<span class="task-title">' + esc(epic.title) + '</span></div>';
      html += '</div>';
    }
  }

  if (state.standalone && state.standalone.length > 0) {
    html += '<div class="standalone-header">Standalone Tasks</div>';
    html += renderTasks(state.standalone);
  }

  if (state.epics.length === 0 && (!state.standalone || state.standalone.length === 0)) {
    html += '<div class="empty-state">No epics or tasks found.</div>';
  }

  el.innerHTML = html;
}

function renderTasks(tasks) {
  let html = "";
  for (const task of tasks) {
    const active = selectedTask === task.id ? " style=\\"border-color:#7c3aed\\"" : "";
    html += '<div class="task-card"' + active + ' onclick="selectTask(\\'' + task.id + '\\')">';
    html += '<div class="task-header">';
    html += '<span class="' + badgeClass(task.phase) + '">' + task.phase + '</span>';
    html += '<span class="task-id">' + esc(task.id) + '</span>';
    html += '<span class="task-title">' + esc(task.title) + '</span>';
    if (task.claimedBy) html += ' <span class="claim-badge">' + esc(task.claimedBy) + '</span>';
    html += '</div>';
    const meta = [];
    if (task.branch) meta.push(task.branch);
    if (task.pr) meta.push('<a href="' + esc(task.pr) + '" target="_blank">PR</a>');
    if (task.dependencies && task.dependencies.length > 0) meta.push("deps: " + task.dependencies.join(", "));
    if (meta.length > 0) html += '<div class="task-meta">' + meta.join(" · ") + '</div>';
    html += '</div>';
  }
  return html;
}

function renderTaskDetail(task) {
  let html = '<div class="detail-panel">';
  html += '<h3>' + esc(task.id) + ': ' + esc(task.title) + '</h3>';
  html += '<div style="margin-bottom:0.5rem">';
  html += '<span class="' + badgeClass(task.phase) + '">' + task.phase + '</span>';
  if (task.claimedBy) html += ' <span class="claim-badge">claimed by ' + esc(task.claimedBy) + '</span>';
  html += '</div>';
  if (task.description) html += '<p style="font-size:0.85rem;color:#555">' + esc(task.description) + '</p>';

  const details = [];
  if (task.branch) details.push('<strong>Branch:</strong> ' + esc(task.branch));
  if (task.worktree) details.push('<strong>Worktree:</strong> ' + esc(task.worktree));
  if (task.pr) details.push('<strong>PR:</strong> <a href="' + esc(task.pr) + '" target="_blank">' + esc(task.pr) + '</a>');
  if (task.qaResult) details.push('<strong>QA:</strong> ' + task.qaResult.status + ' — ' + esc(task.qaResult.summary));
  if (details.length > 0) html += '<div style="font-size:0.8rem;margin-bottom:0.5rem">' + details.join('<br>') + '</div>';

  if (task.reviewSummary && task.reviewSummary.total > 0) {
    html += '<div class="review-summary">';
    html += '<span class="rs-item">Reviews: ' + task.reviewSummary.total + '</span>';
    html += '<span class="rs-item">Open: ' + task.reviewSummary.open + '</span>';
    html += '<span class="rs-item">Fixed: ' + task.reviewSummary.fixed + '</span>';
    html += '</div>';
  }

  // Plan content section
  html += '<div id="plan-area"></div>';
  html += '</div>';

  // Fetch plan if available
  if (task.plan || task.epic) {
    const planId = task.id;
    if (planCache[planId]) {
      html = html.replace('id="plan-area">', 'id="plan-area"><h4>Plan</h4><div class="plan-content">' + esc(planCache[planId]) + '</div>');
    } else {
      setTimeout(() => loadPlan(planId), 0);
    }
  }

  return html;
}

async function loadPlan(id) {
  if (planCache[id] !== undefined) return;
  try {
    const res = await fetch(API + "/api/plan/" + id);
    const data = await res.json();
    if (data.content) {
      planCache[id] = data.content;
      const area = document.getElementById("plan-area");
      if (area) {
        area.innerHTML = '<h4>Plan</h4><div class="plan-content">' + esc(data.content) + '</div>';
      }
    }
  } catch {}
}

function selectEpic(id) {
  selectedEpic = (selectedEpic === id) ? null : id;
  selectedTask = null;
  renderSidebar();
  renderMain();
}

function selectTask(id) {
  selectedTask = (selectedTask === id) ? null : id;
  renderMain();
}

function esc(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

fetchState();
setInterval(fetchState, 5000);
</script>
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
