"""
LLM service — routes all completions through OpenRouter.
Uses the OpenAI-compatible SDK; swap `model` to any OpenRouter-supported model.
"""
from __future__ import annotations
import logging
from openai import AsyncOpenAI
from app.core.config import settings
import json
import re
from typing import Any

logger = logging.getLogger(__name__)

# Default model — change to any model slug on https://openrouter.ai/models
DEFAULT_MODEL = "google/gemini-2.5-flash"

RESOLUTION_TAG_INSTRUCTION = (
    "IMPORTANT: When you are confident the customer's issue is fully resolved, "
    "end your reply naturally by asking if they are satisfied or need anything else "
    "(e.g. \"Does that help?\" or \"Is there anything else I can help you with?\"), "
    "then append [RESOLVED] on its own line at the very end. "
    "Only use [RESOLVED] when the issue is genuinely resolved — not speculatively."
)

BASE_SYSTEM_PROMPT = """You are {bot_name}, a helpful customer service AI assistant for {org_name}.
Use the provided context to answer questions accurately and concisely.
If the context doesn't contain relevant information, do not invent operational facts.
For account, booking, order, ticket, escalation, delivery, or "system check" questions, only state what is explicitly confirmed in provided context.
If confirmation is missing, say you cannot verify from here and ask for a verifiable reference (for example: booking id, ticket id, or conversation context).
Never claim you checked internal systems, records, databases, or customer-specific status unless that check result is explicitly provided in context.
Keep responses friendly and professional. Do not mention that you are an AI unless directly asked.
Keep replies short by default: answer directly first, use 1-3 short paragraphs, and ask only one clarifying question unless a configured workflow requires multiple missing fields.
IMPORTANT: Reply in plain text only. Do not use markdown formatting such as headers (##), bold (**), italics, bullet lists with *, or horizontal rules (---). Use short paragraphs or simple numbered lists (1. 2. 3.) if needed.
"""

OPERATIONAL_CLAIM_CUES = (
    "logged",
    "noted",
    "submitted",
    "queued",
    "forwarded",
    "routed",
    "delivered",
    "acknowledged",
    "completed",
    "sent to",
    "created a request",
    "team will reach out",
    "team has received",
    "sales team will",
    "owner has been notified",
    "i checked",
    "i can confirm",
)


def _build_system_prompt(
    bot_name: str,
    org_name: str | None,
    override: str | None,
) -> str:
    base = BASE_SYSTEM_PROMPT.format(
        bot_name=bot_name,
        org_name=org_name or "our company",
    )
    if override and override.strip():
        # Always keep base safety constraints; append custom behavior after it.
        return f"{base}\n\nAdditional bot instructions:\n{override.strip()}\n\n{RESOLUTION_TAG_INSTRUCTION}"
    return f"{base}\n\n{RESOLUTION_TAG_INSTRUCTION}"


