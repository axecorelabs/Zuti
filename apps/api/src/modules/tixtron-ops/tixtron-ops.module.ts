import { Module } from '@nestjs/common';
import { TixtronOpsController } from './tixtron-ops.controller';
import { TixtronOpsService } from './tixtron-ops.service';

@Module({
  controllers: [TixtronOpsController],
  providers: [TixtronOpsService],
  exports: [TixtronOpsService],
})
export class TixtronOpsModule {}
