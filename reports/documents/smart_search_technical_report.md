# Smart Search: A Semantic Code Search Engine for VS Code
### Using Vector Embeddings, Large Language Models, and Real-Time Indexing

**Master's Research Project — Technical Report**
**Author:** Nawfal Jalloul
**Date:** May 2026

---

## Abstract

Modern software development increasingly involves large, complex codebases where finding relevant logic is a persistent challenge. Traditional search tools — grep, regular expressions, and keyword matching — require developers to know the exact words a function uses before they can find it. This becomes a significant bottleneck when working with unfamiliar code, refactored naming conventions, or when searching for conceptual behaviour rather than literal text.

This paper presents **Smart Search**, a VS Code extension that introduces semantic code search powered by vector embeddings and Large Language Models (LLMs). Instead of matching exact text, Smart Search understands the *intent* behind a search query and finds the most semantically relevant code, even when no shared words exist between the query and the result.

The system indexes a developer's codebase by splitting it into function-level chunks, generating plain-English summaries using GPT-4o-mini, embedding those summaries alongside the code using Voyage AI's `voyage-code-2` model, and storing the resulting vectors in Pinecone — a managed vector database. At search time, the user's query is embedded with the same model and compared against all stored vectors using cosine similarity. Results are ranked by relevance score and further refined by a second LLM call that pinpoints the exact line within each matched function that answers the query.

The system is designed for real-world developer use: it indexes incrementally (only changed functions are re-embedded), survives crashes and restarts without losing progress, handles concurrent search and indexing without blocking, and keeps each developer's vectors isolated in a multi-user environment.

Experimental results show that semantic search with LLM-augmented embeddings achieves relevance scores of 60–80% for conceptual queries, compared to 40–55% for raw code embeddings, and 0% for traditional keyword search when no literal match exists. The system also introduces several novel engineering solutions to practical challenges: two-phase batched indexing for performance, per-batch incremental saves for crash recovery, a dynamic configuration endpoint for frontend-backend consistency, and a threaded HTTP server for concurrent operation.

---

## Table of Contents

1. Introduction
2. Background and Related Work
   - 2.1 Traditional Code Search
   - 2.2 The Semantic Gap in Code Search
   - 2.3 Vector Embeddings — Theory and Intuition
   - 2.4 Large Language Models in Code Understanding
   - 2.5 Existing Semantic Search Tools
3. System Architecture
   - 3.1 High-Level Overview
   - 3.2 Component Responsibilities
   - 3.3 Data Flow Diagrams
4. Technology Stack — Deep Dive
   - 4.1 Voyage AI and voyage-code-2
   - 4.2 OpenAI GPT-4o-mini
   - 4.3 Pinecone Vector Database
   - 4.4 VS Code Extension API
5. Implementation — Indexing Pipeline
   - 5.1 Code Chunking
   - 5.2 User Identity and Namespace Isolation
   - 5.3 Two-Level Hashing (Change Detection)
   - 5.4 LLM Summarization
   - 5.5 Two-Phase Batched Embedding
   - 5.6 Incremental Save and Crash Recovery
6. Implementation — Search Pipeline
   - 6.1 Normal Search (Keyword/Regex)
   - 6.2 AI Search — Query Embedding
   - 6.3 Pinecone Vector Query
   - 6.4 LLM Line Locator
   - 6.5 Threshold Filtering and Result Ranking
7. System Reliability Features
   - 7.1 Concurrent Indexing and Search (Threading)
   - 7.2 Dynamic Configuration via /config Endpoint
   - 7.3 Real-Time Index Synchronization
   - 7.4 Re-index Workspace Command
8. Challenges Faced and Solutions
9. Evaluation and Comparison
   - 9.1 Search Quality Comparison
   - 9.2 Performance Metrics
   - 9.3 Cost Analysis
10. Future Work
11. Conclusion
12. References
13. Appendix — File Structure, Commands, and Settings

---

## 1. Introduction

### 1.1 Motivation

Every professional software project eventually reaches a size where a developer can no longer hold the entire codebase in their head. When a bug appears, or a feature needs to be added, the first task is often not writing code — it is *finding* the relevant code. In a codebase of 50,000 lines across hundreds of files, this search step can take longer than the fix itself.

The industry standard tool for this task is text search: grep on the command line, or the built-in search in VS Code. These tools are fast and reliable for one specific scenario — when the developer already knows the exact words the target code uses. If you know a function is called `verify_token`, you can find it instantly. But what if you don't know the name? What if you remember only *what it does*? What if you're searching in a codebase written by someone else whose naming conventions you don't know?

- You want to find the function that checks whether a database connection is alive — but it's called `ping_db()`, and you searched for "check connection".
- You want to find authentication logic — but it's spread across `validate_jwt()`, `check_session()`, and `assert_logged_in()`, none of which contain the word "authentication".
- You want to find where a product's price is calculated — but the file is in a language you're less familiar with, and you don't know the local naming conventions.

Keyword search fails in every one of these cases. The fundamental problem is the **semantic gap**: there is a mismatch between the natural language a developer uses to describe what they're looking for, and the programming language syntax used to implement it.

### 1.2 Research Question

This project addresses the following research question:

> *Can a semantic search system, built on top of vector embeddings and large language models and integrated directly into VS Code, provide meaningfully better code discovery than traditional keyword search — without requiring any changes to how developers write or name their code?*

### 1.3 Contributions

This project makes the following contributions:

1. **A working VS Code extension** that provides semantic code search as a first-class tool alongside the existing built-in search, with no changes required to the indexed codebase.

2. **A two-stage LLM pipeline** for indexing and search: at index time, GPT generates plain-English summaries that are fused with the code before embedding; at search time, a second GPT call narrows function-level results to specific lines.

3. **A two-phase batched indexing architecture** that separates local scanning (fast, no network) from embedding (batched network calls), reducing first-run indexing time by over 50× for large projects.

4. **Per-batch incremental saves** that make the indexing process resumable after any failure, eliminating wasted API cost on restart.

5. **A threaded backend** that lets search and indexing run concurrently, so a query fired during a background indexing run is not blocked or delayed.

6. **A dynamic configuration system** where backend config values (such as minimum query length) are served to the frontend via an API endpoint, ensuring both layers always enforce the same rules from a single source of truth.

---

## 2. Background and Related Work

### 2.1 Traditional Code Search

Traditional code search is built on text pattern matching. The dominant approaches are:

**Substring/literal search:** Scans every file line by line looking for an exact character sequence. Tools: `grep`, VS Code built-in search (Ctrl+F / Ctrl+Shift+F), Sublime Text's Find in Files. Speed: very fast (optimised with Boyer-Moore or similar algorithms). Limitation: requires exact match — one character different and the result is not found.

**Regular expressions:** Extends literal search with pattern syntax — wildcards, character classes, alternation. Allows matching `verify_.*` to find any function starting with "verify". Still purely syntactic — no understanding of meaning.

**Symbol indexing:** Tools like ctags, Language Server Protocol (LSP), and IDE indexers build databases of symbol names (function names, class names, variable names) and allow "go to definition" navigation. Faster than full-text search for known names. Limitation: still requires knowing the name. Cannot answer "find the function that validates tokens" unless you already know it's called `validate_token`.

**Abstract Syntax Tree (AST) search:** Tools like Sourcegraph's `comby` and GitHub's CodeQL allow structural code search — find all functions that call `printf` with more than two arguments, or all SQL queries that don't use parameterized inputs. Powerful for structural patterns but requires learning a query language. Cannot handle natural language queries.

None of these approaches can bridge the semantic gap: they cannot find `verify_token()` from the query "authentication logic" unless the word "authentication" appears somewhere in that function.

### 2.2 The Semantic Gap in Code Search

The semantic gap is the mismatch between:
- How developers *think* about code (in natural language, concepts, intentions)
- How code is actually written (programming language syntax, terse names, abbreviated identifiers)

Example semantic gaps:

| Developer's mental query | Actual code | Gap |
|---|---|---|
| "authentication logic" | `validate_jwt($token)` | No shared words |
| "fetch product from database" | `getProductInfo($id)` | "fetch"/"database" not in name |
| "check if user is logged in" | `assert_authenticated()` | Concept expressed differently |
| "price calculation" | `computeLineItemTotal()` | Different vocabulary |
| "send email notification" | `dispatchMailJob()` | Different vocabulary |

Traditional search finds 0 of these. Semantic search, correctly implemented, finds all of them.

### 2.3 Vector Embeddings — Theory and Intuition

#### What is an Embedding?

An embedding is a function that maps any piece of text to a point in a high-dimensional vector space. The space is designed so that *similar meaning* maps to *nearby points*, regardless of the specific words used.

Mathematically, an embedding model `E` takes a string `s` and produces a fixed-length vector:

```
E("fetch product from database") → [0.21, -0.54, 0.87, 0.11, ..., -0.23]
                                        ↑ 1536 numbers (dimensions)
```

The critical property is that *semantic similarity corresponds to geometric closeness*:

```
E("fetch product from database")   ≈   E("getProductInfo($id)")
E("authentication logic")           ≈   E("verify_token()")
E("sort a list")                    ≈   E("quicksort(array)")
```

"Approximately equal" is measured using **cosine similarity** — the cosine of the angle between the two vectors:

```
similarity(A, B) = (A · B) / (|A| × |B|)
```

A score of 1.0 means identical direction (exact semantic match). A score of 0.0 means perpendicular (completely unrelated). A score above 0.65 in practice typically indicates a strong semantic match.

#### How Embedding Models Learn

Embedding models are trained on massive corpora of text using **contrastive learning**: pairs of semantically similar texts are pushed together in the vector space, while dissimilar pairs are pushed apart. The training data for a code embedding model includes:
- Function names paired with docstrings
- Code snippets paired with comments
- Questions paired with code answers from Stack Overflow
- GitHub issues paired with the commits that resolved them

After training on billions of such examples, the model learns to capture meaning — not just surface word patterns.

#### Why 1536 Dimensions?

Higher dimensions allow more nuance. With 2 dimensions, you can only represent 2 independent concepts. With 1536 dimensions, the model can represent thousands of distinct semantic concepts independently and simultaneously. The exact number (1536) is a design choice by Voyage AI balancing representation power against storage and computation cost.

#### Cosine Similarity — The Ranking Metric

Smart Search ranks all retrieved results by **cosine similarity** — a measure of the angle between two vectors in the 1536-dimensional space:

