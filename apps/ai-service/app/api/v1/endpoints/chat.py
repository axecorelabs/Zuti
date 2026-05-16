from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.rag_service import rag_service

router = APIRouter()


class ChatRequest(BaseModel):
    conversation_id: str
    organization_id: str
    bot_id: str
    message: str


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str
    sources: list[dict] = []


@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        reply, sources = await rag_service.chat(
            organization_id=request.organization_id,
            bot_id=request.bot_id,
            conversation_id=request.conversation_id,
            message=request.message,
        )
        return ChatResponse(
            reply=reply,
            conversation_id=request.conversation_id,
            sources=sources,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
