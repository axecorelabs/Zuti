import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { HttpService } from '@nestjs/axios';
import { BadRequestException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

export type WhatsAppProvider = 'META' | 'TWILIO';

export interface WhatsAppBotConnection {
  provider: WhatsAppProvider | null | undefined;
  channelIdentifier: string | null | undefined;
  phoneNumber?: string | null | undefined;
  config?: unknown;
}

type EncryptedSecretEnvelope = {
  __enc_v: 1;
  iv: string;
  tag: string;
  data: string;
};

const ENCRYPTED_SECRET_VERSION = 1;
const SECRET_FIELDS_BY_PROVIDER: Record<WhatsAppProvider, string[]> = {
  META: ['accessToken', 'appSecret'],
  TWILIO: ['authToken'],
};

function base64UrlEncode(value: Buffer): string {
  return value.toString('base64url');
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function deriveEncryptionKey(): Buffer | null {
  const raw = (process.env.APP_ENCRYPTION_KEY ?? '').trim();
  if (!raw) return null;

  if (/^[a-fA-F0-9]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  const base64Candidate = Buffer.from(raw, 'base64');
  if (base64Candidate.length === 32) {
    return base64Candidate;
  }

  return createHash('sha256').update(raw).digest();
}

function isEncryptedSecretEnvelope(value: unknown): value is EncryptedSecretEnvelope {
  return Boolean(
    value
      && typeof value === 'object'
      && !Array.isArray(value)
      && (value as Record<string, unknown>).__enc_v === ENCRYPTED_SECRET_VERSION
      && typeof (value as Record<string, unknown>).iv === 'string'
      && typeof (value as Record<string, unknown>).tag === 'string'
      && typeof (value as Record<string, unknown>).data === 'string',
  );
}

function encryptSecretValue(value: string, key: Buffer): EncryptedSecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    __enc_v: ENCRYPTED_SECRET_VERSION,
    iv: base64UrlEncode(iv),
    tag: base64UrlEncode(tag),
    data: base64UrlEncode(encrypted),
  };
}

function decryptSecretValue(value: unknown, key: Buffer | null): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (!isEncryptedSecretEnvelope(value)) {
    return null;
  }

  if (!key) {
    return null;
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, base64UrlDecode(value.iv));
    decipher.setAuthTag(base64UrlDecode(value.tag));
    const decrypted = Buffer.concat([
      decipher.update(base64UrlDecode(value.data)),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function prepareWhatsAppConfigForStorage(
  provider: WhatsAppProvider,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const key = deriveEncryptionKey();
  if (!key) {
    throw new BadRequestException('APP_ENCRYPTION_KEY must be configured before connecting WhatsApp');
  }

  const secretFields = SECRET_FIELDS_BY_PROVIDER[provider];
  const next: Record<string, unknown> = { ...config };

  for (const field of secretFields) {
    const raw = next[field];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    next[field] = encryptSecretValue(trimmed, key);
  }

  return next;
}

export function extractWhatsAppConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }

  const key = deriveEncryptionKey();
  const raw = config as Record<string, unknown>;
  const output: Record<string, unknown> = { ...raw };

  for (const field of ['accessToken', 'appSecret', 'authToken']) {
    const decrypted = decryptSecretValue(raw[field], key);
    if (decrypted !== null) {
      output[field] = decrypted;
    }
  }

  return output;
}

export function normalizeWhatsAppPhoneNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('whatsapp:')) return trimmed;
  return trimmed.startsWith('+') ? trimmed : `+${trimmed.replace(/^\+/, '')}`;
}

export function verifyMetaWebhookSignature(appSecret: string, rawBody: Buffer, signatureHeader?: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const expectedDigest = createHash('sha256').update(expected).digest();
  const actualDigest = createHash('sha256').update(signatureHeader).digest();
  return timingSafeEqual(expectedDigest, actualDigest);
}