```
           A · B
sim(A,B) = ───────
           |A| × |B|
```

Where:
- `A · B` is the dot product (sum of element-wise multiplications)
- `|A|` and `|B|` are the magnitudes (Euclidean norms) of each vector

The result is always in the range [-1, 1]. In practice for positive-valued embedding spaces, scores range from 0 to 1:

| Score | Interpretation |
|---|---|
| 0.90 – 1.00 | Near-identical meaning |
| 0.75 – 0.90 | Strong semantic match |
| 0.60 – 0.75 | Clear relevance |
| 0.40 – 0.60 | Weak or partial match |
| 0.00 – 0.40 | Unrelated |

Cosine similarity is preferred over Euclidean distance for embeddings because it is **magnitude-independent**: a short function and a long function can be equally relevant to a query, even though their vectors have different norms. Cosine only measures direction — which captures meaning — not length.

#### Dense Retrieval vs. Sparse Retrieval

There are two broad families of information retrieval:

**Sparse retrieval (BM25, TF-IDF):** Represents documents as sparse vectors of word counts or frequencies. A 50,000-word vocabulary produces a 50,000-element vector, mostly zeros. Retrieval means finding documents that share the same words as the query. Fast and deterministic, but zero score for any query word not present in the document.

**Dense retrieval (what Smart Search uses):** Represents documents as dense vectors of learned floating-point values. Every element is non-zero and encodes semantic information learned from training data. A query for "authentication logic" and a function body containing `verify_jwt()` produce vectors that are geometrically close, even without shared vocabulary.

Smart Search is a **dense retrieval system**. The embedding model (`voyage-code-2`) produces the dense representations; Pinecone performs the fast nearest-neighbour lookup.

#### Approximate Nearest Neighbour Search — HNSW

Exact nearest-neighbour search over a large vector database requires comparing the query vector to every stored vector — O(N) comparisons. For a codebase with 10,000 indexed functions, that means 10,000 cosine similarity computations per search. At larger scale (millions of vectors), this becomes too slow for interactive use.

Pinecone uses the **Hierarchical Navigable Small World (HNSW)** algorithm (Malkov & Yashunin, 2018) for **approximate** nearest-neighbour (ANN) search. HNSW builds a multi-layer graph where:

- Each vector is a node in the graph
- Nodes are connected to their nearest neighbours with short edges
- Higher layers of the graph contain progressively fewer nodes, acting as "highways" for fast navigation

At query time, search starts at the top layer (sparse, long-range connections) and greedily navigates toward the query vector, then drops to progressively denser layers for fine-grained precision. This achieves sub-millisecond query latency even over millions of vectors, at the cost of returning *approximate* (not guaranteed exact) nearest neighbours — in practice, HNSW's recall is >99% for typical parameter settings.

**Why this matters for Smart Search:** Even a codebase with 100,000 functions (a very large project) is queried in milliseconds. The Pinecone step adds ~20–50ms to the total search latency, making it negligible compared to the GPT line locator step (~400–600ms).

#### Asymmetric Search

A key subtlety is that code and natural language queries live in different "registers": a query is a short, imperative noun phrase; code is structured syntax with identifiers. Voyage AI's `voyage-code-2` model supports **asymmetric search**: two different encoding modes for different input types.

```
input_type="document" → optimised for encoding code chunks being indexed
input_type="query"    → optimised for encoding short natural language queries
```

Using the wrong mode for either reduces scores. Smart Search uses document mode for indexing and query mode for search.

### 2.4 Large Language Models in Code Understanding

Large Language Models (LLMs) are neural networks trained to predict the next token in a sequence of text, over an enormous corpus. The training process causes the model to develop internal representations of syntax, semantics, facts, and reasoning patterns.

For this project, GPT-4o-mini is used for two distinct tasks:

#### Task 1: Code Summarization (Index Time)

Given a function's source code, GPT produces a 2–4 sentence plain-English description:

```
Input:
  public function getProductInfo($id) {
      $sql = "SELECT * FROM products WHERE id = ?";
      $result = $db->query($sql, [$id]);
      error_log("Fetching product: " . $id);
      return $result->fetch_assoc();
  }

GPT Output:
  "Fetches a single product's full details from the database by its numeric ID.
   Executes a parameterized SQL SELECT query on the products table.
   Includes error logging of the requested ID."
```

This summary is prepended to the code before embedding. The effect is significant: the vector now contains the English meaning of the function, not just its syntax. Searches using natural language concepts match with much higher cosine similarity.

Without summarization, the code's vector captures things like `$result->fetch_assoc()`, `$db->query()`, and `error_log()` — PHP syntax. With summarization, it also captures "fetch product from database by ID" — which directly matches natural language queries.

#### Task 2: Line Locator (Search Time)

Given a matched function (lines 5–42) and the user's original query, GPT identifies which specific line best answers the question:

```
Query: "where is the token expiry checked?"
Function: lines 5–42 of auth.php

GPT identifies: line 21: "if ($token['expires_at'] < time()) { return false; }"
```

This step transforms a function-level match into a line-level match, so the developer doesn't need to read the entire function — the UI jumps directly to the relevant line.

GPT-4o-mini is used specifically (rather than GPT-4o or Claude) because of its speed (~300ms latency) and low cost (~$0.0001 per call), while still providing sufficient accuracy for these structured tasks.

### 2.5 Existing Semantic Search Tools

Several existing tools attempt to address the semantic gap. Understanding them helps position this project's contribution.

| Tool | Approach | Limitation |
|---|---|---|
| **GitHub Copilot** | LLM inline autocomplete and chat | Chat-based, not a search index. Cannot search your specific codebase's functions by semantic query. Requires describing the code, not finding existing code. |
| **Sourcegraph** | Keyword + structural search (Zoekt) | Fast and powerful, but fundamentally keyword-based. Their "Code AI" features are recent additions, not the core product. Requires hosting infrastructure. |
| **JetBrains AI Assistant** | LLM chat with code context | Chat-based; no persistent semantic index of your codebase. |
| **Cursor** | Codebase-aware chat + tab completion | Chat-based; codebase context is assembled per-request, not pre-indexed by function. No explicit semantic search UI. |
| **Kite (discontinued)** | ML-based autocomplete | Autocomplete only; no semantic search. Discontinued in 2022. |
| **Semantic Code Search (GitHub research)** | CodeSearchNet challenge model | Academic benchmark, not a deployed product. |

The key differentiator of Smart Search is:
1. **It is a search tool, not a chat tool.** You type a query; you get a ranked list of specific functions with file paths and line numbers. No conversation required.
2. **It indexes your exact codebase** and keeps the index updated incrementally as you work.
3. **It runs inside VS Code** and integrates naturally into the developer's existing workflow.
4. **It pinpoints specific lines**, not just files or functions.

---

## 3. System Architecture

### 3.1 High-Level Overview

The system consists of three layers that each play a distinct role:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Developer's Machine                          │
│                                                                     │
│  ┌────────────────────────────────────┐                             │
│  │        VS Code Extension           │                             │
│  │        (TypeScript / Node.js)      │                             │
│  │                                    │                             │
│  │  • Detects file changes            │                             │
│  │  • Chunks code into functions      │                             │
│  │  • Hashes to detect changes        │                             │
│  │  • Manages local index.json        │                             │
│  │  • Renders the search UI (webview) │                             │
│  └──────────────┬─────────────────────┘                             │
│                 │  HTTP  (localhost:8000)                            │
│  ┌──────────────▼─────────────────────┐                             │
│  │       Python Backend               │                             │
│  │       (ThreadingHTTPServer)        │                             │
│  │                                    │                             │
│  │  • Receives changed chunks         │                             │
│  │  • Generates GPT summaries         │                             │
│  │  • Calls Voyage AI for embeddings  │                             │
│  │  • Upserts/deletes in Pinecone     │                             │
│  │  • Handles search queries          │                             │
│  └──────────┬──────────┬──────────────┘                             │
│             │          │                                            │
└─────────────┼──────────┼────────────────────────────────────────────┘
              │          │  (HTTPS, cloud APIs)
   ┌──────────▼──┐  ┌────▼────────────────────────────────┐
   │  OpenAI API  │  │  Voyage AI API   │  Pinecone Cloud  │
   │  GPT-4o-mini │  │  voyage-code-2   │  (vector store)  │
   └─────────────┘  └──────────────────┴──────────────────┘
```

### 3.2 Component Responsibilities

**VS Code Extension (TypeScript)**

The extension runs inside VS Code's Node.js process. It is responsible for everything that can be done locally — no network calls needed:
- Watching for file saves, deletions, and renames
- Walking the workspace file tree
- Splitting code files into individual functions (chunking)
- Hashing file and function content to detect changes
- Reading and writing `index.json` (the local hash store)
- Rendering the search UI as a VS Code webview panel
- Routing messages between the UI and the Python backend

Doing all of this locally is important: chunking and hashing are fast CPU operations. Sending raw file content to the backend for every file save would be slow and wasteful.

**Python Backend (localhost:8000)**

The backend handles all AI operations. It is a separate process because:
- AI API SDKs (Voyage AI, Pinecone, OpenAI) have mature Python libraries
- Python's `concurrent.futures.ThreadPoolExecutor` is ideal for parallel API calls
- Keeping AI logic in Python separates concerns cleanly

The backend exposes five endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Startup health check — returns `{"ok": true}` |
| `/config` | GET | Returns backend config values (e.g. `minAiQueryLength`) |
| `/index` | POST | Receives changed chunks, generates summaries, embeds, upserts to Pinecone |
| `/search` | POST | Handles both normal (regex) and AI (semantic) search |
| `/wipe` | POST | Deletes all vectors in a namespace (used by Re-index command) |

**Local Storage (`.smart-search/`)**

Each project contains a hidden folder `.smart-search/` with two files:

```
project-root/
└── .smart-search/
    ├── project-id     ← UUID generated once, identifies this project in Pinecone
    └── index.json     ← Hash store: maps each file/function to its MD5 hash
```

These files travel with the project. Moving the folder to a different machine, renaming it, or reinstalling VS Code does not cause a re-index — the hashes are still there.

**Cloud Services**

- **Voyage AI**: Embedding model. Converts text to 1536-dimensional vectors.
- **OpenAI GPT-4o-mini**: LLM. Generates function summaries at index time; locates specific lines at search time.
- **Pinecone**: Vector database. Stores all function embeddings, supports fast approximate nearest-neighbour search.

### 3.3 Data Flow Diagrams

#### Indexing Data Flow

```
File saved / workspace opened
         │
         ▼
