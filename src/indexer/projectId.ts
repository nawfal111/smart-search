// ─────────────────────────────────────────────────────────────────────────────
// projectId.ts  —  STABLE PROJECT IDENTIFIER
//
// Gives every project a unique ID that survives folder renames and moves.
//
// WHERE it's stored:
//   <workspace>/.smart-search/project-id
//
//   This file lives INSIDE the project folder but is gitignored.
//   It moves with the project when the folder is moved or renamed.
//   It does NOT get pushed to git — so each developer generates their own
//   on first run, and two developers working on the same repo have the same
//   project-id only if they explicitly share the .smart-search/ folder
//   (which they wouldn't, since it's gitignored).
//
// HOW it works:
//   First run  → .smart-search/ doesn't exist → create it → generate UUID → write it
//   Every run  → file exists → read it → return it
//   Folder moved or renamed → file still there → same ID
//
// GITIGNORE:
//   On first run, we automatically add ".smart-search/" to .gitignore
//   so the hashes and project ID are never accidentally committed.
//
// WHY this matters:
//   Pinecone namespace = projectId + userId.
//   Without a stable projectId, moving the folder would create a new namespace
//   and orphan all the old vectors in Pinecone.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as vscode from "vscode";

// Returns the path to the .smart-search/ folder inside the current workspace
// e.g. "/Users/nawfal/projects/myapp/.smart-search"
function getSmartSearchDir(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return path.join(folders[0].uri.fsPath, ".smart-search");
}

export function getProjectId(): string {
  const dir = getSmartSearchDir();
  if (!dir) return "unknown-project";

  const idFile        = path.join(dir, "project-id");
  const workspaceRoot = path.dirname(dir);

  // Always ensure .smart-search/ is gitignored on every run.
  // addToGitignore checks for duplicates before writing, so this is safe to call repeatedly.
  // This handles cases where .gitignore was missing or the entry was accidentally removed.
  addToGitignore(workspaceRoot);

  // If the project ID file already exists, return it as-is
  if (fs.existsSync(idFile)) {
    return fs.readFileSync(idFile, "utf8").trim();
  }

  // First time running in this project:
  // 1. Create the .smart-search/ directory
  // 2. Generate a new UUID and save it as the project ID
  fs.mkdirSync(dir, { recursive: true });

  const id = crypto.randomUUID(); // e.g. "a3f2c1d4-e5b6-7890-abcd-ef1234567890"
  fs.writeFileSync(idFile, id, "utf8");

  return id;
}

// Returns the path to the .smart-search/ folder for use in localIndex.ts
// Other modules call this instead of recomputing the path themselves
export function getSmartSearchPath(): string | null {
  return getSmartSearchDir();
}

// ── Helper: add .smart-search/ to .gitignore ─────────────────────────────────
// Called once when the project ID is first created.
// If .gitignore exists → appends the entry if not already there.
// If .gitignore doesn't exist → creates it with the entry.
function addToGitignore(workspaceRoot: string): void {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  const entry         = ".smart-search/";
  const comment       = "# Smart Search — local function hashes (not embeddings, not committed)";

  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf8");

      // Only add if not already present — avoid duplicates
      if (!content.includes(entry)) {
        fs.appendFileSync(gitignorePath, `\n${comment}\n${entry}\n`, "utf8");
      }
    } else {
      // No .gitignore yet — create one
      fs.writeFileSync(gitignorePath, `${comment}\n${entry}\n`, "utf8");
    }
  } catch (e) {
    // Non-fatal — if we can't write .gitignore, just continue
    console.warn("[SmartSearch] Could not update .gitignore:", e);
  }
}
