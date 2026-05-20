from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.rag_service import rag_service

router = APIRouter()


class HistoryMessage(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str


class ChatRequest(BaseModel):
    conversation_id: str
    organization_id: str
    bot_id: str
    message: str
    history: list[HistoryMessage] = []
    bot_name: str = "Assistant"
    org_name: str | None = None
    system_prompt: str | None = None
    customer_context: str | None = None  # summaries of previous conversations with this customer


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str
    sources: list[dict] = []
    should_resolve: bool = False


@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        reply, sources = await rag_service.chat(
            organization_id=request.organization_id,
            bot_id=request.bot_id,
            conversation_id=request.conversation_id,
            message=request.message,
            history=[{"role": m.role, "content": m.content} for m in request.history],
            bot_name=request.bot_name,
            org_name=request.org_name,
            system_prompt=request.system_prompt,
            customer_context=request.customer_context,
        )
        # Strip [RESOLVED] token from the reply text; surface it as a flag
        should_resolve = '[RESOLVED]' in reply
        clean_reply = reply.replace('[RESOLVED]', '').rstrip()
        return ChatResponse(
            reply=clean_reply,
            conversation_id=request.conversation_id,
            sources=sources,
            should_resolve=should_resolve,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
