import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private get aiUrl() {
    return this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
  }

  private get aiTimeoutMs() {
    const configured = Number(this.config.get<string>('AI_SERVICE_TIMEOUT_MS') ?? '10000');
    if (Number.isNaN(configured) || configured <= 0) return 10000;
    return configured;
  }

  private get internalApiKey() {
    const primary = (this.config.get<string>('INTERNAL_API_SECRET') ?? '').trim();
    if (primary) return primary;
    return (this.config.get<string>('AI_SERVICE_SECRET') ?? '').trim();
  }

  private get fileIngestEnabled() {
    return this.config.get<string>('KNOWLEDGE_FILE_INGEST_ENABLED') === 'true';
  }

  private async fetchAi(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.aiTimeoutMs);

    try {
      const internalKey = this.internalApiKey;
      const headers = new Headers(init.headers ?? undefined);
      if (internalKey) headers.set('X-Internal-Key', internalKey);

      return await fetch(`${this.aiUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? `timed out after ${this.aiTimeoutMs}ms`
          : error instanceof Error
            ? error.message
            : 'unknown network error';

      throw new ServiceUnavailableException(
        `AI service unreachable at ${this.aiUrl} (${reason}). Ensure the ai-service is running and AI_SERVICE_URL is correct.`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseResponse(res: Response): Promise<unknown> {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const message = `AI service error: ${res.status} ${JSON.stringify(data)}`;
      if (res.status >= 400 && res.status < 500) {
        throw new BadRequestException(message);
      }
      throw new InternalServerErrorException(message);
    }

    return data;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const res = await this.fetchAi(path, init);
    return this.parseResponse(res);
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async list(organizationId: string, botId?: string) {
    const suffix = botId ? `?bot_id=${encodeURIComponent(botId)}` : '';
    return this.request(`/api/v1/knowledge/${organizationId}/items${suffix}`, {
      method: 'GET',
    });
  }

  async ingestUrl(organizationId: string, url: string, name: string, botId?: string) {
    const knowledgeFileId = `kf_${organizationId}_${Date.now()}`;
    return this.post('/api/v1/knowledge/ingest/url', {
      organization_id: organizationId,
      knowledge_file_id: knowledgeFileId,
      url,
      name,
      bot_id: botId,
    });
  }

  async ingestText(organizationId: string, name: string, text: string, botId?: string) {
    const knowledgeFileId = `kf_${organizationId}_${Date.now()}`;
    return this.post('/api/v1/knowledge/ingest/text', {
      organization_id: organizationId,
      knowledge_file_id: knowledgeFileId,
      name,
      text,
      bot_id: botId,
    });
  }

  async ingestFile(
    organizationId: string,
    name: string,
    buffer: Buffer,
    originalname: string,
    mimetype: string,
    botId?: string,
  ) {
    if (!this.fileIngestEnabled) {
      throw new BadRequestException('Knowledge file ingest is disabled. Use URL or text ingestion for now.');
    }

    const knowledgeFileId = `kf_${organizationId}_${Date.now()}`;
    const form = new FormData();
    form.append('organization_id', organizationId);
    form.append('knowledge_file_id', knowledgeFileId);
    if (botId) form.append('bot_id', botId);
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimetype }), originalname);

    const res = await this.fetchAi('/api/v1/knowledge/ingest/file', {
      method: 'POST',
      body: form,
    });
    return this.parseResponse(res);
  }

  async deleteOne(organizationId: string, knowledgeFileId: string) {
    return this.request(`/api/v1/knowledge/${organizationId}/items/${knowledgeFileId}`, {
      method: 'DELETE',
    });
  }

  async deleteAll(organizationId: string) {
    return this.request(`/api/v1/knowledge/${organizationId}`, {
      method: 'DELETE',
    });
  }

  async listSuggestions(organizationId: string, status?: string) {
    return this.prisma.knowledgeSuggestion.findMany({
      where: {
        organizationId,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        thread: {
          select: {
            id: true,
            topic: true,
            question: true,
            assignedUser: { select: { id: true, name: true, email: true } },
          },
        },
        conversation: {
          select: {
            id: true,
            customerName: true,
            customerEmail: true,
            customerUsername: true,
            channel: true,
          },
        },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async updateSuggestion(
    organizationId: string,
    suggestionId: string,
    data: { title?: string; content?: string },
  ) {
    const existing = await this.prisma.knowledgeSuggestion.findFirst({
      where: { id: suggestionId, organizationId },
    });
    if (!existing) throw new NotFoundException('Knowledge suggestion not found');
    if (existing.status !== 'PENDING') {
      throw new BadRequestException('Only pending suggestions can be edited');
    }
    return this.prisma.knowledgeSuggestion.update({
      where: { id: suggestionId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.content !== undefined ? { content: data.content } : {}),
      },
    });
  }

  async approveSuggestion(
    organizationId: string,
    suggestionId: string,
    reviewerId: string,
  ) {
    const suggestion = await this.prisma.knowledgeSuggestion.findFirst({
      where: { id: suggestionId, organizationId },
    });
    if (!suggestion) throw new NotFoundException('Knowledge suggestion not found');
    if (suggestion.status !== 'PENDING') {
      throw new BadRequestException('Only pending suggestions can be approved');
    }

    const ingestResult = await this.ingestText(organizationId, suggestion.title, suggestion.content);

    const updated = await this.prisma.knowledgeSuggestion.update({
      where: { id: suggestionId },
      data: {
        status: 'APPROVED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        metadata: {
          ...((suggestion.metadata as Record<string, unknown>) ?? {}),
          ingestResult: ingestResult as Record<string, unknown>,
        } as any,
      },
    });

    if (suggestion.threadId) {
      await this.prisma.escalationThread.update({
        where: { id: suggestion.threadId },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      }).catch(() => null);
    }

    return updated;
  }

  async rejectSuggestion(
    organizationId: string,
    suggestionId: string,
    reviewerId: string,
    reason?: string,
  ) {
    const suggestion = await this.prisma.knowledgeSuggestion.findFirst({
      where: { id: suggestionId, organizationId },
    });
    if (!suggestion) throw new NotFoundException('Knowledge suggestion not found');
    if (suggestion.status !== 'PENDING') {
      throw new BadRequestException('Only pending suggestions can be rejected');
    }

    return this.prisma.knowledgeSuggestion.update({
      where: { id: suggestionId },
      data: {
        status: 'REJECTED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        metadata: {
          ...((suggestion.metadata as Record<string, unknown>) ?? {}),
          rejectionReason: reason ?? null,
        } as any,
      },
    });
  }

  async listGaps(
    organizationId: string,
    status?: 'OPEN' | 'ANSWERED' | 'RESOLVED' | 'DISMISSED',
  ) {
    return this.prisma.knowledgeGap.findMany({
      where: {
        organizationId,
        ...(status ? { status } : {}),
      },
      include: {
        thread: {
          select: {
            id: true,
            topic: true,
            question: true,
            status: true,
            assignedUser: { select: { id: true, name: true, email: true } },
          },
        },
        conversation: {
          select: {
            id: true,
            customerName: true,
            customerEmail: true,
            customerUsername: true,
            channel: true,
            status: true,
          },
        },
      },
      orderBy: [{ lastSeenAt: 'desc' }, { seenCount: 'desc' }],
      take: 200,
    });
  }

  async updateGapStatus(
    organizationId: string,
    gapId: string,
    status: 'OPEN' | 'ANSWERED' | 'RESOLVED' | 'DISMISSED',
  ) {
    const existing = await this.prisma.knowledgeGap.findFirst({
      where: { id: gapId, organizationId },
    });
    if (!existing) throw new NotFoundException('Knowledge gap not found');

    return this.prisma.knowledgeGap.update({
      where: { id: gapId },
      data: {
        status,
        lastSeenAt: new Date(),
      },
    });
  }
}
