import * as fs from "fs";
import * as path from "path";
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
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "dist"),
          ],
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
              await handleSearch(panel, message);
              break;

            case "replace":
              await handleReplace(message.result, message.replaceText);
              panel.webview.postMessage({ command: "replaceComplete" });
              break;

            case "replaceAll":
              await handleReplaceAll(message.results, message.replaceText);
              panel.webview.postMessage({ command: "replaceComplete" });
              break;

            case "openFile":
              const uri = vscode.Uri.file(message.file);
              const doc = await vscode.workspace.openTextDocument(uri);
              const editor = await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: false,
              });

              // Set cursor position based on the first match of that result
              if (message.match) {
                const [start, end] = message.match;
                const posStart = new vscode.Position(message.line - 1, start);
                const posEnd = new vscode.Position(message.line - 1, end);
                const range = new vscode.Range(posStart, posEnd);

                editor.selection = new vscode.Selection(posStart, posEnd);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
              }
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
  if (folders && folders.length) {
    panel.webview.postMessage({
      command: "workspaceInfo",
      workspaceName: folders[0].name,
      workspacePath: folders[0].uri.fsPath,
    });
  } else {
    panel.webview.postMessage({ command: "noWorkspace" });
  }
}

async function handleSearch(panel: vscode.WebviewPanel, message: any) {
  try {
    panel.webview.postMessage({ command: "searchLoading" });

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      panel.webview.postMessage({
        command: "searchError",
        error: "No folder open. Please open a folder first.",
      });
      return;
    }

    const workspacePath = folders[0].uri.fsPath;

    const response = await fetch("http://localhost:8000/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...message, workspacePath }),
    });

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
  const [start, end] = result.matches[0];
  const range = new vscode.Range(result.line - 1, start, result.line - 1, end);
  edit.replace(uri, range, replaceText);
  await vscode.workspace.applyEdit(edit);
}

