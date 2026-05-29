import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { detectAffirmativeConfirmation } from '../../common/utils/language';

type Channel = 'WIDGET' | 'EMAIL' | 'TELEGRAM' | 'WHATSAPP';
type LanguageSource = 'auto' | 'user';

interface ConversationLanguagePreference {
  code?: string;
  source?: LanguageSource;
  confirmed?: boolean;
  confidence?: number;
  confirmationPromptedAt?: string;
  lastUpdatedAt?: string;
  lastDetectedAt?: string;
}

interface ClassifierResponse {
  detected_language_code?: string;
  confidence?: number;
  explicit_preference?: boolean;
  requested_language_code?: string | null;
}

interface ResolveLanguagePreferenceInput {
  userMessage: string;
  channel: Channel;
  metadata: unknown;
}

interface ResolveLanguagePreferenceResult {
  metadataPatch: Record<string, unknown>;
  promptBlock: string | null;
  languageCode: string | null;
  shouldAskConfirmation: boolean;
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  ar: 'Arabic',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
  tr: 'Turkish',
  hi: 'Hindi',
  sw: 'Swahili',
  nl: 'Dutch',
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeLanguageCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return null;
  const primary = normalized.split('-')[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

function normalizeConfidence(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

function detectLanguageFallback(message: string): string {
  if (/[\u0600-\u06FF]/.test(message)) return 'ar';
  if (/[\u0400-\u04FF]/.test(message)) return 'ru';
  if (/[\u3040-\u30FF]/.test(message)) return 'ja';
  if (/[\u4E00-\u9FFF]/.test(message)) return 'zh';
  if (/[\uAC00-\uD7AF]/.test(message)) return 'ko';
  if (/[\u0900-\u097F]/.test(message)) return 'hi';
  return 'en';
}

function detectExplicitLanguagePreferenceFallback(message: string): string | null {
  const lower = message.toLowerCase();
  const rules: Array<{ code: string; pattern: RegExp }> = [
    { code: 'en', pattern: /\b(english|speak english|in english)\b/ },
    { code: 'es', pattern: /\b(spanish|espanol|español|en español)\b/ },
    { code: 'fr', pattern: /\b(french|francais|français|en français)\b/ },
    { code: 'pt', pattern: /\b(portuguese|portugues|português|em português)\b/ },
    { code: 'ar', pattern: /\b(arabic|العربية|بالعربية)\b/ },
    { code: 'de', pattern: /\b(german|deutsch|auf deutsch)\b/ },
    { code: 'it', pattern: /\b(italian|italiano|in italiano)\b/ },
    { code: 'tr', pattern: /\b(turkish|turkce|türkçe)\b/ },
    { code: 'hi', pattern: /\b(hindi|हिंदी)\b/ },
    { code: 'sw', pattern: /\b(swahili|kiswahili)\b/ },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(lower)) return rule.code;
  }
  return null;
}

@Injectable()
export class LanguagePreferenceService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async resolveForTurn(input: ResolveLanguagePreferenceInput): Promise<ResolveLanguagePreferenceResult> {
    const metadata = asObject(input.metadata);
    const currentPreference = asObject(metadata.languagePreference) as ConversationLanguagePreference;
    const currentCode = normalizeLanguageCode(currentPreference.code);
    const currentConfirmed = currentPreference.confirmed === true;

    const classifier = await this.classifyWithAi(input.userMessage, currentCode);
    const detectedCode = normalizeLanguageCode(classifier.detected_language_code) ?? detectLanguageFallback(input.userMessage);
    const requestedCode = normalizeLanguageCode(classifier.requested_language_code)
      ?? detectExplicitLanguagePreferenceFallback(input.userMessage);
    const explicitPreference = classifier.explicit_preference === true || Boolean(requestedCode);
    const detectionConfidence = normalizeConfidence(classifier.confidence) ?? 0.4;

    const now = new Date().toISOString();
    let nextCode = currentCode;
    let nextSource: LanguageSource = currentPreference.source === 'user' ? 'user' : 'auto';
    let nextConfirmed = currentConfirmed;
    let shouldAskConfirmation = false;

    if (explicitPreference && requestedCode) {
      nextCode = requestedCode;
      nextSource = 'user';
      nextConfirmed = true;
    } else if (!nextConfirmed && currentPreference.confirmationPromptedAt && detectAffirmativeConfirmation(input.userMessage, currentCode ?? detectedCode)) {
      nextCode = nextCode ?? detectedCode;
      nextSource = 'user';
      nextConfirmed = true;
    } else if (!nextCode) {
      nextCode = detectedCode;
      nextSource = 'auto';
      nextConfirmed = false;
    } else if (!nextConfirmed && detectionConfidence >= 0.75 && detectedCode !== nextCode) {
      nextCode = detectedCode;
      nextSource = 'auto';
    }

    if (nextCode && !nextConfirmed && !currentPreference.confirmationPromptedAt) {
      shouldAskConfirmation = true;
    }

    const nextPreference: Record<string, unknown> = {
      code: nextCode,
      source: nextSource,
      confirmed: nextConfirmed,
      confidence: detectionConfidence,
      lastDetectedAt: now,
      lastUpdatedAt: now,
      ...(shouldAskConfirmation ? { confirmationPromptedAt: now } : {}),
      ...(!shouldAskConfirmation && currentPreference.confirmationPromptedAt ? { confirmationPromptedAt: currentPreference.confirmationPromptedAt } : {}),
    };

    const customerMemory = {
      ...asObject(metadata.customerMemory),
      preferredLanguage: nextCode,
      languageConfirmed: nextConfirmed,
      languageSource: nextSource,
      languageUpdatedAt: now,
    };

    return {
      metadataPatch: {
        languagePreference: nextPreference,
        customerMemory,
      },
      promptBlock: this.buildPromptBlock(nextCode, shouldAskConfirmation),
      languageCode: nextCode,
      shouldAskConfirmation,
    };
  }

  private async classifyWithAi(message: string, currentLanguageCode: string | null): Promise<ClassifierResponse> {
    const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';

    try {
      const response = await firstValueFrom(
        this.http.post<ClassifierResponse>(`${aiServiceUrl}/api/v1/language/classify`, {
          user_message: message,
          current_language_code: currentLanguageCode,
        }),
      );
      return response.data ?? {};
    } catch {
      return {};
    }
  }

  private buildPromptBlock(languageCode: string | null, shouldAskConfirmation: boolean): string | null {
    if (!languageCode) return null;

    const label = LANGUAGE_LABELS[languageCode] ?? languageCode;
    if (shouldAskConfirmation) {
      return [
        'Language behavior rules:',
        `- Reply in ${label} (${languageCode}) for this message.`,
        '- In the same language, end with one short question asking whether the customer wants to continue in this language or prefers another one.',
        '- Keep that confirmation question concise and friendly.',
      ].join('\n');
    }

    return [
      'Language behavior rules:',
      `- Preferred language for this conversation is ${label} (${languageCode}).`,
      '- Reply in this language unless the customer explicitly asks to switch languages.',
      '- If the customer asks to switch, honor it immediately and continue in the requested language.',
    ].join('\n');
  }
}
