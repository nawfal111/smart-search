const vscode = acquireVsCodeApi();

const queryEl = document.getElementById("query");
const replaceEl = document.getElementById("replaceQuery");
const resultEl = document.getElementById("result");

let searchType = "normal";
let matchCase = false,
  matchWord = false,
  useRegex = false;
let lastResultsData = [];

// ── Mode Toggle ───────────────────────────────────────────────────────────────

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

document.getElementById("searchBtn").onclick = doSearch;

document.getElementById("replaceBtn").onclick = () => {
  if (lastResultsData.length)
    vscode.postMessage({
      command: "replace",
      result: lastResultsData[0],
      replaceText: replaceEl.value,
    });
};

document.getElementById("replaceAllBtn").onclick = () => {
  if (lastResultsData.length)
    vscode.postMessage({
      command: "replaceAll",
      results: lastResultsData,
      replaceText: replaceEl.value,
    });
};

// ── Search ────────────────────────────────────────────────────────────────────

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

// ── Render Results ────────────────────────────────────────────────────────────

function renderResults(data) {
  if (data.message) {
    resultEl.innerHTML = `<div class="ai-status-box">${data.message}</div>`;
    return;
  }

  lastResultsData = data.results || [];
  if (!lastResultsData.length) {
    resultEl.innerHTML = '<div class="no-results">No results found.</div>';
    return;
  }

  const wsPath = data.workspacePath || "";
  const byFile = {};
  lastResultsData.forEach((r) => {
    if (!byFile[r.file]) byFile[r.file] = [];
    byFile[r.file].push(r);
  });
  const filesCount = Object.keys(byFile).length;

  let html =
    '<div class="status-line">Found <strong>' +
    data.total +
    "</strong> results in <strong>" +
    filesCount +
    "</strong> files (" +
    data.time_ms +
    "ms)</div>";

  for (const [filePath, hits] of Object.entries(byFile)) {
    const displayPath = filePath.startsWith(wsPath)
      ? filePath.slice(wsPath.length).replace(/^[\\/]/, "")
      : filePath;

    html += `<div class="result-group">
      <div class="result-file" onclick="this.parentElement.classList.toggle('collapsed')">
        <i class="chevron">▼</i>${escHtml(displayPath)}
      </div>
      <div class="result-items-list">`;

    hits.forEach((hit) => {
      let lineText = hit.content;
      let highlighted = "";
      let lastIdx = 0;
      const matches = [...(hit.matches || [])].sort((a, b) => a[0] - b[0]);

      matches.forEach(([start, end]) => {
        highlighted += escHtml(lineText.substring(lastIdx, start));
        highlighted +=
          "<mark>" + escHtml(lineText.substring(start, end)) + "</mark>";
        lastIdx = end;
      });
      highlighted += escHtml(lineText.substring(lastIdx));

      const safePath = filePath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const matchJson = JSON.stringify(matches[0] || null);

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

function openFile(file, line, match) {
  vscode.postMessage({ command: "openFile", file, line, match });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Message Listener ──────────────────────────────────────────────────────────

window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.command) {
    case "workspaceInfo":
      document.getElementById("wsName").textContent = msg.workspaceName;
      document.getElementById("wsPath").textContent = msg.workspacePath;
      break;
    case "searchLoading":
      resultEl.innerHTML = "Searching...";
      break;
    case "searchResult":
      renderResults(msg.data);
      break;
    case "searchError":
      resultEl.innerHTML = '<div class="error-msg">' + msg.error + "</div>";
      break;
    case "replaceComplete":
      doSearch();
      break;
  }
});

vscode.postMessage({ command: "webviewReady" });
