import * as vscode from "vscode";

export async function handleSearch(
  panel: vscode.WebviewPanel,
  query: string,
  searchType: string,
  matchCase: boolean,
  matchWholeWord: boolean,
  useRegex: boolean,
  filesInclude: string,
  filesExclude: string,
): Promise<void> {
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
