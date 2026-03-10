import * as vscode from "vscode";

let currentSearchPath: string | null = null;

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

      panel.webview.html = getWebviewContent();

      panel.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {
            case "webviewReady":
              sendWorkspaceInfo(panel);
              break;

            case "search":
              await handleSearch(panel, message.query, message.type);
              break;

            case "browseFolder":
              await handleBrowseFolder(panel);
              break;
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
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (workspaceFolders && workspaceFolders.length > 0) {
    currentSearchPath = workspaceFolders[0].uri.fsPath;

    panel.webview.postMessage({
      command: "workspaceInfo",
      workspacePath: currentSearchPath,
      workspaceName: workspaceFolders[0].name,
    });
  } else {
    currentSearchPath = null;

    panel.webview.postMessage({
      command: "noWorkspace",
    });
  }
}

async function handleSearch(
  panel: vscode.WebviewPanel,
  query: string,
  type: string,
) {
  try {
    panel.webview.postMessage({
      command: "searchLoading",
    });

    if (!currentSearchPath) {
      throw new Error("No folder selected.");
    }

    const response = await fetch("http://localhost:8000/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        type,
        workspacePath: currentSearchPath,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const data = await response.json();

    panel.webview.postMessage({
      command: "searchResult",
      data: data,
    });
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

async function handleBrowseFolder(panel: vscode.WebviewPanel) {
  const folderUri = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select Folder to Search",
  });

  if (folderUri && folderUri[0]) {
    currentSearchPath = folderUri[0].fsPath;

    const folderName =
      currentSearchPath.split(/[/\\]/).pop() || currentSearchPath;

    panel.webview.postMessage({
      command: "workspaceInfo",
      workspacePath: currentSearchPath,
      workspaceName: folderName,
    });

    vscode.window.showInformationMessage(
      `Search folder changed to: ${folderName}`,
    );
  }
}

function getWebviewContent(): string {
  return `
<!DOCTYPE html>
<html>
<body>

<h2>Smart Code Search</h2>

<label>Searching in:</label><br>
<input id="workspace" readonly placeholder="No folder selected"/>
<button onclick="browse()">Browse</button>

<br><br>

<input id="query" placeholder="Search query"/>
<select id="type">
<option value="normal">Normal</option>
<option value="smart">Smart</option>
<option value="embedding">Embedding</option>
</select>

<br><br>

<button onclick="search()">Search</button>

<pre id="result"></pre>

<script>

const vscode = acquireVsCodeApi();

let currentWorkspacePath = null;

function browse(){
    vscode.postMessage({command:'browseFolder'})
}

function search(){

    const query = document.getElementById("query").value
    const type = document.getElementById("type").value

    if(!currentWorkspacePath){
        document.getElementById("result").textContent="No folder selected"
        return
    }

    vscode.postMessage({
        command:'search',
        query:query,
        type:type
    })
}

window.addEventListener('message',event=>{

    const msg=event.data

    switch(msg.command){

        case 'workspaceInfo':

            currentWorkspacePath=msg.workspacePath

            document.getElementById("workspace").value=msg.workspaceName

        break

        case 'noWorkspace':

            currentWorkspacePath=null

            document.getElementById("workspace").value="No workspace"

        break

        case 'searchLoading':

            document.getElementById("result").textContent="Searching..."

        break

        case 'searchResult':

            document.getElementById("result").textContent=
            JSON.stringify(msg.data,null,2)

        break

        case 'searchError':

            document.getElementById("result").textContent=msg.error

        break
    }

})

vscode.postMessage({command:"webviewReady"})

</script>

</body>
</html>
`;
}

export function deactivate() {}
