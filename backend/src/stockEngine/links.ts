/**
 * Arreglar vínculos rotos desde la pantalla "Stock y ventas":
 *  - ver las variaciones reales de la publicación (ML o TN) con una sugerida,
 *  - cambiar el vínculo a la variación correcta,
 *  - o quitar el vínculo (deja de mandarse stock ahí).
 */
import axios from 'axios';
import { get, query } from '../database/db';
import { tnGetWithRetry } from '../utils/tiendanubeClient';
import { readTnVariantStock } from '../utils/tnVariantStock';
import {
  enrichMlItemVariationsForMatch,
  matchMlVariationForVariantLink,
  mlVariationColorSizeFromApi,
  mlVariationSkuFromApi,
} from '../utils/mlVariationMatch';
import { q, withTransaction } from './ledger';
import { fetchMlItem, getMlAccessToken, mlItemIdCandidates, withMlRetry } from './mlClient';
import { resolveTargets, SyncTarget } from './targets';
import { retryVariantNow } from './syncQueue';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const s = (v: unknown) => (v == null ? '' : String(v).trim());

export type RemoteOption = {
  id: string;
  label: string;
  sku: string;
  stock: number | null;
  suggested: boolean;
  /** Otros productos del sistema que ya usan esta variación. */
  usedBy: string[];
};

export type LinkInfo = {
  key: string;
  platform: 'mercadolibre' | 'tiendanube';
  label: string;
  productId: string;
  externalVariantId: string;
  isBundle: boolean;
  ok: boolean | null;
  error: string | null;
  canFix: boolean;
  remoteTitle: string | null;
  remoteError: string | null;
  options: RemoteOption[];
};

async function variantHints(variantId: string) {
  return get(
    `SELECT COALESCE(pv.external_sku, pv.sku) AS sku, c.name AS color, sz.size_code AS size,
            p.name AS product_name
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     LEFT JOIN colors c ON c.id = pc.color_id
     LEFT JOIN sizes sz ON sz.id = pv.size_id
     WHERE pv.id = ?`,
    [variantId]
  );
}

/** Nombres de otras variantes del sistema que ya están vinculadas a cada variación remota. */
async function usedByMap(platform: string, productIds: string[], excludeVariantId: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!productIds.length) return out;
  const rows = (await query(
    `SELECT vp.external_variant_id AS ext, p.name, c.name AS color, sz.size_code AS size
     FROM variant_publications vp
     JOIN product_variants pv ON pv.id = vp.variant_id
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     LEFT JOIN colors c ON c.id = pc.color_id
     LEFT JOIN sizes sz ON sz.id = pv.size_id
     WHERE vp.platform = ? AND vp.external_product_id IN (?) AND vp.variant_id <> ?`,
    [platform, productIds, excludeVariantId]
  )) as any[];
  for (const r of rows) {
    const k = s(r.ext);
    const list = out.get(k) ?? [];
    list.push([s(r.name), s(r.color), s(r.size) ? `T. ${s(r.size)}` : ''].filter(Boolean).join(' · '));
    out.set(k, list);
  }
  return out;
}

async function mlOptions(target: SyncTarget, variantId: string): Promise<{ title: string | null; error: string | null; options: RemoteOption[] }> {
  const token = await getMlAccessToken();
  if (!token) return { title: null, error: 'Mercado Libre no está conectado', options: [] };
  const fetched = await fetchMlItem(target.productId, token);
  if (!fetched.ok) return { title: null, error: `La publicación ${target.productId} no se encontró en Mercado Libre`, options: [] };
  let item = fetched.item;
  item = await enrichMlItemVariationsForMatch(item, token.access_token, (url, cfg) => withMlRetry(() => axios.get(url, cfg)));
  const variations: any[] = Array.isArray(item.variations) ? item.variations : [];
  if (!variations.length) {
    return { title: s(item.title) || null, error: 'Esta publicación no tiene variaciones: el vínculo es a la publicación entera', options: [] };
  }
  const hints = await variantHints(variantId);
  const suggestion = matchMlVariationForVariantLink(variations, {
    sku: s(hints?.sku) || undefined,
    color: s(hints?.color) || undefined,
    size: s(hints?.size) || undefined,
  });
  const used = await usedByMap('mercadolibre', mlItemIdCandidates(target.productId), variantId);
  return {
    title: s(item.title) || null,
    error: null,
    options: variations.map((v) => {
      const { color, size } = mlVariationColorSizeFromApi(v);
      return {
        id: s(v.id),
        label: [color, size ? `T. ${size}` : ''].filter(Boolean).join(' · ') || `Variación ${s(v.id)}`,
        sku: mlVariationSkuFromApi(v),
        stock: v.available_quantity != null ? Number(v.available_quantity) : null,
        suggested: !!suggestion && s(suggestion.id) === s(v.id),
        usedBy: used.get(s(v.id)) ?? [],
      };
    }),
  };
}

