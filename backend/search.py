import os
import re
import time
import fnmatch
from config import IGNORE_FOLDERS


def parse_globs(glob_str):
    if not glob_str:
        return []
    return [g.strip() for g in glob_str.split(",") if g.strip()]


def matches_any_glob(path, globs):
    for g in globs:
        if fnmatch.fnmatch(path, g) or fnmatch.fnmatch(os.path.basename(path), g):
            return True
        if g.startswith(".") and fnmatch.fnmatch(path, f"*{g}"):
            return True
    return False


def build_pattern(query, use_regex, match_word, match_case):
    pattern = query if use_regex else re.escape(query)
    if match_word:
        pattern = rf"\b{pattern}\b"
    flags = 0 if match_case else re.IGNORECASE
    return re.compile(pattern, flags)


def run_search(query, workspace_path, match_case, match_word, use_regex, files_include, files_exclude):
    include_globs = parse_globs(files_include)
    exclude_globs = parse_globs(files_exclude)

    compiled = build_pattern(query, use_regex, match_word, match_case)

    start_time = time.time()
    results = []

    for root, dirs, files in os.walk(workspace_path):
        dirs[:] = [d for d in dirs if d not in IGNORE_FOLDERS]

        for file_name in files:
            file_path = os.path.join(root, file_name)
            rel_path = os.path.relpath(file_path, workspace_path).replace("\\", "/")

            if exclude_globs and matches_any_glob(rel_path, exclude_globs):
                continue
            if include_globs and not matches_any_glob(rel_path, include_globs):
                continue

            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    for line_num, line in enumerate(f, start=1):
                        matches = [
                            [m.start(), m.end()] for m in compiled.finditer(line)
                        ]
                        if matches:
                            results.append(
                                {
                                    "file": file_path,
                                    "line": line_num,
                                    "content": line.rstrip("\n"),
                                    "matches": matches,
                                }
                            )
            except Exception as e:
                print(f"Could not read file {file_path}: {e}")

    time_ms = int((time.time() - start_time) * 1000)
    return results, time_ms
