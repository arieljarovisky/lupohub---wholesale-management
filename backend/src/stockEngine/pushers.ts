/**
 * Envío de stock a Tienda Nube y Mercado Libre.
 * Cada función devuelve un resultado explícito (nunca "falla en silencio").
 */
import axios from 'axios';
import { get } from '../database/db';
import { tnGetWithRetry, tnPutWithRetry } from '../utils/tiendanubeClient';
import { buildTnStockUpdateBody, readTnVariantStock } from '../utils/tnVariantStock';
import {
  enrichMlItemVariationsForMatch,
  matchMlVariationForVariantLink,
  mlVariationSkuFromApi,
  skusCompatible,
} from '../utils/mlVariationMatch';
import { fetchMlItem, getMlAccessToken, mlErrorMessage, mlNormalizeItemId, withMlRetry } from './mlClient';

export type PushResult =
  | {
      ok: true;
      skipped?: string;
      /** La variación guardada ya no existía y se encontró la correcta por código exacto: hay que actualizar el vínculo. */
      healedVariationId?: string;
    }
  | { ok: false; error: string; permanent?: boolean };

const ML_UNDER_REVIEW = 'Publicación en revisión en Mercado Libre: no deja cambiar el stock hasta que la liberen';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';

export async function pushTiendaNube(productId: string, variantId: string, qty: number): Promise<PushResult> {
  const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
  const storeId = integration?.store_id || integration?.user_id;
  if (!integration?.access_token || !storeId) {
    return { ok: false, error: 'Tienda Nube no está conectada. Conectala en Configuración.' };
  }
  const units = Math.max(0, Math.floor(Number(qty) || 0));
  const url = `https://api.tiendanube.com/v1/${storeId}/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`;
  const headers = {
    Authentication: `bearer ${integration.access_token}`,
    'Content-Type': 'application/json',
    'User-Agent': TN_USER_AGENT,
  };

  try {
    const got = await tnGetWithRetry<any>(axios, url, { headers, validateStatus: () => true });
    if (got.status === 404) {
      return { ok: false, permanent: true, error: 'Esa variante ya no existe en Tienda Nube (se borró o cambió). Revisá el vínculo.' };
    }
    if (got.status === 401 || got.status === 403) {
      return { ok: false, error: 'Tienda Nube rechazó el acceso. Volvé a conectar Tienda Nube en Configuración.' };
    }
    if (got.status !== 200) {
      return { ok: false, error: `Tienda Nube respondió ${got.status}` };
    }
    const before = readTnVariantStock(got.data);
    if (before === units) return { ok: true };

    const body = buildTnStockUpdateBody(units, got.data);
    try {
      await tnPutWithRetry(axios, url, body, { headers }, { maxRetries: 4 });
    } catch (e) {
      if (!body.inventory_levels) throw e;
      await tnPutWithRetry(axios, url, { stock: units }, { headers }, { maxRetries: 2 });
    }

    const check = await tnGetWithRetry<any>(axios, url, { headers, validateStatus: () => true });
    if (check.status === 200) {
      const shown = readTnVariantStock(check.data);
      if (shown != null && shown !== units) {
        return { ok: false, error: `Se envió ${units} pero Tienda Nube muestra ${shown}` };
      }
    }
    return { ok: true };
  } catch (e: any) {
    const status = e?.response?.status;
    if (status === 404) {
      return { ok: false, permanent: true, error: 'Esa variante ya no existe en Tienda Nube. Revisá el vínculo.' };
    }
    const msg = e?.response?.data?.description || e?.response?.data?.message || e?.message || 'Error desconocido';
    return { ok: false, error: `Tienda Nube: ${String(msg).slice(0, 300)}` };
  }
}

export type MlMatchHints = { sku?: string | null; color?: string | null; size?: string | null };

function mlUserProductId(item: any, variation: any | null): string {
  const fromVar = variation?.user_product_id;
  if (fromVar != null && String(fromVar).trim()) return String(fromVar).trim();
  const fromItem = item?.user_product_id;
  if (fromItem != null && String(fromItem).trim()) return String(fromItem).trim();
  return '';
}

