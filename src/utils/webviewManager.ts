// ─────────────────────────────────────────────────────────────────────────────
// webviewManager.ts  —  FRONTEND LOADER
//
// Responsible for loading the search UI into the VS Code webview panel.
//
// WHY we read 3 separate files (html + css + js):
//   The frontend is split into index.html, styles.css, and main.js
//   for clean organization. But VS Code webviews need ONE self-contained
//   HTML string. So we read all 3, inline the CSS and JS into the HTML,
//   and return the final combined string.
//
// HOW it works:
//   index.html has two placeholders:
//     <!-- STYLES -->   ← replaced with <style>...css content...</style>
//     <!-- SCRIPTS -->  ← replaced with <script>...js content...</script>
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// Reads frontend/index.html + frontend/styles.css + frontend/main.js
// Inlines CSS and JS into the HTML and returns one complete HTML string
// This string is what gets rendered in the VS Code webview panel
export function getWebviewContent(context: vscode.ExtensionContext): string {
  const frontendDir = path.join(context.extensionPath, "frontend");

  const html = fs.readFileSync(path.join(frontendDir, "index.html"), "utf8");
  const css  = fs.readFileSync(path.join(frontendDir, "styles.css"), "utf8");
  const js   = fs.readFileSync(path.join(frontendDir, "main.js"),    "utf8");

  // Replace placeholders in HTML with actual CSS and JS content
  return html
    .replace("<!-- STYLES -->",  `<style>\n${css}\n</style>`)
    .replace("<!-- SCRIPTS -->", `<script>\n${js}\n</script>`);
}

// Sends the current workspace name and path to the webview UI
// The UI shows this in the top bar so the user knows which project is open
// Called on startup and whenever the workspace changes
export function sendWorkspaceInfo(panel: vscode.WebviewPanel): void {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    panel.webview.postMessage({
      command: "workspaceInfo",
      workspacePath: folders[0].uri.fsPath, // e.g. /Users/nawfal/projects/myapp
      workspaceName: folders[0].name,       // e.g. "myapp"
    });
  } else {
    panel.webview.postMessage({ command: "noWorkspace" });
  }
}
