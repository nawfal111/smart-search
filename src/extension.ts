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

      panel.webview.html = getWebviewContent();

      // Send workspace info immediately
      sendWorkspaceInfo(panel);

      // Update workspace if user changes folder
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
              await handleSearch(panel, message.query, message.type);
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
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (workspaceFolders && workspaceFolders.length > 0) {
    const wsPath = workspaceFolders[0].uri.fsPath;
    const wsName = workspaceFolders[0].name;

    panel.webview.postMessage({
      command: "workspaceInfo",
      workspacePath: wsPath,
      workspaceName: wsName,
    });
  } else {
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

    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error(
        "No folder/workspace is open. Please open a folder first.",
      );
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;

    const response = await fetch("http://localhost:8000/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        type,
        workspacePath,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
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

function getWebviewContent(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>

<meta charset="UTF-8">

<meta http-equiv="Content-Security-Policy"
content="default-src 'none';
style-src 'unsafe-inline';
script-src 'unsafe-inline';
connect-src http://localhost:8000;">

<style>

body{
font-family:var(--vscode-font-family);
padding:20px;
background:var(--vscode-editor-background);
color:var(--vscode-foreground);
}

input,select{
width:100%;
padding:8px;
margin-top:5px;
background:var(--vscode-input-background);
color:var(--vscode-input-foreground);
border:1px solid var(--vscode-input-border);
}

button{
margin-top:10px;
padding:8px 14px;
background:var(--vscode-button-background);
color:var(--vscode-button-foreground);
border:none;
cursor:pointer;
}

.loading{
margin-top:20px;
font-style:italic;
}

.error{
margin-top:20px;
color:var(--vscode-errorForeground);
}

</style>

</head>

<body>

<h2>Smart Code Search</h2>

<label>Searching in:</label>
<input id="workspace" readonly>
<div style="font-size:12px;margin-top:4px;">
Path: <span id="workspacePath">-</span>
</div>

<div id="noFolderWarning" style="display:none;margin-top:10px;">
⚠️ No folder open. Please open a folder in VSCode.
</div>

<br>

<label>Search Query</label>
<input id="query" placeholder="Enter search query">

<br>

<label>Search Type</label>
<select id="type">
<option value="normal">Normal Search</option>
<option value="smart">Smart Search</option>
<option value="embedding">Embedding Search</option>
</select>

<button id="searchBtn">Search</button>

<div id="result"></div>

<script>

const vscode = acquireVsCodeApi();

const workspaceInput=document.getElementById("workspace");
const workspacePath=document.getElementById("workspacePath");
const noFolder=document.getElementById("noFolderWarning");
const result=document.getElementById("result");
const query=document.getElementById("query");
const searchBtn=document.getElementById("searchBtn");

let currentWorkspace=null;

searchBtn.onclick=send;

query.addEventListener("keypress",e=>{
if(e.key==="Enter"){send();}
});

function send(){

const q=query.value.trim();
const type=document.getElementById("type").value;

if(!q){
showError("Please enter a search query");
return;
}

if(!currentWorkspace){
showError("No folder open in VSCode");
return;
}

vscode.postMessage({
command:"search",
query:q,
type:type
});

}

function showLoading(){
result.innerHTML='<div class="loading">Searching...</div>';
}

function showError(e){
result.innerHTML='<div class="error">'+e+'</div>';
}

function showResult(data){
result.innerHTML='<pre>'+JSON.stringify(data,null,2)+'</pre>';
}

window.addEventListener("message",event=>{

const message=event.data;

switch(message.command){

case "workspaceInfo":

currentWorkspace=message.workspacePath;
workspaceInput.value=message.workspaceName;
workspacePath.textContent=message.workspacePath;
noFolder.style.display="none";

break;

case "noWorkspace":

currentWorkspace=null;
workspaceInput.value="";
workspacePath.textContent="No folder open";
noFolder.style.display="block";

break;

case "searchLoading":
showLoading();
break;

case "searchResult":
showResult(message.data);
break;

case "searchError":
showError(message.error);
break;

}

});

vscode.postMessage({command:"webviewReady"});

</script>

</body>
</html>
`;
}

export function deactivate() {}
