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
          switch (message.command) {
            case "search":
              await handleSearch(panel, message.query, message.type);
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

    const response = await fetch("http://localhost:8000/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, type }),
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

            // Allow Enter key to trigger search
            queryInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    send();
                }
            });

            function send() {
                const query = queryInput.value.trim();
                const type = document.getElementById('type').value;

                if (!query) {
                    showError('Please enter a search query');
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

                switch (message.command) {
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
        </script>
    </body>
    </html>
    `;
}

export function deactivate() {}
