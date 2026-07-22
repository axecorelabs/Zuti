"""
LLM service — routes all completions through OpenRouter.
Uses the OpenAI-compatible SDK; swap `model` to any OpenRouter-supported model.
"""
from __future__ import annotations
import logging
import httpx
from openai import AsyncOpenAI
from app.core.config import settings
import json
import re
from typing import Any

logger = logging.getLogger(__name__)

# ── Agentic tool definitions ────────────────────────────────────────────────────
# The model calls these; the backend executes them and returns real results. This is
# how the model acts on the world without hallucinating outcomes — it only states what
# a tool actually returned.
REGISTER_FOR_EVENT_TOOL = {
    "type": "function",
    "function": {
        "name": "register_for_event",
        "description": (
            "Register the customer for one of the events in the available registrations context. "
            "Call this ONLY once you have the customer's full name, email, and every required field "
            "for the chosen event. It performs the real registration (capacity, dedup, payment) and "
            "returns the actual result — including a payment link for paid events. Do not claim a "
            "registration succeeded unless this tool returns a success outcome."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "product_id": {"type": "string", "description": "The exact 'ID:' of the event from the available registrations context."},
                "quantity": {"type": "integer", "description": "Number of tickets/spots the customer wants. Default 1."},
                "customer_name": {"type": "string", "description": "The customer's full name."},
                "customer_email": {"type": "string", "description": "The customer's email address. Never invent or auto-complete this."},
                "fields": {
                    "type": "object",
                    "description": "Any additional event-specific fields, keyed by their exact field key (e.g. phone_number).",
                    "additionalProperties": {"type": "string"},
                },
            },
            "required": ["product_id", "customer_name", "customer_email"],
        },
    },
}

# Default model — change to any model slug on https://openrouter.ai/models
DEFAULT_MODEL = "google/gemini-2.5-flash"

ACTION_TYPE_VALUES = (
    "NONE",
    "MEETING_REQUEST",
    "CONSULTATION_REQUEST",
    "SALES_ORDER_REQUEST",
    "TECHNICAL_ISSUE",
    "OWNER_ATTENTION_NEEDED",
    "REGISTRATION_REQUEST",
)

