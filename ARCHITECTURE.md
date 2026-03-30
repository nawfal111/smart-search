# Smart Search — System Architecture

## Full System Overview

```mermaid
flowchart TB
    subgraph IDE["🖥️ VS Code Extension (Frontend)"]
        UI["Search Panel\n──────────\nQuery Input\nMode Toggle\nResults View"]
    end

    subgraph Backend["⚙️ Python Backend (localhost:8000)"]
        Router["Request Router\n/search"]
        NormalSearch["Normal Search\nBM25 / Regex"]
        AISearch["AI Search\nOrchestrator"]
    end

    subgraph Indexing["📦 Indexing Pipeline"]
        Watcher["File Watcher\nonDidSaveTextDocument"]
        Parser["Tree-sitter Parser\n(AST)"]
        Chunker["Chunk Extractor\nfunctions / classes / blocks"]
        Hasher["Hash Checker\nskip unchanged"]
        Embedder["Embedding Model\ntext-embedding-3-small"]
        LocalIndex["Local Index\n(globalStorageUri JSON)"]
    end

    subgraph Storage["🗄️ Storage Layer"]
        Pinecone["Pinecone\nVector DB"]
        Disk["Codebase Files\n(disk)"]
    end

    subgraph RAG["🤖 RAG Layer"]
        Reranker["Cross-Encoder\nReranker"]
        LLM["Claude API\nAnswer Generator"]
    end

    UI -->|"HTTP POST /search"| Router
    Router -->|"searchType: normal"| NormalSearch
    Router -->|"searchType: ai"| AISearch

    NormalSearch -->|"walk files + regex"| Disk
    NormalSearch -->|"results"| UI

    AISearch -->|"embed query"| Embedder
    Embedder -->|"query vector"| Pinecone
    Pinecone -->|"top-K chunk IDs + metadata"| Reranker
    Reranker -->|"re-ranked chunks"| LLM
    Disk -->|"fetch actual code\nby file + line number"| LLM
    LLM -->|"answer + sources"| UI

    Watcher -->|"changed file"| Parser
    Parser -->|"AST nodes"| Chunker
    Chunker -->|"function chunks"| Hasher
    Hasher -->|"check existing hash"| LocalIndex
    Hasher -->|"new / changed chunks"| Embedder
    Embedder -->|"upsert vectors"| Pinecone
    Hasher -->|"update hashes"| LocalIndex
```

---

## Indexing Pipeline (Detail)

```mermaid
flowchart LR
    A["📄 File Saved\nor Workspace Open"] --> B["Parse with\nTree-sitter"]
    B --> C["Extract Chunks\nfunctions · classes · blocks"]
    C --> D["Hash each\nchunk content"]
    D --> E{"Exists in\nlocal index?"}

    E -->|"No → new"| G["Embed chunk\nvia OpenAI API"]
    E -->|"Yes, hash changed\n→ modified"| F["Delete old\nvector from Pinecone"]
    E -->|"Yes, same hash\n→ unchanged"| SKIP["Skip ✓"]
    F --> G
    G --> H["Upsert to\nPinecone\n+ metadata"]
    H --> I["Update\nLocal Index JSON"]

    style SKIP fill:#2d4a2d,color:#aaffaa
    style G fill:#1a3a5c,color:#aad4ff
    style H fill:#1a3a5c,color:#aad4ff
```

---

## Search Pipeline (Detail)

```mermaid
flowchart TD
    A["👤 User types query\nin VS Code panel"] --> B{"Search\nMode?"}

    B -->|"Normal"| C["Regex / BM25\nover codebase files"]
    C --> D["Return matches\nwith file + line"]
    D --> K

    B -->|"AI"| E["Embed query\ntext-embedding-3-small"]
    E --> F["Query Pinecone\ntop-K nearest vectors"]
    F --> G["Fetch actual code\nfrom disk by line numbers"]
    G --> H["Cross-Encoder\nReranker\nfilter noise"]
    H --> I{"Answer\nMode?"}

    I -->|"Results only"| J["Return ranked\ncode chunks"]
    I -->|"Explain"| L["Send to Claude API\nwith retrieved chunks as context"]
    L --> M["Natural language\nanswer + source citations"]

    J --> K["Display in\nVS Code panel\nwith file jump links"]
    M --> K

    style E fill:#1a3a5c,color:#aad4ff
    style F fill:#1a3a5c,color:#aad4ff
    style H fill:#3a2a5c,color:#d4aaff
    style L fill:#3a2a5c,color:#d4aaff
```

---

## Chunk Metadata Structure

```mermaid
classDiagram
    class Chunk {
        +string id
        +string file_path
        +string language
        +string chunk_type
        +string name
        +int start_line
        +int end_line
        +string content
        +string content_hash
        +float[] embedding_vector
    }

    class PineconeRecord {
        +string id
        +float[] values
        +ChunkMetadata metadata
    }

    class ChunkMetadata {
        +string file
        +string name
        +string type
        +int start_line
        +int end_line
        +string language
    }

    Chunk --> PineconeRecord : stored as
    PineconeRecord --> ChunkMetadata : contains
```

---

## Comparison: Old vs New Approach

```mermaid
flowchart LR
    subgraph OLD["❌ Old Approach (Lexical)"]
        direction TB
        o1["User query:\n'find auth logic'"] --> o2["grep / regex\nexact match"]
        o2 --> o3["Finds only files\ncontaining word 'auth'"]
        o3 --> o4["Misses: verify_token()\ncheck_credentials()\nvalidate_session()"]
    end

    subgraph NEW["✅ Your Approach (Semantic)"]
        direction TB
        n1["User query:\n'find auth logic'"] --> n2["Embed query\n→ vector"]
        n2 --> n3["Similarity search\nin vector space"]
        n3 --> n4["Finds: verify_token()\ncheck_credentials()\nvalidate_session()\neven without the word 'auth'"]
    end

    style OLD fill:#3a1a1a,color:#ffaaaa
    style NEW fill:#1a3a1a,color:#aaffaa
```
