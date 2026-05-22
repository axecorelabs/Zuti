from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.llm_service import DEFAULT_MODEL, llm_service

router = APIRouter()

CSAT_CLASSIFIER_PROMPT = """You classify customer replies to a satisfaction-check or closing support message.
You are given the assistant's immediately preceding message and the customer's reply.
Interpret the customer's meaning semantically, not just lexically.
Support any language.
Return exactly one lowercase label and nothing else:
positive
negative
unclear

Use positive when the customer is confirming the issue is resolved, politely closing the conversation, expressing satisfaction, or indicating they need nothing else.
Use negative when the customer indicates the issue is not solved, they still need help, they are dissatisfied, or they are asking to continue troubleshooting.
Use unclear when the intent is ambiguous or the reply is unrelated to satisfaction/closure.
"""


class CsatClassificationRequest(BaseModel):
    user_message: str
    last_assistant_message: str | None = None
    model: str = DEFAULT_MODEL


class CsatClassificationResponse(BaseModel):
    intent: str
    confidence: float = 0.5


@router.post("/classify", response_model=CsatClassificationResponse)
async def classify_csat(request: CsatClassificationRequest):
    try:
        prompt_parts = []
        if request.last_assistant_message:
            prompt_parts.append(f"Assistant message:\n{request.last_assistant_message.strip()}")
        prompt_parts.append(f"Customer reply:\n{request.user_message.strip()}")
        raw = await llm_service.complete(
            system_prompt=CSAT_CLASSIFIER_PROMPT,
            user_message="\n\n".join(prompt_parts),
            max_tokens=8,
            model=request.model,
        )
        intent = "".join(ch for ch in (raw or "").strip().lower() if ch.isalpha())
        if intent not in {"positive", "negative", "unclear"}:
            intent = "unclear"
        confidence = 0.9 if intent != "unclear" else 0.5
        return CsatClassificationResponse(intent=intent, confidence=confidence)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
