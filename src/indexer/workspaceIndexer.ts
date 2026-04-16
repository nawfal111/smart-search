// ─────────────────────────────────────────────────────────────────────────────
// workspaceIndexer.ts  —  INDEXING LOGIC
//
// This file is the brain of the indexing pipeline.
// It decides WHAT needs to be indexed and WHEN.
//
// TWO-LEVEL HASHING STRATEGY:
//   Level 1 — File hash (fast pre-filter)
//     Hash the entire file content with MD5.
//     If the hash matches what's in index.json → file unchanged → skip everything.
//     This avoids any network calls for untouched files.
//
//   Level 2 — Function hash (precise check)
//     Only runs if the file hash changed.
//     The extension itself splits the file into functions (chunker.ts).
//     No network call needed — chunking is done locally in TypeScript.
//     Hash each function's content individually.
//     Compare with stored function hashes in index.json:
//       - Same hash   → function unchanged → skip (keep existing Pinecone vector)
//       - New hash    → function changed   → re-embed → update Pinecone
//       - Not in index → new function      → embed    → add to Pinecone
//       - In index but gone from file → deleted function → delete from Pinecone
//
// RESULT: Only the functions that actually changed get re-embedded.
// This saves time and API costs. Chunking is free (local), embedding costs money.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { loadIndex, saveIndex, LocalIndex } from "./localIndex";
import { chunkFile, LANGUAGE_MAP, Chunk } from "./chunker";
import { getProjectId } from "./projectId";
import { getUserId } from "./userId";

// Folders to skip when walking the workspace
// These never contain user code worth indexing
const IGNORE_FOLDERS = new Set([
  ".git", "node_modules", "vendor", "dist", "build",
  "__pycache__", ".venv", "out", ".next", "coverage",
  ".smart-search",  // our own folder — never index it
]);

// Only index files with these extensions
// Binary files, images, etc. are ignored
const INDEXABLE_EXTENSIONS = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx",
  ".java", ".go", ".rs", ".c", ".cpp",
  ".cs", ".rb", ".php", ".swift", ".kt",
]);

// Skip files larger than 500KB — usually auto-generated or minified
const MAX_FILE_BYTES = 500 * 1024;

// ── Helper: MD5 hash of any string ───────────────────────────────────────────
// Used to detect changes in file content and function content
function hashContent(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

// ── Helper: normalize code before hashing ─────────────────────────────────────
// Strips formatting-only changes so they don't trigger a re-embed:
//   - Trims trailing whitespace from each line
//   - Removes blank lines entirely
//   - Trims leading/trailing whitespace from the whole block
//
// Example: adding an empty line between two lines produces the SAME hash.
// Example: changing "  x = 1" to "x = 1" (indent) produces the SAME hash.
// The actual logic (the words) still has to change to get a different hash.
function normalizeCode(content: string): string {
  return content
    .split("\n")
    .map((line) => line.trimEnd())   // remove trailing spaces/tabs per line
    .filter((line) => line.trim() !== "") // drop blank / whitespace-only lines
    .join("\n")
    .trim();
}

// Hash used for FUNCTION-level comparison (formatting-insensitive)
function hashFunction(content: string): string {
  return hashContent(normalizeCode(content));
}

// ── Helper: get language name from file extension ─────────────────────────────
function getLanguage(filePath: string): string {
  return LANGUAGE_MAP[path.extname(filePath).toLowerCase()] ?? "text";
}

// ── Helper: recursively collect all indexable files in a directory ────────────
// Skips ignored folders (node_modules, .git, etc.)
function walkFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_FOLDERS.has(entry.name)) {
          results.push(...walkFiles(path.join(dir, entry.name)));
        }
      } else if (entry.isFile()) {
        if (INDEXABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          results.push(path.join(dir, entry.name));
        }
      }
    }
  } catch {}
  return results;
}

// ── Step 2: Send only changed chunks to backend for embedding ─────────────────
// toEmbed   = new or changed functions that need a vector in Pinecone
// toDelete  = IDs of old/removed functions to delete from Pinecone
// namespace = "{projectId}::{userId}" — keeps each user's vectors separate
// If nothing changed, this function returns immediately (no network call)
async function updateEmbeddings(
  toEmbed: Chunk[],
  toDelete: string[],
  namespace: string,
): Promise<void> {
  if (toEmbed.length === 0 && toDelete.length === 0) return;
  const response = await fetch("http://localhost:8000/index", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chunks: toEmbed, delete_ids: toDelete, namespace }),
  });
  if (!response.ok) throw new Error(`/index error: ${response.status}`);
}

