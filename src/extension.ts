// ─────────────────────────────────────────────────────────────────────────────
// extension.ts  —  ENTRY POINT
//
// This is the first file VS Code runs when the extension activates.
// It does 7 things:
//   1. Creates a status bar item at the bottom of VS Code to show progress
//   2. Checks that the Python backend is running (warns if not)
//   3. Starts indexing the workspace in the background (so AI search works)
//   4. Re-indexes a file every time the user saves it
//   5. Removes deleted/renamed files from the index in real time
//   6. Registers the "Re-index Workspace" command (wipe + full re-index)
//   7. Opens the search panel when the user runs the "Smart Search" command
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as vscode from "vscode";
import { getWebviewContent, sendWorkspaceInfo } from "./utils/webviewManager";
import { handleSearch } from "./handlers/searchHandler";
import { handleReplace, handleReplaceAll } from "./handlers/replaceHandler";
import {
  indexWorkspace,
  indexSingleFile,
  removeFileFromIndex,
  reindexWorkspace,
} from "./indexer/workspaceIndexer";

// activate() is called automatically by VS Code when the extension starts
export function activate(context: vscode.ExtensionContext) {

  // ── 1. Status Bar ──────────────────────────────────────────────────────────
  // Shows indexing progress at the bottom of VS Code
  // Example: "⟳ Smart Search: indexing 3/47..." or "✓ Smart Search: 5 files updated"
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBar.text = "$(search) Smart Search";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // ── 2. Backend Health Check ────────────────────────────────────────────────
  // Pings the Python backend before indexing to confirm it's running.
  // If the backend is down, shows a one-time warning notification.
  // The indexing run below will fail gracefully with its own error log —
  // this check just gives the user a clear, actionable message up front.
  fetch("http://localhost:8000/health")
    .then((res) => { if (!res.ok) throw new Error(); })
    .catch(() => {
      vscode.window.showWarningMessage(
        "Smart Search: backend is not running. Start it with: python3 server.py",
      );
    });

  // ── 3. Index Workspace on Open ─────────────────────────────────────────────
  // Runs in background — does NOT block VS Code from opening
  // Flow: walk files → hash file → if changed → chunk into functions (local, TypeScript)
  //       → hash each function → if changed →
  //           1. Summarize via GPT (plain English description of what the function does)
  //           2. Embed via Voyage AI (summary + code → 1536-float vector)
  //           3. Save vector to Pinecone (under namespace = projectId::userId)
  //       → save function hashes to .smart-search/index.json (local, gitignored)
  // On first run: indexes everything
  // On subsequent runs: only re-embeds functions that actually changed
  indexWorkspace(context, statusBar).catch((e) =>
    console.error("[SmartSearch] Indexing error:", e),
  );

  // ── 4. Re-index on File Save ───────────────────────────────────────────────
  // Every time the user saves a file, we re-check ONLY that file
  // If the file content changed → re-embed only the functions that changed
  // This keeps Pinecone always up to date without re-indexing everything
  vscode.workspace.onDidSaveTextDocument(
    (document) => {
      indexSingleFile(context, document.uri.fsPath, document.getText()).catch(
        (e) => console.error("[SmartSearch] Re-index error:", e),
      );
    },
    undefined,
    context.subscriptions,
  );

  // ── 5. Remove Deleted Files from Index ────────────────────────────────────
  // When the user deletes a file (via VS Code's explorer or keyboard),
  // remove its vectors from Pinecone and its entry from index.json immediately.
  // Without this, deleted-file vectors would linger until the next full re-index.
  vscode.workspace.onDidDeleteFiles(
    (event) => {
      for (const { fsPath } of event.files) {
        removeFileFromIndex(context, fsPath).catch(
          (e) => console.error("[SmartSearch] Delete listener error:", e),
        );
      }
    },
    undefined,
    context.subscriptions,
  );

  // ── 6. Handle File Renames ─────────────────────────────────────────────────
  // When the user renames or moves a file:
  //   - Delete old file's Pinecone vectors (old chunk IDs are now stale)
  //   - Re-index the file at its new path (new chunk IDs based on new relative path)
  // Without this, searches would still surface the old path and old chunk IDs.
  vscode.workspace.onDidRenameFiles(
    (event) => {
      for (const { oldUri, newUri } of event.files) {
        removeFileFromIndex(context, oldUri.fsPath)
          .then(() => {
            try {
              const content = fs.readFileSync(newUri.fsPath, "utf8");
              return indexSingleFile(context, newUri.fsPath, content);
            } catch {
              return Promise.resolve();
            }
          })
          .catch((e) => console.error("[SmartSearch] Rename listener error:", e));
      }
    },
    undefined,
    context.subscriptions,
  );

  // ── 7. Re-index Workspace Command ─────────────────────────────────────────
  // Wipes Pinecone namespace + deletes index.json + re-indexes from scratch.
  // Use this when: index seems stale, project moved to a new machine,
  // or manual intervention is needed to force a clean state.
  const reindexDisposable = vscode.commands.registerCommand(
    "smart-search.reindex",
    async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Re-index Workspace: this will clear all existing Smart Search vectors and re-index from scratch. Continue?",
        "Yes, re-index",
        "Cancel",
      );
      if (confirm !== "Yes, re-index") return;

      reindexWorkspace(context, statusBar).catch((e) => {
        console.error("[SmartSearch] Re-index command error:", e);
        vscode.window.showErrorMessage(
          "Smart Search: Re-index failed. Is the backend running?",
        );
      });
    },
  );
  context.subscriptions.push(reindexDisposable);

  // ── 8. Search Panel Command ────────────────────────────────────────────────
  // Registers the "Smart Search" command that opens the search UI
  // User triggers this via Command Palette or keyboard shortcut
  const disposable = vscode.commands.registerCommand(
    "smart-search.openSearch",
    () => {
      // Create a webview panel — this is the search UI window inside VS Code
      const panel = vscode.window.createWebviewPanel(
        "smartSearch",
        "Smart Search",
        vscode.ViewColumn.One,
        {
          enableScripts: true,       // allows JavaScript to run in the webview
          retainContextWhenHidden: true, // keeps state when user switches tabs
        },
      );

      // Load the HTML/CSS/JS from the frontend/ folder into the panel
      panel.webview.html = getWebviewContent(context);

      // Tell the webview which workspace is open (shown in the top bar of the UI)
      sendWorkspaceInfo(panel);

      // If the user opens a different workspace folder, update the UI
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        sendWorkspaceInfo(panel);
      });

      // ── Message Router ─────────────────────────────────────────────────────
      // The webview (frontend) sends messages to here (extension)
      // This is how the UI communicates with VS Code and the Python backend
      panel.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {

            // Webview finished loading → send workspace info again
            case "webviewReady":
              sendWorkspaceInfo(panel);
              break;

            // User clicked Search → send to Python backend → return results to UI
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
                message.threshold ?? null,
              );
              break;

            // User clicked Replace on one result → edit that line in the file
            case "replace":
              await handleReplace(message.result, message.replaceText);
              panel.webview.postMessage({ command: "replaceComplete" });
              break;

            // User clicked Replace All → edit every matched line across all files
            case "replaceAll":
              await handleReplaceAll(message.results, message.replaceText);
              panel.webview.postMessage({ command: "replaceComplete" });
              break;

            // User clicked a result → open that file and jump to the exact line
            case "openFile": {
              const uri = vscode.Uri.file(message.file);
              const doc = await vscode.workspace.openTextDocument(uri);
              const editor = await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: false,
                preview: false,
              });

              if (message.match) {
                // Normal search: highlight the exact matched characters on the line
                const [start, end] = message.match;
                const posStart = new vscode.Position(message.line - 1, start);
                const posEnd   = new vscode.Position(message.line - 1, end);
                const range    = new vscode.Range(posStart, posEnd);
                editor.selection = new vscode.Selection(posStart, posEnd);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
              } else if (message.line) {
                // AI search: jump to the specific line (no text highlight — just move cursor there)
                const pos   = new vscode.Position(message.line - 1, 0);
                const range = new vscode.Range(pos, pos);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
              }
              break;
            }

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

// Called when the extension is deactivated (VS Code closes or extension disabled)
export function deactivate() {}
