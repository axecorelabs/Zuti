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

BASE_SYSTEM_PROMPT = """You are {bot_name}, a helpful customer service AI assistant for {org_name}.
Use the provided context to answer questions accurately and concisely.
If the context doesn't contain relevant information, answer based on your general knowledge but stay focused on helping the customer.
Keep responses friendly and professional. Do not mention that you are an AI unless directly asked."""


def _build_system_prompt(
    bot_name: str,
    org_name: str | None,
    override: str | None,
) -> str:
    if override and override.strip():
        return override
    return BASE_SYSTEM_PROMPT.format(
        bot_name=bot_name,
        org_name=org_name or "our company",
    )


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
        bot_name: str = "Assistant",
        org_name: str | None = None,
        system_prompt_override: str | None = None,
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
        messages.append({"role": "user", "content": user_message})

        response = await self._client().chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=500,
            temperature=0.7,
        )
        return response.choices[0].message.content or ""


llm_service = LlmService()
