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

      // 🎯 Wait for webview to be ready before sending workspace info
      panel.webview.onDidReceiveMessage(
        async (message) => {
          console.log("=== EXTENSION RECEIVED MESSAGE ===");
          console.log("Command:", message.command);

          switch (message.command) {
            case "webviewReady":
              // Webview is now ready to receive messages
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

// 🎯 Separate function to send workspace info
function sendWorkspaceInfo(panel: vscode.WebviewPanel) {
  console.log("=== SENDING WORKSPACE INFO ===");

  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (workspaceFolders && workspaceFolders.length > 0) {
    currentSearchPath = workspaceFolders[0].uri.fsPath;

    console.log("✅ Workspace detected:");
    console.log("  Path:", currentSearchPath);
    console.log("  Name:", workspaceFolders[0].name);

    panel.webview.postMessage({
      command: "workspaceInfo",
      workspacePath: currentSearchPath,
      workspaceName: workspaceFolders[0].name,
    });
  } else {
    currentSearchPath = null;

    console.log("❌ No workspace detected");

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
    // Show loading state
    panel.webview.postMessage({
      command: "searchLoading",
    });

    console.log("=== SEARCH REQUEST ===");
    console.log("Query:", query);
    console.log("Type:", type);
    console.log("currentSearchPath:", currentSearchPath);

    // 🎯 Use global variable instead of querying workspace
    if (!currentSearchPath) {
      throw new Error(
        "No folder selected. Please open a folder or use Browse.",
      );
    }

    console.log("✅ Sending to backend:");
    console.log("  workspacePath:", currentSearchPath);

    // Send workspace path to backend so it knows where to search
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
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Send results back to webview
    panel.webview.postMessage({
      command: "searchResult",
      data: data,
    });
  } catch (err) {
    // Send error back to webview
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

  // Let user pick a different folder to search in
  const folderUri = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select Folder to Search",
  });

  console.log("Folder picker result:", folderUri);

  if (folderUri && folderUri[0]) {
    // 🎯 Update global variable
    currentSearchPath = folderUri[0].fsPath;
    const folderName =
      currentSearchPath.split(/[/\\]/).pop() || currentSearchPath;

    console.log("✅ User selected folder:");
    console.log("  Path:", currentSearchPath);
    console.log("  Name:", folderName);

    // Send the new workspace info to webview
    panel.webview.postMessage({
      command: "workspaceInfo",
      workspacePath: currentSearchPath,
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
            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }

            body {
                font-family: var(--vscode-font-family);
                padding: 20px;
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
            }

            h2 {
                margin-bottom: 20px;
                color: var(--vscode-foreground);
            }

            .form-group {
                margin-bottom: 15px;
            }

            label {
                display: block;
                margin-bottom: 5px;
                font-size: 13px;
                color: var(--vscode-foreground);
            }

            input, select {
                width: 100%;
                padding: 8px 10px;
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 2px;
                font-size: 13px;
                font-family: var(--vscode-font-family);
            }

            input:focus, select:focus {
                outline: 1px solid var(--vscode-focusBorder);
                outline-offset: -1px;
            }

            button {
                padding: 8px 14px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 2px;
                cursor: pointer;
                font-size: 13px;
                font-family: var(--vscode-font-family);
                transition: background-color 0.2s;
            }

            button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }

            button:active {
                background-color: var(--vscode-button-background);
            }

            button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            #result-container {
                margin-top: 20px;
            }

            #result {
                background-color: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
                padding: 15px;
                border-radius: 4px;
                border: 1px solid var(--vscode-panel-border);
                font-family: var(--vscode-editor-font-family);
                font-size: 12px;
                white-space: pre-wrap;
                overflow-x: auto;
                max-height: 500px;
                overflow-y: auto;
            }

            .loading {
                color: var(--vscode-descriptionForeground);
                font-style: italic;
            }

            .error {
                color: var(--vscode-errorForeground);
                background-color: var(--vscode-inputValidation-errorBackground);
                border: 1px solid var(--vscode-inputValidation-errorBorder);
                padding: 10px;
                border-radius: 4px;
            }

            .spinner {
                display: inline-block;
                width: 14px;
                height: 14px;
                border: 2px solid var(--vscode-foreground);
                border-top-color: transparent;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-right: 8px;
                vertical-align: middle;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        </style>
    </head>
    <body>
        <h2>Smart Code Search</h2>

        <div class="form-group">
            <label for="workspace">Searching in:</label>
            <div style="display: flex; gap: 10px; align-items: center;">
                <input 
                    id="workspace"
                    type="text"
                    readonly
                    placeholder="No folder selected..."
                    style="flex: 1; cursor: default;"
                />
                <button onclick="browseFolder()" style="white-space: nowrap;">
                    📁 Browse
                </button>
            </div>
            <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 5px;">
                Path: <span id="workspacePath">-</span>
            </div>
            <div id="noFolderWarning" style="display: none; margin-top: 10px; padding: 10px; background-color: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); border-radius: 4px; color: var(--vscode-inputValidation-warningForeground);">
                ⚠️ <strong>No folder open!</strong><br>
                Please open a folder in VSCode (File → Open Folder) or click "Browse" to select a folder to search.
            </div>
        </div>

        <div class="form-group">
            <label for="query">Search Query</label>
            <input 
                id="query"
                type="text"
                placeholder="Enter your search query..."
                autofocus
            />
        </div>

        <div class="form-group">
            <label for="type">Search Type</label>
            <select id="type">
                <option value="normal">Normal Search</option>
                <option value="smart">Smart Search</option>
                <option value="embedding">Embedding Search</option>
            </select>
        </div>

        <button id="searchBtn" onclick="send()">
            Search
        </button>

        <div id="result-container"></div>

        <script>
            const vscode = acquireVsCodeApi();
            const resultContainer = document.getElementById('result-container');
            const searchBtn = document.getElementById('searchBtn');
            const queryInput = document.getElementById('query');
            const workspaceInput = document.getElementById('workspace');
            const workspacePathSpan = document.getElementById('workspacePath');
            const noFolderWarning = document.getElementById('noFolderWarning');

            let currentWorkspacePath = null;

            // Allow Enter key to trigger search
            queryInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    send();
                }
            });

            function browseFolder() {
                console.log("=== BROWSE BUTTON CLICKED IN WEBVIEW ===");
                console.log("Sending browseFolder message to extension...");
                
                vscode.postMessage({
                    command: 'browseFolder'
                });
                
                console.log("Message sent!");
            }

            function send() {
                const query = queryInput.value.trim();
                const type = document.getElementById('type').value;

                // 🐛 DEBUG: Log what we're about to send
                console.log("=== WEBVIEW SENDING ===");
                console.log("Query:", query);
                console.log("Type:", type);
                console.log("currentWorkspacePath:", currentWorkspacePath);

                if (!query) {
                    showError('Please enter a search query');
                    return;
                }

                if (!currentWorkspacePath) {
                    showError('❌ No folder selected!\n\nPlease:\n1. Open a folder in VSCode (File → Open Folder)\n2. Or click the "📁 Browse" button to select a folder');
                    return;
                }

                // Send message to extension
                vscode.postMessage({
                    command: 'search',
                    query: query,
                    type: type
                });
            }

            function showLoading() {
                searchBtn.disabled = true;
                resultContainer.innerHTML = '<div class="loading"><span class="spinner"></span>Searching...</div>';
            }

            function showResult(data) {
                searchBtn.disabled = false;
                resultContainer.innerHTML = 
                    '<pre id="result">' + 
                    JSON.stringify(data, null, 2) + 
                    '</pre>';
            }

            function showError(error) {
                searchBtn.disabled = false;
                resultContainer.innerHTML = 
                    '<div class="error">❌ ' + error + '</div>';
            }

            // Listen for messages from the extension
            window.addEventListener('message', event => {
                const message = event.data;
                
                // 🐛 DEBUG: Log all messages received
                console.log("=== WEBVIEW RECEIVED MESSAGE ===");
                console.log("Command:", message.command);
                console.log("Full message:", message);

                switch (message.command) {
                    case 'workspaceInfo':
                        // ✅ Workspace detected - update UI and hide warning
                        console.log("✅ Setting workspace:");
                        console.log("  Name:", message.workspaceName);
                        console.log("  Path:", message.workspacePath);
                        
                        currentWorkspacePath = message.workspacePath;
                        workspaceInput.value = message.workspaceName;
                        workspacePathSpan.textContent = message.workspacePath;
                        noFolderWarning.style.display = 'none';
                        searchBtn.disabled = false;
                        break;
                    case 'noWorkspace':
                        // ❌ No workspace - show warning and disable search
                        console.log("❌ No workspace detected");
                        
                        currentWorkspacePath = null;
                        workspaceInput.value = '';
                        workspacePathSpan.textContent = 'No folder open in VSCode';
                        noFolderWarning.style.display = 'block';
                        searchBtn.disabled = false; // Keep enabled so user sees the error message
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

            // 🎯 CRITICAL: Tell extension that webview is ready to receive messages
            // This must be AFTER setting up the event listener!
            console.log("=== WEBVIEW READY ===");
            console.log("Sending webviewReady message to extension...");
            vscode.postMessage({ command: 'webviewReady' });
        </script>
    </body>
    </html>
    `;
}

export function deactivate() {}
