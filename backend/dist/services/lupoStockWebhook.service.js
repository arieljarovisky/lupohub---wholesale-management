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
exports.buildStockWebhookUpdateByVariantId = buildStockWebhookUpdateByVariantId;
exports.enqueueStockWebhookForVariant = enqueueStockWebhookForVariant;
const db_1 = require("../database/db");
const lupoStockWebhook_client_1 = require("./lupoStockWebhook.client");
function normalizeStockQuantity(stock) {
    const n = Number(stock);
    if (!Number.isFinite(n) || n < 0)
        return 0;
    return Math.floor(n);
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
            const result = yield lupoStockWebhook_client_1.lupoStockWebhookClient.enqueue({ updates: [update] });
            if (!result.ok) {
                console.warn(`[LupoWebhook] envio fallido webhookId=${result.webhookId} status=${(_a = result.status) !== null && _a !== void 0 ? _a : 'n/a'} error=${(_b = result.error) !== null && _b !== void 0 ? _b : 'n/a'}`);
            }
        }
        catch (error) {
            console.error(`[LupoWebhook] error encolando variantId=${variantId}:`, (error === null || error === void 0 ? void 0 : error.message) || error);
        }
    });
}
