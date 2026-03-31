import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { loadIndex, saveIndex, LocalIndex } from "./localIndex";

const IGNORE_FOLDERS = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  "out",
  ".next",
  "coverage",
]);

const INDEXABLE_EXTENSIONS = new Set([
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".cpp",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".kt",
]);

const MAX_FILE_BYTES = 500 * 1024; // 500 KB

const LANGUAGE_MAP: Record<string, string> = {
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".java": "java",
  ".go": "go",
  ".rs": "rust",
  ".c": "c",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
};

// helper functions

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

async function sendToBackend(
  file: string,
  content: string,
  language: string,
  oldChunkIds: string[],
): Promise<string[]> {
  const response = await fetch("http://localhost:8000/index", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file,
      content,
      language,
      old_chunk_ids: oldChunkIds,
    }),
  });
  if (!response.ok) throw new Error(`Backend error: ${response.status}`);
  const data = (await response.json()) as { chunk_ids: string[] };
  return data.chunk_ids;
}

// public API

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
      if (stat.size > MAX_FILE_BYTES) {
        processed++;
        continue;
      }

      const content = fs.readFileSync(filePath, "utf8");
      const hash = hashContent(content);
      const existing = localIndex[filePath];

      if (existing && existing.hash === hash) {
        processed++;
        continue;
      }

      const language = getLanguage(filePath);
      const oldChunkIds = existing?.chunkIds ?? [];
      const newChunkIds = await sendToBackend(
        filePath,
        content,
        language,
        oldChunkIds,
      );

      localIndex[filePath] = { hash, chunkIds: newChunkIds };
      changed++;
    } catch (e) {
      console.error(`[SmartSearch] Failed to index ${filePath}:`, e);
    }

    processed++;
  }

  // remove deleted files from index and Pinecone
  for (const filePath of Object.keys(localIndex)) {
    if (!fs.existsSync(filePath)) {
      const oldChunkIds = localIndex[filePath].chunkIds;
      if (oldChunkIds.length > 0) {
        await sendToBackend(filePath, "", "deleted", oldChunkIds);
      }
      delete localIndex[filePath];
    }
  }

  saveIndex(context, localIndex);

  statusBar.text = `$(check) Smart Search: ${changed} files indexed`;
  setTimeout(() => {
    statusBar.text = "$(search) Smart Search";
  }, 5000);
}

export async function indexSingleFile(
  context: vscode.ExtensionContext,
  filePath: string,
  content: string,
): Promise<void> {
  if (!INDEXABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;

  const localIndex = loadIndex(context);
  const hash = hashContent(content);
  const existing = localIndex[filePath];

  if (existing && existing.hash === hash) return; // unchanged

  const language = getLanguage(filePath);
  const oldChunkIds = existing?.chunkIds ?? [];

  try {
    const newChunkIds = await sendToBackend(
      filePath,
      content,
      language,
      oldChunkIds,
    );
    localIndex[filePath] = { hash, chunkIds: newChunkIds };
    saveIndex(context, localIndex);
    console.log(`[SmartSearch] Re-indexed: ${filePath}`);
  } catch (e) {
    console.error(`[SmartSearch] Failed to index ${filePath}:`, e);
  }
}
