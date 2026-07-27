"""
LLM service — routes all completions through OpenRouter.
Uses the OpenAI-compatible SDK; swap `model` to any OpenRouter-supported model.
"""
from __future__ import annotations
import asyncio
import logging
import httpx
from openai import AsyncOpenAI
from app.core.config import settings
import json
import re
from typing import Any

# Holds references to fire-and-forget background tasks (e.g. out-of-band summary refresh) so the
# event loop doesn't garbage-collect them mid-flight. Tasks remove themselves when done.
_BACKGROUND_TASKS: set[asyncio.Task] = set()

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
            "A ticket, pass, or spot for an event listed there is ALWAYS handled by this tool — use it "
            "whenever the customer wants one, no matter the verb (register, sign up, buy, get, purchase, "
            "order, reserve). A ticket is never a sales order. "
            "ALWAYS ask how many tickets they want before registering — do not assume 1. "
            "Call this ONLY once you have the customer's full name, email, and every required field "
            "for the chosen event. It performs the real registration (capacity, dedup, payment) and "
            "returns the actual result — including a payment link for paid events. Do not claim a "
            "registration succeeded unless this tool returns a success outcome. If the event has "
            "MULTIPLE ticket tiers, this tool returns NEEDS_TICKET_TYPE listing them — ask the "
            "customer which tier they want, then call again passing ticket_type_name (the tier's name "
            "they chose, e.g. 'VIP'). You do NOT need to remember tier ids. When a tool returns "
            "PENDING_PAYMENT it includes a payment link — give that link to the customer IN THIS CHAT; "
            "never tell them it will be emailed.\n\n"
            "MULTIPLE TICKETS / DIFFERENT ATTENDEES: when the customer wants more than one ticket, ask "
            "whether the tickets are for different people. If they are (or the tickets span different "
            "tiers), pass the `tickets` array — one object per ticket, each its own tier and attendee — "
            "instead of quantity. Every entry in `tickets` becomes a separate ticket with its own QR, "
            "and the whole cart is paid once. If all tickets are the same tier and for the same person, "
            "just use quantity. Only include an attendee's name/email in a ticket if the customer gave "
            "you that person's details; otherwise leave them off and the buyer's details are used."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "product_id": {"type": "string", "description": "The exact 'ID:' of the event from the available registrations context."},
                "ticket_type_name": {"type": "string", "description": "The name of the ticket tier the customer chose (e.g. 'VIP', 'General Admission'). Pass this — not an id — once they pick, for tiered events. Ignored when `tickets` is provided."},
                "ticket_type_id": {"type": "string", "description": "Optional: the chosen tier's id if you have it. Prefer ticket_type_name. Never invent an id."},
                "quantity": {"type": "integer", "description": "Number of tickets when they're all the same tier and for the same person. Ask the customer — do not default silently. Use `tickets` instead for different tiers or different attendees."},
                "customer_name": {"type": "string", "description": "The customer's (buyer's) full name."},
                "customer_email": {"type": "string", "description": "The customer's (buyer's) email address. Never invent or auto-complete this."},
                "tickets": {
                    "type": "array",
                    "description": "One object per ticket, for multi-tier or multi-attendee purchases paid once. Provide instead of quantity when tickets differ. Each ticket gets its own QR.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "ticket_type_name": {"type": "string", "description": "The tier for THIS ticket (e.g. 'VIP'). Omit for single-tier events."},
                            "ticket_type_id": {"type": "string", "description": "Optional tier id for this ticket. Prefer ticket_type_name."},
                            "name": {"type": "string", "description": "This attendee's full name. Omit to use the buyer's name."},
                            "email": {"type": "string", "description": "This attendee's email. Omit to use the buyer's email. Never invent it."},
                            "fields": {"type": "object", "description": "Event-specific required fields for this attendee, keyed by field key.", "additionalProperties": {"type": "string"}},
                        },
                    },
                },
                "fields": {
                    "type": "object",
                    "description": "Any additional event-specific fields for the buyer, keyed by their exact field key (e.g. phone_number).",
                    "additionalProperties": {"type": "string"},
                },
            },
            "required": ["product_id", "customer_name", "customer_email"],
        },
    },
}

def _contact_props(extra: dict) -> dict:
    """Common customer contact fields shared by every action tool, plus tool-specific fields."""
    base = {
        "customer_name": {"type": "string", "description": "The customer's full name."},
        "customer_email": {"type": "string", "description": "The customer's email address. Never invent or auto-complete this — ask the customer."},
        "summary": {"type": "string", "description": "A concise one-line summary of the request, in your own words, for the team."},
    }
    base.update(extra)
    return base


BOOK_MEETING_TOOL = {
    "type": "function",
    "function": {
        "name": "book_meeting",
        "description": (
            "Submit a meeting / call booking request to the team. Call this ONLY when the customer "
            "clearly wants to book or schedule a meeting AND you have collected their name, email, "
            "preferred date/time, and the reason. It creates the real booking and notifies the team. "
            "Do not claim a meeting is booked unless this tool returns a SUBMITTED outcome."
        ),
        "parameters": {
            "type": "object",
            "properties": _contact_props({
                "preferred_datetime": {"type": "string", "description": "The customer's preferred date and/or time for the meeting."},
                "booking_reason": {"type": "string", "description": "What the meeting is about."},
            }),
            "required": ["customer_name", "customer_email", "preferred_datetime", "booking_reason"],
        },
    },
}

