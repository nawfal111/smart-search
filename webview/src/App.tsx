import React, { useEffect, useState } from "react";
import SearchBar, { QueryOptions } from "./components/SearchBar";
import ResultGroup, { Result } from "./components/ResultGroup";

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

interface Workspace {
  name: string;
  path: string;
}

const App: React.FC = () => {
  const [workspace, setWorkspace] = useState<Workspace>({ name: "", path: "" });
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState("");
  const [queryOptions, setQueryOptions] = useState<QueryOptions>({
    matchCase: false,
    matchWord: false,
    useRegex: false,
  });

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.command) {
        case "workspaceInfo":
          setWorkspace({ name: msg.workspaceName, path: msg.workspacePath });
          break;
        case "searchLoading":
          setStatus("Searching…");
          break;
        case "searchResult":
          setResults(msg.data.results || []);
          setStatus(
            `Found ${msg.data.total} result(s) in ${msg.data.time_ms} ms`,
          );
          break;
        case "searchError":
          setStatus(`Error: ${msg.error}`);
          break;
        case "replaceComplete":
          doSearch();
          break;
      }
    };

    window.addEventListener("message", handler);
    vscode.postMessage({ command: "webviewReady" });

    return () => window.removeEventListener("message", handler);
  }, []);

  const doSearch = () => {
    const include =
      (document.getElementById("filesInclude") as HTMLInputElement)?.value ||
      "";
    const exclude =
      (document.getElementById("filesExclude") as HTMLInputElement)?.value ||
      "";

    vscode.postMessage({
      command: "search",
      query: (document.getElementById("query") as HTMLInputElement).value,
      matchCase: queryOptions.matchCase,
      matchWholeWord: queryOptions.matchWord,
      useRegex: queryOptions.useRegex,
      filesInclude: include,
      filesExclude: exclude,
      searchType: "normal",
    });
  };

  return (
    <div style={{ padding: 16, fontFamily: "var(--vscode-font-family)" }}>
      <h2>Smart Search</h2>
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 10,
          background: "var(--vscode-input-background)",
          padding: "5px 8px",
        }}
      >
        <span style={{ fontWeight: 600 }}>{workspace.name}</span>
        <span style={{ opacity: 0.6 }}>{workspace.path}</span>
      </div>

      <SearchBar
        queryOptions={queryOptions}
        setQueryOptions={setQueryOptions}
        doSearch={doSearch}
        vscode={vscode}
      />

      <div style={{ marginTop: 14 }}>{status}</div>

      {results.length > 0 &&
        Object.values(groupByFile(results)).map((group) => (
          <ResultGroup
            key={group[0].file}
            results={group}
            workspacePath={workspace.path}
            vscode={vscode}
          />
        ))}
    </div>
  );
};

function groupByFile(results: Result[]) {
  const map: Record<string, Result[]> = {};
  results.forEach((r) => {
    if (!map[r.file]) map[r.file] = [];
    map[r.file].push(r);
  });
  return map;
}

export default App;
