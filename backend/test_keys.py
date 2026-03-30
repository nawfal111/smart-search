import os
from dotenv import load_dotenv

load_dotenv()

print("\n── Checking API Keys ──────────────────")

# ── OpenAI ────────────────────────────────
try:
    from openai import OpenAI
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input="test"
    )
    print("✅ OpenAI     — working (embedding dimension:", len(response.data[0].embedding), ")")
except Exception as e:
    print("❌ OpenAI     — FAILED:", e)

# ── Pinecone ──────────────────────────────
try:
    from pinecone import Pinecone
    pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
    indexes = pc.list_indexes()
    print("✅ Pinecone   — working (indexes:", [i.name for i in indexes], ")")
except Exception as e:
    print("❌ Pinecone   — FAILED:", e)

# ── Anthropic ─────────────────────────────
try:
    import anthropic
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=10,
        messages=[{"role": "user", "content": "say hi"}]
    )
    print("✅ Anthropic  — working")
except Exception as e:
    print("❌ Anthropic  — FAILED:", e)

print("───────────────────────────────────────\n")
