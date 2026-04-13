// ─────────────────────────────────────────────────────────────────────────────
// main.js  —  FRONTEND UI LOGIC
//
// This file runs inside the VS Code webview panel (the search UI).
// It communicates with the extension (extension.ts) via message passing.
//
// IMPORTANT: This is NOT a normal browser page.
//   It runs inside VS Code's webview sandbox.
//   It cannot make direct HTTP calls to the backend.
//   Instead it sends messages to extension.ts which does the HTTP calls.
//
// COMMUNICATION FLOW:
//   User action (click/type)
//       ↓
//   vscode.postMessage({ command: "search", ... })   ← send to extension
//       ↓
//   extension.ts receives it → calls Python backend → gets results
//       ↓
//   panel.webview.postMessage({ command: "searchResult", data })  ← send back
//       ↓
//   window.addEventListener("message") receives it → renderResults()
//
// SEARCH MODES:
//   Normal → keyword/regex search → results show file + line + highlighted text
//   AI     → semantic search using embeddings → coming soon
// ─────────────────────────────────────────────────────────────────────────────

// acquireVsCodeApi() gives us the bridge to communicate with extension.ts
// Must be called exactly once — it's provided by VS Code in the webview context
const vscode = acquireVsCodeApi();

// DOM element references
const queryEl   = document.getElementById("query");        // search input
const replaceEl = document.getElementById("replaceQuery"); // replace input
const resultEl  = document.getElementById("result");       // results container

// Current search state
let searchType = "normal";   // "normal" or "ai"
let matchCase  = false;      // Aa button toggle
let matchWord  = false;      // W button toggle
let useRegex   = false;      // .* button toggle

// Stores the last set of results — used when user clicks Replace/Replace All
let lastResultsData = [];

// Workspace root path — received from extension via workspaceInfo message
// Used to build absolute file paths for AI search results (which store relative paths)
let currentWorkspacePath = "";

// ── Mode Toggle ───────────────────────────────────────────────────────────────
// Switches between Normal Search and AI Search modes
// Normal: shows replace bar and match toggles
// AI:     hides replace bar and match toggles (not applicable for semantic search)

document.getElementById("modeNormal").onclick = () => {
  searchType = "normal";
  document.getElementById("modeNormal").classList.add("active");
  document.getElementById("modeAI").classList.remove("active");
  document.getElementById("normalOnlyToggles").style.visibility = "visible";
  document.getElementById("replaceRow").style.display = "flex";
};

document.getElementById("modeAI").onclick = () => {
  searchType = "ai";
  document.getElementById("modeAI").classList.add("active");
  document.getElementById("modeNormal").classList.remove("active");
  document.getElementById("normalOnlyToggles").style.visibility = "hidden";
  document.getElementById("replaceRow").style.display = "none";
};

// ── Option Toggles ────────────────────────────────────────────────────────────
// Match Case (Aa), Match Whole Word (W), Use Regex (.*)
// Each button toggles a boolean and updates its visual state

document.getElementById("btnCase").onclick = function () {
  matchCase = !matchCase;
  this.classList.toggle("active", matchCase);
};
document.getElementById("btnWord").onclick = function () {
  matchWord = !matchWord;
  this.classList.toggle("active", matchWord);
};
document.getElementById("btnRegex").onclick = function () {
  useRegex = !useRegex;
  this.classList.toggle("active", useRegex);
};

// ── Keyboard Shortcuts ────────────────────────────────────────────────────────
// Press Enter in any of these inputs to trigger a search

[
  queryEl,
  document.getElementById("filesInclude"),
  document.getElementById("filesExclude"),
].forEach((el) => {
  el.onkeydown = (e) => {
    if (e.key === "Enter") doSearch();
  };
});

// ── Button Actions ────────────────────────────────────────────────────────────

// Search button → trigger search
document.getElementById("searchBtn").onclick = doSearch;

// Replace button → replace the first result's first match
document.getElementById("replaceBtn").onclick = () => {
  if (lastResultsData.length)
    vscode.postMessage({
      command: "replace",
      result: lastResultsData[0],    // first result
      replaceText: replaceEl.value,  // text to replace with
    });
};

// Replace All button → replace every match across all files
document.getElementById("replaceAllBtn").onclick = () => {
  if (lastResultsData.length)
    vscode.postMessage({
      command: "replaceAll",
      results: lastResultsData,      // all results
      replaceText: replaceEl.value,
    });
};

// ── Search ────────────────────────────────────────────────────────────────────
// Sends the search request to extension.ts
// extension.ts will call the Python backend and send back results

function doSearch() {
  vscode.postMessage({
    command: "search",
    query: queryEl.value,
    searchType,
    matchCase,
    matchWholeWord: matchWord,
    useRegex,
    filesInclude: document.getElementById("filesInclude").value,
    filesExclude: document.getElementById("filesExclude").value,
  });
}

// ── Render AI Results ─────────────────────────────────────────────────────────
// Renders semantic search results returned from Pinecone.
// Each result is a function/class with a relevance score, file, and line range.
// Results are sorted by score (highest = most relevant) — Pinecone does this.

