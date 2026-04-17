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
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendStockWebhookPayload = sendStockWebhookPayload;
exports.getLupoWebhookConfigForUi = getLupoWebhookConfigForUi;
exports.saveLupoWebhookConfig = saveLupoWebhookConfig;
exports.buildStockWebhookUpdateByVariantId = buildStockWebhookUpdateByVariantId;
exports.enqueueStockWebhookForVariant = enqueueStockWebhookForVariant;
const db_1 = require("../database/db");
const lupoStockWebhook_client_1 = require("./lupoStockWebhook.client");
let cachedClient = null;
let cachedClientConfigKey = '';
function normalizeStockQuantity(stock) {
    const n = Number(stock);
    if (!Number.isFinite(n) || n < 0)
        return 0;
    return Math.floor(n);
}
function maskSecret(value) {
    if (!value)
        return '';
    if (value.length <= 8)
        return '*'.repeat(value.length);
    return `${value.slice(0, 4)}${'*'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}
function getDbWebhookConfig() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const row = yield (0, db_1.get)(`SELECT enabled, webhook_url, api_key, webhook_secret, timeout_ms, max_retries, backoff_base_ms
       FROM lupo_stock_webhook_config
       WHERE id = 1
       LIMIT 1`);
            if (!row)
                return null;
            return row;
        }
        catch (_a) {
            return null;
        }
    });
}
function resolveRuntimeWebhookConfig() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const envCfg = (0, lupoStockWebhook_client_1.getLupoStockWebhookConfigFromEnv)();
        const dbCfg = yield getDbWebhookConfig();
        if (!dbCfg)
            return envCfg;
        const merged = (0, lupoStockWebhook_client_1.buildLupoStockWebhookConfig)({
            enabled: !!dbCfg.enabled,
            endpointUrl: (dbCfg.webhook_url || '').trim() || envCfg.endpointUrl,
            apiKey: (dbCfg.api_key || '').trim() || envCfg.apiKey,
            secret: (dbCfg.webhook_secret || '').trim() || envCfg.secret,
            timeoutMs: Number((_a = dbCfg.timeout_ms) !== null && _a !== void 0 ? _a : envCfg.timeoutMs),
            maxRetries5xx: Number((_b = dbCfg.max_retries) !== null && _b !== void 0 ? _b : envCfg.maxRetries5xx),
            backoffBaseMs: Number((_c = dbCfg.backoff_base_ms) !== null && _c !== void 0 ? _c : envCfg.backoffBaseMs)
        });
        return merged;
    });
}
function getClientForConfig(config) {
    const key = JSON.stringify(config);
    if (!cachedClient || cachedClientConfigKey !== key) {
        cachedClient = new lupoStockWebhook_client_1.LupoStockWebhookClient(config);
        cachedClientConfigKey = key;
    }
    return cachedClient;
}
function sendStockWebhookPayload(payload, webhookId) {
    return __awaiter(this, void 0, void 0, function* () {
        const config = yield resolveRuntimeWebhookConfig();
        const client = getClientForConfig(config);
        return client.enqueue(payload, webhookId);
    });
}
function getLupoWebhookConfigForUi() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const envCfg = (0, lupoStockWebhook_client_1.getLupoStockWebhookConfigFromEnv)();
        const dbCfg = yield getDbWebhookConfig();
        if (!dbCfg) {
            return {
                enabled: envCfg.enabled,
                webhookUrl: envCfg.endpointUrl,
                hasApiKey: !!envCfg.apiKey,
                hasWebhookSecret: !!envCfg.secret,
                apiKeyMasked: maskSecret(envCfg.apiKey),
                webhookSecretMasked: maskSecret(envCfg.secret),
                timeoutMs: envCfg.timeoutMs,
                maxRetries: envCfg.maxRetries5xx,
                backoffBaseMs: envCfg.backoffBaseMs,
                source: 'env'
            };
        }
        const resolved = (0, lupoStockWebhook_client_1.buildLupoStockWebhookConfig)({
            enabled: !!dbCfg.enabled,
            endpointUrl: (dbCfg.webhook_url || '').trim() || envCfg.endpointUrl,
            apiKey: (dbCfg.api_key || '').trim() || envCfg.apiKey,
            secret: (dbCfg.webhook_secret || '').trim() || envCfg.secret,
            timeoutMs: Number((_a = dbCfg.timeout_ms) !== null && _a !== void 0 ? _a : envCfg.timeoutMs),
            maxRetries5xx: Number((_b = dbCfg.max_retries) !== null && _b !== void 0 ? _b : envCfg.maxRetries5xx),
            backoffBaseMs: Number((_c = dbCfg.backoff_base_ms) !== null && _c !== void 0 ? _c : envCfg.backoffBaseMs)
        });
        return {
            enabled: !!dbCfg.enabled,
            webhookUrl: (dbCfg.webhook_url || '').trim() || envCfg.endpointUrl,
            hasApiKey: !!((dbCfg.api_key || '').trim() || envCfg.apiKey),
            hasWebhookSecret: !!((dbCfg.webhook_secret || '').trim() || envCfg.secret),
            apiKeyMasked: maskSecret((dbCfg.api_key || '').trim() || envCfg.apiKey),
            webhookSecretMasked: maskSecret((dbCfg.webhook_secret || '').trim() || envCfg.secret),
            timeoutMs: resolved.timeoutMs,
            maxRetries: resolved.maxRetries5xx,
            backoffBaseMs: resolved.backoffBaseMs,
            source: 'db'
        };
    });
}
function saveLupoWebhookConfig(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const current = yield getDbWebhookConfig();
        const existingApiKey = ((current === null || current === void 0 ? void 0 : current.api_key) || '').trim();
        const existingSecret = ((current === null || current === void 0 ? void 0 : current.webhook_secret) || '').trim();
        const apiKeyToSave = input.keepExistingApiKey ? existingApiKey : input.apiKey.trim();
        const secretToSave = input.keepExistingSecret ? existingSecret : (input.webhookSecret || '').trim();
        yield (0, db_1.execute)(`INSERT INTO lupo_stock_webhook_config
       (id, enabled, webhook_url, api_key, webhook_secret, timeout_ms, max_retries, backoff_base_ms)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled),
       webhook_url = VALUES(webhook_url),
       api_key = VALUES(api_key),
       webhook_secret = VALUES(webhook_secret),
       timeout_ms = VALUES(timeout_ms),
       max_retries = VALUES(max_retries),
       backoff_base_ms = VALUES(backoff_base_ms),
       updated_at = CURRENT_TIMESTAMP`, [
            input.enabled ? 1 : 0,
            input.webhookUrl.trim(),
            apiKeyToSave,
            secretToSave,
            Math.max(1000, Math.floor(Number(input.timeoutMs) || 10000)),
            Math.max(0, Math.floor(Number(input.maxRetries) || 4)),
            Math.max(200, Math.floor(Number(input.backoffBaseMs) || 1000))
        ]);
        return getLupoWebhookConfigForUi();
    });
}
function buildStockWebhookUpdateByVariantId(variantId, newStock) {
    return __awaiter(this, void 0, void 0, function* () {
        const row = yield (0, db_1.get)(`SELECT pv.id AS variant_id,
            pv.sku AS variant_sku,
            p.id AS product_id,
            p.sku AS product_sku,
            p.tienda_nube_id AS external_tn_id,
            p.mercado_libre_id AS external_ml_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     WHERE pv.id = ?
     LIMIT 1`, [variantId]);
        if (!row)
            return null;
        return {
            sku: row.product_sku || row.variant_sku || undefined,
            id: row.product_id || undefined,
            external_tn_id: row.external_tn_id || undefined,
            external_ml_id: row.external_ml_id || undefined,
            variant_id: row.variant_id || undefined,
            variant_sku: row.variant_sku || undefined,
            stock_quantity: normalizeStockQuantity(newStock)
        };
    });
}
function enqueueStockWebhookForVariant(variantId, newStock) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const update = yield buildStockWebhookUpdateByVariantId(variantId, newStock);
            if (!update) {
                console.warn(`[LupoWebhook] variante no encontrada: variantId=${variantId}`);
                return;
            }
            const result = yield sendStockWebhookPayload({ updates: [update] });
            if (!result.ok) {
                console.warn(`[LupoWebhook] envio fallido webhookId=${result.webhookId} status=${(_a = result.status) !== null && _a !== void 0 ? _a : 'n/a'} error=${(_b = result.error) !== null && _b !== void 0 ? _b : 'n/a'}`);
            }
        }
        catch (error) {
            console.error(`[LupoWebhook] error encolando variantId=${variantId}:`, (error === null || error === void 0 ? void 0 : error.message) || error);
        }
    });
}
