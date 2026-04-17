import dotenv from 'dotenv';
import { lupoStockWebhookClient } from '../src/services/lupoStockWebhook.client';

dotenv.config();

async function main() {
  const payload = {
    updates: [
      { sku: 'BOXER-123-NEGRO-P', stock_quantity: 15 },
      { id: 'prod-abc-001', stock_quantity: 10 },
      { external_tn_id: '987654', stock_quantity: 5 },
      { external_ml_id: 'MLA123456', stock_quantity: 8 },
      { sku: 'BOXER-123', variant_id: 'var-001', stock_quantity: 4 },
      { sku: 'BOXER-123', variant_sku: 'BOXER-123-NEGRO-M', stock_quantity: 6 }
    ]
  };

  const webhookId = process.argv[2] || lupoStockWebhookClient.newWebhookId();
  console.log(`[LupoWebhook Test] sending webhookId=${webhookId}`);
  const result = await lupoStockWebhookClient.enqueue(payload, webhookId);
  console.log('[LupoWebhook Test] result:', {
    ok: result.ok,
    duplicate: result.duplicate,
    status: result.status,
    webhookId: result.webhookId,
    attempt: result.attempt,
    error: result.error
  });
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error('[LupoWebhook Test] error:', err?.message || err);
  process.exit(1);
});
