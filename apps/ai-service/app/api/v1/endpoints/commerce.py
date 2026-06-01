from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.llm_service import llm_service

router = APIRouter()


class ProductSpec(BaseModel):
    key: str
    value: str


class ProductDescriptionRequest(BaseModel):
    title: str
    category: str | None = None
    tags: list[str] = Field(default_factory=list)
    specs: list[ProductSpec] = Field(default_factory=list)
    current_description: str | None = None
    mode: str = "generate"


class ProductDescriptionResponse(BaseModel):
    description: str


@router.post("/product-description", response_model=ProductDescriptionResponse)
async def product_description(request: ProductDescriptionRequest):
    try:
        spec_lines = [f"- {item.key}: {item.value}" for item in request.specs if item.key.strip() and item.value.strip()]
        tags_text = ", ".join(tag for tag in request.tags if tag.strip())
        current = (request.current_description or "").strip()
        is_improve = request.mode.strip().lower() == "improve"

        system_prompt = (
            "You are an expert commerce catalog writer for a multi-tenant e-commerce system. "
            "Write a truthful, detailed product description that helps customers and AI assistants. "
            "Use the supplied product details only. Do not invent specifications, warranties, or capabilities. "
            "Return plain text only. Use short paragraphs and useful bullets only when they improve clarity. "
            "Focus on materials, fit, dimensions, use cases, care, what is included, and customer questions."
        )

        user_prompt = [
            f"Product title: {request.title.strip()}",
            f"Category: {request.category.strip() if request.category else 'Not provided'}",
            f"Tags: {tags_text if tags_text else 'Not provided'}",
            "Specifications:",
            *(spec_lines if spec_lines else ["- None provided"]),
        ]
        if is_improve and current:
            user_prompt.extend([
                "",
                "Current description to improve:",
                current,
                "",
                "Task: rewrite this into a stronger, more complete description that is better for an AI sales/support assistant and more useful for customers. Keep it accurate and aligned with the supplied product details.",
            ])
        else:
            user_prompt.extend([
                "",
                "Task: write a strong product description that helps an AI assistant confidently answer customer questions and helps humans understand the product quickly.",
            ])

        description = await llm_service.complete(
            system_prompt=system_prompt,
            user_message="\n".join(user_prompt),
            max_tokens=500,
        )
        return ProductDescriptionResponse(description=description.strip())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