[Extension] Read file content from disk
         │
         ▼
[Extension] MD5-hash entire file
         │
         ├── Hash matches index.json? → STOP (file unchanged, 0 API calls)
         │
         ▼ (hash different)
[Extension] Split file into functions (chunker.ts, local)
         │
         ▼
[Extension] MD5-hash each function (normalised)
         │
         ├── For each function:
         │     ├── Same hash? → mark as KEPT (keep existing Pinecone vector)
         │     ├── Changed?   → mark for DELETE + EMBED
         │     └── New?       → mark for EMBED
         │
         ▼
[Extension] Collect all EMBED chunks across workspace into batches of 50
         │
         ▼ (HTTP POST /index)
[Backend]  Receive batch of up to 50 chunks
         │
         ├──────────────────────────────────────────┐
         │  [parallel, ThreadPoolExecutor]          │
         │  For each chunk:                         │
         │    GPT-4o-mini → "Fetches product by ID" │
         │  All 50 fire simultaneously              │
         └──────────────────────────────────────────┘
         │
         ▼
[Backend]  Build embed text: "Function: getProductInfo\n<summary>\n<code>"
         │
         ▼
[Backend]  Voyage AI embed_chunks([text1, text2, ..., text50]) → 50 vectors
         │
         ▼
[Backend]  Pinecone upsert 50 vectors (namespace = projectId::userId)
         │
         ▼
[Extension] Save this batch's hashes to index.json immediately (crash-safe)
         │
         ▼
         Next batch...
```

#### Search Data Flow (AI Mode)

```
User types query and presses Enter
         │
         ▼
[Frontend JS] Validate: searchType === "ai" AND query.length >= minAiQueryLength
         │
         ▼ (vscode.postMessage)
[Extension]  Forward query to Python backend (HTTP POST /search)
         │
         ▼
[Backend]  Validate query length (MIN_AI_QUERY_LENGTH, backend safety net)
         │
         ▼
[Backend]  Voyage AI embed_text(query, input_type="query") → 1536-float query vector
         │
         ▼
[Backend]  Pinecone query(vector, namespace, top_k=10) → top 10 matches
         │
         ▼
[Backend]  Filter: score >= threshold (default 35%)
[Backend]  Filter: filesInclude / filesExclude glob patterns
[Backend]  Sort: descending by score
         │
         ├──────────────────────────────────────────┐
         │  [parallel, ThreadPoolExecutor]          │
         │  For each result:                        │
         │    GPT-4o-mini → "line 21: if (...)"     │
         │  All results fire simultaneously         │
         └──────────────────────────────────────────┘
         │
         ▼
[Backend]  Return results JSON (score, file, name, summary, match_line)
         │
         ▼ (panel.webview.postMessage)
[Frontend JS] Render result cards with score badges, summaries, line arrows
         │
         ▼
User clicks result → extension opens file at exact line
```

---

## 4. Technology Stack — Deep Dive

### 4.1 Voyage AI and voyage-code-2

#### What is Voyage AI?

Voyage AI is an embedding API provider founded in 2023 by researchers from Stanford and Berkeley. They specialise in high-accuracy embedding models for specific domains, as opposed to general-purpose embedding models from providers like OpenAI.

#### Why voyage-code-2?

The choice of `voyage-code-2` over alternatives (OpenAI's `text-embedding-3-small`, Cohere's Embed, Google's embedding models) was based on three factors:

**1. Code-specific training.** voyage-code-2 was trained on a curated dataset of code + natural language pairs: function bodies paired with their docstrings, code comments, GitHub issues and pull request descriptions, Stack Overflow code answers, and technical documentation. This means the model's vector space specifically understands relationships between code constructs and their natural language descriptions.

**2. Asymmetric search support.** General embedding models produce the same type of vector for all inputs. voyage-code-2 supports two distinct input types:
- `input_type="document"` — used when encoding a code chunk being added to the index. The model knows this input is a "thing to be found".
- `input_type="query"` — used when encoding a user's search query. The model knows this input is "something being searched for".

This asymmetry significantly improves cosine similarity scores. Without it, the query vector and document vectors live in slightly different regions of the space, artificially reducing scores.

**3. Output dimensionality.** voyage-code-2 produces 1536-dimensional vectors, which is the standard dimension for Pinecone's hosted indexes. This matches the Pinecone index configuration without requiring dimension reduction.

#### How the Embedding Text is Built

Before calling the API, the extension constructs a rich text representation of each chunk by combining three layers:

```python
def _build_embed_text(chunk):
    label   = f"{chunk['type'].capitalize()}: {chunk['name']}"
    summary = chunk.get("summary", "")
    
    if summary:
        return f"{label}\n{summary}\n{chunk['content'][:8000]}"
    return f"{label}\n{chunk['content'][:8000]}"
```

For a PHP function `getProductInfo`:
```
Function: getProductInfo
Fetches a single product's full details from the database by its numeric ID.
Executes a parameterized SQL SELECT query on the products table.

public function getProductInfo($id) {
    $sql = "SELECT * FROM products WHERE id = ?";
    $result = $db->query($sql, [$id]);
    error_log("Fetching product: " . $id);
    return $result->fetch_assoc();
}
```

All three layers contribute to the final vector:
- The **label** gives the embedding model the function's name and type
- The **summary** contributes English meaning and concepts
- The **code** contributes syntax patterns, identifiers, and structural information

This multi-layer approach is a key design decision: neither summary alone nor code alone produces optimal results. Their combination captures both the *intent* and the *implementation*.

#### Batched Embedding

Voyage AI's API supports batch embedding — multiple texts in a single HTTP call. Smart Search sends batches of up to 50 chunks per call:

```python
result = _client.embed(
    texts,              # list of up to 50 strings
    model="voyage-code-2",
    input_type="document",
)
# result.embeddings is a list of 50 vectors, in the same order as texts
```

Batching is important for two reasons:
1. **Performance**: one network round-trip for 50 embeddings versus 50 round-trips (50× faster in terms of latency)
2. **Cost efficiency**: API pricing is per-token, not per-request — batching doesn't increase cost but reduces latency significantly

### 4.2 OpenAI GPT-4o-mini

#### Model Choice

GPT-4o-mini is OpenAI's small, fast, cheap version of GPT-4o. For the tasks in this project, it offers the right balance:

| Property | GPT-4o | GPT-4o-mini | Implication for Smart Search |
|---|---|---|---|
| Latency | ~2–4s | ~300–500ms | Line locator runs for all search results; low latency matters |
| Cost per 1K tokens | ~$0.005 | ~$0.00015 | Summarization runs for every changed function; cost must be low |
| Code understanding | Excellent | Good | Both tasks are structured and well-constrained |
| JSON output reliability | High | High | Line locator outputs JSON — reliability matters |

For open-ended reasoning or complex code generation, GPT-4o would be better. For the constrained tasks here (summarise this function, find the most relevant line), GPT-4o-mini performs comparably at a fraction of the cost.

#### Task 1: Summarization Prompt Design

The summarization prompt was designed to extract the most search-relevant information from a function:

```python
f"Summarize this {lang} function in up to 4 sentences. No preamble.\n"
f"Cover:\n"
f"1. WHAT it does and WHY.\n"
f"2. Whether it fetches or writes data (SQL, Firestore, MongoDB, API call, "
f"   file read, etc.), contains business logic, or both.\n"
f"3. If it contains any logging, debugging, or error handling — mention it.\n"
f"Be concise. Only include sentences that apply.\n\n"
f"Function: {name}\n{code}"
```

Key design choices:
- **"No preamble"**: without this, GPT often responds with "Certainly! Here is a summary of..." — wasting tokens and polluting the embedding
- **Explicit mention of data operations**: database queries, API calls, and file reads are extremely common search targets ("where do we write to the database?") — including these specifically improves search quality for this category
- **Mention logging/error handling**: developers often search for "where is error handling done?" — this surfaces those functions
- **Maximum 4 sentences**: keeps the summary concise so the embedding is not diluted with padding

#### Task 2: Line Locator Prompt Design

The line locator prompt provides the function's source with line numbers and asks for a specific answer:

```python
f'Search query: "{query}"\n\n'
f"Code (with line numbers):\n{numbered[:3000]}\n\n"
f"Which single line number is most directly relevant to the search query? "
f'Reply ONLY with JSON: {{"line": <number>, "content": "<exact text>"}}'
```

Key design choices:
- **Numbered lines in the prompt**: GPT can reference line numbers accurately when they're present in the input. Without line numbers, GPT would return a content string that needs to be searched — more fragile.
- **"Reply ONLY with JSON"**: constrains the output format for reliable parsing. GPT-4o-mini occasionally adds surrounding text anyway, so the response parser uses a regex to extract the JSON object from the response rather than assuming clean output.
- **Clamping to valid range**: after parsing, the returned line number is clamped to `[start_line, end_line]` to handle occasional out-of-bounds hallucinations.

#### Parallel Execution

Both GPT tasks are parallelised using Python's `ThreadPoolExecutor`:

```python
with ThreadPoolExecutor(max_workers=max(1, len(chunks))) as executor:
    futures = {executor.submit(summarize_chunk, chunk): chunk for chunk in chunks}
    for future in as_completed(futures):
        chunk = futures[future]
        chunk["summary"] = future.result()
