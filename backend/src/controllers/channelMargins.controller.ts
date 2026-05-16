/**
 * Márgenes por canal agrupados por artículo (producto padre).
 * Todas las variantes comparten el mismo precio en ML/TN → un cálculo por artículo.
 */
import { Request, Response } from 'express';
import axios from 'axios';
import { query, get } from '../database/db';
import { getValidMLToken } from './integrations.controller';
import {
  resolveFobPriceList,
  resolveTnFeePreset,
  listTnFeePresets,
  calcTnSaleFeeFromPreset,
  getIvaMultiplier,
  getMlPaymentCptPercent,
  calcMlPaymentCpt,
  calcMargin,
  calcMarginPercent,
  fetchListingSaleFeeAmount,
} from '../utils/channelMarginUtils';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';

type VariantRow = {
  variant_id: string;
  product_id: string;
  sku: string | null;
  color_name: string | null;
  size_code: string | null;
  mercado_libre_id: string | null;
  mercado_libre_item_id: string | null;
  mercado_libre_variant_id: string | null;
  tienda_nube_id: string | null;
  tienda_nube_variant_id: string | null;
};

type ProductGroupRow = {
  product_id: string;
  product_name: string;
  base_sku: string | null;
  variant_count: number;
};

type ChannelMarginSlice = {
  price: number;
  fee: number;
  feeListing?: number;
  feePayment?: number;
  feeRate?: number;
  feeCpt?: number;
  margin: number | null;
  marginPercent: number | null;
};

function buildChannelSlice(price: number, fee: number, fob: number | null): ChannelMarginSlice {
  const margin = calcMargin(price, fee, fob);
  return {
    price: Math.round(price * 100) / 100,
    fee: Math.round(fee * 100) / 100,
    margin,
    marginPercent: margin != null ? calcMarginPercent(margin, price) : null,
  };
}

const ML_LINKED = `(
  NULLIF(TRIM(pv.mercado_libre_item_id), '') IS NOT NULL
  OR NULLIF(TRIM(p.mercado_libre_id), '') IS NOT NULL
  OR NULLIF(TRIM(pv.mercado_libre_variant_id), '') IS NOT NULL
  OR EXISTS (SELECT 1 FROM variant_publications vp WHERE vp.variant_id = pv.id AND vp.platform = 'mercadolibre')
)`;

const TN_LINKED = `(
  (NULLIF(TRIM(p.tienda_nube_id), '') IS NOT NULL AND NULLIF(TRIM(pv.tienda_nube_variant_id), '') IS NOT NULL)
  OR EXISTS (SELECT 1 FROM variant_publications vp WHERE vp.variant_id = pv.id AND vp.platform = 'tiendanube')
)`;

function variantChannelWhere(channel: string): string {
  if (channel === 'ml') return `AND ${ML_LINKED}`;
  if (channel === 'tn') return `AND ${TN_LINKED}`;
  return `AND (${ML_LINKED} OR ${TN_LINKED})`;
}

function trimId(v: string | null | undefined): string {
  return v != null ? String(v).trim() : '';
}

type PubLinks = { mlProductId?: string; mlVariantId?: string; tnProductId?: string; tnVariantId?: string };