// ── Core: process a single file ───────────────────────────────────────────────
// Returns true if anything changed, false if the file was skipped
//
// workspacePath → used to compute relative paths (so chunk IDs are portable)
// namespace     → "{projectId}::{userId}" scopes all Pinecone operations
async function processFile(
  filePath: string,
  content: string,
  localIndex: LocalIndex,
  workspacePath: string,
  namespace: string,
): Promise<boolean> {

  // Use relative path as the index key and chunk ID prefix
  // This keeps everything portable — moving the folder doesn't break anything
  const relativePath = path.relative(workspacePath, filePath);

  // LEVEL 1: Hash the whole file
  // If the file hash matches what's stored → nothing changed → skip entirely
  const fileHash = hashContent(content);
  const existing = localIndex[relativePath];
  if (existing && existing.fileHash === fileHash) {
    return false; // file unchanged, skip
  }

  // LEVEL 2: File changed — chunk locally (no network call)
  // Pass relativePath so chunk IDs are like "src/auth.py::verify_token"
  // instead of "/Users/nawfal/projects/myapp/src/auth.py::verify_token"
  const language = getLanguage(filePath);
  const allChunks = chunkFile(content, relativePath, language);

  // Exclude class-level chunks from indexing.
  // Reason: a class chunk contains all its methods' code combined, so it always
  // scores higher than individual methods in Pinecone — creating noise and
  // pushing the actually relevant function results down.
  // Individual methods are already indexed separately, so classes are redundant.
  // "file" type chunks are kept — they represent small files with no functions.
  const chunks = allChunks.filter((c: Chunk) => c.type !== "class");

  const existingFunctions = existing?.functions ?? {};
  const toEmbed: Chunk[] = [];       // functions to summarize (GPT) + embed (Voyage AI) + upsert (Pinecone)
  const toDelete: string[] = [];     // Pinecone IDs to remove
  const newFunctions: LocalIndex[string]["functions"] = {}; // updated index entry

  // Compare each function in the new file against the stored index
  for (const chunk of chunks) {
    const funcHash = hashFunction(chunk.content);
    const existingFunc = existingFunctions[chunk.name];

    if (!existingFunc || existingFunc.hash !== funcHash) {
      // Function is new or its content changed → needs re-embedding
      // Also add to toDelete if it existed before (replace old vector)
      if (existingFunc) {
        toDelete.push(existingFunc.chunkId);
      }
      toEmbed.push({ ...chunk, language });
    } else {
      // Function unchanged → keep its existing entry in the index
      newFunctions[chunk.name] = existingFunc;
    }
  }

  // Find functions that existed before but are no longer in the file (deleted)
  const newChunkNames = new Set(chunks.map((c: Chunk) => c.name));
  for (const funcName of Object.keys(existingFunctions)) {
    if (!newChunkNames.has(funcName)) {
      toDelete.push(existingFunctions[funcName].chunkId); // remove from Pinecone
    }
  }

  // Send changed/new functions to backend for embedding + Pinecone upsert
  // Send deleted function IDs to backend for Pinecone deletion
  await updateEmbeddings(toEmbed, toDelete, namespace);

  // Update the in-memory index with the newly embedded functions
  for (const chunk of toEmbed) {
    newFunctions[chunk.name] = {
      hash: hashFunction(chunk.content),
      chunkId: chunk.id,
    };
  }

  // Save updated file entry using relative path as the key
  localIndex[relativePath] = { fileHash, functions: newFunctions };
  return true;
}

