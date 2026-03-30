import ast
import re

MAX_CHUNK_CHARS = 6000


def _fallback_chunk(content, file_path, lines):
    return [{
        "id": f"{file_path}::__file__",
        "name": "__file__",
        "type": "file",
        "content": content[:MAX_CHUNK_CHARS],
        "start_line": 1,
        "end_line": len(lines),
    }]


def chunk_python(content, file_path):
    lines = content.split("\n")
    chunks = []

    try:
        tree = ast.parse(content)
    except SyntaxError:
        return _fallback_chunk(content, file_path, lines)

    def extract(nodes):
        for node in nodes:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                body = "\n".join(lines[node.lineno - 1 : node.end_lineno])
                chunks.append({
                    "id": f"{file_path}::{node.name}",
                    "name": node.name,
                    "type": "function",
                    "content": body[:MAX_CHUNK_CHARS],
                    "start_line": node.lineno,
                    "end_line": node.end_lineno,
                })
            elif isinstance(node, ast.ClassDef):
                # Index each method separately
                extract(node.body)

    extract(tree.body)
    return chunks if chunks else _fallback_chunk(content, file_path, lines)


def chunk_js_ts(content, file_path):
    lines = content.split("\n")
    chunks = []

    # Match: function foo(...) | const foo = (...) => | foo(...) { (class methods)
    pattern = re.compile(
        r"^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?"
        r"(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|(?:\w+)\s*=>))",
        re.MULTILINE,
    )

    matches = list(pattern.finditer(content))
    for i, match in enumerate(matches):
        name = match.group(1) or match.group(2)
        if not name:
            continue
        start_line = content[: match.start()].count("\n") + 1
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
    if language == "python":
        return chunk_python(content, file_path)
    elif language in ("typescript", "javascript"):
        return chunk_js_ts(content, file_path)
    else:
        lines = content.split("\n")
        return _fallback_chunk(content, file_path, lines)
