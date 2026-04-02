# Smart Search — System Diagrams

Paste each diagram into **mermaid.live** → click Export → Save as PNG or SVG.

---

## Diagram 1 — Full System Overview

```mermaid
flowchart TD
    classDef user      fill:#4A90D9,stroke:#2C5F8A,color:#fff,font-weight:bold
    classDef extension fill:#5BA85A,stroke:#3A6E39,color:#fff,font-weight:bold
    classDef backend   fill:#E88C2A,stroke:#A85E10,color:#fff,font-weight:bold
    classDef cloud     fill:#9B59B6,stroke:#6C3483,color:#fff,font-weight:bold
    classDef storage   fill:#E74C3C,stroke:#A93226,color:#fff,font-weight:bold
    classDef decision  fill:#F0F0F0,stroke:#999,color:#333,font-weight:bold

    U1([👤 Developer opens project]):::user
    U2([✏️ Developer edits a file]):::user
    U3([🔍 Developer types a query]):::user

    subgraph EXT["  🖥️  VS Code Extension  "]
        E1[Scan all files\nin the project]:::extension
        E2{File hash\nchanged?}:::decision
        E3[Hash each\nfunction]:::extension
        E4{Function hash\nchanged?}:::decision
        E5[Skip — already\nin Pinecone]:::extension
        E6[Collect changed\nfunctions to embed]:::extension
        E7[Update local\nindex.json]:::storage
        E8[Embed the\nsearch query]:::extension
        E9[Show results\nin the panel]:::extension
    end

    subgraph BE["  ⚙️  Python Backend  "]
        B1[Parse file into\nfunctions using AST]:::backend
        B2[Receive functions\nto embed]:::backend
        B3[Call Embedding Model\ntext → 1536 numbers]:::backend
        B4[Receive query vector\nSearch Pinecone]:::backend
    end

    subgraph CLOUD["  ☁️  Cloud Services  "]
        C1[(🗂️ Pinecone\nVector Database)]:::cloud
        C2[🤖 Embedding API\nOpenAI]:::cloud
    end

    %% First run / file save flow
    U1 --> E1
    U2 --> E1
    E1 --> E2
    E2 -->|No change| E5
    E2 -->|Changed| E3
    E3 --> E4
    E4 -->|Same hash| E5
    E4 -->|Different hash| E6
    E6 --> B1
    B1 --> B2
    B2 --> B3
    B3 --> C2
    C2 -->|vector| B3
    B3 --> C1
    C1 -->|chunk IDs| E7

    %% Search flow
    U3 --> E8
    E8 --> B4
    B4 --> C2
    C2 -->|query vector| B4
    B4 --> C1
    C1 -->|top matches| E9
```

---

## Diagram 2 — Indexing Pipeline (Detail)

```mermaid
flowchart LR
    classDef step     fill:#2E86AB,stroke:#1A5276,color:#fff,font-weight:bold
    classDef decision fill:#FFEAA7,stroke:#FDCB6E,color:#333,font-weight:bold
    classDef storage  fill:#00B894,stroke:#00856F,color:#fff,font-weight:bold
    classDef skip     fill:#B2BABB,stroke:#808B96,color:#333
    classDef embed    fill:#E17055,stroke:#C0392B,color:#fff,font-weight:bold

    A([Project Opens\nor File Saved]):::step
    B[Read file\nfrom disk]:::step
    C[Hash entire\nfile — MD5]:::step
    D{Same as\nstored hash?}:::decision
    E([Skip file\n— unchanged ✓]):::skip
    F[Ask backend\nto split into functions]:::step
    G[Hash each\nfunction individually]:::step
    H{Function hash\nchanged or new?}:::decision
    I([Keep existing\nvector in Pinecone ✓]):::skip
    J[Mark function\nfor re-embedding]:::embed
    K[Delete old vector\nfrom Pinecone]:::embed
    L[Embed new content\nvia OpenAI API]:::embed
    M[Save new vector\nto Pinecone]:::storage
    N[Update index.json\nwith new hashes]:::storage

    A --> B --> C --> D
    D -->|Yes| E
    D -->|No| F --> G --> H
    H -->|No change| I
    H -->|Changed or new| J --> K --> L --> M --> N
```

---

## Diagram 3 — Search Pipeline (Detail)

```mermaid
flowchart TD
    classDef user     fill:#6C5CE7,stroke:#4A3AB8,color:#fff,font-weight:bold
    classDef normal   fill:#00B894,stroke:#00856F,color:#fff,font-weight:bold
    classDef ai       fill:#E17055,stroke:#C0392B,color:#fff,font-weight:bold
    classDef cloud    fill:#0984E3,stroke:#065A9E,color:#fff,font-weight:bold
    classDef result   fill:#FDCB6E,stroke:#E0A800,color:#333,font-weight:bold

    A([Developer types\na search query]):::user
    B{Search\nMode?}

    subgraph NORMAL["  Normal Search  "]
        N1[Scan files with\nregex / keyword]:::normal
        N2[Find exact\ntext matches]:::normal
        N3[Return file path\n+ line number\n+ matched text]:::normal
    end

    subgraph AI["  AI Semantic Search  "]
        A1[Embed query text\nvia OpenAI API]:::ai
        A2[Query Pinecone\nfind similar vectors]:::cloud
        A3[Retrieve top-K\nmatching functions]:::ai
        A4[Return file path\n+ line number\n+ similarity score]:::ai
    end

    R([Show results in panel\nClick → jump to line in editor]):::result

    A --> B
    B -->|Normal| N1 --> N2 --> N3 --> R
    B -->|AI| A1 --> A2 --> A3 --> A4 --> R
```

---

## Diagram 4 — Old vs New Approach (for Research Paper)

```mermaid
flowchart LR
    classDef old    fill:#E74C3C,stroke:#922B21,color:#fff,font-weight:bold
    classDef new    fill:#27AE60,stroke:#1A6B3A,color:#fff,font-weight:bold
    classDef query  fill:#2C3E50,stroke:#1A252F,color:#fff,font-weight:bold
    classDef miss   fill:#FADBD8,stroke:#E74C3C,color:#922B21
    classDef hit    fill:#D5F5E3,stroke:#27AE60,color:#1A6B3A

    Q([🔍 Query:\n'find where user\nauthentication happens']):::query

    subgraph OLD["  ❌ Traditional Approach — Keyword Search  "]
        O1[Search for exact\nword 'authentication']:::old
        O2[Finds only files containing\nthe word 'authentication']:::old
        O3["Misses:\n✗ verify_token()\n✗ check_credentials()\n✗ validate_session()\n— none contain the word"]:::miss
    end

    subgraph NEW["  ✅ Your Approach — Semantic Search  "]
        N1[Embed query into\na meaning vector]:::new
        N2[Find vectors closest\nin meaning — Pinecone]:::new
        N3["Finds:\n✓ verify_token()       0.91\n✓ check_credentials()  0.88\n✓ validate_session()   0.85\n— even without the word"]:::hit
    end

    Q --> O1 --> O2 --> O3
    Q --> N1 --> N2 --> N3
```
