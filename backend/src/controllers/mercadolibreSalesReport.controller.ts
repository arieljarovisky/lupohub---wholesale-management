import { Request, Response } from 'express';
import axios from 'axios';
import ExcelJS from 'exceljs';
import { query } from '../database/db';
import { getValidMLToken, normalizeMercadoLibreItemId } from './integrations.controller';

function asYmd(raw: unknown): string {
  const s = String(raw || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
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

/** Prefijo de artículo Lupo/Tango desde SKU (ej. 661130280 → 661, 661-130-280 → 661). */
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

function parseArticlesFilter(raw: unknown): string[] {
  const base = String(raw || '').trim();
  if (!base) return [];
  return base
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.toLowerCase());
}

type HubVariant = {
  variant_id: string;
  sku_norm: string;
  mercado_libre_item_id: string | null;
  mercado_libre_variant_id: string | null;
  product_id: string;
  product_name: string;
  ml_pack_default: number;
  pub_pack?: number | null;
};

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

async function fetchAllPaidOrdersInRange(
  accessToken: string,
  sellerUserId: string,
  dateFromYmd: string,
  dateToYmd: string
): Promise<any[]> {
  const orders: any[] = [];
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

export const exportMercadoLibreSalesReportXlsx = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const from = asYmd(req.query.from || req.query.desde);
    const to = asYmd(req.query.to || req.query.hasta);
    if (!from || !to) {
      return res.status(400).json({ message: 'Parámetros requeridos: from y to en formato YYYY-MM-DD' });
    }
    if (from > to) {
      return res.status(400).json({ message: 'Rango inválido: from no puede ser mayor que to' });
    }

    const selectedArticles = parseArticlesFilter(req.query.articles || req.query.articulos);

    const hubRows = (await query(`
      SELECT pv.id AS variant_id,
             TRIM(COALESCE(pv.external_sku, pv.sku)) AS sku_raw,
             pv.mercado_libre_item_id,
             pv.mercado_libre_variant_id,
             p.id AS product_id,
             p.sku AS product_sku,
             p.name AS product_name,
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
      mercado_libre_id: string | null;
      ml_pack_default: string | number | null;
    }>;

    const hubBySku = new Map<string, HubVariant>();
    const hubByMlItem = new Map<string, HubVariant[]>();
    const hubByMlProduct = new Map<string, HubVariant[]>();
    const variantById = new Map<string, HubVariant>();
    const productMeta = new Map<string, { codigo: string; nombre: string }>();

    for (const r of hubRows) {
      const skuRaw = (r.sku_raw || '').toString();
      const hv: HubVariant = {
        variant_id: r.variant_id,
        sku_norm: normalizeSkuForMatch(skuRaw),
        mercado_libre_item_id: r.mercado_libre_item_id,
        mercado_libre_variant_id: r.mercado_libre_variant_id,
        product_id: r.product_id,
        product_name: (r.product_name || '').toString(),
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
      if (!productMeta.has(r.product_id)) {
        const skuTrim = ((r.product_sku || '') as string).trim();
        productMeta.set(r.product_id, {
          codigo: skuTrim || r.product_id,
          nombre: (r.product_name || '').toString()
        });
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

    const rawOrders = await fetchAllPaidOrdersInRange(
      mlToken.access_token,
      String(mlToken.user_id),
      from,
      to
    );

    type ArticleAgg = {
      articulo: string;
      nombre: string;
      cantidad: number;
      cantidad_ml: number;
      total: number;
      ordenes: number;
      vinculado: boolean;
    };
    const aggMap = new Map<string, ArticleAgg>();
    let matchedLines = 0;
    let unmappedLines = 0;

    for (const order of rawOrders) {
      const orderId = String(order?.id ?? '');
      const seenInOrder = new Set<string>();
      for (const line of order.order_items || []) {
        const itemIdRaw = line?.item?.id;
        const itemIdNorm = normalizeMercadoLibreItemId(itemIdRaw);
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

        let articulo: string;
        let nombre: string;
        let vinculado = false;
        let pack = 1;

        if (hub) {
          const meta = productMeta.get(hub.product_id);
          articulo = meta?.codigo || hub.product_id;
          nombre = meta?.nombre || hub.product_name;
          pack = Math.max(1, Number(hub.pub_pack ?? hub.ml_pack_default) || 1);
          vinculado = true;
          matchedLines += 1;
        } else {
          articulo =
            extractArticlePrefixFromMlSku(skuMl) ||
            skuMl ||
            (itemIdNorm ? `ML-${itemIdNorm}` : title || 'Sin identificar');
          nombre = title || skuMl || articulo;
          unmappedLines += 1;
        }

        const articuloLower = articulo.toLowerCase();
        const nombreLower = nombre.toLowerCase();
        if (
          selectedArticles.length > 0 &&
          !selectedArticles.some(
            (term) =>
              term === articuloLower ||
              articuloLower.includes(term) ||
              nombreLower.includes(term) ||
              skuMlNorm.toLowerCase().includes(term.replace(/[\s\-\/]/g, ''))
          )
        ) {
          continue;
        }

        const units = qtyMl * pack;
        const key = articulo.toLowerCase();
        const prev = aggMap.get(key) || {
          articulo,
          nombre,
          cantidad: 0,
          cantidad_ml: 0,
          total: 0,
          ordenes: 0,
          vinculado
        };
        prev.cantidad += units;
        prev.cantidad_ml += qtyMl;
        prev.total += unitPrice * qtyMl;
        const orderLineKey = `${orderId}|${itemIdNorm}|${variationId || ''}|${articulo}`;
        if (!seenInOrder.has(orderLineKey)) {
          seenInOrder.add(orderLineKey);
          prev.ordenes += 1;
        }
        if (vinculado) prev.vinculado = true;
        if (!prev.nombre && nombre) prev.nombre = nombre;
        aggMap.set(key, prev);
      }
    }

    const articleRows = Array.from(aggMap.values()).map((r) => ({
      articulo: r.articulo,
      nombre: r.nombre,
      cantidad: r.cantidad,
      cantidad_ml: r.cantidad_ml,
      ordenes: r.ordenes,
      precio: r.cantidad_ml > 0 ? r.total / r.cantidad_ml : 0,
      total: r.total,
      vinculado: r.vinculado ? 'Sí' : 'No'
    }));
    articleRows.sort((a, b) =>
      String(a.articulo).localeCompare(String(b.articulo), 'es', { numeric: true })
    );

    const totalUnits = articleRows.reduce((acc, r) => acc + r.cantidad, 0);
    const totalMlQty = articleRows.reduce((acc, r) => acc + r.cantidad_ml, 0);
    const totalAmount = articleRows.reduce((acc, r) => acc + r.total, 0);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'LupoHub';
    wb.created = new Date();

    const wsResumen = wb.addWorksheet('Resumen');
    wsResumen.columns = [{ width: 36 }, { width: 24 }];
    wsResumen.addRow(['Reporte ventas Mercado Libre', '']);
    wsResumen.mergeCells(1, 1, 1, 2);
    wsResumen.addRow(['Período desde', from]);
    wsResumen.addRow(['Período hasta', to]);
    wsResumen.addRow(['Órdenes pagadas analizadas', rawOrders.length]);
    wsResumen.addRow([
      'Filtro artículos',
      selectedArticles.length > 0 ? selectedArticles.join(', ') : 'Todos'
    ]);
    wsResumen.addRow(['Líneas vinculadas a LupoHub', matchedLines]);
    wsResumen.addRow(['Líneas sin vincular', unmappedLines]);
    wsResumen.addRow(['Artículos en reporte', articleRows.length]);
    wsResumen.addRow(['Unidades vendidas (con pack)', totalUnits]);
    wsResumen.addRow(['Cantidad ML (publicaciones)', totalMlQty]);
    wsResumen.addRow(['Total vendido (aprox)', totalAmount]);
    wsResumen.getCell('A1').font = { bold: true, size: 13 };
    for (let r = 2; r <= 11; r++) {
      wsResumen.getCell(`A${r}`).font = { bold: true };
    }
    wsResumen.getCell('B9').numFmt = '#,##0';
    wsResumen.getCell('B10').numFmt = '#,##0';
    wsResumen.getCell('B11').numFmt = '#,##0.00';

    const ws = wb.addWorksheet('Artículos');
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.columns = [
      { header: 'Artículo', key: 'articulo', width: 16 },
      { header: 'Nombre', key: 'nombre', width: 42 },
      { header: 'Unidades vendidas', key: 'cantidad', width: 18 },
      { header: 'Cant. publicaciones ML', key: 'cantidad_ml', width: 20 },
      { header: 'Órdenes', key: 'ordenes', width: 12 },
      { header: 'Precio unit. promedio ML', key: 'precio', width: 22 },
      { header: 'Total facturado', key: 'total', width: 18 },
      { header: 'Vinculado LupoHub', key: 'vinculado', width: 16 }
    ];
    ws.getRow(1).font = { bold: true };
    articleRows.forEach((row) => ws.addRow(row));

    for (let i = 2; i <= ws.rowCount; i++) {
      ws.getCell(`C${i}`).numFmt = '#,##0';
      ws.getCell(`D${i}`).numFmt = '#,##0';
      ws.getCell(`E${i}`).numFmt = '#,##0';
      ws.getCell(`F${i}`).numFmt = '#,##0.00';
      ws.getCell(`G${i}`).numFmt = '#,##0.00';
    }

    const buf = await wb.xlsx.writeBuffer();
    const filename = `reporte_ventas_mercadolibre_${from}_a_${to}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (error: any) {
    console.error('exportMercadoLibreSalesReportXlsx:', error);
    res.status(500).json({
      message: 'Error generando reporte de ventas Mercado Libre',
      error: error.message
    });
  }
};
