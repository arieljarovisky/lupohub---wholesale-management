/**
 * Crea publicaciones en Tienda Nube a partir de ítems de Mercado Libre.
 */
import { Request, Response } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { get, execute } from '../database/db';
import {
  getValidMLToken,
  mercadoLibreItemIdCandidates,
  mlBaseTitle,
  mlColorSizeFromTitle,
} from './integrations.controller';
import { tnPostWithRetry } from '../utils/tiendanubeClient';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const TN_RATE_LIMIT_DELAY_MS = Math.max(0, parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type MlVariantRow = {
  sku: string;
  color: string;
  size: string;
  price: number;
  stock: number;
  mlItemId: string;
  mlVariationId: string | null;
};

function mlSkuFromVariation(v: any): string {
  const skuAttr = Array.isArray(v?.attributes)
    ? v.attributes.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU')
    : null;
  const fromAttr = skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '').toString().trim() : '';
  return fromAttr || (v?.seller_sku ?? v?.seller_custom_field ?? '').toString().trim();
}

function mlSkuFromItem(item: any): string {
  let s = (item?.seller_sku ?? item?.seller_custom_field ?? '').toString().trim();
  if (!s && Array.isArray(item?.attributes)) {
    const skuAttr = item.attributes.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU');
    s = (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '') : '').toString().trim();
  }
  if (!s && item?.variations?.length === 1) return mlSkuFromVariation(item.variations[0]);
  return s;
}

function attrsFromMlVariation(v: any, fallbackTitle?: string): { color: string; size: string } {
  let color = '';
  let size = '';
  (v?.attribute_combinations || []).forEach((attr: any) => {
    const id = (attr?.id || '').toString().toUpperCase();
    const name = (attr?.value_name || attr?.name || '').toString().trim();
    if (id === 'COLOR' || id === 'COLOUR' || id === 'COR') color = name;
    if (id === 'SIZE' || id === 'SIZE_TYPE' || id === 'TALLE' || id === 'TALLA') size = name;
  });
  if (!color && !size && fallbackTitle) {
    const parsed = mlColorSizeFromTitle(fallbackTitle);
    color = parsed.color;
    size = parsed.size;
  }
  return { color: color || 'Único', size: size || 'U' };
}

function variantRowsFromMlItem(item: any): MlVariantRow[] {
  const mlItemId = String(item?.id || '').trim();
  const title = (item?.title || '').toString().trim();
  if (item?.variations?.length > 0) {
    return item.variations.map((v: any) => {
      const { color, size } = attrsFromMlVariation(v, title);
      const sku = mlSkuFromVariation(v) || `ML-${mlItemId}-${v.id}`;
      return {
        sku,
        color,
        size,
        price: Number(v.price ?? item.price ?? 0),
        stock: Math.max(0, Number(v.available_quantity ?? 0)),
        mlItemId,
        mlVariationId: v.id != null ? String(v.id) : null,
      };
    });
  }
  const { color, size } = mlColorSizeFromTitle(title);
  const sku = mlSkuFromItem(item) || `ML-${mlItemId}`;
  return [
    {
      sku,
      color: color || 'Único',
      size: size || 'U',
      price: Number(item?.price ?? 0),
      stock: Math.max(0, Number(item?.available_quantity ?? 0)),
      mlItemId,
      mlVariationId: null,
    },
  ];
}

function localizedText(text: string): { es: string; en: string; pt: string } {
  const t = (text || '').trim() || 'Sin título';
  return { es: t, en: t, pt: t };
}

function mlPicturesToTnImages(item: any): { src: string }[] {
  const pics = Array.isArray(item?.pictures) ? item.pictures : [];
  return pics
    .map((p: any) => (p?.secure_url || p?.url || '').toString().trim())
    .filter((u: string) => u.startsWith('http'))
    .slice(0, 9)
    .map((src: string) => ({ src }));
}

