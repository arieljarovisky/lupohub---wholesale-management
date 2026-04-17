import { get } from '../database/db';
import { LupoStockWebhookUpdate, lupoStockWebhookClient } from './lupoStockWebhook.client';

function normalizeStockQuantity(stock: number): number {
  const n = Number(stock);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export async function buildStockWebhookUpdateByVariantId(
  variantId: string,
  newStock: number
): Promise<LupoStockWebhookUpdate | null> {
  const row = await get(
    `SELECT pv.id AS variant_id,
            pv.sku AS variant_sku,
            p.id AS product_id,
            p.sku AS product_sku,
            p.tienda_nube_id AS external_tn_id,
            p.mercado_libre_id AS external_ml_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     WHERE pv.id = ?
     LIMIT 1`,
    [variantId]
  );
  if (!row) return null;
  return {
    sku: row.product_sku || row.variant_sku || undefined,
    id: row.product_id || undefined,
    external_tn_id: row.external_tn_id || undefined,
    external_ml_id: row.external_ml_id || undefined,
    variant_id: row.variant_id || undefined,
    variant_sku: row.variant_sku || undefined,
    stock_quantity: normalizeStockQuantity(newStock)
  };
}

export async function enqueueStockWebhookForVariant(variantId: string, newStock: number): Promise<void> {
  try {
    const update = await buildStockWebhookUpdateByVariantId(variantId, newStock);
    if (!update) {
      console.warn(`[LupoWebhook] variante no encontrada: variantId=${variantId}`);
      return;
    }
    const result = await lupoStockWebhookClient.enqueue({ updates: [update] });
    if (!result.ok) {
      console.warn(
        `[LupoWebhook] envio fallido webhookId=${result.webhookId} status=${result.status ?? 'n/a'} error=${result.error ?? 'n/a'}`
      );
    }
  } catch (error: any) {
    console.error(`[LupoWebhook] error encolando variantId=${variantId}:`, error?.message || error);
  }
}
