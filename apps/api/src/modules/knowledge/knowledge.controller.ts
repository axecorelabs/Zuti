import {
  Controller,
  Post,
  Body,
  Param,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeService } from './knowledge.service';

class IngestUrlDto {
  url: string;
  name: string;
}

class IngestTextDto {
  name: string;
  text: string;
}

@Controller('organizations/:id/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

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
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.knowledge.ingestFile(
      orgId,
      name ?? file.originalname,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }
}
