"""Download the local embedding model at build time (python -m agents.prefetch, from server/), so a
hosted server does not fetch it on every cold start. Nothing to do when embeddings are off."""

from fastembed import TextEmbedding

from .config import load_settings

if __name__ == "__main__":
    s = load_settings()
    if s.embeddings:
        s.models_dir.mkdir(parents=True, exist_ok=True)
        TextEmbedding("BAAI/bge-small-en-v1.5", cache_dir=str(s.models_dir))
        print(f"embedding model ready in {s.models_dir}")
    else:
        print("embeddings off: nothing to download")
