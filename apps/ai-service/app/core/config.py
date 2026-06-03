from pathlib import Path
from pydantic_settings import BaseSettings

# Resolve .env from the monorepo root regardless of CWD
_ENV_FILE = Path(__file__).parent.parent.parent.parent.parent / ".env"


class Settings(BaseSettings):
    APP_ENV: str = "development"
    SECRET_KEY: str = ""
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3001"]

    # LLM — OpenRouter for completions, Jina AI for embeddings
    OPENROUTER_API_KEY: str = ""
    JINA_API_KEY: str = ""  # https://jina.ai — free 1M tokens/month

    # OpenAI — used for Whisper audio transcription (leave blank to use Groq instead)
    OPENAI_API_KEY: str = ""

    # Whisper transcription — configurable provider (Groq, OpenAI, or any OpenAI-compatible)
    # If WHISPER_API_KEY is set it takes priority over OPENAI_API_KEY
    WHISPER_API_KEY: str = ""  # e.g. Groq key: gsk_...
    WHISPER_API_BASE_URL: str = "https://api.openai.com/v1"  # Groq: https://api.groq.com/openai/v1
    WHISPER_MODEL: str = "whisper-1"  # Groq: whisper-large-v3-turbo
    WHISPER_LANGUAGE: str = ""  # Optional ISO code, e.g. "yo" for Yoruba
    WHISPER_PROMPT: str = ""  # Optional style/domain hint for transcription

    # Media processing (transcription, image description, document extraction)
    MEDIA_PROCESSING_ENABLED: bool = True
    MEDIA_VISION_MODEL: str = "google/gemini-2.0-flash-001"

    # Shared secret for internal API calls (NestJS → AI service).
    # Set INTERNAL_API_SECRET to a strong random string in both services.
    # Leave blank to disable auth (development only).
    INTERNAL_API_SECRET: str = ""

    # Qdrant
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str = ""

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # Storage
    R2_ACCOUNT_ID: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = ""

    # Knowledge ingest controls
    KNOWLEDGE_FILE_INGEST_ENABLED: bool = False

    # Uploaded file safety / virus scanning
    FILE_SCAN_URL: str = ""
    FILE_SCAN_REQUIRED: bool = True
    FILE_SCAN_TIMEOUT_MS: int = 10000

    class Config:
        env_file = str(_ENV_FILE)
        extra = "ignore"


settings = Settings()
