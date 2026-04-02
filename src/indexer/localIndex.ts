// ─────────────────────────────────────────────────────────────────────────────
// localIndex.ts  —  LOCAL INDEX STORAGE
//
// Manages the index.json file saved on the user's machine.
// This file is the "memory" of what has already been indexed in Pinecone.
//
// WHY we need this:
//   Every time the workspace opens or a file is saved, we need to know:
//   "Has this function already been embedded in Pinecone?"
//   Without this file, we would re-embed everything every time → slow + costly.
//
// WHERE it's saved:
//   ~/Library/Application Support/Code/User/globalStorage/nawfal.smart-search/index.json
//   This is VS Code's private storage for the extension — outside the project folder,
//   never committed to git, persists across VS Code restarts.
//
// STRUCTURE of index.json:
//   {
//     "/project/src/auth.py": {
//       "fileHash": "a3f2c1d4",              ← MD5 of the whole file (fast pre-filter)
//       "functions": {
//         "verify_token": {
//           "hash": "d4e2f1b8",              ← MD5 of just this function's content
//           "chunkId": "src/auth.py::verify_token"  ← ID used in Pinecone
//         },
//         "check_password": {
//           "hash": "b8c3a2f1",
//           "chunkId": "src/auth.py::check_password"
//         }
//       }
//     }
//   }
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// Stores hash + Pinecone ID for one function
interface FunctionEntry {
  hash: string;     // MD5 of the function's content — changes when code changes
  chunkId: string;  // e.g. "src/auth.py::verify_token" — used to delete from Pinecone
}

// Stores the whole-file hash + all function entries for one file
interface FileEntry {
  fileHash: string;  // MD5 of the whole file — quick check: did anything change at all?
  functions: { [functionName: string]: FunctionEntry };
}

// The full index: maps file path → file entry
export interface LocalIndex {
  [filePath: string]: FileEntry;
}

// Returns the full path to index.json in VS Code's private storage
function getIndexPath(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "index.json");
}

// Reads the index from disk
// Returns empty {} if the file doesn't exist yet (first time running)
export function loadIndex(context: vscode.ExtensionContext): LocalIndex {
  const indexPath = getIndexPath(context);
  try {
    if (fs.existsSync(indexPath)) {
      return JSON.parse(fs.readFileSync(indexPath, "utf8"));
    }
  } catch {}
  return {};
}

// Writes the updated index to disk
// Creates the storage directory if it doesn't exist yet
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
