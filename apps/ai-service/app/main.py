import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.router import api_router

logging.basicConfig(level=logging.INFO)
_startup_logger = logging.getLogger("startup")

app = FastAPI(
    title="Zuti AI Service",
    version="0.0.1",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.on_event("startup")
async def _log_config():
    _startup_logger.info(
        "AI service starting — vision model: %s | openrouter key: %s | env file: %s",
        settings.MEDIA_VISION_MODEL,
        "set" if settings.OPENROUTER_API_KEY.strip() else "MISSING",
        str(settings.model_config.get("env_file", "n/a")) if hasattr(settings, "model_config") else "n/a",
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
