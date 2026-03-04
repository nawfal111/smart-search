import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "smart-search.openSearch",
    () => {
      const panel = vscode.window.createWebviewPanel(
        "smartSearch",
        "Smart Search",
        vscode.ViewColumn.One,
        { enableScripts: true },
      );

      panel.webview.html = getWebviewContent();
    },
  );

  context.subscriptions.push(disposable);
}

function getWebviewContent(): string {
  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: sans-serif; padding: 20px;">
        <h2>Smart Code Search</h2>

        <input id="query"
               placeholder="Enter search query"
               style="width: 100%; padding: 8px; margin-bottom: 10px;" />

        <select id="type"
                style="width: 100%; padding: 8px; margin-bottom: 10px;">
            <option value="normal">Normal Search</option>
            <option value="smart">Smart Search</option>
            <option value="embedding">Embedding Search</option>
        </select>

        <button onclick="send()"
                style="padding: 8px 12px; cursor: pointer;">
            Search
        </button>

        <pre id="result"
             style="margin-top: 20px; background: #1e1e1e; color: white; padding: 10px;"></pre>

        <script>
            async function send() {
                const query = document.getElementById('query').value;
                const type = document.getElementById('type').value;

                try {
                    const response = await fetch('http://localhost:8000/search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query, type })
                    });

                    const data = await response.json();
                    document.getElementById('result').textContent =
                        JSON.stringify(data, null, 2);

                } catch (err) {
                    document.getElementById('result').textContent =
                        "Backend not running on localhost:8000";
                }
            }
        </script>
    </body>
    </html>
    `;
}

export function deactivate() {}
