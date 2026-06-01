"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySignedWebhookPayload = exports.isTimestampFresh = exports.buildSignedWebhookPayload = void 0;
const crypto_1 = __importDefault(require("crypto"));
const canonicalJson_1 = require("./canonicalJson");
function buildSignedWebhookPayload(secret, timestampSec, body) {
    const canonicalJsonBody = (0, canonicalJson_1.canonicalStringify)(body);
    const ts = String(timestampSec);
    const signedPayload = `${ts}.${canonicalJsonBody}`;
    const signatureHex = crypto_1.default
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
exports.buildSignedWebhookPayload = buildSignedWebhookPayload;
function isTimestampFresh(timestampSecOrMs, options) {
    var _a, _b;
    const raw = Number(timestampSecOrMs);
    if (!Number.isFinite(raw) || raw <= 0)
        return false;
    const nowMs = (_a = options === null || options === void 0 ? void 0 : options.nowMs) !== null && _a !== void 0 ? _a : Date.now();
    const maxAgeSec = Math.max(1, (_b = options === null || options === void 0 ? void 0 : options.maxAgeSec) !== null && _b !== void 0 ? _b : 300);
    const inputMs = raw > 1e12 ? raw : raw * 1000;
    const diffMs = Math.abs(nowMs - inputMs);
    return diffMs <= maxAgeSec * 1000;
}
exports.isTimestampFresh = isTimestampFresh;
function verifySignedWebhookPayload(params) {
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
    if (a.length !== b.length)
        return { ok: false, reason: 'signature_mismatch' };
    if (!crypto_1.default.timingSafeEqual(a, b))
        return { ok: false, reason: 'signature_mismatch' };
    return { ok: true };
}
exports.verifySignedWebhookPayload = verifySignedWebhookPayload;
