import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth } from '@nestjs/swagger';
import { KnowledgeService } from './knowledge.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RolesGuard, RequireRole } from '../../common/guards/roles.guard';

class IngestUrlDto {
  @IsString() @IsNotEmpty() url: string;
  @IsString() @IsNotEmpty() name: string;
}

class IngestTextDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() text: string;
}

@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@RequireRole('OWNER', 'ADMIN')
@Controller('organizations/:id/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@Param('id') orgId: string) {
    return this.knowledge.list(orgId);
  }

  @Post('ingest/url')
  ingestUrl(@Param('id') orgId: string, @Body() dto: IngestUrlDto) {
    return this.knowledge.ingestUrl(orgId, dto.url, dto.name);
  }

  @Post('ingest/text')
  ingestText(@Param('id') orgId: string, @Body() dto: IngestTextDto) {
    return this.knowledge.ingestText(orgId, dto.name, dto.text);
  }

  @Post('ingest/file')
  @UseInterceptors(FileInterceptor('file'))
  ingestFile(
    @Param('id') orgId: string,
    @Body('name') name: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    return this.knowledge.ingestFile(
      orgId,
      name ?? file.originalname,
      file.buffer,
      file.originalname,
      file.mimetype,
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
