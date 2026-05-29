-- Add MEDIA_TRANSCRIPTION and MEDIA_VISION to the AiUsageType enum
-- These track Groq Whisper transcription and OpenRouter vision API calls for metering/billing.

ALTER TYPE "AiUsageType" ADD VALUE IF NOT EXISTS 'MEDIA_TRANSCRIPTION';
ALTER TYPE "AiUsageType" ADD VALUE IF NOT EXISTS 'MEDIA_VISION';