function renderAiResults(data) {
  const results = data.results || [];
  if (!results.length) {
    resultEl.innerHTML = '<div class="no-results">No results found.</div>';
    return;
  }

  let html =
    '<div class="status-line">Found <strong>' + results.length +
    '</strong> results (' + data.time_ms + 'ms)</div>';

  results.forEach((r) => {
    // AI results store relative paths — combine with workspace root for openFile()
    const absPath = currentWorkspacePath
      ? currentWorkspacePath + "/" + r.file
      : r.file;
    const safeAbsPath = absPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const scorePercent = Math.round(r.score * 100);

    html += `
      <div class="result-group">
        <div class="result-file" onclick="openFile('${safeAbsPath}', ${r.start_line}, null)">
          <i class="chevron">▼</i>${escHtml(r.file)}
        </div>
        <div class="result-items-list">
          <div class="result-item" onclick="openFile('${safeAbsPath}', ${r.start_line}, null)">
            <span class="ai-type-badge">${escHtml(r.type)}</span>
            <span class="ai-fn-name">${escHtml(r.name)}</span>
            <span class="ai-score">${scorePercent}% match</span>
            <span class="line-num">lines ${r.start_line}–${r.end_line}</span>
            <pre class="ai-content">${escHtml((r.content || "").slice(0, 300))}</pre>
          </div>
        </div>
      </div>`;
  });

  resultEl.innerHTML = html;
}

// ── Render Results ────────────────────────────────────────────────────────────
// Takes the search results from the backend and builds HTML to display them
// Results are grouped by file, each showing line number + highlighted content

function renderResults(data) {
  // AI search has its own renderer (function-level cards with score)
  if (data.searchType === "ai") {
    renderAiResults(data);
    return;
  }

  lastResultsData = data.results || [];
  if (!lastResultsData.length) {
    resultEl.innerHTML = '<div class="no-results">No results found.</div>';
    return;
  }

  const wsPath = data.workspacePath || "";

  // Group results by file path
  // e.g. { "src/auth.py": [result1, result2], "src/login.py": [result3] }
  const byFile = {};
  lastResultsData.forEach((r) => {
    if (!byFile[r.file]) byFile[r.file] = [];
    byFile[r.file].push(r);
  });
  const filesCount = Object.keys(byFile).length;

  // Summary line: "Found 12 results in 3 files (45ms)"
  let html =
    '<div class="status-line">Found <strong>' +
    data.total + "</strong> results in <strong>" +
    filesCount + "</strong> files (" + data.time_ms + "ms)</div>";

  // Build one collapsible group per file
  for (const [filePath, hits] of Object.entries(byFile)) {
    // Show relative path instead of absolute for readability
    const displayPath = filePath.startsWith(wsPath)
      ? filePath.slice(wsPath.length).replace(/^[\\/]/, "")
      : filePath;

    html += `<div class="result-group">
      <div class="result-file" onclick="this.parentElement.classList.toggle('collapsed')">
        <i class="chevron">▼</i>${escHtml(displayPath)}
      </div>
      <div class="result-items-list">`;

    hits.forEach((hit) => {
      // Build the highlighted line content
      // Wraps matched text in <mark> tags for yellow highlighting
      let lineText = hit.content;
      let highlighted = "";
      let lastIdx = 0;
      const matches = [...(hit.matches || [])].sort((a, b) => a[0] - b[0]);

      matches.forEach(([start, end]) => {
        highlighted += escHtml(lineText.substring(lastIdx, start));
        highlighted += "<mark>" + escHtml(lineText.substring(start, end)) + "</mark>";
        lastIdx = end;
      });
      highlighted += escHtml(lineText.substring(lastIdx));

      // Escape path for use in onclick attribute
      const safePath = filePath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const matchJson = JSON.stringify(matches[0] || null);

      // Each result row: clicking it opens the file at that line
      html += `<div class="result-item" onclick="openFile('${safePath}', ${hit.line}, ${matchJson})">
        <span class="line-num">${hit.line}</span>
        <span class="line-content">${highlighted}</span>
      </div>`;
    });

    html += "</div></div>";
  }

  resultEl.innerHTML = html;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Tells extension.ts to open a file at a specific line and highlight the match
function openFile(file, line, match) {
  vscode.postMessage({ command: "openFile", file, line, match });
}

// Escapes HTML special characters to prevent XSS when inserting user content
// e.g. "a < b" → "a &lt; b"
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Message Listener ──────────────────────────────────────────────────────────
// Receives messages FROM extension.ts and updates the UI accordingly

window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.command) {

    // Extension sent workspace info → show in the top bar
    // Also store the path so AI results can build absolute file paths
    case "workspaceInfo":
      document.getElementById("wsName").textContent = msg.workspaceName;
      document.getElementById("wsPath").textContent = msg.workspacePath;
      currentWorkspacePath = msg.workspacePath;
      break;

    // Search started → show loading text
    case "searchLoading":
      resultEl.innerHTML = "Searching...";
      break;

    // Search finished → render results
    case "searchResult":
      renderResults(msg.data);
      break;

    // Search failed → show error (e.g. backend not running)
    case "searchError":
      resultEl.innerHTML = '<div class="error-msg">' + msg.error + "</div>";
      break;

    // Replace finished → re-run search to refresh results
    case "replaceComplete":
      doSearch();
      break;
  }
});

// Tell extension.ts the webview is ready
// extension.ts responds by sending workspaceInfo
vscode.postMessage({ command: "webviewReady" });
