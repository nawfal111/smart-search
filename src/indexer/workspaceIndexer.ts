import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { loadIndex, saveIndex, LocalIndex } from "./localIndex";

const IGNORE_FOLDERS = new Set([
  ".git", "node_modules", "vendor", "dist", "build",
  "__pycache__", ".venv", "out", ".next", "coverage",
]);

const INDEXABLE_EXTENSIONS = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx",
  ".java", ".go", ".rs", ".c", ".cpp",
  ".cs", ".rb", ".php", ".swift", ".kt",
]);

const MAX_FILE_BYTES = 500 * 1024; // 500 KB

const LANGUAGE_MAP: Record<string, string> = {
  ".py": "python",
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript",
  ".java": "java", ".go": "go", ".rs": "rust",
  ".c": "c", ".cpp": "cpp", ".cs": "csharp",
  ".rb": "ruby", ".php": "php",
  ".swift": "swift", ".kt": "kotlin",
};

interface Chunk {
  id: string;
  name: string;
  type: string;
  content: string;
  start_line: number;
  end_line: number;
  file: string;
  language: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

function getLanguage(filePath: string): string {
  return LANGUAGE_MAP[path.extname(filePath).toLowerCase()] ?? "text";
}

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

// ask backend to chunk the file → returns list of functions
async function getChunks(file: string, content: string, language: string): Promise<Chunk[]> {
  const response = await fetch("http://localhost:8000/chunk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, content, language }),
  });
  if (!response.ok) throw new Error(`/chunk error: ${response.status}`);
  const data = (await response.json()) as { chunks: Chunk[] };
  return data.chunks;
}

// send only new/changed chunks to embed + ids to delete
async function updateEmbeddings(
  toEmbed: Chunk[],
  toDelete: string[],
): Promise<void> {
  if (toEmbed.length === 0 && toDelete.length === 0) return;
  const response = await fetch("http://localhost:8000/index", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chunks: toEmbed, delete_ids: toDelete }),
  });
  if (!response.ok) throw new Error(`/index error: ${response.status}`);
}

// process one file 

async function processFile(
  filePath: string,
  content: string,
  localIndex: LocalIndex,
): Promise<boolean> {
  const fileHash = hashContent(content);
  const existing = localIndex[filePath];

  //if whole file hash is same → nothing changed
  if (existing && existing.fileHash === fileHash) {
    return false;
  }

  const language = getLanguage(filePath);
  const chunks = await getChunks(filePath, content, language);

  const existingFunctions = existing?.functions ?? {};
  const toEmbed: Chunk[] = [];
  const toDelete: string[] = [];
  const newFunctions: LocalIndex[string]["functions"] = {};

  // check each function in the new version of the file
  for (const chunk of chunks) {
    const funcHash = hashContent(chunk.content);
    const existingFunc = existingFunctions[chunk.name];

    if (!existingFunc || existingFunc.hash !== funcHash) {
      // new or changed function → needs embedding
      toEmbed.push({ ...chunk, language });
    } else {
      // unchanged function → keep as-is in local index
      newFunctions[chunk.name] = existingFunc;
    }
  }

  // find deleted functions (were in index but not in new chunks)
  const newChunkNames = new Set(chunks.map((c) => c.name));
  for (const funcName of Object.keys(existingFunctions)) {
    if (!newChunkNames.has(funcName)) {
      toDelete.push(existingFunctions[funcName].chunkId);
    }
  }

  // send to backend
  await updateEmbeddings(toEmbed, toDelete);

  // update local index: add newly embedded functions
  for (const chunk of toEmbed) {
    newFunctions[chunk.name] = {
      hash: hashContent(chunk.content),
      chunkId: chunk.id,
    };
  }

  localIndex[filePath] = { fileHash, functions: newFunctions };
  return true;
}

// Public API

export async function indexWorkspace(
  context: vscode.ExtensionContext,
  statusBar: vscode.StatusBarItem,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return;

  const workspacePath = folders[0].uri.fsPath;
  const localIndex = loadIndex(context);
  const files = walkFiles(workspacePath);

  let processed = 0;
  let changed = 0;

  for (const filePath of files) {
    statusBar.text = `$(sync~spin) Smart Search: indexing ${processed + 1}/${files.length}`;

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_BYTES) { processed++; continue; }

      const content = fs.readFileSync(filePath, "utf8");
      const didChange = await processFile(filePath, content, localIndex);
      if (didChange) changed++;
    } catch (e) {
      console.error(`[SmartSearch] Failed to index ${filePath}:`, e);
    }

    processed++;
  }

  // Remove deleted files from index and Pinecone
  for (const filePath of Object.keys(localIndex)) {
    if (!fs.existsSync(filePath)) {
      const chunkIds = Object.values(localIndex[filePath].functions).map(
        (f) => f.chunkId,
      );
      await updateEmbeddings([], chunkIds);
      delete localIndex[filePath];
    }
  }

  saveIndex(context, localIndex);
  statusBar.text = `$(check) Smart Search: ${changed} files updated`;
  setTimeout(() => { statusBar.text = "$(search) Smart Search"; }, 5000);
}

export async function indexSingleFile(
  context: vscode.ExtensionContext,
  filePath: string,
  content: string,
): Promise<void> {
  if (!INDEXABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;

  const localIndex = loadIndex(context);

  try {
    const didChange = await processFile(filePath, content, localIndex);
    if (didChange) {
      saveIndex(context, localIndex);
      console.log(`[SmartSearch] Re-indexed: ${filePath}`);
    }
  } catch (e) {
    console.error(`[SmartSearch] Failed to index ${filePath}:`, e);
  }
}
