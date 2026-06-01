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
const assert_1 = __importDefault(require("assert"));
const canonicalJson_1 = require("../utils/canonicalJson");
const webhookHmac_1 = require("../utils/webhookHmac");
const lupoStockWebhook_client_1 = require("../services/lupoStockWebhook.client");
function testCanonicalJsonStable() {
    return __awaiter(this, void 0, void 0, function* () {
        const a = {
            z: 1,
            b: { y: 2, a: [3, { d: 4, c: 5 }] },
            a: 'x'
        };
        const b = {
            a: 'x',
            b: { a: [3, { c: 5, d: 4 }], y: 2 },
            z: 1
        };
        assert_1.default.strictEqual((0, canonicalJson_1.canonicalStringify)(a), (0, canonicalJson_1.canonicalStringify)(b), 'canonical JSON debería ser estable sin importar orden de claves');
    });
}
function testHmacSignature() {
    return __awaiter(this, void 0, void 0, function* () {
        const body = { updates: [{ sku: 'BOXER-123', stock_quantity: 4 }] };
        const signed = (0, webhookHmac_1.buildSignedWebhookPayload)('topsecret', 1715600000, body);
        assert_1.default.strictEqual(signed.signatureHeaderValue, 'sha256=85342444e181aa9f6033fbec8572d1161f6ecaf6e317a0e33feac4dd04039834');
        const ok = (0, webhookHmac_1.verifySignedWebhookPayload)({
            secret: 'topsecret',
            timestampSecOrMs: 1715600000,
            body,
            signatureHeader: signed.signatureHeaderValue,
            nowMs: 1715600000 * 1000,
            maxAgeSec: 300
        });
        assert_1.default.strictEqual(ok.ok, true, 'la firma debería verificar correctamente');
        const bad = (0, webhookHmac_1.verifySignedWebhookPayload)({
            secret: 'wrong',
            timestampSecOrMs: 1715600000,
            body,
            signatureHeader: signed.signatureHeaderValue,
            nowMs: 1715600000 * 1000,
            maxAgeSec: 300
        });
        assert_1.default.strictEqual(bad.ok, false, 'firma inválida debería fallar');
        const expired = (0, webhookHmac_1.verifySignedWebhookPayload)({
            secret: 'topsecret',
            timestampSecOrMs: 1715600000,
            body,
            signatureHeader: signed.signatureHeaderValue,
            nowMs: (1715600000 + 1000) * 1000,
            maxAgeSec: 300
        });
        assert_1.default.strictEqual(expired.ok, false, 'timestamp vencido debería fallar');
    });
}
function testIdempotentWebhookIdOnRetry() {
    return __awaiter(this, void 0, void 0, function* () {
        const seenIds = [];
        let calls = 0;
        const transport = ({ headers }) => __awaiter(this, void 0, void 0, function* () {
            calls += 1;
            seenIds.push(headers['x-webhook-id']);
            if (calls === 1)
                return { status: 500, data: { ok: false } };
            return { status: 200, data: { ok: true, updated: 1 } };
        });
        const cfg = {
            enabled: true,
            endpointUrl: 'https://example.com/api/hub/webhook/stock',
            apiKey: 'k',
            secret: 's',
            timeoutMs: 1000,
            maxRetries5xx: 2,
            backoffBaseMs: 1
        };
        const client = new lupoStockWebhook_client_1.LupoStockWebhookClient(cfg, {
            transport,
            sleepFn: () => __awaiter(this, void 0, void 0, function* () { return undefined; }),
            nowSecFn: () => 1715600000,
            logger: console
        });
        const result = yield client.enqueue({ updates: [{ sku: 'BOXER-123', stock_quantity: 2 }] }, 'fixed-webhook-id');
        assert_1.default.strictEqual(result.ok, true, 'debería terminar en éxito luego de retry');
        assert_1.default.strictEqual(seenIds.length, 2, 'debería haber dos intentos');
        assert_1.default.strictEqual(seenIds[0], 'fixed-webhook-id');
        assert_1.default.strictEqual(seenIds[1], 'fixed-webhook-id');
    });
}
function testStatusHandling() {
    return __awaiter(this, void 0, void 0, function* () {
        const cfg = {
            enabled: true,
            endpointUrl: 'https://example.com/api/hub/webhook/stock',
            apiKey: 'k',
            secret: 's',
            timeoutMs: 1000,
            maxRetries5xx: 2,
            backoffBaseMs: 1
        };
        let duplicateCalls = 0;
        const duplicateClient = new lupoStockWebhook_client_1.LupoStockWebhookClient(cfg, {
            transport: () => __awaiter(this, void 0, void 0, function* () {
                duplicateCalls += 1;
                return { status: 200, data: { ok: true, duplicate: true } };
            }),
            sleepFn: () => __awaiter(this, void 0, void 0, function* () { return undefined; }),
            nowSecFn: () => 1715600000,
            logger: console
        });
        const duplicateResult = yield duplicateClient.enqueue({ updates: [{ sku: 'A', stock_quantity: 1 }] }, 'dup-1');
        assert_1.default.strictEqual(duplicateResult.ok, true);
        assert_1.default.strictEqual(duplicateResult.duplicate, true);
        assert_1.default.strictEqual(duplicateCalls, 1, '200 duplicate no debería reintentar');
        let conflictCalls = 0;
        const conflictClient = new lupoStockWebhook_client_1.LupoStockWebhookClient(cfg, {
            transport: () => __awaiter(this, void 0, void 0, function* () {
                conflictCalls += 1;
                return { status: 409, data: { ok: false } };
            }),
            sleepFn: () => __awaiter(this, void 0, void 0, function* () { return undefined; }),
            nowSecFn: () => 1715600000,
            logger: console
        });
        const conflictResult = yield conflictClient.enqueue({ updates: [{ sku: 'A', stock_quantity: 1 }] }, 'conf-1');
        assert_1.default.strictEqual(conflictResult.ok, false);
        assert_1.default.strictEqual(conflictCalls, 1, '409 no debería reintentar');
        let serverCalls = 0;
        const serverClient = new lupoStockWebhook_client_1.LupoStockWebhookClient(cfg, {
            transport: () => __awaiter(this, void 0, void 0, function* () {
                serverCalls += 1;
                if (serverCalls < 3)
                    return { status: 503, data: { ok: false } };
                return { status: 200, data: { ok: true } };
            }),
            sleepFn: () => __awaiter(this, void 0, void 0, function* () { return undefined; }),
            nowSecFn: () => 1715600000,
            logger: console
        });
        const serverResult = yield serverClient.enqueue({ updates: [{ sku: 'A', stock_quantity: 1 }] }, 'srv-1');
        assert_1.default.strictEqual(serverResult.ok, true);
        assert_1.default.strictEqual(serverCalls, 3, '5xx debería reintentar con backoff');
    });
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        yield testCanonicalJsonStable();
        yield testHmacSignature();
        yield testIdempotentWebhookIdOnRetry();
        yield testStatusHandling();
        console.log('OK lupoStockWebhook.test');
    });
}
run().catch((err) => {
    console.error('FAIL lupoStockWebhook.test', err);
    process.exit(1);
});
