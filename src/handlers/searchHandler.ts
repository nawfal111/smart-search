// ─────────────────────────────────────────────────────────────────────────────
// searchHandler.ts  —  SEARCH REQUEST HANDLER
//
// Called when the user clicks Search in the UI.
// Sends the search query to the Python backend and returns results to the UI.
//
// FLOW:
//   1. Show "Searching..." in the UI
//   2. Get the workspace folder path from VS Code
//   3. POST the query to Python backend at localhost:8000/search
//   4. Backend searches files and returns matches
//   5. Send results back to the webview to render
//   6. If anything fails, send an error message to the UI
//
// SUPPORTS:
//   - Normal search: regex/text matching across all files
//   - AI search: semantic search using Pinecone (future)
// ─────────────────────────────────────────────────────────────────────────────

import * as vscode from "vscode";
import { getProjectId } from "../indexer/projectId";
import { getUserId } from "../indexer/userId";

export async function handleSearch(
  panel: vscode.WebviewPanel,
  query: string,
  searchType: string,      // "normal" or "ai"
  matchCase: boolean,      // whether search is case-sensitive
  matchWholeWord: boolean, // match whole words only
  useRegex: boolean,       // treat query as a regex pattern
  filesInclude: string,    // glob pattern for files to include e.g. "*.ts"
  filesExclude: string,    // glob pattern for files to exclude e.g. "node_modules"
  threshold: number | null, // AI search: min score 1–100, null = use backend default (35%)
): Promise<void> {
  try {
    // Tell the UI to show a loading state while we wait for results
    panel.webview.postMessage({ command: "searchLoading" });

    // Get the root folder of the open workspace
    // The backend needs this to know which directory to search in
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error("No folder/workspace is open.");
    }
    const workspacePath = folders[0].uri.fsPath;

    // For AI search, build the namespace = "{projectId}::{userId}"
    // This scopes the Pinecone query to only this user's vectors for this project
    let namespace = "";
    if (searchType === "ai") {
      namespace = `${getProjectId()}::${getUserId()}`;
    }

    // Send search request to the Python backend
    // Normal: backend walks files and runs regex matching
    // AI: backend embeds the query and queries Pinecone for similar functions
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
        namespace,   // used by AI search to scope Pinecone query
        threshold,   // used by AI search: min score 1–100, null = backend default (35%)
      }),
    });

    if (!response.ok) {
      const errData: any = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error: ${response.status}`);
    }

    // Send results to the webview to be rendered as a list
    const data = await response.json();
    panel.webview.postMessage({ command: "searchResult", data });

  } catch (err) {
    // Send error message to the UI if anything went wrong
    // Common error: Python backend not running
    panel.webview.postMessage({
      command: "searchError",
      error: err instanceof Error ? err.message : "Backend connection failed",
    });
  }
}
