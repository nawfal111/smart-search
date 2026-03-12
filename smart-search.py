"""
Real backend server for Smart Search VSCode Extension
Run this to test the extension: python backend-real-search.py
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
import time

# folders to ignore during search
IGNORE_FOLDERS = {".git", "node_modules", "vendor", "dist", "build"}


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
        search_type = data.get("type", "normal")
        workspace_path = data.get("workspacePath", "")

        print(f"\n🔍 Search Request Received:")
        print(f"   Query: {query}")
        print(f"   Type: {search_type}")
        print(f"   Workspace: {workspace_path}")

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

        if search_type != "normal":
            self.send_json_response(
                {
                    "error": f"Search type '{search_type}' not supported yet",
                    "results": [],
                    "total": 0,
                }
            )
            return

        start_time = time.time()
        results = []

        # Walk through all files in workspace
        for root, dirs, files in os.walk(workspace_path):
            # skip ignored folders
            dirs[:] = [d for d in dirs if d not in IGNORE_FOLDERS]

            for file_name in files:
                file_path = os.path.join(root, file_name)
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        for line_num, line in enumerate(f, start=1):
                            if query.lower() in line.lower():
                                results.append(
                                    {
                                        "file": file_path,
                                        "line": line_num,
                                        "content": line.strip(),
                                        "score": 1.0,  # simple scoring
                                    }
                                )
                except Exception as e:
                    print(f"⚠️ Could not read file {file_path}: {e}")

        total = len(results)
        time_ms = int((time.time() - start_time) * 1000)

        response = {
            "query": query,
            "type": search_type,
            "workspacePath": workspace_path,
            "results": results,
            "total": total,
            "time_ms": time_ms,
        }

        print(f"   📊 Found {total} results in {time_ms} ms")
        self.send_json_response(response)

    def send_json_response(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    server = HTTPServer(("localhost", 8000), SearchHandler)
    print("🚀 Backend server running on http://localhost:8000")
    print("Ready to accept real search requests from VSCode extension")
    server.serve_forever()
