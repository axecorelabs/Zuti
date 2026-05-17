"""
RAG service — retrieves relevant chunks from Qdrant and generates a reply via LLM.
"""
from __future__ import annotations
import logging
from typing import Any
from app.services.embedding_service import embedding_service
from app.services.llm_service import llm_service
from app.core.config import settings

logger = logging.getLogger(__name__)

# Collection names are scoped per-organization
def _collection(organization_id: str) -> str:
    return f"org_{organization_id}"


class RagService:
    async def chat(
        self,
        organization_id: str,
        bot_id: str,
        conversation_id: str,
        message: str,
        top_k: int = 5,
        bot_name: str = "Assistant",
        org_name: str | None = None,
        system_prompt: str | None = None,
    ) -> tuple[str, list[dict]]:
        # 1. Try RAG (embed + Qdrant search) — degrade gracefully if unavailable
        sources: list[dict] = []
        context = ""
        try:
            query_vector = await embedding_service.embed(message)

            from qdrant_client import AsyncQdrantClient
            client = AsyncQdrantClient(
                url=settings.QDRANT_URL,
                api_key=settings.QDRANT_API_KEY or None,
            )
            collection = _collection(organization_id)

            results = await client.search(
                collection_name=collection,
                query_vector=query_vector,
                limit=top_k,
                score_threshold=0.5,
            )

            for hit in results:
                payload = hit.payload or {}
                sources.append({"content": payload.get("content", ""), "score": hit.score})

            context = "\n\n".join(s["content"] for s in sources)
        except Exception as e:
            logger.warning(f"RAG search failed (continuing without context): {e}")

        # 2. Generate reply
        reply = await llm_service.generate(
            user_message=message,
            context=context,
            conversation_id=conversation_id,
            bot_name=bot_name,
            org_name=org_name,
            system_prompt_override=system_prompt,
        )

        return reply, sources

    async def health_check(self) -> bool:
        try:
            from qdrant_client import AsyncQdrantClient
            client = AsyncQdrantClient(url=settings.QDRANT_URL)
            await client.get_collections()
            return True
        except Exception:
            return False


rag_service = RagService()
