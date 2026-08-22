import { Request, Response } from 'express';
import axios from 'axios';
import ExcelJS from 'exceljs';
import { get, query } from '../database/db';
import { getValidMLToken, normalizeMercadoLibreItemId } from './integrations.controller';
import { calcFobYield, lookupFobPrice, resolveFobPriceList } from '../utils/channelMarginUtils';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';

type ChannelFilter = 'all' | 'tn' | 'ml' | 'mayorista' | 'tn_ml';

type AggRow = {
  codigo: string;
  nombre: string;
  qtyTn: number;
  qtyMl: number;
  qtyMay: number;
  revTn: number;
  revMl: number;
  revMay: number;
  ordersTn: number;
  ordersMl: number;
  ordersMay: number;
  stock: number;
  linkedTn: boolean;
  linkedMl: boolean;
  productId: string | null;
};

type HubVariant = {
  variant_id: string;
  sku_norm: string;
  mercado_libre_item_id: string | null;
  mercado_libre_variant_id: string | null;
  product_id: string;
  product_name: string;
  product_sku: string;
  ml_pack_default: number;
  pub_pack?: number | null;
};

function asYmd(raw: unknown): string {
  const s = String(raw || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function asIsoBounds(fromYmd: string, toYmd: string): { minIso: string; maxIso: string } {
  return {
    minIso: `${fromYmd}T00:00:00-03:00`,
    maxIso: `${toYmd}T23:59:59-03:00`
  };
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSkuForMatch(raw: unknown): string {
  return (raw ?? '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[\s\-\/]/g, '');
}

function extractArticlePrefixFromMlSku(sku: string): string | null {
  const s = String(sku || '').trim();
  if (!s) return null;
  const dashHead = s.split('-')[0];
  if (/^\d{4,7}$/.test(dashHead)) return dashHead;
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 11) return digits.slice(0, 5);
  if (digits.length >= 8) return digits.slice(0, 5);
  if (/^\d{4,7}$/.test(digits)) return digits;
  return null;
}

function parseChannelFilter(raw: unknown): ChannelFilter {
  const v = String(raw || 'all').trim().toLowerCase();
  if (v === 'tn' || v === 'ml' || v === 'mayorista' || v === 'tn_ml' || v === 'all') return v;
  return 'all';
}

function channelsForFilter(filter: ChannelFilter) {
  return {
    includeTn: filter === 'all' || filter === 'tn' || filter === 'tn_ml',
    includeMl: filter === 'all' || filter === 'ml' || filter === 'tn_ml',
    includeMay: filter === 'all' || filter === 'mayorista'
  };
}

function emptyAgg(partial: Partial<AggRow> & Pick<AggRow, 'codigo' | 'nombre'>): AggRow {
  return {
    qtyTn: 0,
    qtyMl: 0,
    qtyMay: 0,
    revTn: 0,
    revMl: 0,
    revMay: 0,
    ordersTn: 0,
    ordersMl: 0,
    ordersMay: 0,
    stock: 0,
    linkedTn: false,
    linkedMl: false,
    productId: null,
    ...partial
  };
}

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
    const byVar = listItem.find(
      (h) => h.mercado_libre_variant_id && String(h.mercado_libre_variant_id) === String(variationId)
    );
    if (byVar) return byVar;
  }

  const listProd = hubByMlProduct.get(itemIdNorm);
  if (listProd?.length === 1) return listProd[0];
  if (listProd && variationId) {
    const byVar = listProd.find(
      (h) => h.mercado_libre_variant_id && String(h.mercado_libre_variant_id) === String(variationId)
    );
    if (byVar) return byVar;
  }

  return null;
}

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

async function fetchTnPaidOrders(from: string, to: string): Promise<any[]> {
  const integration = await get(
    `SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`
  );
  if (!integration?.access_token) return [];
  const storeId = integration.store_id || integration.user_id;
  if (!storeId) return [];

  const { minIso, maxIso } = asIsoBounds(from, to);
  const perPage = 200;
  let page = 1;
  const rawOrders: any[] = [];
  while (page <= 400) {
    const response = await axios.get(`https://api.tiendanube.com/v1/${storeId}/orders`, {
      headers: {
        Authentication: `bearer ${integration.access_token}`,
        'User-Agent': TN_USER_AGENT
      },
      params: {
        page,
        per_page: perPage,
        created_at_min: minIso,
        created_at_max: maxIso
      },
      validateStatus: () => true
    });
    if (response.status !== 200) {
      throw new Error(
        response.data?.description ||
          response.data?.message ||
          response.data?.error ||
          `Error ${response.status} consultando órdenes de Tienda Nube`
      );
    }
    const batch = Array.isArray(response.data) ? response.data : [];
    if (batch.length === 0) break;
    rawOrders.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return rawOrders.filter((o) => String(o?.payment_status || '').toLowerCase() === 'paid');
}

async function fetchMlPaidOrders(from: string, to: string): Promise<any[]> {
  const mlToken = await getValidMLToken();
  if (!mlToken) return [];
  const orders: any[] = [];
  let offset = 0;
  const limit = 50;
  while (offset < 20000) {
    const res = await axios.get('https://api.mercadolibre.com/orders/search', {
      headers: { Authorization: `Bearer ${mlToken.access_token}` },
      params: {
        seller: mlToken.user_id,
        'order.status': 'paid',
        'order.date_created.from': `${from}T00:00:00.000-03:00`,
        'order.date_created.to': `${to}T23:59:59.999-03:00`,
        offset,
        limit,
        sort: 'date_desc'
      },
      validateStatus: () => true
    });
    if (res.status !== 200) {
      throw new Error(res.data?.message || `Error ${res.status} consultando órdenes de Mercado Libre`);
    }
    const batch = Array.isArray(res.data?.results) ? res.data.results : [];
    if (batch.length === 0) break;
    orders.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return orders;
}

/**
 * Reporte marketing: unidades vendidas por plataforma (TN / ML / Mayorista) + datos clave.
 * GET /integrations/marketing/top-products-export?from=YYYY-MM-DD&to=YYYY-MM-DD&channels=all|tn|ml|mayorista|tn_ml
 */
export const exportMarketingTopProductsXlsx = async (req: Request, res: Response) => {
  try {
    const from = asYmd(req.query.from || req.query.desde);
    const to = asYmd(req.query.to || req.query.hasta);
    if (!from || !to) {
      return res.status(400).json({ message: 'Parámetros requeridos: from y to en formato YYYY-MM-DD' });
    }
    if (from > to) {
      return res.status(400).json({ message: 'Rango inválido: from no puede ser mayor que to' });
    }

    const channelFilter = parseChannelFilter(req.query.channels || req.query.channel);
    const { includeTn, includeMl, includeMay } = channelsForFilter(channelFilter);

    const hubRows = (await query(`
      SELECT pv.id AS variant_id,
             TRIM(COALESCE(pv.external_sku, pv.sku)) AS sku_raw,
             pv.mercado_libre_item_id,
             pv.mercado_libre_variant_id,
             pv.tienda_nube_variant_id,
             p.id AS product_id,
             p.sku AS product_sku,
             p.name AS product_name,
             p.mercado_libre_id,
             p.tienda_nube_id,
             COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack_default,
             COALESCE((
               SELECT SUM(st.stock) FROM stocks st
               JOIN product_variants pv2 ON pv2.id = st.variant_id
               JOIN product_colors pc2 ON pc2.id = pv2.product_color_id
               WHERE pc2.product_id = p.id
             ), 0) AS stock_total
      FROM product_variants pv
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
    `)) as Array<{
      variant_id: string;
      sku_raw: string;
      mercado_libre_item_id: string | null;
      mercado_libre_variant_id: string | null;
      tienda_nube_variant_id: string | null;
      product_id: string;
      product_sku: string | null;
      product_name: string;
      mercado_libre_id: string | null;
      tienda_nube_id: string | null;
      ml_pack_default: string | number | null;
      stock_total: string | number | null;
    }>;

    const hubBySku = new Map<string, HubVariant>();
    const hubByMlItem = new Map<string, HubVariant[]>();
    const hubByMlProduct = new Map<string, HubVariant[]>();
    const hubByTnProduct = new Map<string, { product_id: string; product_sku: string; product_name: string; stock: number }>();
    const hubByTnVariant = new Map<string, { product_id: string; product_sku: string; product_name: string; stock: number }>();
    const variantById = new Map<string, HubVariant>();
    const productMeta = new Map<string, { codigo: string; nombre: string; stock: number; linkedTn: boolean; linkedMl: boolean }>();

    for (const r of hubRows) {
      const skuRaw = (r.sku_raw || '').toString();
      const productSku = ((r.product_sku || '') as string).trim() || r.product_id;
      const stock = Math.max(0, toNum(r.stock_total));
      const hv: HubVariant = {
        variant_id: r.variant_id,
        sku_norm: normalizeSkuForMatch(skuRaw),
        mercado_libre_item_id: r.mercado_libre_item_id,
        mercado_libre_variant_id: r.mercado_libre_variant_id,
        product_id: r.product_id,
        product_name: (r.product_name || '').toString(),
        product_sku: productSku,
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
      const tnPid = String(r.tienda_nube_id || '').trim();
      if (tnPid) {
        hubByTnProduct.set(tnPid, {
          product_id: r.product_id,
          product_sku: productSku,
          product_name: (r.product_name || '').toString(),
          stock
        });
      }
      const tnVid = String(r.tienda_nube_variant_id || '').trim();
      if (tnVid) {
        hubByTnVariant.set(tnVid, {
          product_id: r.product_id,
          product_sku: productSku,
          product_name: (r.product_name || '').toString(),
          stock
        });
      }
      if (!productMeta.has(r.product_id)) {
        productMeta.set(r.product_id, {
          codigo: productSku,
          nombre: (r.product_name || '').toString(),
          stock,
          linkedTn: !!tnPid,
          linkedMl: !!(r.mercado_libre_id || r.mercado_libre_item_id)
        });
      } else {
        const meta = productMeta.get(r.product_id)!;
        if (tnPid) meta.linkedTn = true;
        if (r.mercado_libre_id || r.mercado_libre_item_id) meta.linkedMl = true;
      }
    }

    const pubRows = (await query(
      `SELECT variant_id, external_product_id, external_variant_id, pack_size, platform
       FROM variant_publications WHERE platform IN ('mercadolibre', 'tiendanube')`
    )) as Array<{
      variant_id: string;
      external_product_id: string;
      external_variant_id: string | null;
      pack_size: string | number | null;
      platform: string;
    }>;

    const pubMap = new Map<string, HubVariant>();
    for (const pr of pubRows) {
      if (pr.platform !== 'mercadolibre') {
        if (pr.platform === 'tiendanube') {
          const base = variantById.get(pr.variant_id);
          if (!base) continue;
          const ep = String(pr.external_product_id || '').trim();
          const ev = String(pr.external_variant_id || '').trim();
          const meta = productMeta.get(base.product_id);
          if (ep && !hubByTnProduct.has(ep) && meta) {
            hubByTnProduct.set(ep, {
              product_id: base.product_id,
              product_sku: base.product_sku,
              product_name: base.product_name,
              stock: meta.stock
            });
          }
          if (ev && meta) {
            hubByTnVariant.set(ev, {
              product_id: base.product_id,
              product_sku: base.product_sku,
              product_name: base.product_name,
              stock: meta.stock
            });
          }
          if (meta) meta.linkedTn = true;
        }
        continue;
      }
      const base = variantById.get(pr.variant_id);
      if (!base) continue;
      const extVar =
        pr.external_variant_id != null && String(pr.external_variant_id).trim() !== ''
          ? String(pr.external_variant_id).trim()
          : '';
      const ep = normalizeMercadoLibreItemId(pr.external_product_id);
      if (!ep) continue;
      pubMap.set(`${ep}|${extVar}`, {
        ...base,
        pub_pack: pr.pack_size != null ? Math.max(1, Number(pr.pack_size) || 1) : null
      });
    }

    const aggByKey = new Map<string, AggRow>();

    const upsert = (key: string, patch: Partial<AggRow> & Pick<AggRow, 'codigo' | 'nombre'>) => {
      const prev = aggByKey.get(key) || emptyAgg(patch);
      if (patch.nombre && (!prev.nombre || prev.nombre === prev.codigo)) prev.nombre = patch.nombre;
      if (patch.codigo && prev.codigo.startsWith('TN-') && !patch.codigo.startsWith('TN-')) prev.codigo = patch.codigo;
      if (patch.productId) prev.productId = patch.productId;
      if (patch.stock != null && patch.stock > prev.stock) prev.stock = patch.stock;
      if (patch.linkedTn) prev.linkedTn = true;
      if (patch.linkedMl) prev.linkedMl = true;
      if (patch.qtyTn) prev.qtyTn += patch.qtyTn;
      if (patch.qtyMl) prev.qtyMl += patch.qtyMl;
      if (patch.qtyMay) prev.qtyMay += patch.qtyMay;
      if (patch.revTn) prev.revTn += patch.revTn;
      if (patch.revMl) prev.revMl += patch.revMl;
      if (patch.revMay) prev.revMay += patch.revMay;
      if (patch.ordersTn) prev.ordersTn += patch.ordersTn;
      if (patch.ordersMl) prev.ordersMl += patch.ordersMl;
      if (patch.ordersMay) prev.ordersMay += patch.ordersMay;
      aggByKey.set(key, prev);
    };

    let tnOrdersCount = 0;
    let mlOrdersCount = 0;
    let mayOrdersCount = 0;

    if (includeTn) {
      const tnOrders = await fetchTnPaidOrders(from, to);
      tnOrdersCount = tnOrders.length;
      for (const order of tnOrders) {
        const seen = new Set<string>();
        const lines = Array.isArray(order?.products) ? order.products : [];
        for (const p of lines) {
          const productId = String(p?.product_id ?? p?.id ?? '').trim();
          const variantId = String(p?.variant_id ?? '').trim();
          const sku = String(p?.sku ?? p?.variant_sku ?? '').trim();
          const name = String(p?.name ?? p?.product_name ?? p?.title ?? '').trim() || 'Producto';
          const quantity = Math.max(0, toNum(p?.quantity ?? p?.qty ?? 0));
          const unitPrice = toNum(p?.price ?? p?.price_per_unit ?? p?.promotional_price ?? 0);
          if (quantity <= 0) continue;

          const hub =
            (variantId && hubByTnVariant.get(variantId)) ||
            (productId && hubByTnProduct.get(productId)) ||
            (sku ? (() => {
              const hv = hubBySku.get(normalizeSkuForMatch(sku));
              if (!hv) return null;
              const meta = productMeta.get(hv.product_id);
              return {
                product_id: hv.product_id,
                product_sku: hv.product_sku,
                product_name: hv.product_name,
                stock: meta?.stock || 0
              };
            })() : null);

          const codigo = hub?.product_sku || sku || productId || name;
          const nombre = hub?.product_name || name;
          const key = (hub?.product_id || `tn:${codigo}`).toLowerCase();
          const orderKey = `${order?.id || ''}|${key}`;
          const isNewOrder = !seen.has(orderKey);
          if (isNewOrder) seen.add(orderKey);

          upsert(key, {
            codigo,
            nombre,
            productId: hub?.product_id || null,
            stock: hub?.stock || 0,
            linkedTn: !!hub,
            qtyTn: quantity,
            revTn: unitPrice * quantity,
            ordersTn: isNewOrder ? 1 : 0
          });
        }
      }
    }

    if (includeMl) {
      const mlOrders = await fetchMlPaidOrders(from, to);
      mlOrdersCount = mlOrders.length;
      for (const order of mlOrders) {
        const orderId = String(order?.id ?? '');
        const seen = new Set<string>();
        for (const line of order.order_items || []) {
          const itemIdNorm = normalizeMercadoLibreItemId(line?.item?.id);
          const rawVid = line?.item?.variation_id;
          const variationId =
            rawVid != null && String(rawVid).trim() !== '' ? String(rawVid).trim() : null;
          const skuMl = String(
            line?.item?.seller_sku || line?.item?.seller_custom_field || line?.item?.sku || ''
          ).trim();
          const skuMlNorm = normalizeSkuForMatch(skuMl);
          const title = String(line?.item?.title || '').trim();
          const qtyMl = Math.max(0, toNum(line?.quantity));
          const unitPrice = toNum(line?.unit_price);
          if (qtyMl <= 0) continue;

          const hub = itemIdNorm
            ? resolveHubVariantFull(
                itemIdNorm,
                variationId,
                skuMlNorm,
                hubBySku,
                hubByMlItem,
                hubByMlProduct,
                pubMap
              )
            : skuMlNorm
              ? hubBySku.get(skuMlNorm) || null
              : null;

          let codigo: string;
          let nombre: string;
          let pack = 1;
          let productId: string | null = null;
          let stock = 0;

          if (hub) {
            const meta = productMeta.get(hub.product_id);
            codigo = meta?.codigo || hub.product_sku;
            nombre = meta?.nombre || hub.product_name;
            pack = Math.max(1, Number(hub.pub_pack ?? hub.ml_pack_default) || 1);
            productId = hub.product_id;
            stock = meta?.stock || 0;
          } else {
            codigo =
              extractArticlePrefixFromMlSku(skuMl) ||
              skuMl ||
              (itemIdNorm ? `ML-${itemIdNorm}` : title || 'Sin identificar');
            nombre = title || skuMl || codigo;
          }

          const units = qtyMl * pack;
          const key = (productId || `ml:${codigo}`).toLowerCase();
          const orderLineKey = `${orderId}|${key}`;
          const isNewOrder = !seen.has(orderLineKey);
          if (isNewOrder) seen.add(orderLineKey);

          upsert(key, {
            codigo,
            nombre,
            productId,
            stock,
            linkedMl: !!hub,
            qtyMl: units,
            revMl: unitPrice * qtyMl,
            ordersMl: isNewOrder ? 1 : 0
          });
        }
      }
    }

    if (includeMay) {
      const mayRows = (await query(
        `
        SELECT
          p.id AS product_id,
          p.sku AS product_code,
          p.name AS product_name,
          SUM(oi.quantity) AS units_ordered,
          COUNT(DISTINCT o.id) AS orders_count,
          ROUND(SUM(oi.quantity * oi.price_at_moment), 2) AS subtotal,
          COALESCE((
            SELECT SUM(st.stock) FROM stocks st
            JOIN product_variants pv2 ON pv2.id = st.variant_id
            JOIN product_colors pc2 ON pc2.id = pv2.product_color_id
            WHERE pc2.product_id = p.id
          ), 0) AS stock_total
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN product_variants pv ON pv.id = oi.variant_id
        JOIN product_colors pc ON pc.id = pv.product_color_id
        JOIN products p ON p.id = pc.product_id
        WHERE o.status NOT IN ('Cancelado', 'Borrador')
          AND o.date >= ?
          AND o.date <= ?
        GROUP BY p.id, p.sku, p.name
        `,
        [from, to]
      )) as Array<{
        product_id: string;
        product_code: string;
        product_name: string;
        units_ordered: number;
        orders_count: number;
        subtotal: number;
        stock_total: number;
      }>;

      mayOrdersCount = mayRows.reduce((acc, r) => acc + Number(r.orders_count || 0), 0);
      for (const r of mayRows) {
        const meta = productMeta.get(r.product_id);
        const key = r.product_id.toLowerCase();
        upsert(key, {
          codigo: (r.product_code || '').trim() || r.product_id,
          nombre: r.product_name || meta?.nombre || r.product_id,
          productId: r.product_id,
          stock: Math.max(0, toNum(r.stock_total) || meta?.stock || 0),
          linkedTn: meta?.linkedTn || false,
          linkedMl: meta?.linkedMl || false,
          qtyMay: Number(r.units_ordered || 0),
          revMay: Number(r.subtotal || 0),
          ordersMay: Number(r.orders_count || 0)
        });
      }
    }

    // Completar stock / links de productos hub que ya están en el mapa
    for (const row of aggByKey.values()) {
      if (!row.productId) continue;
      const meta = productMeta.get(row.productId);
      if (!meta) continue;
      row.stock = meta.stock;
      row.linkedTn = row.linkedTn || meta.linkedTn;
      row.linkedMl = row.linkedMl || meta.linkedMl;
      if (!row.codigo || row.codigo.startsWith('TN-') || row.codigo.startsWith('ML-')) {
        row.codigo = meta.codigo;
      }
      if (meta.nombre) row.nombre = meta.nombre;
    }

    const fobInfo = await resolveFobPriceList();

    const rows = Array.from(aggByKey.values())
      .map((r) => {
        const qtyTotal = r.qtyTn + r.qtyMl + r.qtyMay;
        const revTotal = r.revTn + r.revMl + r.revMay;
        const fob = lookupFobPrice(fobInfo, r.productId, r.codigo);
        const yieldMetrics = calcFobYield(revTotal, qtyTotal, fob);
        return { ...r, qtyTotal, revTotal, ...yieldMetrics };
      })
      .filter((r) => r.qtyTotal > 0)
      .sort((a, b) => b.qtyTotal - a.qtyTotal || b.revTotal - a.revTotal);

    const withFob = rows.filter((r) => r.costFob != null);
    const missingFob = rows.filter((r) => r.fob == null);
    const totalCostFob = withFob.reduce((a, r) => a + (r.costFob || 0), 0);
    const totalProfit = withFob.reduce((a, r) => a + (r.profit || 0), 0);
    const totalRevWithFob = withFob.reduce((a, r) => a + r.revTotal, 0);
    const totalYieldOnCost = totalCostFob > 0 ? Math.round((totalProfit / totalCostFob) * 10000) / 100 : null;
    const totalYieldOnSale = totalRevWithFob > 0 ? Math.round((totalProfit / totalRevWithFob) * 10000) / 100 : null;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'LupoHub';
    wb.created = new Date();

    const channelLabel: Record<ChannelFilter, string> = {
      all: 'Todos (TN + ML + Mayorista)',
      tn: 'Tienda Nube',
      ml: 'Mercado Libre',
      mayorista: 'Mayorista',
      tn_ml: 'TN + Mercado Libre'
    };

    const wsResumen = wb.addWorksheet('Resumen');
    wsResumen.columns = [{ width: 42 }, { width: 72 }];
    wsResumen.addRow(['Más vendidos — unidades por plataforma', '']);
    wsResumen.mergeCells(1, 1, 1, 2);
    wsResumen.addRow(['Período desde', from]);
    wsResumen.addRow(['Período hasta', to]);
    wsResumen.addRow(['Canales incluidos', channelLabel[channelFilter]]);
    wsResumen.addRow(['Órdenes TN (pagadas)', tnOrdersCount]);
    wsResumen.addRow(['Órdenes ML (pagadas)', mlOrdersCount]);
    wsResumen.addRow(['Pedidos mayorista (líneas agrupadas)', mayOrdersCount]);
    wsResumen.addRow(['Artículos en reporte', rows.length]);
    wsResumen.addRow(['Unidades TN', rows.reduce((a, r) => a + r.qtyTn, 0)]);
    wsResumen.addRow(['Unidades ML', rows.reduce((a, r) => a + r.qtyMl, 0)]);
    wsResumen.addRow(['Unidades Mayorista', rows.reduce((a, r) => a + r.qtyMay, 0)]);
    wsResumen.addRow(['Unidades totales', rows.reduce((a, r) => a + r.qtyTotal, 0)]);
    wsResumen.addRow(['Ingresos totales (aprox)', rows.reduce((a, r) => a + r.revTotal, 0)]);
    wsResumen.addRow(['Lista FOB', fobInfo.name || 'Sin lista FOB']);
    wsResumen.addRow(['Artículos con FOB', withFob.length]);
    wsResumen.addRow(['Artículos sin FOB', missingFob.length]);
    wsResumen.addRow(['Costo FOB (artículos con precio)', totalCostFob]);
    wsResumen.addRow(['Ganancia (ingresos − FOB × uds)', totalProfit]);
    wsResumen.addRow(['Rendimiento sobre costo FOB %', totalYieldOnCost]);
    wsResumen.addRow(['Margen sobre venta %', totalYieldOnSale]);
    wsResumen.addRow([
      'Nota rendimiento',
      'Ganancia = ingresos brutos − FOB × unidades. En ML/TN no se descuentan comisiones de plataforma.'
    ]);
    wsResumen.getCell('A1').font = { bold: true, size: 13 };
    for (let r = 2; r <= 21; r++) wsResumen.getCell(`A${r}`).font = { bold: true };
    for (const cell of ['B9', 'B10', 'B11', 'B12', 'B15', 'B16']) wsResumen.getCell(cell).numFmt = '#,##0';
    wsResumen.getCell('B13').numFmt = '#,##0.00';
    wsResumen.getCell('B17').numFmt = '#,##0.00';
    wsResumen.getCell('B18').numFmt = '#,##0.00';
    wsResumen.getCell('B19').numFmt = '0.00"%"';
    wsResumen.getCell('B20').numFmt = '0.00"%"';

    const ws = wb.addWorksheet('Más vendidos');
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const fobHeader = fobInfo.name ? `FOB (${fobInfo.name})` : 'FOB';
    ws.columns = [
      { header: 'Ranking', key: 'rank', width: 10 },
      { header: 'Código', key: 'codigo', width: 16 },
      { header: 'Artículo', key: 'nombre', width: 42 },
      { header: 'Uds TN', key: 'qtyTn', width: 12 },
      { header: 'Uds ML', key: 'qtyMl', width: 12 },
      { header: 'Uds Mayorista', key: 'qtyMay', width: 14 },
      { header: 'Uds Total', key: 'qtyTotal', width: 12 },
      { header: 'Ingresos TN', key: 'revTn', width: 14 },
      { header: 'Ingresos ML', key: 'revMl', width: 14 },
      { header: 'Ingresos Mayorista', key: 'revMay', width: 16 },
      { header: 'Ingresos Total', key: 'revTotal', width: 14 },
      { header: fobHeader, key: 'fob', width: 16 },
      { header: 'Precio prom.', key: 'avgPrice', width: 14 },
      { header: 'Costo FOB', key: 'costFob', width: 14 },
      { header: 'Ganancia', key: 'profit', width: 14 },
      { header: 'Rendimiento % (sobre costo)', key: 'yieldOnCost', width: 22 },
      { header: 'Margen % (sobre venta)', key: 'yieldOnSale', width: 20 },
      { header: 'Órdenes TN', key: 'ordersTn', width: 12 },
      { header: 'Órdenes ML', key: 'ordersMl', width: 12 },
      { header: 'Pedidos May.', key: 'ordersMay', width: 12 },
      { header: 'Stock LupoHub', key: 'stock', width: 14 },
      { header: 'Vinculado TN', key: 'linkedTn', width: 12 },
      { header: 'Vinculado ML', key: 'linkedMl', width: 12 }
    ];
    ws.getRow(1).font = { bold: true };

    rows.forEach((r, idx) => {
      ws.addRow({
        rank: idx + 1,
        codigo: r.codigo,
        nombre: r.nombre,
        qtyTn: r.qtyTn,
        qtyMl: r.qtyMl,
        qtyMay: r.qtyMay,
        qtyTotal: r.qtyTotal,
        revTn: r.revTn,
        revMl: r.revMl,
        revMay: r.revMay,
        revTotal: r.revTotal,
        fob: r.fob,
        avgPrice: r.avgPrice,
        costFob: r.costFob,
        profit: r.profit,
        yieldOnCost: r.yieldOnCost,
        yieldOnSale: r.yieldOnSale,
        ordersTn: r.ordersTn,
        ordersMl: r.ordersMl,
        ordersMay: r.ordersMay,
        stock: r.stock,
        linkedTn: r.linkedTn ? 'Sí' : 'No',
        linkedMl: r.linkedMl ? 'Sí' : 'No'
      });
    });

    for (let i = 2; i <= ws.rowCount; i++) {
      for (const col of ['D', 'E', 'F', 'G', 'R', 'S', 'T', 'U']) {
        ws.getCell(`${col}${i}`).numFmt = '#,##0';
      }
      for (const col of ['H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']) {
        ws.getCell(`${col}${i}`).numFmt = '#,##0.00';
      }
      for (const col of ['P', 'Q']) {
        ws.getCell(`${col}${i}`).numFmt = '0.00"%"';
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    const filename = `mas_vendidos_por_plataforma_${from}_a_${to}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (error: any) {
    console.error('exportMarketingTopProductsXlsx:', error);
    res.status(500).json({
      message: 'Error generando reporte de más vendidos',
      error: error?.message || String(error)
    });
  }
};
