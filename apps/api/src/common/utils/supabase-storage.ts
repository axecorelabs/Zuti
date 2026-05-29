import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface SupabaseStorageConfig {
  url: string;
  serviceRoleKey: string;
  bucket: string;
  publicBucket: boolean;
  publicBaseUrl?: string;
  signedUrlExpiresSeconds: number;
}

export interface SupabaseUploadResult {
  storageKey: string;
  publicUrl?: string;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function sanitizeFileName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned.length > 0 ? cleaned : 'file';
}

export function resolveSupabaseStorageConfig(config: ConfigService): SupabaseStorageConfig | null {
  const url = (config.get<string>('SUPABASE_URL') ?? '').trim();
  const serviceRoleKey = (config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  const bucket = (config.get<string>('SUPABASE_STORAGE_BUCKET') ?? 'media').trim();
  if (!url || !serviceRoleKey || !bucket) return null;

  const publicBucketRaw = (config.get<string>('SUPABASE_STORAGE_PUBLIC') ?? 'false').trim().toLowerCase();
  const publicBucket = publicBucketRaw === 'true' || publicBucketRaw === '1' || publicBucketRaw === 'yes';
  const publicBaseUrl = (config.get<string>('SUPABASE_STORAGE_PUBLIC_BASE_URL') ?? '').trim() || undefined;
  const signedUrlExpiresRaw = Number.parseInt((config.get<string>('SUPABASE_STORAGE_SIGNED_URL_EXPIRES_SECONDS') ?? '604800').trim(), 10);
  const signedUrlExpiresSeconds = Number.isFinite(signedUrlExpiresRaw) && signedUrlExpiresRaw > 0
    ? signedUrlExpiresRaw
    : 604800;

  return {
    url: normalizeUrl(url),
    serviceRoleKey,
    bucket,
    publicBucket,
    publicBaseUrl,
    signedUrlExpiresSeconds,
  };
}

async function createSignedObjectUrl(
  storage: SupabaseStorageConfig,
  storageKey: string,
): Promise<string | undefined> {
  const endpoint = `${storage.url}/storage/v1/object/sign/${encodeURIComponent(storage.bucket)}/${storageKey}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${storage.serviceRoleKey}`,
      apikey: storage.serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: storage.signedUrlExpiresSeconds }),
  });
  if (!response.ok) return undefined;
  const payload = (await response.json().catch(() => ({}))) as { signedURL?: string; signedUrl?: string };
  const raw = payload.signedURL ?? payload.signedUrl;
  if (!raw) return undefined;
  if (raw.startsWith('http')) return raw;
  if (raw.startsWith('/storage/v1/')) return `${storage.url}${raw}`;
  if (raw.startsWith('/object/')) return `${storage.url}/storage/v1${raw}`;
  return `${storage.url}/storage/v1/${raw.replace(/^\/+/, '')}`;
}

export async function uploadBufferToSupabaseStorage(
  storage: SupabaseStorageConfig,
  input: {
    buffer: Buffer;
    mimeType: string;
    organizationId: string;
    channel: string;
    fileName?: string;
  },
): Promise<SupabaseUploadResult> {
  const safeFileName = sanitizeFileName(input.fileName ?? 'file');
  const ext = safeFileName.includes('.') ? '' : '.bin';
  const storageKey = [
    'org',
    input.organizationId,
    input.channel.toLowerCase(),
    new Date().toISOString().slice(0, 10),
    `${randomUUID()}-${safeFileName}${ext}`,
  ].join('/');

  const endpoint = `${storage.url}/storage/v1/object/${encodeURIComponent(storage.bucket)}/${storageKey}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${storage.serviceRoleKey}`,
      apikey: storage.serviceRoleKey,
      'Content-Type': input.mimeType || 'application/octet-stream',
      'x-upsert': 'false',
    },
    body: new Uint8Array(input.buffer),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => 'unknown error');
    throw new Error(`Supabase Storage upload failed (${response.status}): ${detail}`);
  }

  const publicUrl = storage.publicBucket
    ? `${normalizeUrl(storage.publicBaseUrl ?? storage.url)}/storage/v1/object/public/${encodeURIComponent(storage.bucket)}/${storageKey}`
    : await createSignedObjectUrl(storage, storageKey);

  return { storageKey, publicUrl };
}
