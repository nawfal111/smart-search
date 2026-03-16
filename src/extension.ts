import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "smart-search.openSearch",
    () => {
      const panel = vscode.window.createWebviewPanel(
        "smartSearch",
        "Smart Search",
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true },
      );

      const bundleUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "dist", "bundle.js"),
      );

      panel.webview.html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
        </head>
        <body>
          <div id="root"></div>
          <script src="${bundleUri}"></script>
        </body>
      </html>
    `;

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
              openFileAtPosition(message);
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
  panel.webview.postMessage({ command: "searchLoading" });
  const response = await fetch("http://localhost:8000/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  const data = await response.json();
  panel.webview.postMessage({ command: "searchResult", data });
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

async function openFileAtPosition(message: any) {
  const uri = vscode.Uri.file(message.file);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.One,
  });
  if (message.match) {
    const [start, end] = message.match;
    const range = new vscode.Range(
      message.line - 1,
      start,
      message.line - 1,
      end,
    );
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }
}

export function deactivate() {}