async function handleReplaceAll(results: any[], replaceText: string) {
  const edit = new vscode.WorkspaceEdit();
  for (const res of results) {
    const uri = vscode.Uri.file(res.file);
    const matches = [...(res.matches || [])].reverse();
    for (const [start, end] of matches) {
      const range = new vscode.Range(res.line - 1, start, res.line - 1, end);
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
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    padding: 16px;
  }

  h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; margin-bottom: 12px; }

  .workspace-bar {
    display: flex; align-items: center; gap: 6px; background: var(--vscode-input-background);
    padding: 5px 8px; margin-bottom: 10px; font-size: 11px; border-radius: 2px;
  }
  .ws-name { font-weight: 600; }
  .ws-path { opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .input-row { display: flex; gap: 6px; margin-bottom: 6px; }
  .input-wrap { flex: 1; display: flex; align-items: center; position: relative; }

  input[type="text"] {
    width: 100%; padding: 6px 8px; background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px; outline: none;
  }
  input[type="text"]:focus { border-color: var(--vscode-focusBorder); }

  .toggle-btns { display: flex; gap: 2px; margin-left: 6px; }
  .toggle-btn {
    width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    background: transparent; border-radius: 3px; cursor: pointer; opacity: 0.6;
    color: var(--vscode-foreground); border: 1px solid transparent;
  }
  .toggle-btn.active { 
    opacity: 1; background: var(--vscode-inputOption-activeBackground); 
    border-color: var(--vscode-inputOption-activeBorder); 
  }

  button.action-btn {
    padding: 6px 14px; background: var(--vscode-button-background);
    color: var(--vscode-button-foreground); border: none; border-radius: 2px; cursor: pointer;
  }
  button.secondary-btn { background: var(--vscode-button-secondaryBackground); }

  #result { margin-top: 14px; }
  .status-line { font-size: 11px; margin-bottom: 8px; opacity: 0.8; }

  /* Result Grouping and Collapsing */
  .result-group { margin-bottom: 2px; }
  .result-file {
    font-size: 11px; font-weight: 600; padding: 4px 8px;
    background: var(--vscode-sideBarSectionHeader-background);
    display: flex; align-items: center; cursor: pointer;
    border-radius: 2px;
  }
  .result-file:hover { background: var(--vscode-list-hoverBackground); }
  
  .chevron {
    width: 16px; display: inline-block; transition: transform 0.1s;
    font-style: normal; text-align: center; margin-right: 4px;
  }
  .result-group.collapsed .chevron { transform: rotate(-90deg); }
  .result-group.collapsed .result-items-list { display: none; }

  .result-item {
    display: flex; cursor: pointer; font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px; border-left: 2px solid transparent;
  }
  .result-item:hover { background: var(--vscode-list-hoverBackground); border-left-color: var(--vscode-focusBorder); }
  
  .line-num { padding: 3px 8px; color: var(--vscode-editorLineNumber-foreground); min-width: 40px; text-align: right; opacity: 0.7; }
  .line-content { padding: 3px 8px; white-space: pre; overflow: hidden; text-overflow: ellipsis; flex: 1; }
  mark { background: var(--vscode-editor-findMatchHighlightBackground); color: inherit; }

  .no-results { font-size: 12px; opacity: 0.6; padding: 10px 0; }
  .error-msg { color: var(--vscode-errorForeground); font-size: 12px; padding: 10px; background: var(--vscode-inputValidation-errorBackground); }

</style>
</head>
<body>

  <h2>Smart Search</h2>

  <div class="workspace-bar">
    <span class="ws-name" id="wsName"></span>
    <span class="ws-path" id="wsPath"></span>
  </div>

  <div id="normalControls">
    <div class="input-row">
      <div class="input-wrap">
        <input id="query" type="text" placeholder="Search…">
        <div class="toggle-btns">
          <button class="toggle-btn" id="btnCase" title="Match Case">Aa</button>
          <button class="toggle-btn" id="btnWord" title="Match Whole Word">W</button>
          <button class="toggle-btn" id="btnRegex" title="Use Regex">.*</button>
        </div>
      </div>
    </div>

    <div class="input-row">
      <input id="replaceQuery" type="text" placeholder="Replace…">
      <button class="action-btn secondary-btn" id="replaceBtn">Replace</button>
      <button class="action-btn secondary-btn" id="replaceAllBtn">All</button>
    </div>

    <div class="input-row">
      <input id="filesInclude" type="text" placeholder="Include (e.g. *.ts)">
      <input id="filesExclude" type="text" placeholder="Exclude">
    </div>
    
    <button class="action-btn" id="searchBtn" style="width: 100%; margin-top: 4px;">Search</button>
  </div>

  <div id="result"></div>

<script>
  const vscode = acquireVsCodeApi();

  const queryEl = document.getElementById("query");
  const replaceEl = document.getElementById("replaceQuery");
  const resultEl = document.getElementById("result");

  let matchCase = false, matchWord = false, useRegex = false;
  let lastResultsData = [];

  // Toggle buttons
  document.getElementById("btnCase").onclick = function() { matchCase = !matchCase; this.classList.toggle("active", matchCase); };
  document.getElementById("btnWord").onclick = function() { matchWord = !matchWord; this.classList.toggle("active", matchWord); };
  document.getElementById("btnRegex").onclick = function() { useRegex = !useRegex; this.classList.toggle("active", useRegex); };

  // Trigger search on Enter
  [queryEl, document.getElementById("filesInclude"), document.getElementById("filesExclude")].forEach(el => {
    el.onkeydown = (e) => { if(e.key === "Enter") doSearch(); };
  });

  document.getElementById("searchBtn").onclick = doSearch;

  document.getElementById("replaceBtn").onclick = () => {
    if(lastResultsData.length) vscode.postMessage({ command: 'replace', result: lastResultsData[0], replaceText: replaceEl.value });
  };

  document.getElementById("replaceAllBtn").onclick = () => {
    if(lastResultsData.length) vscode.postMessage({ command: 'replaceAll', results: lastResultsData, replaceText: replaceEl.value });
  };

  function doSearch() {
    vscode.postMessage({
      command: 'search',
      query: queryEl.value,
      matchCase, matchWholeWord: matchWord, useRegex,
      filesInclude: document.getElementById("filesInclude").value,
      filesExclude: document.getElementById("filesExclude").value,
      searchType: 'normal'
    });
  }

  function renderResults(data) {
    lastResultsData = data.results || [];
    if(!lastResultsData.length) {
      resultEl.innerHTML = '<div class="no-results">No results found.</div>';
      return;
    }

    const wsPath = data.workspacePath || "";
    const byFile = {};
    lastResultsData.forEach(r => {
      if (!byFile[r.file]) byFile[r.file] = [];
      byFile[r.file].push(r);
    });
const filesCount = Object.keys(byFile).length;  // <-- calculate AFTER grouping

let html = '<div class="status-line">Found <strong>' + data.total + '</strong> result' + (data.total !== 1 ? 's' : '') +
           ' in <strong>' + filesCount + '</strong> file' + (filesCount !== 1 ? 's' : '') +
           ' in ' + data.time_ms + ' ms</div>';

    for (const [filePath, hits] of Object.entries(byFile)) {
      const displayPath = filePath.startsWith(wsPath) ? filePath.slice(wsPath.length).replace(/^[\\\\/]/, "") : filePath;
      
      html += '<div class="result-group">';
      html +=   '<div class="result-file" onclick="this.parentElement.classList.toggle(\\'collapsed\\')">';
      html +=     '<i class="chevron">▼</i>' + escHtml(displayPath);
      html +=   '</div>';
      html +=   '<div class="result-items-list">';

      hits.forEach(hit => {
        let lineText = hit.content;
        let highlighted = "";
        let lastIdx = 0;
        const matches = [...(hit.matches || [])].sort((a,b) => a[0] - b[0]);

        matches.forEach(([start, end]) => {
          highlighted += escHtml(lineText.substring(lastIdx, start));
          highlighted += '<mark>' + escHtml(lineText.substring(start, end)) + '</mark>';
          lastIdx = end;
        });
        highlighted += escHtml(lineText.substring(lastIdx));

        // Use a helper to open file. We escape the file path properly for the JS string.
        const safePath = filePath.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
        const matchJson = JSON.stringify(matches[0] || null);

        html += '<div class="result-item" onclick="openFile(\\'' + safePath + '\\', ' + hit.line + ', ' + matchJson + ')">';
        html +=   '<span class="line-num">' + hit.line + '</span>';
        html +=   '<span class="line-content">' + highlighted + '</span>';
        html += '</div>';
      });

      html += '</div></div>';
    }
    resultEl.innerHTML = html;
  }

  function openFile(file, line, match) {
    vscode.postMessage({ command: 'openFile', file, line, match });
  }

  function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  window.addEventListener("message", event => {
    const msg = event.data;
    switch (msg.command) {
      case "workspaceInfo":
        document.getElementById("wsName").textContent = msg.workspaceName;
        document.getElementById("wsPath").textContent = msg.workspacePath;
        break;
      case "searchLoading": resultEl.innerHTML = 'Searching...'; break;
      case "searchResult":  renderResults(msg.data); break;
      case "searchError":   resultEl.innerHTML = '<div class="error-msg">' + msg.error + '</div>'; break;
      case "replaceComplete": doSearch(); break;
    }
  });

  vscode.postMessage({ command: "webviewReady" });
</script>
</body>
</html>
`;
}
export function deactivate() {}
