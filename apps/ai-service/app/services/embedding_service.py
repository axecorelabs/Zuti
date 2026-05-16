"""
Embedding service — wraps OpenAI text-embedding-3-small.
Falls back gracefully when no API key is set.
"""
from __future__ import annotations
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)
EMBEDDING_DIM = 1536  # text-embedding-3-small


class EmbeddingService:
    def __init__(self):
        self._client = None

    def _get_client(self):
        if self._client is None:
            from openai import AsyncOpenAI
            self._client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        return self._client

    async def embed(self, text: str) -> list[float]:
        if not settings.OPENAI_API_KEY:
            logger.warning("OPENAI_API_KEY not set — returning zero vector")
            return [0.0] * EMBEDDING_DIM

        client = self._get_client()
        response = await client.embeddings.create(
            model="text-embedding-3-small",
            input=text,
        )
        return response.data[0].embedding

    async def embed_many(self, texts: list[str]) -> list[list[float]]:
        if not settings.OPENAI_API_KEY:
            return [[0.0] * EMBEDDING_DIM for _ in texts]

        client = self._get_client()
        response = await client.embeddings.create(
            model="text-embedding-3-small",
            input=texts,
        )
        return [item.embedding for item in response.data]


embedding_service = EmbeddingService()
