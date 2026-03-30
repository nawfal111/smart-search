import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

import json
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from search import run_search
from chunker import chunk_file
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
        if self.path == "/search":
            self._handle_search()
        elif self.path == "/index":
            self._handle_index()
        else:
            self.send_response(404)
            self.end_headers()

    # ── /search ───────────────────────────────────────────────────────────────

    def _handle_search(self):
        data = self._read_json()

        query = data.get("query", "")
        workspace_path = data.get("workspacePath", "")
        match_case = data.get("matchCase", False)
        match_word = data.get("matchWholeWord", False)
        use_regex = data.get("useRegex", False)
        search_type = data.get("searchType", "normal")
        files_include = data.get("filesInclude", "")
        files_exclude = data.get("filesExclude", "")

        print(f"\nSearch Request: '{query}' [{search_type}]")

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

    def _handle_index(self):
        data = self._read_json()

        file_path = data.get("file", "")
        content = data.get("content", "")
        language = data.get("language", "")
        old_chunk_ids = data.get("old_chunk_ids", [])

        print(f"\nIndex Request: {file_path} [{language}]")

        # Delete old vectors for this file
        if old_chunk_ids:
            pinecone_client.delete_chunks(old_chunk_ids)
            print(f"  Deleted {len(old_chunk_ids)} old chunks")

        # If file was deleted or empty, nothing more to do
        if not content or language == "deleted":
            self.send_json({"chunk_ids": []})
            return

        # Chunk → embed → upsert
        chunks = chunk_file(content, file_path, language)

        # Attach file path to each chunk
        for chunk in chunks:
            chunk["file"] = file_path

        chunks_with_vectors = embed_chunks(chunks)
        pinecone_client.upsert_chunks(chunks_with_vectors)

        chunk_ids = [c["id"] for c in chunks]
        print(f"  Indexed {len(chunk_ids)} chunks")

        self.send_json({"chunk_ids": chunk_ids})

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _read_json(self):
        content_length = int(self.headers["Content-Length"])
        return json.loads(self.rfile.read(content_length).decode("utf-8"))

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
