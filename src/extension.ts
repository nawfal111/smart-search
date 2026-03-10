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

      // Handle messages from the webview
      panel.webview.onDidReceiveMessage(
        async (message) => {
          console.log("=== EXTENSION RECEIVED MESSAGE FROM WEBVIEW ===");
          console.log("Command:", message.command);
          console.log("Full message:", message);

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

            default:
              console.log("⚠️ Unknown command:", message.command);
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

  console.log("=== WORKSPACE DETECTION ===");
  console.log("workspaceFolders:", workspaceFolders);
  console.log("Count:", workspaceFolders ? workspaceFolders.length : 0);

  if (workspaceFolders && workspaceFolders.length > 0) {
    const wsPath = workspaceFolders[0].uri.fsPath;
    const wsName = workspaceFolders[0].name;

    console.log("✅ FOLDER DETECTED:");
    console.log("  Name:", wsName);
    console.log("  Path:", wsPath);

    panel.webview.postMessage({
      command: "workspaceInfo",
      workspacePath: wsPath,
      workspaceName: wsName,
    });
  } else {
    console.log("❌ NO FOLDER DETECTED");

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

    console.log("=== SEARCH REQUEST ===");
    console.log("Query:", query);
    console.log("Type:", type);
    console.log("workspaceFolders:", workspaceFolders);

    if (!workspaceFolders || workspaceFolders.length === 0) {
      console.log("❌ NO WORKSPACE at search time!");
      throw new Error(
        "No folder/workspace is open. Please open a folder first.",
      );
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;

    console.log("✅ Sending to backend:");
    console.log("  workspacePath:", workspacePath);

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
      throw new Error(`HTTP error! status: ${response.status}`);
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
  console.log("=== BROWSE FOLDER CLICKED ===");

  const folderUri = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select Folder to Search",
  });

  console.log("Folder picker result:", folderUri);

  if (folderUri && folderUri[0]) {
    const selectedPath = folderUri[0].fsPath;
    const folderName = selectedPath.split(/[/\\]/).pop() || selectedPath;

    console.log("✅ User selected folder:");
    console.log("  Path:", selectedPath);
    console.log("  Name:", folderName);

    panel.webview.postMessage({
      command: "workspaceInfo",
      workspacePath: selectedPath,
      workspaceName: folderName,
    });

    vscode.window.showInformationMessage(
      `Search folder changed to: ${folderName}`,
    );
  } else {
    console.log("❌ User cancelled folder selection");
  }
}

function getWebviewContent(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<meta http-equiv="Content-Security-Policy" 
content="default-src 'none';
style-src 'unsafe-inline';
script-src 'unsafe-inline';
connect-src http://localhost:8000;">

<title>Smart Search</title>

<style>

*{box-sizing:border-box;margin:0;padding:0;}

body{
font-family:var(--vscode-font-family);
padding:20px;
color:var(--vscode-foreground);
background-color:var(--vscode-editor-background);
}

h2{margin-bottom:20px;}

.form-group{margin-bottom:15px;}

label{
display:block;
margin-bottom:5px;
font-size:13px;
}

input,select{
width:100%;
padding:8px 10px;
background-color:var(--vscode-input-background);
color:var(--vscode-input-foreground);
border:1px solid var(--vscode-input-border);
border-radius:2px;
font-size:13px;
}

button{
padding:8px 14px;
background-color:var(--vscode-button-background);
color:var(--vscode-button-foreground);
border:none;
border-radius:2px;
cursor:pointer;
font-size:13px;
}

button:hover{
background-color:var(--vscode-button-hoverBackground);
}

#result-container{margin-top:20px;}

.loading{
color:var(--vscode-descriptionForeground);
font-style:italic;
}

.error{
color:var(--vscode-errorForeground);
background-color:var(--vscode-inputValidation-errorBackground);
padding:10px;
border-radius:4px;
}

.spinner{
display:inline-block;
width:14px;
height:14px;
border:2px solid var(--vscode-foreground);
border-top-color:transparent;
border-radius:50%;
animation:spin 1s linear infinite;
margin-right:8px;
}

@keyframes spin{
to{transform:rotate(360deg);}
}

</style>
</head>

<body>

<h2>Smart Code Search</h2>

<div class="form-group">
<label for="workspace">Searching in:</label>

<div style="display:flex;gap:10px;align-items:center;">
<input id="workspace" type="text" readonly placeholder="No folder selected..." style="flex:1;cursor:default;">
<button onclick="browseFolder()">📁 Browse</button>
</div>

<div style="font-size:11px;margin-top:5px;">
Path: <span id="workspacePath">-</span>
</div>

<div id="noFolderWarning" style="display:none;margin-top:10px;padding:10px;border-radius:4px;">
⚠️ <strong>No folder open!</strong><br>
Open a folder or click Browse.
</div>

</div>

<div class="form-group">
<label for="query">Search Query</label>
<input id="query" placeholder="Enter your search query..." autofocus>
</div>

<div class="form-group">
<label for="type">Search Type</label>
<select id="type">
<option value="normal">Normal Search</option>
<option value="smart">Smart Search</option>
<option value="embedding">Embedding Search</option>
</select>
</div>

<button id="searchBtn" onclick="send()">Search</button>

<div id="result-container"></div>

<script>

const vscode = acquireVsCodeApi();

const resultContainer=document.getElementById('result-container');
const searchBtn=document.getElementById('searchBtn');
const queryInput=document.getElementById('query');
const workspaceInput=document.getElementById('workspace');
const workspacePathSpan=document.getElementById('workspacePath');
const noFolderWarning=document.getElementById('noFolderWarning');

let currentWorkspacePath=null;

queryInput.addEventListener('keypress',e=>{
if(e.key==='Enter'){send();}
});

function browseFolder(){

console.log("=== BROWSE BUTTON CLICKED IN WEBVIEW ===");

vscode.postMessage({
command:'browseFolder'
});

}

function send(){

const query=queryInput.value.trim();
const type=document.getElementById('type').value;

console.log("=== WEBVIEW SENDING ===");
console.log("Query:",query);
console.log("Type:",type);
console.log("Workspace:",currentWorkspacePath);

if(!query){
showError('Please enter a search query');
return;
}

if(!currentWorkspacePath){
showError('No folder selected');
return;
}

vscode.postMessage({
command:'search',
query:query,
type:type
});

}

function showLoading(){
searchBtn.disabled=true;
resultContainer.innerHTML='<div class="loading"><span class="spinner"></span>Searching...</div>';
}

function showResult(data){
searchBtn.disabled=false;
resultContainer.innerHTML='<pre>'+JSON.stringify(data,null,2)+'</pre>';
}

function showError(error){
searchBtn.disabled=false;
resultContainer.innerHTML='<div class="error">❌ '+error+'</div>';
}

window.addEventListener('message',event=>{

const message=event.data;

console.log("=== WEBVIEW RECEIVED ===",message);

switch(message.command){

case 'workspaceInfo':

currentWorkspacePath=message.workspacePath;
workspaceInput.value=message.workspaceName;
workspacePathSpan.textContent=message.workspacePath;
noFolderWarning.style.display='none';

break;

case 'noWorkspace':

currentWorkspacePath=null;
workspaceInput.value='';
workspacePathSpan.textContent='No folder open';
noFolderWarning.style.display='block';

break;

case 'searchLoading':
showLoading();
break;

case 'searchResult':
showResult(message.data);
break;

case 'searchError':
showError(message.error);
break;

}

});

// 🔥 THIS IS THE FIX
vscode.postMessage({command:"webviewReady"});

</script>

</body>
</html>
`;
}
export function deactivate() {}
