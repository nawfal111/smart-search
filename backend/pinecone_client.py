import os
from pinecone import Pinecone
from dotenv import load_dotenv

load_dotenv()

_pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
_index = _pc.Index(host=os.getenv("PINECONE_HOST"))


def upsert_chunks(chunks_with_vectors: list):
    vectors = []
    for chunk in chunks_with_vectors:
        vectors.append({
            "id": chunk["id"],
            "values": chunk["vector"],
            "metadata": {
                "file": chunk["file"],
                "name": chunk["name"],
                "type": chunk["type"],
                "start_line": chunk["start_line"],
                "end_line": chunk["end_line"],
                "content": chunk["content"][:1000],  # Pinecone metadata size limit
            },
        })
    if vectors:
        _index.upsert(vectors=vectors)


def delete_chunks(chunk_ids: list):
    if chunk_ids:
        _index.delete(ids=chunk_ids)
