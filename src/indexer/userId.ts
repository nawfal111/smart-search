// ─────────────────────────────────────────────────────────────────────────────
// userId.ts  —  STABLE USER IDENTIFIER
//
// Identifies WHO is indexing so different users of the same project
// get separate namespaces in Pinecone and don't overwrite each other's vectors.
//
// HOW WE IDENTIFY THE USER:
//   We read the globally configured git email:
//     git config --global user.email   →  "nawfal@gmail.com"
//
//   This is stored in ~/.gitconfig on the developer's machine.
//   It is the same across ALL machines the developer uses (home, work, laptop)
//   as long as they've configured git — which every developer should have done.
//
//   We then MD5-hash the email before using it as an ID.
//   WHY hash it? So the actual email is never sent to Pinecone or any server.
//   The hash is just a fingerprint: "nawfal@gmail.com" → "b7f2a1c5..."
//
// IF GIT EMAIL IS NOT CONFIGURED:
//   We show a clear VS Code error message telling the user exactly what to run.
//   We do NOT silently fall back to a random ID — that would cause confusing
//   behavior where the same user gets a different namespace each time.
//
// RESULT:
//   - Same developer on any machine → same git email → same hash → same Pinecone namespace
//   - Friend with different email   → different hash → different Pinecone namespace → no conflict
//   - VS Code reinstall             → git email still in ~/.gitconfig → same hash → nothing changes
//   - New computer                  → developer sets up git with same email → same hash
// ─────────────────────────────────────────────────────────────────────────────

import * as crypto from "crypto";
import * as cp from "child_process";
import * as vscode from "vscode";

export function getUserId(): string {
  let email = "";

  try {
    // Run: git config --global user.email
    // This reads from ~/.gitconfig — the global git config file on this machine
    // encoding: "utf8" makes it return a string instead of a Buffer
    email = cp
      .execSync("git config --global user.email", { encoding: "utf8" })
      .trim();
  } catch {
    // git is not installed or the command failed — email stays ""
  }

  if (!email) {
    // Show a clear, actionable error in VS Code
    // The user sees this as a notification in the bottom-right corner
    vscode.window.showErrorMessage(
      "Smart Search needs your git email to identify you. " +
      "Run this in your terminal, then reload VS Code:  " +
      "git config --global user.email you@example.com",
    );

    // Stop indexing — we cannot proceed without a stable user identity
    throw new Error("[SmartSearch] git email not configured.");
  }

  // Hash the email with MD5 so the raw email is never stored or sent anywhere
  // toLowerCase() ensures "Nawfal@gmail.com" and "nawfal@gmail.com" produce the same hash
  // Result is a 32-character hex string like "b7f2a1c5d3e4f6a7..."
  return crypto.createHash("md5").update(email.toLowerCase()).digest("hex");
}
