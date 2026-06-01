"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lupoStockWebhookClient = exports.LupoStockWebhookClient = void 0;
exports.buildLupoStockWebhookConfig = buildLupoStockWebhookConfig;
exports.getLupoStockWebhookConfigFromEnv = getLupoStockWebhookConfigFromEnv;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = require("crypto");
const webhookHmac_1 = require("../utils/webhookHmac");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function envInt(name, fallback) {
    const raw = Number(process.env[name]);
    if (!Number.isFinite(raw))
        return fallback;
    return Math.floor(raw);
}
function buildLupoStockWebhookConfig(input) {
    var _a, _b, _c;
    const endpointUrl = (input.endpointUrl || '').trim();
    const apiKey = (input.apiKey || '').trim();
    const secret = (input.secret || '').trim();
    const enabled = !!input.enabled && !!endpointUrl && !!apiKey && !!secret;
    return {
        enabled,
        endpointUrl,
        apiKey,
        secret,
        timeoutMs: Math.max(1000, Math.floor(Number((_a = input.timeoutMs) !== null && _a !== void 0 ? _a : 10000) || 10000)),
        maxRetries5xx: Math.max(0, Math.floor(Number((_b = input.maxRetries5xx) !== null && _b !== void 0 ? _b : 4) || 4)),
        backoffBaseMs: Math.max(200, Math.floor(Number((_c = input.backoffBaseMs) !== null && _c !== void 0 ? _c : 1000) || 1000))
    };
}
function getLupoStockWebhookConfigFromEnv() {
    const enabledByFlag = !['0', 'false', 'off'].includes((process.env.HUB_STOCK_WEBHOOK_ENABLED || '1').toLowerCase());
    return buildLupoStockWebhookConfig({
        enabled: enabledByFlag,
        endpointUrl: process.env.HUB_STOCK_WEBHOOK_URL || '',
        apiKey: process.env.HUB_API_KEY || '',
        secret: process.env.HUB_WEBHOOK_SECRET || '',
        timeoutMs: Math.max(1000, envInt('HUB_STOCK_WEBHOOK_TIMEOUT_MS', 10000)),
        maxRetries5xx: Math.max(0, envInt('HUB_STOCK_WEBHOOK_MAX_RETRIES', 4)),
        backoffBaseMs: Math.max(200, envInt('HUB_STOCK_WEBHOOK_BACKOFF_BASE_MS', 1000))
    });
}
const defaultTransport = (_a) => __awaiter(void 0, [_a], void 0, function* ({ url, body, headers, timeoutMs }) {
    const res = yield axios_1.default.post(url, body, {
        headers,
        timeout: timeoutMs,
        validateStatus: () => true
    });
    return { status: res.status, data: res.data };
});
function sanitizeUpdate(update) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    return {
        sku: (_a = update.sku) !== null && _a !== void 0 ? _a : null,
        codigo_articulo: (_b = update.codigo_articulo) !== null && _b !== void 0 ? _b : null,
        id: (_c = update.id) !== null && _c !== void 0 ? _c : null,
        external_tn_id: (_d = update.external_tn_id) !== null && _d !== void 0 ? _d : null,
        tienda_nube_product_id: (_e = update.tienda_nube_product_id) !== null && _e !== void 0 ? _e : null,
        tienda_nube_variant_id: (_f = update.tienda_nube_variant_id) !== null && _f !== void 0 ? _f : null,
        external_ml_id: (_g = update.external_ml_id) !== null && _g !== void 0 ? _g : null,
        variant_id: (_h = update.variant_id) !== null && _h !== void 0 ? _h : null,
        variant_sku: (_j = update.variant_sku) !== null && _j !== void 0 ? _j : null,
        stock_quantity: update.stock_quantity
    };
}
function validatePayload(payload) {
    const errors = [];
    if (!payload || !Array.isArray(payload.updates) || payload.updates.length === 0) {
        errors.push('payload.updates debe tener al menos un elemento');
        return errors;
    }
    payload.updates.forEach((u, index) => {
        const hasIdentity = !!(u.sku ||
            u.id ||
            u.external_tn_id ||
            u.external_ml_id ||
            u.tienda_nube_product_id ||
            u.tienda_nube_variant_id ||
            u.codigo_articulo ||
            u.variant_id);
        if (!hasIdentity) {
            errors.push(`updates[${index}] debe incluir al menos: sku, codigo_articulo, id, variant_id, external_tn_id, external_ml_id o ids de Tienda Nube`);
        }
        if (typeof u.stock_quantity !== 'number' || !Number.isFinite(u.stock_quantity) || u.stock_quantity < 0) {
            errors.push(`updates[${index}].stock_quantity debe ser número >= 0`);
        }
    });
    return errors;
}
class LupoStockWebhookClient {
    constructor(config, deps) {
        var _a, _b, _c, _d, _e;
        this.queue = Promise.resolve();
        this.config = config;
        this.sleepFn = (_a = deps === null || deps === void 0 ? void 0 : deps.sleepFn) !== null && _a !== void 0 ? _a : sleep;
        this.nowSecFn = (_b = deps === null || deps === void 0 ? void 0 : deps.nowSecFn) !== null && _b !== void 0 ? _b : (() => Math.floor(Date.now() / 1000));
        this.webhookIdFn = (_c = deps === null || deps === void 0 ? void 0 : deps.webhookIdFn) !== null && _c !== void 0 ? _c : (() => (0, crypto_1.randomUUID)());
        this.transport = (_d = deps === null || deps === void 0 ? void 0 : deps.transport) !== null && _d !== void 0 ? _d : defaultTransport;
        this.logger = (_e = deps === null || deps === void 0 ? void 0 : deps.logger) !== null && _e !== void 0 ? _e : console;
    }
    newWebhookId() {
        return this.webhookIdFn();
    }
    enqueue(payload, providedWebhookId) {
        const webhookId = providedWebhookId || this.newWebhookId();
        const event = { payload, webhookId };
        const task = this.queue.then(() => this.sendWithRetry(event));
        this.queue = task.catch(() => undefined);
        return task;
    }
    sendWithRetry(event) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.config.enabled) {
                this.logger.log(`[LupoWebhook] disabled: webhookId=${event.webhookId}`);
                return { ok: false, webhookId: event.webhookId, attempt: 0, error: 'disabled' };
            }
            const payloadErrors = validatePayload(event.payload);
            if (payloadErrors.length > 0) {
                const msg = payloadErrors.join('; ');
                this.logger.warn(`[LupoWebhook] invalid payload: webhookId=${event.webhookId} error="${msg}"`);
                return { ok: false, webhookId: event.webhookId, attempt: 0, error: msg };
            }
            const maxAttempts = this.config.maxRetries5xx + 1;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                const timestampSec = String(this.nowSecFn());
                const signed = (0, webhookHmac_1.buildSignedWebhookPayload)(this.config.secret, timestampSec, event.payload);
                const headers = {
                    'content-type': 'application/json',
                    'x-hub-api-key': this.config.apiKey,
                    'x-hub-timestamp': timestampSec,
                    'x-webhook-id': event.webhookId,
                    'x-hub-signature': signed.signatureHeaderValue
                };
                try {
                    const response = yield this.transport({
                        url: this.config.endpointUrl,
                        body: event.payload,
                        headers,
                        timeoutMs: this.config.timeoutMs
                    });
                    const status = Number(response.status || 0);
                    const data = response.data;
                    this.logger.log(`[LupoWebhook] response webhookId=${event.webhookId} attempt=${attempt} status=${status} updates=${event.payload.updates.length}`);
                    if (status === 200) {
                        return {
                            ok: true,
                            duplicate: !!(data === null || data === void 0 ? void 0 : data.duplicate),
                            status,
                            webhookId: event.webhookId,
                            attempt,
                            responseBody: data
                        };
                    }
                    if ([400, 401, 409].includes(status)) {
                        this.logger.warn(`[LupoWebhook] non-retriable webhookId=${event.webhookId} status=${status} sample=${JSON.stringify(sanitizeUpdate(event.payload.updates[0]))}`);
                        return {
                            ok: false,
                            status,
                            webhookId: event.webhookId,
                            attempt,
                            responseBody: data,
                            error: `status_${status}`
                        };
                    }
                    if (status >= 500 && attempt < maxAttempts) {
                        const delay = this.config.backoffBaseMs * Math.pow(2, attempt - 1);
                        this.logger.warn(`[LupoWebhook] retrying webhookId=${event.webhookId} attempt=${attempt} nextDelayMs=${delay}`);
                        yield this.sleepFn(delay);
                        continue;
                    }
                    return {
                        ok: false,
                        status,
                        webhookId: event.webhookId,
                        attempt,
                        responseBody: data,
                        error: status >= 500 ? 'exhausted_retries' : `status_${status}`
                    };
                }
                catch (error) {
                    const code = (error === null || error === void 0 ? void 0 : error.code) || 'network_error';
                    const message = (error === null || error === void 0 ? void 0 : error.message) || String(error);
                    this.logger.error(`[LupoWebhook] network error webhookId=${event.webhookId} attempt=${attempt} code=${code} message=${message}`);
                    if (attempt < maxAttempts) {
                        const delay = this.config.backoffBaseMs * Math.pow(2, attempt - 1);
                        yield this.sleepFn(delay);
                        continue;
                    }
                    return {
                        ok: false,
                        webhookId: event.webhookId,
                        attempt,
                        error: `${code}:${message}`
                    };
                }
            }
            return { ok: false, webhookId: event.webhookId, attempt: this.config.maxRetries5xx + 1, error: 'unknown' };
        });
    }
}
exports.LupoStockWebhookClient = LupoStockWebhookClient;
exports.lupoStockWebhookClient = new LupoStockWebhookClient(getLupoStockWebhookConfigFromEnv());
