import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCannedResponseDto {
  shortcut: string;
  title: string;
  content: string;
}

export interface UpdateCannedResponseDto {
  shortcut?: string;
  title?: string;
  content?: string;
}

@Injectable()
export class CannedResponsesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(organizationId: string) {
    return this.prisma.cannedResponse.findMany({
      where: { organizationId },
      orderBy: { shortcut: 'asc' },
    });
  }

  async create(organizationId: string, dto: CreateCannedResponseDto) {
    const shortcut = dto.shortcut.toLowerCase().replace(/\s+/g, '-');
    try {
      return await this.prisma.cannedResponse.create({
        data: { organizationId, shortcut, title: dto.title, content: dto.content },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(`Shortcut "/${shortcut}" already exists`);
      throw e;
    }
  }

  async update(organizationId: string, id: string, dto: UpdateCannedResponseDto) {
    const existing = await this.prisma.cannedResponse.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Canned response not found');
    const shortcut = dto.shortcut ? dto.shortcut.toLowerCase().replace(/\s+/g, '-') : undefined;
    try {
      return await this.prisma.cannedResponse.update({
        where: { id },
        data: {
          ...(shortcut !== undefined ? { shortcut } : {}),
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.content !== undefined ? { content: dto.content } : {}),
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(`Shortcut "/${shortcut}" already exists`);
      throw e;
    }
  }

  async remove(organizationId: string, id: string) {
    const existing = await this.prisma.cannedResponse.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Canned response not found');
    await this.prisma.cannedResponse.delete({ where: { id } });
  }

  /** Returns a compact string block for injection into the AI system prompt */
  async buildPromptBlock(organizationId: string): Promise<string | null> {
    const items = await this.findAll(organizationId);
    if (items.length === 0) return null;
    const lines = items.map((r) => `- [${r.title}] /${r.shortcut}: ${r.content}`);
    return `Approved response templates (use these verbatim or adapt naturally when the topic matches):\n${lines.join('\n')}`;
  }
}
