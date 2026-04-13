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
  :root {
    --bg: #f8f9fa;
    --surface: #ffffff;
    --surface-hover: #f1f3f5;
    --border: #dee2e6;
    --border-hover: #adb5bd;
    --text: #212529;
    --text-muted: #868e96;
    --text-dim: #adb5bd;
    --sidebar-bg: #1e1e2e;
    --sidebar-text: #cdd6f4;
    --sidebar-hover: #313244;
    --sidebar-active: #45475a;
    --sidebar-active-text: #f5e0dc;
    --accent: #7c3aed;
    --accent-light: #ede9fe;
    --radius: 6px;
    --radius-sm: 4px;
    --radius-pill: 10px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    color: var(--text);
    background: var(--bg);
  }
  .layout { display: flex; min-height: 100vh; }
  .sidebar {
    width: 280px;
    background: var(--sidebar-bg);
    color: var(--sidebar-text);
    padding: 1rem;
    overflow-y: auto;
    flex-shrink: 0;
    border-right: 1px solid rgba(255,255,255,0.05);
  }
  .sidebar-title { font-size: 1.1rem; color: #cba6f7; margin-bottom: 1rem; font-weight: 700; }
  .epic-nav {
    padding: 0.5rem 0.6rem;
    margin: 0.15rem 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    transition: background 0.15s;
  }
  .epic-nav:hover { background: var(--sidebar-hover); }
  .epic-nav.active { background: var(--sidebar-active); color: var(--sidebar-active-text); }
  .epic-nav-progress { color: #888; font-size: 0.7rem; margin-left: auto; }
  .main { flex: 1; padding: 1.5rem 2rem; overflow-y: auto; }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    margin-bottom: 0.5rem;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .card:hover { border-color: var(--border-hover); box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
  .card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .card-header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .card-id { font-size: 0.75rem; color: var(--text-muted); font-family: monospace; }
  .card-title { font-weight: 600; font-size: 0.9rem; }
  .card-meta { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; }
  .badge {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: var(--radius-pill);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .badge-understand { background: #e0f7fa; color: #00838f; }
  .badge-design { background: #f3e5f5; color: #7b1fa2; }
  .badge-implement { background: #fff9c4; color: #f57f17; }
  .badge-verify { background: #e0f2f1; color: #00695c; }
  .badge-ship { background: #e8f5e9; color: #2e7d32; }
  .badge-done { background: #eeeeee; color: #616161; }
  .badge-cancelled { background: #ffebee; color: #c62828; text-decoration: line-through; }
  .claim-tag {
    display: inline-block;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-size: 0.7rem;
    background: #fff3e0;
    color: #e65100;
  }
  .detail {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    margin-top: 1rem;
  }
  .detail h3 { margin-bottom: 0.5rem; font-size: 1.1rem; }
  .plan-content {
    background: #fafafa;
    border: 1px solid #eee;
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    font-size: 0.85rem;
    white-space: pre-wrap;
    font-family: "SF Mono", SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
    max-height: 400px;
    overflow-y: auto;
    line-height: 1.5;
  }
  .review-bar {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
    font-size: 0.8rem;
  }
  .review-chip { padding: 0.2rem 0.5rem; border-radius: var(--radius-sm); background: #f5f5f5; }
  .section-label { margin-top: 2rem; color: var(--text-muted); font-size: 0.9rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25rem; margin-bottom: 0.5rem; }
  .empty { color: var(--text-dim); font-style: italic; padding: 2rem; text-align: center; }
  .refresh-bar {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    font-size: 0.7rem;
    color: var(--text-dim);
    background: var(--surface);
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }
  .repo-tabs {
    display: flex;
    gap: 0;
    border-bottom: 2px solid var(--border);
    margin-bottom: 1rem;
  }
  .repo-tab {
    padding: 0.5rem 1rem;
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .repo-tab:hover { color: var(--text); }
  .repo-tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
  .link { color: var(--accent); text-decoration: none; }
  .link:hover { text-decoration: underline; }
  .detail-row { font-size: 0.8rem; margin-bottom: 0.25rem; }
  .detail-label { font-weight: 600; }
  h2 { font-size: 1.4rem; margin-bottom: 0.5rem; }
  h3 { font-size: 1.1rem; }
</style>
</head>
<body>
<div id="root"></div>
<script type="module">
import React from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";
const h = htm.bind(React.createElement);
const css = s => {
  const o = {};
  s.split(";").forEach(p => {
    const [k, ...v] = p.split(":");
    if (k && v.length) {
      const prop = k.trim().replace(/-[a-z]/g, m => m[1].toUpperCase());
      o[prop] = v.join(":").trim();
    }
  });
  return o;
};

const API = "http://localhost:${serverPort}";
const API_STATE_URL = "${apiUrl}";

// ── App ────────────────────────────────────────────────────────────

function repoLabel(r) {
  // github.com/org/repo → org/repo
  const parts = r.split("/");
  if (parts.length >= 3) return parts.slice(1).join("/");
  return r;
}

function App() {
  const [state, setState] = React.useState(null);
  const [selectedRepo, setSelectedRepo] = React.useState(null);
  const [selectedEpic, setSelectedEpic] = React.useState(null);
  const [selectedTask, setSelectedTask] = React.useState(null);
  const [planCache, setPlanCache] = React.useState({});
  const [lastUpdate, setLastUpdate] = React.useState(null);
  const [error, setError] = React.useState(null);

  const fetchState = React.useCallback(async () => {
    try {
      const res = await fetch(API + API_STATE_URL);
      const data = await res.json();
      setState(data);
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  React.useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, 5000);
    return () => clearInterval(id);
  }, [fetchState]);

  const loadPlan = React.useCallback(async (id) => {
    if (planCache[id] !== undefined) return;
    try {
      const res = await fetch(API + "/api/plan/" + encodeURIComponent(id));
      const data = await res.json();
      setPlanCache(prev => ({ ...prev, [id]: data.content || null }));
    } catch {}
  }, [planCache]);

  const toggleEpic = React.useCallback((id) => {
    setSelectedEpic(prev => prev === id ? null : id);
    setSelectedTask(null);
  }, []);

  const toggleTask = React.useCallback((id) => {
    setSelectedTask(prev => prev === id ? null : id);
  }, []);

  if (!state) {
    return h\`<div class="layout"><div class="sidebar"><div class="sidebar-title">gsag state</div></div><div class="main"><div class="empty">Loading...</div></div></div>\`;
  }

  // Multi-repo mode (--all): state.repos is an array
  // Single-repo mode: state.epics / state.standalone
  const isMultiRepo = Array.isArray(state.repos);
  let epics, standalone, activeRepoName;

  if (isMultiRepo) {
    const activeRepo = selectedRepo || (state.repos.length > 0 ? state.repos[0].repo : null);
    const repoData = state.repos.find(r => r.repo === activeRepo);
    epics = repoData ? repoData.epics : [];
    standalone = repoData ? repoData.standalone : [];
    activeRepoName = activeRepo ? repoLabel(activeRepo) : null;
  } else {
    epics = state.epics || [];
    standalone = state.standalone || [];
    activeRepoName = null;
  }

  return h\`
    <div class="layout">
      <\${Sidebar} epics=\${epics} standalone=\${standalone} selectedEpic=\${selectedEpic} onSelectEpic=\${toggleEpic} repoName=\${activeRepoName} />
      <div class="main">
        \${isMultiRepo && state.repos.length > 0 && h\`
          <div class="repo-tabs">
            \${state.repos.map(r => h\`
              <div
                key=\${r.repo}
                class=\${"repo-tab" + ((selectedRepo || state.repos[0].repo) === r.repo ? " active" : "")}
                onClick=\${() => { setSelectedRepo(r.repo); setSelectedEpic(null); setSelectedTask(null); }}
              >\${repoLabel(r.repo)}</div>
            \`)}
          </div>
        \`}
        <\${MainPanel}
          epics=\${epics}
          standalone=\${standalone}
          selectedEpic=\${selectedEpic}
          selectedTask=\${selectedTask}
          onSelectEpic=\${toggleEpic}
          onSelectTask=\${toggleTask}
          planCache=\${planCache}
          loadPlan=\${loadPlan}
        />
      </div>
    </div>
    <div class="refresh-bar">
      \${error ? "Error: " + error : lastUpdate ? "Updated: " + lastUpdate.toLocaleTimeString() : "Loading..."}
    </div>
  \`;
}

// ── Sidebar ────────────────────────────────────────────────────────

function Sidebar({ epics, standalone, selectedEpic, onSelectEpic, repoName }) {
  return h\`
    <div class="sidebar">
      <div class="sidebar-title">gsag state</div>
      \${repoName && h\`<div style=\${css("font-size:0.75rem;color:#888;margin-bottom:0.75rem;padding:0.25rem 0.4rem;background:rgba(255,255,255,0.05);border-radius:4px")}>\${repoName}</div>\`}
      \${epics.map(epic => {
        const phase = epic.derivedPhase || epic.phase;
        const total = epic.tasks ? epic.tasks.length : 0;
        const done = epic.tasks ? epic.tasks.filter(t => t.phase === "done").length : 0;
        const active = selectedEpic === epic.id;
        return h\`
          <div class=\${"epic-nav" + (active ? " active" : "")} key=\${epic.id} onClick=\${() => onSelectEpic(epic.id)}>
            <\${Badge} phase=\${phase} />
            <strong>\${epic.id}</strong>
            <span>\${epic.title}</span>
            <span class="epic-nav-progress">\${done}/\${total}</span>
          </div>
        \`;
      })}
      \${standalone.length > 0 && h\`
        <div style=\${css("margin-top:1rem;font-size:0.75rem;color:#888")}>Standalone tasks: \${standalone.length}</div>
      \`}
    </div>
  \`;
}

// ── Main panel ─────────────────────────────────────────────────────

function MainPanel({ epics, standalone, selectedEpic, selectedTask, onSelectEpic, onSelectTask, planCache, loadPlan }) {
  if (selectedEpic) {
    const epic = epics.find(e => e.id === selectedEpic);
    if (!epic) return h\`<div class="empty">Epic not found</div>\`;

    return h\`
      <div>
        <h2><\${Badge} phase=\${epic.derivedPhase || epic.phase} /> \${epic.id}: \${epic.title}</h2>
        \${epic.description && h\`<p style=\${css("color:var(--text-muted);margin-bottom:1rem")}>\${epic.description}</p>\`}
        \${epic.reviewSummary && epic.reviewSummary.total > 0 && h\`<\${ReviewBar} summary=\${epic.reviewSummary} />\`}
        \${(epic.tasks || []).map(task => h\`
          <\${TaskCard}
            key=\${task.id}
            task=\${task}
            selected=\${selectedTask === task.id}
            onClick=\${() => onSelectTask(task.id)}
          />
        \`)}
        \${selectedTask && h\`<\${TaskDetail}
          task=\${(epic.tasks || []).find(t => t.id === selectedTask)}
          planCache=\${planCache}
          loadPlan=\${loadPlan}
        />\`}
      </div>
    \`;
  }

  // Overview
  const active = epics.filter(e => (e.derivedPhase || e.phase) !== "done" && (e.derivedPhase || e.phase) !== "cancelled");
  const completed = epics.filter(e => (e.derivedPhase || e.phase) === "done" || (e.derivedPhase || e.phase) === "cancelled");

  return h\`
    <div>
      <h2>Overview</h2>
      \${active.length > 0 && h\`
        <h3>Active (\${active.length})</h3>
        \${active.map(epic => h\`<\${EpicCard} key=\${epic.id} epic=\${epic} onClick=\${() => onSelectEpic(epic.id)} />\`)}
      \`}
      \${completed.length > 0 && h\`
        <h3 style=\${css("color:var(--text-muted);margin-top:1rem")}>Completed (\${completed.length})</h3>
        \${completed.map(epic => h\`<\${EpicCard} key=\${epic.id} epic=\${epic} onClick=\${() => onSelectEpic(epic.id)} dimmed />\`)}
      \`}
      \${standalone.length > 0 && h\`
        <div class="section-label">Standalone Tasks</div>
        \${standalone.map(task => h\`<\${TaskCard} key=\${task.id} task=\${task} selected=\${false} onClick=\${() => {}} />\`)}
      \`}
      \${epics.length === 0 && standalone.length === 0 && h\`
        <div class="empty">No epics or tasks found.</div>
      \`}
    </div>
  \`;
}

// ── Components ─────────────────────────────────────────────────────

function Badge({ phase }) {
  return h\`<span class=\${"badge badge-" + phase}>\${phase}</span>\`;
}

function ClaimTag({ name }) {
  return h\`<span class="claim-tag">\${name}</span>\`;
}

function ReviewBar({ summary }) {
  return h\`
    <div class="review-bar">
      <span class="review-chip">Total: \${summary.total}</span>
      <span class="review-chip">Open: \${summary.open}</span>
      <span class="review-chip">Fixed: \${summary.fixed}</span>
    </div>
  \`;
}

function EpicCard({ epic, onClick, dimmed }) {
  const phase = epic.derivedPhase || epic.phase;
  const total = epic.tasks ? epic.tasks.length : 0;
  const done = epic.tasks ? epic.tasks.filter(t => t.phase === "done").length : 0;
  return h\`
    <div class="card" onClick=\${onClick} style=\${dimmed ? {opacity: "0.6"} : {}}>
      <div class="card-header">
        <\${Badge} phase=\${phase} />
        <span class="card-id">\${epic.id}</span>
        <span class="card-title">\${epic.title}</span>
      </div>
      <div class="card-meta">\${done}/\${total} tasks done</div>
    </div>
  \`;
}

function TaskCard({ task, selected, onClick }) {
  const meta = [];
  if (task.branch) meta.push(task.branch);
  if (task.pr) meta.push("PR");
  if (task.dependencies && task.dependencies.length > 0) meta.push("deps: " + task.dependencies.join(", "));
  return h\`
    <div class=\${"card" + (selected ? " selected" : "")} onClick=\${onClick}>
      <div class="card-header">
        <\${Badge} phase=\${task.phase} />
        <span class="card-id">\${task.id}</span>
        <span class="card-title">\${task.title}</span>
        \${task.claimedBy && h\`<\${ClaimTag} name=\${task.claimedBy} />\`}
      </div>
      \${meta.length > 0 && h\`
        <div class="card-meta">
          \${meta.map((m, i) => h\`<span key=\${i}>\${i > 0 ? " · " : ""}\${task.pr && m === "PR" ? h\`<a class="link" href=\${task.pr} target="_blank">PR</a>\` : m}</span>\`)}
        </div>
      \`}
    </div>
  \`;
}

function TaskDetail({ task, planCache, loadPlan }) {
  if (!task) return null;

  React.useEffect(() => {
    if (task.plan && planCache[task.id] === undefined) {
      loadPlan(task.id);
    }
  }, [task.id, task.plan, planCache, loadPlan]);

  const planContent = planCache[task.id];

  return h\`
    <div class="detail">
      <h3>\${task.id}: \${task.title}</h3>
      <div style=\${css("margin-bottom:0.5rem")}>
        <\${Badge} phase=\${task.phase} />
        \${task.claimedBy && h\` <\${ClaimTag} name=\${"claimed by " + task.claimedBy} />\`}
      </div>
      \${task.description && h\`<p style=\${css("font-size:0.85rem;color:var(--text-muted);margin-bottom:0.5rem")}>\${task.description}</p>\`}
      \${task.branch && h\`<div class="detail-row"><span class="detail-label">Branch: </span>\${task.branch}</div>\`}
      \${task.worktree && h\`<div class="detail-row"><span class="detail-label">Worktree: </span>\${task.worktree}</div>\`}
      \${task.pr && h\`<div class="detail-row"><span class="detail-label">PR: </span><a class="link" href=\${task.pr} target="_blank">\${task.pr}</a></div>\`}
      \${task.qaResult && h\`<div class="detail-row"><span class="detail-label">QA: </span>\${task.qaResult.status} — \${task.qaResult.summary}</div>\`}
      \${task.reviewSummary && task.reviewSummary.total > 0 && h\`<\${ReviewBar} summary=\${task.reviewSummary} />\`}
      \${planContent && h\`
        <div style=\${css("margin-top:0.75rem")}>
          <h4 style=\${css("margin-bottom:0.25rem")}>Plan</h4>
          <div class="plan-content">\${planContent}</div>
        </div>
      \`}
    </div>
  \`;
}

// ── Mount ──────────────────────────────────────────────────────────

const root = createRoot(document.getElementById("root"));
root.render(h\`<\${App} />\`);
</script>
</body>
</html>`;
}
