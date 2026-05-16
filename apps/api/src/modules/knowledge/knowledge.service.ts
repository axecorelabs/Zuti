import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get aiUrl() {
    return this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
  }

  async ingestUrl(organizationId: string, url: string, name: string) {
    const knowledgeFileId = `kf_${organizationId}_${Date.now()}`;
    try {
      const res = await firstValueFrom(
        this.http.post(`${this.aiUrl}/api/v1/knowledge/ingest/url`, {
          organization_id: organizationId,
          knowledge_file_id: knowledgeFileId,
          url,
          name,
        }),
      );
      return res.data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(`AI service error: ${msg}`);
    }
  }

  async ingestText(organizationId: string, name: string, text: string) {
    const knowledgeFileId = `kf_${organizationId}_${Date.now()}`;
    try {
      const res = await firstValueFrom(
        this.http.post(`${this.aiUrl}/api/v1/knowledge/ingest/text`, {
          organization_id: organizationId,
          knowledge_file_id: knowledgeFileId,
          name,
          text,
        }),
      );
      return res.data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(`AI service error: ${msg}`);
    }
  }

  async ingestFile(
    organizationId: string,
    name: string,
    buffer: Buffer,
    originalname: string,
    mimetype: string,
  ) {
    const knowledgeFileId = `kf_${organizationId}_${Date.now()}`;
    const form = new FormData();
    form.append('organization_id', organizationId);
    form.append('knowledge_file_id', knowledgeFileId);
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimetype }), originalname);

    try {
      const res = await firstValueFrom(
        this.http.post(`${this.aiUrl}/api/v1/knowledge/ingest/file`, form),
      );
      return res.data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(`AI service error: ${msg}`);
    }
  }
}