async function tnOptions(target: SyncTarget, variantId: string): Promise<{ title: string | null; error: string | null; options: RemoteOption[] }> {
  const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
  const storeId = s(integration?.store_id || integration?.user_id);
  if (!integration?.access_token || !storeId) return { title: null, error: 'Tienda Nube no está conectada', options: [] };
  const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
  const r = await tnGetWithRetry<any>(axios, `https://api.tiendanube.com/v1/${storeId}/products/${encodeURIComponent(target.productId)}`, {
    headers,
    validateStatus: () => true,
  });
  if (r.status === 404) return { title: null, error: 'El producto ya no existe en Tienda Nube', options: [] };
  if (r.status !== 200) return { title: null, error: `Tienda Nube respondió ${r.status}`, options: [] };
  const product = r.data;
  const name = typeof product?.name === 'object' ? s(product.name.es || Object.values(product.name)[0]) : s(product?.name);
  const variants: any[] = Array.isArray(product?.variants) ? product.variants : [];
  const hints = await variantHints(variantId);
  const norm = (x: string) => x.toUpperCase().replace(/[\s\-\/]/g, '').replace(/^0+/, '');
  const hintSku = norm(s(hints?.sku));
  const used = await usedByMap('tiendanube', [target.productId], variantId);
  return {
    title: name || null,
    error: null,
    options: variants.map((v) => {
      const values = (Array.isArray(v?.values) ? v.values : [])
        .map((x: any) => (typeof x === 'object' ? s(x?.es ?? Object.values(x || {})[0]) : s(x)))
        .filter(Boolean);
      return {
        id: s(v.id),
        label: values.join(' · ') || `Variante ${s(v.id)}`,
        sku: s(v.sku),
        stock: readTnVariantStock(v),
        suggested: !!hintSku && norm(s(v.sku)) === hintSku,
        usedBy: used.get(s(v.id)) ?? [],
      };
    }),
  };
}

/** Vínculos de una variante con su estado y, si están rotos, las opciones para corregirlos. */
export async function getVariantLinks(variantId: string): Promise<LinkInfo[]> {
  const targets = await resolveTargets(variantId);
  const status = (await query(`SELECT target_key, ok, last_error FROM stock_sync_targets WHERE variant_id = ?`, [variantId])) as any[];
  const byKey = new Map(status.map((r) => [String(r.target_key), r]));
  const out: LinkInfo[] = [];
  for (const t of targets) {
    const st = byKey.get(t.key);
    const ok = st ? !!Number(st.ok) : null;
    const info: LinkInfo = {
      key: t.key,
      platform: t.platform,
      label: t.label,
      productId: t.productId,
      externalVariantId: t.externalVariantId,
      isBundle: !!t.bundleId,
      ok,
      error: st?.last_error ? String(st.last_error) : null,
      canFix: !t.bundleId,
      remoteTitle: null,
      remoteError: null,
      options: [],
    };
    // Solo se consulta la plataforma para los vínculos con problema (es más lento).
    if (!t.bundleId && ok === false) {
      try {
        const r = t.platform === 'mercadolibre' ? await mlOptions(t, variantId) : await tnOptions(t, variantId);
        info.remoteTitle = r.title;
        info.remoteError = r.error;
        info.options = r.options;
      } catch (e: any) {
        info.remoteError = e?.message || 'No pude consultar la publicación';
      }
    }
    out.push(info);
  }
  return out;
}

function findTarget(targets: SyncTarget[], key: string): SyncTarget | null {
  return targets.find((t) => t.key === key) ?? null;
}

