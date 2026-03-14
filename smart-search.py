"""
Real backend server for Smart Search VSCode Extension
Run this to test the extension: python smart_search.py
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
import re
import fnmatch
import time

# Folders to always ignore during search/replace
IGNORE_FOLDERS = {
    ".git",
    "node_modules",
    "vendor",
    "dist",
    "build",
    "__pycache__",
    ".venv",
}


# ── Helpers ───────────────────────────────────────────────────────────────────


def build_pattern(query: str, use_regex: bool, match_word: bool, match_case: bool):
    """Compile a search regex. Returns (compiled_pattern, error_string_or_None)."""
    try:
        pattern = query if use_regex else re.escape(query)
        if match_word:
            pattern = rf"\b{pattern}\b"
        flags = 0 if match_case else re.IGNORECASE
        return re.compile(pattern, flags), None
    except re.error as e:
        return None, str(e)


def matches_glob_list(rel_path: str, patterns: str) -> bool:
    """Return True if rel_path matches any pattern in a comma-separated glob list."""
    if not patterns or not patterns.strip():
        return False
    file_name = os.path.basename(rel_path)
    rel_posix = rel_path.replace("\\", "/")
    for pat in [p.strip() for p in patterns.split(",") if p.strip()]:
        if fnmatch.fnmatch(rel_posix, pat):
            return True
        if fnmatch.fnmatch(file_name, pat):
            return True
    return False


def walk_files(workspace_path: str, files_include: str, files_exclude: str):
    """Yield (abs_path, rel_path) for every file that passes include/exclude filters."""
    for root, dirs, files in os.walk(workspace_path):
        dirs[:] = [d for d in dirs if d not in IGNORE_FOLDERS]
        for file_name in files:
            file_path = os.path.join(root, file_name)
            rel_path = os.path.relpath(file_path, workspace_path)

            if files_include and not matches_glob_list(rel_path, files_include):
                continue
            if files_exclude and matches_glob_list(rel_path, files_exclude):
                continue

            yield file_path, rel_path


# ── Request handler ───────────────────────────────────────────────────────────


class SearchHandler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path == "/search":
            self._handle_search()
        elif self.path == "/replace":
            self._handle_replace()
        else:
            self.send_response(404)
            self.end_headers()

    # ── /search ──────────────────────────────────────────────────────────────

    def _handle_search(self):
        data = self._read_json()

        query = data.get("query", "")
        workspace_path = data.get("workspacePath", "")
        search_type = data.get("searchType", "normal")
        match_case = data.get("matchCase", False)
        match_word = data.get("matchWholeWord", False)
        use_regex = data.get("useRegex", False)
        files_include = data.get("filesToInclude", "")
        files_exclude = data.get("filesToExclude", "")

        print(
            f"\n🔍 Search  query={query!r}  type={search_type}  "
            f"case={match_case}  word={match_word}  regex={use_regex}"
        )
        if files_include:
            print(f"   include: {files_include}")
        if files_exclude:
            print(f"   exclude: {files_exclude}")

        # AI / unsupported type gate
        if search_type != "normal":
            self.send_json(
                {
                    "unsupported": True,
                    "error": f"'{search_type}' search is not implemented yet. Only Normal Search is available.",
                    "results": [],
                    "total": 0,
                }
            )
            return

        if not self._validate(query, workspace_path):
            return

        compiled, err = build_pattern(query, use_regex, match_word, match_case)
        if err:
            self.send_json(
                {"error": f"Invalid regex: {err}", "results": [], "total": 0}, 400
            )
            return

        start = time.time()
        results = []

        for file_path, _ in walk_files(workspace_path, files_include, files_exclude):
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    for line_num, line in enumerate(f, start=1):
                        if compiled.search(line):
                            results.append(
                                {
                                    "file": file_path,
                                    "line": line_num,
                                    "content": line.rstrip("\n"),
                                }
                            )
            except Exception as e:
                print(f"⚠️  Cannot read {file_path}: {e}")

        total = len(results)
        time_ms = int((time.time() - start) * 1000)
        print(f"   📊 {total} result(s) in {time_ms} ms")

        self.send_json(
            {
                "query": query,
                "workspacePath": workspace_path,
                "matchCase": match_case,
                "matchWholeWord": match_word,
                "useRegex": use_regex,
                "results": results,
                "total": total,
                "time_ms": time_ms,
            }
        )

    # ── /replace ─────────────────────────────────────────────────────────────

    def _handle_replace(self):
        data = self._read_json()

        query = data.get("query", "")
        replacement = data.get("replacement", "")
        workspace_path = data.get("workspacePath", "")
        match_case = data.get("matchCase", False)
        match_word = data.get("matchWholeWord", False)
        use_regex = data.get("useRegex", False)
        files_include = data.get("filesToInclude", "")
        files_exclude = data.get("filesToExclude", "")

        print(f"\n✏️  Replace  query={query!r}  replacement={replacement!r}")

        if not self._validate(query, workspace_path):
            return

        compiled, err = build_pattern(query, use_regex, match_word, match_case)
        if err:
            self.send_json({"error": f"Invalid regex: {err}"}, 400)
            return

        start = time.time()
        total_replaced = 0
        files_modified = 0
        file_details = []  # [{file, replaced}]
        errors = []

        for file_path, rel_path in walk_files(
            workspace_path, files_include, files_exclude
        ):
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    original = f.read()

                new_content, n = compiled.subn(replacement, original)

                if n > 0:
                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    total_replaced += n
                    files_modified += 1
                    file_details.append({"file": file_path, "replaced": n})
                    print(f"   ✅ {rel_path}  ({n})")

            except Exception as e:
                errors.append(f"{rel_path}: {e}")
                print(f"   ⚠️  {rel_path}: {e}")

        time_ms = int((time.time() - start) * 1000)
        print(
            f"   📊 {total_replaced} replacement(s) across {files_modified} file(s) in {time_ms} ms"
        )

        self.send_json(
            {
                "query": query,
                "replacement": replacement,
                "totalReplaced": total_replaced,
                "filesModified": files_modified,
                "fileDetails": file_details,
                "time_ms": time_ms,
                "errors": errors,
            }
        )

    # ── Shared ────────────────────────────────────────────────────────────────

    def _validate(self, query: str, workspace_path: str) -> bool:
        """Returns True if valid, False (and sends response) if invalid."""
        if not query:
            self.send_json(
                {"error": "No query provided", "results": [], "total": 0}, 400
            )
            return False
        if not workspace_path:
            self.send_json(
                {"error": "No workspace path provided", "results": [], "total": 0}, 400
            )
            return False
        if not os.path.exists(workspace_path):
            self.send_json(
                {
                    "error": f"Workspace path does not exist: {workspace_path}",
                    "results": [],
                    "total": 0,
                },
                404,
            )
            return False
        return True

    def _read_json(self) -> dict:
        length = int(self.headers["Content-Length"])
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass  # Comment out to re-enable HTTP access log


if __name__ == "__main__":
    server = HTTPServer(("localhost", 8000), SearchHandler)
    print("🚀 Backend running on http://localhost:8000")
    print("   POST /search   — search files")
    print("   POST /replace  — replace all matches in files")
    server.serve_forever()
