import { ConfigService } from '@nestjs/config';

/**
 * Whether the agentic tool-use path is enabled. Default ON — it is only disabled when the
 * REGISTRATION_AGENTIC env var is explicitly set to a falsy value (kill-switch for prod).
 * Kept under the existing REGISTRATION_AGENTIC name so deployments don't need to re-key env.
 */
export function isAgenticEnabled(config: ConfigService): boolean {
  const flag = (config.get<string>('REGISTRATION_AGENTIC') ?? '').trim().toLowerCase();
  return !(flag === 'false' || flag === '0' || flag === 'no' || flag === 'off');
}

/** Append a payment link to a reply only if it isn't already present (safety net for when the
 *  model composes its reply but omits the tool-returned link). Wording is neutral because this is
 *  shared by both event registration and commerce (store order) payment flows. */
export function ensurePaymentLink(reply: string, paymentUrl: string | undefined | null): string {
  const url = (paymentUrl ?? '').trim();
  if (!url) return reply;
  if (reply.includes(url)) return reply;
  return `${reply}\n\nTo complete your payment, please use this secure link:\n${url}`;
}
