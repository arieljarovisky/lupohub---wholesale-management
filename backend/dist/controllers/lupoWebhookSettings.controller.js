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
exports.syncLupoShopMlStockToShopEndpoint = exports.testLupoWebhookEndpoint = exports.saveLupoWebhookConfigEndpoint = exports.getLupoWebhookConfigEndpoint = void 0;
/**
 * Stubs de LupoShop webhook: la integración se removió del backend pero el frontend
 * aún consulta estos endpoints. Devolvemos config deshabilitada para evitar 404
 * y el falso "offline/demo mode" en consola.
 */
const getLupoWebhookConfigEndpoint = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.json({
        enabled: false,
        webhookUrl: '',
        hasApiKey: false,
        hasWebhookSecret: false,
        apiKeyMasked: '',
        webhookSecretMasked: '',
        timeoutMs: 10000,
        maxRetries: 4,
        backoffBaseMs: 1000,
        source: 'env',
        removed: true,
        message: 'La integración LupoShop webhook fue deshabilitada en el servidor.',
    });
});
exports.getLupoWebhookConfigEndpoint = getLupoWebhookConfigEndpoint;
const saveLupoWebhookConfigEndpoint = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.status(410).json({
        ok: false,
        message: 'La integración LupoShop webhook ya no está disponible en este servidor.',
        config: null,
    });
});
exports.saveLupoWebhookConfigEndpoint = saveLupoWebhookConfigEndpoint;
const testLupoWebhookEndpoint = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.status(410).json({
        ok: false,
        message: 'La integración LupoShop webhook ya no está disponible en este servidor.',
    });
});
exports.testLupoWebhookEndpoint = testLupoWebhookEndpoint;
const syncLupoShopMlStockToShopEndpoint = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.status(410).json({
        ok: false,
        variantCount: 0,
        batchesTotal: 0,
        batchesOk: 0,
        batchesFailed: 0,
        errors: ['La integración LupoShop webhook ya no está disponible en este servidor.'],
        message: 'Integración LupoShop removida',
    });
});
exports.syncLupoShopMlStockToShopEndpoint = syncLupoShopMlStockToShopEndpoint;
