import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

interface FileEntry {
  hash: string;
  chunkIds: string[];
}

export interface LocalIndex {
  [filePath: string]: FileEntry;
}

function getIndexPath(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "index.json");
}

export function loadIndex(context: vscode.ExtensionContext): LocalIndex {
  const indexPath = getIndexPath(context);
  try {
    if (fs.existsSync(indexPath)) {
      return JSON.parse(fs.readFileSync(indexPath, "utf8"));
    }
  } catch {}
  return {};
}

export function saveIndex(
  context: vscode.ExtensionContext,
  index: LocalIndex,
): void {
  const storageDir = context.globalStorageUri.fsPath;
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  fs.writeFileSync(getIndexPath(context), JSON.stringify(index, null, 2));
}
