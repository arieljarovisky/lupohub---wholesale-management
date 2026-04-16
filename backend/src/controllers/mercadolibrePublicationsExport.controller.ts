import { Request, Response } from 'express';
import axios from 'axios';
import ExcelJS from 'exceljs';
import { query, get } from '../database/db';
import { getValidMLToken, normalizeMercadoLibreItemId } from './integrations.controller';

const ML_SYNC_MAX_ITEMS = Math.max(100, parseInt(process.env.ML_SYNC_MAX_ITEMS || '5000', 10));
const ADS_LOOKBACK_DAYS = 30;

/** Misma lista que integrations (Product Ads). */
const ML_PADS_METRICS_DEFAULT =
  'clicks,prints,ctr,cost,cpc,acos,cvr,roas,sov,direct_amount,indirect_amount,total_amount,units_quantity,direct_units_quantity,indirect_units_quantity,advertising_items_quantity,direct_items_quantity,indirect_items_quantity';

function asYmd(raw: unknown): string {
  const s = String(raw || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** Para Excel: si el código es un id de publicación ML (MLA…, MLU…), muestra solo la parte numérica; si no, deja el SKU/código tal cual. */
function excelCodigoSinPrefijoMl(raw: string): string {
  const s = String(raw || '').trim();
  const m = s.match(/^ML[A-Z]{1,5}(\d+)$/i);
  if (m) return m[1];
  return s;
}

function normalizeSkuForMatch(raw: unknown): string {
  return (raw ?? '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[\s\-\/]/g, '');
}

function mlSkuFromVariation(v: any): string {
  const skuAttr = Array.isArray(v?.attributes)
    ? v.attributes.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU')
    : null;
  const fromAttr = skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '').toString().trim() : '';
  const fromFields = (v?.seller_sku ?? v?.seller_custom_field ?? '').toString().trim();
  return fromAttr || fromFields;
}

function mlSkuFromItem(item: any): string {
  let s = (item?.seller_sku ?? item?.seller_custom_field ?? '').toString().trim();
  if (!s && Array.isArray(item?.attributes)) {
    const skuAttr = item.attributes.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU');
    s = (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '') : '').toString().trim();
  }
  if (!s && item?.variations?.length === 1) {
    return mlSkuFromVariation(item.variations[0]);
  }
  return s;
}

/** Comisión de venta (`sale_fee_amount`) según API listing_prices de ML; respuesta puede ser array u objeto único. */
function parseListingPricesSaleFee(data: unknown, listingTypeId: string): number {
  const lt = (listingTypeId || '').trim();
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data as Record<string, unknown>] : [];
  const match = rows.find((r) => String((r as { listing_type_id?: string })?.listing_type_id || '') === lt);
  const row = match ?? rows[0];
  const n = Number((row as { sale_fee_amount?: unknown })?.sale_fee_amount);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Estima comisión por venta (ARS u otra moneda del ítem) vía GET /sites/{SITE}/listing_prices.
 * Incluye cargo variable de ML por categoría/tipo de publicación; no incluye IVA propio ni retenciones fuera de este cálculo.
 */
async function fetchListingSaleFeeAmount(
  accessToken: string,
  item: any,
  price: number,
  cache: Map<string, number>
): Promise<number> {
  const siteId = String(item?.site_id || '').trim();
  const categoryId = String(item?.category_id || '').trim();
  const listingTypeId = String(item?.listing_type_id || '').trim();
  const currencyId = String(item?.currency_id || '').trim() || 'ARS';
  const logisticType =
    item?.shipping?.logistic_type != null ? String(item.shipping.logistic_type).trim() : '';

  if (!siteId || !listingTypeId || !Number.isFinite(price) || price <= 0) return 0;

  const priceRounded = Math.round(price * 100) / 100;
  const cacheKey = `${siteId}|${categoryId}|${listingTypeId}|${priceRounded}|${currencyId}|${logisticType}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const params: Record<string, string | number> = {
    price: priceRounded,
    listing_type_id: listingTypeId,
    currency_id: currencyId
  };
  if (categoryId) params.category_id = categoryId;
  if (logisticType) params.logistic_type = logisticType;

  try {
    const res = await axios.get(`https://api.mercadolibre.com/sites/${encodeURIComponent(siteId)}/listing_prices`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params,
      validateStatus: () => true
    });
    if (res.status !== 200) {
      cache.set(cacheKey, 0);
      return 0;
    }
    const fee = parseListingPricesSaleFee(res.data, listingTypeId);
    cache.set(cacheKey, fee);
    return fee;
  } catch {
    cache.set(cacheKey, 0);
    return 0;
  }
}

type HubVariant = {
  variant_id: string;
  sku_raw: string;
  sku_norm: string;
  mercado_libre_item_id: string | null;
  mercado_libre_variant_id: string | null;
  product_id: string;
  product_name: string;
  base_price: number;
  mayorista_pack_size: number;
  mercado_libre_id: string | null;
  ml_pack_default: number;
  pub_pack?: number | null;
};

