from fastapi import APIRouter
from app.api.v1.endpoints import chat, csat, knowledge, health, summarize, action_intent, language

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(csat.router, prefix="/csat", tags=["csat"])
api_router.include_router(action_intent.router, prefix="/action-intent", tags=["action-intent"])
api_router.include_router(language.router, prefix="/language", tags=["language"])
api_router.include_router(knowledge.router, prefix="/knowledge", tags=["knowledge"])
api_router.include_router(summarize.router, prefix="/summarize", tags=["summarize"])