class LlmService:
    def _client(self) -> AsyncOpenAI:
        return AsyncOpenAI(
            api_key=settings.OPENROUTER_API_KEY,
            base_url="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "https://zuti.app",
                "X-Title": "Zuti",
            },
        )

    async def generate(
        self,
        user_message: str,
        context: str = "",
        conversation_id: str = "",
        history: list[dict] | None = None,
        model: str = DEFAULT_MODEL,
        bot_name: str = "Assistant",
        org_name: str | None = None,
        system_prompt_override: str | None = None,
        customer_context: str | None = None,
    ) -> str:
        if not settings.OPENROUTER_API_KEY:
            logger.warning("OPENROUTER_API_KEY not set — returning fallback response")
            return "I'm sorry, I'm not configured to respond yet. Please contact support."

        prompt = _build_system_prompt(bot_name, org_name, system_prompt_override)
        messages: list[dict] = [{"role": "system", "content": prompt}]
        if context:
            messages.append({
                "role": "system",
                "content": f"Relevant context from knowledge base:\n{context}",
            })
        if customer_context:
            messages.append({
                "role": "system",
                "content": f"Customer history (for context only — do not mention this to the customer unless directly relevant):\n{customer_context}",
            })
        # Inject conversation history so the AI has full context
        for turn in (history or []):
            if turn.get("role") in ("user", "assistant") and turn.get("content"):
                messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": user_message})

        response = await self._client().chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=520,
            temperature=0.2,
        )
        return response.choices[0].message.content or ""

    async def complete(
        self,
        system_prompt: str,
        user_message: str,
        max_tokens: int = 300,
        model: str = DEFAULT_MODEL,
    ) -> str:
        """Simple completion with explicit system + user prompt (no RAG, no history)."""
        if not settings.OPENROUTER_API_KEY:
            return ""
        response = await self._client().chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            max_tokens=max_tokens,
            temperature=0.3,
        )
        return response.choices[0].message.content or ""

    def _extract_json_object(self, text: str) -> dict[str, Any] | None:
        raw = (text or "").strip()
        if not raw:
            return None

        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            pass

        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None

    async def enforce_operational_integrity(
        self,
        draft_reply: str,
        operational_truth: dict[str, Any] | None = None,
        model: str = DEFAULT_MODEL,
        force: bool = False,
    ) -> str:
        if not settings.OPENROUTER_API_KEY:
            return draft_reply

        truth = operational_truth or {}
        forwarding_status = str(truth.get("forwarding_status") or "NO_INTENT").upper()
        lower_reply = (draft_reply or "").lower()
        has_operational_claim_language = any(cue in lower_reply for cue in OPERATIONAL_CLAIM_CUES)

        # Skip verifier when this turn has no operational context and no claim-like language.
        if not force and forwarding_status == "NO_INTENT" and not has_operational_claim_language:
            return draft_reply

        verifier_system_prompt = (
            "You are an operational-integrity verifier for customer support replies. "
            "You must prevent false claims about actions, submissions, bookings, notifications, or system checks. "
            "Return JSON only with keys: needs_rewrite (boolean), safe_reply (string), reason (string)."
        )

        verifier_user_prompt = (
            "Operational truth for this turn:\n"
            f"{json.dumps(truth, ensure_ascii=True)}\n\n"
            "Draft assistant reply:\n"
            f"{draft_reply}\n\n"
            "Rewrite rules:\n"
            "1) If can_claim_completed=false, do not state or imply the request was logged/submitted/queued/forwarded/created.\n"
            "2) If can_claim_completed=true, you may state only that a request was logged for review in this conversation.\n"
            "3) Never claim downstream delivery/receipt by owner/team, booking completion, payment completion, or external execution unless explicitly confirmed in operational truth.\n"
            "4) If delivery_status is SENT_TO_CHANNEL, you may say it was sent to the configured team channel, but not that a human received or acknowledged it.\n"
            "5) If delivery_status is not DELIVERED_TO_TEAM, ACKNOWLEDGED_BY_AGENT, or COMPLETED, do not imply the team has received or will definitely act on it.\n"
            "6) Never claim system lookup/check/verification unless explicitly confirmed.\n"
            "7) Avoid repetitive disclaimers; keep the final reply concise and natural.\n"
            "8) Preserve user-helpful next steps.\n"
            "Respond with JSON only."
        )

        verdict_raw = await self.complete(
            system_prompt=verifier_system_prompt,
            user_message=verifier_user_prompt,
            max_tokens=500,
            model=model,
        )
        verdict = self._extract_json_object(verdict_raw)
        if not verdict:
            can_claim_completed = bool(truth.get("can_claim_completed"))
            delivery_status = str(truth.get("delivery_status") or "").upper()
            if has_operational_claim_language and (
                not can_claim_completed
                or delivery_status not in {"DELIVERED_TO_TEAM", "SENT_TO_CHANNEL"}
            ):
                return (
                    "I cannot confirm that operational action was completed from this turn. "
                    "I can help collect required details or route this to a human teammate."
                )
            return draft_reply

        needs_rewrite = bool(verdict.get("needs_rewrite"))
        safe_reply = str(verdict.get("safe_reply") or "").strip()
        if needs_rewrite:
            if safe_reply:
                return safe_reply
            return (
                "I cannot confirm that operational action was completed from this turn. "
                "I can help collect required details or route this to a human teammate."
            )
        return draft_reply


llm_service = LlmService()