/**
 * Solo vínculos guardados en LupoHub (variant_publications, mercado_libre_item_id, mercado_libre_id + variación).
 * `itemIdNorm` = normalizeMercadoLibreItemId(id publicación ML).
 */
function resolveHubVariantFromSync(
  itemIdNorm: string,
  variationId: string | null,
  hubByMlItem: Map<string, HubVariant[]>,
  hubByMlProduct: Map<string, HubVariant[]>,
  pubMap: Map<string, HubVariant>
): HubVariant | null {
  const vKey = variationId != null && variationId !== '' ? `${itemIdNorm}|${variationId}` : `${itemIdNorm}|`;
  const pub = pubMap.get(vKey);
  if (pub) return pub;

  if (variationId != null && variationId !== '') {
    const pub2 = pubMap.get(`${itemIdNorm}|${String(variationId)}`);
    if (pub2) return pub2;
  }

  const listItem = hubByMlItem.get(itemIdNorm);
  if (listItem?.length === 1) {
    const only = listItem[0];
    if (!variationId || !only.mercado_libre_variant_id || String(only.mercado_libre_variant_id) === String(variationId)) {
      return only;
    }
  }
  if (listItem && variationId) {
    const byVar = listItem.find((h) => h.mercado_libre_variant_id && String(h.mercado_libre_variant_id) === String(variationId));
    if (byVar) return byVar;
  }

  const listProd = hubByMlProduct.get(itemIdNorm);
  if (listProd?.length === 1) return listProd[0];
  if (listProd && variationId) {
    const byVar = listProd.find((h) => h.mercado_libre_variant_id && String(h.mercado_libre_variant_id) === String(variationId));
    if (byVar) return byVar;
  }

  return null;
}

/** Sync primero; si no hay match, intenta por SKU de ML = variante LupoHub. */
function resolveHubVariantFull(
  itemIdNorm: string,
  variationId: string | null,
  skuMlNorm: string,
  hubBySku: Map<string, HubVariant>,
  hubByMlItem: Map<string, HubVariant[]>,
  hubByMlProduct: Map<string, HubVariant[]>,
  pubMap: Map<string, HubVariant>
): HubVariant | null {
  const fromSync = resolveHubVariantFromSync(itemIdNorm, variationId, hubByMlItem, hubByMlProduct, pubMap);
  if (fromSync) return fromSync;
  if (skuMlNorm) {
    const bySku = hubBySku.get(skuMlNorm);
    if (bySku) return bySku;
  }
  return null;
}

type AggBucket = {
  codigo: string;
  nombre: string;
  base_price: number;
  mayorista_pack: number;
  ml_prices: number[];
  /** Comisión de venta ML (`sale_fee_amount`) por el mismo índice que ml_prices. */
  ml_sale_fees: number[];
  /** Unidades vendidas en ML en el período (órdenes pagadas, por publicación/variación). */
  ventas_periodo_suma: number;
  variant_ids: Set<string>;
  ml_item_ids: Set<string>;
  permalinks: Set<string>;
};

/** Suma costo Product Ads por ítem ML, solo campañas con estado active en el período. */
async function fetchActiveCampaignProductAdsCostByItem(
  accessToken: string,
  dateFrom: string,
  dateTo: string
): Promise<Map<string, number>> {
  const costByItem = new Map<string, number>();
  try {
    const advRes = await axios.get('https://api.mercadolibre.com/advertising/advertisers', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Api-Version': '1'
      },
      params: { product_id: 'PADS' },
      validateStatus: () => true
    });
    if (advRes.status !== 200 || !Array.isArray(advRes.data?.advertisers)) {
      return costByItem;
    }

    for (const adv of advRes.data.advertisers) {
      const siteId = String(adv.site_id || '').trim();
      const advertiserId = adv.advertiser_id;
      if (!siteId || advertiserId == null) continue;

      const campaigns: any[] = [];
      let cOff = 0;
      const cLim = 50;
      while (true) {
        const url = `https://api.mercadolibre.com/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${encodeURIComponent(String(advertiserId))}/product_ads/campaigns/search`;
        const cr = await axios.get(url, {
          headers: { Authorization: `Bearer ${accessToken}`, 'api-version': '2' },
          params: {
            date_from: dateFrom,
            date_to: dateTo,
            limit: cLim,
            offset: cOff,
            metrics: ML_PADS_METRICS_DEFAULT
          },
          validateStatus: () => true
        });
        if (cr.status !== 200) break;
        const batch = cr.data?.results || [];
        campaigns.push(...batch);
        if (batch.length < cLim) break;
        cOff += cLim;
        if (cOff > 5000) break;
      }

      const active = campaigns.filter((c) => String(c.status || '').toLowerCase() === 'active');
      for (const camp of active) {
        const cid = camp.id;
        let aOff = 0;
        const aLim = 50;
        while (true) {
          const adsUrl = `https://api.mercadolibre.com/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${encodeURIComponent(String(advertiserId))}/product_ads/ads/search`;
          const ar = await axios.get(adsUrl, {
            headers: { Authorization: `Bearer ${accessToken}`, 'api-version': '2' },
            params: {
              date_from: dateFrom,
              date_to: dateTo,
              limit: aLim,
              offset: aOff,
              channel: 'marketplace',
              metrics: ML_PADS_METRICS_DEFAULT,
              'filters[campaign_id]': String(cid)
            },
            validateStatus: () => true
          });
          if (ar.status !== 200) break;
          const results = ar.data?.results || [];
          for (const row of results) {
            const iid = normalizeMercadoLibreItemId(row.item_id);
            const cost = Number(row.metrics?.cost) || 0;
            if (!iid) continue;
            costByItem.set(iid, (costByItem.get(iid) || 0) + cost);
          }
          if (results.length < aLim) break;
          aOff += aLim;
          if (aOff > 10000) break;
        }
      }
    }
  } catch (e) {
    console.warn('[publications-export] Product Ads costos:', e);
  }
  return costByItem;
}

