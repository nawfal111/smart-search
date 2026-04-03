import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

import json
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from search import run_search
from embedder import embed_chunks
import pinecone_client


class SearchHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        routes = {
            "/search": self._handle_search,
            "/index":  self._handle_index,
        }
        handler = routes.get(self.path)
        if handler:
            handler()
        else:
            self.send_response(404)
            self.end_headers()

    # ── /search ───────────────────────────────────────────────────────────────

    def _handle_search(self):
        data = self._read_json()

        query         = data.get("query", "")
        workspace_path = data.get("workspacePath", "")
        match_case    = data.get("matchCase", False)
        match_word    = data.get("matchWholeWord", False)
        use_regex     = data.get("useRegex", False)
        search_type   = data.get("searchType", "normal")
        files_include = data.get("filesInclude", "")
        files_exclude = data.get("filesExclude", "")

        print(f"\nSearch: '{query}' [{search_type}]")

        if search_type == "ai":
            self.send_json({
                "query": query, "results": [], "total": 0,
                "time_ms": 0, "message": "AI Search — coming soon.",
            })
            return

        if not query or not workspace_path or not os.path.exists(workspace_path):
            self.send_json({"error": "Invalid workspace or query", "results": [], "total": 0}, 400)
            return

        try:
            results, time_ms = run_search(
                query, workspace_path, match_case, match_word,
                use_regex, files_include, files_exclude,
            )
        except re.error as e:
            self.send_json({"error": f"Invalid regex: {e}", "results": [], "total": 0}, 400)
            return

        print(f"  Found {len(results)} results in {time_ms} ms")
        self.send_json({
            "query": query, "workspacePath": workspace_path,
            "results": results, "total": len(results), "time_ms": time_ms,
        })

    # ── /index ────────────────────────────────────────────────────────────────
    # Receives only the changed/new chunks + IDs to delete (not the whole file).
    # Chunking and hash comparison already happened in TypeScript — Python only
    # does the expensive parts: embedding via OpenAI and storage in Pinecone.
    # All operations are scoped to the namespace = "{projectId}::{userId}"
    # so different users' vectors never mix, even on the same project.

    def _handle_index(self):
        data = self._read_json()

        chunks_to_embed = data.get("chunks", [])     # new or changed functions
        delete_ids      = data.get("delete_ids", []) # removed or changed functions
        namespace       = data.get("namespace", "")  # "{projectId}::{userId}"

        print(f"\nIndex: embed {len(chunks_to_embed)} chunks, delete {len(delete_ids)} ids [ns={namespace}]")

        # delete old vectors first (scoped to this user's namespace)
        if delete_ids:
            pinecone_client.delete_chunks(delete_ids, namespace)

        # embed + upsert new/changed chunks (scoped to this user's namespace)
        if chunks_to_embed:
            chunks_with_vectors = embed_chunks(chunks_to_embed)
            pinecone_client.upsert_chunks(chunks_with_vectors, namespace)

        self.send_json({"ok": True})

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _read_json(self):
        length = int(self.headers["Content-Length"])
        return json.loads(self.rfile.read(length).decode("utf-8"))

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
