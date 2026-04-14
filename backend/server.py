import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

import json
import re
import fnmatch
from http.server import HTTPServer, BaseHTTPRequestHandler
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
from search import run_search
from embedder import embed_chunks, embed_text
import pinecone_client
from config import DEFAULT_AI_THRESHOLD
from summarizer import summarize_chunk
from line_locator import find_relevant_line


def _glob_match(file_path: str, pattern: str) -> bool:
    """
    Returns True if file_path matches the glob pattern.
    Checks both the full relative path and just the filename,
    so "*.php" matches "src/auth.php" and "auth.php" equally.
    Strips leading "**/" so patterns like "**/*.ts" work correctly.
    """
    pattern = pattern.strip().lstrip("*").lstrip("/")  # "**/*.php" → "*.php"
    file_path = file_path.replace("\\", "/")
    basename  = file_path.split("/")[-1]
    return fnmatch.fnmatch(basename, pattern) or fnmatch.fnmatch(file_path, pattern)


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
            try:
                handler()
            except ValueError as e:
                self.send_json({"error": str(e)}, 400)
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
            # AI Search pipeline:
            #   1. Embed the user's query via Voyage AI (input_type="query")
            #   2. Query Pinecone for the top-10 most similar function vectors (cosine similarity)
            #   3. Filter by threshold, sort by score descending
            #   4. Ask GPT which specific line inside each top result answers the query
            #   5. Return results with score, LLM summary, matched line, file, and line range
            namespace = data.get("namespace", "")
            if not query or not namespace:
                self.send_json({"error": "Missing query or namespace", "results": [], "total": 0}, 400)
                return

            # Parse threshold from request (sent as 1–100 integer from the UI)
            # If missing or invalid, fall back to the default defined in config.py
            raw_threshold = data.get("threshold", None)
            try:
                threshold = float(raw_threshold) / 100.0
                if not (0.01 <= threshold <= 1.0):
                    raise ValueError
            except (TypeError, ValueError):
                threshold = DEFAULT_AI_THRESHOLD

            start = time.time()
            query_vector = embed_text(query)
            all_results  = pinecone_client.query_chunks(query_vector, namespace, top_k=10)

            # Filter by threshold and sort highest first
            results = sorted(
                [r for r in all_results if r["score"] >= threshold],
                key=lambda r: r["score"],
                reverse=True,
            )

            # Apply include/exclude file filters (same patterns the user typed in the UI)
            # e.g. filesInclude="*.php" keeps only PHP files
            #      filesExclude="test*" drops files whose name starts with "test"
            if files_include:
                results = [r for r in results if _glob_match(r["file"], files_include)]
            if files_exclude:
                results = [r for r in results if not _glob_match(r["file"], files_exclude)]

            # Line locator: ask GPT which specific line in each result answers the query.
            # All calls run IN PARALLEL via ThreadPoolExecutor — total time ≈ one GPT call
            # (~300–500ms) regardless of how many results there are.
            print(f"  Running line locator on {len(results)} results (parallel)...")
            with ThreadPoolExecutor(max_workers=max(1, len(results))) as executor:
                futures = {
                    executor.submit(find_relevant_line, query, r, workspace_path): r
                    for r in results
                }
                for future in as_completed(futures):
                    r = futures[future]
                    try:
                        loc = future.result()
                        r["match_line"]    = loc["line"]
                        r["match_content"] = loc["content"]
                        print(f"    line {loc['line']}  {r['file']}::{r['name']}")
                    except Exception as e:
                        r["match_line"]    = r["start_line"]
                        r["match_content"] = ""
                        print(f"    line locator failed for {r['name']}: {e}")

            time_ms = int((time.time() - start) * 1000)

            print(f"  AI search: {len(results)}/{len(all_results)} results above threshold {threshold:.0%} in {time_ms} ms")
            for r in results:
                print(f"    {r['score']:.0%}  {r['file']}::{r['name']}")
            self.send_json({
                "query":         query,
                "results":       results,
                "total":         len(results),
                "time_ms":       time_ms,
                "searchType":    "ai",
                "workspacePath": workspace_path,
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
    # Chunking and hash comparison already happened in TypeScript — Python does
    # the expensive AI steps:
    #   1. Summarize each chunk via GPT (plain English description → better search scores)
    #   2. Embed via Voyage AI (summary + code → 1536-float vector)
    #   3. Upsert vectors in Pinecone under namespace = "{projectId}::{userId}"
    # All operations are scoped to the namespace so different users' vectors never mix.

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
            # Step 1: Generate plain English summaries via GPT (improves semantic scores)
            # Each summary is prepended to the code before embedding so the vector
            # captures English meaning, not just syntax.
            print(f"  Summarizing {len(chunks_to_embed)} chunks...")
            for chunk in chunks_to_embed:
                try:
                    chunk["summary"] = summarize_chunk(chunk)
                    print(f"    ✓ {chunk['name']}: {chunk['summary'][:80]}")
                except Exception as e:
                    chunk["summary"] = ""
                    print(f"    ✗ {chunk['name']}: summary failed ({e}), embedding without summary")

            # Step 2: Embed (summary + code → vector) and store in Pinecone
            chunks_with_vectors = embed_chunks(chunks_to_embed)
            pinecone_client.upsert_chunks(chunks_with_vectors, namespace)

        self.send_json({"ok": True})

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError) as e:
            raise ValueError(f"Invalid request body: {e}")

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
