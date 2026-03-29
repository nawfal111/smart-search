import * as vscode from "vscode";

export async function handleReplace(result: any, replaceText: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const uri = vscode.Uri.file(result.file);

  if (result.matches && result.matches.length > 0) {
    const [start, end] = result.matches[0];
    const range = new vscode.Range(
      new vscode.Position(result.line - 1, start),
      new vscode.Position(result.line - 1, end),
    );
    edit.replace(uri, range, replaceText);
    await vscode.workspace.applyEdit(edit);
  }
}

export async function handleReplaceAll(results: any[], replaceText: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();

  for (const res of results) {
    const uri = vscode.Uri.file(res.file);
    const matches = [...(res.matches || [])].reverse();

    for (const [start, end] of matches) {
      const range = new vscode.Range(
        new vscode.Position(res.line - 1, start),
        new vscode.Position(res.line - 1, end),
      );
      edit.replace(uri, range, replaceText);
    }
  }

  await vscode.workspace.applyEdit(edit);
}
