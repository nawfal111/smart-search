import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export function getWebviewContent(context: vscode.ExtensionContext): string {
  const frontendDir = path.join(context.extensionPath, "frontend");
  const html = fs.readFileSync(path.join(frontendDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(frontendDir, "styles.css"), "utf8");
  const js = fs.readFileSync(path.join(frontendDir, "main.js"), "utf8");

  return html
    .replace("<!-- STYLES -->", `<style>\n${css}\n</style>`)
    .replace("<!-- SCRIPTS -->", `<script>\n${js}\n</script>`);
}

export function sendWorkspaceInfo(panel: vscode.WebviewPanel): void {
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
