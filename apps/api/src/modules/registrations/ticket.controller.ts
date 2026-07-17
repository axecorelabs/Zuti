import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { RegistrationsService } from './registrations.service';

@Public()
@Controller('public/tickets')
export class TicketController {
  constructor(private readonly svc: RegistrationsService) {}

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get(':entryId')
  getTicket(@Param('entryId') entryId: string) {
    return this.svc.getPublicTicket(entryId);
  }
}