function buildTiendaNubeBodyFromMlItems(items: any[], published: boolean): Record<string, unknown> {
  const first = items[0];
  const title =
    mlBaseTitle((first?.title || '').toString().trim()) ||
    (first?.title || '').toString().trim() ||
    'Producto';
  const descRaw =
    (first?.description?.plain_text ?? first?.description ?? '').toString().trim() ||
    title;

  const rowMap = new Map<string, MlVariantRow>();
  for (const item of items) {
    for (const row of variantRowsFromMlItem(item)) {
      const key = `${row.color.toLowerCase()}|${row.size.toUpperCase()}`;
      if (!rowMap.has(key)) rowMap.set(key, row);
    }
  }
  const rows = [...rowMap.values()];
  if (rows.length === 0) {
    throw new Error('No se pudieron armar variantes desde Mercado Libre');
  }

  const hasColor = rows.some((r) => r.color && r.color !== 'Único');
  const hasSize = rows.some((r) => r.size && r.size !== 'U');
  const attributes: { es: string }[] = [];
  if (hasColor) attributes.push({ es: 'Color' });
  if (hasSize) attributes.push({ es: 'Talle' });

  const variants = rows.map((r) => {
    const values: { es: string }[] = [];
    if (hasColor) values.push({ es: r.color });
    if (hasSize) values.push({ es: r.size });
    return {
      price: String(r.price > 0 ? r.price : first?.price ?? 0),
      stock_management: true,
      stock: r.stock,
      sku: r.sku,
      values,
    };
  });

  const body: Record<string, unknown> = {
    name: localizedText(title),
    description: localizedText(descRaw),
    published,
    variants,
  };
  if (attributes.length > 0) body.attributes = attributes;

  const images = mlPicturesToTnImages(first);
  for (const item of items) {
    if (images.length >= 9) break;
    for (const im of mlPicturesToTnImages(item)) {
      if (images.length >= 9) break;
      if (!images.some((x) => x.src === im.src)) images.push(im);
    }
  }
  if (images.length > 0) body.images = images;

  return body;
}

