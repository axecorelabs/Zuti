"""
Ingestion service — parses documents and stores chunks in Qdrant.
"""
from __future__ import annotations
import logging
import base64
import re
import socket
import uuid
import httpx
from datetime import datetime, timezone
from ipaddress import ip_address
from urllib.parse import urlparse
from app.services.embedding_service import embedding_service, EMBEDDING_DIM
from app.core.config import settings

logger = logging.getLogger(__name__)
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 100
BLOCKED_SOURCE_EXTENSIONS = {
    ".js", ".ts", ".tsx", ".jsx", ".py", ".java", ".go", ".rs", ".c", ".cpp", ".h",
    ".cs", ".php", ".rb", ".swift", ".kt", ".scala", ".sql", ".sh", ".bash", ".zsh",
    ".yaml", ".yml", ".json", ".toml", ".ini", ".env", ".pem", ".key",
}

BLOCKED_UPLOAD_EXTENSIONS = {
    ".exe", ".dll", ".msi", ".scr", ".bat", ".cmd", ".com", ".ps1", ".vbs", ".js",
    ".jar", ".apk", ".ipa", ".pkg", ".dmg", ".iso", ".lnk", ".reg", ".hta",
}

EICAR_SIGNATURE = (
    b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
)

SECRET_PATTERNS = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", re.IGNORECASE),
    re.compile(r"aws_secret_access_key", re.IGNORECASE),
    re.compile(r"api[_-]?key\s*[:=]", re.IGNORECASE),
    re.compile(r"token\s*[:=]", re.IGNORECASE),
    re.compile(r"password\s*[:=]", re.IGNORECASE),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
]


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

        client = AsyncQdrantClient(url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY or None)
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
        name: str,
        bot_id: str | None = None,
    ) -> int:
        self._validate_public_url(url)
        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as http:
            response = await http.get(url)
            response.raise_for_status()
            text = response.text

        self._validate_text_safety(text)
        return await self._ingest_text(
            organization_id,
            knowledge_file_id,
            text,
            {
                "source_type": "url",
                "source_name": name,
                "source_url": url,
                "bot_id": bot_id,
            },
        )

    async def ingest_plain_text(
        self,
        organization_id: str,
        knowledge_file_id: str,
        name: str,
        text: str,
        bot_id: str | None = None,
    ) -> int:
        self._validate_text_safety(text)
        return await self._ingest_text(
            organization_id,
            knowledge_file_id,
            text,
            {
                "source_type": "text",
                "source_name": name,
                "source_url": None,
                "bot_id": bot_id,
            },
        )

    async def ingest_bytes(
        self,
        organization_id: str,
        knowledge_file_id: str,
        content: bytes,
        filename: str,
        content_type: str,
        bot_id: str | None = None,
    ) -> int:
        await self._scan_uploaded_file(content, filename, content_type)
        text = self._extract_text(content, filename, content_type)
        self._validate_file_safety(filename)
        self._validate_text_safety(text)
        return await self._ingest_text(
            organization_id,
            knowledge_file_id,
            text,
            {
                "source_type": "file",
                "source_name": filename,
                "source_url": None,
                "bot_id": bot_id,
            },
        )

    async def _scan_uploaded_file(self, content: bytes, filename: str, content_type: str) -> None:
        lower_name = filename.lower()
        if any(lower_name.endswith(ext) for ext in BLOCKED_UPLOAD_EXTENSIONS):
            raise ValueError(f"Blocked file type: {filename}")

        if EICAR_SIGNATURE in content:
            raise ValueError("Virus scan failed: EICAR test signature detected")

        scan_url = settings.FILE_SCAN_URL.strip()
        if scan_url:
            timeout_ms = settings.FILE_SCAN_TIMEOUT_MS if settings.FILE_SCAN_TIMEOUT_MS > 0 else 10000
            async with httpx.AsyncClient(timeout=timeout_ms / 1000) as http:
                response = await http.post(
                    scan_url,
                    json={
                        "filename": filename,
                        "content_type": content_type,
                        "content_base64": base64.b64encode(content).decode("ascii"),
                    },
                )
            response.raise_for_status()
            data = response.json() if response.content else {}
            if not isinstance(data, dict):
                raise ValueError("Virus scan service returned an invalid response")
            if data.get("clean") is not True:
                reason = data.get("reason") or "malware detected"
                raise ValueError(f"Virus scan failed: {reason}")
            return

        if settings.FILE_SCAN_REQUIRED:
            raise ValueError("File virus scanning is required but no FILE_SCAN_URL is configured")

        logger.warning("File scan backend is not configured; proceeding with heuristic-only checks for %s", filename)

    async def _ingest_text(
        self,
        organization_id: str,
        knowledge_file_id: str,
        text: str,
        metadata: dict,
    ) -> int:
        chunks = _chunk_text(text)
        if not chunks:
            return 0

        embeddings = await embedding_service.embed_many(chunks)
        client, collection = await self._ensure_collection(organization_id)

        from qdrant_client.models import PointStruct
        ingested_at = datetime.now(timezone.utc).isoformat()
        bot_id = metadata.get("bot_id")
        bot_scope = f"bot_{bot_id}" if bot_id else "__shared__"
        points = [
            PointStruct(
                id=str(uuid.uuid4()),
                vector=embedding,
                payload={
                    "content": chunk,
                    "knowledge_file_id": knowledge_file_id,
                    "organization_id": organization_id,
                    "chunk_index": i,
                    "source_type": metadata.get("source_type", "text"),
                    "source_name": metadata.get("source_name") or knowledge_file_id,
                    "source_url": metadata.get("source_url"),
                    "bot_id": bot_id,
                    "bot_scope": bot_scope,
                    "ingested_at": ingested_at,
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
        client = AsyncQdrantClient(url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY or None)
        await client.delete_collection(_collection(organization_id))

    async def list_knowledge_items(self, organization_id: str, bot_id: str | None = None) -> list[dict]:
        from qdrant_client import AsyncQdrantClient
        from qdrant_client.http.exceptions import UnexpectedResponse

        client = AsyncQdrantClient(url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY or None)
        collection = _collection(organization_id)

        try:
            await client.get_collection(collection)
        except UnexpectedResponse as exc:
            if exc.status_code == 404:
                return []
            raise

        offset = None
        items: dict[str, dict] = {}

        target_scopes = {"__shared__"}
        if bot_id:
            target_scopes.add(f"bot_{bot_id}")

        while True:
            points, next_offset = await client.scroll(
                collection_name=collection,
                with_payload=True,
                with_vectors=False,
                limit=256,
                offset=offset,
            )

            for point in points:
                payload = point.payload or {}
                knowledge_file_id = str(payload.get("knowledge_file_id", ""))
                if not knowledge_file_id:
                    continue

                bot_scope = str(payload.get("bot_scope") or "__shared__")
                if bot_id and bot_scope not in target_scopes:
                    continue

                if knowledge_file_id not in items:
                    items[knowledge_file_id] = {
                        "knowledge_file_id": knowledge_file_id,
                        "name": payload.get("source_name") or knowledge_file_id,
                        "source_type": payload.get("source_type") or "text",
                        "source_url": payload.get("source_url"),
                        "bot_id": payload.get("bot_id"),
                        "scope": "agent" if bot_scope != "__shared__" else "shared",
                        "chunk_count": 0,
                        "ingested_at": payload.get("ingested_at") or "",
                    }
                items[knowledge_file_id]["chunk_count"] += 1

            if next_offset is None:
                break
            offset = next_offset

        return sorted(
            items.values(),
            key=lambda item: item.get("ingested_at") or "",
            reverse=True,
        )

    async def delete_knowledge_item(self, organization_id: str, knowledge_file_id: str) -> bool:
        from qdrant_client import AsyncQdrantClient
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        client = AsyncQdrantClient(url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY or None)
        collection = _collection(organization_id)

        await client.delete(
            collection_name=collection,
            points_selector=Filter(
                must=[
                    FieldCondition(
                        key="knowledge_file_id",
                        match=MatchValue(value=knowledge_file_id),
                    )
                ]
            ),
            wait=True,
        )
        return True

    def _validate_public_url(self, url: str):
        parsed = urlparse(url.strip())
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("Only http/https URLs are allowed.")

        if parsed.username or parsed.password:
            raise ValueError("URLs with embedded credentials are not allowed.")

        host = (parsed.hostname or "").strip().lower()
        if not host:
            raise ValueError("URL host is required.")

        if host in {"localhost", "127.0.0.1", "::1", "0.0.0.0"} or host.endswith(".local"):
            raise ValueError("Local/internal URLs are not allowed.")

        self._validate_file_safety(parsed.path or "")

        try:
            for _, _, _, _, sockaddr in socket.getaddrinfo(host, None):
                ip_value = ip_address(sockaddr[0])
                if (
                    ip_value.is_private
                    or ip_value.is_loopback
                    or ip_value.is_link_local
                    or ip_value.is_reserved
                    or ip_value.is_multicast
                    or ip_value.is_unspecified
                ):
                    raise ValueError("URL resolves to a private/internal network address.")
        except ValueError:
            raise
        except Exception:
            raise ValueError("Could not safely validate URL host.")

    def _validate_file_safety(self, name_or_path: str):
        lower = (name_or_path or "").lower().strip()
        for ext in BLOCKED_SOURCE_EXTENSIONS:
            if lower.endswith(ext):
                raise ValueError("Code/config file sources are blocked for security reasons.")

    def _validate_text_safety(self, text: str):
        normalized = text or ""
        stripped = normalized.strip()
        if not stripped:
            raise ValueError("Content is empty after parsing.")

        if len(stripped) > 200_000:
            raise ValueError("Content is too large. Please reduce to under 200k characters.")

        for pattern in SECRET_PATTERNS:
            if pattern.search(stripped):
                raise ValueError("Sensitive secrets/credentials detected. Remove them before ingesting.")

        lines = [line for line in stripped.splitlines() if line.strip()]
        if len(lines) >= 20:
            code_line_re = re.compile(
                r"^\s*(import\s+|from\s+.+\s+import\s+|def\s+|class\s+|function\s+|const\s+|let\s+|var\s+|if\s*\(|for\s*\(|while\s*\(|SELECT\s+|INSERT\s+|UPDATE\s+|DELETE\s+|<\?php)",
                re.IGNORECASE,
            )
            marker_lines = 0
            for line in lines:
                if code_line_re.search(line) or ("{" in line and "}" in line) or line.rstrip().endswith(";"):
                    marker_lines += 1

            if marker_lines / len(lines) >= 0.25:
                raise ValueError("Content looks like source code. Only business knowledge text/URLs are allowed.")

        if stripped.count("```") >= 2:
            raise ValueError("Markdown code blocks are not allowed in ingested content.")


ingestion_service = IngestionService()
