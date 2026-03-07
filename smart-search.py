"""
Example backend server for Smart Search VSCode Extension
Run this to test the extension: python backend-example.py
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json


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

            # Mock response
            response = {
                "query": query,
                "type": search_type,
                "results": [
                    {
                        "file": "src/example.ts",
                        "line": 42,
                        "content": f"Example result for: {query}",
                        "score": 0.95,
                    },
                    {
                        "file": "src/utils.ts",
                        "line": 15,
                        "content": f"Another match for: {query}",
                        "score": 0.87,
                    },
                ],
                "total": 2,
                "time_ms": 123,
            }

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
