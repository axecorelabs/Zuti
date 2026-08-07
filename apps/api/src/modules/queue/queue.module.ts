import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const TELEGRAM_QUEUE = 'telegram-messages';
export const EMAIL_QUEUE = 'email-messages';
export const WHATSAPP_QUEUE = 'whatsapp-messages';
export const ACTION_FORWARDING_QUEUE = 'action-forwarding';
export const RECEIPTS_QUEUE = 'receipts';
export const MARKETING_QUEUE = 'marketing-broadcasts';
export const PAYSTACK_WEBHOOK_QUEUE = 'paystack-webhooks';

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
    BullModule.registerQueue({ name: WHATSAPP_QUEUE }),
    BullModule.registerQueue({ name: ACTION_FORWARDING_QUEUE }),
    BullModule.registerQueue({ name: RECEIPTS_QUEUE }),
    BullModule.registerQueue({ name: MARKETING_QUEUE }),
    BullModule.registerQueue({ name: PAYSTACK_WEBHOOK_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
