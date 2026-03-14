"""
Real backend server for Smart Search VSCode Extension
Run this to test the extension: python smart_search.py
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
import re
import time

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


class SearchHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

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

        print(f"\n🔍 Search Request Received:")
        print(f"   Query:          {query}")
        print(f"   Workspace:      {workspace_path}")
        print(f"   Match Case:     {match_case}")
        print(f"   Match Whole Word: {match_word}")

        # ── Validation ────────────────────────────────────────────────────────
        if not query:
            self.send_json_response(
                {"error": "No query provided", "results": [], "total": 0}, 400
            )
            return

        if not workspace_path:
            self.send_json_response(
                {"error": "No workspace path provided", "results": [], "total": 0}, 400
            )
            return

        if not os.path.exists(workspace_path):
            self.send_json_response(
                {
                    "error": f"Workspace path does not exist: {workspace_path}",
                    "results": [],
                    "total": 0,
                },
                404,
            )
            return

        # ── Build regex pattern ───────────────────────────────────────────────
        # Escape the query so special chars are treated as literals
        escaped = re.escape(query)

        if match_word:
            # \b boundaries only work well on word characters; fall back to
            # lookaround for queries that start/end with non-word chars
            pattern = rf"\b{escaped}\b"
        else:
            pattern = escaped

        flags = 0 if match_case else re.IGNORECASE

        try:
            compiled = re.compile(pattern, flags)
        except re.error as e:
            self.send_json_response(
                {"error": f"Invalid search pattern: {e}", "results": [], "total": 0},
                400,
            )
            return

        # ── Walk workspace ────────────────────────────────────────────────────
        start_time = time.time()
        results = []

        for root, dirs, files in os.walk(workspace_path):
            # Skip ignored folders (mutate in-place so os.walk respects it)
            dirs[:] = [d for d in dirs if d not in IGNORE_FOLDERS]

            for file_name in files:
                file_path = os.path.join(root, file_name)
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
                    print(f"⚠️  Could not read file {file_path}: {e}")

        total = len(results)
        time_ms = int((time.time() - start_time) * 1000)

        print(f"   📊 Found {total} results in {time_ms} ms")

        self.send_json_response(
            {
                "query": query,
                "workspacePath": workspace_path,
                "matchCase": match_case,
                "matchWholeWord": match_word,
                "results": results,
                "total": total,
                "time_ms": time_ms,
            }
        )

    def send_json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # Silence default request logging — comment out to re-enable
    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = HTTPServer(("localhost", 8000), SearchHandler)
    print("🚀 Backend server running on http://localhost:8000")
    print("   Ready to accept search requests from the VSCode extension")
    server.serve_forever()
