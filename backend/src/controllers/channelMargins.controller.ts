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

function variantChannelWhere(channel: string): string {
  if (channel === 'ml') {
    return `AND (pv.mercado_libre_item_id IS NOT NULL OR p.mercado_libre_id IS NOT NULL OR pv.mercado_libre_variant_id IS NOT NULL)`;
  }
  if (channel === 'tn') {
    return `AND p.tienda_nube_id IS NOT NULL AND pv.tienda_nube_variant_id IS NOT NULL`;
  }
  return `AND (
    pv.mercado_libre_item_id IS NOT NULL OR p.mercado_libre_id IS NOT NULL OR pv.mercado_libre_variant_id IS NOT NULL
    OR (p.tienda_nube_id IS NOT NULL AND pv.tienda_nube_variant_id IS NOT NULL)
  )`;
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
              COUNT(pv.id) AS variant_count
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

    const variantRows = (await query(
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

    const mlPaymentCptPercent = getMlPaymentCptPercent();

    const variantsByProduct = new Map<string, VariantRow[]>();
    for (const v of variantRows) {
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
    const tnProductIds = new Map<string, { variantId: string; tnVariantId: string }>();

    for (const v of variantRows) {
      prices[v.variant_id] = {};
      const mlItemId = v.mercado_libre_item_id || v.mercado_libre_id;
      if (mlItemId && mlToken?.access_token) {
        const variationId = v.mercado_libre_variant_id ? String(v.mercado_libre_variant_id) : null;
        if (!mlItemIds.has(mlItemId)) mlItemIds.set(mlItemId, []);
        mlItemIds.get(mlItemId)!.push({ variantId: v.variant_id, variationId });
      }
      if (v.tienda_nube_id && v.tienda_nube_variant_id && !tnProductIds.has(v.product_id)) {
        tnProductIds.set(v.product_id, {
          variantId: v.variant_id,
          tnVariantId: String(v.tienda_nube_variant_id),
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
      for (const [tnProductId, { variantId, tnVariantId }] of tnProductIds) {
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
          const tv = tnVariants.find((v: any) => String(v.id) === String(tnVariantId));
          if (tv != null && prices[variantId]) {
            prices[variantId].priceTN = Number(tv.price ?? tv.promotional_price) || 0;
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
      const variantIds = vars.map((v) => v.variant_id);
      const fobRaw = fobInfo.byProductId.get(pr.product_id);
      const fob = fobRaw != null && Number.isFinite(fobRaw) ? Number(fobRaw) : null;

      const repMl = vars.find(
        (v) => v.mercado_libre_item_id || v.mercado_libre_id || v.mercado_libre_variant_id
      );
      const repTn = vars.find((v) => v.tienda_nube_id && v.tienda_nube_variant_id);

      let mlSlice: (ChannelMarginSlice & { linked: boolean }) | null = null;
      if (repMl) {
        const p = prices[repMl.variant_id] || {};
        if (p.priceML != null && p.priceML > 0) {
          const mlItemId = repMl.mercado_libre_item_id || repMl.mercado_libre_id;
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
        variantCount: Number(pr.variant_count) || variantIds.length,
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
