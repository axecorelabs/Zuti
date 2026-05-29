from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import json
from app.services.llm_service import DEFAULT_MODEL, llm_service

router = APIRouter()

LANGUAGE_CLASSIFIER_PROMPT = """You classify user language preference for support conversations.
Return strict JSON only with keys:
- detected_language_code: ISO-639-1 language code in lowercase (for example: en, es, fr, ar, pt, hi, sw)
- confidence: number between 0 and 1
- explicit_preference: boolean
- requested_language_code: ISO-639-1 code when user explicitly asks to use a language, otherwise null

Rules:
- Detect the language of the user's latest message.
- explicit_preference=true only when the user directly asks to switch or continue in a specific language.
- If explicit_preference=false, requested_language_code must be null.
- If uncertain, set detected_language_code to "en" and confidence <= 0.4.
- Output JSON only. No markdown.
"""


class LanguageClassificationRequest(BaseModel):
    user_message: str
    current_language_code: str | None = None
    model: str = DEFAULT_MODEL


class LanguageClassificationResponse(BaseModel):
    detected_language_code: str
    confidence: float = 0.0
    explicit_preference: bool = False
    requested_language_code: str | None = None


@router.post("/classify", response_model=LanguageClassificationResponse)
async def classify_language(request: LanguageClassificationRequest):
    try:
        message = request.user_message.strip()
        prompt_parts = [f"User message:\n{message}"]
        if request.current_language_code:
            prompt_parts.append(f"Current language code:\n{request.current_language_code.strip().lower()}")

        raw = await llm_service.complete(
            system_prompt=LANGUAGE_CLASSIFIER_PROMPT,
            user_message="\n\n".join(prompt_parts),
            max_tokens=120,
            model=request.model,
        )

        parsed = json.loads((raw or "").strip())
        detected = str(parsed.get("detected_language_code", "en")).strip().lower() or "en"
        confidence = float(parsed.get("confidence", 0.0))
        explicit = bool(parsed.get("explicit_preference", False))
        requested_raw = parsed.get("requested_language_code")
        requested = str(requested_raw).strip().lower() if isinstance(requested_raw, str) and requested_raw.strip() else None

        if len(detected) > 5:
            detected = detected[:5]
        if requested and len(requested) > 5:
            requested = requested[:5]

        if confidence < 0:
            confidence = 0.0
        if confidence > 1:
            confidence = 1.0

        if not explicit:
            requested = None

        return LanguageClassificationResponse(
            detected_language_code=detected,
            confidence=confidence,
            explicit_preference=explicit,
            requested_language_code=requested,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
