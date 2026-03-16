import React, { useEffect, useRef, useState } from "react";
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

  // FIX: keep a ref to the latest queryOptions so the doSearch called from
  // the replaceComplete handler always sees current values (avoids stale closure)
  const queryOptionsRef = useRef(queryOptions);
  useEffect(() => {
    queryOptionsRef.current = queryOptions;
  }, [queryOptions]);

  const doSearch = () => {
    const query = (
      document.getElementById("query") as HTMLInputElement
    )?.value?.trim();
    const include =
      (document.getElementById("filesInclude") as HTMLInputElement)?.value ??
      "";
    const exclude =
      (document.getElementById("filesExclude") as HTMLInputElement)?.value ??
      "";

    if (!query) {
      setStatus("Please enter a search query.");
      return;
    }

    const opts = queryOptionsRef.current;

    vscode.postMessage({
      command: "search",
      query,
      matchCase: opts.matchCase,
      matchWholeWord: opts.matchWord,
      useRegex: opts.useRegex,
      filesInclude: include,
      filesExclude: exclude,
      searchType: "normal",
    });
  };

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.command) {
        case "workspaceInfo":
          setWorkspace({ name: msg.workspaceName, path: msg.workspacePath });
          break;
        case "noWorkspace":
          setWorkspace({ name: "", path: "" });
          setStatus("⚠️ No folder open. Please open a folder in VSCode.");
          break;
        case "searchLoading":
          setStatus("Searching…");
          setResults([]);
          break;
        case "searchResult":
          setResults(msg.data.results || []);
          setStatus(
            msg.data.total > 0
              ? `Found ${msg.data.total} result(s) in ${msg.data.time_ms} ms`
              : `No results for "${msg.data.query}"`,
          );
          break;
        case "searchError":
          setStatus(`Error: ${msg.error}`);
          break;
        case "replaceComplete":
          doSearch(); // re-run search so UI reflects the updated files
          break;
      }
    };

    window.addEventListener("message", handler);
    vscode.postMessage({ command: "webviewReady" });
    return () => window.removeEventListener("message", handler);
  }, []); // empty deps — doSearch is stable via ref

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "var(--vscode-font-family)",
        fontSize: "var(--vscode-font-size)",
      }}
    >
      <h2
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          opacity: 0.6,
          marginBottom: 10,
        }}
      >
        Smart Search
      </h2>

      {/* Workspace bar */}
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 10,
          background: "var(--vscode-input-background)",
          padding: "5px 8px",
          borderRadius: 2,
          fontSize: 11,
          overflow: "hidden",
        }}
      >
        <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
          Workspace:
        </span>
        <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
          {workspace.name || "—"}
        </span>
        <span
          style={{
            opacity: 0.55,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {workspace.path}
        </span>
      </div>

      <SearchBar
        queryOptions={queryOptions}
        setQueryOptions={setQueryOptions}
        doSearch={doSearch}
        vscode={vscode}
      />

      {/* Status line */}
      {status && (
        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            color: "var(--vscode-descriptionForeground)",
          }}
        >
          {status}
        </div>
      )}

      {/* Results */}
      <div style={{ marginTop: 10 }}>
        {Object.values(groupByFile(results)).map((group) => (
          <ResultGroup
            key={group[0].file}
            results={group}
            workspacePath={workspace.path}
            vscode={vscode}
          />
        ))}
      </div>
    </div>
  );
};

function groupByFile(results: Result[]): Record<string, Result[]> {
  const map: Record<string, Result[]> = {};
  results.forEach((r) => {
    (map[r.file] = map[r.file] || []).push(r);
  });
  return map;
}

export default App;