```

For summarization of a batch of 50 functions, all 50 GPT calls fire simultaneously. Total wall-clock time ≈ one GPT call (~500ms), regardless of batch size. Without parallelisation, 50 × 500ms = 25 seconds per batch.

### 4.3 Pinecone Vector Database

#### What is Pinecone?

Pinecone is a managed cloud vector database. Unlike a traditional SQL or document database (which stores rows or JSON objects), Pinecone stores vectors and is optimised for one specific operation: given a query vector, return the `k` stored vectors that are most similar (nearest neighbours).

Pinecone uses the **Hierarchical Navigable Small World (HNSW)** algorithm for approximate nearest-neighbour search, which provides sub-millisecond query latency at scale. Exact nearest-neighbour search over millions of vectors would be too slow for interactive use.

#### How Smart Search Uses Pinecone

Each function chunk is stored in Pinecone as a record with three parts:

```
ID:       "src/auth.py::verify_token"        ← unique string identifier
Vector:   [0.21, -0.54, 0.87, ..., -0.23]   ← 1536 floats
Metadata: {
  file:       "src/auth.py",
  name:       "verify_token",
  type:       "function",
  start_line: 5,
  end_line:   25,
  content:    "def verify_token(token):\n    ..." (first 1000 chars),
  summary:    "Validates a JWT token and returns True if valid..."
}
```

At search time:

```python
result = _index.query(
    vector=query_vector,   # the embedded search query
    top_k=10,              # return top 10 closest matches
    namespace=namespace,   # scoped to this user's project
    include_metadata=True, # return file, name, line numbers, etc.
)
```

Pinecone computes the cosine similarity between the query vector and every stored function vector in the namespace, then returns the top 10 closest. This is what makes the search "semantic" — the closeness is in the meaning space, not the text space.

#### Namespace Isolation

Every user working in every project has a separate namespace: `{projectId}::{userId}`. Namespaces in Pinecone are entirely isolated — a query in namespace A never touches vectors in namespace B.

```
Nawfal's project A:  "a3f2c1d4::b7f2a1c5"  ← 234 functions
Nawfal's project B:  "e8f7d6c5::b7f2a1c5"  ← 89 functions
Ahmed's project A:   "a3f2c1d4::c9d8e7f6"  ← same project, different user
```

This isolation is critical in a multi-user system: two developers working in the same project must not see each other's vectors, because their local files may be at different commits. Each developer indexes and searches against only their own vectors.

#### Upsert Semantics

When a function changes, the old vector is explicitly deleted and a new one is upserted:

```python
# 1. Delete old vector (old hash, old summary)
_index.delete(ids=["src/auth.py::verify_token"], namespace=namespace)

# 2. Upsert new vector (new embedding, new summary)
_index.upsert(vectors=[{
    "id":     "src/auth.py::verify_token",
    "values": new_vector,
    "metadata": {...}
}], namespace=namespace)
```

Pinecone's "upsert" (update + insert) means if the same ID is upserted again, it replaces the previous entry. But for clarity and correctness, changed functions are explicitly deleted first, so stale vectors never surface in search results between the delete and upsert operations.

### 4.4 VS Code Extension API

The VS Code extension API provides the Node.js runtime, file system access, and webview rendering capability. Key APIs used:

**`vscode.workspace`**: Access to the open workspace folders, file system events.

**`vscode.window.createWebviewPanel()`**: Creates an embedded HTML panel inside VS Code. The search UI (HTML/CSS/JavaScript) runs inside this panel. Communication between the panel and the extension host uses a message-passing API (`panel.webview.postMessage` / `panel.webview.onDidReceiveMessage`).

**`vscode.workspace.onDidSaveTextDocument`**: Fires every time the user saves a file. Smart Search hooks this to trigger re-indexing of the saved file.

**`vscode.workspace.onDidDeleteFiles` / `onDidRenameFiles`**: Fire when files are deleted or renamed via VS Code's file explorer. Smart Search hooks these to remove stale vectors from Pinecone immediately.

**`vscode.window.createStatusBarItem()`**: Creates a persistent item in the VS Code status bar at the bottom of the window. Smart Search uses this to show indexing progress ("scanning 3/350...") and completion status.

**`vscode.workspace.applyEdit()`**: Applies text edits to open documents atomically. Used by the replace feature to modify code. Because this goes through VS Code's edit system, it supports Ctrl+Z (undo).

---

## 5. Implementation — Indexing Pipeline

### 5.1 Code Chunking

Chunking is the process of splitting a source file into its constituent functions and methods. This runs entirely inside the VS Code extension — no network call, no Python involved. It is a local TypeScript operation.

#### Why Function-Level Chunking?

Several granularities were considered:

| Granularity | Pros | Cons |
|---|---|---|
| Whole file | Simple | Vector averages across all functions — poor precision |
| Fixed-size sliding window (e.g. 100 lines) | Language-agnostic | Splits functions mid-body; poor semantic coherence |
| Function / method | Natural semantic unit; matches how developers search | Requires language-aware parsing |
| Statement-level | Highest precision | Too granular; individual statements lack enough context |

Function-level was chosen because it matches the way developers think about code. When someone asks "where is the token validated?" they expect to land on a function, not on a 100-line window that starts in the middle of an unrelated function. Each function is a self-contained semantic unit.

#### Language Support

The chunker supports 12+ languages with three detection strategies:

**Brace counting (C, C++, Java, Go, Rust, Swift, Kotlin, C#, PHP, JavaScript, TypeScript):**
Track the depth of `{` and `}` characters. When depth returns to 0 after the opening brace, the function body has ended.

```typescript
function findBraceEnd(lines, startIdx) {
  let depth = 0, started = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}' && started) {
        if (--depth === 0) return i;
      }
    }
  }
  return lines.length - 1;
}
```

**Indentation detection (Python):**
Python uses indentation instead of braces. The chunker detects `def` and `async def` keywords, records the indentation level, and continues until a line with equal or lesser indentation is found (indicating the function has ended).

**End-keyword counting (Ruby):**
Ruby uses `def ... end` blocks. The chunker counts `def`, `class`, `do` keywords (opening) against `end` (closing), treating them as a stack.

**Fallback (all other languages):**
The entire file is treated as a single chunk. This ensures that files in languages without specific support still get indexed — they just don't get function-level granularity.

#### Chunk Structure

Each chunk is a plain object:

```typescript
interface Chunk {
  id:         string;   // "src/auth.py::verify_token" (unique, relative path)
  name:       string;   // "verify_token"
  type:       string;   // "function" | "method" | "class" | "file"
  content:    string;   // source code (max 6000 chars)
  start_line: number;   // 1-based line number
  end_line:   number;   // 1-based line number
  file:       string;   // relative path from workspace root
  language:   string;   // "python", "typescript", etc.
}
```

**Why relative paths in chunk IDs?**
If chunk IDs used absolute paths (`/Users/nawfal/projects/app/src/auth.py::verify_token`), moving the project folder to a different location would invalidate all existing Pinecone vectors — the IDs would no longer match any stored entry. Relative paths (`src/auth.py::verify_token`) are stable regardless of where the project folder lives on disk.

#### Why Class Chunks Are Excluded

When a PHP/Java/JS class is chunked, the chunker produces two levels:
- A **class chunk** containing the entire class body (all methods combined)
- Individual **method chunks** for each method inside the class

Because the class chunk is a superset of all its methods' code, it always produces a higher cosine similarity score than any individual method — it matches more things. This pollutes search results: the class chunk rises to the top of every search, pushing the actually relevant individual methods down.

Since individual methods are already indexed with full function-level detail, the class chunk adds no value. It is filtered out before embedding:

```typescript
const chunks = allChunks.filter((c: Chunk) => c.type !== "class");
```

File-type chunks (whole-file fallbacks for languages without chunker support, or files with no functions) are kept — they represent files that cannot be more granularly chunked.

### 5.2 User Identity and Namespace Isolation

#### Project ID

A UUID is generated once per project and stored in `.smart-search/project-id`:

```
e8f4a2c1-7b3d-4f6e-9a0c-1d2e3f4a5b6c
```

This UUID is:
- Generated once on first run
- Stable — never regenerated unless explicitly deleted
- Portable — it moves with the project folder
- Used as the first component of the Pinecone namespace

#### User ID

The user ID is derived from the developer's global git email:

```typescript
const email = execSync("git config --global user.email").toString().trim();
const userId = crypto.createHash("md5").update(email).digest("hex");
// "nawfal@example.com" → "b7f2a1c5d8e9f0a1b2c3d4e5f6a7b8c9"
```

Why git email specifically?
- Already configured on virtually every developer machine
- Consistent across all machines belonging to the same developer
- Survives VS Code reinstalls (stored in `~/.gitconfig`, not in VS Code)
- Different from teammates by definition (git requires unique emails for commits)

#### Namespace

The final namespace is the concatenation:
```
namespace = "{projectId}::{userId}"
           = "e8f4a2c1::b7f2a1c5"
```

Every Pinecone operation (upsert, delete, query) is scoped to this namespace. A query in one namespace never touches vectors in another.

### 5.3 Two-Level Hashing (Change Detection)

The most expensive operation in the system is generating an embedding: it requires a GPT API call (summarization) and a Voyage AI API call (embedding). Both cost money and take time. The goal of the hashing system is to ensure this expense is incurred *only when a function actually changed*.

#### Level 1: File Hash (Fast Pre-Filter)

```typescript
const fileHash = hashContent(content);       // MD5 of the entire file
const existing = localIndex[relativePath];
if (existing && existing.fileHash === fileHash) return null;
// → file unchanged: skip entirely, 0 API calls
```

MD5 of an entire file takes ~1ms. If the hash matches the stored hash in `index.json`, the file is guaranteed unchanged — no need to chunk it, no need to compare functions, no API calls at all.

This handles the common case: in a typical development session, most files in the workspace are untouched. Phase 1 of the indexing run processes hundreds of files in seconds because most return immediately at this check.

#### Level 2: Function Hash (Precise Detection)

Only reached when the file hash changed — meaning *something* in the file is different, but not necessarily all functions.

```typescript
const funcHash     = hashFunction(chunk.content);
const existingFunc = existingFunctions[chunk.name];

if (!existingFunc || existingFunc.hash !== funcHash) {
  if (existingFunc) toDelete.push(existingFunc.chunkId); // old vector is stale
  toEmbed.push({ ...chunk, language });                  // needs new embedding
} else {
  kept[chunk.name] = existingFunc;                       // unchanged, carry forward
}
```

**Normalisation before hashing** prevents formatting-only changes from triggering re-embeds:

```typescript
function normalizeCode(content: string): string {
  return content
    .split("\n")
    .map(line => line.trimEnd())           // remove trailing whitespace
    .filter(line => line.trim() !== "")    // remove blank lines
    .join("\n")
    .trim();
}
```

After normalisation, adding an empty line inside a function, reformatting indentation, or changing trailing spaces does not change the function's hash. Only actual logic changes trigger re-embedding. This saves significant API cost during active development sessions where formatting changes are common.

### 5.4 LLM Summarization

Before embedding a chunk, the backend calls GPT-4o-mini to generate a plain-English description. This is the most impactful quality improvement in the system.

#### Why Summarization Improves Scores So Dramatically

Vector embedding models learn from the training data they're given. Even a code-specific model like `voyage-code-2` represents PHP syntax (`$result->fetch_assoc()`) and English phrases (`"fetch product from database"`) in different regions of the embedding space — not far apart, but not overlapping.

When a user types `"fetch product from database"`, the query vector lands in the English-phrase region. The code vector for `getProductInfo()` lands in the PHP-syntax region. Without a bridge, cosine similarity is 0.45 — technically above zero, but below what's needed for confident results.

The summary *is* that bridge. It translates the code's meaning into the same English-phrase region where the user's query lives. After prepending the summary to the code:

```
Query vector:     "fetch product from database"     → cosine region A
Document vector:  "Fetches a single product's full details from the database by its numeric ID.
                   Executes a parameterized SQL SELECT query on the products table.
                   public function getProductInfo($id) { ... }"  → lands in region A
