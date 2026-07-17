import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { RECEIPTS_QUEUE } from '../queue/queue.module';
import { RegistrationsService } from './registrations.service';
import { RegistrationsController } from './registrations.controller';
import { TicketController } from './ticket.controller';
import { ReceiptsProcessor } from '../queue/receipts.processor';

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    MailModule,
    BullModule.registerQueue({ name: RECEIPTS_QUEUE }),
  ],
  controllers: [RegistrationsController, TicketController],
  providers: [RegistrationsService, ReceiptsProcessor],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