/** Lo que muestra la publicación ahora (variación, si hay). Null si no se pudo leer. */
async function readMlAvailableQty(itemId: string, variationId: string | null, token: string): Promise<number | null> {
  const headers = { Authorization: `Bearer ${token}` };
  try {
    if (variationId) {
      const one = await withMlRetry(() =>
        axios.get(
          `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}/variations/${encodeURIComponent(variationId)}`,
          { headers, validateStatus: (s) => s < 500 && s !== 429 }
        )
      );
      if (one.status === 200 && one.data?.available_quantity != null && one.data.available_quantity !== '') {
        return Number(one.data.available_quantity);
      }
    }
    const item = await withMlRetry(() =>
      axios.get(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`, {
        headers,
        validateStatus: (s) => s < 500 && s !== 429,
      })
    );
    if (item.status !== 200) return null;
    if (!variationId) {
      return item.data?.available_quantity != null ? Number(item.data.available_quantity) : null;
    }
    const found = (Array.isArray(item.data?.variations) ? item.data.variations : []).find(
      (v: any) => String(v?.id) === String(variationId)
    );
    return found?.available_quantity != null && found.available_quantity !== '' ? Number(found.available_quantity) : null;
  } catch {
    return null;
  }
}

/** Modelo nuevo de Mercado Libre: el stock se cambia en el user product, no en la publicación. */
async function putMlUserProductStock(userProductId: string, units: number, token: string): Promise<boolean> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const url = `https://api.mercadolibre.com/user-products/${encodeURIComponent(userProductId)}/stock`;
  try {
    const got = await axios.get(url, { headers, validateStatus: () => true });
    if (got.status !== 200) return false;
    const version = got.headers?.['x-version'] ?? got.headers?.['X-Version'];
    if (version == null || String(version).trim() === '') return false;
    const put = await axios.put(
      `${url}/type/selling_address`,
      { quantity: units },
      { headers: { ...headers, 'x-version': String(version) }, validateStatus: () => true }
    );
    return put.status >= 200 && put.status < 300;
  } catch {
    return false;
  }
}

/**
 * PUT del ítem con TODAS las variaciones. Si falta el stock de alguna, se lee antes:
 * mandar 0 por no saberlo borraría el stock de los otros talles.
 */
async function putMlItemVariations(
  itemId: string,
  variationId: string,
  units: number,
  token: string,
  known: any[]
): Promise<boolean> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const payload: Array<{ id: string | number; available_quantity: number }> = [];
  for (const v of known) {
    if (v?.id == null) continue;
    const isTarget = String(v.id) === String(variationId);
    let qty = v.available_quantity;
    if (!isTarget && (qty == null || qty === '')) {
      const one = await axios.get(
        `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}/variations/${encodeURIComponent(String(v.id))}`,
        { headers, validateStatus: () => true }
      );
      if (one.status !== 200 || one.data?.available_quantity == null || one.data.available_quantity === '') return false;
      qty = one.data.available_quantity;
    }
    payload.push({
      id: v.id,
      available_quantity: isTarget ? units : Math.max(0, Math.floor(Number(qty) || 0)),
    });
  }
  if (!payload.some((p) => String(p.id) === String(variationId))) return false;
  await withMlRetry(() =>
    axios.put(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`, { variations: payload }, { headers })
  );
  return true;
}

/**
 * Un envío a la vez por publicación de ML. Si no, dos talles del mismo ítem se mandaban en paralelo y el
 * PUT del ítem completo (con todas las variaciones) volvía a poner el número viejo del otro talle.
 */
const mlItemLocks = new Map<string, Promise<unknown>>();

function withMlItemLock<T>(itemId: string, fn: () => Promise<T>): Promise<T> {
  const key = mlNormalizeItemId(itemId) || String(itemId || '').trim().toUpperCase();
  const prev = mlItemLocks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  mlItemLocks.set(key, tail);
  void tail.then(() => {
    if (mlItemLocks.get(key) === tail) mlItemLocks.delete(key);
  });
  return run;
}

export function pushMercadoLibre(
  rawItemId: string,
  variationId: string | null,
  qty: number,
  hints: MlMatchHints = {}
): Promise<PushResult> {
  return withMlItemLock(rawItemId, () => pushMercadoLibreUnlocked(rawItemId, variationId, qty, hints));
}

async function pushMercadoLibreUnlocked(
  rawItemId: string,
  variationId: string | null,
  qty: number,
  hints: MlMatchHints
): Promise<PushResult> {
  const token = await getMlAccessToken();
  if (!token) return { ok: false, error: 'Mercado Libre no está conectado o venció el acceso. Conectalo en Configuración.' };
  const units = Math.max(0, Math.floor(Number(qty) || 0));
  const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' };

  try {
    const fetched = await fetchMlItem(rawItemId, token, variationId || undefined);
    if (!fetched.ok) {
      if (fetched.status === 401 || fetched.status === 403) {
        return { ok: false, error: 'Mercado Libre rechazó el acceso. Volvé a conectar Mercado Libre.' };
      }
      return { ok: false, permanent: fetched.status === 404, error: `Publicación ${rawItemId}: ${fetched.message}` };
    }
    const { itemId } = fetched;
    let item = fetched.item;

    if (item.status === 'closed') {
      return { ok: true, skipped: 'Publicación finalizada en Mercado Libre' };
    }
    if (item.status === 'under_review' || item.status === 'inactive') {
      return { ok: true, skipped: ML_UNDER_REVIEW };
    }
    if (item.shipping?.logistic_type === 'fulfillment') {
      return { ok: true, skipped: 'Publicación en FULL: el stock lo maneja Mercado Libre' };
    }

    let variations: any[] = Array.isArray(item.variations) ? item.variations : [];

    if (variations.length === 0) {
      if (Number(item.available_quantity) === units) return { ok: true };
      await withMlRetry(() =>
        axios.put(`https://api.mercadolibre.com/items/${itemId}`, { available_quantity: units }, { headers })
      );
      const upId = mlUserProductId(item, null);
      await new Promise((r) => setTimeout(r, 400));
      let shown = await readMlAvailableQty(itemId, null, token.access_token);
      if (shown !== units && upId) {
        await putMlUserProductStock(upId, units, token.access_token);
        shown = await readMlAvailableQty(itemId, null, token.access_token);
      }
      if (shown != null && shown !== units) {
        return { ok: false, error: `Se envió ${units} pero Mercado Libre muestra ${shown}` };
      }
      return { ok: true };
    }

    let target: any = null;
    if (variationId) target = variations.find((v) => String(v?.id) === String(variationId)) ?? null;
    if (!target && variations.length === 1 && !variationId) target = variations[0];
    if (!target) {
      item = await enrichMlItemVariationsForMatch(item, token.access_token, (url, cfg) =>
        withMlRetry(() => axios.get(url, cfg))
      );
      variations = Array.isArray(item.variations) ? item.variations : [];
      target = matchMlVariationForVariantLink(variations, {
        variationId: variationId || undefined,
        sku: hints.sku ?? undefined,
        color: hints.color ?? undefined,
        size: hints.size ?? undefined,
      });
    }
    if (!target?.id) {
      return {
        ok: false,
        permanent: true,
        error: `No encuentro la variación en la publicación ${itemId}${variationId ? ` (variación ${variationId} ya no está)` : ''}. Revisá el vínculo.`,
      };
    }
    // La variación guardada desapareció pero encontramos la correcta con el MISMO código: se corrige el vínculo solo.
    let healedVariationId: string | undefined;
    if (variationId && String(target.id) !== String(variationId)) {
      const remoteSku = mlVariationSkuFromApi(target).trim();
      if (hints.sku && remoteSku && skusCompatible(String(hints.sku), remoteSku)) healedVariationId = String(target.id);
    }
    if (Number(target.available_quantity) === units) return { ok: true, healedVariationId };

    const upId = mlUserProductId(item, target);
    let wroteVariation = false;
    try {
      await withMlRetry(() =>
        axios.put(
          `https://api.mercadolibre.com/items/${itemId}/variations/${target.id}`,
          { available_quantity: units },
          { headers }
        )
      );
      wroteVariation = true;
    } catch (subErr: any) {
      const status = subErr?.response?.status;
      if (!(status >= 400 && status < 500)) throw subErr;
      // Muchas cuentas ignoran el PUT de una sola variación y exigen el ítem completo.
      const fresh = await withMlRetry(() => axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers }));
      const all: any[] = Array.isArray(fresh.data?.variations) ? fresh.data.variations : variations;
      if (!all.some((v) => String(v.id) === String(target.id))) throw subErr;
      wroteVariation = await putMlItemVariations(itemId, String(target.id), units, token.access_token, all);
      if (!wroteVariation && !upId) throw subErr;
    }

    // Mercado Libre a veces responde OK y el número nuevo aparece un instante después.
    await new Promise((r) => setTimeout(r, 400));
    let shown = await readMlAvailableQty(itemId, String(target.id), token.access_token);
    if (shown !== units) {
      if (!wroteVariation || shown != null) {
        const fresh = await withMlRetry(() => axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers })).catch(() => null);
        const all: any[] = Array.isArray(fresh?.data?.variations) ? fresh.data.variations : variations;
        if (all.some((v) => String(v.id) === String(target.id))) {
          await putMlItemVariations(itemId, String(target.id), units, token.access_token, all).catch(() => false);
        }
      }
      if (upId) await putMlUserProductStock(upId, units, token.access_token);
      shown = await readMlAvailableQty(itemId, String(target.id), token.access_token);
    }
    if (shown != null && shown !== units) {
      return { ok: false, error: `Se envió ${units} pero Mercado Libre muestra ${shown}` };
    }
    return { ok: true, healedVariationId };
  } catch (e: any) {
    const status = e?.response?.status;
    if (/under_review/i.test(mlErrorMessage(e))) return { ok: true, skipped: ML_UNDER_REVIEW };
    if (status === 401 || status === 403) {
      return { ok: false, error: `Mercado Libre rechazó el cambio: ${mlErrorMessage(e)}` };
    }
    return { ok: false, error: `Mercado Libre: ${mlErrorMessage(e)}` };
  }
}
