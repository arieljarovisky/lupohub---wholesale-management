import crypto from 'crypto';
import { canonicalStringify } from './canonicalJson';

export interface SignedWebhookPayload {
  canonicalJsonBody: string;
  signedPayload: string;
  signatureHex: string;
  signatureHeaderValue: string;
}

export function buildSignedWebhookPayload(
  secret: string,
  timestampSec: string | number,
  body: unknown
): SignedWebhookPayload {
  const canonicalJsonBody = canonicalStringify(body);
  const ts = String(timestampSec);
  const signedPayload = `${ts}.${canonicalJsonBody}`;
  const signatureHex = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  return {
    canonicalJsonBody,
    signedPayload,
    signatureHex,
    signatureHeaderValue: `sha256=${signatureHex}`
  };
}

export function isTimestampFresh(
  timestampSecOrMs: string | number,
  options?: { nowMs?: number; maxAgeSec?: number }
): boolean {
  const raw = Number(timestampSecOrMs);
  if (!Number.isFinite(raw) || raw <= 0) return false;
  const nowMs = options?.nowMs ?? Date.now();
  const maxAgeSec = Math.max(1, options?.maxAgeSec ?? 300);
  const inputMs = raw > 1e12 ? raw : raw * 1000;
  const diffMs = Math.abs(nowMs - inputMs);
  return diffMs <= maxAgeSec * 1000;
}

export function verifySignedWebhookPayload(params: {
  secret: string;
  timestampSecOrMs: string | number;
  body: unknown;
  signatureHeader: string;
  maxAgeSec?: number;
  nowMs?: number;
}): { ok: boolean; reason?: string } {
  const { secret, timestampSecOrMs, body, signatureHeader, maxAgeSec, nowMs } = params;
  if (!isTimestampFresh(timestampSecOrMs, { nowMs, maxAgeSec })) {
    return { ok: false, reason: 'timestamp_expired' };
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return { ok: false, reason: 'invalid_signature_format' };
  }
  const expected = buildSignedWebhookPayload(secret, timestampSecOrMs, body).signatureHeaderValue;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return { ok: false, reason: 'signature_mismatch' };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'signature_mismatch' };
  return { ok: true };
}
