import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def embed_text(text: str) -> list:
    response = _client.embeddings.create(
        model="text-embedding-3-small",
        input=text[:8000],
    )
    return response.data[0].embedding


def embed_chunks(chunks: list) -> list:
    result = []
    for chunk in chunks:
        vector = embed_text(chunk["content"])
        result.append({**chunk, "vector": vector})
    return result
