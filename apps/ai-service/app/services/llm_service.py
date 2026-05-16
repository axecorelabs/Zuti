"""
LLM service — routes all completions through OpenRouter.
Uses the OpenAI-compatible SDK; swap `model` to any OpenRouter-supported model.
"""
from __future__ import annotations
import logging
from openai import AsyncOpenAI
from app.core.config import settings

logger = logging.getLogger(__name__)

# Default model — change to any model slug on https://openrouter.ai/models
DEFAULT_MODEL = "openai/gpt-4o-mini"

SYSTEM_PROMPT = """You are a helpful customer service AI assistant.
Use the provided context to answer questions accurately and concisely.
If the context doesn't contain relevant information, say so honestly.
Keep responses friendly and professional."""


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
        model: str = DEFAULT_MODEL,
    ) -> str:
        if not settings.OPENROUTER_API_KEY:
            logger.warning("OPENROUTER_API_KEY not set — returning fallback response")
            return "I'm sorry, I'm not configured to respond yet. Please contact support."

        messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
        if context:
            messages.append({
                "role": "system",
                "content": f"Relevant context:\n{context}",
            })
        messages.append({"role": "user", "content": user_message})

        response = await self._client().chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=500,
            temperature=0.7,
        )
        return response.choices[0].message.content or ""


llm_service = LlmService()