export function verifyTwilioWebhookSignature(
  authToken: string,
  signatureHeader: string | undefined,
  url: string,
  params: Record<string, string | string[] | undefined>,
): boolean {
  if (!signatureHeader) return false;

  const sortedKeys = Object.keys(params).sort();
  let payload = url;
  for (const key of sortedKeys) {
    const value = params[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        payload += key + item;
      }
      continue;
    }
    if (typeof value === 'string') {
      payload += key + value;
    }
  }

  const expected = createHmac('sha1', authToken).update(payload).digest('base64');
  const expectedDigest = createHash('sha256').update(expected).digest();
  const actualDigest = createHash('sha256').update(signatureHeader).digest();
  return timingSafeEqual(expectedDigest, actualDigest);
}

export async function sendWhatsAppText(
  http: HttpService,
  connection: WhatsAppBotConnection,
  to: string,
  text: string,
): Promise<void> {
  const provider = connection.provider;
  const channelIdentifier = connection.channelIdentifier?.trim();
  const config = extractWhatsAppConfig(connection.config);
  const normalizedRecipient = normalizeWhatsAppPhoneNumber(to);

  if (!provider || !channelIdentifier || !normalizedRecipient) {
    throw new BadRequestException('WhatsApp channel is not fully configured');
  }

  if (provider === 'META') {
    const accessToken = typeof config.accessToken === 'string' ? config.accessToken.trim() : '';
    if (!accessToken) throw new BadRequestException('Meta WhatsApp access token is missing');

    await firstValueFrom(
      http.post(
        `https://graph.facebook.com/v20.0/${channelIdentifier}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizedRecipient.replace(/^whatsapp:/, ''),
          type: 'text',
          text: { body: text },
        },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      ),
    );
    return;
  }

  if (provider === 'TWILIO') {
    const accountSid = typeof config.accountSid === 'string' ? config.accountSid.trim() : '';
    const authToken = typeof config.authToken === 'string' ? config.authToken.trim() : '';
    const messagingServiceSid = typeof config.messagingServiceSid === 'string' ? config.messagingServiceSid.trim() : '';
    if (!accountSid || !authToken) throw new BadRequestException('Twilio credentials are missing');

    const form = new URLSearchParams();
    form.set('To', normalizedRecipient.startsWith('whatsapp:') ? normalizedRecipient : `whatsapp:${normalizedRecipient}`);
    form.set('Body', text);
    if (messagingServiceSid) {
      form.set('MessagingServiceSid', messagingServiceSid);
    } else {
      form.set('From', channelIdentifier.startsWith('whatsapp:') ? channelIdentifier : `whatsapp:${channelIdentifier}`);
    }

    await firstValueFrom(
      http.post(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        form.toString(),
        {
          auth: { username: accountSid, password: authToken },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      ),
    );
    return;
  }

  throw new BadRequestException('Unsupported WhatsApp provider');
}

/**
 * Show WhatsApp's "typing…" indicator to the customer while the AI composes a reply. Meta-only
 * (Twilio's WhatsApp API has no typing indicator). It piggybacks on the read receipt for the
 * customer's incoming message, so it needs that message's WAMID. Meta keeps the indicator up for up
 * to ~25s and clears it the moment our reply is delivered, so a single call covers the whole wait —
 * no keep-alive needed. Fire-and-forget by contract: callers should not let a failure here affect
 * message handling.
 */
export async function sendWhatsAppTypingIndicator(
  http: HttpService,
  connection: WhatsAppBotConnection,
  incomingMessageId: string | null | undefined,
): Promise<void> {
  if (connection.provider !== 'META') return; // Twilio: no typing indicator
  const channelIdentifier = connection.channelIdentifier?.trim();
  const messageId = (incomingMessageId ?? '').trim();
  if (!channelIdentifier || !messageId) return;

  const config = extractWhatsAppConfig(connection.config);
  const accessToken = typeof config.accessToken === 'string' ? config.accessToken.trim() : '';
  if (!accessToken) return;

  await firstValueFrom(
    http.post(
      `https://graph.facebook.com/v20.0/${channelIdentifier}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    ),
  );
}
