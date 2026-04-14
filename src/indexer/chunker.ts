// ─────────────────────────────────────────────────────────────────────────────
// chunker.ts  —  LOCAL CODE CHUNKER (TypeScript)
//
// Splits a source file into meaningful chunks (functions, classes, methods).
// Runs entirely inside the VS Code extension — NO network call needed.
//
// SUPPORTED LANGUAGES:
//   Python     → indentation-based block detection
//   JS / TS    → brace-counting + arrow functions (React, Node, Angular, Vue)
//   Java       → brace-counting (Spring, Android)
//   Go         → brace-counting (Gin, Echo, Fiber)
//   Rust       → brace-counting (Actix, Axum)
//   C / C++    → brace-counting
//   C#         → brace-counting (ASP.NET)
//   PHP        → brace-counting (Laravel, Symfony)
//   Ruby       → end-keyword detection (Rails)
//   Swift      → brace-counting (iOS)
//   Kotlin     → brace-counting (Android, Ktor)
//   Other      → whole file as one chunk (fallback)
//
// HOW BLOCK END IS DETECTED:
//   Brace languages  → count { and } until back to 0
//   Python           → track indentation level
//   Ruby             → count def/class/do vs end keywords
// ─────────────────────────────────────────────────────────────────────────────

import * as path from "path";

const MAX_CHUNK_CHARS = 6000;

export interface Chunk {
  id: string;          // "src/auth.py::verify_token"
  name: string;        // "verify_token"
  type: string;        // "function" | "class" | "method" | "file"
  content: string;     // source code of the chunk (max 6000 chars)
  start_line: number;  // 1-based
  end_line: number;    // 1-based
  file: string;        // relative file path (relative to workspace root, e.g. "src/auth.py")
  language: string;    // "python", "typescript", etc.
}

// ── Block end finders ─────────────────────────────────────────────────────────

// For C-style languages: count { and } to find where a block ends
// Starts counting from the given line, returns the line index where depth hits 0
function findBraceEnd(lines: string[], startIdx: number): number {
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; started = true; }
      else if (ch === "}") {
        if (started) depth--;
        if (started && depth === 0) return i;
      }
    }
  }
  return lines.length - 1;
}

// For Python: use indentation to find where a def/class block ends
// A block ends when we see a non-empty line at the same or lower indentation
function findPythonEnd(lines: string[], startIdx: number): number {
  const headerIndent = lines[startIdx].match(/^(\s*)/)?.[1].length ?? 0;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue; // blank lines are OK inside a block
    const indent = lines[i].match(/^(\s*)/)?.[1].length ?? 0;
    if (indent <= headerIndent) return i - 1;
  }
  return lines.length - 1;
}

// For Ruby: count def/class/module/do vs end keywords
function findRubyEnd(lines: string[], startIdx: number): number {
  let depth = 1;
  const openers = /^\s*(?:def|class|module|do|if|unless|while|until|for|begin|case)\b/;
  const closer  = /^\s*end\b/;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (openers.test(lines[i])) depth++;
    if (closer.test(lines[i]))  { depth--; if (depth === 0) return i; }
  }
  return lines.length - 1;
}

// ── Language chunkers ─────────────────────────────────────────────────────────

function chunkPython(lines: string[], filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  // Match: def name( | async def name( | class Name
  const pattern = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(|^(\s*)class\s+(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const m = pattern.exec(lines[i]);
    if (!m) continue;

    const isFunc  = m[2] !== undefined;
    const name    = isFunc ? m[2] : m[4];
    const type    = isFunc ? "function" : "class";
    const endIdx  = findPythonEnd(lines, i);
    const content = lines.slice(i, endIdx + 1).join("\n");

    chunks.push({
      id: `${filePath}::${name}`, name, type,
      content: content.slice(0, MAX_CHUNK_CHARS),
      start_line: i + 1, end_line: endIdx + 1,
      file: filePath, language: "python",
    });

    // For functions: skip past the body (we already captured it)
    // For classes: continue into the body to capture methods too
    if (isFunc) i = endIdx;
  }
  return chunks;
}

function chunkJsTs(lines: string[], filePath: string, language: string): Chunk[] {
  const chunks: Chunk[] = [];

  // Patterns for JS/TS — covers React components, hooks, arrow functions, classes
  const patterns: { re: RegExp; nameIdx: number; type: string }[] = [
    // function foo() / async function foo() / export function foo()
    { re: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/, nameIdx: 1, type: "function" },
    // const foo = () => / const foo = async () => / export const foo = ...
    { re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>/, nameIdx: 1, type: "function" },
    // const foo = function() / const foo = async function()
    { re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/, nameIdx: 1, type: "function" },
    // class Foo / export class Foo / export default class Foo
    { re: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/, nameIdx: 1, type: "class" },
    // class method: foo() { or async foo() { or static foo() {
    { re: /^\s+(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>[\],\s|]+)?\s*\{/, nameIdx: 1, type: "method" },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, nameIdx, type } of patterns) {
      const m = re.exec(lines[i]);
      if (!m) continue;
      const name = m[nameIdx];
      if (!name || name === "if" || name === "for" || name === "while" || name === "switch") continue;

      const endIdx  = findBraceEnd(lines, i);
      const content = lines.slice(i, endIdx + 1).join("\n");

      chunks.push({
        id: `${filePath}::${name}`, name, type,
        content: content.slice(0, MAX_CHUNK_CHARS),
        start_line: i + 1, end_line: endIdx + 1,
        file: filePath, language,
      });

      if (type !== "class") i = endIdx; // skip past function body
      break; // only match first pattern per line
    }
  }
  return chunks;
}

