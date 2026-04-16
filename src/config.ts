// ─────────────────────────────────────────────────────────────────────────────
// config.ts  —  EXTENSION CONFIGURATION
//
// Central place for reading user-configurable settings.
// All backend URL references go through getBackendUrl() — never hardcoded.
//
// HOW TO CHANGE THE BACKEND URL:
//   Option A (per-workspace): add to .vscode/settings.json
//     { "smartSearch.backendUrl": "https://my-backend.example.com" }
//
//   Option B (global): VS Code → Settings → search "Smart Search" → Backend URL
//
// This lets the extension target a remote backend with no code changes —
// just update the setting and reload the window.
// ─────────────────────────────────────────────────────────────────────────────

import * as vscode from "vscode";

/**
 * Returns the base URL of the Smart Search Python backend.
 * Reads from VS Code setting `smartSearch.backendUrl`.
 * Falls back to http://localhost:8000 if not set.
 * Trailing slash is always stripped for consistency.
 */
export function getBackendUrl(): string {
  const config = vscode.workspace.getConfiguration("smartSearch");
  const url    = config.get<string>("backendUrl", "http://localhost:8000");
  return url.replace(/\/$/, ""); // strip trailing slash
}
