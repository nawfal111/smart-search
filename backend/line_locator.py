# ─────────────────────────────────────────────────────────────────────────────
# line_locator.py  —  LLM LINE-LEVEL RESULT PINPOINTING
#
# After Pinecone returns a matching function, we ask Claude which specific
# line within that function is the most relevant to the user's query.
#
# WHY this matters:
#   Pinecone matches at the FUNCTION level (e.g. lines 5–42).
#   The user asked "where do we validate the token expiry?" — the answer
#   is on line 21, not somewhere in lines 5–42.
#   This step narrows the result to one exact line.
#
# HOW it works:
#   1. Read the function's lines from the file on disk
#   2. Number each line: "21: if ($token['expires_at'] < time()) {"
#   3. Ask Claude: "which line answers this query?"
#   4. Return {line: 21, content: "if ($token['expires_at'] < time()) {"}
#   5. The UI opens the file directly at line 21
#
# CALLED FOR: top 5 results only — balances precision vs speed.
# FALLBACK:   if Claude fails or file can't be read → returns start_line.
#
# MODEL: claude-haiku-4-5 (responds in ~300ms, costs ~$0.0001 per call)
# ─────────────────────────────────────────────────────────────────────────────

import os
import json
import re
import anthropic
from dotenv import load_dotenv

load_dotenv()

_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def find_relevant_line(query: str, chunk: dict, workspace_path: str) -> dict:
    """
    Asks Claude which specific line within the matched function best answers the query.

    Input:
      query          → the user's search query (e.g. "validate token expiry")
      chunk          → Pinecone result: {file, start_line, end_line, name, ...}
      workspace_path → absolute path to the project root (to read the file)

    Output:
      {"line": 21, "content": "if ($token['expires_at'] < time()) { return false; }"}
      Falls back to {"line": start_line, "content": ""} if anything fails.
    """
    start = chunk["start_line"]
    end   = chunk["end_line"]

    # Read the function's lines from disk
    try:
        file_path = os.path.join(workspace_path, chunk["file"])
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
        fn_lines = all_lines[start - 1 : end]   # slice is 0-indexed, line numbers are 1-indexed
        # Build numbered listing: "21: if ($token['expires_at'] < time()) {"
        numbered = "".join(
            f"{start + i}: {line}" for i, line in enumerate(fn_lines)
        )
    except Exception:
        return {"line": start, "content": ""}

    # Ask Claude which line is most relevant
    message = _client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=120,
        messages=[{
            "role": "user",
            "content": (
                f'Search query: "{query}"\n\n'
                f"Code (with line numbers):\n{numbered[:3000]}\n\n"
                f"Which single line number is most directly relevant to the search query? "
                f'Reply ONLY with JSON: {{"line": <number>, "content": "<exact text of that line>"}}'
            )
        }]
    )

    # Parse the JSON response — handle cases where Claude adds surrounding text
    text = message.content[0].text.strip()
    m = re.search(r"\{.*?\}", text, re.DOTALL)
    if m:
        try:
            result = json.loads(m.group())
            line_num = int(result.get("line", start))
            # Clamp to valid range — Claude occasionally hallucinates line numbers
            line_num = max(start, min(end, line_num))
            return {
                "line":    line_num,
                "content": result.get("content", "").strip(),
            }
        except (json.JSONDecodeError, ValueError):
            pass

    return {"line": start, "content": ""}
