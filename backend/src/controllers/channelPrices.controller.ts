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
  /** Precio de venta efectivo (promocional si hay, si no el de lista). */
  priceTN?: number;
  priceTNList?: number;
  priceTNPromo?: number | null;
  hasML: boolean;
  hasTN: boolean;
  productId: string;
  sku?: string;
};

type PubLinks = { mlProductId?: string; mlVariantId?: string; tnProductId?: string; tnVariantId?: string };

function trimId(v: string | null | undefined): string {
  return v != null ? String(v).trim() : '';
}

async function loadPublicationLinks(variantIds: string[]): Promise<Map<string, PubLinks>> {
  const map = new Map<string, PubLinks>();
  if (variantIds.length === 0) return map;
  const placeholders = variantIds.map(() => '?').join(',');
  const rows = (await query(
    `SELECT variant_id, platform, external_product_id, external_variant_id
     FROM variant_publications
     WHERE variant_id IN (${placeholders})`,
    variantIds
  )) as { variant_id: string; platform: string; external_product_id: string; external_variant_id: string }[];
  for (const r of rows || []) {
    if (!map.has(r.variant_id)) map.set(r.variant_id, {});
    const entry = map.get(r.variant_id)!;
    const prod = trimId(r.external_product_id);
    const vari = trimId(r.external_variant_id);
    if (r.platform === 'mercadolibre' && prod && !entry.mlProductId) {
      entry.mlProductId = prod;
      entry.mlVariantId = vari;
    }
    if (r.platform === 'tiendanube' && prod && vari && !entry.tnProductId) {
      entry.tnProductId = prod;
      entry.tnVariantId = vari;
    }
  }
  return map;
}

function resolveTnIds(row: VariantLinkRow, pub?: PubLinks): { productId: string; variantId: string } | null {
  const productId = trimId(row.tienda_nube_id) || trimId(pub?.tnProductId);
  const variantId = trimId(row.tienda_nube_variant_id) || trimId(pub?.tnVariantId);
  if (!productId || !variantId) return null;
  return { productId, variantId };
}

function tnMoney(n: number): string {
  return (Math.round(Math.max(0, n) * 100) / 100).toFixed(2);
}

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

type TnVariantPriceUpdate = {
  tnVariantId: string;
  price?: number;
  promo?: number | null;
  clearPromo: boolean;
};

