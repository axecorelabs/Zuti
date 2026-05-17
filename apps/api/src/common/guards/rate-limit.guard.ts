import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const forwardedFor = req.headers?.['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      return forwardedFor.split(',')[0].trim();
    }
    return req.ip;
  }

  protected generateKey(context: ExecutionContext, tracker: string, name: string): string {
    const req = context.switchToHttp().getRequest();
    const routePath = req?.route?.path as string | undefined;
    // Telegram can originate from shared IPs; key by botId for fair per-bot limits.
    if (routePath?.includes('webhooks/telegram') && req?.params?.botId) {
      return `${name}:telegram:${req.params.botId}`;
    }
    return super.generateKey(context, tracker, name);
  }
}