from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
import base64
from app.services.media_service import media_service
from app.core.config import settings

router = APIRouter()


class MediaProcessRequest(BaseModel):
    content_base64: str
    mime_type: str
    filename: str | None = None


class MediaProcessResponse(BaseModel):
    kind: str          # transcript | image_description | document_text | unsupported
    text: str | None   # extracted content, or None if unavailable / skipped
    error: str | None  # non-fatal reason when text is None


@router.post("/process", response_model=MediaProcessResponse)
async def process_media(request: MediaProcessRequest, x_internal_key: str | None = Header(default=None)):
    if settings.INTERNAL_API_SECRET and x_internal_key != settings.INTERNAL_API_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not settings.MEDIA_PROCESSING_ENABLED:
        return MediaProcessResponse(kind="disabled", text=None, error="media processing is disabled")

    try:
        content_bytes = base64.b64decode(request.content_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 content")

    if len(content_bytes) > 25 * 1024 * 1024:  # 25 MB hard cap
        raise HTTPException(status_code=413, detail="Media content exceeds 25 MB limit")

    result = await media_service.process(content_bytes, request.mime_type, request.filename)
    return MediaProcessResponse(**result)
