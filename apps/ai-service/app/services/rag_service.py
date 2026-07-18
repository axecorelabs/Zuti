"""
RAG service — retrieves relevant chunks from Qdrant and generates a reply via LLM.
"""
from __future__ import annotations
import logging
from typing import Any
from app.services.embedding_service import embedding_service
from app.services.llm_service import llm_service
from app.core.config import settings

logger = logging.getLogger(__name__)

UNCERTAIN_PHRASES = (
    "i don't know",
    "i do not know",
    "i am not sure",
    "i'm not sure",
    "i cannot help",
    "i can't help",
    "please contact support",
    "contact us directly",
    "reach out to our team",
    "speak to a human",
    "talk to an agent",
)

# Collection names are scoped per-organization
def _collection(organization_id: str) -> str:
    return f"org_{organization_id}"


class RagService:
    async def chat(
        self,
        organization_id: str,
        bot_id: str,
        conversation_id: str,
        message: str,
        history: list[dict] | None = None,
        top_k: int = 5,
        bot_name: str = "Assistant",
        org_name: str | None = None,
        system_prompt: str | None = None,
        customer_context: str | None = None,
        action_forwarding_enabled: bool = False,
        conversation_summary: str | None = None,
        # Legacy params kept for API compat — no longer used internally
        forwarding_status: str | None = None,
        forwarding_reason: str | None = None,
        action_task_id: str | None = None,
        can_claim_completed: bool | None = None,
        missing_fields: list[str] | None = None,
        blocked_capability: str | None = None,
        claim_level: str | None = None,
        delivery_status: str | None = None,
        operational_truth: dict[str, Any] | None = None,
        risk_profile: dict[str, Any] | None = None,
        needs_verifier: bool | None = None,
    ) -> tuple[str, list[dict], dict[str, Any], dict[str, Any]]:
        # 1. Try RAG (embed + Qdrant search) — skip for short purely conversational turns
        # (greetings, acknowledgements, simple yes/no) that don't need knowledge retrieval.
        sources: list[dict] = []
        context = ""
        msg_lower = message.lower().strip()
        _needs_retrieval = (
            len(msg_lower) > 60
            or any(kw in msg_lower for kw in (
                "?", "how", "what", "why", "when", "where", "who", "which",
                "help", "issue", "problem", "error", "price", "cost",
                "buy", "order", "book", "schedule", "refund", "cancel",
                "feature", "plan", "support", "technical", "integrate",
            ))
        )
        if _needs_retrieval:
            try:
                query_vector = await embedding_service.embed(message)

                from qdrant_client import AsyncQdrantClient
                client = AsyncQdrantClient(
                    url=settings.QDRANT_URL,
                    api_key=settings.QDRANT_API_KEY or None,
                )
                collection = _collection(organization_id)
                bot_scope = f"bot_{bot_id}"

                response = await client.query_points(
                    collection_name=collection,
                    query=query_vector,
                    limit=max(top_k * 4, top_k),
                    score_threshold=0.5,
                )

                allowed_scopes = {"", "__shared__", bot_scope}
                for hit in response.points:
                    payload = hit.payload or {}
                    point_scope = str(payload.get("bot_scope") or "")
                    point_bot_id = str(payload.get("bot_id") or "")
                    if point_scope not in allowed_scopes and point_bot_id not in {"", bot_id}:
                        continue
                    sources.append({"content": payload.get("content", ""), "score": hit.score})
                    if len(sources) >= top_k:
                        break

                context = "\n\n".join(s["content"] for s in sources)
            except Exception as e:
                logger.warning(f"RAG search failed (continuing without context): {e}")

        # 2. Generate reply (+ optional unified intent classification and conversation summary)
        chat_meta: dict[str, Any] = {}
        if action_forwarding_enabled:
            result = await llm_service.generate_structured(
                user_message=message,
                context=context,
                conversation_id=conversation_id,
                history=history or [],
                bot_name=bot_name,
                org_name=org_name,
                system_prompt_override=system_prompt,
                customer_context=customer_context,
                conversation_summary=conversation_summary,
            )
            reply = result.get("reply") or ""
            chat_meta = {
                "action_type": result.get("action_type") or "NONE",
                "intent_confidence": result.get("intent_confidence") or 0.0,
                "intent_summary": result.get("intent_summary") or "",
                "conversation_summary": result.get("conversation_summary") or "",
                "should_resolve": bool(result.get("should_resolve")),
                # Previously dropped here — without these, registrations could never complete.
                "registration_product_id": result.get("registration_product_id") or "",
                "collected_fields": result.get("collected_fields") or {},
            }
        else:
            reply = await llm_service.generate(
                user_message=message,
                context=context,
                conversation_id=conversation_id,
                history=history or [],
                bot_name=bot_name,
                org_name=org_name,
                system_prompt_override=system_prompt,
                customer_context=customer_context,
                conversation_summary=conversation_summary,
            )

        assessment = self._assess_answerability(message, reply, sources)
        return reply, sources, assessment, chat_meta

    def _assess_answerability(
        self,
        message: str,
        reply: str,
        sources: list[dict],
    ) -> dict[str, Any]:
        reply_lower = reply.lower()
        has_uncertainty = any(phrase in reply_lower for phrase in UNCERTAIN_PHRASES)
        strong_sources = [s for s in sources if float(s.get("score") or 0) >= 0.62]

        if has_uncertainty and not strong_sources:
            answerability = "not_answerable"
            confidence = 0.25
        elif has_uncertainty:
            answerability = "partially_answerable"
            confidence = 0.45
        elif strong_sources:
            answerability = "answerable"
            confidence = min(0.95, 0.65 + (len(strong_sources) * 0.07))
        elif sources:
            answerability = "partially_answerable"
            confidence = 0.55
        else:
            answerability = "general_answer"
            confidence = 0.5

        should_escalate = answerability in {"not_answerable", "partially_answerable"} and has_uncertainty
        topic = self._topic_hint(message)
        return {
            "answerability": answerability,
            "confidence": confidence,
            "should_escalate": should_escalate,
            "escalation_topic": topic,
        }

    def _topic_hint(self, message: str) -> str | None:
        text = message.lower()
        topics = {
            "billing": ("bill", "billing", "charge", "payment", "refund", "invoice", "subscription", "renewal"),
            "technical": ("bug", "error", "crash", "broken", "login", "password", "api", "integration"),
            "shipping": ("ship", "delivery", "tracking", "package", "order"),
            "returns": ("return", "exchange", "refund", "cancel"),
        }
        for topic, keywords in topics.items():
            if any(keyword in text for keyword in keywords):
                return topic
        words = [w.strip(".,!?;:()[]{}\"'").lower() for w in message.split()]
        useful = [w for w in words if len(w) > 4][:3]
        return " ".join(useful) or None

    async def health_check(self) -> bool:
        try:
            from qdrant_client import AsyncQdrantClient
            client = AsyncQdrantClient(url=settings.QDRANT_URL)
            await client.get_collections()
            return True
        except Exception:
            return False


rag_service = RagService()