type ProductAdsCampaignRow = {
  site_id: string;
  advertiser_id: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  cost: number;
  total_amount: number;
  roas: number;
  acos: number;
  clicks: number;
  prints: number;
};

/** Campañas Product Ads del período (todas) con métricas agregadas por campaña. */
async function fetchProductAdsCampaignRows(
  accessToken: string,
  dateFrom: string,
  dateTo: string
): Promise<ProductAdsCampaignRow[]> {
  const out: ProductAdsCampaignRow[] = [];
  try {
    const advRes = await axios.get('https://api.mercadolibre.com/advertising/advertisers', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Api-Version': '1'
      },
      params: { product_id: 'PADS' },
      validateStatus: () => true
    });
    if (advRes.status !== 200 || !Array.isArray(advRes.data?.advertisers)) return out;

    for (const adv of advRes.data.advertisers) {
      const siteId = String(adv.site_id || '').trim();
      const advertiserId = String(adv.advertiser_id || '').trim();
      if (!siteId || !advertiserId) continue;
      let offset = 0;
      const limit = 50;
      while (offset < 5000) {
        const url = `https://api.mercadolibre.com/marketplace/advertising/${encodeURIComponent(siteId)}/advertisers/${encodeURIComponent(advertiserId)}/product_ads/campaigns/search`;
        const r = await axios.get(url, {
          headers: { Authorization: `Bearer ${accessToken}`, 'api-version': '2' },
          params: {
            date_from: dateFrom,
            date_to: dateTo,
            limit,
            offset,
            metrics: ML_PADS_METRICS_DEFAULT
          },
          validateStatus: () => true
        });
        if (r.status !== 200) break;
        const batch = Array.isArray(r.data?.results) ? r.data.results : [];
        for (const c of batch) {
          const m = c?.metrics || {};
          out.push({
            site_id: siteId,
            advertiser_id: advertiserId,
            campaign_id: String(c?.id || ''),
            campaign_name: String(c?.name || ''),
            status: String(c?.status || ''),
            cost: Number(m.cost) || 0,
            total_amount: Number(m.total_amount) || 0,
            roas: Number(m.roas) || 0,
            acos: Number(m.acos) || 0,
            clicks: Number(m.clicks) || 0,
            prints: Number(m.prints) || 0
          });
        }
        if (batch.length < limit) break;
        offset += limit;
      }
    }
  } catch (e) {
    console.warn('[publications-export] Product Ads campañas:', e);
  }
  return out;
}

/**
 * Suma unidades vendidas por publicación/variación ML en órdenes con estado `paid`
 * creadas en el rango [dateFromYmd, dateToYmd] (inclusive, horario -03:00 como en el resto del backend).
 * Clave: `normalizeMercadoLibreItemId(itemId)|variationId` (variationId vacío si la publicación no tiene variaciones).
 */
async function fetchMercadoLibreSoldUnitsInDateRange(
  accessToken: string,
  sellerUserId: string,
  dateFromYmd: string,
  dateToYmd: string
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let offset = 0;
  const limit = 50;
  while (offset < 20000) {
    const res = await axios.get('https://api.mercadolibre.com/orders/search', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        seller: sellerUserId,
        'order.status': 'paid',
        'order.date_created.from': `${dateFromYmd}T00:00:00.000-03:00`,
        'order.date_created.to': `${dateToYmd}T23:59:59.999-03:00`,
        offset,
        limit,
        sort: 'date_desc'
      },
      validateStatus: () => true
    });
    if (res.status !== 200) {
      console.warn('[publications-export] orders/search ventas:', res.status, res.data?.message || res.data);
      break;
    }
    const results = Array.isArray(res.data?.results) ? res.data.results : [];
    for (const order of results) {
      for (const line of order.order_items || []) {
        const iid = normalizeMercadoLibreItemId(line?.item?.id);
        if (!iid) continue;
        const rawVid = line?.item?.variation_id;
        const vid = rawVid != null && String(rawVid).trim() !== '' ? String(rawVid).trim() : '';
        const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
        const k = `${iid}|${vid}`;
        map.set(k, (map.get(k) || 0) + qty);
      }
    }
    if (results.length < limit) break;
    offset += limit;
  }
  return map;
}

