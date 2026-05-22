import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiUsageController } from './ai-usage.controller';
import { AiUsageService } from './ai-usage.service';
import { CsatClassifierService } from './csat-classifier.service';

@Module({
  imports: [HttpModule],
  controllers: [AiUsageController],
  providers: [AiUsageService, CsatClassifierService],
  exports: [AiUsageService, CsatClassifierService],
})
export class AiUsageModule {}
