import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsGateway } from './events.gateway';

@Global()
@Module({
  imports: [AuthModule, PrismaModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
