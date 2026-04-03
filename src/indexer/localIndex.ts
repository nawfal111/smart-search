// ─────────────────────────────────────────────────────────────────────────────
// localIndex.ts  —  LOCAL HASH STORAGE
//
// Manages the index.json file that stores function hashes for the current project.
//
// WHERE it's saved:
//   <workspace>/.smart-search/index.json
//
//   This is INSIDE the project folder, but gitignored (handled by projectId.ts).
//   It moves with the project — renaming or moving the folder keeps the hashes intact.
//   Each developer has their own copy on their own machine (gitignored = not shared).
//
// WHAT it stores (hashes only — NO embeddings, those stay in Pinecone):
//   {
//     "src/auth.py": {
//       "fileHash": "a3f2c1d4",              ← MD5 of the whole file (fast pre-filter)
//       "functions": {
//         "verify_token": {
//           "hash":    "d4e2f1b8",            ← MD5 of just this function's content
//           "chunkId": "src/auth.py::verify_token"  ← ID used in Pinecone
//         },
//         "check_password": {
//           "hash":    "b8c3a2f1",
//           "chunkId": "src/auth.py::check_password"
//         }
//       }
//     }
//   }
//
// NOTE: All paths are RELATIVE to the workspace root (e.g. "src/auth.py").
//   This is what makes the index portable — it doesn't matter where the
//   project folder lives on disk.
//
// WHY separate from embeddings:
//   Embeddings are 1536 floats per function — storing them locally would make
//   this file huge. Pinecone stores them in the cloud, we only store the
//   tiny hashes needed to decide whether re-embedding is needed.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { getSmartSearchPath } from "./projectId";

// ── Types ─────────────────────────────────────────────────────────────────────

// One function/class entry: its content hash + its Pinecone vector ID
export interface FunctionEntry {
  hash:    string;  // MD5 of the function's content (normalized, formatting-insensitive)
  chunkId: string;  // e.g. "src/auth.py::verify_token" — used to delete from Pinecone
}

// One file entry: the whole-file hash + all its function entries
export interface FileEntry {
  fileHash:  string;  // MD5 of the whole file — quick check: did anything change at all?
  functions: { [functionName: string]: FunctionEntry };
}

// The full index: maps relative file path → file entry
// e.g. { "src/auth.py": { fileHash: "...", functions: { ... } } }
export interface LocalIndex {
  [relativePath: string]: FileEntry;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns the full path to index.json inside .smart-search/
// Returns null if no workspace is open
function getIndexPath(): string | null {
  const dir = getSmartSearchPath();
  if (!dir) return null;
  return path.join(dir, "index.json");
}

// ── Public API ────────────────────────────────────────────────────────────────

// Reads the index from .smart-search/index.json
// Returns empty {} if the file doesn't exist yet (first time running)
export function loadIndex(): LocalIndex {
  const indexPath = getIndexPath();
  if (!indexPath) return {};

  try {
    if (fs.existsSync(indexPath)) {
      return JSON.parse(fs.readFileSync(indexPath, "utf8"));
    }
  } catch (e) {
    console.warn("[SmartSearch] Could not read index.json:", e);
  }

  return {};
}

// Writes the updated index to .smart-search/index.json
// Creates .smart-search/ if it doesn't exist yet
export function saveIndex(index: LocalIndex): void {
  const indexPath = getIndexPath();
  if (!indexPath) return;

  const dir = path.dirname(indexPath);
  try {
    // Ensure .smart-search/ exists before writing
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
  } catch (e) {
    console.error("[SmartSearch] Could not save index.json:", e);
  }
}
