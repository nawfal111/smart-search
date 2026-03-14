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
              await handleSearch(
                panel,
                message.query,
                message.searchType,
                message.matchCase,
                message.matchWholeWord,
                message.useRegex,
                message.filesInclude,
                message.filesExclude,
              );
              break;

            case "replace":
              await handleReplace(message.result, message.replaceText);
              panel.webview.postMessage({ command: "replaceComplete" });
              break;

            case "replaceAll":
              await handleReplaceAll(message.results, message.replaceText);
              panel.webview.postMessage({ command: "replaceComplete" });
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function sendWorkspaceInfo(panel: vscode.WebviewPanel) {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    panel.webview.postMessage({
      command: "workspaceInfo",
      workspacePath: folders[0].uri.fsPath,
      workspaceName: folders[0].name,
    });
  } else {
    panel.webview.postMessage({ command: "noWorkspace" });
  }
}

async function handleSearch(
  panel: vscode.WebviewPanel,
  query: string,
  searchType: string,
  matchCase: boolean,
  matchWholeWord: boolean,
  useRegex: boolean,
  filesInclude: string,
  filesExclude: string,
) {
  try {
    panel.webview.postMessage({ command: "searchLoading" });

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error(
        "No folder/workspace is open. Please open a folder first.",
      );
    }

    const workspacePath = folders[0].uri.fsPath;

    const response = await fetch("http://localhost:8000/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        workspacePath,
        searchType,
        matchCase,
        matchWholeWord,
        useRegex,
        filesInclude,
        filesExclude,
      }),
    });

    if (!response.ok) {
      const errData: any = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error: ${response.status}`);
    }

    const data = await response.json();
    panel.webview.postMessage({ command: "searchResult", data });
  } catch (err) {
    panel.webview.postMessage({
      command: "searchError",
      error:
        err instanceof Error
          ? err.message
          : "Backend not running on localhost:8000",
    });
  }
}

async function handleReplace(result: any, replaceText: string) {
  const edit = new vscode.WorkspaceEdit();
  const uri = vscode.Uri.file(result.file);

  // Replace the first match in this line
  if (result.matches && result.matches.length > 0) {
    const [start, end] = result.matches[0];
    const range = new vscode.Range(
      new vscode.Position(result.line - 1, start),
      new vscode.Position(result.line - 1, end),
    );
    edit.replace(uri, range, replaceText);
    await vscode.workspace.applyEdit(edit);
  }
}

async function handleReplaceAll(results: any[], replaceText: string) {
  const edit = new vscode.WorkspaceEdit();

  for (const res of results) {
    const uri = vscode.Uri.file(res.file);
    // Reverse matches so replacing earlier text doesn't offset later indices on the same line
    const matches = [...(res.matches || [])].reverse();

    for (const [start, end] of matches) {
      const range = new vscode.Range(
        new vscode.Position(res.line - 1, start),
        new vscode.Position(res.line - 1, end),
      );
      edit.replace(uri, range, replaceText);
    }
  }

  await vscode.workspace.applyEdit(edit);
}

// ── Webview HTML ──────────────────────────────────────────────────────────────

function getWebviewContent(): string {
  return `
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
    padding: 16px;
  }

  h2 {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
    margin-bottom: 12px;
  }

  /* Workspace bar */
  .workspace-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    padding: 5px 8px;
    margin-bottom: 10px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
  }
  .workspace-bar .ws-label { white-space: nowrap; font-weight: 600; }
  .workspace-bar .ws-name { color: var(--vscode-foreground); font-weight: 600; white-space: nowrap; }
  .workspace-bar .ws-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.6; }

  /* Input rows */
  .input-row {
    display: flex;
    gap: 6px;
    align-items: stretch;
    margin-bottom: 6px;
  }

  .input-wrap {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }

  input[type="text"] {
    width: 100%;
    padding: 6px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    font-family: inherit;
    font-size: inherit;
    outline: none;
  }
  input[type="text"]:focus {
    border-color: var(--vscode-focusBorder);
  }

  /* Toggle buttons inside input area */
  .toggle-btns {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: 6px;
    flex-shrink: 0;
  }
  .toggle-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    opacity: 0.55;
    transition: opacity 0.1s, background 0.1s, border-color 0.1s;
    user-select: none;
    font-family: inherit;
  }
  .toggle-btn:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15));
  }
  .toggle-btn.active {
    opacity: 1;
    background: var(--vscode-inputOption-activeBackground, rgba(0,120,212,0.2));
    border-color: var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder));
    color: var(--vscode-inputOption-activeForeground, var(--vscode-foreground));
  }
  .toggle-btn[title]:hover::after {
    content: attr(title);
    position: absolute;
    bottom: calc(100% + 4px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--vscode-editorHoverWidget-background);
    border: 1px solid var(--vscode-editorHoverWidget-border);
    color: var(--vscode-editorHoverWidget-foreground);
    padding: 2px 6px;
    border-radius: 2px;
    white-space: nowrap;
    font-size: 11px;
    pointer-events: none;
    z-index: 100;
  }
  .toggle-btn { position: relative; }

  /* Buttons */
  button.action-btn {
    padding: 6px 14px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 2px;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    white-space: nowrap;
  }
  button.action-btn:hover { background: var(--vscode-button-hoverBackground); }
  button.action-btn:active { opacity: 0.85; }
  
  button.secondary-btn {
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  button.secondary-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3));
  }

  /* Warning */
  .no-folder-warn {
    display: none;
    margin-top: 8px;
    padding: 8px;
    background: var(--vscode-inputValidation-warningBackground);
    border: 1px solid var(--vscode-inputValidation-warningBorder);
    border-radius: 2px;
    font-size: 12px;
  }

  /* Results area */
  #result { margin-top: 14px; }

  .status-line { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  .status-line strong { color: var(--vscode-foreground); }
  .loading-text { font-style: italic; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .error-msg { padding: 8px 10px; background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 2px; font-size: 12px; color: var(--vscode-errorForeground, #f44); }

  /* Result list */
  .result-list { display: flex; flex-direction: column; gap: 1px; }
  .result-group { margin-bottom: 10px; }
  .result-file { font-size: 11px; font-weight: 600; padding: 3px 6px; background: var(--vscode-sideBarSectionHeader-background, rgba(128,128,128,0.1)); border-radius: 2px 2px 0 0; border-left: 2px solid var(--vscode-focusBorder, #007acc); word-break: break-all; color: var(--vscode-foreground); }
  .result-file .rel-path { opacity: 0.6; font-weight: 400; }
  .result-item { display: flex; gap: 0; border-left: 2px solid var(--vscode-focusBorder, #007acc); border-left-color: transparent; background: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,0.06)); font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; cursor: default; transition: background 0.08s; }
  .result-item:hover { background: var(--vscode-list-hoverBackground); }
  .line-num { padding: 3px 8px; color: var(--vscode-editorLineNumber-foreground); min-width: 40px; text-align: right; user-select: none; border-right: 1px solid var(--vscode-editorIndentGuide-background, rgba(128,128,128,0.2)); flex-shrink: 0; font-size: 11px; }
  .line-content { padding: 3px 8px; white-space: pre; overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .line-content mark { background: var(--vscode-editor-findMatchHighlightBackground, rgba(255,210,0,0.4)); color: inherit; border-radius: 1px; padding: 0 1px; }
  .no-results { font-size: 12px; color: var(--vscode-descriptionForeground); padding: 10px 0; }

  /* Search type tabs */
  .type-tabs { display: flex; gap: 0; margin-bottom: 8px; border-bottom: 1px solid var(--vscode-editorIndentGuide-background, rgba(128,128,128,0.2)); }
  .type-tab { padding: 5px 14px; background: transparent; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; font-family: inherit; font-size: 12px; color: var(--vscode-descriptionForeground); transition: color 0.1s, border-color 0.1s; }
  .type-tab:hover { color: var(--vscode-foreground); }
  .type-tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder, #007acc); font-weight: 600; }
  .type-tab.ai-tab.active { border-bottom-color: #a855f7; color: #a855f7; }
  .ai-badge { display: inline-block; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 3px; background: rgba(168, 85, 247, 0.18); color: #a855f7; margin-left: 4px; vertical-align: middle; letter-spacing: 0.04em; }

  .unsupported-msg { margin-top: 14px; padding: 10px 12px; background: var(--vscode-inputValidation-warningBackground, rgba(255,180,0,0.1)); border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(255,180,0,0.4)); border-radius: 2px; font-size: 12px; color: var(--vscode-foreground); display: flex; align-items: flex-start; gap: 8px; }
  .unsupported-msg .icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
  .unsupported-msg .text { line-height: 1.5; }
  .unsupported-msg .text strong { display: block; margin-bottom: 2px; }

</style>
</head>
<body>

<h2>Smart Search</h2>

<div class="workspace-bar">
  <span class="ws-label">Workspace:</span>
  <span class="ws-name" id="wsName">—</span>
  <span class="ws-path" id="wsPath"></span>
</div>

<div class="no-folder-warn" id="noFolderWarn">
  ⚠️ No folder open. Please open a folder in VSCode first.
</div>

<div class="type-tabs">
  <button class="type-tab active"  id="tabNormal" data-type="normal">Normal Search</button>
  <button class="type-tab ai-tab"  id="tabAI"     data-type="ai">AI Search <span class="ai-badge">SOON</span></button>
</div>

<div id="normalControls">
  <div class="input-row">
    <div class="input-wrap">
      <input id="query" type="text" placeholder="Search…" autocomplete="off" spellcheck="false">
      <div class="toggle-btns">
        <button class="toggle-btn" id="btnCase"  title="Match Case">Aa</button>
        <button class="toggle-btn" id="btnWord"  title="Match Whole Word">W</button>
        <button class="toggle-btn" id="btnRegex" title="Use Regular Expression">.*</button>
      </div>
    </div>
  </div>

  <div class="input-row">
    <input id="replaceQuery" type="text" placeholder="Replace…" autocomplete="off" spellcheck="false">
    <button class="action-btn secondary-btn" id="replaceBtn" title="Replace first result">Replace</button>
    <button class="action-btn secondary-btn" id="replaceAllBtn" title="Replace all results">Replace All</button>
  </div>

  <div class="input-row">
    <input id="filesInclude" type="text" placeholder="files to include (e.g. *.ts, src/)" autocomplete="off">
    <input id="filesExclude" type="text" placeholder="files to exclude (e.g. node_modules/)" autocomplete="off">
  </div>
  
  <button class="action-btn" id="searchBtn" style="width: 100%; margin-top: 4px;">Search</button>
</div>

<div id="result"></div>

<script>
const vscode = acquireVsCodeApi();

// Elements
const queryEl        = document.getElementById("query");
const replaceEl      = document.getElementById("replaceQuery");
const includeEl      = document.getElementById("filesInclude");
const excludeEl      = document.getElementById("filesExclude");
const searchBtn      = document.getElementById("searchBtn");
const replaceBtn     = document.getElementById("replaceBtn");
const replaceAllBtn  = document.getElementById("replaceAllBtn");
const resultEl       = document.getElementById("result");
const wsNameEl       = document.getElementById("wsName");
const wsPathEl       = document.getElementById("wsPath");
const noFolderWarn   = document.getElementById("noFolderWarn");
const btnCase        = document.getElementById("btnCase");
const btnWord        = document.getElementById("btnWord");
const btnRegex       = document.getElementById("btnRegex");
const normalControls = document.getElementById("normalControls");

let currentWorkspace = null;
let matchCase        = false;
let matchWholeWord   = false;
let useRegex         = false;
let searchType       = "normal";
let lastResultsData  = [];

// ── Search type tabs ────────────────────────────────────────────────────────
document.querySelectorAll(".type-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".type-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    searchType = tab.dataset.type;

    // Show/hide extended controls
    normalControls.style.opacity = searchType === "normal" ? "1" : "0.35";
    normalControls.style.pointerEvents = searchType === "normal" ? "" : "none";
    resultEl.innerHTML = "";
  });
});

// ── Toggle buttons ──────────────────────────────────────────────────────────
btnCase.addEventListener("click", () => { matchCase = !matchCase; btnCase.classList.toggle("active", matchCase); });
btnWord.addEventListener("click", () => { matchWholeWord = !matchWholeWord; btnWord.classList.toggle("active", matchWholeWord); });
btnRegex.addEventListener("click", () => { useRegex = !useRegex; btnRegex.classList.toggle("active", useRegex); });

// ── Actions ─────────────────────────────────────────────────────────────────
searchBtn.addEventListener("click", doSearch);
queryEl.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

replaceBtn.addEventListener("click", () => {
  if (lastResultsData.length === 0) return;
  vscode.postMessage({
    command: "replace",
    result: lastResultsData[0], // send first
    replaceText: replaceEl.value
  });
});

replaceAllBtn.addEventListener("click", () => {
  if (lastResultsData.length === 0) return;
  vscode.postMessage({
    command: "replaceAll",
    results: lastResultsData,
    replaceText: replaceEl.value
  });
});

function doSearch() {
  const q = queryEl.value.trim();
  if (!q) { showError("Please enter a search query."); return; }
  if (!currentWorkspace) { showError("No folder open in VSCode."); return; }

  vscode.postMessage({
    command:        "search",
    query:          q,
    searchType:     searchType,
    matchCase:      matchCase,
    matchWholeWord: matchWholeWord,
    useRegex:       useRegex,
    filesInclude:   includeEl.value.trim(),
    filesExclude:   excludeEl.value.trim(),
  });
}

// ── Result rendering ────────────────────────────────────────────────────────
function showLoading() { resultEl.innerHTML = '<div class="loading-text">Searching…</div>'; }
function showError(msg) { resultEl.innerHTML = '<div class="error-msg">' + escHtml(msg) + '</div>'; }

function showResult(data) {
  if (data.unsupported) {
    resultEl.innerHTML =
      '<div class="unsupported-msg"><span class="icon">🚧</span><span class="text">' +
      '<strong>Feature not available yet</strong>' + escHtml(data.error) + '</span></div>';
    return;
  }

  lastResultsData = data.results || [];

  if (lastResultsData.length === 0) {
    resultEl.innerHTML = '<div class="no-results">No results found for <strong>' + escHtml(data.query) + '</strong>.</div>';
    return;
  }

  const total  = data.total;
  const timeMs = data.time_ms;
  const wsPath = data.workspacePath || "";

  let html = '<div class="status-line">Found <strong>' + total + '</strong> result' + (total !== 1 ? 's' : '') + ' in ' + timeMs + ' ms</div>';
  html += '<div class="result-list">';

  const byFile = {};
  for (const r of data.results) {
    if (!byFile[r.file]) byFile[r.file] = [];
    byFile[r.file].push(r);
  }

  for (const [filePath, hits] of Object.entries(byFile)) {
    let rel = filePath;
    if (wsPath && filePath.startsWith(wsPath)) {
      rel = filePath.slice(wsPath.length).replace(/^[\\/]/, "");
    }
    const lastSep = Math.max(rel.lastIndexOf("/"), rel.lastIndexOf("\\\\"));
    const dir  = lastSep >= 0 ? rel.slice(0, lastSep + 1) : "";
    const file = lastSep >= 0 ? rel.slice(lastSep + 1) : rel;

    html += '<div class="result-group"><div class="result-file"><span class="rel-path">' + escHtml(dir) + '</span>' + escHtml(file) + '</div>';

    for (const hit of hits) {
      // Basic highlighting using the indices returned from Python
      let highlighted = escHtml(hit.content);
      // We highlight backwards so indices stay valid
      const matches = [...(hit.matches || [])].sort((a,b) => b[0] - a[0]);
      for (const [start, end] of matches) {
          const before = highlighted.substring(0, start);
          const matchText = highlighted.substring(start, end);
          const after = highlighted.substring(end);
          highlighted = before + '<mark>' + matchText + '</mark>' + after;
      }

      html += '<div class="result-item"><span class="line-num">' + hit.line + '</span><span class="line-content">' + highlighted + '</span></div>';
    }
    html += '</div>';
  }

  html += '</div>';
  resultEl.innerHTML = html;
}

function escHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Message handler ─────────────────────────────────────────────────────────
window.addEventListener("message", event => {
  const msg = event.data;
  switch (msg.command) {
    case "workspaceInfo":
      currentWorkspace = msg.workspacePath;
      wsNameEl.textContent = msg.workspaceName;
      wsPathEl.textContent = msg.workspacePath;
      noFolderWarn.style.display = "none";
      break;
    case "noWorkspace":
      currentWorkspace = null;
      wsNameEl.textContent = "—";
      wsPathEl.textContent = "";
      noFolderWarn.style.display = "block";
      break;
    case "searchLoading":   showLoading(); break;
    case "searchResult":    showResult(msg.data); break;
    case "searchError":     showError(msg.error); break;
    case "replaceComplete": doSearch(); break; // Re-search after replace to update UI
  }
});

vscode.postMessage({ command: "webviewReady" });
</script>
</body>
</html>
`;
}

export function deactivate() {}
