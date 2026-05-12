# Minimum similarity score for AI search results (0.0 – 1.0).
# Results below this threshold are filtered out before returning to the user.
# The user can override this per-search (1–100 in the UI → divided by 100 here).
# If the user leaves the field empty or enters an invalid value, this default is used.
DEFAULT_AI_THRESHOLD = 0.35

# Minimum number of characters required for an AI search query.
# Short queries produce poor semantic embeddings, so we reject them early.
# This is the single source of truth — exposed via GET /config so the extension
# and webview frontend always enforce the same limit as the backend.
# Currently set to 5 for development/testing.
MIN_AI_QUERY_LENGTH = 5

IGNORE_FOLDERS = {
    ".git",
    "node_modules",
    "vendor",
    "dist",
    "build",
    "__pycache__",
    ".venv",
    ".smart-search",   # Smart Search local index — never search inside it
}
