/** Render a self-contained HTML dashboard for the state viewer. */
export function renderStatePage(serverPort: number, opts?: { all?: boolean }): string {
  const apiUrl = opts?.all ? `/api/state?all=true` : `/api/state`;
  const summaryUrl = opts?.all ? `/api/state/summary?all=true` : `/api/state/summary`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>gsag state</title>
<style>
  :root {
    --bg: #0a0a0a;
    --surface: #141414;
    --elevated: #1a1a1a;
    --hover: #222222;
    --border: rgba(255,255,255,0.08);
    --border-hover: rgba(255,255,255,0.15);
    --text: #fafafa;
    --text-secondary: #888888;
    --text-dim: #555555;
    --accent: #7c3aed;
    --accent-bg: rgba(124,58,237,0.15);
    --radius: 6px;
    --radius-sm: 4px;

    --phase-understand: hsl(210, 60%, 65%);
    --phase-design: hsl(270, 55%, 65%);
    --phase-implement: hsl(40, 70%, 60%);
    --phase-verify: hsl(25, 65%, 60%);
    --phase-ship: hsl(180, 50%, 55%);
    --phase-done: hsl(145, 45%, 55%);
    --phase-cancelled: hsl(0, 50%, 60%);
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
    color: var(--text);
    background: var(--bg);
    font-size: 14px;
  }
  .app { display: flex; min-height: 100vh; }
  .sidebar {
    width: 240px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    padding: 1rem 0.75rem;
    overflow-y: auto;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .sidebar-title {
    font-size: 0.9rem;
    color: var(--accent);
    font-weight: 700;
    padding: 0 0.25rem;
    margin-bottom: 0.5rem;
    letter-spacing: 0.02em;
  }
  .sidebar-search {
    width: 100%;
    padding: 0.4rem 0.5rem;
    background: var(--elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 0.8rem;
    outline: none;
    margin-bottom: 0.5rem;
  }
  .sidebar-search:focus { border-color: var(--accent); }
  .sidebar-search::placeholder { color: var(--text-dim); }
  .sidebar-group-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    padding: 0.5rem 0.25rem 0.25rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .sidebar-group-label:hover { color: var(--text-secondary); }
  .epic-nav {
    padding: 0.4rem 0.5rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    transition: background 0.15s;
    color: var(--text-secondary);
  }
  .epic-nav:hover { background: var(--hover); color: var(--text); }
  .epic-nav.active { background: var(--accent-bg); color: var(--text); }
  .epic-nav-id { font-family: monospace; font-size: 0.7rem; opacity: 0.6; }
  .epic-nav-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .epic-nav-progress { font-size: 0.7rem; color: var(--text-dim); white-space: nowrap; }
  .health-dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  }
  .health-green { background: var(--phase-done); }
  .health-yellow { background: var(--phase-implement); }
  .health-red { background: var(--phase-cancelled); }
  .main-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .repo-pills {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    flex-shrink: 0;
  }
  .repo-pill {
    padding: 0.3rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.8rem;
    cursor: pointer;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    white-space: nowrap;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .repo-pill:hover { border-color: var(--border-hover); color: var(--text); }
  .repo-pill.active { background: var(--accent-bg); border-color: var(--accent); color: var(--text); }
  .main-content {
    flex: 1;
    padding: 1.25rem 1.5rem;
    overflow-y: auto;
  }
  .summary-bar {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
  }
  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem 1rem;
    min-width: 100px;
  }
  .stat-number { font-size: 1.5rem; font-weight: 700; line-height: 1.2; }
  .stat-label { font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.03em; }
  .section-heading {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    margin: 1.25rem 0 0.5rem;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--border);
  }
  .epic-row {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    margin-bottom: 0.5rem;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .epic-row:hover { border-color: var(--border-hover); }
  .epic-row-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
  .epic-row-title { font-weight: 600; font-size: 0.9rem; }
  .epic-row-meta { font-size: 0.75rem; color: var(--text-secondary); }
  .progress-bar {
    display: flex;
    height: 4px;
    border-radius: 2px;
    overflow: hidden;
    gap: 1px;
    background: rgba(255,255,255,0.05);
    margin-top: 0.4rem;
  }
  .progress-segment { transition: width 0.3s ease; min-width: 2px; }
  .seg-understand { background: var(--phase-understand); }
  .seg-design { background: var(--phase-design); }
  .seg-implement { background: var(--phase-implement); }
  .seg-verify { background: var(--phase-verify); }
  .seg-ship { background: var(--phase-ship); }
  .seg-done { background: var(--phase-done); }
  .seg-cancelled { background: var(--phase-cancelled); }
  .phase-pill {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .pill-understand { background: hsla(210,60%,65%,0.15); color: var(--phase-understand); }
  .pill-design { background: hsla(270,55%,65%,0.15); color: var(--phase-design); }
  .pill-implement { background: hsla(40,70%,60%,0.15); color: var(--phase-implement); }
  .pill-verify { background: hsla(25,65%,60%,0.15); color: var(--phase-verify); }
  .pill-ship { background: hsla(180,50%,55%,0.15); color: var(--phase-ship); }
  .pill-done { background: hsla(145,45%,55%,0.15); color: var(--phase-done); }
  .pill-cancelled { background: hsla(0,50%,60%,0.15); color: var(--phase-cancelled); text-decoration: line-through; }
  .task-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.1s;
    font-size: 0.85rem;
  }
  .task-row:hover { background: var(--hover); }
  .task-row.selected { background: var(--accent-bg); }
  .task-row-id { font-family: monospace; font-size: 0.7rem; color: var(--text-dim); width: 2.5rem; flex-shrink: 0; }
  .task-row-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .task-row-branch { font-family: monospace; font-size: 0.7rem; color: var(--text-dim); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .task-row-pr { font-size: 0.7rem; }
  .claim-tag {
    font-size: 0.65rem;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    background: hsla(25,80%,55%,0.15);
    color: hsl(25,80%,65%);
    white-space: nowrap;
  }
  .task-row-time { font-size: 0.7rem; color: var(--text-dim); white-space: nowrap; }
  .detail-panel {
    width: 400px;
    background: var(--surface);
    border-left: 1px solid var(--border);
    padding: 1.25rem;
    overflow-y: auto;
    flex-shrink: 0;
    transition: margin-right 0.2s ease;
  }
  .detail-panel-hidden { display: none; }
  .detail-close {
    float: right;
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 1.2rem;
    line-height: 1;
    padding: 0.25rem;
  }
  .detail-close:hover { color: var(--text); }
  .detail-title { font-size: 1rem; font-weight: 600; margin-bottom: 0.75rem; padding-right: 2rem; }
  .detail-meta { font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem; }
  .detail-meta a { color: var(--accent); text-decoration: none; }
  .detail-meta a:hover { text-decoration: underline; }
  .detail-section { margin-top: 1rem; }
  .detail-section-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); margin-bottom: 0.5rem; }
  .phase-stepper {
    display: flex;
    align-items: center;
    gap: 0;
    margin: 0.75rem 0;
  }
  .stepper-node {
    width: 10px; height: 10px; border-radius: 50%;
    border: 2px solid var(--text-dim);
    flex-shrink: 0;
    position: relative;
  }
  .stepper-node.completed { background: var(--phase-done); border-color: var(--phase-done); }
  .stepper-node.current { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-bg); }
  .stepper-line { height: 2px; flex: 1; background: var(--border); min-width: 8px; }
  .stepper-line.completed { background: var(--phase-done); }
  .stepper-label { font-size: 0.6rem; color: var(--text-dim); position: absolute; top: 14px; left: 50%; transform: translateX(-50%); white-space: nowrap; }
  .stepper-label.current { color: var(--accent); }
  .review-item {
    background: var(--elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.4rem;
    font-size: 0.8rem;
  }
  .review-item-header { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.25rem; }
  .severity-CRITICAL { background: hsla(0,70%,55%,0.2); color: hsl(0,70%,65%); padding: 0.05rem 0.35rem; border-radius: 3px; font-size: 0.65rem; font-weight: 700; }
  .severity-HIGH { background: hsla(25,70%,55%,0.2); color: hsl(25,70%,65%); padding: 0.05rem 0.35rem; border-radius: 3px; font-size: 0.65rem; font-weight: 700; }
  .severity-MEDIUM { background: hsla(45,70%,55%,0.2); color: hsl(45,70%,65%); padding: 0.05rem 0.35rem; border-radius: 3px; font-size: 0.65rem; font-weight: 700; }
  .severity-LOW { background: hsla(210,40%,55%,0.2); color: hsl(210,40%,65%); padding: 0.05rem 0.35rem; border-radius: 3px; font-size: 0.65rem; font-weight: 700; }
  .review-file { font-family: monospace; font-size: 0.7rem; color: var(--text-dim); }
  .review-status { font-size: 0.65rem; padding: 0.05rem 0.3rem; border-radius: 3px; }
  .review-status-open { background: hsla(25,70%,55%,0.15); color: hsl(25,70%,65%); }
  .review-status-fixed { background: hsla(145,45%,55%,0.15); color: var(--phase-done); }
  .dep-pill {
    display: inline-block;
    padding: 0.1rem 0.4rem;
    border-radius: 9999px;
    font-size: 0.7rem;
    font-family: monospace;
    background: var(--elevated);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    margin-right: 0.25rem;
  }
  .dep-pill:hover { border-color: var(--accent); color: var(--accent); }
  .markdown { font-size: 0.85rem; line-height: 1.6; }
  .markdown h1, .markdown h2, .markdown h3 { margin: 0.75rem 0 0.25rem; }
  .markdown h1 { font-size: 1.1rem; }
  .markdown h2 { font-size: 0.95rem; }
  .markdown h3 { font-size: 0.85rem; }
  .markdown p { margin: 0.25rem 0; }
  .markdown code { background: var(--elevated); padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.8rem; }
  .markdown pre { background: var(--elevated); padding: 0.75rem; border-radius: var(--radius-sm); overflow-x: auto; margin: 0.5rem 0; }
  .markdown pre code { background: none; padding: 0; }
  .markdown ul, .markdown ol { padding-left: 1.5rem; margin: 0.25rem 0; }
  .markdown table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; font-size: 0.8rem; }
  .markdown th, .markdown td { border: 1px solid var(--border); padding: 0.3rem 0.5rem; text-align: left; }
  .markdown th { background: var(--elevated); }
  .plan-raw {
    background: var(--elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    font-size: 0.8rem;
    white-space: pre-wrap;
    font-family: "SF Mono", SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
    max-height: 400px;
    overflow-y: auto;
    line-height: 1.5;
  }
  .timeline { margin-top: 0.5rem; }
  .timeline-entry {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
  .timeline-entry-id { font-family: monospace; font-size: 0.7rem; color: var(--text-dim); width: 2.5rem; }
  .timeline-entry-time { font-size: 0.7rem; color: var(--text-dim); margin-left: auto; white-space: nowrap; }
  .ready-task {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.1s;
  }
  .ready-task:hover { background: var(--hover); }
  .empty { color: var(--text-dim); font-style: italic; padding: 2rem; text-align: center; }
  .refresh-bar {
    position: fixed;
    bottom: 0.75rem;
    right: 0.75rem;
    font-size: 0.65rem;
    color: var(--text-dim);
    background: var(--surface);
    padding: 0.2rem 0.4rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }
  .shortcut-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .shortcut-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    min-width: 300px;
  }
  .shortcut-row { display: flex; justify-content: space-between; padding: 0.3rem 0; font-size: 0.85rem; }
  .shortcut-key { font-family: monospace; color: var(--accent); }
  h2 { font-size: 1.2rem; margin-bottom: 0.5rem; font-weight: 600; }
  .submit-form { margin-bottom: 1.25rem; }
  .submit-textarea {
    width: 100%;
    min-height: 60px;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-family: inherit;
    font-size: 0.85rem;
    resize: vertical;
    outline: none;
  }
  .submit-textarea:focus { border-color: var(--accent); }
  .submit-textarea::placeholder { color: var(--text-dim); }
  .submit-btn {
    margin-top: 0.4rem;
    padding: 0.35rem 0.75rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    cursor: pointer;
    font-weight: 600;
  }
  .submit-btn:hover { opacity: 0.9; }
  .submit-btn:disabled { opacity: 0.4; cursor: default; }
  .verify-badge {
    display: inline-block;
    padding: 0.1rem 0.4rem;
    border-radius: var(--radius-sm);
    font-size: 0.65rem;
    font-weight: 600;
    background: hsla(25,65%,60%,0.2);
    color: var(--phase-verify);
    margin-left: 0.25rem;
  }
</style>
</head>
<body>
<div id="root"></div>
<script type="module">
import React from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";
import { marked } from "https://esm.sh/marked@12.0.1";
const h = htm.bind(React.createElement);

const API = "http://127.0.0.1:${serverPort}";
const API_STATE_URL = "${apiUrl}";
const API_SUMMARY_URL = "${summaryUrl}";
const PHASES = ["understand", "design", "implement", "verify", "ship", "done"];

function relTime(ts) {
  if (!ts) return "";
  const d = Date.now() - new Date(ts).getTime();
  if (d < 60000) return "just now";
  if (d < 3600000) return Math.floor(d / 60000) + "m ago";
  if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
  return Math.floor(d / 86400000) + "d ago";
}

function repoLabel(r) {
  // github.com/org/repo → org/repo
  const parts = r.split("/");
  if (parts.length >= 3) return parts.slice(1).join("/");
  return r;
}

function sanitizeHtml(html) {
  return html
    .replace(/<script\\b[^<]*(?:(?!<\\/script>)<[^<]*)*<\\/script>/gi, "")
    .replace(/<(iframe|object|embed|svg)\\b[^<]*(?:(?!<\\/\\1>)<[^<]*)*<\\/\\1>/gi, "")
    .replace(/<(iframe|object|embed|svg)\\b[^>]*\\/?>(?!.*<\\/\\1>)/gi, "")
    .replace(/\\s+on\\w+\\s*=\\s*["'][^"']*["']/gi, "")
    .replace(/\\s+on\\w+\\s*=\\s*[^\\s>"']+/gi, "")
    .replace(/\\bhref\\s*=\\s*["']\\s*javascript:[^"']*["']/gi, 'href="#"')
    .replace(/\\bhref\\s*=\\s*javascript:[^\\s>]*/gi, 'href="#"');
}

function renderMarkdown(content) {
  try { return sanitizeHtml(marked.parse(content)); } catch { return null; }
}

// ── App ────────────────────────────────────────────────────────────

function App() {
  const [state, setState] = React.useState(null);
  const [summary, setSummary] = React.useState(null);
  const [selectedRepo, setSelectedRepo] = React.useState(null);
  const [selectedEpic, setSelectedEpic] = React.useState(null);
  const [selectedTask, setSelectedTask] = React.useState(null);
  const [planCache, setPlanCache] = React.useState({});
  const [reviewCache, setReviewCache] = React.useState({});
  const [filter, setFilter] = React.useState("");
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const [lastUpdate, setLastUpdate] = React.useState(null);
  const [error, setError] = React.useState(null);

  const fetchData = React.useCallback(async () => {
    try {
      const [stateRes, summaryRes] = await Promise.all([
        fetch(API + API_STATE_URL),
        fetch(API + API_SUMMARY_URL),
      ]);
      const stateData = await stateRes.json();
      const summaryData = await summaryRes.json();
      setState(stateData);
      setSummary(summaryData);
      setLastUpdate(new Date());
      setError(null);
      // Seed selectedRepo from first load to prevent poll-driven repo switches
      if (Array.isArray(stateData.repos) && stateData.repos.length > 0) {
        setSelectedRepo(prev => prev || stateData.repos[0].repo);
      }
    } catch (e) {
      setError(e.message);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  const loadPlan = React.useCallback(async (id) => {
    if (planCache[id] !== undefined) return;
    try {
      const res = await fetch(API + "/api/plan/" + encodeURIComponent(id));
      const data = await res.json();
      setPlanCache(prev => ({ ...prev, [id]: data.content || null }));
    } catch {}
  }, [planCache]);

  const loadReviews = React.useCallback(async (taskId) => {
    if (reviewCache[taskId] !== undefined) return;
    try {
      const res = await fetch(API + "/api/task/" + encodeURIComponent(taskId) + "/reviews");
      const data = await res.json();
      setReviewCache(prev => ({ ...prev, [taskId]: data }));
    } catch {}
  }, [reviewCache]);

  const selectEpic = React.useCallback((id) => {
    setSelectedEpic(prev => prev === id ? null : id);
    setSelectedTask(null);
  }, []);

  const selectTask = React.useCallback((id) => {
    setSelectedTask(prev => prev === id ? null : id);
  }, []);

  const closeDetail = React.useCallback(() => setSelectedTask(null), []);

  // Keyboard navigation
  React.useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "?") { setShowShortcuts(prev => !prev); e.preventDefault(); }
      if (e.key === "Escape") {
        if (showShortcuts) setShowShortcuts(false);
        else if (selectedTask) setSelectedTask(null);
        else if (selectedEpic) setSelectedEpic(null);
      }
      if (e.key === "/") {
        const input = document.querySelector(".sidebar-search");
        if (input) { input.focus(); e.preventDefault(); }
      }
      if (e.key === "j" || e.key === "k") {
        if (!state) return;
        const isMulti = Array.isArray(state.repos);
        const activeRepo = selectedRepo || (isMulti && state.repos.length > 0 ? state.repos[0].repo : null);
        const repoData = isMulti ? state.repos.find(r => r.repo === activeRepo) : state;
        const epics = repoData ? (repoData.epics || []) : [];
        if (epics.length === 0) return;
        const ids = epics.map(ep => ep.id);
        const idx = selectedEpic ? ids.indexOf(selectedEpic) : -1;
        const next = e.key === "j" ? Math.min(idx + 1, ids.length - 1) : Math.max(idx - 1, 0);
        setSelectedEpic(ids[next]);
        setSelectedTask(null);
      }
      // Number keys for repo switching
      if (e.key >= "1" && e.key <= "9" && Array.isArray(state?.repos)) {
        const idx = parseInt(e.key) - 1;
        if (idx < state.repos.length) {
          setSelectedRepo(state.repos[idx].repo);
          setSelectedEpic(null);
          setSelectedTask(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state, selectedRepo, selectedEpic, selectedTask, showShortcuts]);

  if (!state) {
    return h\`<div class="app"><div class="sidebar"><div class="sidebar-title">gsag state</div></div><div class="main-area"><div class="main-content"><div class="empty">Loading...</div></div></div></div>\`;
  }

  const isMultiRepo = Array.isArray(state.repos);
  let epics, standalone, transitions, activeRepoName;

  if (isMultiRepo) {
    const activeRepo = selectedRepo || (state.repos.length > 0 ? state.repos[0].repo : null);
    const repoData = state.repos.find(r => r.repo === activeRepo);
    epics = repoData ? repoData.epics : [];
    standalone = repoData ? repoData.standalone : [];
    transitions = state.recentTransitions || [];
    activeRepoName = activeRepo ? repoLabel(activeRepo) : null;
  } else {
    epics = state.epics || [];
    standalone = state.standalone || [];
    transitions = state.recentTransitions || [];
    activeRepoName = null;
  }

  // Apply filter
  const filteredEpics = filter
    ? epics.filter(e => e.id.includes(filter) || e.title.toLowerCase().includes(filter.toLowerCase()))
    : epics;

  return h\`
    <div class="app">
      <\${Sidebar}
        epics=\${filteredEpics}
        standalone=\${standalone}
        selectedEpic=\${selectedEpic}
        onSelectEpic=\${selectEpic}
        filter=\${filter}
        onFilter=\${setFilter}
        repoName=\${activeRepoName}
      />
      <div class="main-area">
        \${isMultiRepo && state.repos.length > 1 && h\`
          <\${RepoPills}
            repos=\${state.repos}
            selected=\${selectedRepo || state.repos[0].repo}
            onSelect=\${(r) => { setSelectedRepo(r); setSelectedEpic(null); setSelectedTask(null); }}
          />
        \`}
        <div class="main-content">
          \${summary && h\`<\${SummaryBar} summary=\${summary} />\`}
          \${selectedEpic
            ? h\`<\${EpicDetail}
                epic=\${filteredEpics.find(e => e.id === selectedEpic)}
                selectedTask=\${selectedTask}
                onSelectTask=\${selectTask}
              />\`
            : h\`<\${DashboardView}
                epics=\${filteredEpics}
                standalone=\${standalone}
                transitions=\${transitions}
                onSelectEpic=\${selectEpic}
                onRefresh=\${fetchData}
              />\`
          }
        </div>
      </div>
      \${selectedTask && h\`<\${TaskDetailPanel}
        task=\${findTask(filteredEpics, standalone, selectedTask)}
        onClose=\${closeDetail}
        planCache=\${planCache}
        loadPlan=\${loadPlan}
        reviewCache=\${reviewCache}
        loadReviews=\${loadReviews}
        onSelectTask=\${selectTask}
      />\`}
    </div>
    <div class="refresh-bar">
      \${error ? "Error: " + error : lastUpdate ? "Updated " + relTime(lastUpdate.toISOString()) : "Loading..."}
    </div>
    \${showShortcuts && h\`<\${ShortcutOverlay} onClose=\${() => setShowShortcuts(false)} />\`}
  \`;
}

function findTask(epics, standalone, taskId) {
  for (const e of epics) {
    const t = (e.tasks || []).find(t => t.id === taskId);
    if (t) return t;
  }
  return standalone.find(t => t.id === taskId) || null;
}

// ── Repo Pills ────────────────────────────────────────────────────

function RepoPills({ repos, selected, onSelect }) {
  return h\`
    <div class="repo-pills">
      \${repos.map((r, i) => h\`
        <div
          key=\${r.repo}
          class=\${"repo-pill" + (selected === r.repo ? " active" : "")}
          onClick=\${() => onSelect(r.repo)}
        >
          <span class=\${"health-dot " + repoHealth(r)}></span>
          \${repoLabel(r.repo)}
          <span style=\${{fontSize:"0.7rem",opacity:0.5}}>\${i+1}</span>
        </div>
      \`)}
    </div>
  \`;
}

function repoHealth(repoData) {
  const epics = repoData.epics || [];
  const hasActive = epics.some(e => {
    const p = e.derivedPhase || e.phase;
    return p !== "done" && p !== "cancelled";
  });
  if (!hasActive) return "health-green";
  // Check if any task is blocked (non-terminal with unmet deps — approximate from data)
  const tasks = epics.flatMap(e => e.tasks || []);
  const hasImplement = tasks.some(t => t.phase === "implement");
  return hasImplement ? "health-yellow" : "health-green";
}

// ── Summary Bar ───────────────────────────────────────────────────

function SummaryBar({ summary }) {
  return h\`
    <div class="summary-bar">
      <\${StatCard} number=\${summary.activeEpics + "/" + summary.totalEpics} label="Epics" />
      <\${StatCard} number=\${summary.activeTasks} label="Active Tasks" />
      <\${StatCard} number=\${summary.readyTasks} label="Ready" />
      <\${StatCard} number=\${summary.blockedTasks} label="Blocked" />
      <\${StatCard} number=\${summary.openReviews} label="Open Reviews" />
    </div>
  \`;
}

function StatCard({ number, label }) {
  return h\`<div class="stat-card"><div class="stat-number">\${number}</div><div class="stat-label">\${label}</div></div>\`;
}

// ── Sidebar ───────────────────────────────────────────────────────

function Sidebar({ epics, standalone, selectedEpic, onSelectEpic, filter, onFilter, repoName }) {
  const [showCompleted, setShowCompleted] = React.useState(false);

  const active = epics.filter(e => {
    const p = e.derivedPhase || e.phase;
    return p !== "done" && p !== "cancelled";
  });
  const completed = epics.filter(e => {
    const p = e.derivedPhase || e.phase;
    return p === "done" || p === "cancelled";
  });

  return h\`
    <div class="sidebar">
      <div class="sidebar-title">gsag state</div>
      \${repoName && h\`<div style=\${{fontSize:"0.75rem",color:"#888",marginBottom:"0.75rem",padding:"0.25rem 0.4rem",background:"rgba(255,255,255,0.05)",borderRadius:"4px"}}>\${repoName}</div>\`}
      <\${SidebarSearch} value=\${filter} onChange=\${onFilter} />
      \${active.length > 0 && h\`
        <div class="sidebar-group-label">Active (\${active.length})</div>
        \${active.map(epic => h\`<\${EpicNavItem} key=\${epic.id} epic=\${epic} selected=\${selectedEpic === epic.id} onClick=\${() => onSelectEpic(epic.id)} />\`)}
      \`}
      \${completed.length > 0 && h\`
        <div class="sidebar-group-label" onClick=\${() => setShowCompleted(p => !p)}>
          \${showCompleted ? "▾" : "▸"} Completed (\${completed.length})
        </div>
        \${showCompleted && completed.map(epic => h\`<\${EpicNavItem} key=\${epic.id} epic=\${epic} selected=\${selectedEpic === epic.id} onClick=\${() => onSelectEpic(epic.id)} />\`)}
      \`}
      \${standalone.length > 0 && h\`
        <div class="sidebar-group-label">Standalone (\${standalone.length})</div>
      \`}
    </div>
  \`;
}

function SidebarSearch({ value, onChange }) {
  return h\`<input class="sidebar-search" type="text" placeholder="Filter epics... (/)" value=\${value} onInput=\${(e) => onChange(e.target.value)} />\`;
}

function EpicNavItem({ epic, selected, onClick }) {
  const phase = epic.derivedPhase || epic.phase;
  const total = epic.tasks ? epic.tasks.length : 0;
  const done = epic.tasks ? epic.tasks.filter(t => t.phase === "done").length : 0;
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  return h\`
    <div class=\${"epic-nav" + (selected ? " active" : "")} onClick=\${onClick}>
      <span class=\${"health-dot " + (phase === "done" ? "health-green" : phase === "cancelled" ? "health-red" : "health-yellow")}></span>
      <span class="epic-nav-id">\${epic.id}</span>
      <span class="epic-nav-title">\${epic.title}</span>
      <span class="epic-nav-progress">\${pct}%</span>
    </div>
  \`;
}

// ── Submit Form ──────────────────────────────────────────────────

function SubmitForm({ onCreated }) {
  const [text, setText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const lines = trimmed.split("\\n");
      const title = lines[0];
      const description = lines.slice(1).join("\\n").trim();
      const body = { title };
      if (description) body.description = description;
      const res = await fetch(API + "/api/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setText("");
        if (onCreated) onCreated();
      }
    } catch {}
    setSubmitting(false);
  };

  return h\`
    <div class="submit-form">
      <textarea
        class="submit-textarea"
        placeholder="Describe work to be done... (first line = title)"
        value=\${text}
        onInput=\${(e) => setText(e.target.value)}
        onKeyDown=\${(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
      />
      <button class="submit-btn" onClick=\${handleSubmit} disabled=\${submitting || !text.trim()}>
        \${submitting ? "Submitting..." : "Submit"}
      </button>
    </div>
  \`;
}

// ── Dashboard View ────────────────────────────────────────────────

function DashboardView({ epics, standalone, transitions, onSelectEpic, onRefresh }) {
  const active = epics.filter(e => {
    const p = e.derivedPhase || e.phase;
    return p !== "done" && p !== "cancelled";
  });
  const completed = epics.filter(e => {
    const p = e.derivedPhase || e.phase;
    return p === "done" || p === "cancelled";
  });

  // Find ready tasks (non-terminal tasks with no unmet deps — approximate from task data)
  const allTasks = epics.flatMap(e => (e.tasks || []).map(t => ({ ...t, epicTitle: e.title }))).concat(standalone.map(t => ({ ...t, epicTitle: null })));
  const doneIds = new Set(allTasks.filter(t => t.phase === "done").map(t => t.id));
  const readyTasks = allTasks.filter(t => {
    if (t.phase === "done" || t.phase === "cancelled") return false;
    const deps = t.dependencies || [];
    return deps.every(d => doneIds.has(d));
  });

  return h\`
    <div>
      <\${SubmitForm} onCreated=\${onRefresh} />
      \${active.length > 0 && h\`
        <div class="section-heading">Active Epics</div>
        \${active.map(epic => h\`<\${EpicRow} key=\${epic.id} epic=\${epic} onClick=\${() => onSelectEpic(epic.id)} />\`)}
      \`}
      \${readyTasks.length > 0 && h\`
        <\${ReadySection} tasks=\${readyTasks} />
      \`}
      \${transitions.length > 0 && h\`
        <\${Timeline} entries=\${transitions.slice(0, 10)} />
      \`}
      \${completed.length > 0 && h\`
        <div class="section-heading">Completed (\${completed.length})</div>
        \${completed.map(epic => h\`<\${EpicRow} key=\${epic.id} epic=\${epic} onClick=\${() => onSelectEpic(epic.id)} dimmed />\`)}
      \`}
      \${epics.length === 0 && standalone.length === 0 && h\`<div class="empty">No epics or tasks found.</div>\`}
    </div>
  \`;
}

function EpicRow({ epic, onClick, dimmed }) {
  const total = epic.tasks ? epic.tasks.length : 0;
  const done = epic.tasks ? epic.tasks.filter(t => t.phase === "done").length : 0;
  return h\`
    <div class="epic-row" onClick=\${onClick} style=\${dimmed ? {opacity:0.5} : {}}>
      <div class="epic-row-header">
        <\${PhasePill} phase=\${epic.derivedPhase || epic.phase} />
        <span style=\${{fontFamily:"monospace",fontSize:"0.75rem",opacity:0.5}}>\${epic.id}</span>
        <span class="epic-row-title">\${epic.title}</span>
        <span class="epic-row-meta">\${done}/\${total} done</span>
      </div>
      \${total > 0 && h\`<\${SegmentedProgress} tasks=\${epic.tasks} />\`}
    </div>
  \`;
}

function SegmentedProgress({ tasks }) {
  if (!tasks || tasks.length === 0) return null;
  const counts = {};
  tasks.forEach(t => { counts[t.phase] = (counts[t.phase] || 0) + 1; });
  const total = tasks.length;
  const allPhases = [...PHASES, "cancelled"];
  return h\`
    <div class="progress-bar">
      \${allPhases.filter(p => counts[p]).map(p => h\`
        <div key=\${p} class=\${"progress-segment seg-" + p} style=\${{width: (counts[p] / total * 100) + "%"}} title=\${counts[p] + " " + p}></div>
      \`)}
    </div>
  \`;
}

function ReadySection({ tasks }) {
  return h\`
    <div class="section-heading">Ready to Work (\${tasks.length})</div>
    \${tasks.slice(0, 8).map(t => h\`
      <div class="ready-task" key=\${t.id}>
        <\${PhasePill} phase=\${t.phase} />
        <span style=\${{fontFamily:"monospace",fontSize:"0.7rem",opacity:0.5}}>\${t.id}</span>
        <span>\${t.title}</span>
        \${t.epicTitle && h\`<span style=\${{fontSize:"0.7rem",color:"var(--text-dim)"}}>\${t.epicTitle}</span>\`}
      </div>
    \`)}
  \`;
}

function Timeline({ entries }) {
  return h\`
    <div class="section-heading">Recent Activity</div>
    <div class="timeline">
      \${entries.map((e, i) => h\`<\${TimelineEntry} key=\${i} entry=\${e} />\`)}
    </div>
  \`;
}

function TimelineEntry({ entry }) {
  return h\`
    <div class="timeline-entry">
      <span class="timeline-entry-id">\${entry.taskId}</span>
      <\${PhasePill} phase=\${entry.phase} />
      <span>\${entry.actor}</span>
      <span class="timeline-entry-time">\${relTime(entry.timestamp)}</span>
    </div>
  \`;
}

// ── Epic Detail ───────────────────────────────────────────────────

function EpicDetail({ epic, selectedTask, onSelectTask }) {
  const [showDone, setShowDone] = React.useState(false);
  if (!epic) return h\`<div class="empty">Epic not found</div>\`;

  const tasks = epic.tasks || [];
  const active = tasks.filter(t => t.phase !== "done" && t.phase !== "cancelled");
  const done = tasks.filter(t => t.phase === "done");
  const cancelled = tasks.filter(t => t.phase === "cancelled");

  // Sort active by phase order
  active.sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));

  return h\`
    <div>
      <h2>\${epic.id}: \${epic.title}</h2>
      \${epic.description && h\`<p style=\${{color:"var(--text-secondary)",marginBottom:"0.5rem",fontSize:"0.85rem"}}>\${epic.description}</p>\`}
      <\${PhaseStepper} currentPhase=\${epic.derivedPhase || epic.phase} />
      \${epic.reviewSummary && epic.reviewSummary.total > 0 && h\`
        <div style=\${{display:"flex",gap:"0.5rem",marginBottom:"0.75rem",fontSize:"0.8rem"}}>
          <span>Reviews: \${epic.reviewSummary.total} total</span>
          <span style=\${{color:"var(--phase-implement)"}}>· \${epic.reviewSummary.open} open</span>
          <span style=\${{color:"var(--phase-done)"}}>· \${epic.reviewSummary.fixed} fixed</span>
        </div>
      \`}
      \${tasks.length > 0 && h\`<\${SegmentedProgress} tasks=\${tasks} />\`}
      <div style=\${{marginTop:"0.75rem"}}>
        \${active.map(task => h\`<\${TaskRow} key=\${task.id} task=\${task} selected=\${selectedTask === task.id} onClick=\${() => onSelectTask(task.id)} />\`)}
        \${(done.length > 0 || cancelled.length > 0) && h\`
          <div class="section-heading" style=\${{cursor:"pointer"}} onClick=\${() => setShowDone(p => !p)}>
            \${showDone ? "▾" : "▸"} Completed (\${done.length + cancelled.length})
          </div>
          \${showDone && [...done, ...cancelled].map(task => h\`<\${TaskRow} key=\${task.id} task=\${task} selected=\${selectedTask === task.id} onClick=\${() => onSelectTask(task.id)} dimmed />\`)}
        \`}
      </div>
    </div>
  \`;
}

function TaskRow({ task, selected, onClick, dimmed }) {
  return h\`
    <div class=\${"task-row" + (selected ? " selected" : "")} onClick=\${onClick} style=\${dimmed ? {opacity:0.5} : {}}>
      <\${PhasePill} phase=\${task.phase} />
      <span class="task-row-id">\${task.id}</span>
      <span class="task-row-title">\${task.title}</span>
      \${task.phase === "verify" && h\`<span class="verify-badge">awaiting review</span>\`}
      \${task.claimedBy && h\`<span class="claim-tag">\${task.claimedBy}</span>\`}
      \${task.branch && h\`<span class="task-row-branch">\${task.branch}</span>\`}
      \${task.pr && h\`<a class="task-row-pr" href=\${task.pr} target="_blank" onClick=\${(e) => e.stopPropagation()} style=\${{color:"var(--phase-done)"}}>PR</a>\`}
    </div>
  \`;
}

// ── Phase Components ──────────────────────────────────────────────

function PhasePill({ phase }) {
  return h\`<span class=\${"phase-pill pill-" + phase}>\${phase}</span>\`;
}

function PhaseStepper({ currentPhase }) {
  const idx = PHASES.indexOf(currentPhase);
  return h\`
    <div class="phase-stepper" style=\${{marginBottom:"0.75rem"}}>
      \${PHASES.map((p, i) => h\`
        <\${React.Fragment} key=\${p}>
          \${i > 0 && h\`<div class=\${"stepper-line" + (i <= idx ? " completed" : "")}></div>\`}
          <div style=\${{position:"relative"}}>
            <div class=\${"stepper-node" + (i < idx ? " completed" : "") + (i === idx ? " current" : "")}></div>
            <span class=\${"stepper-label" + (i === idx ? " current" : "")}>\${p}</span>
          </div>
        </\${React.Fragment}>
      \`)}
    </div>
  \`;
}

// ── Task Detail Panel ─────────────────────────────────────────────

function TaskDetailPanel({ task, onClose, planCache, loadPlan, reviewCache, loadReviews, onSelectTask }) {
  if (!task) return null;

  React.useEffect(() => {
    if (task.plan && planCache[task.id] === undefined) loadPlan(task.id);
  }, [task.id, task.plan, planCache, loadPlan]);

  React.useEffect(() => {
    if (reviewCache[task.id] === undefined) loadReviews(task.id);
  }, [task.id, reviewCache, loadReviews]);

  const planContent = planCache[task.id];
  const reviews = reviewCache[task.id] || [];
  const renderedPlan = planContent ? renderMarkdown(planContent) : null;

  return h\`
    <div class="detail-panel">
      <button class="detail-close" onClick=\${onClose}>×</button>
      <div class="detail-title">\${task.id}: \${task.title}</div>
      <\${PhaseStepper} currentPhase=\${task.phase} />
      \${task.claimedBy && h\`<div class="detail-meta"><span class="claim-tag">\${task.claimedBy}</span></div>\`}
      \${task.description && h\`<div class="detail-meta">\${task.description}</div>\`}
      \${task.branch && h\`<div class="detail-meta"><strong>Branch:</strong> \${task.branch}</div>\`}
      \${task.worktree && h\`<div class="detail-meta"><strong>Worktree:</strong> \${task.worktree}</div>\`}
      \${task.pr && h\`<div class="detail-meta"><strong>PR:</strong> <a href=\${task.pr} target="_blank">\${task.pr}</a></div>\`}
      \${task.qaResult && h\`<div class="detail-meta"><strong>QA:</strong> \${task.qaResult.status} — \${task.qaResult.summary}</div>\`}
      \${task.dependencies && task.dependencies.length > 0 && h\`
        <div class="detail-section">
          <div class="detail-section-title">Dependencies</div>
          <\${DependencyPills} deps=\${task.dependencies} onNavigate=\${onSelectTask} />
        </div>
      \`}
      \${reviews.length > 0 && h\`
        <div class="detail-section">
          <div class="detail-section-title">Review Items (\${reviews.length})</div>
          <\${ReviewItemList} items=\${reviews} />
        </div>
      \`}
      \${planContent && h\`
        <div class="detail-section">
          <div class="detail-section-title">Plan</div>
          \${renderedPlan
            ? h\`<div class="markdown" dangerouslySetInnerHTML=\${{__html: renderedPlan}}></div>\`
            : h\`<div class="plan-raw">\${planContent}</div>\`
          }
        </div>
      \`}
    </div>
  \`;
}

function ReviewItemList({ items }) {
  return h\`
    <div>
      \${items.map((item, i) => h\`<\${ReviewItemCard} key=\${item.id || i} item=\${item} />\`)}
    </div>
  \`;
}

function ReviewItemCard({ item }) {
  return h\`
    <div class="review-item">
      <div class="review-item-header">
        \${item.severity && h\`<span class=\${"severity-" + item.severity}>\${item.severity}</span>\`}
        <span class=\${"review-status review-status-" + item.status}>\${item.status}</span>
        \${item.filePath && h\`<span class="review-file">\${item.filePath}\${item.lineStart ? ":" + item.lineStart : ""}</span>\`}
      </div>
      <div>\${item.body}</div>
    </div>
  \`;
}

function DependencyPills({ deps, onNavigate }) {
  return h\`
    <div>
      \${deps.map(d => h\`<span key=\${d} class="dep-pill" onClick=\${() => onNavigate(d)}>\${d}</span>\`)}
    </div>
  \`;
}

// ── Shortcut Overlay ──────────────────────────────────────────────

function ShortcutOverlay({ onClose }) {
  return h\`
    <div class="shortcut-overlay" onClick=\${onClose}>
      <div class="shortcut-box" onClick=\${(e) => e.stopPropagation()}>
        <h2>Keyboard Shortcuts</h2>
        <\${ShortcutRow} key_="j / k" desc="Navigate epics" />
        <\${ShortcutRow} key_="Enter" desc="Select epic" />
        <\${ShortcutRow} key_="Escape" desc="Close / go back" />
        <\${ShortcutRow} key_="/" desc="Focus search" />
        <\${ShortcutRow} key_="1-9" desc="Switch repo" />
        <\${ShortcutRow} key_="?" desc="Toggle shortcuts" />
      </div>
    </div>
  \`;
}

function ShortcutRow({ key_, desc }) {
  return h\`<div class="shortcut-row"><span class="shortcut-key">\${key_}</span><span>\${desc}</span></div>\`;
}

// ── Mount ──────────────────────────────────────────────────────────

const root = createRoot(document.getElementById("root"));
root.render(h\`<\${App} />\`);
</script>
</body>
</html>`;
}
