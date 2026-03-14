import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "smart-search.openSearch",
    () => {
      const panel = vscode.window.createWebviewPanel(
        "smartSearch",
        "Smart Search",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );

      panel.webview.html = getWebviewContent();
      sendWorkspaceInfo(panel);

      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        sendWorkspaceInfo(panel);
      });

      panel.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {
            case "webviewReady":
              sendWorkspaceInfo(panel);
              break;

            case "search":
              await handleSearch(panel, {
                query:          message.query,
                searchType:     message.searchType,
                matchCase:      message.matchCase,
                matchWholeWord: message.matchWholeWord,
                useRegex:       message.useRegex,
                filesToInclude: message.filesToInclude,
                filesToExclude: message.filesToExclude,
              });
              break;

            case "replaceAll":
              await handleReplaceAll(panel, {
                query:          message.query,
                replacement:    message.replacement,
                matchCase:      message.matchCase,
                matchWholeWord: message.matchWholeWord,
                useRegex:       message.useRegex,
                filesToInclude: message.filesToInclude,
                filesToExclude: message.filesToExclude,
              });
              break;

            default:
              console.log("Unknown command:", message.command);
          }
        },
        undefined,
        context.subscriptions,
      );
    },
  );

  context.subscriptions.push(disposable);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendWorkspaceInfo(panel: vscode.WebviewPanel) {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    panel.webview.postMessage({
      command:       "workspaceInfo",
      workspacePath: folders[0].uri.fsPath,
      workspaceName: folders[0].name,
    });
  } else {
    panel.webview.postMessage({ command: "noWorkspace" });
  }
}

interface SearchOptions {
  query:          string;
  searchType:     string;
  matchCase:      boolean;
  matchWholeWord: boolean;
  useRegex:       boolean;
  filesToInclude: string;
  filesToExclude: string;
}

interface ReplaceOptions {
  query:          string;
  replacement:    string;
  matchCase:      boolean;
  matchWholeWord: boolean;
  useRegex:       boolean;
  filesToInclude: string;
  filesToExclude: string;
}

async function handleSearch(panel: vscode.WebviewPanel, opts: SearchOptions) {
  try {
    panel.webview.postMessage({ command: "searchLoading" });

    const workspacePath = getWorkspacePath();

    const response = await fetch("http://localhost:8000/search", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ workspacePath, ...opts }),
    });

    const data = await response.json() as any;

    if (!response.ok && !data.unsupported) {
      throw new Error(data.error || `HTTP error: ${response.status}`);
    }

    panel.webview.postMessage({ command: "searchResult", data });
  } catch (err) {
    panel.webview.postMessage({
      command: "searchError",
      error:   err instanceof Error ? err.message : "Backend not running on localhost:8000",
    });
  }
}

async function handleReplaceAll(panel: vscode.WebviewPanel, opts: ReplaceOptions) {
  try {
    panel.webview.postMessage({ command: "replaceLoading" });

    const workspacePath = getWorkspacePath();

    const response = await fetch("http://localhost:8000/replace", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ workspacePath, ...opts }),
    });

    const data = await response.json() as any;

    if (!response.ok) {
      throw new Error(data.error || `HTTP error: ${response.status}`);
    }

    panel.webview.postMessage({ command: "replaceResult", data });
  } catch (err) {
    panel.webview.postMessage({
      command: "replaceError",
      error:   err instanceof Error ? err.message : "Backend not running on localhost:8000",
    });
  }
}

function getWorkspacePath(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("No folder/workspace is open. Please open a folder first.");
  }
  return folders[0].uri.fsPath;
}

// ── Webview HTML ──────────────────────────────────────────────────────────────