STRUCTURED_OUTPUT_SCHEMA = """\
You must respond with a valid JSON object only — no markdown fences, no extra text.

JSON schema (all fields required):
{
  "reply": "<complete natural customer-facing response>",
  "should_resolve": <true if the customer's issue is fully resolved, false otherwise>,
  "action_type": "<one of: NONE | MEETING_REQUEST | CONSULTATION_REQUEST | SALES_ORDER_REQUEST | TECHNICAL_ISSUE | OWNER_ATTENTION_NEEDED | REGISTRATION_REQUEST>",
  "intent_confidence": <float 0.0–1.0>,
  "intent_summary": "<1–2 sentence synthesis of the customer's intent drawn from the full conversation — empty string when action_type is NONE>",
  "conversation_summary": "<concise running summary of the conversation so far including this turn — always populated>",
  "registration_product_id": "<the ID of the registration product when action_type is REGISTRATION_REQUEST, otherwise empty string>",
  "collected_fields": <object mapping field keys to the values gathered so far when action_type is REGISTRATION_REQUEST — see registration rules below; empty object {} otherwise>
}

Intent classification guide:
- MEETING_REQUEST: customer wants to book/schedule a call or meeting.
- CONSULTATION_REQUEST: customer wants a demo, consultation, or specialist follow-up.
- SALES_ORDER_REQUEST: customer clearly expresses intent to buy/order.
- OWNER_ATTENTION_NEEDED: customer explicitly requests owner or management involvement.
- TECHNICAL_ISSUE: customer has a specific, describable technical problem that needs human follow-up. See qualification rules below.
- REGISTRATION_REQUEST: customer wants to register for an event, session, or other registerable product listed in the available registrations. Only use this when a matching registration product exists.
- NONE: no actionable forwarding intent, or issue is not yet specific enough to forward.

REGISTRATION_REQUEST field collection — CRITICAL for completing registrations:
- When action_type is REGISTRATION_REQUEST, set registration_product_id to the exact "ID:" value shown for the matching product in the available registrations context.
- Populate collected_fields with every registration value the customer has provided across the ENTIRE conversation so far — not just this turn. Each product lists its fields with a "(key: <field_key>)" marker; use that exact field_key as the JSON key.
- Always include the standard keys "customer_name" and "customer_email" when the customer has given them, plus every product-specific field key.
- Extract values regardless of how the customer phrased them: bare ("Olaiya Oluwasomidotun"), labeled ("Name: Olaiya", "Number: 08025738429"), or inline ("my email is x@y.com"). You are the extractor — do not rely on any downstream parsing.
- Only include a key once you actually have a real value for it; omit keys you are still waiting on. Never invent, guess, or auto-complete values (e.g. do not append a domain to a partial email).
- Keep collected_fields populated on every REGISTRATION_REQUEST turn, cumulatively, so the backend always sees the full known set.

TECHNICAL_ISSUE qualification — only classify as TECHNICAL_ISSUE when ALL of the following are true:
1. The specific feature, page, or action that is broken is clearly identified.
2. The symptom or error message is known.
3. You have already attempted at least the obvious self-service steps (restart, cache/browser, different network, etc.) in this conversation AND the customer has confirmed they did not resolve the issue.
4. The remaining cause is clearly beyond what self-service can fix — it requires server-side investigation, account access, or team action.
While you are actively troubleshooting and still have reasonable steps to suggest, use action_type NONE regardless of how technical the issue sounds. Do not forward mid-troubleshoot just because a step failed — keep working through the problem first.

Rules:
- The reply field must be exactly what is sent to the customer — complete, natural, on-brand.
- intent_summary must synthesize ALL context gathered so far: what is broken, what was tried, what failed, and what is still unknown. Never echo the customer's last message. If you cannot write a specific, actionable summary, do not classify yet.
- conversation_summary is a running log that should be updated each turn to reflect what has been discussed.
- If uncertain about intent, use NONE with intent_confidence 0.0 and empty intent_summary.
- If should_resolve is true, the reply should naturally ask if the customer needs anything else.
"""

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

    def _build_messages(
        self,
        user_message: str,
        context: str,
        history: list[dict],
        system_prompt: str,
        customer_context: str | None,
        conversation_summary: str | None,
    ) -> list[dict]:
        messages: list[dict] = [{"role": "system", "content": system_prompt}]
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
        if conversation_summary:
            messages.append({
                "role": "system",
                "content": f"Conversation summary so far (use this as context; the recent messages below are the most recent turns):\n{conversation_summary}",
            })
        for turn in history:
            if turn.get("role") in ("user", "assistant") and turn.get("content"):
                messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": user_message})
        return messages

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
        conversation_summary: str | None = None,
    ) -> str:
        if not settings.OPENROUTER_API_KEY:
            logger.warning("OPENROUTER_API_KEY not set — returning fallback response")
            return "I'm sorry, I'm not configured to respond yet. Please contact support."

        prompt = _build_system_prompt(bot_name, org_name, system_prompt_override)
        messages = self._build_messages(
            user_message=user_message,
            context=context,
            history=history or [],
            system_prompt=prompt,
            customer_context=customer_context,
            conversation_summary=conversation_summary,
        )

        response = await self._client().chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=520,
            temperature=0.2,
        )
        return response.choices[0].message.content or ""

    async def generate_structured(
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
        conversation_summary: str | None = None,
    ) -> dict[str, Any]:
        """Single LLM call that generates the customer reply, classifies action intent,
        and produces a running conversation summary — eliminating the separate
        /action-intent/classify call."""
        if not settings.OPENROUTER_API_KEY:
            return {"reply": "I'm sorry, I'm not configured to respond yet. Please contact support.", "should_resolve": False, "action_type": "NONE", "intent_confidence": 0.0, "intent_summary": "", "conversation_summary": "", "registration_product_id": "", "collected_fields": {}}

        base_prompt = _build_system_prompt(bot_name, org_name, system_prompt_override)
        # Append structured output schema after the base prompt
        combined_prompt = f"{base_prompt}\n\n{STRUCTURED_OUTPUT_SCHEMA}"

        messages = self._build_messages(
            user_message=user_message,
            context=context,
            history=history or [],
            system_prompt=combined_prompt,
            customer_context=customer_context,
            conversation_summary=conversation_summary,
        )

        raw = ""
        try:
            response = await self._client().chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=1200,
                temperature=0.2,
            )
            raw = response.choices[0].message.content or ""
        except Exception as e:
            logger.warning(f"generate_structured LLM call failed: {e}")
            return {"reply": "", "should_resolve": False, "action_type": "NONE", "intent_confidence": 0.0, "intent_summary": "", "conversation_summary": "", "registration_product_id": "", "collected_fields": {}}

        parsed = self._extract_json_object(raw)
        if not parsed:
            # Fallback: treat the whole response as the reply
            return {"reply": raw.strip(), "should_resolve": False, "action_type": "NONE", "intent_confidence": 0.0, "intent_summary": "", "conversation_summary": "", "registration_product_id": "", "collected_fields": {}}

        action_type = str(parsed.get("action_type") or "NONE").strip().upper()
        if action_type not in ACTION_TYPE_VALUES:
            action_type = "NONE"

        try:
            intent_confidence = float(parsed.get("intent_confidence") or 0.0)
            intent_confidence = max(0.0, min(1.0, intent_confidence))
        except (TypeError, ValueError):
            intent_confidence = 0.0

        # Normalize collected_fields into a flat {str: str} map — the model may return
        # nested/non-string values, so coerce defensively and drop empties.
        raw_collected = parsed.get("collected_fields")
        collected_fields: dict[str, str] = {}
        if isinstance(raw_collected, dict):
            for k, v in raw_collected.items():
                if v is None:
                    continue
                key = str(k).strip()
                val = str(v).strip()
                if key and val:
                    collected_fields[key] = val[:200]

        return {
            "reply": str(parsed.get("reply") or "").strip(),
            "should_resolve": bool(parsed.get("should_resolve")),
            "action_type": action_type,
            "intent_confidence": intent_confidence,
            "intent_summary": str(parsed.get("intent_summary") or "").strip(),
            "conversation_summary": str(parsed.get("conversation_summary") or "").strip(),
            "registration_product_id": str(parsed.get("registration_product_id") or "").strip(),
            "collected_fields": collected_fields,
        }

    async def _execute_register_tool(
        self, args: dict, org_id: str, bot_id: str, conversation_id: str
    ) -> dict:
        """Execute the register_for_event tool by calling the NestJS backend, which does the
        real work (capacity, dedup, entry, payment) and returns a structured result."""
        payload = {
            "orgId": org_id,
            "botId": bot_id,
            "conversationId": conversation_id,
            "productId": str(args.get("product_id") or "").strip(),
            "quantity": int(args.get("quantity") or 1),
            "customerName": (args.get("customer_name") or None),
            "customerEmail": (args.get("customer_email") or None),
            "fields": args.get("fields") if isinstance(args.get("fields"), dict) else {},
        }
        headers = {"X-Internal-Key": settings.INTERNAL_API_SECRET} if settings.INTERNAL_API_SECRET else {}
        url = f"{settings.BACKEND_URL.rstrip('/')}/api/internal/registration/register-for-event"
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code != 200:
                    logger.warning(f"register_for_event tool HTTP {resp.status_code}: {resp.text[:200]}")
                    return {"outcome": "ERROR", "message": "The registration system is temporarily unavailable; tell the customer a teammate will follow up."}
                return resp.json()
        except Exception as e:
            logger.warning(f"register_for_event tool call failed: {e}")
            return {"outcome": "ERROR", "message": "The registration system is temporarily unavailable; tell the customer a teammate will follow up."}

    async def generate_agentic(
        self,
        user_message: str,
        org_id: str,
        bot_id: str,
        conversation_id: str,
        context: str = "",
        history: list[dict] | None = None,
        model: str = DEFAULT_MODEL,
        bot_name: str = "Assistant",
        org_name: str | None = None,
        system_prompt_override: str | None = None,
        customer_context: str | None = None,
        conversation_summary: str | None = None,
    ) -> dict[str, Any]:
        """Tool-use agentic loop: the model chats normally, and when it wants to register a
        customer it calls the register_for_event tool, receives the REAL result, and composes
        its reply from that. No post-hoc guardrails — the model can only state tool-confirmed
        outcomes. Returns {reply, registration_handled, payment_url, should_resolve}."""
        if not settings.OPENROUTER_API_KEY:
            return {"reply": "I'm sorry, I'm not configured to respond yet. Please contact support.", "registration_handled": False, "payment_url": "", "should_resolve": False}

        base_prompt = _build_system_prompt(bot_name, org_name, system_prompt_override)
        agent_prompt = (
            f"{base_prompt}\n\n"
            "You can register customers for events using the register_for_event tool. "
            "Collect the required fields (shown per event in the available registrations context) "
            "conversationally first, then call the tool. Trust the tool's result completely: if it "
            "returns PENDING_PAYMENT, give the customer the payment link and make clear they are NOT "
            "registered until they pay; if AT_CAPACITY or ALREADY_REGISTERED, relay that honestly; only "
            "say a registration is confirmed when the tool says CONFIRMED. Never invent a confirmation, "
            "payment status, or ticket."
        )

        messages = self._build_messages(
            user_message=user_message,
            context=context,
            history=history or [],
            system_prompt=agent_prompt,
            customer_context=customer_context,
            conversation_summary=conversation_summary,
        )

        registration_handled = False
        payment_url = ""
        client = self._client()

        # Bounded loop: model → (optional tool call → execute → observe) → final reply.
        for _ in range(4):
            try:
                resp = await client.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=[REGISTER_FOR_EVENT_TOOL],
                    temperature=0.3,
                    max_tokens=1000,
                )
            except Exception as e:
                logger.warning(f"generate_agentic model call failed: {e}")
                return {"reply": "", "registration_handled": registration_handled, "payment_url": payment_url, "should_resolve": False}

            msg = resp.choices[0].message
            tool_calls = getattr(msg, "tool_calls", None)

            if not tool_calls:
                reply = (msg.content or "").strip()
                # Resolution mirrors the classic path: the model emits [RESOLVED] when the
                # customer's issue is fully handled (base prompt already instructs this). A
                # completed free registration also counts as resolved. A pending payment never
                # resolves — the customer still has to pay. chat.py strips the [RESOLVED] tag.
                resolved_tag = bool(re.search(r"\[\s*resolved\s*\]", reply, re.IGNORECASE))
                should_resolve = (resolved_tag or (registration_handled and not payment_url)) and not payment_url
                return {
                    "reply": reply,
                    "registration_handled": registration_handled,
                    "payment_url": payment_url,
                    "should_resolve": bool(should_resolve),
                }

            # Record the assistant's tool-call message, then execute each tool.
            messages.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in tool_calls
                ],
            })
            for tc in tool_calls:
                if tc.function.name != "register_for_event":
                    result = {"outcome": "ERROR", "message": "Unknown tool."}
                else:
                    try:
                        args = json.loads(tc.function.arguments or "{}")
                    except Exception:
                        args = {}
                    result = await self._execute_register_tool(args, org_id, bot_id, conversation_id)
                    registration_handled = True
                    if result.get("payment_url"):
                        payment_url = result["payment_url"]
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)})

        # Loop exhausted — ask once more without tools to force a final reply.
        try:
            final = await client.chat.completions.create(model=model, messages=messages, temperature=0.3, max_tokens=1000)
            reply = (final.choices[0].message.content or "").strip()
        except Exception:
            reply = ""
        return {"reply": reply, "registration_handled": registration_handled, "payment_url": payment_url, "should_resolve": False}

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