function chunkJava(lines: string[], filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  const patterns: { re: RegExp; nameIdx: number; type: string }[] = [
    // class / interface / enum / record
    { re: /^(?:public|private|protected|\s)*(?:abstract\s+)?(?:class|interface|enum|record)\s+(\w+)/, nameIdx: 1, type: "class" },
    // method: public/private/... ReturnType methodName(
    { re: /^\s+(?:(?:public|private|protected|static|final|synchronized|native|abstract)\s+)*[\w<>\[\],\s]+\s+(\w+)\s*\([^;]*$/, nameIdx: 1, type: "method" },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, nameIdx, type } of patterns) {
      const m = re.exec(lines[i]);
      if (!m) continue;
      const name = m[nameIdx];
      if (!name) continue;

      const endIdx  = findBraceEnd(lines, i);
      const content = lines.slice(i, endIdx + 1).join("\n");

      chunks.push({
        id: `${filePath}::${name}`, name, type,
        content: content.slice(0, MAX_CHUNK_CHARS),
        start_line: i + 1, end_line: endIdx + 1,
        file: filePath, language: "java",
      });

      if (type !== "class") i = endIdx;
      break;
    }
  }
  return chunks;
}

function chunkGo(lines: string[], filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  const patterns: { re: RegExp; nameIdx: number; type: string }[] = [
    // func FunctionName( / func (r Receiver) MethodName(
    { re: /^func\s+(?:\(\s*\w+\s+\*?\w+\s*\)\s+)?(\w+)\s*[(<]/, nameIdx: 1, type: "function" },
    // type Name struct / type Name interface
    { re: /^type\s+(\w+)\s+(?:struct|interface)/, nameIdx: 1, type: "class" },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, nameIdx, type } of patterns) {
      const m = re.exec(lines[i]);
      if (!m) continue;
      const name = m[nameIdx];
      if (!name) continue;

      const endIdx  = findBraceEnd(lines, i);
      const content = lines.slice(i, endIdx + 1).join("\n");

      chunks.push({
        id: `${filePath}::${name}`, name, type,
        content: content.slice(0, MAX_CHUNK_CHARS),
        start_line: i + 1, end_line: endIdx + 1,
        file: filePath, language: "go",
      });

      i = endIdx;
      break;
    }
  }
  return chunks;
}

function chunkRust(lines: string[], filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  const patterns: { re: RegExp; nameIdx: number; type: string }[] = [
    // fn name( / pub fn name( / async fn / pub async fn
    { re: /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/, nameIdx: 1, type: "function" },
    // struct / enum / impl / trait
    { re: /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum|impl|trait)\s+(\w+)/, nameIdx: 1, type: "class" },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, nameIdx, type } of patterns) {
      const m = re.exec(lines[i]);
      if (!m) continue;
      const name = m[nameIdx];
      if (!name) continue;

      const endIdx  = findBraceEnd(lines, i);
      const content = lines.slice(i, endIdx + 1).join("\n");

      chunks.push({
        id: `${filePath}::${name}`, name, type,
        content: content.slice(0, MAX_CHUNK_CHARS),
        start_line: i + 1, end_line: endIdx + 1,
        file: filePath, language: "rust",
      });

      if (type !== "class") i = endIdx;
      break;
    }
  }
  return chunks;
}

