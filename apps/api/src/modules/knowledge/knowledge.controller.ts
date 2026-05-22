import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth } from '@nestjs/swagger';
import { KnowledgeService } from './knowledge.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RolesGuard, RequireRole } from '../../common/guards/roles.guard';

class IngestUrlDto {
  @IsString() @IsNotEmpty() url: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() botId?: string;
}

class IngestTextDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() text: string;
  @IsOptional() @IsString() botId?: string;
}

class UpdateSuggestionDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() content?: string;
}

class RejectSuggestionDto {
  @IsOptional() @IsString() reason?: string;
}

class UpdateGapStatusDto {
  @IsString()
  @IsNotEmpty()
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED' | 'DISMISSED';
}

@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@RequireRole('OWNER', 'ADMIN')
@Controller('organizations/:id/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@Param('id') orgId: string, @Query('botId') botId?: string) {
    return this.knowledge.list(orgId, botId);
  }

  @Get('suggestions')
  listSuggestions(@Param('id') orgId: string, @Query('status') status?: string) {
    return this.knowledge.listSuggestions(orgId, status);
  }

  @Get('gaps')
  listGaps(
    @Param('id') orgId: string,
    @Query('status') status?: 'OPEN' | 'ANSWERED' | 'RESOLVED' | 'DISMISSED',
  ) {
    return this.knowledge.listGaps(orgId, status);
  }

  @Patch('suggestions/:suggestionId')
  updateSuggestion(
    @Param('id') orgId: string,
    @Param('suggestionId') suggestionId: string,
    @Body() dto: UpdateSuggestionDto,
  ) {
    return this.knowledge.updateSuggestion(orgId, suggestionId, dto);
  }

  @Post('suggestions/:suggestionId/approve')
  approveSuggestion(
    @Param('id') orgId: string,
    @Param('suggestionId') suggestionId: string,
    @Req() req: any,
  ) {
    return this.knowledge.approveSuggestion(orgId, suggestionId, req.user.id);
  }

  @Post('suggestions/:suggestionId/reject')
  rejectSuggestion(
    @Param('id') orgId: string,
    @Param('suggestionId') suggestionId: string,
    @Body() dto: RejectSuggestionDto,
    @Req() req: any,
  ) {
    return this.knowledge.rejectSuggestion(orgId, suggestionId, req.user.id, dto.reason);
  }

  @Post('gaps/:gapId/status')
  updateGapStatus(
    @Param('id') orgId: string,
    @Param('gapId') gapId: string,
    @Body() dto: UpdateGapStatusDto,
  ) {
    return this.knowledge.updateGapStatus(orgId, gapId, dto.status);
  }

  @Post('ingest/url')
  ingestUrl(@Param('id') orgId: string, @Body() dto: IngestUrlDto) {
    return this.knowledge.ingestUrl(orgId, dto.url, dto.name, dto.botId);
  }

  @Post('ingest/text')
  ingestText(@Param('id') orgId: string, @Body() dto: IngestTextDto) {
    return this.knowledge.ingestText(orgId, dto.name, dto.text, dto.botId);
  }

  @Post('ingest/file')
  @UseInterceptors(FileInterceptor('file'))
  ingestFile(
    @Param('id') orgId: string,
    @Body('name') name: string,
    @Body('botId') botId: string | undefined,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    return this.knowledge.ingestFile(
      orgId,
      name ?? file.originalname,
      file.buffer,
      file.originalname,
      file.mimetype,
      botId,
    );
  }

  @Delete(':knowledgeFileId')
  deleteOne(@Param('id') orgId: string, @Param('knowledgeFileId') knowledgeFileId: string) {
    return this.knowledge.deleteOne(orgId, knowledgeFileId);
  }

  @Delete()
  deleteAll(@Param('id') orgId: string) {
    return this.knowledge.deleteAll(orgId);
  }
}
