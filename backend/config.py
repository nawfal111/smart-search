# Minimum similarity score for AI search results (0.0 – 1.0).
# Results below this threshold are filtered out before returning to the user.
# The user can override this per-search (1–100 in the UI → divided by 100 here).
# If the user leaves the field empty or enters an invalid value, this default is used.
DEFAULT_AI_THRESHOLD = 0.35

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
