/**
 * Márgenes por canal: precio de venta − comisión ML/TN − costo FOB.
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
  product_name: string;
  color_name: string | null;
  size_code: string | null;
  mercado_libre_id: string | null;
  mercado_libre_item_id: string | null;
  mercado_libre_variant_id: string | null;
  tienda_nube_id: string | null;
  tienda_nube_variant_id: string | null;
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

/** GET /integrations/channel-margins?search=&page=1&limit=50&channel=all|ml|tn */
export const getChannelMargins = async (req: Request, res: Response) => {
  try {
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || '50'), 10) || 50));
    const channel = String(req.query.channel || 'all').toLowerCase();
    const offset = (page - 1) * limit;

    const channelWhere =
      channel === 'ml'
        ? `AND (pv.mercado_libre_item_id IS NOT NULL OR p.mercado_libre_id IS NOT NULL OR pv.mercado_libre_variant_id IS NOT NULL)`
        : channel === 'tn'
          ? `AND p.tienda_nube_id IS NOT NULL AND pv.tienda_nube_variant_id IS NOT NULL`
          : `AND (
              pv.mercado_libre_item_id IS NOT NULL OR p.mercado_libre_id IS NOT NULL OR pv.mercado_libre_variant_id IS NOT NULL
              OR (p.tienda_nube_id IS NOT NULL AND pv.tienda_nube_variant_id IS NOT NULL)
            )`;

    const searchWhere = search
      ? `AND (pv.sku LIKE ? OR p.name LIKE ? OR p.sku LIKE ? OR c.name LIKE ?)`
      : '';
    const searchParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`] : [];

    const countRow = (await get(
      `SELECT COUNT(*) AS total
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       JOIN colors c ON c.id = pc.color_id
       JOIN sizes s ON s.id = pv.size_id
       WHERE 1=1 ${channelWhere} ${searchWhere}`,
      searchParams
    )) as { total: number } | undefined;

    const total = Number(countRow?.total ?? 0);

    const rows = (await query(
      `SELECT pv.id AS variant_id, p.id AS product_id, pv.sku,
              p.name AS product_name, c.name AS color_name, s.size_code,
              p.mercado_libre_id, pv.mercado_libre_item_id, pv.mercado_libre_variant_id,
              p.tienda_nube_id, pv.tienda_nube_variant_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       JOIN colors c ON c.id = pc.color_id
       JOIN sizes s ON s.id = pv.size_id
       WHERE 1=1 ${channelWhere} ${searchWhere}
       ORDER BY p.name, pv.sku
       LIMIT ? OFFSET ?`,
      [...searchParams, limit, offset]
    )) as VariantRow[];

    const fobInfo = await resolveFobPriceList();
    const tnPreset = resolveTnFeePreset(String(req.query.tnFeePreset || ''));
    const mlPaymentCptPercent = getMlPaymentCptPercent();
    const ivaPercent = Math.round((getIvaMultiplier() - 1) * 10000) / 100;

    const mlToken = await getValidMLToken();
    const feeCache = new Map<string, number>();
    const mlItemCache = new Map<string, Record<string, unknown>>();

    const mlItemIds = new Map<
      string,
      { variantId: string; variationId: string | null; price?: number }[]
    >();
    const tnProductIds = new Map<string, string[]>();
    const variantToTnVariant = new Map<string, string>();

    const prices: Record<
      string,
      { priceML?: number; priceTN?: number; mlItem?: Record<string, unknown> }
    > = {};

    for (const r of rows) {
      prices[r.variant_id] = {};
      const mlItemId = r.mercado_libre_item_id || r.mercado_libre_id;
      if (mlItemId && mlToken?.access_token) {
        const variationId = r.mercado_libre_variant_id ? String(r.mercado_libre_variant_id) : null;
        if (!mlItemIds.has(mlItemId)) mlItemIds.set(mlItemId, []);
        mlItemIds.get(mlItemId)!.push({ variantId: r.variant_id, variationId });
      }
      if (r.tienda_nube_id && r.tienda_nube_variant_id) {
        if (!tnProductIds.has(r.tienda_nube_id)) tnProductIds.set(r.tienda_nube_id, []);
        tnProductIds.get(r.tienda_nube_id)!.push(r.variant_id);
        variantToTnVariant.set(r.variant_id, String(r.tienda_nube_variant_id));
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
              const v = variations.find((x: any) => String(x.id) === String(variationId));
              priceML = Number((v as any)?.price ?? item.price ?? 0);
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
      for (const [productId, vIds] of tnProductIds) {
        try {
          let tnVariants: any[] = [];
          let tnPage = 1;
          let hasMore = true;
          while (hasMore) {
            const varRes = await axios.get(
              `https://api.tiendanube.com/v1/${tnIntegration.store_id}/products/${productId}/variants`,
              { headers: tnHeaders, params: { page: tnPage, per_page: 200 }, validateStatus: () => true }
            );
            const chunk = varRes.status === 200 && Array.isArray(varRes.data) ? varRes.data : [];
            tnVariants = tnVariants.concat(chunk);
            if (chunk.length < 200) hasMore = false;
            else tnPage++;
            if (tnPage > 50) hasMore = false;
          }
          for (const variantId of vIds) {
            const tnVid = variantToTnVariant.get(variantId);
            const tv = tnVariants.find((v: any) => String(v.id) === String(tnVid));
            if (tv != null && prices[variantId]) {
              prices[variantId].priceTN = Number(tv.price ?? tv.promotional_price) || 0;
            }
          }
        } catch {
          /* ignore */
        }
      }
    }

    const outRows: Array<{
      variantId: string;
      sku: string;
      productId: string;
      productName: string;
      color: string;
      size: string;
      fob: number | null;
      ml: (ChannelMarginSlice & { linked: boolean }) | null;
      tn: (ChannelMarginSlice & { linked: boolean }) | null;
    }> = [];

    for (const r of rows) {
      const fobRaw = fobInfo.byProductId.get(r.product_id);
      const fob = fobRaw != null && Number.isFinite(fobRaw) ? Number(fobRaw) : null;
      const p = prices[r.variant_id] || {};

      let mlSlice: (ChannelMarginSlice & { linked: boolean }) | null = null;
      const hasMl = !!(r.mercado_libre_item_id || r.mercado_libre_id || r.mercado_libre_variant_id);
      if (hasMl && p.priceML != null && p.priceML > 0) {
        const mlItemId = r.mercado_libre_item_id || r.mercado_libre_id;
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
      } else if (hasMl) {
        mlSlice = { price: 0, fee: 0, margin: null, marginPercent: null, linked: true };
      }

      let tnSlice: (ChannelMarginSlice & { linked: boolean }) | null = null;
      const hasTn = !!(r.tienda_nube_id && r.tienda_nube_variant_id);
      if (hasTn && p.priceTN != null && p.priceTN > 0) {
        const tnParts = calcTnSaleFeeFromPreset(p.priceTN, tnPreset);
        tnSlice = {
          ...buildChannelSlice(p.priceTN, tnParts.total, fob),
          feeRate: tnParts.ratePart,
          feeCpt: tnParts.cptPart,
          linked: true,
        };
      } else if (hasTn) {
        tnSlice = { price: 0, fee: 0, margin: null, marginPercent: null, linked: true };
      }

      outRows.push({
        variantId: r.variant_id,
        sku: r.sku || '',
        productId: r.product_id,
        productName: r.product_name || '',
        color: r.color_name || '',
        size: r.size_code || '',
        fob,
        ml: mlSlice,
        tn: tnSlice,
      });
    }

    res.json({
      config: {
        fobListId: fobInfo.id,
        fobListName: fobInfo.name || null,
        ivaPercent,
        tnFeePresetId: tnPreset.id,
        tnFeePresetLabel: tnPreset.label,
        tnFeePresets: listTnFeePresets(),
        mlListingFeeSource: 'API Mercado Libre listing_prices (comisión por vender)',
        mlPaymentCptPercent,
        mlPaymentCptSource: 'CPT cobro (Personalizado / transferencia, configurable con LUPOHUB_ML_PAYMENT_CPT_PERCENT)',
      },
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
