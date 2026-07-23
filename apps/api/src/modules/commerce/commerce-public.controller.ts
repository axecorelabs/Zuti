import { Controller, Get, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CommerceService } from './commerce.service';

@ApiExcludeController()
@Public()
@Controller('public/commerce')
export class CommercePublicController {
  constructor(private readonly commerce: CommerceService) {}

  // Paystack redirects the customer's browser here after a bot commerce payment (callback_url set at
  // initialize). We verify server-side, then show a simple status page. The webhook is the other fast
  // path and the reconciliation sweep is the guarantee — all idempotent.
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get('payment/callback')
  async paymentCallback(
    @Query('reference') reference: string | undefined,
    @Query('trxref') trxref: string | undefined,
    @Res() res: any,
  ) {
    const ref = (reference || trxref || '').trim();
    const result = await this.commerce.confirmCommercePaymentByReference(ref);
    const paid = result?.paid === true;
    const title = paid ? 'Payment received' : 'Payment is being confirmed';
    const body = paid
      ? 'Thank you! Your payment was received and your order is confirmed. You can close this page.'
      : 'Thanks! If you completed payment, your order will be confirmed shortly — you can close this page and check your chat.';
    res.set('Content-Type', 'text/html');
    return res.send(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/>` +
        `<title>${title}</title><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0b0e;color:#e5e7eb;` +
        `display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}` +
        `.card{max-width:420px;text-align:center;background:#151519;border:1px solid #26262c;border-radius:16px;padding:32px}` +
        `.badge{width:56px;height:56px;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;` +
        `font-size:28px;background:${paid ? 'rgba(16,185,129,.15)' : 'rgba(245,158,11,.15)'};` +
        `border:1px solid ${paid ? 'rgba(16,185,129,.35)' : 'rgba(245,158,11,.35)'}}` +
        `h1{font-size:18px;margin:0 0 8px}p{color:#9ca3af;font-size:14px;line-height:1.5;margin:0}</style></head>` +
        `<body><div class="card"><div class="badge">${paid ? '✓' : '⏳'}</div><h1>${title}</h1><p>${body}</p></div></body></html>`,
    );
  }
}
