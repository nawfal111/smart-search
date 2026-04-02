# ─────────────────────────────────────────────────────────────────────────────
# embedder.py  —  TEXT EMBEDDING
#
# Converts text (code) into vectors (lists of numbers) using OpenAI's API.
# These vectors represent the MEANING of the code, not just the words.
#
# WHY vectors:
#   A vector is a list of 1536 numbers (e.g. [0.21, -0.54, 0.87, ...])
#   Similar meaning → similar numbers → close together in vector space
#   This is what allows semantic search:
#     "find authentication logic" can match "verify_token()" even though
#     the word "authentication" doesn't appear in the function name.
#
# MODEL: text-embedding-3-small
#   - Produces 1536-dimensional vectors
#   - Cost: ~$0.00002 per 1000 tokens (very cheap)
#   - Good balance of quality and speed
#
# FLOW:
#   chunk content (string) → OpenAI API → vector (list of 1536 floats)
#   This vector is then saved in Pinecone with the chunk's metadata.
# ─────────────────────────────────────────────────────────────────────────────

import os
from openai import OpenAI
from dotenv import load_dotenv

# Load API keys from backend/.env file
load_dotenv()

# Initialize the OpenAI client once (reused for all requests)
_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def embed_text(text: str) -> list:
    """
    Converts a single string of text into a vector.
    Truncates to 8000 characters to stay within token limits.
    Returns a list of 1536 floats.
    """
    response = _client.embeddings.create(
        model="text-embedding-3-small",
        input=text[:8000],  # safety limit — typical functions are well under this
    )
    return response.data[0].embedding  # list of 1536 floats


def embed_chunks(chunks: list) -> list:
    """
    Embeds a list of chunks.
    For each chunk, calls embed_text() on its content.
    Returns the same chunks with a "vector" field added to each.

    Input:  [{ id, name, content, file, ... }]
    Output: [{ id, name, content, file, ..., vector: [0.21, -0.54, ...] }]
    """
    result = []
    for chunk in chunks:
        vector = embed_text(chunk["content"])
        result.append({**chunk, "vector": vector})  # copy chunk + add vector
    return result
