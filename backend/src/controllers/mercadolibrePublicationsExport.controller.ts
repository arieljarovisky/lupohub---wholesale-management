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
  variant_ids: Set<string>;
  ml_item_ids: Set<string>;
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

export const exportMercadolibrePublicationsXlsx = async (_req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const toYmd = (d: Date) => d.toISOString().slice(0, 10);
    const dateTo = new Date();
    const dateFrom = new Date(dateTo);
    dateFrom.setDate(dateFrom.getDate() - ADS_LOOKBACK_DAYS);
    const dateFromStr = toYmd(dateFrom);
    const dateToStr = toYmd(dateTo);

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

    const productMeta = new Map<string, { codigo: string; nombre: string; base_price: number; mayorista_pack: number }>();
    for (const r of hubRows) {
      if (productMeta.has(r.product_id)) continue;
      const codigo = ((r.product_sku || '') as string).trim() || r.product_id;
      productMeta.set(r.product_id, {
        codigo,
        nombre: (r.product_name || '').toString(),
        base_price: Number(r.base_price ?? 0),
        mayorista_pack: Math.max(1, Number(r.mayorista_pack_size) || 1)
      });
    }

    const costByItemId = await fetchActiveCampaignProductAdsCostByItem(
      mlToken.access_token,
      dateFromStr,
      dateToStr
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
          variant_ids: new Set(),
          ml_item_ids: new Set()
        };
        buckets.set(key, b);
      }
      return b;
    }

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
        const title = (item.title || '').toString();

        const bump = (variationId: string | null, skuMl: string, price: number) => {
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
            const codigo = meta?.codigo ?? hub.product_id;
            const nombre = meta?.nombre ?? hub.product_name;
            const bp = meta?.base_price ?? hub.base_price;
            const pk = meta?.mayorista_pack ?? hub.mayorista_pack_size;
            const key = `p:${hub.product_id}`;
            const b = ensureBucket(key, {
              codigo,
              nombre,
              base_price: bp,
              mayorista_pack: pk
            });
            b.ml_prices.push(price);
            b.variant_ids.add(hub.variant_id);
            b.ml_item_ids.add(itemIdNorm);
          } else {
            const key = `u:${itemIdNorm}`;
            const b = ensureBucket(key, {
              codigo: itemIdNorm,
              nombre: title,
              base_price: 0,
              mayorista_pack: 1
            });
            b.ml_prices.push(price);
            b.ml_item_ids.add(itemIdNorm);
          }
        };

        if (item.variations && item.variations.length > 0) {
          for (const v of item.variations) {
            const skuMl = mlSkuFromVariation(v);
            const price = Number(v.price ?? item.price ?? 0) || 0;
            bump(String(v.id), skuMl, price);
          }
        } else {
          const skuMl = mlSkuFromItem(item);
          const price = Number(item.price ?? 0) || 0;
          bump(null, skuMl, price);
        }
      }
    }

    const rowsOut: Array<{
      codigo: string;
      fob: number | null;
      mayorista_lista: number;
      precio_ml_prom: number;
      inversion: number;
      ganancia: number | null;
    }> = [];

    for (const [key, agg] of buckets) {
      if (agg.ml_prices.length === 0) continue;
      const precioMlProm = agg.ml_prices.reduce((a, p) => a + p, 0) / agg.ml_prices.length;
      let fobCost: number | null = null;
      let precioUnidadMayor = 0;
      if (key.startsWith('p:')) {
        const pid = key.slice(2);
        fobCost = fobByProductId.has(pid) ? fobByProductId.get(pid)! : null;
        precioUnidadMayor = agg.base_price / Math.max(1, agg.mayorista_pack);
      } else {
        fobCost = null;
        precioUnidadMayor = 0;
      }
      let inversion = 0;
      for (const iid of agg.ml_item_ids) {
        inversion += costByItemId.get(normalizeMercadoLibreItemId(iid)) || 0;
      }
      const ganancia = precioMlProm - precioUnidadMayor - inversion;

      rowsOut.push({
        codigo: agg.codigo,
        fob: fobCost,
        mayorista_lista: agg.base_price,
        precio_ml_prom: precioMlProm,
        inversion,
        ganancia: Number.isFinite(ganancia) ? Math.round(ganancia * 100) / 100 : null
      });
    }

    rowsOut.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es'));

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
      fobHeader,
      'Precio mayorista (ARS, lista)',
      'Precio Mercado Libre (ARS, prom.)',
      `Inversión campaña activa (ARS, Product Ads ${dateFromStr}–${dateToStr})`,
      'Ganancia (ARS)'
    ]);
    const noteText =
      `Todas las publicaciones ML del vendedor (hasta ${ML_SYNC_MAX_ITEMS}). Match inventario: vínculos ML + SKU. FOB: precio de la lista ` +
      (fobListName ? `"${fobListName}"` : 'cuyo nombre contiene "fob"') +
      (fobListIdEnv ? ' (forzada por LUPOHUB_FOB_PRICE_LIST_ID).' : '.') +
      ' Ganancia: precio ML − precio unidad mayorista − inversión.';
    ws.addRow([noteText, '', '', '', '', '']);
    ws.mergeCells(2, 1, 2, 6);
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
        row.fob ?? '',
        row.mayorista_lista,
        row.precio_ml_prom,
        row.inversion,
        row.ganancia ?? ''
      ]);
      dataRow.eachCell((cell, colNumber) => {
        cell.font = { name: 'Calibri', size: 11 };
        if ([2, 3, 4, 5, 6].includes(colNumber)) cell.numFmt = '#,##0.00';
      });
      if (rowIdx % 2 === 0) {
        dataRow.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        });
      }
      rowIdx++;
    }

    ws.columns = [
      { width: 22 },
      { width: 28 },
      { width: 26 },
      { width: 28 },
      { width: 38 },
      { width: 18 }
    ];

    const buf = await workbook.xlsx.writeBuffer();
    const filename = `publicaciones_ml_por_articulo_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (error: any) {
    console.error('exportMercadolibrePublicationsXlsx:', error);
    res.status(500).json({ message: 'Error generando exportación de Mercado Libre', error: error.message });
  }
};
