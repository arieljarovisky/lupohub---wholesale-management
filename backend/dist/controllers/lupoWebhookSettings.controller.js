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
exports.syncLupoShopMlStockBulkEndpoint = exports.testLupoWebhookEndpoint = exports.saveLupoWebhookConfigEndpoint = exports.getLupoWebhookConfigEndpoint = void 0;
const lupoStockWebhook_service_1 = require("../services/lupoStockWebhook.service");
function isAdmin(req) {
    var _a;
    const role = (_a = req.user) === null || _a === void 0 ? void 0 : _a.role;
    return role === 'ADMIN';
}
function unauthorized(res) {
    return res.status(403).json({ message: 'Solo ADMIN puede configurar esta integración.' });
}
const getLupoWebhookConfigEndpoint = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!isAdmin(req))
        return unauthorized(res);
    try {
        const config = yield (0, lupoStockWebhook_service_1.getLupoWebhookConfigForUi)();
        res.json(config);
    }
    catch (error) {
        console.error('[LupoWebhook Config] Error consultando configuración:', (error === null || error === void 0 ? void 0 : error.message) || error);
        res.status(500).json({ message: 'Error obteniendo configuración de webhook.' });
    }
});
exports.getLupoWebhookConfigEndpoint = getLupoWebhookConfigEndpoint;
const saveLupoWebhookConfigEndpoint = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (!isAdmin(req))
        return unauthorized(res);
    try {
        const body = req.body || {};
        const config = yield (0, lupoStockWebhook_service_1.saveLupoWebhookConfig)({
            enabled: !!body.enabled,
            webhookUrl: String(body.webhookUrl || ''),
            apiKey: String(body.apiKey || ''),
            webhookSecret: body.webhookSecret != null ? String(body.webhookSecret) : undefined,
            keepExistingApiKey: !!body.keepExistingApiKey,
            timeoutMs: Number(body.timeoutMs),
            maxRetries: Number(body.maxRetries),
            backoffBaseMs: Number(body.backoffBaseMs),
            keepExistingSecret: !!body.keepExistingSecret
        });
        res.json({ ok: true, config });
    }
    catch (error) {
        console.error('[LupoWebhook Config] Error guardando configuración:', (error === null || error === void 0 ? void 0 : error.message) || error);
        res.status(500).json({ message: 'Error guardando configuración de webhook.' });
    }
});
exports.saveLupoWebhookConfigEndpoint = saveLupoWebhookConfigEndpoint;
const testLupoWebhookEndpoint = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    if (!isAdmin(req))
        return unauthorized(res);
    try {
        const updates = Array.isArray((_a = req.body) === null || _a === void 0 ? void 0 : _a.updates)
            ? req.body.updates
            : [{ sku: 'BOXER-TEST-NEGRO-P', stock_quantity: 10 }];
        const providedWebhookId = ((_b = req.body) === null || _b === void 0 ? void 0 : _b.webhookId) ? String(req.body.webhookId) : undefined;
        // En la prueba UI priorizamos respuesta rápida (sin cola de retries largos).
        const result = yield (0, lupoStockWebhook_service_1.sendStockWebhookPayload)({ updates }, providedWebhookId, { timeoutMs: 8000, maxRetries5xx: 0, backoffBaseMs: 500 });
        const code = result.ok ? 200 : (result.status && [400, 401, 409].includes(result.status) ? result.status : 502);
        res.status(code).json(result);
    }
    catch (error) {
        console.error('[LupoWebhook Test] Error enviando prueba:', (error === null || error === void 0 ? void 0 : error.message) || error);
        res.status(500).json({ message: 'Error enviando webhook de prueba.' });
    }
});
exports.testLupoWebhookEndpoint = testLupoWebhookEndpoint;
/** Stock LupoHub de todas las variantes vinculadas a ML → webhook tienda online (lotes). */
const syncLupoShopMlStockBulkEndpoint = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (!isAdmin(req))
        return unauthorized(res);
    try {
        const result = yield (0, lupoStockWebhook_service_1.syncAllMercadoLibreLinkedStockToLupoShop)();
        if (!result.ok && ((_a = result.message) === null || _a === void 0 ? void 0 : _a.includes('deshabilitado'))) {
            return res.status(400).json(result);
        }
        res.json(result);
    }
    catch (error) {
        console.error('[LupoWebhook] sync masivo ML→tienda:', (error === null || error === void 0 ? void 0 : error.message) || error);
        res.status(500).json({ message: 'Error en sincronización masiva hacia la tienda.' });
    }
});
exports.syncLupoShopMlStockBulkEndpoint = syncLupoShopMlStockBulkEndpoint;
