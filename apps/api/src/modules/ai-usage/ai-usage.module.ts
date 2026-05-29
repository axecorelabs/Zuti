import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiUsageController } from './ai-usage.controller';
import { AiUsageService } from './ai-usage.service';
import { CsatClassifierService } from './csat-classifier.service';
import { LanguagePreferenceService } from './language-preference.service';

@Module({
  imports: [HttpModule],
  controllers: [AiUsageController],
  providers: [AiUsageService, CsatClassifierService, LanguagePreferenceService],
  exports: [AiUsageService, CsatClassifierService, LanguagePreferenceService],
})
export class AiUsageModule {}
