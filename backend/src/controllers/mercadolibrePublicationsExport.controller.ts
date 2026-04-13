import { Request, Response } from 'express';
import axios from 'axios';
import ExcelJS from 'exceljs';
import { query } from '../database/db';
import { getValidMLToken } from './integrations.controller';

const ML_SYNC_MAX_ITEMS = Math.max(100, parseInt(process.env.ML_SYNC_MAX_ITEMS || '5000', 10));

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
  /** Solo si el match viene de variant_publications */
  pub_pack?: number | null;
};

function pickLatestFob(
  rows: Array<{ variant_id: string; costo_unitario: number; fecha_despacho: string | Date | null; moneda: string | null }>
): Map<string, { cost: number; fecha: string; moneda: string }> {
  const map = new Map<string, { cost: number; fecha: string; moneda: string }>();
  for (const r of rows) {
    if (!r.variant_id) continue;
    const fechaStr =
      r.fecha_despacho instanceof Date
        ? r.fecha_despacho.toISOString().slice(0, 10)
        : String(r.fecha_despacho || '').slice(0, 10);
    const prev = map.get(r.variant_id);
    if (!prev || fechaStr > prev.fecha) {
      map.set(r.variant_id, {
        cost: Number(r.costo_unitario) || 0,
        fecha: fechaStr || '',
        moneda: (r.moneda || 'USD').toString().trim() || 'USD'
      });
    }
  }
  return map;
}

function resolveHubVariant(
  itemId: string,
  variationId: string | null,
  skuMlNorm: string,
  hubBySku: Map<string, HubVariant>,
  hubByMlItem: Map<string, HubVariant[]>,
  hubByMlProduct: Map<string, HubVariant[]>,
  pubMap: Map<string, HubVariant>
): HubVariant | null {
  const vKey = variationId != null && variationId !== '' ? `${itemId}|${variationId}` : `${itemId}|`;
  const pub = pubMap.get(vKey);
  if (pub) return pub;

  if (variationId != null && variationId !== '') {
    const pub2 = pubMap.get(`${itemId}|${String(variationId)}`);
    if (pub2) return pub2;
  }

  if (skuMlNorm) {
    const bySku = hubBySku.get(skuMlNorm);
    if (bySku) return bySku;
  }

  const listItem = hubByMlItem.get(itemId);
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

  const listProd = hubByMlProduct.get(itemId);
  if (listProd?.length === 1) return listProd[0];
  if (listProd && variationId) {
    const byVar = listProd.find((h) => h.mercado_libre_variant_id && String(h.mercado_libre_variant_id) === String(variationId));
    if (byVar) return byVar;
  }

  return null;
}