// ── Public: index the entire workspace ───────────────────────────────────────
// Called once when VS Code opens
// Walks all files, processes only changed ones, updates index.json
export async function indexWorkspace(
  _context: vscode.ExtensionContext,
  statusBar: vscode.StatusBarItem,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return;

  const workspacePath = folders[0].uri.fsPath;

  // Build the namespace: scopes all Pinecone operations to this user + project
  // Format: "{projectId}::{userId}"
  // projectId → UUID in .smart-search/project-id (travels with the project folder)
  // userId    → MD5 of git global email (same across all machines for same developer)
  const namespace = `${getProjectId()}::${getUserId()}`;

  // Load whatever was saved last time (or empty {} on first run)
  // index.json is now in .smart-search/ inside the project folder
  const localIndex = loadIndex();
  const files = walkFiles(workspacePath);

  let processed = 0;
  let changed = 0;

  for (const filePath of files) {
    // Update status bar so user can see progress
    statusBar.text = `$(sync~spin) Smart Search: indexing ${processed + 1}/${files.length}`;

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_BYTES) { processed++; continue; } // skip large files

      const content = fs.readFileSync(filePath, "utf8");
      const didChange = await processFile(filePath, content, localIndex, workspacePath, namespace);
      if (didChange) changed++;
    } catch (e) {
      console.error(`[SmartSearch] Failed to index ${filePath}:`, e);
    }

    processed++;
  }

  // Clean up: remove files from the index that no longer exist on disk
  // Also delete their vectors from Pinecone
  // Keys are now relative paths — resolve them back to absolute for fs.existsSync
  for (const relativePath of Object.keys(localIndex)) {
    const absPath = path.join(workspacePath, relativePath);
    if (!fs.existsSync(absPath)) {
      const chunkIds = Object.values(localIndex[relativePath].functions).map(
        (f) => f.chunkId,
      );
      await updateEmbeddings([], chunkIds, namespace); // delete all vectors for this file
      delete localIndex[relativePath];
    }
  }

  // Save the final index to disk (.smart-search/index.json)
  saveIndex(localIndex);

  statusBar.text = `$(check) Smart Search: ${changed} files updated`;
  setTimeout(() => { statusBar.text = "$(search) Smart Search"; }, 5000);
}

// ── Public: remove a single file's vectors from the index ────────────────────
// Called when a file is deleted or renamed.
// Deletes all Pinecone vectors for that file and removes its entry from index.json.
// This keeps Pinecone in sync with the actual state of the workspace.
export async function removeFileFromIndex(
  _context: vscode.ExtensionContext,
  filePath: string,
): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  if (!INDEXABLE_EXTENSIONS.has(ext)) return;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return;
  const workspacePath = folders[0].uri.fsPath;

  const namespace  = `${getProjectId()}::${getUserId()}`;
  const localIndex = loadIndex();
  const relativePath = path.relative(workspacePath, filePath);
  const entry = localIndex[relativePath];
  if (!entry) return;

  const chunkIds = Object.values(entry.functions).map((f) => f.chunkId);
  if (chunkIds.length > 0) {
    await updateEmbeddings([], chunkIds, namespace); // delete vectors from Pinecone
  }
  delete localIndex[relativePath];
  saveIndex(localIndex);
  console.log(`[SmartSearch] Removed from index: ${relativePath} (${chunkIds.length} vectors)`);
}

// ── Public: wipe Pinecone + local index, then re-index from scratch ───────────
// Called by the "Smart Search: Re-index Workspace" command.
// Use this when the index is out of sync or the user wants a clean start:
//   1. Sends DELETE ALL to Pinecone for this namespace (removes every vector)
//   2. Deletes .smart-search/index.json so every file is treated as new
//   3. Runs a full indexing pass — re-embeds everything
export async function reindexWorkspace(
  context: vscode.ExtensionContext,
  statusBar: vscode.StatusBarItem,
): Promise<void> {
  const namespace = `${getProjectId()}::${getUserId()}`;

  // Step 1: wipe Pinecone namespace
  statusBar.text = "$(sync~spin) Smart Search: clearing Pinecone...";
  const wipeResponse = await fetch("http://localhost:8000/wipe", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ namespace }),
  });
  if (!wipeResponse.ok) throw new Error(`/wipe error: ${wipeResponse.status}`);

  // Step 2: delete local index.json so every file is treated as new on next run
  const smartSearchDir = path.join(
    vscode.workspace.workspaceFolders![0].uri.fsPath,
    ".smart-search",
  );
  const indexPath = path.join(smartSearchDir, "index.json");
  if (fs.existsSync(indexPath)) {
    fs.unlinkSync(indexPath);
  }

  // Step 3: full re-index from scratch
  await indexWorkspace(context, statusBar);
}

// ── Public: re-index a single file after save ─────────────────────────────────
// Called every time the user saves a file
// Only processes that one file — does NOT re-index the whole workspace
export async function indexSingleFile(
  _context: vscode.ExtensionContext,
  filePath: string,
  content: string,
): Promise<void> {
  // Ignore file types we don't index
  if (!INDEXABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return;
  const workspacePath = folders[0].uri.fsPath;

  const namespace = `${getProjectId()}::${getUserId()}`;
  const localIndex = loadIndex();

  try {
    const didChange = await processFile(filePath, content, localIndex, workspacePath, namespace);
    if (didChange) {
      saveIndex(localIndex); // persist updated hashes to disk
      console.log(`[SmartSearch] Re-indexed: ${filePath}`);
    }
  } catch (e) {
    console.error(`[SmartSearch] Failed to index ${filePath}:`, e);
  }
}
