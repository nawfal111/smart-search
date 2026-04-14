# Smart Search — Technical Report
**VS Code Extension | Master's Senior Research Project**
**Author:** Nawfal Jalloul
**Date:** April 2026

---

## 1. What is Smart Search?

Smart Search is a VS Code extension that brings **semantic code search** to any codebase. Unlike traditional search tools (grep, VS Code's built-in search) that match exact words or patterns, Smart Search understands the *meaning* of code.

**Example:**
- You type: `"find authentication logic"`
- Traditional search: finds files containing the word "authentication"
- Smart Search: finds `verify_token()`, `check_password()`, `validate_session()` — even if the word "authentication" never appears in those function names

This is the research contribution: **semantic search over code using embeddings**, compared against lexical/keyword search.

---

## 2. High-Level Architecture

The system has three parts:

```
Developer's Machine                Cloud
─────────────────────              ──────────────
VS Code Extension (TypeScript)  →  OpenAI API (embedding)
Python Backend (localhost:8000) →  Pinecone (vector storage)
.smart-search/ (local hashes)
```

**VS Code Extension** handles everything local:
- Detecting which files/functions changed
- Splitting code into functions (chunking)
- Running the search UI

**Python Backend** handles the expensive cloud operations:
- Sending code text to OpenAI to get embeddings
- Saving/deleting vectors in Pinecone

**Why split?** VS Code extensions run in Node.js (TypeScript/JavaScript). OpenAI and Pinecone have mature Python SDKs. Splitting keeps each part in its strongest language.

---

## 3. Where Data is Stored

| Data | Location | Why |
|------|----------|-----|
| Function content hashes | `project/.smart-search/index.json` | Moves with the project, gitignored |
| Project unique ID | `project/.smart-search/project-id` | Stable UUID, survives folder moves |
| User unique ID | MD5 of `git config --global user.email` | Same across all machines for same developer |
| Embeddings (vectors) | Pinecone cloud | 1536 floats per function — too large for local |

### Why hashes in the project folder?

Previously considered: VS Code global storage (`~/Library/Application Support/Code/...`). Problem: if the user reinstalls VS Code or moves the project folder, hashes are lost and everything re-embeds from scratch (costs money).

By storing hashes in `.smart-search/` inside the project:
- Moving the folder → hashes move with it → nothing re-embeds
- VS Code reinstall → hashes still in the project folder → nothing re-embeds
- Git push → `.smart-search/` is gitignored → hashes don't pollute the repo

---

## 4. User Identity System

### The Problem
If two developers share the same project, they must not overwrite each other's Pinecone vectors.

### The Solution
**Pinecone namespace** = `{projectId}::{userId}`

- **projectId** — UUID stored in `.smart-search/project-id`. Generated once per project. Travels with the project folder.
- **userId** — MD5 hash of the developer's global git email (`~/.gitconfig`). Same across all their machines. Different from teammates.

```
Nawfal's namespace:   a3f2c1d4 :: b7f2a1c5
Ahmed's namespace:    a3f2c1d4 :: c9d8e7f6   ← same project, different user
```

### Why git email?
- Already configured on virtually every developer's machine
- Consistent across home PC, work laptop, new computer
- Survives VS Code reinstall (lives in `~/.gitconfig`, not in VS Code)
- Different from teammates by definition

### If git email not configured
Extension shows a clear VS Code error notification:
> "Smart Search needs your git email. Run: `git config --global user.email you@example.com` — then reload VS Code."

Indexing stops. No silent fallback that would cause inconsistent behavior.

---

## 5. Indexing Pipeline — How Functions Get Embedded

### Two-Level Hashing Strategy

Embedding costs money (OpenAI API). The goal is to **only embed what actually changed**.

#### Level 1 — File Hash (Fast Pre-Filter)
1. MD5-hash the entire file content
2. Compare with stored hash in `index.json`
3. If match → file unchanged → **skip everything** (0 API calls)
4. If different → proceed to Level 2

Cost: one MD5 computation per file. Negligible.

#### Level 2 — Function Hash (Precise Detection)
1. Split the file into individual functions (done locally in TypeScript — no network call)
2. For each function: normalize content (strip blank lines, trailing whitespace) → MD5 hash
3. Compare each function hash with stored hash:
   - **Same hash** → function unchanged → keep existing Pinecone vector
   - **Different hash** → function changed → add to re-embed queue
   - **Not in index** → new function → add to embed queue
   - **In index but missing** → function deleted → add ID to delete queue

#### Why normalize before hashing?
If a developer adds a blank line or reformats indentation, the bytes change but the logic doesn't. Without normalization, this triggers a re-embed — wasting money on no real change.

Normalization strips:
- Trailing whitespace on each line
- Blank/whitespace-only lines

After normalization, `verify_token()` with an extra blank line has the **same hash** as without it.

### Batched Embedding
Instead of one OpenAI API call per function, all changed functions from one file are sent in a **single batch call**. OpenAI supports up to 2048 inputs per request. This is faster and uses fewer API rate-limit tokens.

### The Full Flow (First Run)
```
VS Code opens project
  → Check git email (error if missing)
  → Read or create project-id
  → Build namespace = projectId :: userId
  → Load index.json (empty on first run)
  → Walk all workspace files
  → For each file:
      → Hash file → compare with index
      → If changed: chunk into functions (local, TypeScript)
      → For each function:
          → Normalize + hash → compare with index
          → If changed: add to embed queue
      → Send ALL changed functions in one OpenAI batch call
      → Save new vectors to Pinecone (under namespace)
      → Save new hashes to index.json
  → Remove deleted files from index + Pinecone
  → Show "X files updated" in status bar
```

### On Every File Save
Same flow, but only for the one saved file. If the file hash matches — nothing happens at all.

---

## 6. Code Chunker — Splitting Code into Functions

Chunking happens entirely in TypeScript inside the extension. No network call, no Python involved.

### Supported Languages
| Language | Strategy |
|----------|----------|
| Python | Indentation-based (`def`, `async def`, `class`) |
| JavaScript / TypeScript / JSX / TSX | Brace-counting + arrow functions |
| Java | Brace-counting |
| Go | Brace-counting |
| Rust | Brace-counting |
| C / C++ | Brace-counting |
| C# | Brace-counting |
| PHP | Brace-counting |
| Ruby | `end` keyword counting |
| Swift | Brace-counting |
| Kotlin | Brace-counting |
| Other | Whole file as one chunk (fallback) |

### Chunk Format
Each chunk has:
- **id** — unique ID: `"src/auth.py::verify_token"` (relative path, portable)
- **name** — function/class name
- **type** — `function`, `class`, `method`, or `file`
- **content** — full source code (max 6000 characters)
- **start_line** / **end_line** — position in file
- **language** — programming language

### Why relative paths in chunk IDs?
If chunk IDs used absolute paths (`/Users/nawfal/projects/myapp/src/auth.py::verify_token`), moving the project folder would make all existing Pinecone vectors unreachable — the IDs would no longer match.

Using relative paths (`src/auth.py::verify_token`) means the ID is the same regardless of where the project lives on disk.

---

## 7. Pinecone Vector Storage

Each function is stored in Pinecone as:

```
ID:       "src/auth.py::verify_token"
Vector:   [0.21, -0.54, 0.87, ...] (1536 floats)
Metadata: {
  file:       "src/auth.py"
  name:       "verify_token"
  type:       "function"
  start_line: 5
  end_line:   25
  content:    "def verify_token(token):\n    ..." (first 1000 chars)
}
Namespace: "a3f2c1d4::b7f2a1c5"   ← projectId :: userId
```

**Metadata content limited to 1000 characters** — Pinecone has a metadata size limit. The first 1000 chars are enough to show context in search results. Full source is always on disk.

### Upsert vs Insert
Pinecone uses "upsert" — if a vector with this ID already exists, it's replaced. If not, it's created. This means when a function changes:
1. Delete old vector by ID
2. Upsert new vector with same ID (new embedding)

---

## 8. Search

### Normal Search (Currently Working)
- Query sent to Python `/search` endpoint
- Python walks the entire workspace with regex matching
- Supports: Match Case, Match Whole Word, Use Regex, Include/Exclude glob filters
- Returns: file path, line number, matched content, character-level match positions
- Results rendered in VS Code webview
- Clicking a result opens the file at the exact line with text highlighted

### Replace
- Single replace: uses VS Code `WorkspaceEdit` API — supports Ctrl+Z undo
- Replace All: replaces from bottom-to-top across all files so character positions stay accurate

### AI Search (Planned)
- User types a natural-language query
- Extension embeds the query with OpenAI (same model: `text-embedding-3-small`)
- Query vector compared against all stored function vectors in Pinecone (cosine similarity)
- Top-N most semantically similar functions returned
- Results shown with function name, file, line range, and content preview

---

## 9. Key Design Decisions

| Decision | Chosen Approach | Why |
|----------|----------------|-----|
| Who chunks the code? | TypeScript extension | Removes one network call per file |
| Where are hashes stored? | `.smart-search/` in project | Survives folder moves and VS Code reinstall |
| How is user identified? | MD5(git global email) | Same across all machines; survives reinstall |
| How are projects isolated in Pinecone? | Namespace = projectId::userId | Each user's vectors never mix |
| How are chunk IDs formed? | Relative file path :: function name | Portable across folder moves |
| How to avoid re-embedding on format changes? | Normalize before hashing | Saves API cost |
| How to reduce OpenAI API calls? | Batch all changed functions in one call | Faster + cheaper |
| What if git email not configured? | Show error, stop indexing | No silent bad behavior |

---

## 10. Research Comparison: Old vs New Search

| Aspect | Traditional (grep/regex) | Smart Search (semantic) |
|--------|--------------------------|------------------------|
| Query type | Exact text / pattern | Natural language / concept |
| Finds renamed functions? | No | Yes |
| Finds similar logic with different variable names? | No | Yes |
| Requires understanding code? | No | Yes (via embeddings) |
| Cost | Free | OpenAI API (~$0.00002/1K tokens) |
| Speed | Very fast (local) | Slower (embedding on changes) |
| Setup | None | Requires Python backend + API keys |

---

## 11. Running the Project

### Prerequisites
- Node.js + npm
- Python 3.8+
- git globally configured email
- OpenAI API key (with credits)
- Pinecone API key + index

### Setup
```bash
# 1. Install Python dependencies
cd backend
pip install -r requirements.txt

# 2. Configure API keys in backend/.env
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=pcsk_...
PINECONE_HOST=https://your-index.svc.pinecone.io
ANTHROPIC_API_KEY=sk-ant-...  (for future AI search)

# 3. Start Python backend
python3 server.py

# 4. Compile TypeScript extension
cd ..
npm install
npm run compile

# 5. Press F5 in VS Code to launch extension
```

### What happens after F5
1. A new VS Code window opens (Extension Development Host)
2. Status bar shows: `⟳ Smart Search: indexing 1/47...`
3. Every file gets chunked and embedded (first time only)
4. Status bar shows: `✓ Smart Search: 47 files updated`
5. Open Smart Search from Command Palette → search works

---

## 12. File Structure

```
smart-search/
├── src/                          ← TypeScript extension source
│   ├── extension.ts              ← Entry point, activation, event listeners
│   ├── indexer/
│   │   ├── workspaceIndexer.ts   ← Core indexing logic, two-level hashing
│   │   ├── chunker.ts            ← Code splitter (12+ languages, local)
│   │   ├── localIndex.ts         ← Read/write .smart-search/index.json
│   │   ├── projectId.ts          ← Generate/read project UUID
│   │   └── userId.ts             ← Get user ID from git email
│   ├── handlers/
│   │   ├── searchHandler.ts      ← Route search queries to Python
│   │   └── replaceHandler.ts     ← Apply replacements in files
│   └── utils/
│       └── webviewManager.ts     ← Load frontend HTML into VS Code panel
│
├── backend/                      ← Python server
│   ├── server.py                 ← HTTP server (localhost:8000)
│   ├── embedder.py               ← OpenAI embedding (batched)
│   ├── pinecone_client.py        ← Pinecone upsert/delete (with namespace)
│   ├── search.py                 ← Regex/text file search
│   ├── config.py                 ← Ignored folders list
│   ├── requirements.txt          ← Python dependencies
│   └── .env                      ← API keys (never committed)
│
├── frontend/                     ← Search UI (inlined into VS Code webview)
│   ├── index.html                ← UI structure
│   ├── styles.css                ← Styling
│   └── main.js                   ← UI logic, VS Code message passing
│
├── reports/                      ← This folder
│   ├── documents/                ← This document
│   └── workflows/                ← Mermaid diagrams (run at mermaid.live)
│
├── out/                          ← Compiled TypeScript (generated, don't edit)
├── package.json                  ← Extension metadata + build scripts
└── tsconfig.json                 ← TypeScript compiler config
```

---

*April 2026 — Smart Search VS Code Extension*
