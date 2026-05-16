from fastapi import APIRouter
from app.services.rag_service import rag_service
from pydantic import BaseModel

router = APIRouter()


@router.get("")
async def health():
    qdrant_ok = await rag_service.health_check()
    return {
        "status": "ok",
        "qdrant": "ok" if qdrant_ok else "unavailable",
    }
