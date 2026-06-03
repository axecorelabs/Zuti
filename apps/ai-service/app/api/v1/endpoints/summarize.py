from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from app.services.llm_service import llm_service
from app.core.config import settings

router = APIRouter()


class SummarizeRequest(BaseModel):
    messages: list[dict]  # [{"role": "user"|"assistant"|"agent", "content": str}]
    org_name: str | None = None


class SummarizeResponse(BaseModel):
    summary: str


@router.post("", response_model=SummarizeResponse)
async def summarize(request: SummarizeRequest, x_internal_key: str | None = Header(default=None)):
    if not settings.INTERNAL_API_SECRET or x_internal_key != settings.INTERNAL_API_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        transcript_parts: list[str] = []
        for msg in request.messages[-30:]:
            role = msg.get("role", "")
            content = (msg.get("content") or "").strip()
            if not content:
                continue
            if role == "user":
                transcript_parts.append(f"Customer: {content}")
            elif role in ("assistant", "agent"):
                transcript_parts.append(f"Support: {content}")

        if not transcript_parts:
            return SummarizeResponse(summary="")

        transcript = "\n".join(transcript_parts)
        org = request.org_name or "the organization"

        summary = await llm_service.complete(
            system_prompt=(
                f"You are a customer service supervisor for {org}. "
                "Summarize the following support conversation in 2-3 concise sentences for a human agent "
                "who is about to take over. Cover: what the customer needs, what has already been "
                "discussed or tried, and any key details the agent should know immediately."
            ),
            user_message=f"Conversation:\n\n{transcript}\n\nHandoff summary:",
            max_tokens=200,
        )
        return SummarizeResponse(summary=summary.strip())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
