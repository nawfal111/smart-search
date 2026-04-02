# ─────────────────────────────────────────────────────────────────────────────
# pinecone_client.py  —  VECTOR DATABASE CLIENT
#
# Handles saving and deleting vectors in Pinecone.
# Pinecone is the cloud database that stores all the embeddings.
#
# WHAT Pinecone stores for each chunk:
#   id       → unique identifier: "src/auth.py::verify_token"
#   values   → the vector: [0.21, -0.54, 0.87, ...] (1536 numbers)
#   metadata → extra info about the chunk:
#                file       → which file it came from
#                name       → function name
#                type       → "function", "class", or "file"
#                start_line → where it starts in the file
#                end_line   → where it ends
#                content    → first 1000 chars of the function (for displaying results)
#
# TWO OPERATIONS:
#   upsert_chunks → save new vectors (or overwrite if ID already exists)
#   delete_chunks → remove vectors by their IDs (used when code is deleted/changed)
#
# NOTE: metadata content is limited to 1000 characters
#   Pinecone has a metadata size limit per record.
#   We store only the first 1000 chars of content — enough to show in search results.
#   The full content is always retrievable from disk using file + line numbers.
# ─────────────────────────────────────────────────────────────────────────────

import os
from pinecone import Pinecone
from dotenv import load_dotenv

# Load API keys from backend/.env file
load_dotenv()

# Initialize Pinecone client and connect to our index
_pc    = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
_index = _pc.Index(host=os.getenv("PINECONE_HOST"))  # index host URL from Pinecone dashboard


def upsert_chunks(chunks_with_vectors: list):
    """
    Saves a list of embedded chunks to Pinecone.
    "Upsert" = insert if new, update if ID already exists.

    Each chunk must have: id, vector, file, name, type, start_line, end_line, content
    """
    vectors = []
    for chunk in chunks_with_vectors:
        vectors.append({
            "id":     chunk["id"],      # e.g. "src/auth.py::verify_token"
            "values": chunk["vector"],  # the 1536-float embedding
            "metadata": {
                "file":       chunk["file"],
                "name":       chunk["name"],
                "type":       chunk["type"],
                "start_line": chunk["start_line"],
                "end_line":   chunk["end_line"],
                "content":    chunk["content"][:1000],  # Pinecone metadata size limit
            },
        })

    if vectors:
        _index.upsert(vectors=vectors)  # send batch to Pinecone


def delete_chunks(chunk_ids: list):
    """
    Removes vectors from Pinecone by their IDs.
    Called when:
      - A function was deleted from a file
      - A function's content changed (delete old vector, upsert new one)
      - A whole file was deleted
    """
    if chunk_ids:
        _index.delete(ids=chunk_ids)