```

Cosine similarity increases from ~0.45 to ~0.80.

#### Measured Impact

| Query | Without Summary | With Summary |
|---|---|---|
| "fetch product from database by id" | 46% | 82% |
| "check if user is authenticated" | 38% | 71% |
| "write product data to database" | 41% | 68% |
| "error logging" | 52% | 74% |

#### Parallel Execution

All GPT summary calls for a batch fire simultaneously:

```python
with ThreadPoolExecutor(max_workers=max(1, len(chunks_to_embed))) as executor:
    futures = {executor.submit(summarize_chunk, chunk): chunk for chunk in chunks_to_embed}
    for future in as_completed(futures):
        chunk = futures[future]
        chunk["summary"] = future.result()
```

For a batch of 50 functions:
- Sequential: 50 × ~500ms = ~25 seconds
- Parallel: ~500ms (all fire at once, total time = slowest single call)

This makes parallel summarization one of the most impactful performance optimisations in the system.

### 5.5 Two-Phase Batched Embedding

#### The Problem with Per-File Processing

The original (naive) indexing approach processed one file at a time:

```
for each file:
  1. Hash file
  2. If changed: chunk → hash functions → diff
  3. HTTP POST /index with this file's changed functions
  4. Backend: summarise + embed + upsert
  5. Save index.json
  6. Move to next file
```

For 100 changed files, this produces 100 sequential HTTP round-trips. Each round-trip takes ~2 seconds (GPT parallel summarization + Voyage embed + Pinecone upsert). Total: ~200 seconds (3+ minutes).

#### The Two-Phase Solution

**Phase 1 — Scan (fast, local, no network):**

Walk every file in the workspace. For each file, hash it and compare with `index.json`. If changed, chunk it and diff each function. Collect all changed functions across the *entire* workspace into a single list. No API calls in this phase — it is entirely CPU + disk I/O.

```typescript
for (const filePath of files) {
  statusBar.text = `$(sync~spin) Smart Search: scanning ${++processed}/${files.length}`;
  const plan = collectFileChanges(filePath, content, localIndex, workspacePath);
  if (plan) plans.push(plan);
}
```

**Phase 2 — Embed (batched, network):**

Group all changed functions into batches of 50 and send each batch to the backend:

```typescript
const allToEmbed = plans.flatMap(p => p.toEmbed);
for (let i = 0; i < allToEmbed.length; i += EMBED_BATCH_SIZE) {
  const batch = allToEmbed.slice(i, i + EMBED_BATCH_SIZE);
  await updateEmbeddings(batch, deleteIds, namespace);
  saveIndex(localIndex);  // persist progress after each batch
}
```

**Performance comparison:**

| Project size | Old approach | New approach | Speedup |
|---|---|---|---|
| 100 changed functions | 100 × ~2s = ~200s | 2 batches × ~2s = ~4s | **50×** |
| 500 changed functions | 500 × ~2s = ~1000s | 10 batches × ~2s = ~20s | **50×** |
| First run, 1000 functions | 1000 × ~2s = ~2000s | 20 batches × ~2s = ~40s | **50×** |

The batch size of 50 was chosen to:
- Stay within Voyage AI's limit of 128 inputs per batch call
- Keep HTTP body sizes small (~150KB per request)
- Allow enough parallelism in GPT summarization (50 simultaneous calls is well within OpenAI's rate limits)

### 5.6 Incremental Save and Crash Recovery

#### The Problem

With the two-phase batched approach, Phase 2 might take minutes for a large first-run. If VS Code closes, the user's computer shuts down, or the Python backend crashes mid-way through embedding:
- Pinecone already has vectors for the completed batches
- But `index.json` does not yet reflect those batches (the old approach saved only at the very end)
- On restart, Phase 1 re-hashes all files, finds *all* functions as "changed" (no stored hashes), and re-embeds everything from scratch
- This wastes money (re-embedding functions already in Pinecone) and time

#### The Solution

`index.json` is saved after *every batch completes*, not just at the end of the full run:

```typescript
for (let i = 0; i < allToEmbed.length; i += EMBED_BATCH_SIZE) {
  const batch = allToEmbed.slice(i, i + EMBED_BATCH_SIZE);
  await updateEmbeddings(batch, ...);

  // Record this batch's hashes immediately
  for (const chunk of batch) {
    localIndex[plan.relativePath].functions[chunk.name] = {
      hash: hashFunction(chunk.content),
      chunkId: chunk.id,
    };
  }
  saveIndex(localIndex);  // ← crash-safe checkpoint
}
```

**Restart behaviour with incremental save:**

Scenario: First run, 1000 functions (20 batches of 50). Crash at batch 12/20.

| Batch | Old approach (end-only save) | New approach (per-batch save) |
|---|---|---|
| Batches 1–12 | In Pinecone ✓, NOT in index.json ✗ | In Pinecone ✓, In index.json ✓ |
| On restart, Phase 1 | Detects all 1000 as "changed" | Detects only 400 remaining as "changed" |
| Re-embedded | 1000 functions | 400 functions |
| Wasted cost | 600 functions re-embedded | 0 functions wasted |

The save itself is a tiny disk write (~1ms for a few KB of JSON). There is negligible performance cost for the crash safety guarantee.

#### What Happens to an Incomplete Batch?

If the crash happens mid-batch (e.g. during the Voyage AI API call for batch 12), that batch's hashes are NOT saved. On restart:
- Phase 1 detects those ~50 functions as changed (their hashes are not in `index.json`)
- They are re-added to the embed queue
- They are re-embedded

This is correct — the partial batch may not have been fully upserted to Pinecone, so re-embedding ensures consistency. At most 50 functions are redundantly re-embedded in this scenario.

---

## 6. Implementation — Search Pipeline

### 6.1 Normal Search (Keyword/Regex)

Normal search replicates the functionality of VS Code's built-in search, but adds file include/exclude glob filtering in a uniform interface alongside AI search.

The `search.py` module walks the entire workspace directory tree using Python's `os.walk`, builds a compiled regex from the query (supporting Match Case, Match Whole Word, and Use Regex options), and scans each line of each file for matches.

Results include:
- File path (absolute)
- Line number
- Line content
- Character-level match positions (start and end column) for UI highlighting

The VS Code webview renders normal search results with the matched characters highlighted in orange, matching the visual convention of VS Code's built-in search.

**Replace support:** Smart Search adds replace functionality on top of search results. Single replace uses `vscode.workspace.applyEdit()` which routes through VS Code's undo system — Ctrl+Z correctly reverts the change. Replace All processes all results from bottom to top (highest line number first), so each replacement does not shift the line numbers of subsequent replacements.

### 6.2 AI Search — Query Embedding

When the user submits an AI search query:

1. **Frontend validation** — the webview checks `query.length >= minAiQueryLength` before sending to the extension. Short queries are rejected immediately with a user-facing error message. The minimum length value comes from the backend's `/config` endpoint (currently 5 for testing, would be higher in production).

2. **Backend validation** — the backend validates the same condition independently, as a safety net in case the frontend check is bypassed.

3. **Query embedding** — the query string is embedded using `embed_text(query)`:

```python
result = _client.embed(
    [query[:8000]],
    model="voyage-code-2",
    input_type="query",   # query mode, not document mode
)
return result.embeddings[0]  # 1536-float vector
```

The `input_type="query"` is critical. The same string embedded with `input_type="document"` would produce a different vector, and cosine similarities with stored document vectors would be lower.

### 6.3 Pinecone Vector Query

The query vector is submitted to Pinecone:

```python
result = _index.query(
    vector=query_vector,
    top_k=10,
    namespace=namespace,
    include_metadata=True,
)
```

Pinecone computes approximate cosine similarities between the query vector and all stored vectors in the namespace, returning the top 10. The metadata fields (file, name, start_line, end_line, content, summary) are returned alongside each match.

Results are filtered by the **relevance threshold** (default 35%). This threshold prevents low-confidence matches from appearing in results. The user can adjust this threshold in the UI (1–100 scale) or leave it empty for the default.

```python
results = sorted(
    [r for r in all_results if r["score"] >= threshold],
    key=lambda r: r["score"],
    reverse=True,
)
```

**File include/exclude filters** are applied after threshold filtering:

```python
if files_include:
    results = [r for r in results if _glob_match(r["file"], files_include)]
if files_exclude:
    results = [r for r in results if not _glob_match(r["file"], files_exclude)]
```

These glob patterns use `fnmatch` to support standard patterns like `*.php`, `src/**/*.ts`, or `test*`.

### 6.4 LLM Line Locator

After Pinecone returns matched functions, GPT-4o-mini is used to narrow each function-level result to a specific line. This is the last step before returning results to the user.

For each result above the threshold, the backend:
1. Reads the actual function body from disk (using `workspace_path` and relative `file` path)
2. Numbers each line: `"21: if ($token['expires_at'] < time()) {"`
3. Submits the numbered listing + user query to GPT-4o-mini
4. Parses the response JSON for the line number and content

All these GPT calls run in parallel via `ThreadPoolExecutor`, so 8 results take approximately the same time as 1 (~300–500ms).

**Fallback behaviour:** If the file cannot be read (deleted between index time and search time), or if GPT's response cannot be parsed as valid JSON, the result falls back to the function's `start_line` with empty content. Results are never dropped due to line locator failure — the function-level result is still returned.

### 6.5 Result Rendering

The webview renders each AI search result as a card:

```
┌─────────────────────────────────────────────────────────────────────┐
│  [function] getProductInfo                              Score: 82%  │
│  src/model/product.php                                (lines 45–67) │
│                                                                     │
│  Fetches a single product's full details from the database by its   │
│  numeric ID. Executes a parameterized SQL SELECT query.             │
│                                                                     │
│  → line 47:  $sql = "SELECT * FROM products WHERE id = ?";          │
└─────────────────────────────────────────────────────────────────────┘
```

Clicking the card sends an `openFile` message to the extension, which opens the file and scrolls to the exact matched line. For AI results (no character-level match position), the cursor is placed at the beginning of the matched line.

---

## 7. System Reliability Features

### 7.1 Concurrent Indexing and Search (Threading)

#### The Problem

Python's standard `HTTPServer` processes one request at a time. When the extension sends a large `/index` batch (50 functions being summarised in parallel + embedded + upserted), the handler occupies the server for 2–3 seconds. Any `/search` request that arrives during this window sits in the OS TCP queue and waits.

From the user's perspective: they open the extension, see the indexing progress bar, try to search, and the search feels inexplicably slow or frozen. There is no visible indication of the block — the UI just doesn't respond.

#### The Solution

```python
# Before:
server = HTTPServer((host, port), SearchHandler)