function chunkCSharp(lines: string[], filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  const patterns: { re: RegExp; nameIdx: number; type: string }[] = [
    // class / interface / struct / enum / record
    { re: /^(?:\s*)(?:(?:public|private|protected|internal|static|abstract|sealed|partial)\s+)*(?:class|interface|struct|enum|record)\s+(\w+)/, nameIdx: 1, type: "class" },
    // method: public/private Type MethodName(
    { re: /^\s+(?:(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed)\s+)*[\w<>\[\],?\s]+\s+(\w+)\s*\([^;]*$/, nameIdx: 1, type: "method" },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, nameIdx, type } of patterns) {
      const m = re.exec(lines[i]);
      if (!m) continue;
      const name = m[nameIdx];
      if (!name || name === "if" || name === "for" || name === "while" || name === "using") continue;

      const endIdx  = findBraceEnd(lines, i);
      const content = lines.slice(i, endIdx + 1).join("\n");

      chunks.push({
        id: `${filePath}::${name}`, name, type,
        content: content.slice(0, MAX_CHUNK_CHARS),
        start_line: i + 1, end_line: endIdx + 1,
        file: filePath, language: "csharp",
      });

      if (type !== "class") i = endIdx;
      break;
    }
  }
  return chunks;
}

function chunkPhp(lines: string[], filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  const patterns: { re: RegExp; nameIdx: number; type: string }[] = [
    // class / interface / trait / abstract class
    { re: /^(?:abstract\s+)?(?:class|interface|trait)\s+(\w+)/, nameIdx: 1, type: "class" },
    // function name( / public function name( / static function name(
    { re: /^(?:\s*)(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+(\w+)\s*\(/, nameIdx: 1, type: "function" },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, nameIdx, type } of patterns) {
      const m = re.exec(lines[i]);
      if (!m) continue;
      const name = m[nameIdx];
      if (!name) continue;

      const endIdx  = findBraceEnd(lines, i);
      const content = lines.slice(i, endIdx + 1).join("\n");

      chunks.push({
        id: `${filePath}::${name}`, name, type,
        content: content.slice(0, MAX_CHUNK_CHARS),
        start_line: i + 1, end_line: endIdx + 1,
        file: filePath, language: "php",
      });

      if (type !== "class") i = endIdx;
      break;
    }
  }
  return chunks;
}

function chunkRuby(lines: string[], filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  const pattern = /^(\s*)(?:def\s+(?:self\.)?(\w+)|class\s+(\w+)|module\s+(\w+))/;

  for (let i = 0; i < lines.length; i++) {
    const m = pattern.exec(lines[i]);
    if (!m) continue;

    const name = m[2] || m[3] || m[4];
    const type = m[2] ? "function" : m[3] ? "class" : "module";
    const endIdx  = findRubyEnd(lines, i);
    const content = lines.slice(i, endIdx + 1).join("\n");

    chunks.push({
      id: `${filePath}::${name}`, name, type,
      content: content.slice(0, MAX_CHUNK_CHARS),
      start_line: i + 1, end_line: endIdx + 1,
      file: filePath, language: "ruby",
    });

    if (type === "function") i = endIdx;
  }
  return chunks;
}

function chunkSwift(lines: string[], filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  const patterns: { re: RegExp; nameIdx: number; type: string }[] = [
    { re: /^(?:(?:public|private|internal|fileprivate|open|static|class|override|final|mutating|required)\s+)*func\s+(\w+)/, nameIdx: 1, type: "function" },
    { re: /^(?:(?:public|private|internal|fileprivate|open|final)\s+)*(?:class|struct|enum|protocol|actor|extension)\s+(\w+)/, nameIdx: 1, type: "class" },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, nameIdx, type } of patterns) {
      const m = re.exec(lines[i]);
      if (!m) continue;
      const name = m[nameIdx];
      if (!name) continue;

      const endIdx  = findBraceEnd(lines, i);
      const content = lines.slice(i, endIdx + 1).join("\n");

      chunks.push({
        id: `${filePath}::${name}`, name, type,
        content: content.slice(0, MAX_CHUNK_CHARS),
        start_line: i + 1, end_line: endIdx + 1,
        file: filePath, language: "swift",
      });

      if (type !== "class") i = endIdx;
      break;
    }
  }
  return chunks;
}

