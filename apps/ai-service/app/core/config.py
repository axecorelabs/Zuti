from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_ENV: str = "development"
    SECRET_KEY: str = ""
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3001"]

    # LLM — OpenRouter for completions, Jina AI for embeddings
    OPENROUTER_API_KEY: str = ""
    JINA_API_KEY: str = ""  # https://jina.ai — free 1M tokens/month

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

    class Config:
        env_file = "../../.env"
        extra = "ignore"


settings = Settings()
