import { Controller, Get, Post, Param, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { RegistrationsService } from './registrations.service';

@Public()
@Controller('public/tickets')
export class TicketController {
  constructor(private readonly svc: RegistrationsService) {}

  // Paystack redirects the customer's browser here after a registration payment
  // (callback_url set at initialize). We confirm server-side, then forward to the
  // ticket page. This is the primary confirmation path for chat-based registrants;
  // the webhook is a backstop. Both call the idempotent handlePaymentConfirmed.
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get('payment/callback')
  async paymentCallback(
    @Query('reference') reference: string | undefined,
    @Query('trxref') trxref: string | undefined,
    @Res() res: any,
  ) {
    const ref = (reference || trxref || '').trim();
    const result = await this.svc.confirmPaymentByReference(ref);
    const appUrl = this.svc.getPublicAppUrl();
    if (result?.entry?.id) {
      return res.redirect(`${appUrl}/ticket/${result.entry.id}`);
    }
    // Could not confirm (missing/invalid reference or verification failed) — send them
    // to a generic status page rather than a raw error.
    return res.redirect(`${appUrl}/ticket/unknown`);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get(':entryId')
  getTicket(@Param('entryId') entryId: string) {
    return this.svc.getPublicTicket(entryId);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':entryId/email-optin')
  optInEmail(@Param('entryId') entryId: string) {
    return this.svc.optInTixtronEmail(entryId);
  }
}