REQUEST_CONSULTATION_TOOL = {
    "type": "function",
    "function": {
        "name": "request_consultation",
        "description": (
            "Submit a consultation / demo / specialist follow-up request to the team. Call this ONLY "
            "when the customer wants a consultation, demo, or onboarding help AND you have their name, "
            "email, phone, company, and the purpose. Do not claim it is arranged unless this tool "
            "returns a SUBMITTED outcome."
        ),
        "parameters": {
            "type": "object",
            "properties": _contact_props({
                "customer_phone": {"type": "string", "description": "The customer's phone number."},
                "company_name": {"type": "string", "description": "The customer's company or organization name."},
                "consultation_purpose": {"type": "string", "description": "What the consultation is for."},
            }),
            "required": ["customer_name", "customer_email", "customer_phone", "company_name", "consultation_purpose"],
        },
    },
}

CREATE_SALES_ORDER_TOOL = {
    "type": "function",
    "function": {
        "name": "create_sales_order",
        "description": (
            "Submit a sales order / purchase request for a STORE / CATALOG product (physical or digital "
            "goods). Call this when the customer clearly intends to buy such a product AND you have their "
            "name, email, and which product. Always pass `product` (the product name). For a store item "
            "the price is taken from the catalog automatically — do NOT type it; include `variant_id` too "
            "if you have one from search_products. If the item isn't found, the tool will tell you to "
            "search_products. Do not claim an order is placed unless it returns SUBMITTED. "
            "IMPORTANT: this is NOT for event tickets, passes, or spots — a ticket for an event listed in "
            "your registration context is a REGISTRATION; use register_for_event for it, even if the "
            "customer says 'buy' or 'order'. Route by WHAT they want, not the verb they use."
        ),
        "parameters": {
            "type": "object",
            "properties": _contact_props({
                "product": {"type": "string", "description": "The product the customer wants to order (name as they/the catalog refer to it)."},
                "variant_id": {"type": "string", "description": "The catalog variant_id if known (from search_products) — makes the match exact. Optional."},
                "quantity": {"type": "integer", "description": "How many units. Default 1 if unspecified."},
                "unit_price": {"type": "string", "description": "Only for off-catalog items the customer priced themselves; omit for store products (price comes from the catalog)."},
            }),
            "required": ["customer_name", "customer_email", "product"],
        },
    },
}

SEARCH_PRODUCTS_TOOL = {
    "type": "function",
    "function": {
        "name": "search_products",
        "description": (
            "Search this store's product catalog by name, type, or keywords. Returns matching products "
            "with their variants, exact prices, and stock. Call this before quoting a price or taking an "
            "order so you use real catalog data — never guess a product or price. To order, pass the "
            "chosen variant_id to create_sales_order."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What the customer is looking for (product name, type, or keywords)."},
            },
            "required": ["query"],
        },
    },
}

LOG_TECHNICAL_ISSUE_TOOL = {
    "type": "function",
    "function": {
        "name": "log_technical_issue",
        "description": (
            "Submit a technical issue / bug report to the team for follow-up. Call this ONLY when the "
            "customer describes a specific, concrete technical problem AND you have a clear issue "
            "summary and their email for follow-up. Do not claim it is resolved — only that it was "
            "logged — and only when this tool returns a SUBMITTED outcome."
        ),
        "parameters": {
            "type": "object",
            "properties": _contact_props({
                "issue_summary": {"type": "string", "description": "A clear, specific summary of the technical problem."},
            }),
            "required": ["customer_email", "issue_summary"],
        },
    },
}

SEARCH_KNOWLEDGE_TOOL = {
    "type": "function",
    "function": {
        "name": "search_knowledge",
        "description": (
            "Search the company's knowledge base for grounded information to answer the customer's "
            "question. You MUST call this before answering ANY question about the company, its "
            "products, pricing, policies, features, or any specific fact — do not answer such "
            "questions from your own general knowledge. Returns matching passages with a match "
            "quality. If it returns NO_STRONG_MATCH or EMPTY, the knowledge base does not cover the "
            "question: tell the customer you don't have that information and offer to connect them "
            "with the team — never guess or invent an answer. You may call it again with a refined "
            "query if the first result is weak."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "A focused search query capturing what the customer wants to know."},
            },
            "required": ["query"],
        },
    },
}

REPORT_KNOWLEDGE_GAP_TOOL = {
    "type": "function",
    "function": {
        "name": "report_knowledge_gap",
        "description": (
            "Flag a genuine question the knowledge base could not answer so the team can add the "
            "missing content. Call this AFTER search_knowledge returns NO_STRONG_MATCH or EMPTY, but "
            "ONLY when the question is on-topic and something the company should reasonably be able to "
            "answer (e.g. pricing, policies, product details, availability). Do NOT log greetings, "
            "chit-chat, off-topic questions, or nonsense. This runs silently in the background — it "
            "does not reply to the customer, so still give them your normal answer or abstention."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "The customer's question, phrased clearly and generically (not their exact words if messy)."},
                "topic": {"type": "string", "description": "A short topic label, e.g. 'refund policy', 'pricing', 'shipping times'."},
            },
            "required": ["question"],
        },
    },
}

