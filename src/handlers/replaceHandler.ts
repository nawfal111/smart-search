// ─────────────────────────────────────────────────────────────────────────────
// replaceHandler.ts  —  REPLACE LOGIC
//
// Handles text replacement directly in the user's files inside VS Code.
// Uses VS Code's WorkspaceEdit API — this is the same system VS Code uses
// internally for refactoring, so it supports undo/redo properly.
//
// TWO FUNCTIONS:
//   handleReplace    → replaces the first match of ONE result
//   handleReplaceAll → replaces ALL matches across ALL files at once
//
// HOW positions work:
//   Each search result contains match positions as character offsets on the line:
//   e.g. matches: [[4, 12]] means characters 4 to 12 on that line
//   We convert these to VS Code Range objects to make the edit
// ─────────────────────────────────────────────────────────────────────────────

import * as vscode from "vscode";

// Replace the first match in a single search result
// Called when user clicks "Replace" on one result
export async function handleReplace(result: any, replaceText: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const uri = vscode.Uri.file(result.file);

  if (result.matches && result.matches.length > 0) {
    // Get the character positions of the first match on the line
    const [start, end] = result.matches[0];

    // Create a Range: from (line, start) to (line, end)
    // Line numbers from the backend are 1-based, VS Code uses 0-based
    const range = new vscode.Range(
      new vscode.Position(result.line - 1, start),
      new vscode.Position(result.line - 1, end),
    );

    // Queue the replacement in the edit batch
    edit.replace(uri, range, replaceText);

    // Apply the edit to the file (supports undo with Ctrl+Z)
    await vscode.workspace.applyEdit(edit);
  }
}

// Replace ALL matches across all files at once
// Called when user clicks "Replace All"
export async function handleReplaceAll(results: any[], replaceText: string): Promise<void> {
  // One WorkspaceEdit can contain changes to multiple files
  const edit = new vscode.WorkspaceEdit();

  for (const res of results) {
    const uri = vscode.Uri.file(res.file);

    // Reverse the matches so we replace from bottom to top
    // This is important: if we replace from top to bottom, the character
    // positions of later matches shift after each replacement
    // Replacing bottom-up keeps all positions accurate
    const matches = [...(res.matches || [])].reverse();

    for (const [start, end] of matches) {
      const range = new vscode.Range(
        new vscode.Position(res.line - 1, start),
        new vscode.Position(res.line - 1, end),
      );
      edit.replace(uri, range, replaceText);
    }
  }

  // Apply all replacements across all files in one operation
  await vscode.workspace.applyEdit(edit);
}