export const exportMercadolibrePublicationsXlsx = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const toYmd = (d: Date) => d.toISOString().slice(0, 10);
    const todayYmd = toYmd(new Date());
    const qFrom = asYmd(req.query.from || req.query.desde);
    const qTo = asYmd(req.query.to || req.query.hasta);
    const dateToStr = qTo || todayYmd;
    const dateFromStr =
      qFrom ||
      (() => {
        const d = new Date();
        d.setDate(d.getDate() - ADS_LOOKBACK_DAYS);
        return toYmd(d);
      })();
    if (dateFromStr > dateToStr) {
      return res.status(400).json({ message: 'Rango inválido: from no puede ser mayor que to' });
    }
    // Ventas usa el mismo período elegido por usuario.
    const salesFromStr = dateFromStr;
    const salesToStr = dateToStr;

    const hubRows = (await query(`
      SELECT pv.id AS variant_id,
             TRIM(COALESCE(pv.external_sku, pv.sku)) AS sku_raw,
             pv.mercado_libre_item_id,
             pv.mercado_libre_variant_id,
             p.id AS product_id,
             p.sku AS product_sku,
             p.name AS product_name,
             p.base_price,
             COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size,
             p.mercado_libre_id,
             COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack_default
      FROM product_variants pv
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
    `)) as Array<{
      variant_id: string;
      sku_raw: string;
      mercado_libre_item_id: string | null;
      mercado_libre_variant_id: string | null;
      product_id: string;
      product_sku: string | null;
      product_name: string;
      base_price: string | number | null;
      mayorista_pack_size: string | number | null;
      mercado_libre_id: string | null;
      ml_pack_default: string | number | null;
    }>;

    const hubBySku = new Map<string, HubVariant>();
    const hubByMlItem = new Map<string, HubVariant[]>();
    const hubByMlProduct = new Map<string, HubVariant[]>();
    const variantById = new Map<string, HubVariant>();

    for (const r of hubRows) {
      const skuRaw = (r.sku_raw || '').toString();
      const hv: HubVariant = {
        variant_id: r.variant_id,
        sku_raw: skuRaw,
        sku_norm: normalizeSkuForMatch(skuRaw),
        mercado_libre_item_id: r.mercado_libre_item_id,
        mercado_libre_variant_id: r.mercado_libre_variant_id,
        product_id: r.product_id,
        product_name: (r.product_name || '').toString(),
        base_price: Number(r.base_price ?? 0),
        mayorista_pack_size: Math.max(1, Number(r.mayorista_pack_size) || 1),
        mercado_libre_id: r.mercado_libre_id,
        ml_pack_default: Math.max(1, Number(r.ml_pack_default) || 1)
      };
      variantById.set(r.variant_id, hv);
      if (hv.sku_norm) hubBySku.set(hv.sku_norm, hv);
      if (r.mercado_libre_item_id) {
        const k = normalizeMercadoLibreItemId(r.mercado_libre_item_id);
        if (k) {
          if (!hubByMlItem.has(k)) hubByMlItem.set(k, []);
          hubByMlItem.get(k)!.push(hv);
        }
      }
      if (r.mercado_libre_id) {
        const k = normalizeMercadoLibreItemId(r.mercado_libre_id);
        if (k) {
          if (!hubByMlProduct.has(k)) hubByMlProduct.set(k, []);
          hubByMlProduct.get(k)!.push(hv);
        }
      }
    }

    const pubRows = (await query(
      `SELECT variant_id, external_product_id, external_variant_id, pack_size
       FROM variant_publications WHERE platform = 'mercadolibre'`
    )) as Array<{
      variant_id: string;
      external_product_id: string;
      external_variant_id: string | null;
      pack_size: string | number | null;
    }>;

    const pubMap = new Map<string, HubVariant>();
    for (const pr of pubRows) {
      const base = variantById.get(pr.variant_id);
      if (!base) continue;
      const extVar =
        pr.external_variant_id != null && String(pr.external_variant_id).trim() !== ''
          ? String(pr.external_variant_id).trim()
          : '';
      const ep = normalizeMercadoLibreItemId(pr.external_product_id);
      if (!ep) continue;
      const key = `${ep}|${extVar}`;
      pubMap.set(key, {
        ...base,
        pub_pack: pr.pack_size != null ? Math.max(1, Number(pr.pack_size) || 1) : null
      });
    }

    /** Precio FOB por producto: lista de precios cuyo nombre contiene "fob" (ej. "precios FOB") o env LUPOHUB_FOB_PRICE_LIST_ID. */
    let fobListName = '';
    const fobListIdEnv = (process.env.LUPOHUB_FOB_PRICE_LIST_ID || '').trim();
    let fobListId: string | null = null;
    if (fobListIdEnv) {
      const exists = await get('SELECT id, name FROM price_lists WHERE id = ?', [fobListIdEnv]);
      if (exists?.id) {
        fobListId = String(exists.id);
        fobListName = (exists as any).name || '';
      }
    }
    if (!fobListId) {
      const pl = await get(
        `SELECT id, name FROM price_lists WHERE LOWER(TRIM(name)) LIKE '%fob%' ORDER BY CASE WHEN LOWER(TRIM(name)) = 'precios fob' THEN 0 ELSE 1 END, name LIMIT 1`
      );
      if (pl?.id) {
        fobListId = String(pl.id);
        fobListName = String((pl as any).name || '');
      }
    }
    const fobPriceRows = fobListId
      ? ((await query(`SELECT product_id, price FROM price_list_items WHERE price_list_id = ?`, [fobListId])) as Array<{
          product_id: string;
          price: string | number | null;
        }>)
      : [];
    const fobByProductId = new Map<string, number>();
    for (const fr of fobPriceRows) {
      fobByProductId.set(String(fr.product_id), Number(fr.price) || 0);
    }

    const productMeta = new Map<
      string,
      { codigo: string; nombre: string; base_price: number; mayorista_pack: number; hasCodigo: boolean }
    >();
    for (const r of hubRows) {
      if (productMeta.has(r.product_id)) continue;
      const skuTrim = ((r.product_sku || '') as string).trim();
      const codigo = skuTrim || r.product_id;
      productMeta.set(r.product_id, {
        codigo,
        nombre: (r.product_name || '').toString(),
        base_price: Number(r.base_price ?? 0),
        mayorista_pack: Math.max(1, Number(r.mayorista_pack_size) || 1),
        hasCodigo: skuTrim.length > 0
      });
    }

    const costByItemId = await fetchActiveCampaignProductAdsCostByItem(
      mlToken.access_token,
      dateFromStr,
      dateToStr
    );
    const productAdsCampaignRows = await fetchProductAdsCampaignRows(
      mlToken.access_token,
      dateFromStr,
      dateToStr
    );

    const soldUnitsByItemVariation = await fetchMercadoLibreSoldUnitsInDateRange(
      mlToken.access_token,
      String(mlToken.user_id),
      salesFromStr,
      salesToStr
    );

    /** Todas las publicaciones del vendedor (activas, pausadas y cerradas), hasta ML_SYNC_MAX_ITEMS. */
    const seen = new Set<string>();
    const allItemIds: string[] = [];
    for (const st of ['active', 'paused', 'closed'] as const) {
      let offset = 0;
      const limit = 100;
      while (allItemIds.length < ML_SYNC_MAX_ITEMS) {
        const itemsRes = await axios.get(
          `https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=${st}&offset=${offset}&limit=${limit}`,
          { headers: { Authorization: `Bearer ${mlToken.access_token}` } }
        );
        const ids: string[] = itemsRes.data?.results || [];
        if (ids.length === 0) break;
        for (const id of ids) {
          if (seen.has(id)) continue;
          seen.add(id);
          allItemIds.push(id);
          if (allItemIds.length >= ML_SYNC_MAX_ITEMS) break;
        }
        if (allItemIds.length >= ML_SYNC_MAX_ITEMS) break;
        if (ids.length < limit) break;
        offset += limit;
      }
    }

    const buckets = new Map<string, AggBucket>();

    function ensureBucket(key: string, init: Partial<AggBucket> & Pick<AggBucket, 'codigo' | 'nombre' | 'base_price' | 'mayorista_pack'>): AggBucket {
      let b = buckets.get(key);
      if (!b) {
        b = {
          codigo: init.codigo,
          nombre: init.nombre,
          base_price: init.base_price,
          mayorista_pack: init.mayorista_pack,
          ml_prices: [],
          ml_sale_fees: [],
          ventas_periodo_suma: 0,
          variant_ids: new Set(),
          ml_item_ids: new Set(),
          permalinks: new Set()
        };
        buckets.set(key, b);
      }
      return b;
    }

    const listingSaleFeeCache = new Map<string, number>();
    const publicationRows: Array<{
      item_id: string;
      titulo: string;
      estado: string;
      link: string;
      precio_actual: number;
      ventas_unid_periodo: number;
      facturacion_periodo: number;
      comision_unidad: number;
      comision_total: number;
      inversion_ads: number;
      resultado_estimado: number;
    }> = [];

    const batchSize = 10;
    for (let i = 0; i < allItemIds.length; i += batchSize) {
      const batch = allItemIds.slice(i, i + batchSize);
      const itemPromises = batch.map((itemId: string) =>
        axios
          .get(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}?include_attributes=all`, {
            headers: { Authorization: `Bearer ${mlToken.access_token}` }
          })
          .then((r) => r.data)
          .catch(() => null)
      );
      const items = await Promise.all(itemPromises);

      for (const item of items) {
        if (!item?.id) continue;
        const itemIdNorm = normalizeMercadoLibreItemId(String(item.id));

        const bump = async (variationId: string | null, skuMl: string, price: number) => {
          const skuNorm = normalizeSkuForMatch(skuMl);
          const hub = resolveHubVariantFull(
            itemIdNorm,
            variationId,
            skuNorm,
            hubBySku,
            hubByMlItem,
            hubByMlProduct,
            pubMap
          );
          if (hub) {
            const meta = productMeta.get(hub.product_id);
            if (!meta?.hasCodigo) return;
            const codigo = meta.codigo;
            const nombre = meta.nombre ?? hub.product_name;
            const bp = meta.base_price ?? hub.base_price;
            const pk = meta.mayorista_pack ?? hub.mayorista_pack_size;
            const key = `p:${hub.product_id}`;
            const b = ensureBucket(key, {
              codigo,
              nombre,
              base_price: bp,
              mayorista_pack: pk
            });
            const saleFee = await fetchListingSaleFeeAmount(mlToken.access_token, item, price, listingSaleFeeCache);
            b.ml_prices.push(price);
            b.ml_sale_fees.push(saleFee);
            const vid = variationId != null && String(variationId).trim() !== '' ? String(variationId).trim() : '';
            const soldKey = `${itemIdNorm}|${vid}`;
            b.ventas_periodo_suma += soldUnitsByItemVariation.get(soldKey) ?? 0;
            b.variant_ids.add(hub.variant_id);
            b.ml_item_ids.add(itemIdNorm);
            const pl = (item.permalink || '').toString().trim();
            if (pl) b.permalinks.add(pl);
          }
        };

        if (item.variations && item.variations.length > 0) {
          for (const v of item.variations) {
            const skuMl = mlSkuFromVariation(v);
            const price = Number(v.price ?? item.price ?? 0) || 0;
            await bump(String(v.id), skuMl, price);
          }
        } else {
          const skuMl = mlSkuFromItem(item);
          const price = Number(item.price ?? 0) || 0;
          await bump(null, skuMl, price);
        }

        let ventasPeriodo = 0;
        let precioActual = Number(item.price ?? 0) || 0;
        if (Array.isArray(item.variations) && item.variations.length > 0) {
          let sumPrice = 0;
          for (const v of item.variations) {
            const vid = String(v?.id ?? '').trim();
            const soldKey = `${itemIdNorm}|${vid}`;
            ventasPeriodo += soldUnitsByItemVariation.get(soldKey) ?? 0;
            sumPrice += Number(v?.price ?? item.price ?? 0) || 0;
          }
          precioActual = sumPrice > 0 ? sumPrice / item.variations.length : precioActual;
        } else {
          ventasPeriodo = soldUnitsByItemVariation.get(`${itemIdNorm}|`) ?? 0;
        }
        const inversionItem = costByItemId.get(itemIdNorm) || 0;
        const comisionUnidad = await fetchListingSaleFeeAmount(
          mlToken.access_token,
          item,
          precioActual,
          listingSaleFeeCache
        );
        const facturacionPeriodo = precioActual * ventasPeriodo;
        const comisionTotal = comisionUnidad * ventasPeriodo;
        const resultadoEstimado = facturacionPeriodo - comisionTotal - inversionItem;
        publicationRows.push({
          item_id: itemIdNorm,
          titulo: String(item.title || ''),
          estado: String(item.status || ''),
          link: String(item.permalink || ''),
          precio_actual: Math.round(precioActual * 100) / 100,
          ventas_unid_periodo: ventasPeriodo,
          facturacion_periodo: Math.round(facturacionPeriodo * 100) / 100,
          comision_unidad: Math.round(comisionUnidad * 100) / 100,
          comision_total: Math.round(comisionTotal * 100) / 100,
          inversion_ads: Math.round(inversionItem * 100) / 100,
          resultado_estimado: Math.round(resultadoEstimado * 100) / 100
        });
      }
    }

    const rowsOut: Array<{
      codigo: string;
      links_ml: string;
      fob: number | null;
      precio_ml_prom: number;
      ventas_periodo: number;
      comision_ml_prom: number;
      inversion: number;
      /** Por unidad: precio ML − comisión ML − FOB (lo que ganarías por unidad). */
      margen_unidad: number | null;
      /** En el período: margen_unidad × ventas − inversión Product Ads (estimado de lo ganado). */
      ganancia: number | null;
    }> = [];

    for (const [key, agg] of buckets) {
      if (agg.ml_prices.length === 0) continue;
      const precioMlProm = agg.ml_prices.reduce((a, p) => a + p, 0) / agg.ml_prices.length;
      const comisionMlProm =
        agg.ml_sale_fees.length > 0 && agg.ml_sale_fees.length === agg.ml_prices.length
          ? agg.ml_sale_fees.reduce((a, f) => a + f, 0) / agg.ml_sale_fees.length
          : 0;
      let fobCost: number | null = null;
      if (key.startsWith('p:')) {
        const pid = key.slice(2);
        fobCost = fobByProductId.has(pid) ? fobByProductId.get(pid)! : null;
      } else {
        fobCost = null;
      }
      let inversion = 0;
      for (const iid of agg.ml_item_ids) {
        inversion += costByItemId.get(normalizeMercadoLibreItemId(iid)) || 0;
      }
      let margenUnidad: number | null = null;
      let ganancia: number | null = null;
      if (fobCost != null && Number.isFinite(fobCost)) {
        const fobN = Number(fobCost);
        const margenRaw = precioMlProm - comisionMlProm - fobN;
        margenUnidad = Number.isFinite(margenRaw) ? Math.round(margenRaw * 100) / 100 : null;
        const ventasN = Math.max(0, Math.floor(Number(agg.ventas_periodo_suma) || 0));
        const gananciaRaw = margenRaw * ventasN - inversion;
        ganancia = Number.isFinite(gananciaRaw) ? Math.round(gananciaRaw * 100) / 100 : null;
      }
      const linksText = Array.from(agg.permalinks)
        .filter(Boolean)
        .join('; ');

      rowsOut.push({
        codigo: excelCodigoSinPrefijoMl(agg.codigo),
        links_ml: linksText,
        fob: fobCost,
        precio_ml_prom: precioMlProm,
        ventas_periodo: agg.ventas_periodo_suma,
        comision_ml_prom: comisionMlProm,
        inversion,
        margen_unidad: margenUnidad,
        ganancia
      });
    }

    rowsOut.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LupoHub';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('Por artículo', {
      views: [{ state: 'frozen', ySplit: 2 }],
      properties: { defaultRowHeight: 18 }
    });

    const fobHeader = fobListName ? `Precio FOB (lista: ${fobListName})` : 'Precio FOB (lista de precios FOB)';
    ws.addRow([
      'Código artículo',
      'Link Mercado Libre',
      fobHeader,
      'Precio Mercado Libre (ARS, prom.)',
      `Ventas ${salesFromStr} a ${salesToStr} (unid., órdenes pagadas ML)`,
      'Comisión venta ML estimada (ARS, prom.)',
      `Inversión campaña activa (ARS, Product Ads ${dateFromStr}–${dateToStr})`,
      'Margen por unidad (ARS)',
      `Ganancia (${salesFromStr} a ${salesToStr}, ARS)`
    ]);
    const noteText =
      `Solo productos del catálogo con código de artículo (SKU) cargado; publicaciones sin código o sin vínculo con el inventario no se listan. Hasta ${ML_SYNC_MAX_ITEMS} publicaciones ML del vendedor. Código: referencia interna. FOB: lista ` +
      (fobListName ? `"${fobListName}"` : 'con "fob" en el nombre') +
      (fobListIdEnv ? ' (LUPOHUB_FOB_PRICE_LIST_ID).' : '.') +
      ` Ventas: unidades en órdenes pagadas entre ${salesFromStr} y ${salesToStr}. Comisión venta: API listing_prices (sale_fee_amount). Margen por unidad = precio ML (prom.) − comisión ML (prom.) − FOB. Ganancia del período = (margen por unidad × ventas del período) − inversión Product Ads. Si falta FOB, margen y ganancia quedan vacíos.`;
    ws.addRow([noteText, '', '', '', '', '', '', '', '']);
    ws.mergeCells(2, 1, 2, 9);
    const note = ws.getRow(2).getCell(1);
    note.font = { italic: true, size: 10, name: 'Calibri', color: { argb: 'FF64748B' } };
    note.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, name: 'Calibri', size: 11 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E40AF' }
    };
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });

    let rowIdx = 3;
    for (const row of rowsOut) {
      const dataRow = ws.addRow([
        row.codigo,
        row.links_ml,
        row.fob ?? '',
        row.precio_ml_prom,
        row.ventas_periodo,
        row.comision_ml_prom,
        row.inversion,
        row.margen_unidad ?? '',
        row.ganancia ?? ''
      ]);
      dataRow.eachCell((cell, colNumber) => {
        cell.font = { name: 'Calibri', size: 11 };
        if (colNumber === 5) cell.numFmt = '#,##0';
        else if ([3, 4, 6, 7, 8, 9].includes(colNumber)) cell.numFmt = '#,##0.00';
      });
      if (rowIdx % 2 === 0) {
        dataRow.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        });
      }
      rowIdx++;
    }

    ws.columns = [
      { width: 18 },
      { width: 52 },
      { width: 28 },
      { width: 26 },
      { width: 22 },
      { width: 34 },
      { width: 36 },
      { width: 22 },
      { width: 22 }
    ];

    // Hoja 2: todas las publicaciones de la cuenta (sin exigir vínculo SKU/inventario)
    const wsPub = workbook.addWorksheet('Publicaciones');
    wsPub.views = [{ state: 'frozen', ySplit: 1 }];
    wsPub.columns = [
      { header: 'Item ID', key: 'item_id', width: 16 },
      { header: 'Título', key: 'titulo', width: 42 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Link', key: 'link', width: 52 },
      { header: 'Precio actual', key: 'precio_actual', width: 16 },
      { header: 'Ventas unid. período', key: 'ventas_unid_periodo', width: 18 },
      { header: 'Facturación período', key: 'facturacion_periodo', width: 18 },
      { header: 'Comisión unid. estimada', key: 'comision_unidad', width: 20 },
      { header: 'Comisión total estimada', key: 'comision_total', width: 20 },
      { header: 'Inversión Ads', key: 'inversion_ads', width: 16 },
      { header: 'Resultado estimado', key: 'resultado_estimado', width: 18 }
    ];
    wsPub.getRow(1).font = { bold: true };
    publicationRows.forEach((r) => wsPub.addRow(r));
    for (let i = 2; i <= wsPub.rowCount; i++) {
      wsPub.getCell(`E${i}`).numFmt = '#,##0.00';
      wsPub.getCell(`F${i}`).numFmt = '#,##0';
      wsPub.getCell(`G${i}`).numFmt = '#,##0.00';
      wsPub.getCell(`H${i}`).numFmt = '#,##0.00';
      wsPub.getCell(`I${i}`).numFmt = '#,##0.00';
      wsPub.getCell(`J${i}`).numFmt = '#,##0.00';
      wsPub.getCell(`K${i}`).numFmt = '#,##0.00';
    }

    // Hoja 3: campañas Product Ads (cuando la API devuelve anunciantes/permisos)
    const wsAds = workbook.addWorksheet('Ads campañas');
    wsAds.views = [{ state: 'frozen', ySplit: 1 }];
    wsAds.columns = [
      { header: 'Site', key: 'site_id', width: 10 },
      { header: 'Advertiser', key: 'advertiser_id', width: 14 },
      { header: 'Campaign ID', key: 'campaign_id', width: 14 },
      { header: 'Campaña', key: 'campaign_name', width: 34 },
      { header: 'Estado', key: 'status', width: 14 },
      { header: 'Inversión', key: 'cost', width: 14 },
      { header: 'Ventas atribuidas', key: 'total_amount', width: 18 },
      { header: 'ROAS', key: 'roas', width: 10 },
      { header: 'ACOS', key: 'acos', width: 10 },
      { header: 'Clicks', key: 'clicks', width: 10 },
      { header: 'Impresiones', key: 'prints', width: 12 }
    ];
    wsAds.getRow(1).font = { bold: true };
    productAdsCampaignRows.forEach((r) => wsAds.addRow(r));
    for (let i = 2; i <= wsAds.rowCount; i++) {
      wsAds.getCell(`F${i}`).numFmt = '#,##0.00';
      wsAds.getCell(`G${i}`).numFmt = '#,##0.00';
      wsAds.getCell(`H${i}`).numFmt = '#,##0.00';
      wsAds.getCell(`I${i}`).numFmt = '#,##0.00';
      wsAds.getCell(`J${i}`).numFmt = '#,##0';
      wsAds.getCell(`K${i}`).numFmt = '#,##0';
    }

    // Hoja 4: resumen ejecutivo de cuenta ML
    const totalFacturacionPub = publicationRows.reduce((acc, r) => acc + (r.facturacion_periodo || 0), 0);
    const totalInversionPub = publicationRows.reduce((acc, r) => acc + (r.inversion_ads || 0), 0);
    const totalResultadoPub = publicationRows.reduce((acc, r) => acc + (r.resultado_estimado || 0), 0);
    const totalVentasUnidPub = publicationRows.reduce((acc, r) => acc + (r.ventas_unid_periodo || 0), 0);
    const totalGananciaArticulos = rowsOut.reduce((acc, r) => acc + (r.ganancia || 0), 0);
    const totalInversionCampanas = productAdsCampaignRows.reduce((acc, r) => acc + (r.cost || 0), 0);
    const totalVentasAtribAds = productAdsCampaignRows.reduce((acc, r) => acc + (r.total_amount || 0), 0);

    const wsResumen = workbook.addWorksheet('Resumen cuenta');
    wsResumen.columns = [{ width: 44 }, { width: 24 }];
    wsResumen.addRow(['Reporte completo Mercado Libre', '']);
    wsResumen.mergeCells(1, 1, 1, 2);
    wsResumen.getCell('A1').font = { bold: true, size: 13 };
    wsResumen.addRow(['Período del reporte', `${dateFromStr} a ${dateToStr}`]);
    wsResumen.addRow(['Publicaciones consideradas', publicationRows.length]);
    wsResumen.addRow(['Ventas unidades (publicaciones)', totalVentasUnidPub]);
    wsResumen.addRow(['Facturación estimada (publicaciones)', totalFacturacionPub]);
    wsResumen.addRow(['Inversión Ads detectada (publicaciones)', totalInversionPub]);
    wsResumen.addRow(['Resultado estimado (publicaciones)', totalResultadoPub]);
    wsResumen.addRow(['Ganancia estimada por artículo (con FOB)', totalGananciaArticulos]);
    wsResumen.addRow(['Campañas Product Ads', productAdsCampaignRows.length]);
    wsResumen.addRow(['Inversión Product Ads (campañas)', totalInversionCampanas]);
    wsResumen.addRow(['Ventas atribuidas Product Ads (campañas)', totalVentasAtribAds]);
    for (let r = 2; r <= wsResumen.rowCount; r++) wsResumen.getCell(`A${r}`).font = { bold: true };
    for (let r = 4; r <= wsResumen.rowCount; r++) {
      if (r === 4) wsResumen.getCell(`B${r}`).numFmt = '#,##0';
      else wsResumen.getCell(`B${r}`).numFmt = '#,##0.00';
    }

    const buf = await workbook.xlsx.writeBuffer();
    const filename = `reporte_ml_completo_${dateFromStr}_a_${dateToStr}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (error: any) {
    console.error('exportMercadolibrePublicationsXlsx:', error);
    res.status(500).json({ message: 'Error generando exportación de Mercado Libre', error: error.message });
  }
};