ESCALATE_TO_HUMAN_TOOL = {
    "type": "function",
    "function": {
        "name": "escalate_to_human",
        "description": (
            "Escalate the conversation to a human on the team / the owner. Call this ONLY when the "
            "customer explicitly asks to speak to a person, the owner, or management, or when the "
            "request is clearly beyond what you can handle AND you have their name and email so the "
            "team can reach them. Do NOT escalate a question you have already answered, and do NOT "
            "escalate merely to offer 'more detail' on something you just answered — answer what you "
            "can from your sources and stop there. Only escalate if the customer explicitly wants a "
            "human or you genuinely cannot answer at all. Do not claim a human has responded — only "
            "that the team was notified."
        ),
        "parameters": {
            "type": "object",
            "properties": _contact_props({
                "reason": {"type": "string", "description": "Why the customer needs a human / the owner."},
            }),
            "required": ["customer_name", "customer_email", "reason"],
        },
    },
}

# Registry of every tool the agent can be granted, keyed by the tool name the model calls.
REMEMBER_ABOUT_CUSTOMER_TOOL = {
    "type": "function",
    "function": {
        "name": "remember_about_customer",
        "description": (
            "Silently save a DURABLE fact about THIS customer to their profile so future conversations "
            "(on any channel) are personalized — e.g. a stated preference, their name, their role or "
            "company, or an important context detail. Call it when you learn something worth remembering "
            "long-term. Do NOT use it for one-off requests, greetings, or transient chatter, and do NOT "
            "tell the customer you saved anything — it runs silently; just continue your reply. You "
            "cannot change their contact details or consent through this tool."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "note": {"type": "string", "description": "A concise durable fact to remember (e.g. 'Prefers email over calls', 'Runs a bakery in Lagos')."},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "Short labels categorizing the customer (e.g. 'vip', 'wholesale', 'returning')."},
                "name": {"type": "string", "description": "The customer's name — ONLY if you just learned it and don't already have it."},
            },
        },
    },
}

ACTION_TOOL_REGISTRY = {
    "search_knowledge": SEARCH_KNOWLEDGE_TOOL,
    "report_knowledge_gap": REPORT_KNOWLEDGE_GAP_TOOL,
    "search_products": SEARCH_PRODUCTS_TOOL,
    "register_for_event": REGISTER_FOR_EVENT_TOOL,
    "book_meeting": BOOK_MEETING_TOOL,
    "request_consultation": REQUEST_CONSULTATION_TOOL,
    "create_sales_order": CREATE_SALES_ORDER_TOOL,
    "log_technical_issue": LOG_TECHNICAL_ISSUE_TOOL,
    "escalate_to_human": ESCALATE_TO_HUMAN_TOOL,
    "remember_about_customer": REMEMBER_ABOUT_CUSTOMER_TOOL,
}

# Similarity score at/above which a retrieved passage counts as strong grounding (matches the
# threshold used by RagService._assess_answerability). Below this, treat evidence as weak.
STRONG_SOURCE_SCORE = 0.62

# Safe fallback when a knowledge answer fails the faithfulness check — never dead-ends the customer.
ABSTENTION_MESSAGE = (
    "I want to make sure I only give you accurate information, and I don't have the details to answer "
    "that confidently right now. Let me connect you with a teammate who can help — is there anything "
    "else I can assist you with in the meantime?"
)

_ABSTENTION_HINTS = (
    "don't have", "do not have", "couldn't find", "could not find", "not able to find",
    "i'm not sure", "i am not sure", "don't have that information", "connect you", "connect you with",
    "reach out to", "follow up with", "a teammate", "our team", "human agent",
    "cannot provide", "can't provide", "not available", "isn't available", "is not available",
    "unable to", "i'm unable", "i am unable", "no information", "knowledge base", "i cannot",
    "i can't", "don't currently have", "not something i can", "not in my", "no details",
)


def _looks_like_abstention(text: str) -> bool:
    """Broad check (decline + routing phrases) used only to SKIP the faithfulness verifier — being
    broad here is safe (it just avoids a check on a reply that isn't asserting facts)."""
    t = (text or "").lower()
    return any(h in t for h in _ABSTENTION_HINTS)


# Narrow, precise "I could not answer" phrases — the signal for logging a knowledge gap. Excludes
# routing phrases like "reach out to our team", which also appear at the end of *real* answers.
_DECLINE_HINTS = (
    "cannot provide", "can't provide", "not available", "isn't available", "is not available",
    "don't have", "do not have", "don't currently have", "no information", "no details",
    "i cannot", "i can't", "unable to", "couldn't find", "could not find", "not able to",
    "not in my", "don't have that information", "i'm not sure", "i am not sure", "not something i can",
)


def _is_decline(text: str) -> bool:
    """Whether the reply actually declines to answer (didn't provide the information). Precise, so a
    real answer that merely offers a human follow-up isn't mistaken for a knowledge gap."""
    t = (text or "").lower()
    return any(h in t for h in _DECLINE_HINTS)


_QUESTION_WORDS = ("how ", "what ", "why ", "when ", "where ", "who ", "which ", "can ", "could ",
                   "do ", "does ", "is ", "are ", "should ", "would ", "tell me", "explain")


