import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { EventsModule } from '../events/events.module';
import { RECEIPTS_QUEUE } from '../queue/queue.module';
import { RegistrationsService } from './registrations.service';
import { RegistrationsController } from './registrations.controller';
import { TicketController } from './ticket.controller';
import { EventPublicController } from './event-public.controller';
import { InternalRegistrationController } from './internal-registration.controller';
import { RegistrationsScheduler } from './registrations.scheduler';
import { ReceiptsProcessor } from '../queue/receipts.processor';

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    MailModule,
    EventsModule,
    BullModule.registerQueue({ name: RECEIPTS_QUEUE }),
  ],
  controllers: [RegistrationsController, TicketController, EventPublicController, InternalRegistrationController],
  providers: [RegistrationsService, ReceiptsProcessor, RegistrationsScheduler],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
