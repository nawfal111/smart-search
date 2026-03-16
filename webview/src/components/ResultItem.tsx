import React from "react";
import { Result } from "./ResultGroup";

interface ResultItemProps {
  result: Result;
  vscode: any;
}

const ResultItem: React.FC<ResultItemProps> = ({ result, vscode }) => {
  const highlightContent = () => {
    let line = result.content;
    const sorted = [...(result.matches || [])].sort((a, b) => a[0] - b[0]);
    let highlighted = "",
      last = 0;
    sorted.forEach(([start, end]) => {
      highlighted +=
        line.substring(last, start) +
        "<mark>" +
        line.substring(start, end) +
        "</mark>";
      last = end;
    });
    highlighted += line.substring(last);
    return { __html: highlighted };
  };

  const openFile = () => {
    vscode.postMessage({
      command: "openFile",
      file: result.file,
      line: result.line,
      match: result.matches[0] || null,
    });
  };

  return (
    <div
      className="result-item"
      onClick={openFile}
      style={{ cursor: "pointer", display: "flex" }}
    >
      <span
        className="line-num"
        style={{
          padding: "3px 8px",
          color: "var(--vscode-editorLineNumber-foreground)",
          minWidth: 40,
          textAlign: "right",
          opacity: 0.7,
        }}
      >
        {result.line}
      </span>
      <span
        className="line-content"
        style={{
          padding: "3px 8px",
          whiteSpace: "pre",
          overflow: "hidden",
          flex: 1,
        }}
        dangerouslySetInnerHTML={highlightContent()}
      ></span>
    </div>
  );
};

export default ResultItem;
