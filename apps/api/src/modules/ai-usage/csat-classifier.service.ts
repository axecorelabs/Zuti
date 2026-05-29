import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { detectCsatIntent, CsatIntent } from '../../common/utils/csat-intent';
import { AiUsageService } from './ai-usage.service';

interface ClassifyCsatInput {
  organizationId: string;
  botId?: string | null;
  conversationId?: string | null;
  channel: 'WIDGET' | 'EMAIL' | 'TELEGRAM' | 'WHATSAPP';
  userReply: string;
  lastAssistantMessage?: string | null;
  model?: string | null;
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? '').length / 4);
}

@Injectable()
export class CsatClassifierService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly aiUsage: AiUsageService,
  ) {}

  async classify(input: ClassifyCsatInput): Promise<CsatIntent> {
    const fallback = detectCsatIntent(input.userReply);
    const aiServiceUrl = this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${aiServiceUrl}/api/v1/csat/classify`, {
          user_message: input.userReply,
          last_assistant_message: input.lastAssistantMessage ?? null,
          model: input.model ?? undefined,
        }),
      );

      const intent = this.normalizeIntent(response.data?.intent);
      const promptTokens = estimateTokens({
        user_message: input.userReply,
        last_assistant_message: input.lastAssistantMessage ?? null,
      });
      const completionTokens = estimateTokens({ intent, confidence: response.data?.confidence ?? null });

      await this.aiUsage.record({
        organizationId: input.organizationId,
        botId: input.botId ?? null,
        conversationId: input.conversationId ?? null,
        usageType: 'CSAT_CLASSIFICATION',
        provider: 'openrouter',
        model: input.model ?? undefined,
        promptTokens,
        completionTokens,
        metadata: {
          channel: input.channel,
          source: 'semantic_classifier',
          intent,
          confidence: response.data?.confidence ?? null,
          fallbackIntent: fallback,
        },
      }).catch(() => null);

      return intent;
    } catch {
      await this.aiUsage.record({
        organizationId: input.organizationId,
        botId: input.botId ?? null,
        conversationId: input.conversationId ?? null,
        usageType: 'CSAT_CLASSIFICATION',
        provider: 'openrouter',
        model: input.model ?? undefined,
        promptTokens: 0,
        completionTokens: 0,
        metadata: {
          channel: input.channel,
          source: 'fallback_lexical',
          intent: fallback,
        },
      }).catch(() => null);

      return fallback;
    }
  }

  private normalizeIntent(value: unknown): CsatIntent {
    if (typeof value !== 'string') return 'unclear';
    const normalized = value.trim().toLowerCase();
    if (normalized === 'positive' || normalized === 'negative' || normalized === 'unclear') {
      return normalized;
    }
    return 'unclear';
  }
}
