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
        model="text-embedding-3-large",
        input=text[:8000],  # safety limit — typical functions are well under this
    )
    return response.data[0].embedding  # list of 1536 floats


def _build_embed_text(chunk: dict) -> str:
    """
    Builds the text to embed for a chunk by prepending its type and name.
    This gives the function/method name explicit weight in the embedding,
    so queries like "get all products" directly match "getAllProducts".

    Example output:
      Function: getAllProducts
      public static function getAllProducts() { ... }
    """
    label = f"{chunk.get('type', 'function').capitalize()}: {chunk.get('name', '')}"
    return f"{label}\n{chunk['content'][:8000]}"


def embed_chunks(chunks: list) -> list:
    """
    Embeds a list of chunks in ONE batched API call instead of one call per chunk.
    This is faster and uses fewer API rate-limit tokens.

    OpenAI accepts up to 2048 inputs per request.
    We send all function texts together and get all vectors back at once.

    Input:  [{ id, name, content, file, ... }]
    Output: [{ id, name, content, file, ..., vector: [0.21, -0.54, ...] }]
    """
    if not chunks:
        return []

    # Prepend type + name to each chunk before embedding
    # This improves semantic matching between natural language queries and function names
    texts = [_build_embed_text(chunk) for chunk in chunks]

    # One API call for all chunks — OpenAI returns vectors in the same order
    response = _client.embeddings.create(
        model="text-embedding-3-large",
        input=texts,
    )

    # Pair each chunk with its vector by index (order is preserved by OpenAI)
    result = []
    for chunk, embedding_obj in zip(chunks, response.data):
        result.append({**chunk, "vector": embedding_obj.embedding})

    return result
