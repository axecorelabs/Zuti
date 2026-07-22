from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
import re
from app.services.rag_service import rag_service
from app.core.config import settings

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
    customer_context: str | None = None
    action_forwarding_enabled: bool = False
    conversation_summary: str | None = None
    use_tools: bool = False
    enabled_tools: list[str] = Field(default_factory=list)
    channel: str = "TELEGRAM"
    # Legacy operational truth fields — kept for backward compat, no longer used
    forwarding_status: str | None = None
    forwarding_reason: str | None = None
    action_task_id: str | None = None
    can_claim_completed: bool | None = None
    missing_fields: list[str] = Field(default_factory=list)
    blocked_capability: str | None = None
    claim_level: str | None = None
    delivery_status: str | None = None
    operational_truth: dict | None = None
    risk_profile: dict | None = None
    needs_verifier: bool | None = None


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str
    sources: list[dict] = Field(default_factory=list)
    should_resolve: bool = False
    answerability: str = "unknown"
    confidence: float = 0.5
    should_escalate: bool = False
    escalation_topic: str | None = None
    # Unified intent + summary fields (populated when action_forwarding_enabled=True)
    action_type: str = "NONE"
    intent_confidence: float = 0.0
    intent_summary: str = ""
    conversation_summary: str = ""
    registration_product_id: str = ""
    collected_fields: dict = Field(default_factory=dict)
    # Agentic tool-use path outputs
    registration_handled: bool = False
    action_handled: bool = False
    payment_url: str = ""


@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest, x_internal_key: str | None = Header(default=None)):
    if not settings.INTERNAL_API_SECRET or x_internal_key != settings.INTERNAL_API_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        reply, sources, assessment, chat_meta = await rag_service.chat(
            organization_id=request.organization_id,
            bot_id=request.bot_id,
            conversation_id=request.conversation_id,
            message=request.message,
            history=[{"role": m.role, "content": m.content} for m in request.history],
            bot_name=request.bot_name,
            org_name=request.org_name,
            system_prompt=request.system_prompt,
            customer_context=request.customer_context,
            action_forwarding_enabled=request.action_forwarding_enabled,
            conversation_summary=request.conversation_summary,
            use_tools=request.use_tools,
            enabled_tools=request.enabled_tools,
            channel=request.channel,
            forwarding_status=request.forwarding_status,
            forwarding_reason=request.forwarding_reason,
            action_task_id=request.action_task_id,
            can_claim_completed=request.can_claim_completed,
            missing_fields=request.missing_fields,
            blocked_capability=request.blocked_capability,
            claim_level=request.claim_level,
            delivery_status=request.delivery_status,
            operational_truth=request.operational_truth,
            risk_profile=request.risk_profile,
            needs_verifier=request.needs_verifier,
        )
        # In structured mode, should_resolve comes from chat_meta; in standard mode, detect the tag
        # Always strip [RESOLVED] tag — in structured mode should_resolve comes from JSON,
        # but the AI may still emit the tag inside the reply field per RESOLUTION_TAG_INSTRUCTION.
        clean_reply = re.sub(r'\[\s*resolved\s*\]', '', reply, flags=re.IGNORECASE).rstrip()
        if request.action_forwarding_enabled or request.use_tools:
            should_resolve = bool(chat_meta.get("should_resolve"))
        else:
            should_resolve = re.search(r'\[\s*resolved\s*\]', reply, re.IGNORECASE) is not None

        return ChatResponse(
            reply=clean_reply,
            conversation_id=request.conversation_id,
            sources=sources,
            should_resolve=should_resolve,
            answerability=assessment.get("answerability", "unknown"),
            confidence=assessment.get("confidence", 0.5),
            should_escalate=assessment.get("should_escalate", False),
            escalation_topic=assessment.get("escalation_topic"),
            action_type=chat_meta.get("action_type") or "NONE",
            intent_confidence=chat_meta.get("intent_confidence") or 0.0,
            intent_summary=chat_meta.get("intent_summary") or "",
            conversation_summary=chat_meta.get("conversation_summary") or "",
            registration_product_id=chat_meta.get("registration_product_id") or "",
            collected_fields=chat_meta.get("collected_fields") or {},
            registration_handled=bool(chat_meta.get("registration_handled")),
            action_handled=bool(chat_meta.get("action_handled")),
            payment_url=chat_meta.get("payment_url") or "",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
