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
// TWO-PHASE BATCH INDEXING (indexWorkspace):
//   Old approach: process one file at a time — scan it, then immediately call
//   the backend to embed it, then move to the next file. 100 changed files =
//   100 sequential HTTP calls. Very slow for large projects.
//
//   New approach:
//     Phase 1 — Scan all files locally (no network, fast).
//               Collect every changed function across the whole workspace.
//               Status bar: "scanning 1/1000..."
//     Phase 2 — Send all changed functions to the backend in batches of 50.
//               Each batch: GPT summarizes all 50 in parallel, Voyage AI embeds
//               all 50 in one call, Pinecone upserts all 50 in one call.
//               Status bar: "embedding batch 1/20..."
//   100 changed files = 2 HTTP calls instead of 100.
//
// INCREMENTAL SAVE (crash/restart recovery):
//   index.json is saved after every batch completes, not just at the end.
//   If VS Code closes or Python crashes mid-way through embedding:
//     - Completed batches' hashes are already in index.json
//     - On restart: Phase 1 skips those functions (hash matches)
//     - Only the remaining batches are re-embedded
//   Without this, a crash at batch 9/20 would restart all 20 batches.
//
// RESULT: Only changed functions get re-embedded. Progress survives restarts.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { loadIndex, saveIndex, LocalIndex } from "./localIndex";
import { chunkFile, LANGUAGE_MAP, Chunk } from "./chunker";
import { getProjectId } from "./projectId";
import { getUserId } from "./userId";
import { getBackendUrl } from "../config";

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

// Max chunks per /index call — keeps HTTP body small and stays within Voyage AI's
// 128-input batch limit. 50 chunks × ~3KB each = ~150KB per request.
const EMBED_BATCH_SIZE = 50;

// Plan for one changed file — computed locally, no network calls
interface FilePlan {
  relativePath: string;
  fileHash:     string;
  toEmbed:      Chunk[];   // new/changed functions that need embedding
  toDelete:     string[];  // stale Pinecone IDs to remove
  kept:         LocalIndex[string]["functions"]; // unchanged functions (keep as-is)
}

