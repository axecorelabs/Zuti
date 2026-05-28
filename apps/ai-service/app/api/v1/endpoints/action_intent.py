from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import json
from app.services.llm_service import DEFAULT_MODEL, llm_service

router = APIRouter()

ACTION_INTENT_PROMPT = """You classify whether a customer message should create an external action-forwarding task.
You must return a strict JSON object only, with these keys:
- action_type: one of [MEETING_REQUEST, CONSULTATION_REQUEST, SALES_ORDER_REQUEST, OWNER_ATTENTION_NEEDED, TECHNICAL_ISSUE, NONE]
- confidence: number between 0 and 1
- summary: short string summary

Classification guide:
- MEETING_REQUEST: user asks to schedule/book a meeting or call with owner/team.
- CONSULTATION_REQUEST: user asks for a consultation, demo, sales discussion, implementation/integration discussion, or wants a specialist to contact them about services.
- SALES_ORDER_REQUEST: user clearly expresses buying/order intent.
- OWNER_ATTENTION_NEEDED: user explicitly asks owner/management involvement or urgent leadership attention.
- TECHNICAL_ISSUE: user reports breakage, outage, bug, or technical malfunction needing follow-up.
- NONE: no actionable forwarding intent.

Rules:
- If uncertain, prefer NONE.
- Do not include markdown or any text outside the JSON object.
"""


class ActionIntentRequest(BaseModel):
    user_message: str
    model: str = DEFAULT_MODEL


class ActionIntentResponse(BaseModel):
    action_type: str
    confidence: float = 0.0
    summary: str = ""


@router.post("/classify", response_model=ActionIntentResponse)
async def classify_action_intent(request: ActionIntentRequest):
    try:
        raw = await llm_service.complete(
            system_prompt=ACTION_INTENT_PROMPT,
            user_message=request.user_message.strip(),
            max_tokens=180,
            model=request.model,
        )

        parsed = json.loads((raw or "").strip())
        action_type = str(parsed.get("action_type", "NONE")).strip().upper()
        confidence = float(parsed.get("confidence", 0.0))
        summary = str(parsed.get("summary", "")).strip()

        allowed = {
            "MEETING_REQUEST",
            "CONSULTATION_REQUEST",
            "SALES_ORDER_REQUEST",
            "OWNER_ATTENTION_NEEDED",
            "TECHNICAL_ISSUE",
            "NONE",
        }
        if action_type not in allowed:
            action_type = "NONE"
        if confidence < 0:
            confidence = 0.0
        if confidence > 1:
            confidence = 1.0
        if not summary:
            summary = "No actionable forwarding intent detected." if action_type == "NONE" else "Actionable customer intent detected."

        return ActionIntentResponse(
            action_type=action_type,
            confidence=confidence,
            summary=summary,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