function resolveVariantLinks(v: VariantRow, pubs: Map<string, PubLinks>) {
  const pub = pubs.get(v.variant_id);
  const mlItemId =
    trimId(v.mercado_libre_item_id) || trimId(v.mercado_libre_id) || trimId(pub?.mlProductId);
  const mlVariationId = trimId(v.mercado_libre_variant_id) || trimId(pub?.mlVariantId) || null;
  const tnProductId = trimId(v.tienda_nube_id) || trimId(pub?.tnProductId);
  const tnVariantId = trimId(v.tienda_nube_variant_id) || trimId(pub?.tnVariantId);
  return {
    mlItemId: mlItemId || null,
    mlVariationId: mlVariationId || null,
    hasMl: !!mlItemId,
    tnProductId: tnProductId || null,
    tnVariantId: tnVariantId || null,
    hasTn: !!(tnProductId && tnVariantId),
  };
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

/** GET /integrations/channel-margins — una fila por artículo (producto padre). */
export const getChannelMargins = async (req: Request, res: Response) => {
  try {
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || '50'), 10) || 50));
    const channel = String(req.query.channel || 'all').toLowerCase();
    const offset = (page - 1) * limit;

    const channelWhere = variantChannelWhere(channel);
    const searchWhere = search
      ? `AND (p.name LIKE ? OR p.sku LIKE ? OR pv.sku LIKE ? OR c.name LIKE ?)`
      : '';
    const searchParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`] : [];

    const joinFrom = `
       FROM products p
       INNER JOIN product_colors pc ON pc.product_id = p.id
       INNER JOIN product_variants pv ON pv.product_color_id = pc.id
       INNER JOIN colors c ON c.id = pc.color_id
       INNER JOIN sizes s ON s.id = pv.size_id
       WHERE 1=1 ${channelWhere} ${searchWhere}`;

    const countRow = (await get(
      `SELECT COUNT(DISTINCT p.id) AS total ${joinFrom}`,
      searchParams
    )) as { total: number } | undefined;
    const total = Number(countRow?.total ?? 0);

    const productRows = (await query(
      `SELECT p.id AS product_id, p.name AS product_name, p.sku AS base_sku,
              COUNT(DISTINCT pv.id) AS variant_count
       ${joinFrom}
       GROUP BY p.id, p.name, p.sku
       ORDER BY p.name
       LIMIT ? OFFSET ?`,
      [...searchParams, limit, offset]
    )) as ProductGroupRow[];

    const fobInfo = await resolveFobPriceList();
    const tnPreset = resolveTnFeePreset(String(req.query.tnFeePreset || ''));

    if (productRows.length === 0) {
      return res.json({
        config: buildConfigResponse(fobInfo, tnPreset),
        total,
        page,
        limit,
        rows: [],
      });
    }

    const productIds = productRows.map((p) => p.product_id);
    const placeholders = productIds.map(() => '?').join(',');

    const linkedVariantRows = (await query(
      `SELECT pv.id AS variant_id, p.id AS product_id, pv.sku,
              c.name AS color_name, s.size_code,
              p.mercado_libre_id, pv.mercado_libre_item_id, pv.mercado_libre_variant_id,
              p.tienda_nube_id, pv.tienda_nube_variant_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       JOIN colors c ON c.id = pc.color_id
       JOIN sizes s ON s.id = pv.size_id
       WHERE p.id IN (${placeholders}) ${channelWhere}
       ORDER BY p.id, s.size_code, c.name`,
      productIds
    )) as VariantRow[];

    const allVariantRows = (await query(
      `SELECT pv.id AS variant_id, p.id AS product_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE p.id IN (${placeholders})
       ORDER BY p.id, pv.sku`,
      productIds
    )) as { variant_id: string; product_id: string }[];

    const allVariantIdsByProduct = new Map<string, string[]>();
    for (const v of allVariantRows) {
      if (!allVariantIdsByProduct.has(v.product_id)) allVariantIdsByProduct.set(v.product_id, []);
      allVariantIdsByProduct.get(v.product_id)!.push(v.variant_id);
    }

    const pubLinks = await loadPublicationLinks(linkedVariantRows.map((v) => v.variant_id));

    const mlPaymentCptPercent = getMlPaymentCptPercent();

    const variantsByProduct = new Map<string, VariantRow[]>();
    for (const v of linkedVariantRows) {
      if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
      variantsByProduct.get(v.product_id)!.push(v);
    }

    const mlToken = await getValidMLToken();
    const feeCache = new Map<string, number>();
    const mlItemCache = new Map<string, Record<string, unknown>>();

    const prices: Record<
      string,
      { priceML?: number; priceTN?: number; mlItem?: Record<string, unknown> }
    > = {};

    const mlItemIds = new Map<string, { variantId: string; variationId: string | null }[]>();
    const tnProductIds = new Map<string, { variantId: string; tnVariantId: string }[]>();

    for (const v of linkedVariantRows) {
      prices[v.variant_id] = {};
      const links = resolveVariantLinks(v, pubLinks);
      if (links.mlItemId && mlToken?.access_token) {
        if (!mlItemIds.has(links.mlItemId)) mlItemIds.set(links.mlItemId, []);
        mlItemIds.get(links.mlItemId)!.push({
          variantId: v.variant_id,
          variationId: links.mlVariationId,
        });
      }
      if (links.tnProductId && links.tnVariantId) {
        if (!tnProductIds.has(links.tnProductId)) tnProductIds.set(links.tnProductId, []);
        tnProductIds.get(links.tnProductId)!.push({
          variantId: v.variant_id,
          tnVariantId: links.tnVariantId,
        });
      }
    }

    if (mlToken?.access_token) {
      const headers = { Authorization: `Bearer ${mlToken.access_token}` };
      for (const [itemId, vars] of mlItemIds) {
        try {
          const itemRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
            headers,
            validateStatus: () => true,
          });
          if (itemRes.status !== 200 || !itemRes.data) continue;
          const item = itemRes.data as Record<string, unknown>;
          mlItemCache.set(itemId, item);
          const variations = (item.variations as unknown[]) || [];
          for (const { variantId, variationId } of vars) {
            if (!prices[variantId]) continue;
            let priceML = 0;
            if (variations.length === 0) {
              priceML = Number(item.price ?? 0);
            } else if (variationId) {
              const vr = variations.find((x: any) => String(x.id) === String(variationId));
              priceML = Number((vr as any)?.price ?? item.price ?? 0);
            } else if (variations.length === 1) {
              priceML = Number((variations[0] as any)?.price ?? item.price ?? 0);
            } else {
              priceML = Number(item.price ?? 0);
            }
            prices[variantId].priceML = priceML;
            prices[variantId].mlItem = item;
          }
        } catch {
          /* ignore */
        }
      }
    }

    const tnIntegration = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
    if (tnIntegration?.access_token && tnIntegration?.store_id) {
      const tnHeaders = {
        Authentication: `bearer ${tnIntegration.access_token}`,
        'User-Agent': TN_USER_AGENT,
      };
      for (const [tnProductId, entries] of tnProductIds) {
        try {
          let tnVariants: any[] = [];
          let tnPage = 1;
          let hasMore = true;
          while (hasMore) {
            const varRes = await axios.get(
              `https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${tnProductId}/variants`,
              { headers: tnHeaders, params: { page: tnPage, per_page: 200 }, validateStatus: () => true }
            );
            const chunk = varRes.status === 200 && Array.isArray(varRes.data) ? varRes.data : [];
            tnVariants = tnVariants.concat(chunk);
            if (chunk.length < 200) hasMore = false;
            else tnPage++;
            if (tnPage > 50) hasMore = false;
          }
          for (const { variantId, tnVariantId } of entries) {
            const tv = tnVariants.find((x: any) => String(x.id) === String(tnVariantId));
            if (tv != null && prices[variantId]) {
              const raw = tv.price ?? tv.promotional_price;
              prices[variantId].priceTN = Number(raw) || 0;
            }
          }
        } catch {
          /* ignore */
        }
      }
    }

    const outRows: Array<{
      productId: string;
      productName: string;
      baseSku: string;
      variantCount: number;
      variantIds: string[];
      fob: number | null;
      ml: (ChannelMarginSlice & { linked: boolean }) | null;
      tn: (ChannelMarginSlice & { linked: boolean }) | null;
    }> = [];

    for (const pr of productRows) {
      const vars = variantsByProduct.get(pr.product_id) || [];
      const variantIds = allVariantIdsByProduct.get(pr.product_id) || vars.map((v) => v.variant_id);
      const totalVariants =
        allVariantIdsByProduct.get(pr.product_id)?.length ||
        Number(pr.variant_count) ||
        variantIds.length;
      const fobRaw = fobInfo.byProductId.get(pr.product_id);
      const fob = fobRaw != null && Number.isFinite(fobRaw) ? Number(fobRaw) : null;

      const repMl = vars.find((v) => resolveVariantLinks(v, pubLinks).hasMl);
      const repTn = vars.find((v) => {
        const links = resolveVariantLinks(v, pubLinks);
        if (!links.hasTn) return false;
        const p = prices[v.variant_id];
        return p?.priceTN != null && p.priceTN > 0;
      }) || vars.find((v) => resolveVariantLinks(v, pubLinks).hasTn);

      let mlSlice: (ChannelMarginSlice & { linked: boolean }) | null = null;
      if (repMl) {
        const p = prices[repMl.variant_id] || {};
        if (p.priceML != null && p.priceML > 0) {
          const mlItemId = resolveVariantLinks(repMl, pubLinks).mlItemId;
          const item =
            (mlItemId && mlItemCache.get(String(mlItemId))) || p.mlItem || ({} as Record<string, unknown>);
          let listingFee = 0;
          if (mlToken?.access_token) {
            listingFee = await fetchListingSaleFeeAmount(mlToken.access_token, item, p.priceML, feeCache);
          }
          const paymentCpt = calcMlPaymentCpt(p.priceML, mlPaymentCptPercent);
          const totalMlFee = Math.round((listingFee + paymentCpt) * 100) / 100;
          mlSlice = {
            ...buildChannelSlice(p.priceML, totalMlFee, fob),
            feeListing: listingFee,
            feePayment: paymentCpt,
            linked: true,
          };
        } else {
          mlSlice = { price: 0, fee: 0, margin: null, marginPercent: null, linked: true };
        }
      }

      let tnSlice: (ChannelMarginSlice & { linked: boolean }) | null = null;
      if (repTn) {
        const p = prices[repTn.variant_id] || {};
        if (p.priceTN != null && p.priceTN > 0) {
          const tnParts = calcTnSaleFeeFromPreset(p.priceTN, tnPreset);
          tnSlice = {
            ...buildChannelSlice(p.priceTN, tnParts.total, fob),
            feeRate: tnParts.ratePart,
            feeCpt: tnParts.cptPart,
            linked: true,
          };
        } else {
          tnSlice = { price: 0, fee: 0, margin: null, marginPercent: null, linked: true };
        }
      }

      outRows.push({
        productId: pr.product_id,
        productName: pr.product_name || '',
        baseSku: pr.base_sku || '',
        variantCount: totalVariants,
        variantIds,
        fob,
        ml: mlSlice,
        tn: tnSlice,
      });
    }

    res.json({
      config: buildConfigResponse(fobInfo, tnPreset),
      total,
      page,
      limit,
      rows: outRows,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[getChannelMargins]', msg);
    res.status(500).json({ message: 'Error calculando márgenes', detail: msg });
  }
};

function buildConfigResponse(
  fobInfo: { id: string | null; name: string },
  tnPreset: { id: string; label: string }
) {
  const ivaPercent = Math.round((getIvaMultiplier() - 1) * 10000) / 100;
  return {
    fobListId: fobInfo.id,
    fobListName: fobInfo.name || null,
    ivaPercent,
    tnFeePresetId: tnPreset.id,
    tnFeePresetLabel: tnPreset.label,
    tnFeePresets: listTnFeePresets(),
    mlListingFeeSource: 'API Mercado Libre listing_prices (comisión por vender)',
    mlPaymentCptPercent: getMlPaymentCptPercent(),
    mlPaymentCptSource: 'CPT cobro (Personalizado / transferencia, configurable con LUPOHUB_ML_PAYMENT_CPT_PERCENT)',
  };
}
