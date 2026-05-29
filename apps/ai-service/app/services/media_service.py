"""
Media processing service — transcribes audio, describes images, extracts document text.
Designed so the Node API can send base64 content and get back usable text for AI context.
"""
from __future__ import annotations

import base64
import io
import logging
from pathlib import Path
from app.core.config import settings

logger = logging.getLogger(__name__)

_WHISPER_SUPPORTED_MIMES = {
    "audio/ogg", "audio/oga", "audio/mp4", "audio/mpeg", "audio/mp3",
    "audio/wav", "audio/webm", "audio/flac", "audio/m4a", "audio/aac",
    "video/ogg",  # WhatsApp voice notes come as audio/ogg or video/ogg
}

_WHISPER_EXTENSION_MAP = {
    "audio/ogg": "ogg", "audio/oga": "ogg", "audio/mp4": "mp4",
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav",
    "audio/webm": "webm", "audio/flac": "flac", "audio/m4a": "m4a",
    "audio/aac": "aac", "video/ogg": "ogg",
}


class MediaService:
    # ── Audio / Voice ────────────────────────────────────────────────────────

    async def transcribe_audio(self, content_bytes: bytes, mime_type: str, filename: str | None) -> str | None:
        """Transcribe audio bytes using a configurable Whisper-compatible endpoint (Groq, OpenAI, etc.)."""
        # Prefer dedicated WHISPER_API_KEY; fall back to OPENAI_API_KEY
        api_key = settings.WHISPER_API_KEY.strip() or settings.OPENAI_API_KEY.strip()
        if not api_key:
            logger.warning("No Whisper API key configured (WHISPER_API_KEY or OPENAI_API_KEY) — audio transcription skipped")
            return None

        base_url = (settings.WHISPER_API_BASE_URL or "https://api.openai.com/v1").rstrip("/")
        model = settings.WHISPER_MODEL or "whisper-1"
        ext = _WHISPER_EXTENSION_MAP.get(mime_type.lower().split(";")[0].strip(), "ogg")
        safe_name = filename or f"audio.{ext}"

        import httpx
        async with httpx.AsyncClient(timeout=60) as http:
            response = await http.post(
                f"{base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={
                    "file": (safe_name, io.BytesIO(content_bytes), mime_type),
                },
                data={"model": model},
            )

        if not response.is_success:
            logger.warning("Whisper transcription failed (%d): %s", response.status_code, response.text[:200])
            return None

        result = response.json()
        return result.get("text") or None

    # ── Image ────────────────────────────────────────────────────────────────

    async def describe_image(self, content_bytes: bytes, mime_type: str) -> str | None:
        """Get a description of an image using an OpenRouter vision model."""
        api_key = settings.OPENROUTER_API_KEY.strip()
        if not api_key:
            logger.warning("OPENROUTER_API_KEY is not configured — image description skipped")
            return None

        # Normalize source images to improve provider compatibility.
        # Keep animated GIFs unchanged; convert other formats (including HEIC/HEIF) to JPEG.
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
            from PIL import Image as PILImage

            img = PILImage.open(io.BytesIO(content_bytes))
            img.load()
            image_format = (img.format or "").upper()
            if image_format == "GIF" and getattr(img, "is_animated", False):
                mime_type = "image/gif"
            else:
                buf = io.BytesIO()
                img.convert("RGB").save(buf, format="JPEG", quality=90)
                content_bytes = buf.getvalue()
                mime_type = "image/jpeg"
        except Exception as _e:
            logger.warning("Image normalization failed: %s — sending raw bytes to vision model", _e)

        b64 = base64.b64encode(content_bytes).decode("ascii")
        data_uri = f"data:{mime_type};base64,{b64}"
        models_to_try: list[str] = []
        configured_model = (settings.MEDIA_VISION_MODEL or "").strip()
        if configured_model:
            models_to_try.append(configured_model)
        # Fallback to an image-focused model if the configured model is unavailable/rejected.
        if "google/gemini-2.5-flash-image" not in models_to_try:
            models_to_try.append("google/gemini-2.5-flash-image")

        import httpx
        async with httpx.AsyncClient(timeout=30) as http:
            for model in models_to_try:
                response = await http.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "image_url",
                                        "image_url": {"url": data_uri},
                                    },
                                    {
                                        "type": "text",
                                        "text": (
                                            "Describe this image concisely for a customer service AI. "
                                            "Focus on what the customer is likely showing or asking about. "
                                            "If it contains text (e.g. a screenshot, form, invoice, label), "
                                            "include all visible text verbatim."
                                        ),
                                    },
                                ],
                            }
                        ],
                        "max_tokens": 512,
                    },
                )

                if response.is_success:
                    result = response.json()
                    return result.get("choices", [{}])[0].get("message", {}).get("content") or None

                logger.warning(
                    "Vision model request failed for %s (%d): %s",
                    model,
                    response.status_code,
                    response.text[:200],
                )

        return None

    # ── Documents ────────────────────────────────────────────────────────────

    def extract_document_text(self, content_bytes: bytes, mime_type: str, filename: str | None) -> str | None:
        """Extract readable text from PDF or DOCX files."""
        lower_name = (filename or "").lower()
        lower_mime = (mime_type or "").lower()

        if lower_name.endswith(".pdf") or "pdf" in lower_mime:
            return self._extract_pdf(content_bytes)
        elif lower_name.endswith(".docx") or "wordprocessing" in lower_mime or "officedocument" in lower_mime:
            return self._extract_docx(content_bytes)
        elif lower_mime.startswith("text/") or lower_name.endswith((".txt", ".csv", ".md")):
            try:
                return content_bytes.decode("utf-8", errors="ignore")[:4000]
            except Exception:
                return None
        return None

    def _extract_pdf(self, content_bytes: bytes) -> str | None:
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(content_bytes))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
            return text.strip()[:4000] or None
        except Exception as e:
            logger.warning("PDF text extraction failed: %s", e)
            return None

    def _extract_docx(self, content_bytes: bytes) -> str | None:
        try:
            import docx
            doc = docx.Document(io.BytesIO(content_bytes))
            text = "\n".join(p.text for p in doc.paragraphs)
            return text.strip()[:4000] or None
        except Exception as e:
            logger.warning("DOCX text extraction failed: %s", e)
            return None

    # ── Dispatch ─────────────────────────────────────────────────────────────

    async def process(
        self,
        content_bytes: bytes,
        mime_type: str,
        filename: str | None,
    ) -> dict:
        """
        Process media bytes and return extracted content.
        Returns: { kind, text, error }
        """
        lower_mime = (mime_type or "").lower().split(";")[0].strip()

        # Some channels send generic mime_type (application/octet-stream) for images.
        # Recover likely image mime from filename extension so vision can still run.
        if lower_mime in ("", "application/octet-stream") and filename:
            suffix = Path(filename).suffix.lower()
            ext_map = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".gif": "image/gif",
                ".webp": "image/webp",
                ".bmp": "image/bmp",
                ".heic": "image/heic",
                ".heif": "image/heif",
            }
            lower_mime = ext_map.get(suffix, lower_mime)

        if lower_mime.startswith("audio/") or lower_mime == "video/ogg":
            transcript = await self.transcribe_audio(content_bytes, lower_mime, filename)
            if transcript:
                return {"kind": "transcript", "text": transcript.strip(), "error": None}
            return {"kind": "transcript", "text": None, "error": "transcription unavailable"}

        if lower_mime.startswith("image/"):
            description = await self.describe_image(content_bytes, lower_mime)
            if description:
                clean = description.strip()
                if clean:
                    return {"kind": "image_description", "text": clean, "error": None}
                return {"kind": "image_description", "text": None, "error": "vision returned empty text"}
            return {"kind": "image_description", "text": None, "error": "vision unavailable"}

        if (
            lower_mime in ("application/pdf", "application/msword")
            or "officedocument" in lower_mime
            or lower_mime.startswith("text/")
        ):
            extracted = self.extract_document_text(content_bytes, lower_mime, filename)
            if extracted:
                return {"kind": "document_text", "text": extracted, "error": None}
            return {"kind": "document_text", "text": None, "error": "extraction produced no text"}

        return {
            "kind": "unsupported",
            "text": None,
            "error": f"unsupported mime_type: {lower_mime or 'unknown'} (filename={filename or 'n/a'})",
        }


media_service = MediaService()