// ── Send a batch of chunks to the backend for embedding ───────────────────────
// toEmbed   = new or changed functions that need a vector in Pinecone
// toDelete  = IDs of old/removed functions to delete from Pinecone
// namespace = "{projectId}::{userId}" — keeps each user's vectors separate
async function updateEmbeddings(
  toEmbed: Chunk[],
  toDelete: string[],
  namespace: string,
): Promise<void> {
  // Strip any null/undefined that could slip in from stale or malformed index entries.
  // Pinecone rejects null IDs with a 400, so we drop them before sending.
  const safeDelete = toDelete.filter((id): id is string => typeof id === "string" && id.length > 0);
  if (toEmbed.length === 0 && safeDelete.length === 0) return;
  const response = await fetch(`${getBackendUrl()}/index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chunks: toEmbed, delete_ids: safeDelete, namespace }),
  });
  if (!response.ok) throw new Error(`/index error: ${response.status}`);
}

// ── Pure-local: compute what has changed in one file ─────────────────────────
// No network calls — only hashing and chunking (both in-process, fast).
// Returns null if the file is unchanged (file hash matches stored hash).
// Called in a tight loop over all files during workspace scan.
function collectFileChanges(
  filePath: string,
  content: string,
  localIndex: LocalIndex,
  workspacePath: string,
): FilePlan | null {

  const relativePath = path.relative(workspacePath, filePath);

  // LEVEL 1: Hash the whole file — skip entirely if unchanged
  const fileHash = hashContent(content);
  const existing = localIndex[relativePath];
  if (existing && existing.fileHash === fileHash) return null;

  // LEVEL 2: File changed — chunk locally and diff against stored hashes
  const language = getLanguage(filePath);
  const allChunks = chunkFile(content, relativePath, language);

  // Exclude class-level chunks — they contain all their methods combined, so
  // they always outscore individual methods in Pinecone (see workspaceIndexer header).
  const chunks = allChunks.filter((c: Chunk) => c.type !== "class");

  const existingFunctions = existing?.functions ?? {};
  const toEmbed:  Chunk[]  = [];
  const toDelete: string[] = [];
  const kept: LocalIndex[string]["functions"] = {};

  for (const chunk of chunks) {
    const funcHash    = hashFunction(chunk.content);
    const existingFunc = existingFunctions[chunk.name];
    if (!existingFunc || existingFunc.hash !== funcHash) {
      if (existingFunc) toDelete.push(existingFunc.chunkId); // replace old vector
      toEmbed.push({ ...chunk, language });
    } else {
      kept[chunk.name] = existingFunc; // unchanged — carry forward
    }
  }

  // Functions that were in the file before but are gone now
  const currentNames = new Set(chunks.map((c: Chunk) => c.name));
  for (const funcName of Object.keys(existingFunctions)) {
    if (!currentNames.has(funcName)) toDelete.push(existingFunctions[funcName].chunkId);
  }

  return { relativePath, fileHash, toEmbed, toDelete, kept };
}

// ── Public: index the entire workspace ───────────────────────────────────────
// TWO-PHASE approach for speed:
//   Phase 1 — Scan  (fast, local): walk every file, hash it, diff functions.
//             No network calls. Just CPU + disk I/O.
//   Phase 2 — Embed (slow, network): send all changed chunks to the backend
//             in batches of EMBED_BATCH_SIZE. Each batch: GPT summaries run
//             in parallel, Voyage AI embeds the whole batch in one call,
//             Pinecone upserts in one call.
//
// Before this change: 1 network round-trip per file → N files = N × ~2s.
// After:              1 round-trip per batch of 50 → N files = N/50 × ~2s.
export async function indexWorkspace(
  _context: vscode.ExtensionContext,
  statusBar: vscode.StatusBarItem,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return;

  const workspacePath = folders[0].uri.fsPath;
  const namespace     = `${getProjectId()}::${getUserId()}`;
  const localIndex    = loadIndex();
  const files         = walkFiles(workspacePath);

  // ── Phase 1: Scan all files locally (no network) ────────────────────────────
  const plans:     FilePlan[] = [];
  const deleteIds: string[]   = []; // vectors to remove (deleted/stale functions)
  let processed = 0;

  for (const filePath of files) {
    statusBar.text = `$(sync~spin) Smart Search: scanning ${processed + 1}/${files.length}`;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_BYTES) { processed++; continue; }
      const content = fs.readFileSync(filePath, "utf8");
      const plan = collectFileChanges(filePath, content, localIndex, workspacePath);
      if (plan) {
        plans.push(plan);
        deleteIds.push(...plan.toDelete);
      }
    } catch (e) {
      console.error(`[SmartSearch] Failed to scan ${filePath}:`, e);
    }
    processed++;
  }

  // Remove files from the index that no longer exist on disk
  for (const relativePath of Object.keys(localIndex)) {
    if (!fs.existsSync(path.join(workspacePath, relativePath))) {
      deleteIds.push(...Object.values(localIndex[relativePath].functions).map((f) => f.chunkId));
      delete localIndex[relativePath];
    }
  }

  // ── Phase 2: Embed in batches (network calls) ────────────────────────────────
  const allToEmbed  = plans.flatMap((p) => p.toEmbed);
  const totalBatches = Math.ceil(allToEmbed.length / EMBED_BATCH_SIZE) || 1;

  if (allToEmbed.length > 0 || deleteIds.length > 0) {
    if (allToEmbed.length === 0) {
      // Only deletions — one call, no embedding
      await updateEmbeddings([], deleteIds, namespace);
    } else {
      // Build a lookup so we can update localIndex per-batch as batches succeed.
      // This way a restart picks up from where it left off instead of re-embedding
      // everything from scratch.
      const chunkToPlans = new Map<Chunk, FilePlan>();
      for (const plan of plans) {
        for (const chunk of plan.toEmbed) chunkToPlans.set(chunk, plan);
      }

      for (let i = 0; i < allToEmbed.length; i += EMBED_BATCH_SIZE) {
        const batchNum = Math.floor(i / EMBED_BATCH_SIZE) + 1;
        statusBar.text = `$(sync~spin) Smart Search: embedding ${batchNum}/${totalBatches}`;
        const batch = allToEmbed.slice(i, i + EMBED_BATCH_SIZE);
        // Send all delete IDs with the first batch to avoid stale vectors surfacing
        await updateEmbeddings(batch, i === 0 ? deleteIds : [], namespace);

        // Persist progress: update localIndex for this batch's chunks and save.
        // If VS Code closes or Python crashes after this point, the next startup
        // will skip these chunks (their hashes are now stored) and resume from
        // the next batch rather than starting over.
        for (const chunk of batch) {
          const plan = chunkToPlans.get(chunk)!;
          if (!localIndex[plan.relativePath]) {
            localIndex[plan.relativePath] = { fileHash: plan.fileHash, functions: { ...plan.kept } };
          }
          localIndex[plan.relativePath].functions[chunk.name] = {
            hash: hashFunction(chunk.content),
            chunkId: chunk.id,
          };
        }
        saveIndex(localIndex);
      }
    }
  }

  // Persist any plans whose chunks were all unchanged (kept functions only —
  // no embedding needed, but the fileHash still needs updating so Phase 1
  // skips them correctly on the next run).
  for (const plan of plans) {
    if (plan.toEmbed.length === 0) {
      localIndex[plan.relativePath] = { fileHash: plan.fileHash, functions: { ...plan.kept } };
    }
  }

  saveIndex(localIndex);

  statusBar.text = `$(check) Smart Search: ${plans.length} files updated`;
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
  const wipeResponse = await fetch(`${getBackendUrl()}/wipe`, {
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
// Called every time the user saves a file.
// Single file = no benefit from batching — collect changes and send immediately.
export async function indexSingleFile(
  _context: vscode.ExtensionContext,
  filePath: string,
  content: string,
): Promise<void> {
  if (!INDEXABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return;
  const workspacePath = folders[0].uri.fsPath;

  const namespace  = `${getProjectId()}::${getUserId()}`;
  const localIndex = loadIndex();

  try {
    const plan = collectFileChanges(filePath, content, localIndex, workspacePath);
    if (!plan) return; // file unchanged

    await updateEmbeddings(plan.toEmbed, plan.toDelete, namespace);

    // Update localIndex only after successful network call
    const newFunctions = { ...plan.kept };
    for (const chunk of plan.toEmbed) {
      newFunctions[chunk.name] = { hash: hashFunction(chunk.content), chunkId: chunk.id };
    }
    localIndex[plan.relativePath] = { fileHash: plan.fileHash, functions: newFunctions };
    saveIndex(localIndex);
    console.log(`[SmartSearch] Re-indexed: ${plan.relativePath}`);
  } catch (e) {
    console.error(`[SmartSearch] Failed to index ${filePath}:`, e);
  }
}