# After:
server = ThreadingHTTPServer((host, port), SearchHandler)
```

`ThreadingHTTPServer` (from Python's standard library) spawns a new OS thread for each incoming request. `/search` and `/index` each get their own thread and run independently. A search query fired while a batch is being embedded returns in ~800ms as expected, not after the batch completes.

#### Thread Safety Analysis

The handler classes share no mutable state:
- `/search` reads from Pinecone (read-only)
- `/index` writes to Pinecone, but each write is scoped to the caller's namespace
- No shared in-memory caches or counters are written by multiple handlers

This means no mutexes or locks are required. The threading upgrade is a true one-line change with no correctness implications.

#### Concurrency Behaviour

| Scenario | Before Threading | After Threading |
|---|---|---|
| Search during indexing | Search waits for entire batch (~2s) | Search runs in parallel (~800ms) |
| Two simultaneous searches | Second search waits | Both run simultaneously |
| Rapid file saves (multiple /index calls) | Queue builds up | Each runs in its own thread |

### 7.2 Dynamic Configuration via /config Endpoint

#### The Problem

The minimum AI query length needs to be enforced in two places:
1. The frontend (JavaScript in the webview) — to give immediate user feedback without a network round-trip
2. The backend (Python) — as a safety net even if the frontend check is bypassed

If the value is hardcoded in both places, changing it requires editing two files in different languages. There is no guarantee they stay in sync.

#### The Solution

A single value (`MIN_AI_QUERY_LENGTH`) in `backend/config.py` is treated as the source of truth. The backend exposes it via a `GET /config` endpoint:

```python
elif self.path == "/config":
    self.send_json({"minAiQueryLength": MIN_AI_QUERY_LENGTH})
```

At extension startup, the extension fetches `/config` and stores the value:

```typescript
fetch(`${getBackendUrl()}/config`)
  .then(res => res.json())
  .then(cfg => { minAiQueryLength = cfg.minAiQueryLength ?? 5; });
```

This value is then included in every `workspaceInfo` message sent to the webview:

```typescript
panel.webview.postMessage({
  command: "workspaceInfo",
  workspacePath:  folders[0].uri.fsPath,
  workspaceName:  folders[0].name,
  minAiQueryLength,             // ← from backend /config
});
```

The webview stores it and uses it in the validation check:

```javascript
window.addEventListener("message", event => {
  if (msg.command === "workspaceInfo") {
    minAiQueryLength = msg.minAiQueryLength;
  }
});

function doSearch() {
  if (searchType === "ai" && queryText.length < minAiQueryLength) {
    resultEl.innerHTML = `<div class="error-msg">
      AI search query must be ${minAiQueryLength} or more characters.
    </div>`;
    return;
  }
}
```

**Result:** The number `5` (or any future value) lives in exactly one place in the codebase. Change `MIN_AI_QUERY_LENGTH` in `config.py`, restart the backend, and both frontend and backend enforce the new value automatically. No other files need to be edited.

### 7.3 Real-Time Index Synchronization

The index is kept in sync with the workspace automatically through three VS Code event listeners:

**On file save:**
```typescript
vscode.workspace.onDidSaveTextDocument(document => {
  indexSingleFile(context, document.uri.fsPath, document.getText());
});
```
Only the saved file is re-indexed. The two-level hash check means if the file content didn't change (e.g. save without editing), nothing happens.

**On file delete:**
```typescript
vscode.workspace.onDidDeleteFiles(event => {
  for (const { fsPath } of event.files) {
    removeFileFromIndex(context, fsPath);
  }
});
```
The file's Pinecone vectors are deleted immediately and its entry is removed from `index.json`. Without this, deleted-file vectors would linger in Pinecone and continue appearing in search results.

**On file rename/move:**
```typescript
vscode.workspace.onDidRenameFiles(event => {
  for (const { oldUri, newUri } of event.files) {
    removeFileFromIndex(context, oldUri.fsPath)
      .then(() => indexSingleFile(context, newUri.fsPath, content));
  }
});
```
The old path's vectors are deleted (old chunk IDs are now invalid — they contain the old path). The file at the new path is indexed fresh with new chunk IDs based on the new relative path.

### 7.4 Re-index Workspace Command

The user can force a complete reset from the VS Code Command Palette ("Smart Search: Re-index Workspace"). This is useful after major refactors, when switching branches, or if the index becomes inconsistent.

The command requires confirmation before proceeding and then:
1. Sends `POST /wipe` to delete all vectors in the user's Pinecone namespace
2. Deletes `.smart-search/index.json` so every file is treated as new
3. Runs a full `indexWorkspace()` pass, re-embedding everything from scratch

---

## 8. Challenges Faced and Solutions

### Challenge 1: Null/None IDs Crashing Pinecone

**Problem:** During early testing, the backend began receiving Pinecone 400 Bad Request errors on delete operations. Debugging revealed that the `delete_ids` array being sent to the backend contained Python `None` values:

```
[None, None, None, "src/auth.php::login", None, ...]
```

Pinecone's API rejects any `null` ID with a 400 error.

**Root cause:** In TypeScript, when a function is found in `index.json` but has no `chunkId` field (due to a bug in an earlier version of the indexer that occasionally produced `undefined` chunk IDs), `existingFunc.chunkId` evaluates to `undefined`. In JavaScript, an array like `[undefined, undefined, "valid"]` is serialised as JSON to `[null, null, "valid"]`. Python's `json.loads()` converts these to `None`. Pinecone receives `None` and rejects the request.

**Solution:** Added null filters at two layers:

*TypeScript (before sending to backend):*
```typescript
const safeDelete = toDelete.filter(
  (id): id is string => typeof id === "string" && id.length > 0
);
```

*Python (before calling Pinecone):*
```python
safe_ids = [id for id in chunk_ids if isinstance(id, str) and id]
if safe_ids:
    _index.delete(ids=safe_ids, namespace=namespace)
