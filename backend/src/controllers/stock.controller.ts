import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { updateMercadoLibreStock } from './integrations.controller';
import { tnPutWithRetry } from '../utils/tiendanubeClient';
import { enqueueStockWebhookForVariant } from '../services/lupoStockWebhook.service';
import { codigoTalleParaSku, TALLE_CODIGO_A_NOMBRE } from '../talles-tango';
import {
  canonicalNumericColorCode,
  digitsOnlyColorCode,
  normalizeColorCodeForImportValue,
} from '../utils/colorCodeCanonical';

const SYNC_DEBOUNCE_MS = 2800;
const pendingSyncByVariant: Record<string, { timeout: NodeJS.Timeout; stock: number }> = {};

/** Cancela el sync diferido de una variante (evita que un debounce viejo pise un ajuste manual recién hecho). */
function flushPendingExternalSync(variantId: string): void {
  const prev = pendingSyncByVariant[variantId];
  if (prev) {
    clearTimeout(prev.timeout);
    delete pendingSyncByVariant[variantId];
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Normaliza IDs de publicación ML y genera candidatos tolerantes (ej: MLAU123 -> MLA123 / MLU123). */
function mlNormalizeItemId(raw: unknown): string {
  let s = (raw ?? '').toString().trim();
  if (!s) return '';
  try { s = decodeURIComponent(s); } catch {}
  s = s.replace(/\s+/g, '').toUpperCase();
  if (/^https?:\/\//i.test(s)) {
    const m = s.match(/\/(ML[A-Z]{0,5}-?\d+)(?:[/?#]|$)/i);
    if (m?.[1]) s = m[1].toUpperCase();
  }
  const mDash = s.match(/^(ML[A-Z]{0,5})-(\d+)$/);
  if (mDash) s = `${mDash[1]}${mDash[2]}`;
  const legacy = s.match(/^ML-(\d+)$/);
  if (legacy) s = `MLA${legacy[1]}`;
  return s;
}

function mlItemIdCandidates(raw: unknown): string[] {
  const base = mlNormalizeItemId(raw);
  if (!base) return [];
  if (/^\d+$/.test(base)) {
    const sites = ['MLU', 'MLA', 'MLB', 'MLM', 'MCO', 'MLC', 'MPE', 'MEC', 'MLV'];
    return sites.map((site) => `${site}${base}`);
  }
  const out: string[] = [base];
  const m = base.match(/^(ML[A-Z]{2,6})(\d+)$/);
  if (m) {
    const prefix = m[1];
    const num = m[2];
    if (prefix.length > 3) out.push(`${prefix.slice(0, 3)}${num}`);
    if (prefix.length > 3) out.push(`ML${prefix[prefix.length - 1]}${num}`);
    if (prefix === 'MLAU') out.push(`MLA${num}`);
  }
  return Array.from(new Set(out.filter(Boolean)));
}

async function resolveMlUserProductItemCandidates(
  rawUserProductId: string,
  headers: Record<string, string>
): Promise<string[]> {
  const up = mlNormalizeItemId(rawUserProductId);
  if (!/^MLAU\d+$/i.test(up)) return [];
  try {
    const meRes = await axios.get('https://api.mercadolibre.com/users/me', {
      headers,
      validateStatus: () => true
    });
    const sellerId = meRes.status === 200 ? (meRes.data?.id ?? meRes.data?.user_id) : null;
    if (!sellerId) return [];

    const allIds: string[] = [];
    const seen = new Set<string>();
    const statuses = ['active', 'paused', 'closed'] as const;
    const pageLimit = 100;

    for (const st of statuses) {
      let offset = 0;
      while (offset < 5000) {
        const res = await axios.get(
          `https://api.mercadolibre.com/users/${encodeURIComponent(String(sellerId))}/items/search`,
          {
            headers,
            params: { user_product_id: up, status: st, limit: pageLimit, offset },
            validateStatus: () => true
          }
        );
        if (res.status >= 400 || !res.data) break;
        const rows: any[] = Array.isArray(res.data?.results) ? res.data.results : [];
        for (const x of rows) {
          const id = String(x || '').trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          allIds.push(id);
        }
        if (rows.length < pageLimit) break;
        offset += pageLimit;
      }
    }

    return Array.from(new Set(allIds.flatMap((id) => mlItemIdCandidates(id))));
  } catch {
    return [];
  }
}

async function resolveReachableMlItemId(
  rawItemId: string,
  headers: Record<string, string>,
  expectedVariationId?: string
): Promise<string | null> {
  const tryCandidates = async (candidates: string[]): Promise<string | null> => {
    for (const c of candidates) {
      try {
        const r = await axios.get(`https://api.mercadolibre.com/items/${encodeURIComponent(c)}`, {
          headers,
          validateStatus: () => true
        });
        if (r.status !== 200 || !r.data || r.data.error) continue;
        if (expectedVariationId) {
          const variations: any[] = Array.isArray(r.data?.variations) ? r.data.variations : [];
          if (variations.length > 0 && !variations.some((v: any) => String(v?.id) === String(expectedVariationId))) {
            continue;
          }
        }
        return c;
      } catch {
        // probar siguiente candidato
      }
    }
    return null;
  };

  const direct = await tryCandidates(mlItemIdCandidates(rawItemId));
  if (direct) return direct;

  const upCandidates = await resolveMlUserProductItemCandidates(rawItemId, headers);
  if (upCandidates.length > 0) {
    const fromUp = await tryCandidates(upCandidates);
    if (fromUp) return fromUp;
  }

  return null;
}

async function withRetry429409<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    const status = e.response?.status;
    if (retries > 0 && (status === 429 || status === 409)) {
      const delayMs = status === 429 ? 2500 : 1200;
      await sleep(delayMs);
      return withRetry429409(fn, retries - 1);
    }
    throw e;
  }
}

// Tipos de movimiento de stock
export type StockMovementType = 
  | 'PEDIDO_MAYORISTA'
  | 'VENTA_TIENDA_NUBE'
  | 'VENTA_MERCADO_LIBRE'
  | 'CANCEL_VENTA_TIENDA_NUBE'
  | 'AJUSTE_MANUAL'
  | 'DEVOLUCION'
  | 'IMPORTACION_TN'
  | 'IMPORTACION_ML'
  | 'IMPORTACION_EXCEL'
  | 'IMPORTACION_DESPACHO_GRID'
  | 'SNAPSHOT_INICIAL';

interface StockMovement {
  variantId: string;
  quantity: number;
  type: StockMovementType;
  reference?: string;
}

// Registrar movimiento de stock en historial
export const logStockMovement = async (
  variantId: string,
  previousStock: number,
  newStock: number,
  movementType: StockMovementType,
  reference?: string
) => {
  try {
    await execute(
      `INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW())`,
      [variantId, previousStock, newStock, newStock - previousStock, movementType, reference || null]
    );
  } catch (error) {
    console.error('Error logging stock movement:', error);
    throw error;
  }
};

// Actualizar stock de una variante
export const updateVariantStock = async (
  variantId: string,
  newStock: number,
  movementType: StockMovementType,
  reference?: string,
  syncExternal: boolean = true
): Promise<boolean> => {
  try {
    const currentStockRow = await get(
      `SELECT stock FROM stocks WHERE variant_id = ?`,
      [variantId]
    );
    const previousStock = currentStockRow?.stock || 0;

    await execute(
      `INSERT INTO stocks (variant_id, stock) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE stock = ?`,
      [variantId, newStock, newStock]
    );

    await logStockMovement(variantId, previousStock, newStock, movementType, reference);

    if (syncExternal) {
      // Ajuste desde inventario: sin debounce de 2,8s (TN parecía no actualizar hasta el 2º cambio).
      // Pedidos/importaciones masivas siguen con debounce para no saturar APIs.
      if (movementType === 'AJUSTE_MANUAL') {
        flushPendingExternalSync(variantId);
        const toSync = newStock;
        void syncStockToExternalPlatforms(variantId, toSync).catch(err =>
          console.error('[Sync AJUSTE_MANUAL] Error:', err?.message || err)
        );
      } else {
        scheduleSyncToExternalPlatforms(variantId, newStock);
      }
    }

    return true;
  } catch (error) {
    console.error('Error updating variant stock:', error);
    return false;
  }
};

// Unidades a descontar por ítem: si sell_as_pack=1, quantity está en packs → multiplicar por mayorista_pack_size
function unitsToDeductForOrderItem(quantity: number, sellAsPack: boolean | number, mayoristaPackSize: number | null | undefined): number {
  const packSize = Math.max(1, Number(mayoristaPackSize) || 1);
  return sellAsPack ? quantity * packSize : quantity;
}

/** Texto de referencia en `stock_movements` para el descuento de un pedido mayorista. */
export const wholesaleOrderStockReference = (orderId: string) => `Pedido: ${orderId}`;

/** Indica si ya se registró al menos un movimiento PEDIDO_MAYORISTA para este pedido (idempotencia). */
export const isMayoristaStockDeductedForWholesale = async (orderId: string): Promise<boolean> => {
  const ref = wholesaleOrderStockReference(orderId);
  const row = await get(
    `SELECT 1 AS ok FROM stock_movements WHERE movement_type = 'PEDIDO_MAYORISTA' AND reference = ? LIMIT 1`,
    [ref]
  );
  return !!row;
};

// Descontar stock por pedido mayorista
export const deductStockForOrder = async (orderId: string): Promise<{ success: boolean; errors: string[] }> => {
  const errors: string[] = [];
  
  try {
    const items = await query(
      `SELECT oi.variant_id, oi.quantity, COALESCE(oi.sell_as_pack, 0) AS sell_as_pack, pv.sku,
              COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size,
              s.stock AS current_stock
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN stocks s ON s.variant_id = oi.variant_id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    const unitsByVariant = new Map<string, { units: number; sku: string }>();
    for (const item of items as any[]) {
      const units = unitsToDeductForOrderItem(item.quantity, item.sell_as_pack, item.mayorista_pack_size);
      const vid = item.variant_id as string;
      const prev = unitsByVariant.get(vid);
      if (prev) prev.units += units;
      else unitsByVariant.set(vid, { units, sku: item.sku || vid });
    }

    for (const [variantId, { units, sku }] of unitsByVariant) {
      const stockRow = await get(`SELECT stock FROM stocks WHERE variant_id = ?`, [variantId]);
      const currentStock = stockRow?.stock ?? 0;
      const newStock = Math.max(0, Number(currentStock) - units);

      const success = await updateVariantStock(
        variantId,
        newStock,
        'PEDIDO_MAYORISTA',
        `Pedido: ${orderId}`
      );

      if (!success) {
        errors.push(`Error actualizando stock para variante ${sku || variantId}`);
      }
    }

    return { success: errors.length === 0, errors };
  } catch (error: any) {
    console.error('Error deducting stock for order:', error);
    return { success: false, errors: [error.message] };
  }
};

// Restaurar stock cuando se cancela un pedido
export const restoreStockForOrder = async (orderId: string): Promise<{ success: boolean; errors: string[] }> => {
  const errors: string[] = [];
  
  try {
    const items = await query(
      `SELECT oi.variant_id, oi.quantity, COALESCE(oi.sell_as_pack, 0) AS sell_as_pack, pv.sku,
              COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size,
              s.stock AS current_stock
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN stocks s ON s.variant_id = oi.variant_id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    const unitsByVariant = new Map<string, { units: number; sku: string }>();
    for (const item of items as any[]) {
      const units = unitsToDeductForOrderItem(item.quantity, item.sell_as_pack, item.mayorista_pack_size);
      const vid = item.variant_id as string;
      const prev = unitsByVariant.get(vid);
      if (prev) prev.units += units;
      else unitsByVariant.set(vid, { units, sku: item.sku || vid });
    }

    for (const [variantId, { units, sku }] of unitsByVariant) {
      const stockRow = await get(`SELECT stock FROM stocks WHERE variant_id = ?`, [variantId]);
      const currentStock = stockRow?.stock ?? 0;
      const newStock = Number(currentStock) + units;

      const success = await updateVariantStock(
        variantId,
        newStock,
        'DEVOLUCION',
        `Cancelación pedido: ${orderId}`
      );

      if (!success) {
        errors.push(`Error restaurando stock para variante ${sku || variantId}`);
      }
    }

    return { success: errors.length === 0, errors };
  } catch (error: any) {
    console.error('Error restoring stock for order:', error);
    return { success: false, errors: [error.message] };
  }
};

// Restaurar stock para un item particular del pedido (NC parcial)
export const restoreStockForOrderItem = async (orderId: string, itemIndex: number, quantity?: number): Promise<{ success: boolean; errors: string[] }> => {
  const errors: string[] = [];
  try {
    const items = await query(
      `SELECT oi.variant_id, oi.quantity, COALESCE(oi.sell_as_pack, 0) AS sell_as_pack, pv.sku,
              COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size,
              s.stock AS current_stock
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN stocks s ON s.variant_id = oi.variant_id
       WHERE oi.order_id = ?
       ORDER BY oi.id`,
      [orderId]
    );

    if (!items || (items as any[]).length === 0) {
      return { success: false, errors: ['No hay ítems para este pedido.'] };
    }

    if (itemIndex < 0 || itemIndex >= (items as any[]).length) {
      return { success: false, errors: ['itemIndex inválido para este pedido.'] };
    }

    const item = (items as any[])[itemIndex];
    const qty = quantity != null ? quantity : Number(item.quantity || 0);
    if (isNaN(qty) || qty <= 0 || qty > Number(item.quantity || 0)) {
      return { success: false, errors: [`quantity inválida. Debe ser 1..${item.quantity}`] };
    }

    const units = unitsToDeductForOrderItem(qty, item.sell_as_pack, item.mayorista_pack_size);
    const currentStock = Number(item.current_stock || 0);
    const newStock = currentStock + units;

    const success = await updateVariantStock(
      item.variant_id,
      newStock,
      'DEVOLUCION',
      `Nota de crédito pedido: ${orderId}`
    );

    if (!success) {
      errors.push(`Error restaurando stock para variante ${item.sku || item.variant_id}`);
    }

    return { success: errors.length === 0, errors };
  } catch (error: any) {
    console.error('Error restoring stock for order item:', error);
    return { success: false, errors: [error.message] };
  }
};

// Aplicar pack size: stock en app es por unidad; en ML/TN puede ser por pack (ej. pack x2 → enviar stock/2).
function stockForPlatform(localStock: number, packSize: number | null | undefined): number {
  const n = Math.max(0, Number(packSize) || 1);
  return n <= 0 ? localStock : Math.floor(localStock / n);
}

// Programar sincronización con debounce para evitar demasiadas llamadas a ML/TN (429 / conflict).
function scheduleSyncToExternalPlatforms(variantId: string, newStock: number): void {
  const prev = pendingSyncByVariant[variantId];
  if (prev) clearTimeout(prev.timeout);
  pendingSyncByVariant[variantId] = {
    stock: newStock,
    timeout: setTimeout(() => {
      const entry = pendingSyncByVariant[variantId];
      const stockToSync = entry?.stock ?? newStock;
      delete pendingSyncByVariant[variantId];
      syncStockToExternalPlatforms(variantId, stockToSync).catch(err =>
        console.error('[Sync debounced] Error:', err?.message || err)
      );
    }, SYNC_DEBOUNCE_MS)
  };
}

async function runExternalSyncWithRetries(
  label: string,
  run: () => Promise<boolean>,
  attempts: number = 3
): Promise<boolean> {
  let lastOk = false;
  for (let i = 1; i <= attempts; i++) {
    try {
      lastOk = await run();
      if (lastOk) return true;
    } catch (error: any) {
      console.warn(`[Sync] ${label} intento ${i}/${attempts} con excepción:`, error?.message || error);
    }
    if (i < attempts) await sleep(1200 * i);
  }
  console.warn(`[Sync] ${label} no se pudo sincronizar tras ${attempts} intentos.`);
  return false;
}

// Sincronizar stock a todas las publicaciones vinculadas (variant_publications). Si no hay ninguna, fallback a columnas legacy.
export const syncStockToExternalPlatforms = async (variantId: string, newStock: number): Promise<void> => {
  try {
    const publications = await query(
      `SELECT id, platform, external_product_id, external_variant_id, pack_size FROM variant_publications WHERE variant_id = ?`,
      [variantId]
    );

    if (publications && (publications as any[]).length > 0) {
      const tasks: Promise<boolean>[] = [];
      for (const pub of publications as any[]) {
        const pack = Math.max(1, Number(pub.pack_size) || 1);
        const stockToSend = stockForPlatform(newStock, pack);
        if (pub.platform === 'tiendanube' && pub.external_variant_id) {
          const label = `TN pub=${pub.external_product_id}/${pub.external_variant_id} variant=${variantId}`;
          tasks.push(
            runExternalSyncWithRetries(label, () =>
              updateTiendaNubeStock(pub.external_product_id, pub.external_variant_id, stockToSend)
            )
          );
        } else if (pub.platform === 'mercadolibre') {
          const itemId = pub.external_product_id;
          const variationId = (pub.external_variant_id && String(pub.external_variant_id).trim()) || null;
          if (variationId) {
            const label = `ML item=${itemId} var=${variationId} variant=${variantId}`;
            tasks.push(
              runExternalSyncWithRetries(label, () =>
                updateMercadoLibreStockByVariant(itemId, variationId, stockToSend)
              )
            );
          } else {
            const label = `ML item=${itemId} variant=${variantId}`;
            tasks.push(
              runExternalSyncWithRetries(label, () =>
                updateMercadoLibreStockByItem(itemId, stockToSend)
              )
            );
          }
        }
      }
      // Paralelo: ML y TN reciben el mismo stock casi a la vez (menos “ML ya actualizó y TN no”).
      await Promise.all(tasks);
    } else {
      // Fallback: enlaces legacy en product_variants + products
      const variant = await get(
        `SELECT pv.id, pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
                p.tienda_nube_id, p.mercado_libre_id, pv.sku, pv.external_sku,
                COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack,
                COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
         FROM product_variants pv
         JOIN product_colors pc ON pc.id = pv.product_color_id
         JOIN products p ON p.id = pc.product_id
         WHERE pv.id = ?`,
        [variantId]
      );
      if (!variant) return;

      const stockTN = stockForPlatform(newStock, variant.tn_pack);
      const stockML = stockForPlatform(newStock, variant.ml_pack);
      const skuMLTN = variant.external_sku || variant.sku;

      if (variant.tienda_nube_id && variant.tienda_nube_variant_id) {
        await runExternalSyncWithRetries(
          `TN legacy=${variant.tienda_nube_id}/${variant.tienda_nube_variant_id} variant=${variantId}`,
          () => updateTiendaNubeStock(variant.tienda_nube_id, variant.tienda_nube_variant_id, stockTN)
        );
      }
      if (variant.mercado_libre_id && variant.mercado_libre_variant_id) {
        await runExternalSyncWithRetries(
          `ML legacy=${variant.mercado_libre_id}/${variant.mercado_libre_variant_id} variant=${variantId}`,
          () => updateMercadoLibreStockByVariant(variant.mercado_libre_id, variant.mercado_libre_variant_id, stockML)
        );
      } else if (variant.mercado_libre_item_id) {
        await runExternalSyncWithRetries(
          `ML legacy item=${variant.mercado_libre_item_id} variant=${variantId}`,
          () => updateMercadoLibreStockByItem(variant.mercado_libre_item_id, stockML)
        );
      } else if (skuMLTN) {
        await runExternalSyncWithRetries(
          `ML legacy sku=${skuMLTN} variant=${variantId}`,
          async () => {
            await updateMercadoLibreStock(skuMLTN, stockML);
            return true;
          }
        );
      }
    }
  } catch (error) {
    console.error('Error syncing stock to external platforms:', error);
  } finally {
    // Lupo shop: siempre encolar evento firmado por variante (si hay config).
    await enqueueStockWebhookForVariant(variantId, newStock);
  }
};

// Actualizar stock en Tienda Nube
export const updateTiendaNubeStock = async (
  productId: string,
  variantId: string,
  stock: number
): Promise<boolean> => {
  try {
    const integration = await get(
      `SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`
    );

    if (!integration?.access_token || !integration?.store_id) {
      console.log('[TN Stock] No hay integración configurada');
      return false;
    }

    await tnPutWithRetry(
      axios,
      `https://api.tiendanube.com/v1/${integration.store_id}/products/${productId}/variants/${variantId}`,
      { stock },
      {
        headers: {
          'Authentication': `bearer ${integration.access_token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'LupoHub (lupohub@example.com)'
        }
      },
      { maxRetries: 4 }
    );

    console.log(`[TN Stock] Actualizado producto ${productId} variante ${variantId} a ${stock} unidades`);
    return true;
  } catch (error: any) {
    console.error('[TN Stock] Error:', error.response?.data || error.message);
    return false;
  }
};

// Actualizar stock en Mercado Libre cuando la variante tiene su propia publicación (ítem sin variaciones o con una sola).
export const updateMercadoLibreStockByItem = async (itemId: string, stock: number): Promise<boolean> => {
  const integration = await get(
    `SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`
  );
  if (!integration?.access_token) {
    console.log('[ML Stock] No hay integración configurada');
    return false;
  }
  const headers = {
    'Authorization': `Bearer ${integration.access_token}`,
    'Content-Type': 'application/json'
  };
  try {
    const resolvedItemId = await resolveReachableMlItemId(itemId, headers);
    if (!resolvedItemId) {
      console.warn(`[ML Stock] No se pudo resolver itemId válido desde "${itemId}"`);
      return false;
    }
    const getRes = await withRetry429409(() => axios.get(`https://api.mercadolibre.com/items/${resolvedItemId}`, { headers }));
    const item = getRes.data;
    const variations: any[] = item.variations || [];
    if (variations.length === 0) {
      await withRetry429409(() =>
        axios.put(`https://api.mercadolibre.com/items/${resolvedItemId}`, { available_quantity: stock }, { headers })
      );
      console.log(`[ML Stock] Actualizado publicación única ${resolvedItemId} a ${stock} unidades`);
      return true;
    }
    if (variations.length === 1) {
      await withRetry429409(() =>
        axios.put(
          `https://api.mercadolibre.com/items/${resolvedItemId}`,
          { variations: [{ id: variations[0].id, available_quantity: stock }] },
          { headers }
        )
      );
      console.log(`[ML Stock] Actualizado publicación única (1 variación) ${resolvedItemId} a ${stock} unidades`);
      return true;
    }
    console.log(`[ML Stock] Item ${resolvedItemId} tiene ${variations.length} variaciones; usar publicación con variaciones en su lugar`);
    return false;
  } catch (e: any) {
    console.error(`[ML Stock] Error actualizando publicación única ${itemId}:`, e.response?.data || e.message);
    return false;
  }
};

// Actualizar stock en Mercado Libre por variante.
// Prueba primero PUT a la subrecurso; si ML devuelve error, usa GET item + PUT item con array variations (formato que exige la API en muchos casos).
export const updateMercadoLibreStockByVariant = async (
  itemId: string,
  variationId: string,
  stock: number
): Promise<boolean> => {
  const integration = await get(
    `SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`
  );

  if (!integration?.access_token) {
    console.log('[ML Stock] No hay integración configurada');
    return false;
  }

  const headers = {
    'Authorization': `Bearer ${integration.access_token}`,
    'Content-Type': 'application/json'
  };
  const resolvedItemId = await resolveReachableMlItemId(itemId, headers, variationId);
  if (!resolvedItemId) {
    console.warn(`[ML Stock] No se pudo resolver itemId válido desde "${itemId}" (variación ${variationId})`);
    return false;
  }

  // 1) Intentar actualización por subrecurso (algunas cuentas lo aceptan)
  try {
    await withRetry429409(() =>
      axios.put(
        `https://api.mercadolibre.com/items/${resolvedItemId}/variations/${variationId}`,
        { available_quantity: stock },
        { headers }
      )
    );
    console.log(`[ML Stock] Actualizado item ${resolvedItemId} variación ${variationId} a ${stock} unidades`);
    return true;
  } catch (subError: any) {
    const status = subError.response?.status;
    const data = subError.response?.data;
    // Si es 400/404/405, probar método completo (GET + PUT con todas las variaciones)
    if (status === 400 || status === 404 || status === 405 || (status >= 400 && status < 500)) {
      try {
        return await updateMercadoLibreStockByItemUpdate(resolvedItemId, variationId, stock, integration.access_token);
      } catch (fullError: any) {
        console.error('[ML Stock] Error método completo:', fullError.response?.data || fullError.message);
        return false;
      }
    }
    console.error('[ML Stock] Error:', data || subError.message);
    return false;
  }
};

// Fallback: obtener ítem de ML, actualizar solo la variación indicada y enviar PUT con todas las variaciones (requerido por la API).
async function updateMercadoLibreStockByItemUpdate(
  itemId: string,
  variationId: string,
  newStock: number,
  accessToken: string
): Promise<boolean> {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };

  const getRes = await withRetry429409(() => axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers }));
  const item = getRes.data;
  const variations: any[] = item.variations || [];

  if (variations.length === 0) {
    await withRetry429409(() =>
      axios.put(
        `https://api.mercadolibre.com/items/${itemId}`,
        { available_quantity: newStock },
        { headers }
      )
    );
    console.log(`[ML Stock] Actualizado item ${itemId} (sin variaciones) a ${newStock} unidades`);
    return true;
  }

  const variationsPayload = variations.map((v: any) => {
    const isTarget = String(v.id) === String(variationId);
    const qty = isTarget ? newStock : (v.available_quantity ?? 0);
    return { id: v.id, available_quantity: Math.max(0, qty) };
  });

  await withRetry429409(() =>
    axios.put(
      `https://api.mercadolibre.com/items/${itemId}`,
      { variations: variationsPayload },
      { headers }
    )
  );
  console.log(`[ML Stock] Actualizado item ${itemId} variación ${variationId} a ${newStock} unidades (vía PUT item)`);
  return true;
}

/** Obtener el seller_sku actual de una variación (desde attributes o campos directos). */
function getMlVariationSku(v: any): string {
  const skuAttr = Array.isArray(v.attributes) && v.attributes.find((a: any) => (a.id || '').toString().toUpperCase() === 'SELLER_SKU');
  const fromAttr = skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '').toString().trim() : '';
  return fromAttr || (v.seller_sku ?? v.seller_custom_field ?? '').toString().trim() || '';
}

/** Enviar el SKU de tu inventario a Mercado Libre (actualiza seller_sku de la variación). */
export const updateMercadoLibreSku = async (
  itemId: string,
  variationId: string,
  newSku: string
): Promise<boolean> => {
  const integration = await get(
    `SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`
  );
  if (!integration?.access_token) {
    console.log('[ML SKU] No hay integración configurada');
    return false;
  }
  const headers = {
    'Authorization': `Bearer ${integration.access_token}`,
    'Content-Type': 'application/json'
  };
  try {
    const getRes = await withRetry429409(() => axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers }));
    const item = getRes.data;
    const variations: any[] = item.variations || [];
    if (variations.length === 0) {
      await withRetry429409(() =>
        axios.put(`https://api.mercadolibre.com/items/${itemId}`, { seller_custom_field: newSku }, { headers })
      );
      console.log(`[ML SKU] Actualizado ítem ${itemId} seller_custom_field a "${newSku}"`);
      return true;
    }
    const variationsPayload = variations.map((v: any) => {
      const isTarget = String(v.id) === String(variationId);
      const sku = isTarget ? newSku : getMlVariationSku(v);
      return { id: v.id, available_quantity: Math.max(0, v.available_quantity ?? 0), seller_sku: sku || undefined };
    });
    await withRetry429409(() =>
      axios.put(`https://api.mercadolibre.com/items/${itemId}`, { variations: variationsPayload }, { headers })
    );
    console.log(`[ML SKU] Actualizado ítem ${itemId} variación ${variationId} seller_sku a "${newSku}"`);
    return true;
  } catch (e: any) {
    console.error('[ML SKU] Error:', e.response?.data || e.message);
    return false;
  }
};

/** Enviar el SKU de tu inventario a Tienda Nube (actualiza sku de la variante). */
export const updateTiendaNubeSku = async (
  productId: string,
  variantId: string,
  newSku: string
): Promise<boolean> => {
  const integration = await get(
    `SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`
  );
  if (!integration?.access_token || !integration?.store_id) {
    console.log('[TN SKU] No hay integración configurada');
    return false;
  }
  try {
    await tnPutWithRetry(
      axios,
      `https://api.tiendanube.com/v1/${integration.store_id}/products/${productId}/variants/${variantId}`,
      { sku: newSku },
      {
        headers: {
          'Authentication': `bearer ${integration.access_token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'LupoHub (lupohub@example.com)'
        }
      },
      { maxRetries: 4 }
    );
    console.log(`[TN SKU] Actualizado producto ${productId} variante ${variantId} sku a "${newSku}"`);
    return true;
  } catch (e: any) {
    console.error('[TN SKU] Error:', e.response?.data || e.message);
    return false;
  }
};

// Endpoint: Obtener historial de movimientos de stock
export const getStockMovements = async (req: Request, res: Response) => {
  try {
    const { variantId, variantIds, productId, type, from, to, limit = '50' } = req.query;
    
    let whereClause = '1=1';
    const params: any[] = [];

    if (variantId) {
      whereClause += ' AND sm.variant_id = ?';
      params.push(variantId);
    }
    if (variantIds) {
      const ids = String(variantIds)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (ids.length > 0) {
        whereClause += ` AND sm.variant_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }
    if (productId) {
      whereClause += ' AND p.id = ?';
      params.push(productId);
    }

    if (type) {
      whereClause += ' AND sm.movement_type = ?';
      params.push(type);
    }

    if (from) {
      whereClause += ' AND sm.created_at >= ?';
      params.push(from);
    }

    if (to) {
      whereClause += ' AND sm.created_at <= ?';
      params.push(to);
    }

    const limitNum = Math.min(500, Math.max(1, parseInt(limit as string, 10) || 50));
    params.push(limitNum);

    const movements = await query(
      `SELECT
         sm.*,
         pv.sku,
         p.name as product_name,
         o.id as order_id,
         c.business_name as customer_name,
         ua.name as adjust_user_name
       FROM stock_movements sm
       JOIN product_variants pv ON pv.id = sm.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN orders o
         ON sm.movement_type = 'PEDIDO_MAYORISTA'
        AND o.id = TRIM(SUBSTRING_INDEX(sm.reference, ':', -1))
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users ua
         ON sm.movement_type = 'AJUSTE_MANUAL'
        AND ua.id = TRIM(REPLACE(sm.reference, 'Ajuste por usuario', ''))
       WHERE ${whereClause}
       ORDER BY sm.created_at DESC
       LIMIT ?`,
      params
    );

    res.json(movements);
  } catch (error: any) {
    console.error('Error fetching stock movements:', error);
    res.status(500).json({ message: 'Error obteniendo movimientos de stock' });
  }
};

// Endpoint: Forzar sincronización de stock a plataformas externas
export const forceSyncStock = async (req: Request, res: Response) => {
  try {
    const { variantId } = req.params;
    const stockRow = await get(`SELECT stock FROM stocks WHERE variant_id = ?`, [variantId]);
    if (!stockRow) return res.status(404).json({ message: 'Variante no encontrada' });
    await syncStockToExternalPlatforms(variantId, stockRow.stock);
    res.json({ message: 'Sincronización iniciada', variantId, stock: stockRow.stock });
  } catch (error: any) {
    console.error('Error forcing stock sync:', error);
    res.status(500).json({ message: 'Error sincronizando stock' });
  }
};

// Endpoint: Ajuste manual de stock (Admin o Depósito)
export const updateVariantStockEndpoint = async (req: Request, res: Response) => {
  try {
    const { variantId } = req.params;
    const { stock } = req.body;
    const user = (req as any).user;
    const userId = user?.id || 'sistema';
    if (typeof stock !== 'number' || stock < 0) {
      return res.status(400).json({ message: 'stock debe ser un número >= 0' });
    }
    const ok = await updateVariantStock(
      variantId,
      Math.floor(stock),
      'AJUSTE_MANUAL',
      `Ajuste por usuario ${userId}`,
      true
    );
    if (!ok) return res.status(500).json({ message: 'Error actualizando stock' });
    res.json({ variantId, stock: Math.floor(stock) });
  } catch (error: any) {
    console.error('Error updating variant stock:', error);
    res.status(500).json({ message: 'Error actualizando stock' });
  }
};

// Endpoint: Eliminar el snapshot inicial (todos los movimientos SNAPSHOT_INICIAL) para poder crear uno nuevo
export const deleteStockSnapshot = async (req: Request, res: Response) => {
  try {
    const result = await execute(
      `DELETE FROM stock_movements WHERE movement_type = 'SNAPSHOT_INICIAL'`
    );
    const deleted = Number((result as any)?.affectedRows) || 0;
    res.json({
      message: deleted > 0 ? `Snapshot inicial eliminado (${deleted} registros).` : 'No había snapshot inicial para eliminar.',
      deleted
    });
  } catch (error: any) {
    console.error('Error deleting stock snapshot:', error);
    res.status(500).json({ message: 'Error eliminando snapshot', error: error.message });
  }
};

// Endpoint: Crear snapshot inicial de todo el stock actual
export const createStockSnapshot = async (req: Request, res: Response) => {
  try {
    // Verificar si ya existe un snapshot inicial
    const existingSnapshot = await get(
      `SELECT COUNT(*) as count FROM stock_movements WHERE movement_type = 'SNAPSHOT_INICIAL'`
    );

    if (existingSnapshot?.count > 0) {
      return res.status(400).json({ 
        message: 'Ya existe un snapshot inicial. Elimínalo primero si querés crear uno nuevo.',
        existingCount: existingSnapshot.count
      });
    }

    // Obtener todo el stock actual
    const allStock = await query(`
      SELECT 
        s.variant_id,
        s.stock,
        pv.sku,
        p.name as product_name
      FROM stocks s
      JOIN product_variants pv ON pv.id = s.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      WHERE s.stock > 0
    `);

    let created = 0;
    for (const item of allStock) {
      await execute(
        `INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
         VALUES (UUID(), ?, 0, ?, ?, 'SNAPSHOT_INICIAL', ?, NOW())`,
        [item.variant_id, item.stock, item.stock, `Stock inicial: ${item.sku || item.product_name}`]
      );
      created++;
    }

    res.json({ 
      message: 'Snapshot inicial creado',
      variantsProcessed: created
    });
  } catch (error: any) {
    console.error('Error creating stock snapshot:', error);
    res.status(500).json({ message: 'Error creando snapshot', error: error.message });
  }
};

// Endpoint: Importar historial de ventas de TN y ML
export const importSalesHistory = async (req: Request, res: Response) => {
  try {
    const { days = 60 } = req.body;
    const logs: string[] = [];
    let imported = 0;

    // Calcular fecha desde
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);
    const dateFromStr = dateFrom.toISOString().split('T')[0];

    logs.push(`Importando ventas de los últimos ${days} días (desde ${dateFromStr})`);

    // Importar de Tienda Nube
    const tnIntegration = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
    if (tnIntegration?.access_token) {
      try {
        const axios = (await import('axios')).default;
        let page = 1;
        let hasMore = true;

        while (hasMore && page <= 10) {
          const ordersRes = await axios.get(
            `https://api.tiendanube.com/v1/${tnIntegration.store_id}/orders?created_at_min=${dateFromStr}&per_page=50&page=${page}&status=paid`,
            {
              headers: {
                'Authentication': `bearer ${tnIntegration.access_token}`,
                'User-Agent': 'LupoHub (lupohub@example.com)'
              }
            }
          );

          const orders = ordersRes.data || [];
          if (orders.length === 0) {
            hasMore = false;
            break;
          }

          for (const order of orders) {
            // Verificar si ya existe este movimiento
            const exists = await get(
              `SELECT id FROM stock_movements WHERE reference LIKE ? AND movement_type = 'VENTA_TIENDA_NUBE'`,
              [`%TN-${order.id}%`]
            );
            if (exists) continue;

            for (const product of order.products || []) {
              const tnVariantId = product.variant_id;
              const qty = product.quantity || 1;
              const itemSku = (product.sku || product.variant_sku || '').toString().trim();

              let variant = await get(`SELECT pv.id FROM product_variants pv WHERE pv.tienda_nube_variant_id = ?`, [tnVariantId]);
              if (!variant?.id && itemSku) {
                variant = await get(`SELECT pv.id FROM product_variants pv WHERE COALESCE(pv.external_sku, pv.sku) = ? OR pv.sku = ?`, [itemSku, itemSku]);
              }
              if (!variant?.id && itemSku) {
                variant = await get(
                  `SELECT pv.id FROM product_variants pv
                   JOIN product_colors pc ON pc.id = pv.product_color_id
                   JOIN products p ON p.id = pc.product_id
                   WHERE p.sku = ? OR pv.sku LIKE ? OR pv.external_sku = ? LIMIT 1`,
                  [itemSku, `${itemSku}%`, itemSku]
                );
              }

              if (variant?.id) {
                await execute(
                  `INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
                   VALUES (UUID(), ?, 0, 0, ?, 'VENTA_TIENDA_NUBE', ?, ?)`,
                  [variant.id, -qty, `Orden TN-${order.id} (histórico)`, order.created_at]
                );
                imported++;
              }
            }
          }

          page++;
          if (orders.length < 50) hasMore = false;
        }
        logs.push(`✓ Tienda Nube: ${imported} movimientos importados`);
      } catch (e: any) {
        logs.push(`✗ Error Tienda Nube: ${e.message}`);
      }
    }

    // Importar de Mercado Libre
    const mlIntegration = await get(`SELECT access_token, user_id FROM integrations WHERE platform = 'mercadolibre'`);
    if (mlIntegration?.access_token) {
      try {
        const axios = (await import('axios')).default;
        let offset = 0;
        let mlImported = 0;

        while (offset < 500) {
          const ordersRes = await axios.get(
            `https://api.mercadolibre.com/orders/search?seller=${mlIntegration.user_id}&order.status=paid&order.date_created.from=${dateFromStr}T00:00:00.000-03:00&offset=${offset}&limit=50&sort=date_desc`,
            {
              headers: { 'Authorization': `Bearer ${mlIntegration.access_token}` }
            }
          );

          const orders = ordersRes.data.results || [];
          if (orders.length === 0) break;

          for (const order of orders) {
            // Verificar si ya existe
            const exists = await get(
              `SELECT id FROM stock_movements WHERE reference LIKE ? AND movement_type = 'VENTA_MERCADO_LIBRE'`,
              [`%ML-${order.id}%`]
            );
            if (exists) continue;

            for (const item of order.order_items || []) {
              const mlVariationId = item.item?.variation_id;
              const qty = item.quantity || 1;
              const itemSku = (item.item?.sku || item.sku || '').toString().trim();

              let variant = null;
              if (mlVariationId) {
                variant = await get(`SELECT pv.id FROM product_variants pv WHERE pv.mercado_libre_variant_id = ?`, [mlVariationId]);
              }
              if (!variant?.id && itemSku) {
                variant = await get(`SELECT pv.id FROM product_variants pv WHERE COALESCE(pv.external_sku, pv.sku) = ? OR pv.sku = ?`, [itemSku, itemSku]);
              }
              if (!variant?.id && itemSku) {
                variant = await get(
                  `SELECT pv.id FROM product_variants pv
                   JOIN product_colors pc ON pc.id = pv.product_color_id
                   JOIN products p ON p.id = pc.product_id
                   WHERE p.sku = ? OR pv.sku LIKE ? OR pv.external_sku = ? LIMIT 1`,
                  [itemSku, `${itemSku}%`, itemSku]
                );
              }

              if (variant?.id) {
                await execute(
                  `INSERT INTO stock_movements (id, variant_id, previous_stock, new_stock, quantity_change, movement_type, reference, created_at)
                   VALUES (UUID(), ?, 0, 0, ?, 'VENTA_MERCADO_LIBRE', ?, ?)`,
                  [variant.id, -qty, `Orden ML-${order.id} (histórico)`, order.date_created]
                );
                mlImported++;
              }
            }
          }

          offset += 50;
          if (orders.length < 50) break;
        }
        imported += mlImported;
        logs.push(`✓ Mercado Libre: ${mlImported} movimientos importados`);
      } catch (e: any) {
        logs.push(`✗ Error Mercado Libre: ${e.message}`);
      }
    }

    res.json({
      message: 'Importación completada',
      totalImported: imported,
      logs
    });
  } catch (error: any) {
    console.error('Error importing sales history:', error);
    res.status(500).json({ message: 'Error importando historial', error: error.message });
  }
};

/** Normaliza código/SKU para búsqueda: quitar guiones, barras y espacios. */
function normalizeCodigo(s: string): string {
  return String(s ?? '')
    .trim()
    .replace(/[-/\s]/g, '')
    .toUpperCase();
}

/** Código de artículo a 7 dígitos con ceros adelante (ej. 52302 → 0052302). */
function padArticleCodeTo7(s: string): string {
  const digits = String(s ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length <= 7 ? digits.padStart(7, '0') : digits;
}

/**
 * Variantes de SKU solo-numérico para cruzar con `products.sku`:
 * el import suele forzar 7 dígitos (22684 → 0022684) pero el catálogo puede tener 022684, 22684, etc.
 */
function articleSkuCandidates(raw: string): string[] {
  const t = String(raw ?? '').trim();
  if (!t) return [];
  const out: string[] = [];
  const add = (x: string) => {
    const s = String(x ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  };
  add(t);
  if (/^\d+$/.test(t)) {
    const digits = t;
    const noLead = digits.replace(/^0+/, '') || '0';
    add(digits);
    add(noLead);
    add(padArticleCodeTo7(digits));
    add(padArticleCodeTo7(noLead));
    for (let w = Math.max(4, noLead.length); w <= 7; w++) {
      add(noLead.padStart(w, '0'));
    }
  } else {
    const digits = t.replace(/\D/g, '');
    if (digits) {
      const p = padArticleCodeTo7(digits);
      if (p) add(p);
    }
  }
  return out;
}

/** Escapa % y _ para uso en LIKE. */
function escapeLike(s: string): string {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Candidatos de color para matchear `colors.code` / nombre (Excel 4 dígitos vs catálogo 3, ceros a la izquierda, etc.). */
function colorLookupCandidates(colorRaw: string): string[] {
  const s = String(colorRaw ?? '').trim();
  if (!s) return [];
  const out: string[] = [];
  const add = (x: string) => {
    const t = String(x ?? '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  add(s);
  const normImp = normalizeColorCodeForImportValue(s);
  if (normImp) add(normImp);
  const digits = digitsOnlyColorCode(s);
  if (digits) {
    add(digits);
    const stripped = digits.replace(/^0+/, '') || '0';
    if (stripped !== digits) add(stripped);
    const canD = canonicalNumericColorCode(digits);
    if (canD) add(canD);
    const canS = canonicalNumericColorCode(stripped);
    if (canS) add(canS);
  }
  return out;
}

/** Resuelve variant_id por código de producto (base SKU), código de color y código de talle. Prueba exacto, normalizado y "empieza con". */
async function getVariantIdByCodigoColorSize(
  codigo: string,
  colorCode: string,
  sizeCode: string
): Promise<string | null> {
  const codigoTrim = (codigo ?? '').toString().trim();
  const sizeStr = (sizeCode ?? '').toString().trim();
  if (!codigoTrim || !sizeStr) return null;
  const colorCandidates = colorLookupCandidates((colorCode ?? '').toString().trim());
  if (!colorCandidates.length) return null;
  const skuList = articleSkuCandidates(codigoTrim);
  if (!skuList.length) return null;

  const colorMatchSql = `(TRIM(CAST(c.code AS CHAR)) = TRIM(?) OR LOWER(TRIM(COALESCE(c.name, ''))) = LOWER(TRIM(?)))`;

  const tryWhere = async (
    skuWhereSql: string,
    skuParams: unknown[],
    opts?: { limitOne?: boolean }
  ): Promise<string | null> => {
    const lim = opts?.limitOne ? ' LIMIT 1' : '';
    for (const colorTry of colorCandidates) {
      const row = await get(
        `SELECT pv.id AS variant_id
         FROM products p
         JOIN product_colors pc ON pc.product_id = p.id
         JOIN colors c ON c.id = pc.color_id
         JOIN product_variants pv ON pv.product_color_id = pc.id
         JOIN sizes s ON s.id = pv.size_id
         WHERE ${skuWhereSql} AND ${colorMatchSql} AND s.size_code = ?${lim}`,
        [...skuParams, colorTry, colorTry, sizeStr]
      );
      if (row?.variant_id) return row.variant_id;
    }
    return null;
  };

  for (const skuTry of skuList) {
    const id = await tryWhere('p.sku = ?', [skuTry]);
    if (id) return id;
  }

  const normSet = new Set<string>();
  for (const skuTry of skuList) {
    const n = normalizeCodigo(skuTry);
    if (n) normSet.add(n);
  }
  for (const norm of normSet) {
    const id = await tryWhere(
      `REPLACE(REPLACE(REPLACE(p.sku, '-', ''), '/', ''), CHAR(32), '') = ?`,
      [norm]
    );
    if (id) return id;
  }
  for (const norm of normSet) {
    const pattern = escapeLike(norm) + '%';
    const id = await tryWhere(
      `REPLACE(REPLACE(REPLACE(p.sku, '-', ''), '/', ''), CHAR(32), '') LIKE ?`,
      [pattern],
      { limitOne: true }
    );
    if (id) return id;
  }
  return null;
}

const EXCEL_SIZE_COLUMNS = ['P', 'M', 'G', 'GG', 'U', 'XG', 'XXG', 'XXXG'];

function sizeCandidatesFromGridKey(gridKey: string): string[] {
  const raw = String(gridKey ?? '').trim();
  if (!raw) return [];
  const u = raw.toUpperCase().replace(/\s+/g, ' ');
  const out = new Set<string>();
  const add = (x: string) => {
    const t = String(x).trim();
    if (t) out.add(t);
  };
  add(raw);
  add(u);
  const dash = u.match(/^(\d{2,4})\s*[-–]\s*(.+)$/);
  if (dash) {
    add(dash[1]);
    add(codigoTalleParaSku(dash[1]));
    add(dash[2].trim());
    add(codigoTalleParaSku(dash[2].trim()));
  }
  add(codigoTalleParaSku(u));
  add(codigoTalleParaSku(raw));
  /** Códigos Tango 130–180 en planilla vs `sizes.size_code` en letra (U, XG, …). */
  const letterFromTango = TALLE_CODIGO_A_NOMBRE[u] || TALLE_CODIGO_A_NOMBRE[raw.trim()];
  if (letterFromTango) add(letterFromTango);
  return [...out];
}

export async function resolveVariantIdForGridCell(
  codigo: string,
  colorStr: string,
  gridSizeKey: string
): Promise<string | null> {
  for (const sc of sizeCandidatesFromGridKey(gridSizeKey)) {
    const id = await getVariantIdByCodigoColorSize(codigo, colorStr, sc);
    if (id) return id;
  }
  return null;
}

const GRID_RESERVED_KEYS = new Set(
  [
    'codigo',
    'código',
    'color',
    'col',
    'descripcion',
    'descripción',
    'modelo',
    'precio',
    'total',
    'subtotal',
    'importe',
    'sku',
    'articulo',
    'artículo',
    'nombre',
    'producto',
    'stock',
    'deposito',
    'depósito',
    'categoria',
    'categoría',
    'proveedor',
    'cod',
    'notas',
    'obs',
    'observaciones',
    'marca',
    'cantidad',
  ].map((k) => k.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
);

function isGridReservedKey(key: string): boolean {
  const k = key
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!k) return true;
  if (GRID_RESERVED_KEYS.has(k)) return true;
  if (k.startsWith('_')) return true;
  return false;
}

function parseStockValue(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' && !Number.isNaN(v)) return Math.max(0, Math.floor(v));
  const s = String(v).trim().toUpperCase();
  if (s === 'X' || s === '-' || s === 'N/A') return 0;
  const n = parseFloat(s.replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isNaN(n) ? 0 : Math.max(0, Math.floor(n));
}

export const importStockFromExcel = async (req: Request, res: Response) => {
  try {
    const { rows: rawRows } = req.body as { rows?: Array<Record<string, unknown>> };
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({
        message: 'Se requiere un array "rows" con las filas del Excel (columnas CODIGO, COLOR y tallas P, M, G, etc.).'
      });
    }

    const notFound: string[] = [];
    const errors: string[] = [];
    let updated = 0;

    for (const row of rawRows) {
      const codigo = (row.codigo ?? row.CODIGO ?? row.Codigo ?? '').toString().trim();
      const colorRaw = row.color ?? row.COLOR ?? row.Color;
      const colorStr = colorRaw != null ? String(colorRaw).trim() : '';
      if (!codigo || !colorStr) continue;

      for (const sizeCode of EXCEL_SIZE_COLUMNS) {
        const rawVal = row[sizeCode] ?? row[sizeCode.toLowerCase()];
        const stock = parseStockValue(rawVal);
        const variantId = await getVariantIdByCodigoColorSize(codigo, colorStr, sizeCode);
        if (!variantId) {
          const key = `${codigo}-${colorStr}-${sizeCode}`;
          if (!notFound.includes(key)) notFound.push(key);
          continue;
        }
        const ok = await updateVariantStock(
          variantId,
          stock,
          'IMPORTACION_EXCEL',
          'Importación Excel',
          true
        );
        if (ok) updated++;
        else errors.push(`Error actualizando ${codigo} color ${colorStr} talle ${sizeCode}`);
      }
    }

    res.json({
      message: 'Importación de stock completada',
      updated,
      notFound: notFound.slice(0, 200),
      notFoundCount: notFound.length,
      errors: errors.length > 0 ? errors.slice(0, 50) : undefined
    });
  } catch (error: any) {
    console.error('Error importing stock from Excel:', error);
    res.status(500).json({ message: 'Error importando stock desde Excel', error: error.message });
  }
};

/**
 * Planilla tipo inventario Lupo (CODIGO + COLOR + columnas de talles: P, 10, 130 - P, etc.):
 * actualiza stock del depósito y vincula ítems al despacho indicado.
 */
export const importStockGridToDespacho = async (req: Request, res: Response) => {
  try {
    const { despachoId, rows: rawRows, updateDepotStock = true } = req.body as {
      despachoId?: string;
      rows?: Array<Record<string, unknown>>;
      updateDepotStock?: boolean;
    };
    const despId = despachoId != null ? String(despachoId).trim() : '';
    if (!despId) {
      return res.status(400).json({ message: 'despachoId es requerido' });
    }
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({
        message: 'Se requiere un array "rows" (planilla CODIGO + COLOR + columnas de talles).',
      });
    }

    const despacho = await get(
      `SELECT id, pais_origen, numero_despacho FROM despachos WHERE id = ?`,
      [despId]
    );
    if (!despacho?.id) {
      return res.status(400).json({ message: 'Despacho no encontrado' });
    }

    const pais =
      despacho.pais_origen && String(despacho.pais_origen).trim()
        ? String(despacho.pais_origen).trim()
        : 'Brasil';
    const ref = `Despacho ${(despacho as any).numero_despacho || despacho.id}`;

    let updatedStock = 0;
    let despachoItemsInserted = 0;
    let despachoItemsUpdated = 0;
    const notFound: string[] = [];
    const errors: string[] = [];
    const taggedProducts = new Set<string>();
    const doStock = updateDepotStock !== false;

    for (const row of rawRows) {
      const codigoRaw = (
        row.codigo ??
        row.CODIGO ??
        row.Codigo ??
        row.articulo ??
        row.ARTICULO ??
        row.MODELO ??
        row.modelo ??
        ''
      )
        .toString()
        .trim();
      const colorRaw =
        row.color ?? row.COLOR ?? row.Color ?? row['CODIGO COLOR'] ?? row['COD. COLOR'];
      const colorStr = colorRaw != null ? String(colorRaw).trim() : '';
      const codigo = padArticleCodeTo7(codigoRaw) || codigoRaw;
      if (!codigo || !colorStr) continue;

      for (const [gridKey, val] of Object.entries(row)) {
        if (isGridReservedKey(gridKey)) continue;
        const qty = parseStockValue(val);
        const variantId = await resolveVariantIdForGridCell(codigo, colorStr, gridKey);
        if (!variantId) {
          const key = `${codigo}-${colorStr}-${gridKey}`;
          if (!notFound.includes(key)) notFound.push(key);
          continue;
        }

        const productRow = await get(
          `SELECT pc.product_id AS product_id, p.name AS name, pv.sku AS sku
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           WHERE pv.id = ?`,
          [variantId]
        );
        const productId = (productRow as any)?.product_id as string;
        if (!productId) {
          errors.push(`Sin producto para variante ${variantId}`);
          continue;
        }
        const prodName = String((productRow as any)?.name ?? '').trim();
        const varSku = String((productRow as any)?.sku ?? '').trim();
        const descripcionItem = `${prodName || codigo} - ${varSku || gridKey}`.trim();

        if (doStock) {
          const ok = await updateVariantStock(
            variantId,
            qty,
            'IMPORTACION_DESPACHO_GRID',
            ref,
            true
          );
          if (ok) updatedStock++;
          else errors.push(`Stock ${codigo} ${gridKey}`);
        }

        if (qty > 0) {
          const di = await get(
            `SELECT id FROM despacho_items WHERE despacho_id = ? AND variant_id = ? LIMIT 1`,
            [despacho.id, variantId]
          );
          if (di?.id) {
            await execute(
              `UPDATE despacho_items SET cantidad = ?, product_id = ?, descripcion_item = ? WHERE id = ?`,
              [qty, productId, descripcionItem, di.id]
            );
            despachoItemsUpdated++;
          } else {
            await execute(
              `INSERT INTO despacho_items (id, despacho_id, product_id, variant_id, cantidad, costo_unitario, descripcion_item) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
              [uuidv4(), despacho.id, productId, variantId, qty, descripcionItem]
            );
            despachoItemsInserted++;
          }
        }

        await execute(`UPDATE products SET ultimo_despacho_id = ?, pais_origen = ? WHERE id = ?`, [
          despacho.id,
          pais,
          productId,
        ]);
        taggedProducts.add(productId);
      }
    }

    res.json({
      message: 'Importación de planilla al despacho completada',
      updatedStock,
      despachoItemsInserted,
      despachoItemsUpdated,
      productsTagged: taggedProducts.size,
      notFound: notFound.slice(0, 200),
      notFoundCount: notFound.length,
      errors: errors.length > 0 ? errors.slice(0, 50) : undefined,
    });
  } catch (error: any) {
    console.error('importStockGridToDespacho:', error);
    res.status(500).json({ message: 'Error importando planilla al despacho', error: error.message });
  }
};