async function fetchMlItem(accessToken: string, rawId: string): Promise<any | null> {
  for (const id of mercadoLibreItemIdCandidates(rawId)) {
    try {
      const r = await axios.get(`https://api.mercadolibre.com/items/${id}?include_attributes=all`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
      });
      if (r.status === 200 && r.data && !r.data.error) return r.data;
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

async function linkLocalInventoryToTn(
  tnProductId: number,
  tnVariants: any[],
  mlRows: MlVariantRow[]
): Promise<number> {
  let linked = 0;
  const tnBySku = new Map<string, any>();
  for (const tv of tnVariants) {
    const sku = (tv?.sku || '').toString().trim();
    if (sku) tnBySku.set(sku.toUpperCase(), tv);
  }

  for (const row of mlRows) {
    const skuKey = row.sku.toUpperCase();
    const tnVar = tnBySku.get(skuKey);
    if (!tnVar?.id) continue;

    const local = await get(
      `SELECT pv.id AS variant_id, pc.product_id,
              p.tienda_nube_id, pv.tienda_nube_variant_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE UPPER(pv.sku) = ? OR pv.mercado_libre_item_id = ?
       LIMIT 1`,
      [skuKey, row.mlItemId]
    );
    if (!local?.variant_id) continue;

    const productId = local.product_id as string;
    const variantId = local.variant_id as string;

    await execute(`UPDATE products SET tienda_nube_id = ? WHERE id = ?`, [String(tnProductId), productId]);
    await execute(`UPDATE product_variants SET tienda_nube_variant_id = ? WHERE id = ?`, [
      String(tnVar.id),
      variantId,
    ]);

    if (row.mlItemId) {
      await execute(
        `UPDATE product_variants SET mercado_libre_item_id = COALESCE(mercado_libre_item_id, ?) WHERE id = ?`,
        [row.mlItemId, variantId]
      );
    }
    if (row.mlVariationId) {
      await execute(
        `UPDATE product_variants SET mercado_libre_variant_id = COALESCE(mercado_libre_variant_id, ?) WHERE id = ?`,
        [row.mlVariationId, variantId]
      );
    }

    const mlPack = 1;
    await execute(
      `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
       VALUES (?, ?, 'mercadolibre', ?, ?, ?)
       ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size)`,
      [
        uuidv4(),
        variantId,
        row.mlItemId,
        row.mlVariationId != null && row.mlVariationId !== row.mlItemId ? row.mlVariationId : '',
        mlPack,
      ]
    );
    await execute(
      `INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
       VALUES (?, ?, 'tiendanube', ?, ?, 1)
       ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size)`,
      [uuidv4(), variantId, String(tnProductId), String(tnVar.id)]
    );

    linked++;
  }
  return linked;
}

/** POST { itemId?, itemIds?, published?, linkLocal? } — crea producto en TN desde una o varias publicaciones ML. */
export const exportMercadoLibreToTiendaNube = async (req: Request, res: Response) => {
  try {
    const { itemId, itemIds, published = true, linkLocal = true } = req.body || {};
    const ids: string[] = Array.isArray(itemIds) && itemIds.length > 0
      ? itemIds.flatMap((id: unknown) => mercadoLibreItemIdCandidates(id)).filter(Boolean)
      : itemId != null && itemId !== ''
        ? mercadoLibreItemIdCandidates(itemId)
        : [];
    if (ids.length === 0) {
      return res.status(400).json({ message: 'Indicá itemId o itemIds (publicación/es de Mercado Libre)' });
    }
    if (ids.length > 30) {
      return res.status(400).json({ message: 'Máximo 30 publicaciones ML por exportación' });
    }

    const mlToken = await getValidMLToken();
    if (!mlToken) return res.status(400).json({ message: 'No hay integración con Mercado Libre' });

    const tnIntegration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!tnIntegration?.access_token) return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    const storeId = tnIntegration.store_id || tnIntegration.user_id;
    if (!storeId) return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });

    const items: any[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const item = await fetchMlItem(mlToken.access_token, id);
      if (item) items.push(item);
      else missing.push(id);
    }
    if (items.length === 0) {
      return res.status(404).json({ message: 'No se encontró ninguna publicación en Mercado Libre', missing });
    }

    const createBody = buildTiendaNubeBodyFromMlItems(items, published !== false);
    const url = `https://api.tiendanube.com/v1/${storeId}/products`;
    const headers = {
      Authentication: `bearer ${tnIntegration.access_token}`,
      'User-Agent': TN_USER_AGENT,
      'Content-Type': 'application/json',
    };
    const r = await tnPostWithRetry(axios, url, createBody, { headers, validateStatus: () => true });
    if (r.status !== 201) {
      const detail = r.data?.description || r.data?.message || r.statusText;
      return res.status(r.status >= 400 ? r.status : 502).json({
        message: ['Tienda Nube rechazó la publicación', detail].filter(Boolean).join(' — '),
        errors: r.data,
        mlItemsLoaded: items.length,
        missing,
      });
    }

    const tnProduct = r.data;
    const tnProductId = tnProduct?.id;
    const tnVariants = Array.isArray(tnProduct?.variants) ? tnProduct.variants : [];

    const allMlRows: MlVariantRow[] = [];
    const rowMap = new Map<string, MlVariantRow>();
    for (const item of items) {
      for (const row of variantRowsFromMlItem(item)) {
        const key = `${row.color.toLowerCase()}|${row.size.toUpperCase()}`;
        if (!rowMap.has(key)) rowMap.set(key, row);
      }
    }
    allMlRows.push(...rowMap.values());

    let variantsLinked = 0;
    if (linkLocal !== false && tnProductId && tnVariants.length > 0) {
      try {
        variantsLinked = await linkLocalInventoryToTn(tnProductId, tnVariants, allMlRows);
      } catch (linkErr: any) {
        console.warn('[ML→TN export] Error vinculando inventario local:', linkErr?.message || linkErr);
      }
    }

    if (TN_RATE_LIMIT_DELAY_MS > 0) await sleep(TN_RATE_LIMIT_DELAY_MS);

    return res.status(201).json({
      message: 'Publicación creada en Tienda Nube desde Mercado Libre',
      tiendaNubeProductId: tnProductId,
      tiendaNubeVariantCount: tnVariants.length,
      mlItemsUsed: items.map((i) => i.id),
      variantsInProduct: allMlRows.length,
      variantsLinkedLocal: variantsLinked,
      missing,
      product: tnProduct,
    });
  } catch (error: any) {
    const detail = error?.message || String(error);
    console.error('[exportMercadoLibreToTiendaNube]', detail);
    return res.status(500).json({ message: 'Error exportando a Tienda Nube', detail });
  }
};