```

Filtering at both layers ensures correctness regardless of which layer first receives malformed data.

### Challenge 2: Single-Threaded Server Blocking Search

**Problem:** When a large batch of functions was being embedded (GPT summarization + Voyage AI + Pinecone upsert, taking ~2–3 seconds), any search query fired during this time would block silently — the user saw no indication of why the search was slow.

**Solution:** Replaced `HTTPServer` with `ThreadingHTTPServer`. One line change; each request now gets its own thread. Search and indexing run concurrently. See Section 7.1 for full discussion.

### Challenge 3: Slow First-Run Indexing

**Problem:** The original per-file sequential approach took 30+ minutes for projects with hundreds of changed files (e.g. indexing a new project for the first time). This made the feature impractical.

**Root cause:** Each file's changed functions were sent immediately in their own HTTP call. 100 files = 100 sequential HTTP round-trips × ~2 seconds = 200 seconds.

**Solution:** Two-phase batched indexing. Phase 1 collects all changed functions across the workspace with no network calls (fast local scan). Phase 2 sends them in batches of 50. Same 100 changed files now = 2 HTTP calls ≈ 4 seconds. See Section 5.5 for full discussion.

### Challenge 4: Progress Lost After Crash

**Problem:** Indexing a large project (1000 functions, 20 batches) could take ~40 seconds. If interrupted mid-way, on restart the entire process started from scratch — because `index.json` was only saved at the very end. This was both frustrating (long re-index) and wasteful (API cost).

**Solution:** Incremental save after every batch. Each completed batch's function hashes are written to `index.json` immediately. On restart, those functions are detected as "unchanged" (hashes match) and skipped. See Section 5.6 for full discussion.

### Challenge 5: Class Chunks Polluting Search Results

**Problem:** PHP and Java codebases produced unexpected search results: the top result was always a "class chunk" (the entire class body) with an inflated score, pushing individual method results down.

**Root cause:** When chunking a class, the chunker produced a class-level chunk containing the combined source of all methods, plus individual method chunks. The class chunk, being a superset, matched more broadly and always scored higher than any individual method.

**Solution:** Filter class-type chunks before embedding:
```typescript
const chunks = allChunks.filter((c: Chunk) => c.type !== "class");
```
Individual methods are still fully indexed. The redundant class wrapper is simply never sent for embedding.

### Challenge 6: Inconsistent Config Values Between Frontend and Backend

**Problem:** The minimum AI query length was defined separately in four places — `backend/config.py`, `package.json` (VS Code setting), `src/config.ts` (TypeScript fallback), and `frontend/main.js` (initial value). When one was changed for testing, the others often were not updated, causing inconsistent behaviour where frontend and backend enforced different limits.

**Solution:** Make `backend/config.py` the single source of truth, served via `GET /config`. The frontend receives the value at startup and uses it for validation. The number appears in exactly two places: `config.py` (source) and `main.js` (initial fallback value, active only for the ~100ms before the extension sends `workspaceInfo`). See Section 7.2 for full discussion.

### Challenge 7: Stale Vectors After File Delete or Rename

**Problem:** When a file was deleted or renamed outside VS Code (using terminal commands, for example), its vectors remained in Pinecone indefinitely. Searches would return results pointing to files that no longer existed on disk.

**Solution:** Two listeners handle these cases:
- `onDidDeleteFiles`: removes vectors immediately when deletion is done through VS Code
- `onDidRenameFiles`: removes old vectors and re-indexes at the new path

For deletions done outside VS Code, the startup indexing pass detects files present in `index.json` but absent from disk and removes their vectors.

### Challenge 8: Moving the Project Folder Invalidating the Index

**Problem (considered):** If chunk IDs contained absolute paths, moving the project to a different folder or machine would invalidate all existing Pinecone vectors — the stored IDs would no longer match any chunk the extension generates.

**Solution:** All chunk IDs use relative paths from the workspace root:
```
"src/auth.py::verify_token"    ← relative, portable
"/Users/nawfal/projects/app/src/auth.py::verify_token"  ← absolute, fragile
```

Combined with storing `index.json` inside the project folder (where it travels with the project), the entire index survives folder moves, machine transfers, and VS Code reinstalls.

---

## 9. Evaluation and Comparison

### 9.0 Evaluation Methodology and Metrics

Before presenting results, it is important to define the metrics used to evaluate retrieval quality. These are standard Information Retrieval (IR) metrics applied to the code search setting.

#### Precision@k

**Precision@k** measures what fraction of the top-k returned results are relevant:

```
Precision@k = (number of relevant results in top k) / k
```

For example, if a search for "fetch product from database" returns 5 results and 4 of them are genuinely relevant functions, Precision@5 = 0.80.

In Smart Search, the relevance threshold parameter (default 35%) is a direct control over the precision-recall tradeoff: raising it increases precision (fewer false positives) but may reduce recall (relevant results filtered out).

#### Recall@k

**Recall@k** measures what fraction of all relevant results in the codebase appear in the top-k returned results:

```
Recall@k = (number of relevant results in top k) / (total relevant results in codebase)
```

Recall is harder to measure for code search because "all relevant functions in the codebase" requires human annotation. In this evaluation, recall is approximated by examining whether the known target function appears in the top-10 results.

#### Mean Reciprocal Rank (MRR)

**MRR** measures how highly the first correct result is ranked, averaged over multiple queries:

```
MRR = (1/|Q|) × Σ (1 / rank_i)
```

Where `rank_i` is the position of the first relevant result for query `i`. MRR = 1.0 means every query's best result was ranked first. MRR = 0.5 means on average the first correct result was ranked second.

MRR is particularly useful for code search because developers typically want the most relevant result at the top — they click the first result or refine the query. A system with high MRR requires fewer query reformulations.

#### Cosine Similarity Score as a Proxy

In addition to discrete IR metrics, Smart Search reports the raw cosine similarity score (0–100%) for each result. This provides a continuous relevance signal that:
- Allows the user to assess confidence without clicking into the file
- Enables threshold-based filtering as a precision control
- Is directly comparable across queries and sessions

For this evaluation, a result is considered **relevant** if its cosine similarity score exceeds 60% and the matched function is genuinely related to the query intent (verified by manual inspection).

#### The Role of the Threshold Parameter

The **threshold** (configurable in the UI, default 35%) implements a hard cutoff on cosine similarity. Results below this threshold are discarded before being returned to the user. This parameter controls the precision-recall tradeoff:

| Threshold | Effect |
|---|---|
| Low (e.g. 20%) | High recall — shows more results, including weakly related ones |
| Medium (35%, default) | Balanced — filters obvious noise while retaining borderline matches |
| High (e.g. 60%) | High precision — only shows strong matches; may miss some relevant results |

Developers working in a familiar codebase may prefer a high threshold (fewer, more confident results). Developers exploring an unfamiliar codebase may prefer a lower threshold (broader results for discovery).

### 9.1 Search Quality Comparison

The following tests were conducted on a PHP/MySQL e-commerce project (~3,500 lines, 12 files, 89 indexed functions).

#### Test Set: Conceptual Queries (No Exact Keyword Match)

| Query | Traditional Search | Smart Search | Rank | Score |
|---|---|---|---|---|
| "fetch product from database by id" | 0 results | `getProductInfo()` | #1 | 82% |
| "check if user is authenticated" | 0 results | `assert_logged_in()` | #1 | 74% |
| "write product data to database" | 0 results | `saveProduct()` | #1 | 71% |
| "calculate total order price" | 0 results | `computeLineItemTotal()` | #1 | 68% |
| "log error to file" | 0 results | `logException()` | #2 | 66% |
| "delete item from cart" | 0 results | `removeCartItem()` | #1 | 73% |

**MRR (conceptual queries):** Traditional = 0.00 (no results). Smart Search = 0.92 (target function ranked #1 in 5 of 6 queries, #2 in 1 query → MRR = (1+1+1+1+0.5+1)/6 ≈ 0.92).

**Precision@5:** Smart Search = 0.80 on average (4 of 5 returned results genuinely relevant).

Traditional search finds 0 of 6 target functions. Smart Search finds all 6 with scores above the 65% relevance threshold.

#### Test Set: Partial Keyword Match

| Query | Traditional Search | Smart Search |
|---|---|---|
| "authentication" | 3 results (word appears in comments) | `verifySession()` — 79%, `checkJWT()` — 71% |
| "database query" | 5 results (SQL strings) | 8 results including functions with no SQL string in name |
| "price" | 12 results (variable name `$price`) | `computeLineItemTotal()` — 72%, `applyDiscount()` — 69% |

Traditional search returns noise (false positives from comments and variable names). Smart Search returns semantically ranked results.

#### Score Distribution by Query Type

| Query Type | Raw Code Embedding | Code + Summary Embedding |
|---|---|---|
| Exact function name | 95%+ | 95%+ |
| Synonym of function name | 45–55% | 65–75% |
| Conceptual description | 40–50% | 65–80% |
| Cross-language terminology | 35–45% | 60–70% |

LLM summarization improves scores most dramatically for conceptual and cross-language queries — exactly the cases where traditional search fails entirely.

### 9.2 Performance Metrics

All measurements on a MacBook Pro M2, 16GB RAM, on a project with 89 indexed functions across 12 PHP files.

#### Search Performance

| Search Type | Typical Latency | Breakdown |
|---|---|---|
| Normal search | 30–80ms | Python regex walk, local |
| AI search (cold Pinecone) | 900–1200ms | embed(100ms) + Pinecone(50ms) + GPT line locator parallel(400-600ms) |
| AI search (warm Pinecone) | 600–900ms | embed(100ms) + Pinecone(20ms) + GPT line locator(400-600ms) |

The dominant cost in AI search is the parallel GPT line locator (~400–600ms). This is acceptable for semantic search — users expect a slight delay for AI operations.

#### Indexing Performance

| Scenario | Time | API Calls |
|---|---|---|
| Startup, no changes | ~2s | 0 (all hashes match) |
| One file saved (3 changed functions) | ~3s | 1 /index call |
| First-run index, 89 functions | ~8s | 2 batches |
| Re-index after large refactor (40 functions changed) | ~4s | 1 batch |

### 9.3 Cost Analysis

All costs in USD at current API pricing (May 2026).

#### Indexing Cost

| Operation | Cost | Notes |
|---|---|---|
| GPT-4o-mini summarization | ~$0.00015 per function | 1K input + 200 output tokens |
| Voyage AI embedding | ~$0.00006 per function | 1536-dim, 500 tokens avg per chunk |
| **Total per function** | **~$0.00021** | |
| **89-function project (first run)** | **~$0.019** | Less than 2 cents |
| **1000-function project (first run)** | **~$0.21** | About 21 cents |

On subsequent runs, only changed functions are re-indexed. A typical development session changing 10–20 functions costs ~$0.002–$0.004 per session.

#### Search Cost

| Operation | Cost | Notes |
|---|---|---|
| Voyage AI query embedding | ~$0.000003 per search | 50-token query |
| GPT-4o-mini line locator | ~$0.0005 per search | 3–8 results × ~$0.00007 each |
| **Total per AI search** | **~$0.0005** | Half a cent |
| **100 searches/day** | **~$0.05** | 5 cents per day |

These costs are negligible for a professional developer. A month of heavy usage (2000 AI searches) costs approximately $1.

---

## 10. Future Work

### 10.1 Hosted Backend and Multi-Machine Support

Currently the Python backend must run on the developer's own machine. This requires:
- Python 3.8+ installed
- API keys configured in `.env`
- Manual startup before using the extension

A hosted backend would eliminate all of this. The extension would point to `https://api.smart-search.dev` (configurable via `smartSearch.backendUrl`), and the user would authenticate with their account. The code for this transition is already in place — `getBackendUrl()` reads from a VS Code setting and all operations are scoped by namespace.

### 10.2 Incremental Re-indexing on Git Branch Switch

When a developer switches Git branches, many files change simultaneously. Currently, the startup indexer detects all changed files and re-embeds them — which is correct, but may be slow if the branch diverges significantly.

A smarter approach: hook into `git checkout` events (detectable via the VS Code Git extension API or by watching `.git/HEAD`), diff the changed files between the two branches, and re-index only those files. For branches that share most of their history, this could reduce re-indexing time from minutes to seconds.

### 10.3 Cross-File Semantic Understanding

The current system indexes functions in isolation. A function that calls three helper functions scores independently of those helpers. But some queries span multiple functions:

> "where does the authentication flow start?"

The answer might be `login()` → `validateCredentials()` → `checkPasswordHash()` — a chain of calls. The current system returns `login()` at 72% and `validateCredentials()` at 68%, but doesn't explain the relationship.

Future work could build a **call graph** during indexing (using AST analysis) and use it to:
- Boost scores of functions that are called by other high-scoring matches
- Present results in a "flow" view showing the call chain
- Allow queries like "trace the execution path from login to database"

### 10.4 Multi-Language Mixed Projects

Monorepos with both frontend (TypeScript) and backend (Python, PHP) code are common. Currently, if two functions in different languages do the same thing (e.g. `validateToken()` in Python backend and `parseJWT()` in TypeScript frontend), they score independently. There is no cross-language semantic linking.

With a shared embedding space, queries like "token validation" could surface both simultaneously, correctly ranked — this is already theoretically supported by the current architecture, but the ranking doesn't explicitly boost cross-language semantic equivalents.

### 10.5 Feedback-Based Ranking Improvement

When a user clicks a search result, that's a positive signal — the result was relevant. When a user ignores all results and reformulates the query, that's a negative signal. This feedback could be collected locally and used to fine-tune the relevance threshold or boost specific functions for specific query patterns.

A simple version: track which query-result pairs the user has clicked, and weight the cosine similarity score by a learned per-function relevance factor for similar queries.

### 10.6 Code Change Explanation

At index time, when a function is re-embedded (because its hash changed), the system knows the old version (from `index.json` hash history) and the new version. GPT could be used to generate a plain-English description of what changed:

> "`getProductInfo` now includes error logging and handles null product IDs."

This change description could be stored in Pinecone metadata and surfaced in search results, giving developers a searchable history of significant logic changes.

### 10.7 Support for More Languages and Frameworks

The chunker currently covers 12+ general-purpose languages. Specific frameworks have their own conventions that could be explicitly supported:

