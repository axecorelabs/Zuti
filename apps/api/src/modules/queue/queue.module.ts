import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const TELEGRAM_QUEUE = 'telegram-messages';
export const EMAIL_QUEUE = 'email-messages';
export const ACTION_FORWARDING_QUEUE = 'action-forwarding';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      }),
    }),
    BullModule.registerQueue({ name: TELEGRAM_QUEUE }),
    BullModule.registerQueue({ name: EMAIL_QUEUE }),
    BullModule.registerQueue({ name: ACTION_FORWARDING_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
