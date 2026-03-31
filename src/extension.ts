import * as vscode from "vscode";
import { getWebviewContent, sendWorkspaceInfo } from "./utils/webviewManager";
import { handleSearch } from "./handlers/searchHandler";
import { handleReplace, handleReplaceAll } from "./handlers/replaceHandler";
import { indexWorkspace, indexSingleFile } from "./indexer/workspaceIndexer";

export function activate(context: vscode.ExtensionContext) {
  //status bar item 
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBar.text = "$(search) Smart Search";
  statusBar.show();
  context.subscriptions.push(statusBar);

  //index workspace on open 
  indexWorkspace(context, statusBar).catch((e) =>
    console.error("[SmartSearch] Indexing error:", e),
  );

  // re-index a file every time the user saves it
  vscode.workspace.onDidSaveTextDocument(
    (document) => {
      indexSingleFile(context, document.uri.fsPath, document.getText()).catch(
        (e) => console.error("[SmartSearch] Re-index error:", e),
      );
    },
    undefined,
    context.subscriptions,
  );

  // search panel command
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

            case "openFile": {
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

export function deactivate() {}