/** Un PUT por producto: actualiza precio y promocional de todas sus variantes. */
async function updateTnProductPrices(
  storeId: string,
  accessToken: string,
  tnProductId: string,
  variants: TnVariantPriceUpdate[]
): Promise<{ ok: boolean; detail?: string }> {
  const bodyVariants = variants.map((v) => {
    const idNum = Number(v.tnVariantId);
    const item: Record<string, unknown> = {
      id: Number.isSafeInteger(idNum) ? idNum : v.tnVariantId,
    };
    if (v.price != null && Number.isFinite(v.price)) item.price = tnMoney(v.price);
    if (v.clearPromo) item.promotional_price = '';
    else if (v.promo != null && Number.isFinite(v.promo)) item.promotional_price = tnMoney(v.promo);
    return item;
  });
  const url = `https://api.tiendanube.com/v1/${storeId}/products/${tnProductId}`;
  const headers = {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': TN_USER_AGENT,
    'Content-Type': 'application/json',
  };
  try {
    await tnPutWithRetry(axios, url, { variants: bodyVariants }, { headers });
    return { ok: true };
  } catch (e: unknown) {
    const err = e as { response?: { status?: number; data?: unknown }; message?: string };
    const status = err?.response?.status;
    const data = err?.response?.data;
    const detail =
      typeof data === 'string'
        ? data.slice(0, 180)
        : data != null
          ? JSON.stringify(data).slice(0, 180)
          : err?.message || 'error';
    return { ok: false, detail: status ? `HTTP ${status} ${detail}` : detail };
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

    const pubs = await loadPublicationLinks(variantIds);
    const prices: Record<string, ChannelPriceEntry> = {};
    for (const id of variantIds) {
      prices[id] = { hasML: false, hasTN: false, productId: '' };
    }
    for (const r of rows || []) {
      const vid = r.variant_id;
      if (!prices[vid]) continue;
      const pub = pubs.get(vid);
      const mlItemId = trimId(r.mercado_libre_item_id) || trimId(r.mercado_libre_id) || trimId(pub?.mlProductId);
      const tn = resolveTnIds(r, pub);
      prices[vid] = {
        productId: r.product_id,
        sku: r.sku ?? undefined,
        priceLocal: Number(r.base_price ?? 0),
        hasML: !!mlItemId,
        hasTN: !!tn,
      };
    }

    const mlToken = await getValidMLToken();
    if (mlToken?.access_token) {
      const mlItemIds = new Map<string, { variantId: string; variationId: string | null }[]>();
      for (const r of rows || []) {
        const variantId = r.variant_id;
        const pub = pubs.get(variantId);
        const mlItemId = trimId(r.mercado_libre_item_id) || trimId(r.mercado_libre_id) || trimId(pub?.mlProductId);
        const variationId =
          trimId(r.mercado_libre_variant_id) || trimId(pub?.mlVariantId) || null;
        if (!mlItemId) continue;
        if (!mlItemIds.has(mlItemId)) mlItemIds.set(mlItemId, []);
        mlItemIds.get(mlItemId)!.push({ variantId, variationId: variationId || null });
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
        const tn = resolveTnIds(r, pubs.get(r.variant_id));
        if (!tn) continue;
        if (!tnProductIds.has(tn.productId)) tnProductIds.set(tn.productId, []);
        tnProductIds.get(tn.productId)!.push({
          variantId: r.variant_id,
          tnVariantId: tn.variantId,
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
    const updates = Array.isArray(req.body?.updates) ? req.body.updates.slice(0, 200) : [];
    const applyLocal = req.body?.applyLocal !== false;
    const applyML = req.body?.applyML !== false;
    const applyTN = req.body?.applyTN !== false;
    if (updates.length === 0) {
      return res.status(400).json({ message: 'Indicá al menos una variante en updates' });
    }

    const mlToken = applyML ? await getValidMLToken() : null;
    const tnIntegration = applyTN
      ? await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`)
      : null;
    const tnStoreId = resolveTnStoreId(tnIntegration);
    const requestedIds = updates
      .map((u: { variantId?: unknown }) => String(u?.variantId || '').trim())
      .filter(Boolean);
    const pubs = await loadPublicationLinks(requestedIds);

    let updatedLocal = 0;
    let updatedML = 0;
    let updatedTN = 0;
    const errors: string[] = [];

    const productLocalUpdated = new Set<string>();
    const tnByProduct = new Map<string, TnVariantPriceUpdate[]>();

    for (const u of updates) {
      const variantId = String(u?.variantId || '').trim();
      if (!variantId) continue;

      const row = (await get(
        `SELECT pv.id AS variant_id, p.id AS product_id, p.base_price,
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
        const pub = pubs.get(variantId);
        const mlItemId = trimId(row.mercado_libre_item_id) || trimId(row.mercado_libre_id) || trimId(pub?.mlProductId);
        const variationId = trimId(row.mercado_libre_variant_id) || trimId(pub?.mlVariantId) || null;
        if (!mlItemId) {
          errors.push(`${row.sku || variantId}: sin vínculo ML`);
        } else {
          const ok = await updateMlPrice(
            mlToken.access_token,
            mlItemId,
            variationId,
            Number(u.priceML)
          );
          if (ok) updatedML++;
          else errors.push(`${row.sku || variantId}: ML no aceptó el precio`);
        }
        if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);
      }

      if (applyTN && tnIntegration?.access_token && tnStoreId) {
        const wantsPrice = u.priceTN != null && Number.isFinite(Number(u.priceTN));
        const clearPromo = u.clearTNPromo === true;
        const wantsPromo = !clearPromo && u.priceTNPromo != null && Number.isFinite(Number(u.priceTNPromo));
        if (wantsPrice || wantsPromo || clearPromo) {
          const tn = resolveTnIds(row, pubs.get(variantId));
          if (!tn) {
            errors.push(`${row.sku || variantId}: sin vínculo TN`);
          } else {
            const price = wantsPrice ? Math.max(0, Number(u.priceTN)) : undefined;
            const promo = wantsPromo ? Math.max(0, Number(u.priceTNPromo)) : null;
            if (price != null && promo != null && promo >= price) {
              errors.push(`${row.sku || variantId}: el promocional tiene que ser menor que el precio`);
            } else {
              if (!tnByProduct.has(tn.productId)) tnByProduct.set(tn.productId, []);
              tnByProduct.get(tn.productId)!.push({
                tnVariantId: tn.variantId,
                price,
                promo,
                clearPromo,
              });
            }
          }
        }
      }
    }

    if (tnIntegration?.access_token && tnStoreId) {
      for (const [tnProductId, variants] of tnByProduct) {
        const result = await updateTnProductPrices(
          tnStoreId,
          tnIntegration.access_token,
          tnProductId,
          variants
        );
        if (result.ok) updatedTN += variants.length;
        else errors.push(`TN ${tnProductId}: ${result.detail || 'no aceptó el precio'}`);
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

function variantHasPromo(variant: { promotional_price?: unknown } | null | undefined): boolean {
  const raw = variant?.promotional_price;
  if (raw == null || String(raw).trim() === '') return false;
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) && n > 0;
}

function tnProductLabel(product: { id?: unknown; name?: unknown }): string {
  const name = product?.name;
  if (name && typeof name === 'object') {
    const bag = name as Record<string, unknown>;
    const text = bag.es || bag.pt || bag.en || Object.values(bag).find((v) => typeof v === 'string');
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  if (typeof name === 'string' && name.trim()) return name.trim();
  return String(product?.id || 'producto');
}

/**
 * POST { page?: number }
 * Recorre una página del catálogo de Tienda Nube y borra el promocional.
 * El precio de lista no se modifica. El cliente repite hasta hasMore = false.
 */
export const clearTiendaNubePromotionalPrices = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.body?.page ?? '1'), 10) || 1);
    const perPage = 20;
    const integration = await get(
      `SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`
    );
    const storeId = resolveTnStoreId(integration);
    if (!integration?.access_token || !storeId) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }

    const headers = {
      Authentication: `bearer ${integration.access_token}`,
      'User-Agent': TN_USER_AGENT,
    };
    const list = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products`, {
      headers,
      params: { page, per_page: perPage },
      validateStatus: () => true,
    });
    if (list.status !== 200 || !Array.isArray(list.data)) {
      const data = list.data as { description?: string; message?: string } | undefined;
      return res.status(502).json({
        message: 'No se pudieron leer los productos de Tienda Nube',
        detail: data?.description || data?.message || `HTTP ${list.status}`,
      });
    }

    const products = list.data as Array<{ id?: unknown; name?: unknown; variants?: Array<{ id?: unknown; promotional_price?: unknown }> }>;
    const totalHeader = Number(list.headers?.['x-total-count']);
    const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;

    let clearedProducts = 0;
    let clearedVariants = 0;
    let skippedProducts = 0;
    const errors: string[] = [];

    for (const product of products) {
      const withPromo = (product.variants || []).filter((v) => variantHasPromo(v) && v?.id != null);
      if (withPromo.length === 0) {
        skippedProducts++;
        continue;
      }
      const result = await updateTnProductPrices(
        storeId,
        integration.access_token,
        String(product.id),
        withPromo.map((v) => ({ tnVariantId: String(v.id), clearPromo: true }))
      );
      if (result.ok) {
        clearedProducts++;
        clearedVariants += withPromo.length;
      } else {
        errors.push(`${tnProductLabel(product)}: ${result.detail || 'no se pudo quitar el promocional'}`);
      }
    }

    res.json({
      page,
      perPage,
      scanned: products.length,
      total,
      clearedProducts,
      clearedVariants,
      skippedProducts,
      hasMore: products.length === perPage,
      errors: errors.slice(0, 20),
    });
  } catch (error: any) {
    console.error('[clearTiendaNubePromotionalPrices]', error?.message || error);
    res.status(500).json({ message: 'Error quitando precios promocionales', detail: error?.message });
  }
};