function getWebviewContent(): string {
  return /* html */`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           style-src 'unsafe-inline';
           script-src 'unsafe-inline';
           connect-src http://localhost:8000;">
<style>

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  padding: 14px 16px 20px;
}

/* ── Title ───────────────────────────────────────────────────────── */
h2 {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.6;
  margin-bottom: 10px;
}

/* ── Workspace bar ───────────────────────────────────────────────── */
.workspace-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  padding: 4px 8px;
  margin-bottom: 10px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
}
.ws-label { white-space: nowrap; font-weight: 600; }
.ws-name  { color: var(--vscode-foreground); font-weight: 600; white-space: nowrap; }
.ws-path  { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.55; }

.no-folder-warn {
  display: none;
  margin-bottom: 10px;
  padding: 7px 10px;
  background: var(--vscode-inputValidation-warningBackground);
  border: 1px solid var(--vscode-inputValidation-warningBorder);
  border-radius: 2px;
  font-size: 12px;
}

/* ── Tabs ────────────────────────────────────────────────────────── */
.type-tabs {
  display: flex;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--vscode-editorIndentGuide-background, rgba(128,128,128,0.2));
}
.type-tab {
  padding: 5px 14px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  transition: color 0.12s, border-color 0.12s;
}
.type-tab:hover { color: var(--vscode-foreground); }
.type-tab.active {
  color: var(--vscode-foreground);
  border-bottom-color: var(--vscode-focusBorder, #007acc);
  font-weight: 600;
}
.type-tab.ai-tab.active { border-bottom-color: #a855f7; color: #a855f7; }

.ai-badge {
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(168,85,247,0.15);
  color: #a855f7;
  margin-left: 4px;
  vertical-align: middle;
  letter-spacing: 0.04em;
}

/* ── Search panels ───────────────────────────────────────────────── */
#normalPanel, #aiPanel { display: none; }
#normalPanel.visible, #aiPanel.visible { display: block; }

/* ── Input rows layout ───────────────────────────────────────────── */
/*
  VSCode-style: a narrow chevron column on the left, inputs on the right.
  The chevron expands/collapses the replace row.
*/
.input-section {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-bottom: 6px;
}

.expand-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 3px;
  flex-shrink: 0;
}

.expand-btn {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  color: var(--vscode-foreground);
  font-size: 14px;
  opacity: 0.5;
  transition: opacity 0.1s, transform 0.15s;
  transform: rotate(0deg);
  user-select: none;
  padding: 0;
  line-height: 1;
}
.expand-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15)); }
.expand-btn.open  { transform: rotate(90deg); opacity: 0.9; }

.input-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* ── A single input row (search or replace) ──────────────────────── */
.input-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Text inputs */
.input-row input[type="text"] {
  flex: 1;
  min-width: 0;
  padding: 5px 7px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  font-family: inherit;
  font-size: inherit;
  outline: none;
}
.input-row input[type="text"]:focus {
  border-color: var(--vscode-focusBorder);
}

/* ── Toggle buttons (Aa / W / .*) ────────────────────────────────── */
.toggle-btns {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}
.toggle-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--vscode-foreground);
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  opacity: 0.5;
  transition: opacity 0.1s, background 0.1s, border-color 0.1s;
  user-select: none;
  font-family: inherit;
  position: relative;
}
.toggle-btn:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15));
}
.toggle-btn.active {
  opacity: 1;
  background: var(--vscode-inputOption-activeBackground, rgba(0,120,212,0.2));
  border-color: var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder));
}
/* Tooltip via CSS */
.toggle-btn::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 5px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--vscode-editorHoverWidget-background, #252526);
  border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
  color: var(--vscode-editorHoverWidget-foreground, #ccc);
  padding: 2px 7px;
  border-radius: 2px;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 400;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.1s;
  z-index: 50;
}
.toggle-btn:hover::after { opacity: 1; }

/* ── Primary action button (Search) ─────────────────────────────── */
.btn-primary {
  padding: 5px 12px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 2px;
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-primary:hover  { background: var(--vscode-button-hoverBackground); }
.btn-primary:active { opacity: 0.85; }

/* ── Secondary action button (Replace / Replace All) ────────────── */
.btn-secondary {
  padding: 5px 10px;
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  border: none;
  border-radius: 2px;
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-secondary:hover  { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3)); }
.btn-secondary:active { opacity: 0.85; }

/* Replace row hidden by default */
.replace-row { display: none; }
.replace-row.visible { display: flex; }

/* ── File filter row ─────────────────────────────────────────────── */
.filter-row {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}
.filter-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.filter-field label {
  font-size: 10px;
  opacity: 0.6;
  font-weight: 500;
}
.filter-field input {
  padding: 4px 7px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  font-family: inherit;
  font-size: 11px;
  outline: none;
}
.filter-field input:focus { border-color: var(--vscode-focusBorder); }
.filter-field input::placeholder { opacity: 0.5; }

/* ── AI panel ────────────────────────────────────────────────────── */
.ai-hint {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 8px;
  padding: 6px 8px;
  background: rgba(168,85,247,0.07);
  border-left: 2px solid #a855f7;
  border-radius: 0 2px 2px 0;
}

/* ── Results area ────────────────────────────────────────────────── */
#result { margin-top: 14px; }

.status-line {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 8px;
}
.status-line strong { color: var(--vscode-foreground); }

.loading-text {
  font-style: italic;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.error-msg {
  padding: 8px 10px;
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: 2px;
  font-size: 12px;
  color: var(--vscode-errorForeground, #f44);
}

.success-msg {
  padding: 8px 10px;
  background: rgba(100,200,100,0.08);
  border: 1px solid rgba(100,200,100,0.3);
  border-radius: 2px;
  font-size: 12px;
}

.unsupported-msg {
  padding: 10px 12px;
  background: var(--vscode-inputValidation-warningBackground, rgba(255,180,0,0.08));
  border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(255,180,0,0.3));
  border-radius: 2px;
  font-size: 12px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.unsupported-msg .icon { font-size: 14px; flex-shrink: 0; }
.unsupported-msg .text strong { display: block; margin-bottom: 3px; }

/* Result groups */
.result-list { display: flex; flex-direction: column; }
.result-group { margin-bottom: 8px; }

.result-file {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 6px;
  background: var(--vscode-sideBarSectionHeader-background, rgba(128,128,128,0.1));
  border-left: 2px solid var(--vscode-focusBorder, #007acc);
  word-break: break-all;
  border-radius: 2px 2px 0 0;
}
.result-file .rel-path { opacity: 0.6; font-weight: 400; }

.result-item {
  display: flex;
  align-items: stretch;
  background: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,0.05));
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 12px;
  border-left: 2px solid transparent;
  transition: background 0.07s;
}
.result-item:hover {
  background: var(--vscode-list-hoverBackground);
  border-left-color: var(--vscode-focusBorder, #007acc);
}

.line-num {
  padding: 3px 8px;
  color: var(--vscode-editorLineNumber-foreground);
  min-width: 38px;
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--vscode-editorIndentGuide-background, rgba(128,128,128,0.2));
  flex-shrink: 0;
  font-size: 11px;
}

.line-content {
  padding: 3px 8px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.line-content mark {
  background: var(--vscode-editor-findMatchHighlightBackground, rgba(255,210,0,0.4));
  color: inherit;
  border-radius: 1px;
  padding: 0 1px;
}

.no-results {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  padding: 8px 0;
}

</style>
</head>
<body>

<h2>Smart Search</h2>

<!-- Workspace bar -->
<div class="workspace-bar">
  <span class="ws-label">Workspace:</span>
  <span class="ws-name" id="wsName">—</span>
  <span class="ws-path" id="wsPath"></span>
</div>
<div class="no-folder-warn" id="noFolderWarn">
  ⚠️ No folder open. Please open a folder in VSCode first.
</div>

<!-- Search type tabs -->
<div class="type-tabs">
  <button class="type-tab active" id="tabNormal" data-type="normal">Normal Search</button>
  <button class="type-tab ai-tab" id="tabAI"     data-type="ai">AI Search <span class="ai-badge">SOON</span></button>
</div>

<!-- ══ Normal Search Panel ══════════════════════════════════════════════════ -->
<div id="normalPanel" class="visible">

  <!-- Search + replace rows with expand chevron -->
  <div class="input-section">
    <div class="expand-col">
      <button class="expand-btn" id="expandBtn" title="Toggle Replace">›</button>
    </div>
    <div class="input-col">

      <!-- Search row -->
      <div class="input-row">
        <input type="text" id="query" placeholder="Search" autocomplete="off" spellcheck="false">
        <div class="toggle-btns">
          <button class="toggle-btn" id="btnCase"  data-tip="Match Case">Aa</button>
          <button class="toggle-btn" id="btnWord"  data-tip="Match Whole Word">W</button>
          <button class="toggle-btn" id="btnRegex" data-tip="Use Regular Expression">.*</button>
        </div>
        <button class="btn-primary" id="searchBtn">Search</button>
      </div>

      <!-- Replace row (hidden until chevron clicked) -->
      <div class="input-row replace-row" id="replaceRow">
        <input type="text" id="replaceInput" placeholder="Replace" autocomplete="off" spellcheck="false">
        <button class="btn-secondary" id="replaceAllBtn">Replace All</button>
      </div>

    </div>
  </div>

  <!-- File filters -->
  <div class="filter-row">
    <div class="filter-field">
      <label>Files to include</label>
      <input type="text" id="filesToInclude" placeholder="e.g. **/*.ts, src/**">
    </div>
    <div class="filter-field">
      <label>Files to exclude</label>
      <input type="text" id="filesToExclude" placeholder="e.g. **/*.test.ts">
    </div>
  </div>

</div><!-- /normalPanel -->

<!-- ══ AI Search Panel ══════════════════════════════════════════════════════ -->
<div id="aiPanel">

  <div class="ai-hint">
    Describe what you're looking for in natural language — AI will find relevant code semantically.
  </div>

  <div class="input-row">
    <input type="text" id="aiQuery" placeholder="e.g. function that validates email" autocomplete="off" spellcheck="false">
    <button class="btn-primary" id="aiSearchBtn">Search</button>
  </div>

</div><!-- /aiPanel -->

<!-- Results -->
<div id="result"></div>

<script>

const vscode = acquireVsCodeApi();

// ── Element refs ────────────────────────────────────────────────────────────
const wsNameEl     = document.getElementById("wsName");
const wsPathEl     = document.getElementById("wsPath");
const noFolderWarn = document.getElementById("noFolderWarn");
const normalPanel  = document.getElementById("normalPanel");
const aiPanel      = document.getElementById("aiPanel");
const resultEl     = document.getElementById("result");

// Normal search
const queryEl        = document.getElementById("query");
const replaceRow     = document.getElementById("replaceRow");
const replaceInputEl = document.getElementById("replaceInput");
const expandBtn      = document.getElementById("expandBtn");
const searchBtn      = document.getElementById("searchBtn");
const replaceAllBtn  = document.getElementById("replaceAllBtn");
const btnCase        = document.getElementById("btnCase");
const btnWord        = document.getElementById("btnWord");
const btnRegex       = document.getElementById("btnRegex");
const filesToInclude = document.getElementById("filesToInclude");
const filesToExclude = document.getElementById("filesToExclude");

// AI search
const aiQueryEl   = document.getElementById("aiQuery");
const aiSearchBtn = document.getElementById("aiSearchBtn");

// ── State ────────────────────────────────────────────────────────────────────
let currentWorkspace = null;
let matchCase        = false;
let matchWholeWord   = false;
let useRegex         = false;
let searchType       = "normal";
let replaceOpen      = false;

// ── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll(".type-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".type-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    searchType = tab.dataset.type;

    normalPanel.classList.toggle("visible", searchType === "normal");
    aiPanel.classList.toggle("visible",     searchType === "ai");
    resultEl.innerHTML = "";
  });
});

// ── Expand/collapse replace row ──────────────────────────────────────────────
expandBtn.addEventListener("click", () => {
  replaceOpen = !replaceOpen;
  expandBtn.classList.toggle("open", replaceOpen);
  replaceRow.classList.toggle("visible", replaceOpen);
  if (replaceOpen) replaceInputEl.focus();
});

// ── Toggle buttons ───────────────────────────────────────────────────────────
function makeToggle(btn, getter, setter) {
  btn.addEventListener("click", () => {
    setter(!getter());
    btn.classList.toggle("active", getter());
  });
}

makeToggle(btnCase,  () => matchCase,      v => { matchCase      = v; });
makeToggle(btnWord,  () => matchWholeWord, v => { matchWholeWord = v; });
makeToggle(btnRegex, () => useRegex,       v => { useRegex       = v; });

// ── Search ───────────────────────────────────────────────────────────────────
searchBtn.addEventListener("click", doSearch);
queryEl.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

function doSearch() {
  const q = queryEl.value.trim();
  if (!q)                  { showError("Please enter a search query.");   return; }
  if (!currentWorkspace)   { showError("No folder open in VSCode.");      return; }

  vscode.postMessage({
    command:        "search",
    query:          q,
    searchType:     "normal",
    matchCase,
    matchWholeWord,
    useRegex,
    filesToInclude: filesToInclude.value.trim(),
    filesToExclude: filesToExclude.value.trim(),
  });
}

// ── Replace All ──────────────────────────────────────────────────────────────
replaceAllBtn.addEventListener("click", doReplaceAll);
replaceInputEl.addEventListener("keydown", e => { if (e.key === "Enter") doReplaceAll(); });

function doReplaceAll() {
  const q = queryEl.value.trim();
  const r = replaceInputEl.value;   // replacement can be empty string (delete)
  if (!q)                { showError("Please enter a search query.");  return; }
  if (!currentWorkspace) { showError("No folder open in VSCode.");     return; }

  const confirmed = confirm(
    "Replace all occurrences of \"" + q + "\" with \"" + r + "\"?\n\nThis will modify files on disk."
  );
  if (!confirmed) return;

  vscode.postMessage({
    command:     "replaceAll",
    query:       q,
    replacement: r,
    matchCase,
    matchWholeWord,
    useRegex,
    filesToInclude: filesToInclude.value.trim(),
    filesToExclude: filesToExclude.value.trim(),
  });
}

// ── AI search (stub) ─────────────────────────────────────────────────────────
aiSearchBtn.addEventListener("click", doAiSearch);
aiQueryEl.addEventListener("keydown", e => { if (e.key === "Enter") doAiSearch(); });

function doAiSearch() {
  const q = aiQueryEl.value.trim();
  if (!q)               { showError("Please enter a search query.");  return; }
  if (!currentWorkspace){ showError("No folder open in VSCode.");     return; }

  vscode.postMessage({
    command:    "search",
    query:      q,
    searchType: "ai",
    matchCase:      false,
    matchWholeWord: false,
    useRegex:       false,
    filesToInclude: "",
    filesToExclude: "",
  });
}

// ── Result rendering ─────────────────────────────────────────────────────────
function showLoading(msg) {
  resultEl.innerHTML = '<div class="loading-text">' + (msg || "Working…") + '</div>';
}

function showError(msg) {
  resultEl.innerHTML = '<div class="error-msg">' + escHtml(msg) + '</div>';
}

function showSearchResult(data) {
  if (data.unsupported) {
    resultEl.innerHTML =
      '<div class="unsupported-msg">'
      + '<span class="icon">🚧</span>'
      + '<span class="text"><strong>Feature not available yet</strong>'
      + escHtml(data.error || "This search type is not supported yet. Stay tuned!")
      + '</span></div>';
    return;
  }

  if (!data.results || data.results.length === 0) {
    resultEl.innerHTML = '<div class="no-results">No results found for <strong>'
      + escHtml(data.query) + '</strong>.</div>';
    return;
  }

  const { total, time_ms, query, matchCase: mc, matchWholeWord: mw, useRegex: rx } = data;

  // Regex for client-side highlighting — mirrors backend
  let highlightRe = null;
  try {
    let pat = rx ? query : escapeRegex(query);
    if (mw) pat = "\\b" + pat + "\\b";
    highlightRe = new RegExp(pat, mc ? "g" : "gi");
  } catch(e) { /* ignore bad regex */ }

  // Group by file
  const byFile = {};
  for (const r of data.results) {
    (byFile[r.file] = byFile[r.file] || []).push(r);
  }

  const wsPath = data.workspacePath || "";

  let html = '<div class="status-line">Found <strong>' + total + '</strong> result'
    + (total !== 1 ? "s" : "") + " in " + time_ms + " ms</div>"
    + '<div class="result-list">';

  for (const [filePath, hits] of Object.entries(byFile)) {
    let rel = filePath;
    if (wsPath && filePath.startsWith(wsPath)) {
      rel = filePath.slice(wsPath.length).replace(/^[\/\\]/, "");
    }
    const lastSep = Math.max(rel.lastIndexOf("/"), rel.lastIndexOf("\\\\"));
    const dir  = lastSep >= 0 ? rel.slice(0, lastSep + 1) : "";
    const file = lastSep >= 0 ? rel.slice(lastSep + 1)    : rel;

    html += '<div class="result-group">'
      + '<div class="result-file"><span class="rel-path">' + escHtml(dir) + '</span>' + escHtml(file) + '</div>';

    for (const hit of hits) {
      const hl = highlightRe
        ? escHtml(hit.content).replace(highlightRe, m => "<mark>" + escHtml(m) + "</mark>")
        : escHtml(hit.content);

      html += '<div class="result-item">'
        + '<span class="line-num">' + hit.line + '</span>'
        + '<span class="line-content">' + hl + '</span>'
        + '</div>';
    }

    html += '</div>';
  }

  html += '</div>';
  resultEl.innerHTML = html;
}

function showReplaceResult(data) {
  if (data.totalReplaced === 0) {
    resultEl.innerHTML = '<div class="no-results">No matches found — nothing was replaced.</div>';
    return;
  }

  let html = '<div class="success-msg">'
    + '✅ Replaced <strong>' + data.totalReplaced + '</strong> occurrence'
    + (data.totalReplaced !== 1 ? "s" : "")
    + ' across <strong>' + data.filesModified + '</strong> file'
    + (data.filesModified !== 1 ? "s" : "")
    + ' in ' + data.time_ms + ' ms.'
    + '</div>';

  if (data.errors && data.errors.length > 0) {
    html += '<div class="error-msg" style="margin-top:6px;">⚠️ '
      + data.errors.map(escHtml).join("<br>") + '</div>';
  }

  resultEl.innerHTML = html;
}

// ── Utilities ────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\\\]/g, "\\\\$&");
}

// ── Message handler ──────────────────────────────────────────────────────────
window.addEventListener("message", event => {
  const msg = event.data;
  switch (msg.command) {

    case "workspaceInfo":
      currentWorkspace     = msg.workspacePath;
      wsNameEl.textContent = msg.workspaceName;
      wsPathEl.textContent = msg.workspacePath;
      noFolderWarn.style.display = "none";
      break;

    case "noWorkspace":
      currentWorkspace     = null;
      wsNameEl.textContent = "—";
      wsPathEl.textContent = "";
      noFolderWarn.style.display = "block";
      break;

    case "searchLoading":  showLoading("Searching…");    break;
    case "replaceLoading": showLoading("Replacing…");    break;
    case "searchResult":   showSearchResult(msg.data);   break;
    case "replaceResult":  showReplaceResult(msg.data);  break;
    case "searchError":
    case "replaceError":   showError(msg.error);         break;
  }
});

vscode.postMessage({ command: "webviewReady" });

</script>
</body>
</html>
`;
}

export function deactivate() {}