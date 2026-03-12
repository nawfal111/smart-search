"""
Example backend server for Smart Search VSCode Extension
Run this to test the extension: python backend-example.py
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os


class SearchHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path == "/search":
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            query = data.get("query", "")
            search_type = data.get("type", "normal")
            workspace_path = data.get("workspacePath", "")

            # Print received data for debugging
            print(f"\n🔍 Search Request Received:")
            print(f"   Query: {query}")
            print(f"   Type: {search_type}")
            print(f"   Workspace: {workspace_path}")

            # Validate workspace path
            if not workspace_path:
                print("   ❌ ERROR: No workspace path provided!")
                error_response = {
                    "error": "No workspace path provided. Please open a folder in VSCode.",
                    "results": [],
                    "total": 0,
                }
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(error_response).encode("utf-8"))
                return

            # Check if workspace path exists
            import os

            if not os.path.exists(workspace_path):
                print(f"   ❌ ERROR: Workspace path does not exist: {workspace_path}")
                error_response = {
                    "error": f"Workspace path does not exist: {workspace_path}",
                    "results": [],
                    "total": 0,
                }
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(error_response).encode("utf-8"))
                return

            print(f"   ✅ Valid workspace - searching in: {workspace_path}")

            print("📂 Folders in workspace:")

            for item in os.listdir(workspace_path):
                full_path = os.path.join(workspace_path, item)
                if os.path.isdir(full_path):
                    print(f"   - {item}")

            print()

            # TODO: Implement your actual search logic here
            # You would search in the workspace_path folder for files matching the query
            # For now, this is just a mock response

            # Mock response - simulating search results from the workspace folder
            response = {
                "query": query,
                "type": search_type,
                "workspacePath": workspace_path,
                "results": [
                    {
                        "file": f"{workspace_path}/src/example.ts",
                        "line": 42,
                        "content": f"Example result for: {query}",
                        "score": 0.95,
                    },
                    {
                        "file": f"{workspace_path}/src/utils.ts",
                        "line": 15,
                        "content": f"Another match for: {query}",
                        "score": 0.87,
                    },
                ],
                "total": 2,
                "time_ms": 123,
            }

            print(f"   📊 Returning {response['total']} results")
            print()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    server = HTTPServer(("localhost", 8000), SearchHandler)
    print("🚀 Backend server running on http://localhost:8000")
    print("Ready to accept search requests from VSCode extension")
    server.serve_forever()