def _is_substantive_question(text: str) -> bool:
    """Whether the customer's message is a genuine question worth logging as a knowledge gap when
    unanswered — filters out greetings, thanks, and one-word acknowledgements."""
    t = (text or "").lower().strip()
    if len(t) < 8:
        return False
    if "?" in t:
        return True
    if any(t.startswith(w) or f" {w}" in t for w in _QUESTION_WORDS):
        return True
    return len(t) > 45

# Tool name → intent action_type, so the agentic path can report a real action_type for analytics
# (the classic structured path classifies intent; here the fired tool IS the intent).
TOOL_ACTION_TYPES = {
    "register_for_event": "REGISTRATION_REQUEST",
    "book_meeting": "MEETING_REQUEST",
    "request_consultation": "CONSULTATION_REQUEST",
    "create_sales_order": "SALES_ORDER_REQUEST",
    "log_technical_issue": "TECHNICAL_ISSUE",
    "escalate_to_human": "OWNER_ATTENTION_NEEDED",
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
    "Only use [RESOLVED] when the issue is genuinely resolved — not speculatively. "
    "NEVER append [RESOLVED] while a task is still in progress: if the customer is registering for an "
    "event or placing an order and you have not yet delivered the payment link or a confirmed result, "
    "the conversation is NOT resolved — you still owe them that next step, so keep going and do not tag it."
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

    async def _execute_tool(
        self, tool_name: str, args: dict, org_id: str, bot_id: str, conversation_id: str, channel: str
    ) -> dict:
        """Execute any agent tool by calling the unified NestJS internal endpoint, which does the
        real work (create the record, queue delivery, run payment for registrations) and returns a
        structured result. The model composes its reply from that — never from assumption."""
        payload = {
            "toolName": tool_name,
            "orgId": org_id,
            "botId": bot_id,
            "conversationId": conversation_id,
            "channel": channel,
            "args": args if isinstance(args, dict) else {},
        }
        headers = {"X-Internal-Key": settings.INTERNAL_API_SECRET} if settings.INTERNAL_API_SECRET else {}
        url = f"{settings.BACKEND_URL.rstrip('/')}/api/internal/tools/execute"
        # Action tools that create records + run a live payment call (order checkout, event
        # registration) are legitimately heavier than a lookup — they fan out to many sequential DB
        # writes and a Paystack round-trip. Give them generous headroom so the backend's real result
        # (incl. the payment link) always makes it back into the reply instead of the client giving up
        # mid-flight and reporting a false "couldn't submit" while the order actually got created.
        timeout = 60.0 if tool_name in ("create_sales_order", "register_for_event") else 20.0
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code != 200:
                    logger.warning(f"{tool_name} tool HTTP {resp.status_code}: {resp.text[:200]}")
                    return {"outcome": "ERROR", "message": "That request could not be submitted right now; tell the customer a teammate will follow up."}
                return resp.json()
        except Exception as e:
            logger.warning(f"{tool_name} tool call failed: {e}")
            return {"outcome": "ERROR", "message": "That request could not be submitted right now; tell the customer a teammate will follow up."}

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
        enabled_tools: list[str] | None = None,
        channel: str = "TELEGRAM",
        knowledge_search: Any = None,
        eager_sources: list[dict] | None = None,
    ) -> dict[str, Any]:
        """Tool-use agentic loop. The model answers questions by grounding on the knowledge base
        (search_knowledge tool) and takes actions through real tools (book_meeting, register, …),
        composing its reply only from tool results. Knowledge answers are gated on retrieval
        confidence and faithfulness-checked so the model can't confabulate facts the KB doesn't
        contain. Returns {reply, sources, grounded, action_type, ...}."""
        if not settings.OPENROUTER_API_KEY:
            return {"reply": "I'm sorry, I'm not configured to respond yet. Please contact support.", "registration_handled": False, "action_handled": False, "payment_url": "", "should_resolve": False}

        # Lookup tools (knowledge search, gap logging, product search) return info and don't count as
        # customer-facing "actions". search_knowledge/report_knowledge_gap are always available when
        # knowledge_search is set (search runs locally here); the rest come from the backend
        # (capabilities), including search_products for commerce-store bots.
        LOOKUP_TOOLS = {"search_knowledge", "report_knowledge_gap", "search_products"}
        enabled = [t for t in (enabled_tools or []) if t in ACTION_TOOL_REGISTRY]
        tool_names = list(dict.fromkeys(
            (["search_knowledge", "report_knowledge_gap"] if knowledge_search is not None else [])
            + ["remember_about_customer"]  # Customer hub write loop — always available, silent enrichment
            + enabled
        ))
        action_tool_names = [t for t in tool_names if t not in LOOKUP_TOOLS and t != "remember_about_customer"]
        tools_param = [ACTION_TOOL_REGISTRY[t] for t in tool_names]

        base_prompt = _build_system_prompt(bot_name, org_name, system_prompt_override)
        tool_guidance = ""
        if knowledge_search is not None:
            tool_guidance += (
                "\n\nGROUNDING — this is critical. Answer questions about the company, its products, "
                "pricing, policies, features, events, or any specific fact ONLY from grounded sources: "
                "(a) the AUTHORITATIVE CONTEXT already provided to you this turn — this may include a "
                "product catalog with prices and stock, event/registration options, and approved reply "
                "templates — and (b) passages returned by the search_knowledge tool. IMPORTANT: if your "
                "provided context already contains the answer (e.g. a product's price or stock, an "
                "event's details), USE IT DIRECTLY and confidently — do not say you lack the information "
                "and do not call search_knowledge for it. Only call search_knowledge for factual "
                "questions your provided context does NOT cover. Never answer product/price/policy "
                "questions from your own general knowledge. If neither your provided context nor "
                "search_knowledge covers it, briefly say you don't have that information and offer to "
                "connect the customer with the team — do NOT guess or invent prices, policies, dates, or "
                "availability, and in that case also call report_knowledge_gap (it runs silently — still "
                "give your reply). General chit-chat and greetings need no grounding. You may also "
                "confirm, repeat, or build on a fact you ALREADY stated earlier in THIS conversation "
                "without searching again — that fact is already grounded, so do not suddenly claim you "
                "lack it. When the customer simply acknowledges or reacts to something you said (e.g. "
                "'oh, I didn't know that'), that is normal conversation, not a new factual question — "
                "respond naturally; do not treat it as something you must abstain from or escalate."
            )
        if action_tool_names:
            tool_guidance += (
                "\n\nYou also have tools to submit requests to the team on the customer's behalf. Use one "
                "ONLY when the customer clearly wants that action and you have collected every required "
                "field — gather details conversationally first, then call the tool. Compose your reply "
                "from the tool's result: SUBMITTED → confirm it was forwarded; MISSING_FIELDS → ask for "
                "exactly the listed fields; NOT_AVAILABLE/NOT_SUBMITTED → do NOT claim anything was "
                "submitted. Never invent a confirmation, reference, or status a tool didn't return. "
                "IMPORTANT: the grounding rule above governs how you ANSWER questions — it does NOT gate "
                "these action tools. When a customer wants to book, order, register, or escalate, capture "
                "the details THEY give you (product name, date, quantity, etc.) and call the tool. You do "
                "NOT need to look up or verify those details in the knowledge base first — the team "
                "validates them. Do not refuse or stall an action just because its details aren't in the "
                "knowledge base.\n"
                "CRITICAL — CONTACT DETAILS: a customer's email, phone, and name for an action must come "
                "from what THEY explicitly tell you in this conversation. NEVER invent, guess, or "
                "construct them — do not turn a name like 'Dotun Olaiya' into 'dotun.olaiya@example.com', "
                "and do not reuse a name/email from their profile or context as if they gave it. If you "
                "already have a value on file, ASK them to confirm it before using it; otherwise ASK for "
                "it. If you don't have a real email the customer gave you, you do NOT have enough to "
                "register/order — ask for it first. A fabricated email sends their ticket or receipt "
                "into the void.\n"
                "ROUTE BY WHAT THEY WANT, NOT THE VERB: pick the tool from the OBJECT of the request, not "
                "the word the customer used. A ticket/pass/spot for an event → register_for_event; a "
                "store/catalog product → create_sales_order; a meeting → book_meeting. 'Buy a ticket', "
                "'get a ticket', 'register for the event' are the SAME request → register_for_event. Only "
                "decline a request as unavailable when NO tool you have can do it — never because of the "
                "verb alone."
            )
        if "remember_about_customer" in tool_names:
            tool_guidance += (
                "\n\nCUSTOMER MEMORY: when you learn a DURABLE fact about the customer — their name, a "
                "preference, their role or company, or useful lasting context — call remember_about_customer "
                "to save it to their profile for next time. It runs SILENTLY: never announce that you saved "
                "anything, and never use it for one-off requests or small talk. If a 'KNOWN CUSTOMER' profile "
                "was provided in your context, use it to personalize naturally — do not recite it or claim you "
                "looked them up."
            )
        if "register_for_event" in action_tool_names:
            tool_guidance += (
                " For event registration: ALWAYS ask how many tickets they want (don't assume 1). NEVER "
                "assume a ticket is for the person chatting — people often buy for others, so establish who "
                "each ticket is for and use THAT attendee's real name and email (not the buyer's profile). "
                "If the buyer says a ticket is for themselves and you already have their email on file, ask "
                "them to CONFIRM it before using it; otherwise ask for it. If it's for more than one person, "
                "ask whether the tickets are for different people — if so, collect each "
                "attendee's details and pass the `tickets` array (one per person). If register_for_event "
                "returns PENDING_PAYMENT, give the payment link and make clear they are NOT registered until "
                "they pay; relay AT_CAPACITY / ALREADY_REGISTERED honestly; only say confirmed when the tool "
                "says CONFIRMED.\n"
                "ACT, DON'T JUST CHAT: the moment the customer names a ticket tier (or, for a single-tier "
                "event, has given name + email), that is your cue to CALL register_for_event in that SAME "
                "turn — do not reply with a conversational or closing message instead. A common failure is "
                "listing the tiers, the customer picks one, and you then say something like 'glad I could "
                "help' and stop WITHOUT calling the tool or giving the payment link — never do this. A "
                "registration is IN PROGRESS and NOT finished until you have actually delivered the payment "
                "link (paid) or the tool returned CONFIRMED (free). Until then, do NOT end the conversation, "
                "do NOT send a sign-off, and do NOT mark it resolved — you still owe them the link. If you're "
                "missing only the quantity, ask for it (or proceed with 1) — do not abandon the purchase."
            )
        if "search_products" in tool_names:
            tool_guidance += (
                "\n\nSTORE / PRODUCTS: this bot has a store. For ANY question about what you sell, product "
                "details, prices, or stock, call search_products (it IS your catalog) — do NOT use "
                "search_knowledge for products and do NOT say you lack catalog info before searching; "
                "answer from what it returns. ORDERING: call create_sales_order with the `product` name "
                "(and name, email, quantity); the price is taken from the catalog automatically — never "
                "type it. If the tool replies NOT_FOUND, call search_products yourself to find the right "
                "item, then order again — do NOT ask the customer for an internal id."
            )
        agent_prompt = f"{base_prompt}{tool_guidance}"

        messages = self._build_messages(
            user_message=user_message,
            context=context,
            history=history or [],
            system_prompt=agent_prompt,
            customer_context=customer_context,
            conversation_summary=conversation_summary,
        )

        registration_handled = False
        action_handled = False
        action_type = "NONE"
        payment_url = ""
        gap_logged = False
        # Track all retrieved passages (eager pre-retrieval + any search_knowledge calls) and whether
        # any cleared the strong-grounding bar — this drives the faithfulness gate below.
        retrieved_passages: list[dict] = list(eager_sources or [])
        has_strong_grounding = any(float(p.get("score") or 0) >= STRONG_SOURCE_SCORE for p in retrieved_passages)
        client = self._client()

        # Bounded loop: model → (optional tool call → execute → observe) → final reply.
        for _ in range(5):
            create_kwargs: dict[str, Any] = {
                "model": model,
                "messages": messages,
                "temperature": 0.3,
                "max_tokens": 1000,
            }
            if tools_param:
                create_kwargs["tools"] = tools_param
            try:
                resp = await client.chat.completions.create(**create_kwargs)
            except Exception as e:
                logger.warning(f"generate_agentic model call failed: {e}")
                return {"reply": "", "registration_handled": registration_handled, "action_handled": action_handled, "action_type": action_type, "payment_url": payment_url, "should_resolve": False, "conversation_summary": conversation_summary or "", "sources": retrieved_passages, "grounded": has_strong_grounding}

            msg = resp.choices[0].message
            tool_calls = getattr(msg, "tool_calls", None)

            if not tool_calls:
                reply = (msg.content or "").strip()
                reply, gap_logged = await self._postprocess_knowledge_answer(
                    reply, knowledge_search=knowledge_search, action_handled=action_handled,
                    has_strong_grounding=has_strong_grounding, gap_logged=gap_logged,
                    retrieved_passages=retrieved_passages, model=model, user_message=user_message,
                    org_id=org_id, bot_id=bot_id, conversation_id=conversation_id, channel=channel,
                    customer_context=customer_context, history=history, conversation_summary=conversation_summary,
                )
                resolved_tag = bool(re.search(r"\[\s*resolved\s*\]", reply, re.IGNORECASE))
                should_resolve = (resolved_tag or (action_handled and not payment_url)) and not payment_url
                # Refresh the running summary OFF the critical path — it's only needed as context for
                # the NEXT turn, so computing it here would just make the customer wait on an extra
                # model call. Returns "" so the caller skips its own write; the background task
                # persists the fresh summary directly.
                self._schedule_summary_refresh(conversation_id, org_id, conversation_summary, history, user_message, reply, model)
                return {
                    "reply": reply,
                    "registration_handled": registration_handled,
                    "action_handled": action_handled,
                    "action_type": action_type,
                    "payment_url": payment_url,
                    "should_resolve": bool(should_resolve),
                    "conversation_summary": "",
                    "sources": retrieved_passages,
                    "grounded": has_strong_grounding,
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
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except Exception:
                    args = {}
                if name == "search_knowledge" and knowledge_search is not None:
                    result, passages, strong = await self._run_knowledge_search(knowledge_search, args.get("query") or user_message)
                    retrieved_passages.extend(passages)
                    has_strong_grounding = has_strong_grounding or strong
                elif name == "report_knowledge_gap" and knowledge_search is not None:
                    # Meta tool: log the gap via the backend, but it's not a customer-facing action.
                    result = await self._execute_tool(name, args, org_id, bot_id, conversation_id, channel)
                    gap_logged = True
                elif name == "remember_about_customer" and name in tool_names:
                    # Silent profile enrichment (Customer hub write loop) — a side effect, not a
                    # customer-facing action, so it doesn't set action_handled / action_type.
                    result = await self._execute_tool(name, args, org_id, bot_id, conversation_id, channel)
                elif name == "search_products" and name in tool_names:
                    # Catalog lookup via the backend — informational, not a customer-facing action.
                    result = await self._execute_tool(name, args, org_id, bot_id, conversation_id, channel)
                    if result.get("outcome") == "FOUND" and result.get("products"):
                        # Catalog results are authoritative grounding — feed them to the faithfulness
                        # check and trust them (so a correct product/price reply isn't overridden).
                        retrieved_passages.append({"content": "PRODUCT CATALOG (search_products): " + json.dumps(result["products"])[:2500], "score": 1.0})
                        has_strong_grounding = True
                elif name not in ACTION_TOOL_REGISTRY or name not in tool_names:
                    result = {"outcome": "ERROR", "message": "That tool is not available."}
                else:
                    result = await self._execute_tool(name, args, org_id, bot_id, conversation_id, channel)
                    action_handled = True
                    action_type = TOOL_ACTION_TYPES.get(name, action_type)
                    if name == "register_for_event":
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
        reply, gap_logged = await self._postprocess_knowledge_answer(
            reply, knowledge_search=knowledge_search, action_handled=action_handled,
            has_strong_grounding=has_strong_grounding, gap_logged=gap_logged,
            retrieved_passages=retrieved_passages, model=model, user_message=user_message,
            org_id=org_id, bot_id=bot_id, conversation_id=conversation_id, channel=channel,
            customer_context=customer_context, history=history, conversation_summary=conversation_summary,
        )
        # Summary refresh is off the critical path (see the early-return note above).
        self._schedule_summary_refresh(conversation_id, org_id, conversation_summary, history, user_message, reply, model)
        return {"reply": reply, "registration_handled": registration_handled, "action_handled": action_handled, "action_type": action_type, "payment_url": payment_url, "should_resolve": False, "conversation_summary": "", "sources": retrieved_passages, "grounded": has_strong_grounding}

    async def _postprocess_knowledge_answer(
        self, reply: str, *, knowledge_search: Any, action_handled: bool, has_strong_grounding: bool,
        gap_logged: bool, retrieved_passages: list[dict], model: str, user_message: str,
        org_id: str, bot_id: str, conversation_id: str, channel: str, customer_context: str | None = None,
        history: list[dict] | None = None, conversation_summary: str | None = None,
    ) -> tuple[str, bool]:
        """For an informational answer on weak/empty grounding: (1) faithfulness-check it and override
        with a safe abstention if unsupported, then (2) deterministically log a knowledge gap when the
        turn ends in an abstention — so gap capture doesn't depend on the model choosing to call the
        report_knowledge_gap tool. Returns (reply, gap_logged)."""
        if knowledge_search is None or action_handled or not reply:
            return reply, gap_logged

        # Facts the bot already gave this customer earlier count as grounding for a follow-up — this
        # is what stops the bot from contradicting itself (answer a fact, then abstain when the
        # customer asks about that same fact). Built from the running summary + the last few turns.
        convo_parts: list[str] = []
        if (conversation_summary or "").strip():
            convo_parts.append("Summary so far: " + conversation_summary.strip())
        for h in (history or [])[-6:]:
            content = (h.get("content") or "").strip()
            if content:
                convo_parts.append(f"{h.get('role', 'user')}: {content}")
        conversation_context = "\n".join(convo_parts)

        # (1) Faithfulness: only for a weakly-grounded answer that isn't already declining — verify it
        # is supported (by KB passages OR the approved customer context) and override with a safe
        # abstention if not. Strong grounding is trusted.
        if not has_strong_grounding and not _looks_like_abstention(reply):
            if not await self._verify_grounding(reply, retrieved_passages, model, customer_context, conversation_context):
                logger.info("generate_agentic: unfaithful answer overridden with abstention")
                reply = ABSTENTION_MESSAGE

        # (2) Gap capture: the bot declined to answer a genuine question. Grounding SCORE is not the
        # signal — a highly-similar chunk that doesn't contain the answer still leaves a real gap; the
        # decline in the reply is what matters.
        if not gap_logged and _is_substantive_question(user_message) and _is_decline(reply):
            try:
                await self._execute_tool("report_knowledge_gap", {"question": user_message}, org_id, bot_id, conversation_id, channel)
                gap_logged = True
            except Exception as e:
                logger.warning(f"auto knowledge-gap logging failed: {e}")
        return reply, gap_logged

    async def _run_knowledge_search(self, knowledge_search: Any, query: str) -> tuple[dict, list[dict], bool]:
        """Execute a search_knowledge tool call: retrieve, gate on similarity, and return
        (result_for_model, passages, has_strong_match). The result tells the model to answer only
        from strong passages, or to abstain when nothing clears the bar."""
        try:
            passages = await knowledge_search(query) or []
        except Exception as e:
            logger.warning(f"search_knowledge failed: {e}")
            return ({"outcome": "ERROR", "message": "Knowledge search is temporarily unavailable; if you can't answer confidently, offer a human follow-up."}, [], False)

        strong = [p for p in passages if float(p.get("score") or 0) >= STRONG_SOURCE_SCORE]
        if strong:
            use = strong[:5]
            result = {
                "outcome": "FOUND",
                "passages": [{"text": (p.get("content") or "")[:800]} for p in use],
                "instruction": "Answer the customer using ONLY the facts in these passages. Do not add details they don't contain.",
            }
            return (result, passages, True)
        if passages:
            result = {
                "outcome": "NO_STRONG_MATCH",
                "passages": [{"text": (p.get("content") or "")[:400]} for p in passages[:2]],
                "instruction": "No passage strongly matches. Do NOT answer from general knowledge. Tell the customer you don't have that specific information and offer to connect them with the team. If this is a genuine on-topic question, also call report_knowledge_gap.",
            }
            return (result, passages, False)
        return ({"outcome": "EMPTY", "instruction": "The knowledge base has nothing on this. Tell the customer you don't have that information and offer a human follow-up. Do not guess or invent an answer. If this is a genuine on-topic question, also call report_knowledge_gap so the team can add it."}, [], False)

    async def _verify_grounding(self, reply: str, passages: list[dict], model: str, customer_context: str | None = None, conversation_context: str | None = None) -> bool:
        """Faithfulness check: is every factual claim in `reply` supported by the grounding the model
        was given? Grounding = the retrieved KB passages, the approved context (registration options,
        approved reply templates, product catalog, account details), AND facts already established
        earlier in THIS conversation — a reply grounded in any of those is fine. That last source
        matters: when the customer follows up on something the bot already answered ('does he own a
        farm?' after the bot said the company runs a farm), confirming it is faithful, not a new
        unsupported claim. Returns True (ok) when grounded or when the reply makes no factual claims;
        False when it asserts unsupported facts. Fails open on error."""
        parts: list[str] = []
        kb = "\n---\n".join((p.get("content") or "")[:800] for p in (passages or [])[:6])
        if kb:
            parts.append("KNOWLEDGE BASE PASSAGES:\n" + kb)
        ctx = (customer_context or "").strip()
        if ctx:
            parts.append(
                "OTHER APPROVED CONTEXT (registration/event options, approved reply templates, "
                "product catalog, the customer's own details):\n" + ctx[:3500]
            )
        convo = (conversation_context or "").strip()
        if convo:
            parts.append(
                "ALREADY ESTABLISHED EARLIER IN THIS CONVERSATION (facts the agent already gave this "
                "customer; confirming or building on these is grounded):\n" + convo[:3000]
            )
        evidence = "\n\n".join(parts) or "(no grounding sources were provided)"
        system = (
            "You are a strict fact-checker for a customer-support reply. You are given the SOURCES the "
            "agent was allowed to use and the agent's ANSWER. The following are ALWAYS fine and count "
            "as GROUNDED: greetings, apologies, offers to help, asking the customer for more details, "
            "offering to perform or start an action the sources support (e.g. registering them for "
            "a listed event, booking a meeting, taking an order), and confirming or reiterating a fact "
            "already established earlier in this conversation (shown in the sources). Only respond "
            "UNSUPPORTED when the answer asserts a specific fact about the company, its products, "
            "pricing, policies, features, dates, or numbers that the SOURCES do not support (or the "
            "sources are empty and it still states such facts). Reply with exactly one word: GROUNDED "
            "or UNSUPPORTED."
        )
        user = f"SOURCES:\n{evidence}\n\nANSWER:\n{reply}\n\nVerdict (GROUNDED or UNSUPPORTED):"
        try:
            out = (await self.complete(system, user, max_tokens=5, model=model)).strip().upper()
            return "UNSUPPORTED" not in out
        except Exception:
            return True

    def _schedule_summary_refresh(
        self, conversation_id: str, org_id: str, prior_summary: str | None,
        history: list[dict] | None, user_message: str, reply: str, model: str,
    ) -> None:
        """Fire-and-forget: recompute the running summary and persist it via the backend, without
        blocking the reply. Held in _BACKGROUND_TASKS so the loop can't GC it mid-flight."""
        if not conversation_id or not org_id or not reply:
            return
        task = asyncio.create_task(
            self._refresh_and_persist_summary(conversation_id, org_id, prior_summary, list(history or []), user_message, reply, model)
        )
        _BACKGROUND_TASKS.add(task)
        task.add_done_callback(_BACKGROUND_TASKS.discard)

    async def _refresh_and_persist_summary(
        self, conversation_id: str, org_id: str, prior_summary: str | None,
        history: list[dict], user_message: str, reply: str, model: str,
    ) -> None:
        try:
            new_summary = await self._refresh_summary(prior_summary, history, user_message, reply, model)
            if not (new_summary or "").strip():
                return
            headers = {"X-Internal-Key": settings.INTERNAL_API_SECRET} if settings.INTERNAL_API_SECRET else {}
            url = f"{settings.BACKEND_URL.rstrip('/')}/api/internal/conversations/summary"
            async with httpx.AsyncClient(timeout=15.0) as client:
                await client.post(url, json={"conversationId": conversation_id, "orgId": org_id, "summary": new_summary}, headers=headers)
        except Exception as e:
            logger.warning(f"background summary refresh failed for {conversation_id}: {e}")

    async def _refresh_summary(
        self, prior_summary: str | None, history: list[dict], user_message: str, reply: str, model: str
    ) -> str:
        """Maintain a running conversation summary on the agentic path (the classic structured path
        refreshes this each turn; the tool loop must too, or long threads lose context beyond the
        recent-history window). One cheap call; skipped when there is nothing meaningful to summarize."""
        prior = (prior_summary or "").strip()
        if not history and not prior:
            # First trivial turn — nothing to carry forward yet.
            return prior
        convo_lines: list[str] = []
        for h in (history or [])[-8:]:
            role = h.get("role", "user")
            content = (h.get("content") or "").strip()
            if content:
                convo_lines.append(f"{role}: {content}")
        convo_lines.append(f"user: {user_message}")
        if reply:
            convo_lines.append(f"assistant: {reply}")
        convo = "\n".join(convo_lines)[:4000]
        system = (
            "You maintain a concise running summary of a customer-support conversation. Given the prior "
            "summary and the latest turns, return an UPDATED summary in 2–4 sentences capturing key facts, "
            "the customer's requests, and any outcomes (e.g. a booking submitted, an order placed). "
            "Return ONLY the summary text — no preamble."
        )
        user = f"Prior summary:\n{prior or '(none)'}\n\nConversation:\n{convo}\n\nUpdated summary:"
        try:
            out = (await self.complete(system, user, max_tokens=180, model=model)).strip()
            return out or prior
        except Exception:
            return prior

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
