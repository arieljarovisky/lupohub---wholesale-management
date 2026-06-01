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
exports.syncAllMercadoLibreLinkedStockToLupoShop = syncAllMercadoLibreLinkedStockToLupoShop;
exports.sendStockWebhookPayload = sendStockWebhookPayload;
exports.getLupoWebhookConfigForUi = getLupoWebhookConfigForUi;
exports.saveLupoWebhookConfig = saveLupoWebhookConfig;
exports.buildStockWebhookUpdateByVariantId = buildStockWebhookUpdateByVariantId;
exports.enqueueStockWebhookForVariant = enqueueStockWebhookForVariant;
const uuid_1 = require("uuid");
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
/** SKU en webhook: sin guiones (ej. 0051003-130-280 → 0051003130280), alineado con ML/TN. */
function normalizeSkuForWebhook(raw) {
    if (raw == null)
        return '';
    const t = String(raw).trim();
    if (!t)
        return '';
    return t.replace(/-/g, '');
}
/** SKU base para webhook: prioriza código de color de LupoHub (colors.code). */
function buildWebhookSkuRaw(params) {
    const productSku = params.productSkuRaw.trim();
    const variantSku = params.variantSkuRaw.trim();
    const sizeCode = params.sizeCodeRaw.trim();
    const colorCode = params.colorCodeRaw.trim();
    if (productSku && sizeCode && colorCode)
        return `${productSku}-${sizeCode}-${colorCode}`;
    return variantSku || productSku;
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
const ML_TO_SHOP_BATCH_SIZE = 80;
const ML_TO_SHOP_BATCH_DELAY_MS = 250;
/**
 * Envía a la tienda online (webhook Lupo) el stock actual de LupoHub para todas las variantes
 * vinculadas a Mercado Libre (mismo criterio que en inventario: producto ML, ítems/variación o publicación ML).
 * La cantidad enviada es el stock del depósito en LupoHub, no la lectura en vivo desde la API de ML.
 */
function syncAllMercadoLibreLinkedStockToLupoShop() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const cfg = yield resolveRuntimeWebhookConfig();
        if (!cfg.enabled) {
            return {
                ok: false,
                message: 'Webhook de tienda Lupo deshabilitado o faltan URL, API key o secret. Activá y guardá la configuración en Integraciones.',
                variantCount: 0,
                batchesTotal: 0,
                batchesOk: 0,
                batchesFailed: 0,
                errors: []
            };
        }
        const rows = yield (0, db_1.query)(`SELECT pv.id AS variant_id,
            pv.sku AS variant_sku,
            pv.tienda_nube_variant_id AS tienda_nube_variant_id,
            szi.size_code AS size_code,
            c.code AS color_code,
            p.id AS product_id,
            p.sku AS product_sku,
            p.tienda_nube_id AS external_tn_id,
            p.mercado_libre_id AS external_ml_id,
            COALESCE(s.stock, 0) AS stock
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     LEFT JOIN sizes szi ON szi.id = pv.size_id
     LEFT JOIN colors c ON c.id = pc.color_id
     LEFT JOIN stocks s ON s.variant_id = pv.id
     WHERE
       (p.mercado_libre_id IS NOT NULL AND TRIM(p.mercado_libre_id) != '')
       OR (pv.mercado_libre_item_id IS NOT NULL AND TRIM(pv.mercado_libre_item_id) != '')
       OR (pv.mercado_libre_variant_id IS NOT NULL AND TRIM(pv.mercado_libre_variant_id) != '')
       OR EXISTS (
         SELECT 1 FROM variant_publications vp
         WHERE vp.variant_id = pv.id AND vp.platform = 'mercadolibre'
       )`, []);
        const updates = rows.map((row) => {
            const variantSkuRaw = row.variant_sku != null && String(row.variant_sku).trim() !== '' ? String(row.variant_sku).trim() : '';
            const productSkuRaw = row.product_sku != null && String(row.product_sku).trim() !== '' ? String(row.product_sku).trim() : '';
            const sizeCodeRaw = row.size_code != null ? String(row.size_code).trim() : '';
            const colorCodeRaw = row.color_code != null ? String(row.color_code).trim() : '';
            const webhookSkuRaw = buildWebhookSkuRaw({ productSkuRaw, variantSkuRaw, sizeCodeRaw, colorCodeRaw });
            const webhookSkuNorm = normalizeSkuForWebhook(webhookSkuRaw);
            const variantSkuNorm = normalizeSkuForWebhook(variantSkuRaw);
            const productSkuNorm = normalizeSkuForWebhook(productSkuRaw);
            const tnProd = row.external_tn_id != null && String(row.external_tn_id).trim() !== '' ? String(row.external_tn_id).trim() : '';
            const tnVar = row.tienda_nube_variant_id != null && String(row.tienda_nube_variant_id).trim() !== ''
                ? String(row.tienda_nube_variant_id).trim()
                : '';
            return {
                sku: webhookSkuNorm || variantSkuNorm || productSkuNorm || undefined,
                codigo_articulo: productSkuNorm || undefined,
                id: tnProd || undefined,
                external_tn_id: tnProd || undefined,
                tienda_nube_product_id: tnProd || undefined,
                tienda_nube_variant_id: tnVar || undefined,
                external_ml_id: row.external_ml_id || undefined,
                variant_id: row.variant_id || undefined,
                variant_sku: webhookSkuNorm || variantSkuNorm || undefined,
                stock_quantity: normalizeStockQuantity(row.stock)
            };
        });
        if (updates.length === 0) {
            return {
                ok: true,
                message: 'No hay variantes vinculadas a Mercado Libre.',
                variantCount: 0,
                batchesTotal: 0,
                batchesOk: 0,
                batchesFailed: 0,
                errors: []
            };
        }
        const errors = [];
        let batchesOk = 0;
        let batchesFailed = 0;
        const batchesTotal = Math.ceil(updates.length / ML_TO_SHOP_BATCH_SIZE);
        console.log(`[LupoWebhook] sincronización masiva ML→tienda: ${updates.length} variantes, ${batchesTotal} lote(s)`);
        for (let i = 0; i < updates.length; i += ML_TO_SHOP_BATCH_SIZE) {
            const batch = updates.slice(i, i + ML_TO_SHOP_BATCH_SIZE);
            const batchIndex = Math.floor(i / ML_TO_SHOP_BATCH_SIZE);
            const result = yield sendStockWebhookPayload({ updates: batch }, (0, uuid_1.v4)());
            if (result.ok) {
                batchesOk++;
                for (const u of batch) {
                    const vid = u.variant_id;
                    if (!vid)
                        continue;
                    try {
                        yield (0, db_1.execute)(`INSERT INTO variant_luposhop_stock (variant_id, stock) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE stock = VALUES(stock), updated_at = CURRENT_TIMESTAMP`, [vid, u.stock_quantity]);
                    }
                    catch (e) {
                        console.warn(`[LupoWebhook bulk] snapshot tienda variantId=${vid}:`, (e === null || e === void 0 ? void 0 : e.message) || e);
                    }
                }
            }
            else {
                batchesFailed++;
                errors.push({
                    batchIndex,
                    status: result.status,
                    error: (_a = result.error) !== null && _a !== void 0 ? _a : (result.status != null ? String(result.status) : 'unknown')
                });
            }
            if (i + ML_TO_SHOP_BATCH_SIZE < updates.length && ML_TO_SHOP_BATCH_DELAY_MS > 0) {
                yield new Promise((r) => setTimeout(r, ML_TO_SHOP_BATCH_DELAY_MS));
            }
        }
        const ok = batchesFailed === 0;
        return {
            ok,
            message: ok ? undefined : 'Al menos un lote falló al enviar a la tienda. Revisá logs y la respuesta del servidor de la tienda.',
            variantCount: updates.length,
            batchesTotal,
            batchesOk,
            batchesFailed,
            errors
        };
    });
}
function sendStockWebhookPayload(payload, webhookId, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const baseConfig = yield resolveRuntimeWebhookConfig();
        const config = options
            ? Object.assign(Object.assign({}, baseConfig), { timeoutMs: options.timeoutMs != null ? Math.max(1000, Math.floor(options.timeoutMs)) : baseConfig.timeoutMs, maxRetries5xx: options.maxRetries5xx != null ? Math.max(0, Math.floor(options.maxRetries5xx)) : baseConfig.maxRetries5xx, backoffBaseMs: options.backoffBaseMs != null ? Math.max(200, Math.floor(options.backoffBaseMs)) : baseConfig.backoffBaseMs }) : baseConfig;
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
            pv.tienda_nube_variant_id AS tienda_nube_variant_id,
            szi.size_code AS size_code,
            c.code AS color_code,
            p.id AS product_id,
            p.sku AS product_sku,
            p.tienda_nube_id AS external_tn_id,
            p.mercado_libre_id AS external_ml_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     LEFT JOIN sizes szi ON szi.id = pv.size_id
     LEFT JOIN colors c ON c.id = pc.color_id
     WHERE pv.id = ?
     LIMIT 1`, [variantId]);
        if (!row)
            return null;
        const variantSkuRaw = row.variant_sku != null && String(row.variant_sku).trim() !== '' ? String(row.variant_sku).trim() : '';
        const productSkuRaw = row.product_sku != null && String(row.product_sku).trim() !== '' ? String(row.product_sku).trim() : '';
        const sizeCodeRaw = row.size_code != null ? String(row.size_code).trim() : '';
        const colorCodeRaw = row.color_code != null ? String(row.color_code).trim() : '';
        const webhookSkuRaw = buildWebhookSkuRaw({ productSkuRaw, variantSkuRaw, sizeCodeRaw, colorCodeRaw });
        const webhookSkuNorm = normalizeSkuForWebhook(webhookSkuRaw);
        const variantSkuNorm = normalizeSkuForWebhook(variantSkuRaw);
        const productSkuNorm = normalizeSkuForWebhook(productSkuRaw);
        const tnProd = row.external_tn_id != null && String(row.external_tn_id).trim() !== '' ? String(row.external_tn_id).trim() : '';
        const tnVar = row.tienda_nube_variant_id != null && String(row.tienda_nube_variant_id).trim() !== ''
            ? String(row.tienda_nube_variant_id).trim()
            : '';
        return {
            sku: webhookSkuNorm || variantSkuNorm || productSkuNorm || undefined,
            codigo_articulo: productSkuNorm || undefined,
            id: tnProd || undefined,
            external_tn_id: tnProd || undefined,
            tienda_nube_product_id: tnProd || undefined,
            tienda_nube_variant_id: tnVar || undefined,
            external_ml_id: row.external_ml_id || undefined,
            variant_id: row.variant_id || undefined,
            variant_sku: webhookSkuNorm || variantSkuNorm || undefined,
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
            if (result.ok) {
                try {
                    yield (0, db_1.execute)(`INSERT INTO variant_luposhop_stock (variant_id, stock) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE stock = VALUES(stock), updated_at = CURRENT_TIMESTAMP`, [variantId, update.stock_quantity]);
                }
                catch (e) {
                    console.warn(`[LupoWebhook] no se pudo guardar snapshot tienda online variantId=${variantId}:`, (e === null || e === void 0 ? void 0 : e.message) || e);
                }
            }
            else {
                console.warn(`[LupoWebhook] envio fallido webhookId=${result.webhookId} status=${(_a = result.status) !== null && _a !== void 0 ? _a : 'n/a'} error=${(_b = result.error) !== null && _b !== void 0 ? _b : 'n/a'}`);
            }
        }
        catch (error) {
            console.error(`[LupoWebhook] error encolando variantId=${variantId}:`, (error === null || error === void 0 ? void 0 : error.message) || error);
        }
    });
}
