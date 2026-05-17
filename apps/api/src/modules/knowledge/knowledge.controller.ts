import {
  Controller,
  Post,
  Body,
  Param,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeService } from './knowledge.service';

class IngestUrlDto {
  @IsString() @IsNotEmpty() url: string;
  @IsString() @IsNotEmpty() name: string;
}

class IngestTextDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() text: string;
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
}