export const exportMercadolibrePublicationsXlsx = async (_req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const hubRows = (await query(`
      SELECT pv.id AS variant_id,
             TRIM(COALESCE(pv.external_sku, pv.sku)) AS sku_raw,
             pv.mercado_libre_item_id,
             pv.mercado_libre_variant_id,
             p.id AS product_id,
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
        const k = String(r.mercado_libre_item_id).trim();
        if (!hubByMlItem.has(k)) hubByMlItem.set(k, []);
        hubByMlItem.get(k)!.push(hv);
      }
      if (r.mercado_libre_id) {
        const k = String(r.mercado_libre_id).trim();
        if (!hubByMlProduct.has(k)) hubByMlProduct.set(k, []);
        hubByMlProduct.get(k)!.push(hv);
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
      const key = `${String(pr.external_product_id).trim()}|${extVar}`;
      pubMap.set(key, {
        ...base,
        pub_pack: pr.pack_size != null ? Math.max(1, Number(pr.pack_size) || 1) : null
      });
    }

    const fobRows = (await query(
      `SELECT di.variant_id, di.costo_unitario, d.fecha_despacho, d.moneda
       FROM despacho_items di
       JOIN despachos d ON d.id = di.despacho_id
       WHERE di.variant_id IS NOT NULL AND di.costo_unitario IS NOT NULL`
    )) as Array<{
      variant_id: string;
      costo_unitario: string | number | null;
      fecha_despacho: string | Date | null;
      moneda: string | null;
    }>;
    const fobByVariant = pickLatestFob(
      fobRows.map((x) => ({
        variant_id: x.variant_id,
        costo_unitario: Number(x.costo_unitario) || 0,
        fecha_despacho: x.fecha_despacho,
        moneda: x.moneda
      }))
    );

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

    type OutRow = Record<string, string | number | null | undefined>;
    const dataRows: OutRow[] = [];

    const batchSize = 10;
    for (let i = 0; i < allItemIds.length; i += batchSize) {
      const batch = allItemIds.slice(i, i + batchSize);
      const itemPromises = batch.map((itemId: string) =>
        axios
          .get(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, {
            headers: { Authorization: `Bearer ${mlToken.access_token}` }
          })
          .then((r) => r.data)
          .catch(() => null)
      );
      const items = await Promise.all(itemPromises);

      for (const item of items) {
        if (!item?.id) continue;
        const currency = (item.currency_id || '').toString();
        const permalink = (item.permalink || '').toString();
        const title = (item.title || '').toString();
        const status = (item.status || '').toString();

        const pushRow = (opts: {
          variationId: string | null;
          skuMl: string;
          price: number;
          stock: number;
          sold: number;
          attrText: string;
        }) => {
          const skuNorm = normalizeSkuForMatch(opts.skuMl);
          const hub = resolveHubVariant(
            String(item.id),
            opts.variationId,
            skuNorm,
            hubBySku,
            hubByMlItem,
            hubByMlProduct,
            pubMap
          );
          const packMayor = hub?.mayorista_pack_size ?? 1;
          const precioMayorista = hub?.base_price ?? null;
          const precioUnitMayorista =
            precioMayorista != null ? Number(precioMayorista) / Math.max(1, packMayor) : null;
          const fob = hub ? fobByVariant.get(hub.variant_id) : undefined;
          const margenPct =
            precioUnitMayorista != null && opts.price > 0
              ? ((opts.price - precioUnitMayorista) / opts.price) * 100
              : null;

          dataRows.push({
            item_id: String(item.id),
            variation_id: opts.variationId ?? '',
            titulo: title,
            estado: status,
            moneda_ml: currency,
            precio_ml: opts.price,
            stock: opts.stock,
            vendidos: opts.sold,
            sku_ml: opts.skuMl,
            color_talle: opts.attrText,
            producto_lupo: hub?.product_name ?? '',
            sku_lupo: hub?.sku_raw ?? '',
            variant_id_lupo: hub?.variant_id ?? '',
            precio_mayorista_ars: precioMayorista,
            pack_mayorista: packMayor,
            precio_unidad_mayorista_ars: precioUnitMayorista,
            pack_ml: hub?.pub_pack ?? hub?.ml_pack_default ?? '',
            costo_fob: fob?.cost ?? '',
            moneda_fob: fob?.moneda ?? '',
            fecha_ultimo_despacho: fob?.fecha ?? '',
            margen_bruto_pct_ml_vs_mayorista: margenPct !== null ? Math.round(margenPct * 100) / 100 : '',
            permalink
          });
        };

        if (item.variations && item.variations.length > 0) {
          for (const v of item.variations) {
            const skuMl = mlSkuFromVariation(v);
            const price = Number(v.price ?? item.price ?? 0) || 0;
            const stock = Number(v.available_quantity ?? 0) || 0;
            const sold = Number(v.sold_quantity ?? 0) || 0;
            const parts: string[] = [];
            (v.attribute_combinations || []).forEach((attr: any) => {
              const name = (attr.value_name || attr.name || '').toString().trim();
              const id = (attr.id || '').toString();
              if (name) parts.push(`${id}:${name}`);
            });
            pushRow({
              variationId: String(v.id),
              skuMl,
              price,
              stock,
              sold,
              attrText: parts.join(' · ')
            });
          }
        } else {
          const skuMl = mlSkuFromItem(item);
          const price = Number(item.price ?? 0) || 0;
          const stock = Number(item.available_quantity ?? 0) || 0;
          const sold = Number(item.sold_quantity ?? 0) || 0;
          pushRow({
            variationId: null,
            skuMl,
            price,
            stock,
            sold,
            attrText: ''
          });
        }
      }
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LupoHub';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('Publicaciones ML', {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { defaultRowHeight: 18 }
    });

    const headers = [
      'ID publicación',
      'ID variación',
      'Título',
      'Estado',
      'Moneda ML',
      'Precio ML',
      'Stock',
      'Vendidos',
      'SKU ML',
      'Atributos variación',
      'Producto LupoHub',
      'SKU LupoHub',
      'Variante LupoHub (id)',
      'Precio mayorista ARS (lista)',
      'Pack mayorista (uds)',
      'Precio unidad mayorista ARS',
      'Pack ML (vinculación)',
      'Costo FOB último despacho',
      'Moneda FOB',
      'Fecha último despacho',
      'Margen bruto % (ML vs unidad mayorista)',
      'Permalink'
    ];

    ws.addRow(headers);
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

    const colKeys = [
      'item_id',
      'variation_id',
      'titulo',
      'estado',
      'moneda_ml',
      'precio_ml',
      'stock',
      'vendidos',
      'sku_ml',
      'color_talle',
      'producto_lupo',
      'sku_lupo',
      'variant_id_lupo',
      'precio_mayorista_ars',
      'pack_mayorista',
      'precio_unidad_mayorista_ars',
      'pack_ml',
      'costo_fob',
      'moneda_fob',
      'fecha_ultimo_despacho',
      'margen_bruto_pct_ml_vs_mayorista',
      'permalink'
    ];

    let r = 2;
    for (const row of dataRows) {
      const values = colKeys.map((k) => row[k] ?? '');
      const dataRow = ws.addRow(values);
      dataRow.eachCell((cell, colNumber) => {
        cell.font = { name: 'Calibri', size: 11 };
        if ([6, 14, 16, 18, 21].includes(colNumber)) cell.numFmt = '#,##0.00';
        if ([7, 8].includes(colNumber)) cell.numFmt = '0';
      });
      if (r % 2 === 0) {
        dataRow.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        });
      }
      r++;
    }

    ws.columns = [
      { width: 14 },
      { width: 12 },
      { width: 42 },
      { width: 10 },
      { width: 10 },
      { width: 12 },
      { width: 8 },
      { width: 8 },
      { width: 16 },
      { width: 28 },
      { width: 28 },
      { width: 14 },
      { width: 36 },
      { width: 14 },
      { width: 12 },
      { width: 18 },
      { width: 14 },
      { width: 14 },
      { width: 10 },
      { width: 16 },
      { width: 18 },
      { width: 48 }
    ];

    const buf = await workbook.xlsx.writeBuffer();
    const filename = `publicaciones_ml_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (error: any) {
    console.error('exportMercadolibrePublicationsXlsx:', error);
    res.status(500).json({ message: 'Error generando exportación de Mercado Libre', error: error.message });
  }
};
