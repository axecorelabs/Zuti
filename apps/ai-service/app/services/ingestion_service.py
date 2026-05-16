"""
Ingestion service — parses documents and stores chunks in Qdrant.
"""
from __future__ import annotations
import logging
import uuid
import httpx
from app.services.embedding_service import embedding_service, EMBEDDING_DIM
from app.core.config import settings

logger = logging.getLogger(__name__)
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 100


def _collection(organization_id: str) -> str:
    return f"org_{organization_id}"


def _chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + size
        chunks.append(text[start:end])
        start += size - overlap
    return [c for c in chunks if c.strip()]


class IngestionService:
    async def _ensure_collection(self, organization_id: str):
        from qdrant_client import AsyncQdrantClient
        from qdrant_client.models import Distance, VectorParams

        client = AsyncQdrantClient(url=settings.QDRANT_URL)
        collection = _collection(organization_id)
        existing = [c.name for c in (await client.get_collections()).collections]
        if collection not in existing:
            await client.create_collection(
                collection_name=collection,
                vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
            )
        return client, collection

    async def ingest_url(
        self,
        organization_id: str,
        knowledge_file_id: str,
        url: str,
    ) -> int:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as http:
            response = await http.get(url)
            response.raise_for_status()
            text = response.text

        return await self._ingest_text(organization_id, knowledge_file_id, text)

    async def ingest_bytes(
        self,
        organization_id: str,
        knowledge_file_id: str,
        content: bytes,
        filename: str,
        content_type: str,
    ) -> int:
        text = self._extract_text(content, filename, content_type)
        return await self._ingest_text(organization_id, knowledge_file_id, text)

    async def _ingest_text(
        self,
        organization_id: str,
        knowledge_file_id: str,
        text: str,
    ) -> int:
        chunks = _chunk_text(text)
        if not chunks:
            return 0

        embeddings = await embedding_service.embed_many(chunks)
        client, collection = await self._ensure_collection(organization_id)

        from qdrant_client.models import PointStruct
        points = [
            PointStruct(
                id=str(uuid.uuid4()),
                vector=embedding,
                payload={
                    "content": chunk,
                    "knowledge_file_id": knowledge_file_id,
                    "organization_id": organization_id,
                    "chunk_index": i,
                },
            )
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings))
        ]

        await client.upsert(collection_name=collection, points=points)
        return len(points)

    def _extract_text(self, content: bytes, filename: str, content_type: str) -> str:
        lower = filename.lower()
        if lower.endswith(".pdf") or "pdf" in content_type:
            return self._extract_pdf(content)
        elif lower.endswith(".docx") or "wordprocessing" in content_type:
            return self._extract_docx(content)
        else:
            return content.decode("utf-8", errors="ignore")

    def _extract_pdf(self, content: bytes) -> str:
        import io
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as e:
            logger.error(f"PDF extraction failed: {e}")
            return ""

    def _extract_docx(self, content: bytes) -> str:
        import io
        try:
            import docx
            doc = docx.Document(io.BytesIO(content))
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception as e:
            logger.error(f"DOCX extraction failed: {e}")
            return ""

    async def delete_collection(self, organization_id: str):
        from qdrant_client import AsyncQdrantClient
        client = AsyncQdrantClient(url=settings.QDRANT_URL)
        await client.delete_collection(_collection(organization_id))


ingestion_service = IngestionService()
