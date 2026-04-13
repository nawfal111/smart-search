"""
Quick script to check what's stored in Pinecone.
Run: python3 check_pinecone.py
"""

import os
from pinecone import Pinecone
from dotenv import load_dotenv

load_dotenv()

pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index(host=os.getenv("PINECONE_HOST"))

# Show overall stats (total vectors per namespace)
stats = index.describe_index_stats()
print("=== Pinecone Index Stats ===")
print(f"Total vectors: {stats.total_vector_count}")
print(f"Namespaces:")
for ns, info in stats.namespaces.items():
    print(f"  {ns}  →  {info.vector_count} vectors")

# If there are namespaces, fetch a sample vector from the first one
if stats.namespaces:
    first_ns = list(stats.namespaces.keys())[0]
    print(f"\n=== Sample vectors from namespace: {first_ns} ===")

    # List a few vector IDs
    result = index.list(namespace=first_ns, limit=10)
    ids = list(result)
    print(f"Vector IDs found: {ids}")

    # Fetch the first one to see its metadata
    if ids:
        fetched = index.fetch(ids=ids[:3], namespace=first_ns)
        for vid, vec in fetched.vectors.items():
            print(f"\nID: {vid}")
            print(f"  file:       {vec.metadata.get('file')}")
            print(f"  name:       {vec.metadata.get('name')}")
            print(f"  type:       {vec.metadata.get('type')}")
            print(f"  start_line: {vec.metadata.get('start_line')}")
            print(f"  end_line:   {vec.metadata.get('end_line')}")
            print(f"  content:    {vec.metadata.get('content', '')[:100]}...")
