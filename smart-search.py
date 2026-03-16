from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
import re
import time
import fnmatch

# folders to ignore during search
IGNORE_FOLDERS = {
    ".git",
    "node_modules",
    "vendor",
    "dist",
    "build",
    "__pycache__",
    ".venv",
}

# path to React build output
DIST_DIR = os.path.join(os.path.dirname(__file__), "webview", "dist")


class SearchHandler(BaseHTTPRequestHandler):
    # CORS preflight
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # Serve React static files
    def do_GET(self):
        path = self.path
        if path == "/":
            path = "/index.html"
        file_path = os.path.join(DIST_DIR, path.lstrip("/"))

        if os.path.exists(file_path) and os.path.isfile(file_path):
            self.send_response(200)
            if file_path.endswith(".js"):
                self.send_header("Content-Type", "application/javascript")
            elif file_path.endswith(".css"):
                self.send_header("Content-Type", "text/css")
            elif file_path.endswith(".html"):
                self.send_header("Content-Type", "text/html")
            else:
                self.send_header("Content-Type", "application/octet-stream")
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_response(404)
            self.end_headers()

    # Search API
    def do_POST(self):
        if self.path != "/search":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers["Content-Length"])
        post_data = self.rfile.read(content_length)
        data = json.loads(post_data.decode("utf-8"))

        query = data.get("query", "")
        workspace_path = data.get("workspacePath", "")
        match_case = data.get("matchCase", False)
        match_word = data.get("matchWholeWord", False)
        use_regex = data.get("useRegex", False)
        search_type = data.get("searchType", "normal")
        files_include = data.get("filesInclude", "")
        files_exclude = data.get("filesExclude", "")

        print(f"\n🔍 Search Request Received:")
        print(f"   Query:            {query}")
        print(f"   Workspace:        {workspace_path}")
        print(f"   Search Type:      {search_type}")
        print(f"   Regex:            {use_regex}")
        print(f"   Include:          {files_include}")
        print(f"   Exclude:          {files_exclude}")

        if search_type != "normal":
            self.send_json_response(
                {
                    "unsupported": True,
                    "error": f"'{search_type}' search is not implemented yet. Only normal search is available.",
                    "results": [],
                    "total": 0,
                }
            )
            return

        if not query or not workspace_path or not os.path.exists(workspace_path):
            self.send_json_response(
                {"error": "Invalid workspace or query", "results": [], "total": 0}, 400
            )
            return

        # ── Handle Glob Includes / Excludes ────────────────────────
        def parse_globs(glob_str):
            if not glob_str:
                return []
            return [g.strip() for g in glob_str.split(",") if g.strip()]

        include_globs = parse_globs(files_include)
        exclude_globs = parse_globs(files_exclude)

        def matches_any_glob(path, globs):
            for g in globs:
                if fnmatch.fnmatch(path, g) or fnmatch.fnmatch(
                    os.path.basename(path), g
                ):
                    return True
                if g.startswith(".") and fnmatch.fnmatch(path, f"*{g}"):
                    return True
            return False

        # ── Build Regex ─────────────────────────────────────────────
        pattern = query if use_regex else re.escape(query)
        if match_word:
            pattern = rf"\b{pattern}\b"
        flags = 0 if match_case else re.IGNORECASE

        try:
            compiled = re.compile(pattern, flags)
        except re.error as e:
            self.send_json_response(
                {"error": f"Invalid regex pattern: {e}", "results": [], "total": 0}, 400
            )
            return

        # ── Walk Workspace ─────────────────────────────────────────
        start_time = time.time()
        results = []

        for root, dirs, files in os.walk(workspace_path):
            dirs[:] = [d for d in dirs if d not in IGNORE_FOLDERS]

            for file_name in files:
                file_path = os.path.join(root, file_name)
                rel_path = os.path.relpath(file_path, workspace_path).replace("\\", "/")

                if exclude_globs and matches_any_glob(rel_path, exclude_globs):
                    continue
                if include_globs and not matches_any_glob(rel_path, include_globs):
                    continue

                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        for line_num, line in enumerate(f, start=1):
                            matches = [
                                [m.start(), m.end()] for m in compiled.finditer(line)
                            ]
                            if matches:
                                results.append(
                                    {
                                        "file": file_path,
                                        "line": line_num,
                                        "content": line.rstrip("\n"),
                                        "matches": matches,
                                    }
                                )
                except Exception as e:
                    print(f"⚠️ Could not read file {file_path}: {e}")

        total = len(results)
        time_ms = int((time.time() - start_time) * 1000)
        print(f"   📊 Found {total} results in {time_ms} ms")

        self.send_json_response(
            {
                "query": query,
                "workspacePath": workspace_path,
                "results": results,
                "total": total,
                "time_ms": time_ms,
            }
        )

    # ── Utility ────────────────────────────────────────────────
    def send_json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = HTTPServer(("localhost", 8000), SearchHandler)
    print("🚀 Backend + React server running on http://localhost:8000")
    print("   Serving React frontend and /search API")
    server.serve_forever()
