"""
Embedding service — uses Jina AI jina-embeddings-v2-base-en.
Falls back gracefully to zero vectors when no API key is set.
"""
from __future__ import annotations
import logging
import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)
EMBEDDING_DIM = 768  # jina-embeddings-v2-base-en
JINA_API_URL = "https://api.jina.ai/v1/embeddings"
JINA_MODEL = "jina-embeddings-v2-base-en"


class EmbeddingService:
    async def _call(self, texts: list[str]) -> list[list[float]]:
        headers = {
            "Authorization": f"Bearer {settings.JINA_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {"model": JINA_MODEL, "input": texts}
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.post(JINA_API_URL, json=payload, headers=headers)
            res.raise_for_status()
            data = res.json()
        return [item["embedding"] for item in data["data"]]

    async def embed(self, text: str) -> list[float]:
        if not settings.JINA_API_KEY:
            logger.warning("JINA_API_KEY not set — returning zero vector")
            return [0.0] * EMBEDDING_DIM
        try:
            return (await self._call([text]))[0]
        except Exception as e:
            logger.error(f"Jina embedding failed: {e} — returning zero vector")
            return [0.0] * EMBEDDING_DIM

    async def embed_many(self, texts: list[str]) -> list[list[float]]:
        if not settings.JINA_API_KEY:
            return [[0.0] * EMBEDDING_DIM for _ in texts]
        try:
            return await self._call(texts)
        except Exception as e:
            logger.error(f"Jina batch embedding failed: {e} — returning zero vectors")
            return [[0.0] * EMBEDDING_DIM for _ in texts]


embedding_service = EmbeddingService()
