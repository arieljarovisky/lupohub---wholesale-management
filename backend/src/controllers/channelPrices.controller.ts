/**
 * Precios en canales externos (Mercado Libre, Tienda Nube) vs precio local (products.base_price).
 */
import { Request, Response } from 'express';
import axios from 'axios';
import { query, execute, get } from '../database/db';
import { getValidMLToken } from './integrations.controller';
import { tnPutWithRetry } from '../utils/tiendanubeClient';
import { fetchTnProductsBatched, resolveTnStoreId } from '../utils/channelMarginFetch';
import { touchProductUpdatedAtByVariantId } from '../utils/touchProductUpdatedAt';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const TN_RATE_LIMIT_DELAY_MS = Math.max(0, parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type VariantLinkRow = {
  variant_id: string;
  product_id: string;
  sku: string | null;
  base_price: number;
  mercado_libre_id: string | null;
  mercado_libre_variant_id: string | null;
  mercado_libre_item_id: string | null;
  tienda_nube_id: string | null;
  tienda_nube_variant_id: string | null;
};

export type ChannelPriceEntry = {
  priceLocal?: number;
  priceML?: number;
  priceTN?: number;
  hasML: boolean;
  hasTN: boolean;
  productId: string;
  sku?: string;
};

async function fetchMlPricesForItem(
  accessToken: string,
  itemId: string,
  variants: { variantId: string; variationId: string | null }[],
  prices: Record<string, ChannelPriceEntry>
): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  try {
    const itemRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
      headers,
      validateStatus: () => true,
    });
    if (itemRes.status !== 200 || !itemRes.data) return;
    const item = itemRes.data;
    const variations: any[] = item.variations || [];
    for (const { variantId, variationId } of variants) {
      if (!prices[variantId]) continue;
      if (variations.length === 0) {
        prices[variantId].priceML = Number(item.price ?? 0);
      } else if (variationId) {
        const v = variations.find((x: any) => String(x.id) === String(variationId));
        if (v) prices[variantId].priceML = Number(v.price ?? item.price ?? 0);
      } else if (variations.length === 1) {
        prices[variantId].priceML = Number(variations[0].price ?? item.price ?? 0);
      } else {
        prices[variantId].priceML = Number(item.price ?? 0);
      }
    }
  } catch {
    /* ignore */
  }
}

async function updateMlPrice(
  accessToken: string,
  mlItemId: string,
  mlVariationId: string | null,
  price: number
): Promise<boolean> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const p = Math.max(0, Number(price));
  try {
    const itemRes = await axios.get(`https://api.mercadolibre.com/items/${mlItemId}`, {
      headers,
      validateStatus: () => true,
    });
    if (itemRes.status !== 200 || !itemRes.data) return false;
    const item = itemRes.data;
    const variations: any[] = item.variations || [];
    if (variations.length === 0) {
      const r = await axios.put(
        `https://api.mercadolibre.com/items/${mlItemId}`,
        { price: p },
        { headers, validateStatus: () => true }
      );
      return r.status >= 200 && r.status < 300;
    }
    const varId = mlVariationId || (variations.length === 1 ? String(variations[0].id) : null);
    if (!varId) return false;
    const r = await axios.put(
      `https://api.mercadolibre.com/items/${mlItemId}`,
      { variations: [{ id: varId, price: p }] },
      { headers, validateStatus: () => true }
    );
    return r.status >= 200 && r.status < 300;
  } catch {
    return false;
  }
}

async function updateTnPrice(
  storeId: string,
  accessToken: string,
  tnProductId: string,
  tnVariantId: string,
  price: number
): Promise<boolean> {
  const p = Math.max(0, Number(price));
  const url = `https://api.tiendanube.com/v1/${storeId}/products/${tnProductId}/variants/${tnVariantId}`;
  const headers = {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': TN_USER_AGENT,
    'Content-Type': 'application/json',
  };
  try {
    await tnPutWithRetry(axios, url, { price: String(p) }, { headers, validateStatus: () => true });
    return true;
  } catch {
    return false;
  }
}