function chunkKotlin(lines: string[], filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  const patterns: { re: RegExp; nameIdx: number; type: string }[] = [
    { re: /^(?:(?:public|private|protected|internal|override|suspend|inline|infix|operator|open|abstract|final)\s+)*fun\s+(?:<[^>]*>\s+)?(?:\w+\.)?(\w+)\s*\(/, nameIdx: 1, type: "function" },
    { re: /^(?:data\s+|sealed\s+|abstract\s+)?(?:class|object|interface)\s+(\w+)/, nameIdx: 1, type: "class" },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, nameIdx, type } of patterns) {
      const m = re.exec(lines[i]);
      if (!m) continue;
      const name = m[nameIdx];
      if (!name) continue;

      const endIdx  = findBraceEnd(lines, i);
      const content = lines.slice(i, endIdx + 1).join("\n");

      chunks.push({
        id: `${filePath}::${name}`, name, type,
        content: content.slice(0, MAX_CHUNK_CHARS),
        start_line: i + 1, end_line: endIdx + 1,
        file: filePath, language: "kotlin",
      });

      if (type !== "class") i = endIdx;
      break;
    }
  }
  return chunks;
}

// C and C++ — brace-based, simple pattern
function chunkC(lines: string[], filePath: string, language: string): Chunk[] {
  const chunks: Chunk[] = [];
  // Match function definitions: returnType functionName(
  // Must be at start of line and not a declaration (has a body = has {)
  const re = /^[\w*]+(?:\s+[\w*]+)*\s+(\w+)\s*\([^;]*$/;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#") || lines[i].startsWith("//")) continue;
    const m = re.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    if (!name || name === "if" || name === "for" || name === "while" || name === "switch") continue;

    // Only proceed if this actually has a brace (it's a definition, not a declaration)
    const combined = lines.slice(i, Math.min(i + 5, lines.length)).join(" ");
    if (!combined.includes("{")) continue;

    const endIdx  = findBraceEnd(lines, i);
    const content = lines.slice(i, endIdx + 1).join("\n");

    chunks.push({
      id: `${filePath}::${name}`, name, type: "function",
      content: content.slice(0, MAX_CHUNK_CHARS),
      start_line: i + 1, end_line: endIdx + 1,
      file: filePath, language,
    });

    i = endIdx;
  }
  return chunks;
}

// Fallback: treat the whole file as one chunk
function fallbackChunk(content: string, filePath: string, language: string): Chunk[] {
  const lines = content.split("\n");
  return [{
    id: `${filePath}::__file__`,
    name: "__file__",
    type: "file",
    content: content.slice(0, MAX_CHUNK_CHARS),
    start_line: 1,
    end_line: lines.length,
    file: filePath,
    language,
  }];
}

// ── Main entry point ──────────────────────────────────────────────────────────

// Maps file extension → language identifier
export const LANGUAGE_MAP: Record<string, string> = {
  ".py":   "python",
  ".ts":   "typescript",  ".tsx": "typescript",
  ".js":   "javascript",  ".jsx": "javascript",
  ".java": "java",
  ".go":   "go",
  ".rs":   "rust",
  ".c":    "c",           ".h":  "c",
  ".cpp":  "cpp",         ".cc": "cpp",  ".cxx": "cpp",
  ".cs":   "csharp",
  ".php":  "php",
  ".rb":   "ruby",
  ".swift":"swift",
  ".kt":   "kotlin",      ".kts": "kotlin",
  ".vue":  "typescript",  // treat Vue <script> as TypeScript
};

// Splits a file's content into function/class chunks
// Called locally — no network call needed
export function chunkFile(content: string, filePath: string, language: string): Chunk[] {
  const lines = content.split("\n");
  let chunks: Chunk[] = [];

  switch (language) {
    case "python":              chunks = chunkPython(lines, filePath);              break;
    case "typescript":
    case "javascript":          chunks = chunkJsTs(lines, filePath, language);      break;
    case "java":                chunks = chunkJava(lines, filePath);                break;
    case "go":                  chunks = chunkGo(lines, filePath);                  break;
    case "rust":                chunks = chunkRust(lines, filePath);                break;
    case "csharp":              chunks = chunkCSharp(lines, filePath);              break;
    case "php":                 chunks = chunkPhp(lines, filePath);                 break;
    case "ruby":                chunks = chunkRuby(lines, filePath);                break;
    case "swift":               chunks = chunkSwift(lines, filePath);               break;
    case "kotlin":              chunks = chunkKotlin(lines, filePath);              break;
    case "c":
    case "cpp":                 chunks = chunkC(lines, filePath, language);         break;
    default:                    return fallbackChunk(content, filePath, language);
  }

  // If no chunks were found, fall back to whole-file chunk
  return chunks.length > 0 ? chunks : fallbackChunk(content, filePath, language);
}
