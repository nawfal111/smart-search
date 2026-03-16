import React, { useState } from "react";
import ResultItem from "./ResultItem";

export interface Result {
  file: string;
  line: number;
  content: string;
  matches: [number, number][];
}

interface Props {
  results: Result[];
  workspacePath: string;
  vscode: any;
}

const ResultGroup: React.FC<Props> = ({ results, workspacePath, vscode }) => {
  const [collapsed, setCollapsed] = useState(false);
  const filePath = results[0].file;
  const displayPath = filePath.startsWith(workspacePath)
    ? filePath.slice(workspacePath.length).replace(/^[\\/]/, "")
    : filePath;

  return (
    <div className={`result-group ${collapsed ? "collapsed" : ""}`}>
      <div
        className="result-file"
        onClick={() => setCollapsed(!collapsed)}
        style={{ cursor: "pointer" }}
      >
        <i className="chevron">▼</i> {displayPath}
      </div>
      {!collapsed && (
        <div className="result-items-list">
          {results.map((r) => (
            <ResultItem key={r.line} result={r} vscode={vscode} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ResultGroup;
