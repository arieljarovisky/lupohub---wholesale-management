import assert from 'assert';
import { canonicalStringify } from '../utils/canonicalJson';
import { buildSignedWebhookPayload, verifySignedWebhookPayload } from '../utils/webhookHmac';
import { LupoStockWebhookClient, LupoStockWebhookConfig, WebhookTransport } from '../services/lupoStockWebhook.client';

async function testCanonicalJsonStable() {
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
  assert.strictEqual(
    canonicalStringify(a),
    canonicalStringify(b),
    'canonical JSON debería ser estable sin importar orden de claves'
  );
}

async function testHmacSignature() {
  const body = { updates: [{ sku: 'BOXER-123', stock_quantity: 4 }] };
  const signed = buildSignedWebhookPayload('topsecret', 1715600000, body);
  assert.strictEqual(
    signed.signatureHeaderValue,
    'sha256=85342444e181aa9f6033fbec8572d1161f6ecaf6e317a0e33feac4dd04039834'
  );
  const ok = verifySignedWebhookPayload({
    secret: 'topsecret',
    timestampSecOrMs: 1715600000,
    body,
    signatureHeader: signed.signatureHeaderValue,
    nowMs: 1715600000 * 1000,
    maxAgeSec: 300
  });
  assert.strictEqual(ok.ok, true, 'la firma debería verificar correctamente');
  const bad = verifySignedWebhookPayload({
    secret: 'wrong',
    timestampSecOrMs: 1715600000,
    body,
    signatureHeader: signed.signatureHeaderValue,
    nowMs: 1715600000 * 1000,
    maxAgeSec: 300
  });
  assert.strictEqual(bad.ok, false, 'firma inválida debería fallar');

  const expired = verifySignedWebhookPayload({
    secret: 'topsecret',
    timestampSecOrMs: 1715600000,
    body,
    signatureHeader: signed.signatureHeaderValue,
    nowMs: (1715600000 + 1000) * 1000,
    maxAgeSec: 300
  });
  assert.strictEqual(expired.ok, false, 'timestamp vencido debería fallar');
}

async function testIdempotentWebhookIdOnRetry() {
  const seenIds: string[] = [];
  let calls = 0;
  const transport: WebhookTransport = async ({ headers }) => {
    calls += 1;
    seenIds.push(headers['x-webhook-id']);
    if (calls === 1) return { status: 500, data: { ok: false } };
    return { status: 200, data: { ok: true, updated: 1 } };
  };
  const cfg: LupoStockWebhookConfig = {
    enabled: true,
    endpointUrl: 'https://example.com/api/hub/webhook/stock',
    apiKey: 'k',
    secret: 's',
    timeoutMs: 1000,
    maxRetries5xx: 2,
    backoffBaseMs: 1
  };
  const client = new LupoStockWebhookClient(cfg, {
    transport,
    sleepFn: async () => undefined,
    nowSecFn: () => 1715600000,
    logger: console
  });
  const result = await client.enqueue(
    { updates: [{ sku: 'BOXER-123', stock_quantity: 2 }] },
    'fixed-webhook-id'
  );
  assert.strictEqual(result.ok, true, 'debería terminar en éxito luego de retry');
  assert.strictEqual(seenIds.length, 2, 'debería haber dos intentos');
  assert.strictEqual(seenIds[0], 'fixed-webhook-id');
  assert.strictEqual(seenIds[1], 'fixed-webhook-id');
}

async function testStatusHandling() {
  const cfg: LupoStockWebhookConfig = {
    enabled: true,
    endpointUrl: 'https://example.com/api/hub/webhook/stock',
    apiKey: 'k',
    secret: 's',
    timeoutMs: 1000,
    maxRetries5xx: 2,
    backoffBaseMs: 1
  };

  let duplicateCalls = 0;
  const duplicateClient = new LupoStockWebhookClient(cfg, {
    transport: async () => {
      duplicateCalls += 1;
      return { status: 200, data: { ok: true, duplicate: true } };
    },
    sleepFn: async () => undefined,
    nowSecFn: () => 1715600000,
    logger: console
  });
  const duplicateResult = await duplicateClient.enqueue({ updates: [{ sku: 'A', stock_quantity: 1 }] }, 'dup-1');
  assert.strictEqual(duplicateResult.ok, true);
  assert.strictEqual(duplicateResult.duplicate, true);
  assert.strictEqual(duplicateCalls, 1, '200 duplicate no debería reintentar');

  let conflictCalls = 0;
  const conflictClient = new LupoStockWebhookClient(cfg, {
    transport: async () => {
      conflictCalls += 1;
      return { status: 409, data: { ok: false } };
    },
    sleepFn: async () => undefined,
    nowSecFn: () => 1715600000,
    logger: console
  });
  const conflictResult = await conflictClient.enqueue({ updates: [{ sku: 'A', stock_quantity: 1 }] }, 'conf-1');
  assert.strictEqual(conflictResult.ok, false);
  assert.strictEqual(conflictCalls, 1, '409 no debería reintentar');

  let serverCalls = 0;
  const serverClient = new LupoStockWebhookClient(cfg, {
    transport: async () => {
      serverCalls += 1;
      if (serverCalls < 3) return { status: 503, data: { ok: false } };
      return { status: 200, data: { ok: true } };
    },
    sleepFn: async () => undefined,
    nowSecFn: () => 1715600000,
    logger: console
  });
  const serverResult = await serverClient.enqueue({ updates: [{ sku: 'A', stock_quantity: 1 }] }, 'srv-1');
  assert.strictEqual(serverResult.ok, true);
  assert.strictEqual(serverCalls, 3, '5xx debería reintentar con backoff');
}

async function run() {
  await testCanonicalJsonStable();
  await testHmacSignature();
  await testIdempotentWebhookIdOnRetry();
  await testStatusHandling();
  console.log('OK lupoStockWebhook.test');
}

run().catch((err) => {
  console.error('FAIL lupoStockWebhook.test', err);
  process.exit(1);
});