/** POST { variantIds: string[] } → precios local / ML / TN por variante. */
export const getVariantChannelPrices = async (req: Request, res: Response) => {
  try {
    const variantIds = Array.isArray(req.body?.variantIds)
      ? req.body.variantIds.filter((id: unknown) => typeof id === 'string' && id.length > 0).slice(0, 100)
      : [];
    if (variantIds.length === 0) return res.json({ prices: {} });

    const placeholders = variantIds.map(() => '?').join(',');
    const rows = (await query(
      `SELECT pv.id AS variant_id, pv.sku,
              p.id AS product_id, p.base_price,
              p.mercado_libre_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
              p.tienda_nube_id, pv.tienda_nube_variant_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.id IN (${placeholders})`,
      variantIds
    )) as VariantLinkRow[];

    const prices: Record<string, ChannelPriceEntry> = {};
    for (const id of variantIds) {
      prices[id] = { hasML: false, hasTN: false, productId: '' };
    }
    for (const r of rows || []) {
      const vid = r.variant_id;
      if (!prices[vid]) continue;
      prices[vid] = {
        productId: r.product_id,
        sku: r.sku ?? undefined,
        priceLocal: Number(r.base_price ?? 0),
        hasML: !!(r.mercado_libre_item_id || r.mercado_libre_id || r.mercado_libre_variant_id),
        hasTN: !!(r.tienda_nube_id && r.tienda_nube_variant_id),
      };
    }

    const mlToken = await getValidMLToken();
    if (mlToken?.access_token) {
      const mlItemIds = new Map<string, { variantId: string; variationId: string | null }[]>();
      for (const r of rows || []) {
        const variantId = r.variant_id;
        const mlItemId = r.mercado_libre_item_id || r.mercado_libre_id;
        const variationId = r.mercado_libre_variant_id ? String(r.mercado_libre_variant_id) : null;
        if (!mlItemId) continue;
        if (!mlItemIds.has(mlItemId)) mlItemIds.set(mlItemId, []);
        mlItemIds.get(mlItemId)!.push({ variantId, variationId });
      }
      for (const [itemId, vars] of mlItemIds) {
        await fetchMlPricesForItem(mlToken.access_token, itemId, vars, prices);
      }
    }

    const tnIntegration = await get(
      `SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`
    );
    const tnStoreId = resolveTnStoreId(tnIntegration);
    if (tnIntegration?.access_token && tnStoreId) {
      const tnProductIds = new Map<string, { variantId: string; tnVariantId: string }[]>();
      for (const r of rows || []) {
        if (!r.tienda_nube_id || !r.tienda_nube_variant_id) continue;
        const pid = String(r.tienda_nube_id);
        if (!tnProductIds.has(pid)) tnProductIds.set(pid, []);
        tnProductIds.get(pid)!.push({
          variantId: r.variant_id,
          tnVariantId: String(r.tienda_nube_variant_id),
        });
      }
      if (tnProductIds.size > 0) {
        await fetchTnProductsBatched(tnStoreId, tnIntegration.access_token, tnProductIds, prices);
      }
    }

    res.json({ prices });
  } catch (error: any) {
    console.error('[getVariantChannelPrices]', error?.message || error);
    res.status(500).json({ message: 'Error obteniendo precios de canales', detail: error?.message });
  }
};

/** POST { updates, applyLocal?, applyML?, applyTN? } */
export const bulkUpdateChannelPrices = async (req: Request, res: Response) => {
  try {
    const updates = Array.isArray(req.body?.updates) ? req.body.updates.slice(0, 50) : [];
    const applyLocal = req.body?.applyLocal !== false;
    const applyML = req.body?.applyML !== false;
    const applyTN = req.body?.applyTN !== false;
    if (updates.length === 0) {
      return res.status(400).json({ message: 'Indicá al menos una variante en updates' });
    }

    const mlToken = applyML ? await getValidMLToken() : null;
    const tnIntegration = applyTN
      ? await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`)
      : null;

    let updatedLocal = 0;
    let updatedML = 0;
    let updatedTN = 0;
    const errors: string[] = [];

    const productLocalUpdated = new Set<string>();

    for (const u of updates) {
      const variantId = String(u?.variantId || '').trim();
      if (!variantId) continue;

      const row = (await get(
        `SELECT pv.id, p.id AS product_id, p.base_price,
                p.mercado_libre_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
                p.tienda_nube_id, pv.tienda_nube_variant_id, pv.sku
         FROM product_variants pv
         JOIN product_colors pc ON pc.id = pv.product_color_id
         JOIN products p ON p.id = pc.product_id
         WHERE pv.id = ?`,
        [variantId]
      )) as VariantLinkRow | undefined;

      if (!row?.variant_id) {
        errors.push(`${variantId}: variante no encontrada`);
        continue;
      }

      if (applyLocal && u.priceLocal != null && Number.isFinite(Number(u.priceLocal))) {
        const p = Math.max(0, Number(u.priceLocal));
        if (!productLocalUpdated.has(row.product_id)) {
          await execute(`UPDATE products SET base_price = ? WHERE id = ?`, [p, row.product_id]);
          productLocalUpdated.add(row.product_id);
          updatedLocal++;
        }
        await touchProductUpdatedAtByVariantId(variantId);
      }

      if (applyML && u.priceML != null && Number.isFinite(Number(u.priceML)) && mlToken?.access_token) {
        const mlItemId = row.mercado_libre_item_id || row.mercado_libre_id;
        if (!mlItemId) {
          errors.push(`${row.sku || variantId}: sin vínculo ML`);
        } else {
          const ok = await updateMlPrice(
            mlToken.access_token,
            String(mlItemId),
            row.mercado_libre_variant_id ? String(row.mercado_libre_variant_id) : null,
            Number(u.priceML)
          );
          if (ok) updatedML++;
          else errors.push(`${row.sku || variantId}: ML no aceptó el precio`);
        }
        if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);
      }

      if (applyTN && u.priceTN != null && Number.isFinite(Number(u.priceTN)) && tnIntegration?.access_token && tnIntegration?.store_id) {
        if (!row.tienda_nube_id || !row.tienda_nube_variant_id) {
          errors.push(`${row.sku || variantId}: sin vínculo TN`);
        } else {
          const ok = await updateTnPrice(
            String(tnIntegration.store_id),
            tnIntegration.access_token,
            String(row.tienda_nube_id),
            String(row.tienda_nube_variant_id),
            Number(u.priceTN)
          );
          if (ok) updatedTN++;
          else errors.push(`${row.sku || variantId}: TN no aceptó el precio`);
        }
        if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);
      }
    }

    res.json({
      message: 'Actualización de precios procesada',
      updatedLocal,
      updatedML,
      updatedTN,
      errors: errors.slice(0, 30),
    });
  } catch (error: any) {
    console.error('[bulkUpdateChannelPrices]', error?.message || error);
    res.status(500).json({ message: 'Error actualizando precios', detail: error?.message });
  }
};