/** Cambia el vínculo `key` para que apunte a la variación `newExternalVariantId` de la misma publicación. */
export async function fixVariantLink(variantId: string, key: string, newExternalVariantId: string): Promise<string> {
  const targets = await resolveTargets(variantId);
  const t = findTarget(targets, key);
  if (!t) throw new Error('Ese vínculo ya no existe. Actualizá la pantalla.');
  if (t.bundleId) throw new Error('Los packs multicolor se corrigen en su propia pantalla.');
  const newVar = s(newExternalVariantId);
  if (!newVar) throw new Error('Elegí una variación.');
  const oldVar = s(t.externalVariantId);
  const newKey = `${t.platform === 'tiendanube' ? 'tn' : 'ml'}:${t.productId}/${newVar}`;

  await withTransaction(async (conn) => {
    const products = t.platform === 'mercadolibre' ? mlItemIdCandidates(t.productId) : [t.productId];
    // 1) Vínculos explícitos (variant_publications).
    const pubs = await q(
      conn,
      `SELECT id FROM variant_publications
       WHERE variant_id = ? AND platform = ? AND external_product_id IN (?) AND external_variant_id = ?`,
      [variantId, t.platform, products, oldVar]
    );
    if ((pubs as any[]).length) {
      await conn.query(
        `DELETE FROM variant_publications WHERE variant_id = ? AND platform = ? AND external_product_id IN (?) AND external_variant_id = ?`,
        [variantId, t.platform, products, oldVar]
      );
    }
    await conn.query(
      `INSERT IGNORE INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
       VALUES (UUID(), ?, ?, ?, ?, ?)`,
      [variantId, t.platform, t.productId, newVar, t.pack]
    );
    // 2) Columnas viejas de la variante (las usa Inventario para mostrar el vínculo).
    if (t.platform === 'mercadolibre') {
      await conn.query(
        `UPDATE product_variants SET mercado_libre_variant_id = ? WHERE id = ? AND (mercado_libre_variant_id IS NULL OR mercado_libre_variant_id = '' OR mercado_libre_variant_id = ?)`,
        [newVar, variantId, oldVar]
      );
    } else {
      await conn.query(
        `UPDATE product_variants SET tienda_nube_variant_id = ? WHERE id = ? AND tienda_nube_variant_id = ?`,
        [newVar, variantId, oldVar]
      );
    }
    await conn.query(`DELETE FROM stock_sync_exclusions WHERE variant_id = ? AND target_key = ?`, [variantId, newKey]);
    if (key !== newKey) {
      await conn.query(`INSERT IGNORE INTO stock_sync_exclusions (variant_id, target_key) VALUES (?, ?)`, [variantId, key]);
      await conn.query(`DELETE FROM stock_sync_targets WHERE variant_id = ? AND target_key = ?`, [variantId, key]);
    }
  });

  await retryVariantNow(variantId);
  return 'Listo, vínculo corregido. Ya estoy mandando el stock.';
}

/** Quita el vínculo `key`: no se manda más stock a esa publicación para esta variante. */
export async function removeVariantLink(variantId: string, key: string): Promise<string> {
  const targets = await resolveTargets(variantId);
  const t = findTarget(targets, key);
  if (!t) throw new Error('Ese vínculo ya no existe. Actualizá la pantalla.');
  if (t.bundleId) throw new Error('Los packs multicolor se quitan en su propia pantalla.');

  await withTransaction(async (conn) => {
    const products = t.platform === 'mercadolibre' ? mlItemIdCandidates(t.productId) : [t.productId];
    await conn.query(
      `DELETE FROM variant_publications WHERE variant_id = ? AND platform = ? AND external_product_id IN (?) AND external_variant_id = ?`,
      [variantId, t.platform, products, s(t.externalVariantId)]
    );
    if (t.platform === 'mercadolibre') {
      await conn.query(
        `UPDATE product_variants SET mercado_libre_variant_id = NULL WHERE id = ? AND mercado_libre_variant_id = ?`,
        [variantId, s(t.externalVariantId)]
      );
      await conn.query(
        `UPDATE product_variants SET mercado_libre_item_id = NULL WHERE id = ? AND mercado_libre_item_id IN (?)`,
        [variantId, products]
      );
    } else {
      await conn.query(
        `UPDATE product_variants SET tienda_nube_variant_id = NULL WHERE id = ? AND tienda_nube_variant_id = ?`,
        [variantId, s(t.externalVariantId)]
      );
    }
    await conn.query(`INSERT IGNORE INTO stock_sync_exclusions (variant_id, target_key) VALUES (?, ?)`, [variantId, key]);
    await conn.query(`DELETE FROM stock_sync_targets WHERE variant_id = ? AND target_key = ?`, [variantId, key]);
  });

  // Si el vínculo "renace" desde la publicación del producto (columnas viejas), excluirlo también.
  const after = await resolveTargets(variantId);
  const reborn = after.filter((x) => !x.bundleId && x.platform === t.platform && x.productId === t.productId);
  for (const r of reborn) {
    await withTransaction(async (conn) => {
      await conn.query(`INSERT IGNORE INTO stock_sync_exclusions (variant_id, target_key) VALUES (?, ?)`, [variantId, r.key]);
    });
  }

  await retryVariantNow(variantId);
  return 'Listo, vínculo quitado. Esa publicación ya no recibe el stock de este producto.';
}
