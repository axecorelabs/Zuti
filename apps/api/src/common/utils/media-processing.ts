import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const logger = new Logger('MediaProcessing');

export interface MediaProcessResult {
  kind: string;  // transcript | image_description | document_text | unsupported | disabled
  text: string | null;
  error: string | null;
}

/**
 * Ask the AI service to extract usable text from a media file
 * (transcription for audio/voice, description for images, text extraction for documents).
 * Returns null only when AI service URL is not configured.
 */
export async function callMediaProcess(
  config: ConfigService,
  bytes: Buffer,
  mimeType: string,
  fileName?: string,
): Promise<MediaProcessResult | null> {
  const aiServiceUrl = (config.get<string>('AI_SERVICE_URL') ?? '').trim();
  if (!aiServiceUrl) return null;

  try {
    const internalKey = (config.get<string>('INTERNAL_API_SECRET') ?? '').trim();
    const response = await fetch(`${aiServiceUrl}/api/v1/media/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(internalKey ? { 'X-Internal-Key': internalKey } : {}),
      },
      body: JSON.stringify({
        content_base64: bytes.toString('base64'),
        mime_type: mimeType,
        filename: fileName ?? null,
      }),
      signal: AbortSignal.timeout(60_000), // 60 s for Whisper transcription
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).trim();
      const message = `media process endpoint returned ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`;
      logger.warn(`${message} for ${fileName ?? mimeType}`);
      return {
        kind: 'unsupported',
        text: null,
        error: message,
      };
    }

    return (await response.json()) as MediaProcessResult;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`Media processing call failed for ${fileName ?? mimeType}: ${reason}`);
    return {
      kind: 'unsupported',
      text: null,
      error: `media processing call failed: ${reason}`,
    };
  }
}
