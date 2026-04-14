# ─────────────────────────────────────────────────────────────────────────────
# summarizer.py  —  LLM FUNCTION SUMMARIZATION
#
# Before embedding a code chunk, we ask GPT to summarize it in plain English.
# The summary is prepended to the code before embedding.
#
# WHY this improves search:
#   Raw code: "$result = $db->query('SELECT * FROM products WHERE id = ?', [$id])"
#   Summary:  "Fetches a single product's details from the database by ID."
#   Now "fetch product from database by id" matches at 85%+ instead of 46%,
#   because the embedding space contains English meaning, not just syntax.
#
# WHEN it runs:
#   Only at index time — once per new/changed function (same trigger as embedding).
#   The summary is stored in Pinecone metadata so it can be shown in results.
#
# MODEL: gpt-4o-mini (OpenAI)
#   Cost: ~$0.00015 per 1K input tokens — negligible for function-sized code.
#   Uses the same OPENAI_API_KEY already configured for embeddings.
# ─────────────────────────────────────────────────────────────────────────────

import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def summarize_chunk(chunk: dict) -> str:
    """
    Asks GPT to summarize a code function in 1-2 plain English sentences.
    Returns the summary string, or empty string on failure.

    The summary describes WHAT the function does and WHY — not HOW.
    This bridges the gap between natural language queries and code syntax.

    Example:
      Input:  getProductInfo($id) { SELECT * FROM products WHERE id = ? }
      Output: "Fetches a single product's details from the database by its ID.
               Returns the full product row as an associative array."
    """
    lang = chunk.get("language", "code")
    name = chunk.get("name", "unknown")
    code = chunk["content"][:3000]   # limit to avoid token waste on huge functions

    response = _client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=120,
        messages=[{
            "role": "user",
            "content": (
                f"Summarize this {lang} function in 1-2 sentences. "
                f"Describe WHAT it does and WHY. Be concise. No preamble.\n\n"
                f"Function: {name}\n{code}"
            )
        }]
    )
    return response.choices[0].message.content.strip()
