from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import re
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
    history: list[HistoryMessage] = Field(default_factory=list)
    bot_name: str = "Assistant"
    org_name: str | None = None
    system_prompt: str | None = None
    customer_context: str | None = None  # summaries of previous conversations with this customer
    forwarding_status: str | None = None
    forwarding_reason: str | None = None
    action_task_id: str | None = None
    can_claim_completed: bool | None = None
    missing_fields: list[str] = Field(default_factory=list)
    blocked_capability: str | None = None
    claim_level: str | None = None
    delivery_status: str | None = None
    operational_truth: dict | None = None


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str
    sources: list[dict] = Field(default_factory=list)
    should_resolve: bool = False
    answerability: str = "unknown"
    confidence: float = 0.5
    should_escalate: bool = False
    escalation_topic: str | None = None


@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        reply, sources, assessment = await rag_service.chat(
            organization_id=request.organization_id,
            bot_id=request.bot_id,
            conversation_id=request.conversation_id,
            message=request.message,
            history=[{"role": m.role, "content": m.content} for m in request.history],
            bot_name=request.bot_name,
            org_name=request.org_name,
            system_prompt=request.system_prompt,
            customer_context=request.customer_context,
            forwarding_status=request.forwarding_status,
            forwarding_reason=request.forwarding_reason,
            action_task_id=request.action_task_id,
            can_claim_completed=request.can_claim_completed,
            missing_fields=request.missing_fields,
            blocked_capability=request.blocked_capability,
            claim_level=request.claim_level,
            delivery_status=request.delivery_status,
            operational_truth=request.operational_truth,
        )
        # Strip [RESOLVED] token from the reply text; surface it as a flag
        should_resolve = re.search(r'\[\s*resolved\s*\]', reply, re.IGNORECASE) is not None
        clean_reply = re.sub(r'\[\s*resolved\s*\]', '', reply, flags=re.IGNORECASE).rstrip()
        return ChatResponse(
            reply=clean_reply,
            conversation_id=request.conversation_id,
            sources=sources,
            should_resolve=should_resolve,
            answerability=assessment.get("answerability", "unknown"),
            confidence=assessment.get("confidence", 0.5),
            should_escalate=assessment.get("should_escalate", False),
            escalation_topic=assessment.get("escalation_topic"),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
