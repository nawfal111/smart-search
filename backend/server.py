import sys
import os

# Ensure sibling modules (search, config) are importable when run from any directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import json
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from search import run_search


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
        use_regex = data.get("useRegex", False)
        search_type = data.get("searchType", "normal")
        files_include = data.get("filesInclude", "")
        files_exclude = data.get("filesExclude", "")

        print(f"\nSearch Request:")
        print(f"  Query:       {query}")
        print(f"  Workspace:   {workspace_path}")
        print(f"  Type:        {search_type}")
        print(f"  Regex:       {use_regex}")
        print(f"  Include:     {files_include}")
        print(f"  Exclude:     {files_exclude}")

        if search_type == "ai":
            self.send_json({
                "query": query,
                "results": [],
                "total": 0,
                "time_ms": 0,
                "message": "AI Search extension implemented here - Embedding logic pending.",
            })
            return

        if search_type != "normal":
            self.send_json({
                "unsupported": True,
                "error": f"'{search_type}' search is not implemented yet.",
                "results": [],
                "total": 0,
            })
            return

        if not query or not workspace_path or not os.path.exists(workspace_path):
            self.send_json({"error": "Invalid workspace or query", "results": [], "total": 0}, 400)
            return

        try:
            results, time_ms = run_search(
                query, workspace_path, match_case, match_word, use_regex,
                files_include, files_exclude
            )
        except re.error as e:
            self.send_json({"error": f"Invalid regex: {e}", "results": [], "total": 0}, 400)
            return

        print(f"  Found {len(results)} results in {time_ms} ms")

        self.send_json({
            "query": query,
            "workspacePath": workspace_path,
            "results": results,
            "total": len(results),
            "time_ms": time_ms,
        })

    def send_json(self, data, status=200):
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
    print("Backend server running on http://localhost:8000")
    server.serve_forever()
