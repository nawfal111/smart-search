# ─────────────────────────────────────────────────────────────────────────────
# chunker.py  —  CODE CHUNKER
#
# Splits a source file into meaningful pieces called "chunks".
# Each chunk = one function or class method.
#
# WHY we chunk by functions (not by lines or files):
#   If we embed a whole file as one vector, we lose precision.
#   A search for "verify token" would match the whole auth.py file.
#   By chunking per function, Pinecone can pinpoint the exact function.
#
# TWO STRATEGIES:
#   Python → uses Python's built-in AST (Abstract Syntax Tree) parser
#            Very accurate: finds exact function boundaries, handles decorators,
#            async functions, nested classes, etc.
#
#   JS/TS  → uses regex pattern matching
#            Finds: function foo() | const foo = () => | async function foo()
#            Less precise than AST but works well for most cases
#
#   Other  → fallback: treat the whole file as one chunk
#
# FALLBACK:
#   If a file has no functions (e.g. a config file, a constants file),
#   or if parsing fails, the whole file is returned as a single chunk.
# ─────────────────────────────────────────────────────────────────────────────

import ast
import re

# Maximum characters per chunk sent to the embedding model
# Keeps chunks within OpenAI's token limit
MAX_CHUNK_CHARS = 6000


def _fallback_chunk(content, file_path, lines):
    """
    Returns the whole file as a single chunk.
    Used when:
      - The file has no functions (e.g. constants.py, config files)
      - Parsing fails (e.g. syntax errors in the file)
    """
    return [{
        "id": f"{file_path}::__file__",   # unique ID for this chunk in Pinecone
        "name": "__file__",
        "type": "file",
        "content": content[:MAX_CHUNK_CHARS],
        "start_line": 1,
        "end_line": len(lines),
    }]


def chunk_python(content, file_path):
    """
    Chunks a Python file using the AST parser.
    Extracts every function and method (including inside classes).
    Each function becomes its own chunk with exact line numbers.
    """
    lines = content.split("\n")
    chunks = []

    # Try to parse the file into an AST
    # If the file has syntax errors, fall back to whole-file chunk
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return _fallback_chunk(content, file_path, lines)

    def extract(nodes):
        """Recursively extract functions from a list of AST nodes."""
        for node in nodes:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                # Extract the exact lines of this function
                body = "\n".join(lines[node.lineno - 1 : node.end_lineno])
                chunks.append({
                    "id": f"{file_path}::{node.name}",  # e.g. "auth.py::verify_token"
                    "name": node.name,
                    "type": "function",
                    "content": body[:MAX_CHUNK_CHARS],
                    "start_line": node.lineno,
                    "end_line": node.end_lineno,
                })
            elif isinstance(node, ast.ClassDef):
                # For classes: index each method separately (not the class itself)
                # This gives more precise search results
                extract(node.body)

    extract(tree.body)

    # If no functions were found, return the whole file as one chunk
    return chunks if chunks else _fallback_chunk(content, file_path, lines)


def chunk_js_ts(content, file_path):
    """
    Chunks a JavaScript or TypeScript file using regex.
    Matches common function declaration patterns:
      - function foo(...)
      - const foo = (...) =>
      - const foo = async (...) =>
      - export function foo(...)
      - export default async function foo(...)
    """
    lines = content.split("\n")
    chunks = []

    # Regex matches function declarations at the start of a line
    pattern = re.compile(
        r"^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?"
        r"(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|(?:\w+)\s*=>))",
        re.MULTILINE,
    )

    matches = list(pattern.finditer(content))
    for i, match in enumerate(matches):
        name = match.group(1) or match.group(2)  # get the function name
        if not name:
            continue

        # Calculate line numbers from character position
        start_line = content[: match.start()].count("\n") + 1

        # End of this function = start of the next function (or end of file)
        end_line = (
            content[: matches[i + 1].start()].count("\n")
            if i + 1 < len(matches)
            else len(lines)
        )

        body = "\n".join(lines[start_line - 1 : end_line])
        chunks.append({
            "id": f"{file_path}::{name}",
            "name": name,
            "type": "function",
            "content": body[:MAX_CHUNK_CHARS],
            "start_line": start_line,
            "end_line": end_line,
        })

    return chunks if chunks else _fallback_chunk(content, file_path, lines)


def chunk_file(content, file_path, language):
    """
    Main entry point — routes to the right chunker based on language.
    Called by the /chunk endpoint in server.py.
    """
    if language == "python":
        return chunk_python(content, file_path)
    elif language in ("typescript", "javascript"):
        return chunk_js_ts(content, file_path)
    else:
        # For unsupported languages, treat whole file as one chunk
        lines = content.split("\n")
        return _fallback_chunk(content, file_path, lines)
