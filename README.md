# Smart Search

A VS Code extension that lets you search your codebase using plain English — find functions by what they **do**, not what they are **called**.

Built as a Master's research project in Computer Science.

---

## What It Does

Most editors search for text. Smart Search searches for **meaning**.

Type `fetch product from database` and it finds `getProductInfo()` — even though none of those words appear in the function name. It works by embedding your entire codebase into semantic vectors and matching your query against them using cosine similarity.

It also keeps the traditional keyword/regex search working alongside AI search, so it is a complete replacement for the built-in VS Code search.

---

## Features

- **AI Search** — natural language queries matched against function-level semantic embeddings
- **Normal Search** — keyword, regex, whole-word, match-case search across the workspace
- **Replace / Replace All** — replace matches across all files with full undo support
- **Line-level results** — GPT pinpoints the exact line within each matched function
- **Real-time indexing** — index updates automatically on file save, delete, and rename
- **Crash-safe indexing** — progress saved after every batch, resumes from last checkpoint if interrupted
- **Concurrent operations** — search never blocks while indexing is running
- **File filters** — include/exclude glob patterns (e.g. `*.php`, `test*`)
- **Similarity threshold** — adjustable minimum score (default 35%)
- **Terminal status** — backend prints indexing summary on every run

---

## Requirements

### Python Backend

The AI features require a local Python server running at `localhost:8000`.

```bash
cd backend
pip install -r requirements.txt
python3 server.py
```

You should see:
```
Backend server running on http://localhost:8000 (threaded)
```

### API Keys

Create a `backend/.env` file with the following:

```
OPENAI_API_KEY=sk-...
VOYAGE_API_KEY=pa-...
PINECONE_API_KEY=pcsk_...
PINECONE_HOST=https://your-index.svc.pinecone.io
```

| Service | Used for |
|---|---|
| OpenAI (GPT-4o-mini) | Function summarization at index time, line locator at search time |
| Voyage AI (voyage-code-2) | Code embeddings — 1,536-dimensional vectors |
| Pinecone | Vector database — stores and queries embeddings |

### Git Email

The extension uses your git email to identify you (hashed with MD5 — never sent raw to any service). Make sure it is configured:

```bash
git config --global user.email you@example.com
```

---

## How to Run (Development)

1. Open this folder in VS Code
2. Start the Python backend: `python3 backend/server.py`
3. Press **F5** to launch the Extension Development Host
4. Open a project folder in the new window
5. Run the command **Smart Search** from the Command Palette (`Cmd+Shift+P`)

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `smartSearch.backendUrl` | `http://localhost:8000` | URL of the Python backend — change to point at a remote server |

---

## How It Works

### Indexing Pipeline

1. On workspace open or file save, the extension walks the file tree
2. Each file is MD5-hashed and compared against the local `index.json`
3. Changed files are chunked into individual functions (12 languages supported)
4. Each function is hashed — only changed or new functions are re-embedded
5. Changed functions are collected into batches of 50 and sent to the Python backend
6. The backend generates a plain-English GPT summary for each function (all 50 in parallel)
7. Voyage AI embeds `[function label + summary + code]` into a 1,536-float vector
8. Vectors are upserted into Pinecone under namespace `{projectId}::{userId}`
9. `index.json` is saved immediately after each batch (crash-safe checkpoint)

### AI Search Pipeline

1. User types a query in AI mode
2. Query is validated against minimum length (sourced from backend `/config`)
3. Voyage AI embeds the query using `input_type="query"`
4. Pinecone HNSW search returns the top-10 nearest vectors in the user's namespace
5. Results below the similarity threshold are filtered out
6. File include/exclude glob filters are applied
7. GPT-4o-mini reads each result function and identifies the most relevant line (all in parallel)
8. Results are returned with score, summary, matched line, and file path
9. Clicking a result opens the file at the exact matched line

---

## Supported Languages

| Strategy | Languages |
|---|---|
| Brace counting | JavaScript, TypeScript, PHP, Java, Go, Rust, Swift, Kotlin, C, C++, C# |
| Indentation | Python |
| End-keyword | Ruby |
| Fallback (whole file) | Everything else |

---

## Project Structure

```
smart-search/
│
├── src/                          ← TypeScript extension source
│   ├── extension.ts              ← Entry point: startup, listeners, commands
│   ├── config.ts                 ← Backend URL setting
│   ├── indexer/
│   │   ├── workspaceIndexer.ts   ← Two-phase batched indexing, incremental save
│   │   ├── chunker.ts            ← Code splitter (12+ languages)
│   │   ├── localIndex.ts         ← Read/write .smart-search/index.json
│   │   ├── projectId.ts          ← Generate/read project UUID
│   │   └── userId.ts             ← Derive user ID from git email
│   ├── handlers/
│   │   ├── searchHandler.ts      ← Forward search queries to backend
│   │   └── replaceHandler.ts     ← Apply replacements via VS Code edit API
│   └── utils/
│       └── webviewManager.ts     ← Load frontend HTML into webview panel
│
├── backend/                      ← Python server (localhost:8000)
│   ├── server.py                 ← ThreadingHTTPServer — all endpoints
│   ├── summarizer.py             ← GPT-4o-mini summaries at index time
│   ├── line_locator.py           ← GPT-4o-mini line pinpointing at search time
│   ├── embedder.py               ← Voyage AI embeddings (batched)
│   ├── pinecone_client.py        ← Pinecone upsert / delete / query / wipe
│   ├── search.py                 ← Regex/text search across workspace files
│   ├── config.py                 ← MIN_AI_QUERY_LENGTH, DEFAULT_AI_THRESHOLD
│   ├── requirements.txt
│   └── .env                      ← API keys (never commit this file)
│
├── frontend/                     ← Search UI (inlined into webview at runtime)
│   ├── index.html
│   ├── styles.css
│   └── main.js
│
└── reports/documents/            ← Thesis report and diagrams
    ├── smart_search_technical_report.md
    ├── smart_search_technical_report.docx
    ├── smart_search_presentation.pptx
    ├── architecture.png
    ├── indexing_pipeline.png
    └── search_pipeline.png
```

---

## Backend API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check — returns `{"ok": true}` |
| `/config` | GET | Returns `{"minAiQueryLength": 5}` — single source of truth |
| `/index` | POST | Receive chunks, summarise, embed, upsert to Pinecone |
| `/search` | POST | Normal keyword search or AI semantic search |
| `/wipe` | POST | Delete all vectors in a namespace |
| `/done` | POST | Extension signals end of indexing run — backend prints summary |

---

## VS Code Commands

| Command | Description |
|---|---|
| `Smart Search` | Open the search panel |
| `Smart Search: Re-index Workspace` | Wipe all vectors and re-index from scratch |

---

## Known Limitations

- Evaluation was done on one codebase (89 functions) — results may vary on larger projects
- Requires internet connection for AI features (Voyage AI, OpenAI, Pinecone)
- Code chunker uses heuristics (brace counting, indentation) — not a full AST parser
- No cross-function context — functions are indexed and searched in isolation
- Commercial API dependency — tool breaks if any of the three services go down

---

## Release Notes

### 1.0.0

Initial release — AI semantic search, normal search with replace, real-time indexing, crash-safe batch indexing, line-level GPT result pinpointing, concurrent search and indexing via ThreadingHTTPServer.