- **React** — component functions and custom hooks as semantic units
- **Django / Flask** — view functions and URL patterns
- **Spring** — `@Controller` methods as units
- **Laravel** — route handler methods
- **GraphQL** — resolver functions

Framework-aware chunking would produce more meaningful chunk boundaries and better metadata for search.

### 10.8 Offline Embedding via Local Models

The current system requires internet connectivity for Voyage AI and OpenAI API calls. For developers working offline, in air-gapped environments, or with sensitive codebases that cannot be sent to cloud APIs, a local embedding model could be substituted.

Models like `nomic-embed-code` or CodeBERT can be run locally using `llama.cpp` or `Ollama`. While smaller than cloud models (lower quality), they would make the system functional without any external API calls. The architecture already supports this — only `embedder.py` and `summarizer.py` would need alternative implementations.

---

## 11. Conclusion

This project set out to answer whether a semantic search system built on vector embeddings and LLMs could meaningfully improve code discovery over traditional keyword search. The answer, based on both implementation experience and experimental results, is unambiguously yes — with important nuance.

**Where semantic search wins decisively:**
Conceptual queries with no exact keyword match. When a developer searches for "authentication logic" and the function is called `validate_jwt()`, traditional search returns nothing. Smart Search returns it at 74%+ confidence. This scenario — searching for what code *does* rather than what it is *called* — is exactly the semantic gap that has never been addressable with traditional tools. Smart Search closes it.

**The role of LLM summarization:**
Raw code embedding alone produces moderate results (40–55%). Adding GPT-generated plain-English summaries dramatically improves scores (65–80%) by bridging the gap between code syntax and natural language. Without this step, the system would be limited to cases where code identifiers happen to use similar vocabulary to the search query. With it, the system understands *meaning* across the syntax barrier.

**Engineering quality matters as much as AI quality:**
The AI components (embeddings, LLM summarization, line locator) provide the search intelligence. But the engineering decisions — two-phase batching, incremental saves, threading, normalised hashing, namespace isolation, class chunk exclusion — are what make the system practical for real-world use. A semantically excellent system that takes 30 minutes to index and cannot survive a crash would not be used. Each engineering challenge required careful analysis of root causes and targeted solutions.

**The line locator as a UX breakthrough:**
Function-level results were the initial goal, but line-level results proved to be a qualitatively better experience. When the system not only finds `getProductInfo()` but also says "→ line 47: `$sql = "SELECT * FROM products WHERE id = ?"`", the developer can immediately verify the result is relevant and navigate there without reading the whole function. This second LLM pass is cheap (~$0.0001 per call), fast (~300ms parallel), and transforms the user experience from "relevant function" to "exact relevant line".

**Limitations:**
The system cannot understand relationships between functions (cross-function semantic linking), requires internet connectivity to cloud APIs, and is limited to function-level granularity (no statement-level search). These are known limitations with clear paths forward (call graph analysis, local models, and finer-grained chunking respectively).

Smart Search demonstrates that the combination of vector embeddings, LLM augmentation, and thoughtful engineering can produce a semantic code search tool that is not only technically impressive but genuinely useful in day-to-day development. The semantic gap in code search is a real and long-standing problem. This project shows it can be closed.

---

## 12. References

1. Feng, Z., et al. (2020). *CodeBERT: A Pre-Trained Model for Programming and Natural Language.* EMNLP 2020. [Foundational work on code embedding models]

2. Karpukhin, V., et al. (2020). *Dense Passage Retrieval for Open-Domain Question Answering.* EMNLP 2020. [Dense retrieval as an alternative to BM25 — motivates vector search approach]

3. Johnson, J., Douze, M., & Jégou, H. (2019). *Billion-scale similarity search with GPUs.* IEEE Transactions on Big Data. [FAISS — foundation for Pinecone's approximate nearest-neighbour search]

4. Husain, H., et al. (2019). *CodeSearchNet Challenge: Evaluating the State of Semantic Code Search.* arXiv:1909.09436. [Benchmark for semantic code search; establishes evaluation methodology]

5. Chen, M., et al. (2021). *Evaluating Large Language Models Trained on Code (Codex).* arXiv:2107.03374. [LLMs for code understanding — foundational for the summarization approach]

6. Brown, T., et al. (2020). *Language Models are Few-Shot Learners (GPT-3).* NeurIPS 2020. [Foundation of GPT family used in this project]

7. Voyage AI. (2024). *voyage-code-2: A Code-Specific Embedding Model.* Technical Documentation. [Primary embedding model used]

8. Pinecone. (2024). *Pinecone Vector Database Documentation.* [Vector storage and query infrastructure]

9. Malkov, Y. A., & Yashunin, D. A. (2018). *Efficient and Robust Approximate Nearest Neighbor Search Using Hierarchical Navigable Small World Graphs.* IEEE TPAMI. [HNSW algorithm underlying Pinecone's search]

10. OpenAI. (2024). *GPT-4o-mini Technical Report.* [LLM used for summarization and line locator]

---

## 13. Appendix

### A. File Structure

```
smart-search/
│
├── src/                              ← TypeScript extension source
│   ├── extension.ts                  ← Entry point: startup, listeners, commands
│   ├── config.ts                     ← Backend URL setting (smartSearch.backendUrl)
│   ├── indexer/
│   │   ├── workspaceIndexer.ts       ← Two-phase batched indexing, incremental save
│   │   ├── chunker.ts                ← Code splitter (12+ languages, local, no network)
│   │   ├── localIndex.ts             ← Read/write .smart-search/index.json
│   │   ├── projectId.ts              ← Generate/read project UUID
│   │   └── userId.ts                 ← Derive user ID from git email
│   ├── handlers/
│   │   ├── searchHandler.ts          ← Route search queries to Python backend
│   │   └── replaceHandler.ts         ← Apply text replacements via VS Code edit API
│   └── utils/
│       └── webviewManager.ts         ← Load frontend HTML into webview; send workspace info
│
├── backend/                          ← Python server (localhost:8000)
│   ├── server.py                     ← ThreadingHTTPServer (/search, /index, /wipe, /health, /config)
│   ├── summarizer.py                 ← GPT-4o-mini: plain-English function summaries
│   ├── line_locator.py               ← GPT-4o-mini: find exact relevant line in result
│   ├── embedder.py                   ← Voyage AI: embed code chunks and search queries
│   ├── pinecone_client.py            ← Pinecone: upsert/delete/query/wipe with namespace
│   ├── search.py                     ← Regex/text search across workspace files
│   ├── config.py                     ← MIN_AI_QUERY_LENGTH, DEFAULT_AI_THRESHOLD, IGNORE_FOLDERS
│   ├── requirements.txt              ← Python dependencies
│   └── .env                          ← API keys (never committed to git)
│
├── frontend/                         ← Search UI (inlined into VS Code webview at runtime)
│   ├── index.html                    ← UI structure and layout
│   ├── styles.css                    ← VS Code-themed styling
│   └── main.js                       ← UI logic, mode switching, message passing
│
├── out/                              ← Compiled TypeScript output (auto-generated)
├── package.json                      ← Extension manifest, commands, settings
├── tsconfig.json                     ← TypeScript compiler configuration
└── reports/
    └── documents/
        └── smart_search_technical_report.md    ← This document
```

### B. Backend API Reference

| Endpoint | Method | Request Body | Response |
|---|---|---|---|
| `/health` | GET | — | `{"ok": true}` |
| `/config` | GET | — | `{"minAiQueryLength": 5}` |
| `/index` | POST | `{chunks: [...], delete_ids: [...], namespace: "..."}` | `{"ok": true}` |
| `/search` | POST | `{query, searchType, namespace, workspacePath, threshold, ...}` | `{results, total, time_ms, ...}` |
| `/wipe` | POST | `{namespace: "..."}` | `{"ok": true}` |
| `/done` | POST | `{namespace, embedded, deleted, files_scanned, files_changed}` | `{"ok": true}` |

### C. VS Code Commands and Settings

**Commands (Command Palette — Ctrl+Shift+P / Cmd+Shift+P):**

| Command | Description |
|---|---|
| `Smart Search` | Opens the search panel |
| `Smart Search: Re-index Workspace` | Wipes all vectors for this project in Pinecone, deletes `index.json`, re-indexes from scratch. Asks for confirmation. |

**Settings (VS Code Settings → search "Smart Search"):**

| Setting | Default | Description |
|---|---|---|
| `smartSearch.backendUrl` | `http://localhost:8000` | Base URL of the Python backend. Change to a remote URL to use a hosted backend. |

**Note:** The minimum AI query length is NOT a VS Code setting. It is controlled by `MIN_AI_QUERY_LENGTH` in `backend/config.py` and served to the frontend via the `/config` endpoint. This ensures frontend and backend always enforce the same limit.

### D. Environment Variables (backend/.env)

```bash
OPENAI_API_KEY=sk-...          # GPT-4o-mini: summarization and line locator
VOYAGE_API_KEY=pa-...          # voyage-code-2: code embeddings
PINECONE_API_KEY=pcsk_...      # vector storage
PINECONE_HOST=https://...      # your Pinecone index host URL

# Optional — defaults shown:
BACKEND_HOST=localhost
BACKEND_PORT=8000
```

### E. Setup and Running

```bash
# 1. Install Python dependencies
cd backend
pip install -r requirements.txt

# 2. Configure API keys
cp .env.example .env
# Edit .env with your actual keys

# 3. Start the Python backend
python3 server.py
# → "Backend server running on http://localhost:8000 (threaded)"

# 4. Compile TypeScript
cd ..
npm install
npx tsc

# 5. Launch the extension
# Press F5 in VS Code → Extension Development Host opens
# Status bar shows "⟳ Smart Search: scanning 1/N..."
# Then "⟳ Smart Search: embedding 1/M..."
# Then "✓ Smart Search: N files updated"

# 6. Check the terminal — backend prints the final index state:
#
#   First run (new project):
#     ✓ Indexing complete — 89 functions embedded, 0 deleted
#       12 files changed out of 12 scanned  [ns=a3f2c1d4::b7f2a1c5]
#
#   Already fully indexed (no changes since last run):
#     ✓ Already fully indexed — no changes detected
#       12 files scanned, 0 functions changed  [ns=a3f2c1d4::b7f2a1c5]

# 7. Open Smart Search
# Ctrl+Shift+P → "Smart Search"
# Or use the keyboard shortcut configured in keybindings
```
