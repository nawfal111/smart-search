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
        },
      );

      panel.webview.html = getWebviewContent(context);

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

            case "openFile":
              const uri = vscode.Uri.file(message.file);
              const doc = await vscode.workspace.openTextDocument(uri);
              const editor = await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: false,
                preview: false,
              });

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

//helper functions

function getWebviewContent(context: vscode.ExtensionContext): string {
  const htmlPath = path.join(context.extensionPath, "src", "webview.html");
  return fs.readFileSync(htmlPath, "utf8");
}

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
      throw new Error("No folder/workspace is open.");
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
      error: err instanceof Error ? err.message : "Backend connection failed",
    });
  }
}

async function handleReplace(result: any, replaceText: string) {
  const edit = new vscode.WorkspaceEdit();
  const uri = vscode.Uri.file(result.file);

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

export function deactivate() {}
