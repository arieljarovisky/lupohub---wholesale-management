/**
 * Consulta a Mercado Libre: ¿esta cancelación ya puede reponer stock?
 * La reposición espera a que la devolución figure entregada en el domicilio del vendedor.
 */
import axios from 'axios';
import { getMlAccessToken, withMlRetry } from './mlClient';
import {
  MlCancelStockDecision,
  ReturnView,
  decideMlCancelStock,
  mapReturnPayload,
  orderLooksFulfilled,
  outboundBackAtSeller,
  outboundLeftWarehouse,
} from './mlReturnPolicy';

const s = (v: unknown) => (v == null ? '' : String(v).trim());

async function mlGet(path: string, token: string, params?: Record<string, string | number>): Promise<{ status: number; data: any } | null> {
  try {
    const r = await withMlRetry(() =>
      axios.get(`https://api.mercadolibre.com${path}`, {
        headers: { Authorization: `Bearer ${token}`, 'x-format-new': 'true' },
        params,
        timeout: 20000,
        validateStatus: (st) => st < 500 && st !== 429,
      })
    );
    return { status: r.status, data: r.data };
  } catch (e: any) {
    console.warn(`[ML Return] ${path}: ${e?.message || e}`);
    return null;
  }
}

export async function fetchMlShipment(shipmentId: string, token: string): Promise<any | null | 'error'> {
  const direct = await mlGet(`/shipments/${encodeURIComponent(shipmentId)}`, token);
  if (!direct) return 'error';
  if (direct.status === 200) return direct.data;
  if (direct.status === 404 || direct.status === 403) {
    const alt = await mlGet(`/marketplace/shipments/${encodeURIComponent(shipmentId)}`, token);
    if (!alt) return 'error';
    if (alt.status === 200) return alt.data;
    if (direct.status === 404 && alt.status === 404) return null;
  }
  return 'error';
}

function claimRows(data: any): any[] {
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

async function returnsForClaims(claims: any[], token: string): Promise<ReturnView[] | null> {
  const out: ReturnView[] = [];
  for (const claim of claims) {
    const id = s(claim?.id);
    if (!id) continue;
    const r = await mlGet(`/post-purchase/v2/claims/${encodeURIComponent(id)}/returns`, token);
    if (!r) return null;
    if (r.status === 404) continue;
    if (r.status !== 200) return null;
    const payloads = Array.isArray(r.data) ? r.data : [r.data];
    for (const payload of payloads) {
      if (payload && typeof payload === 'object') out.push(mapReturnPayload(payload));
    }
  }
  return out;
}

async function searchClaims(token: string, params: Record<string, string | number>): Promise<any[] | null> {
  const r = await mlGet('/post-purchase/v1/claims/search', token, { ...params, limit: 20 });
  if (!r) return null;
  if (r.status === 404) return [];
  if (r.status !== 200) {
    console.warn(`[ML Return] claims/search respondió ${r.status} (${JSON.stringify(params)})`);
    return null;
  }
  return claimRows(r.data);
}

/** null en `returns` = no se pudo consultar. Si el envío no salió, no hace falta la API de devoluciones. */
export async function lookupMlCancelStock(order: any): Promise<MlCancelStockDecision> {
  const token = await getMlAccessToken();
  if (!token) return { action: 'await_return', because: 'unknown' };

  const shipmentId = s(order?.shipping?.id);
  let outbound: any = null;
  if (shipmentId) {
    const sh = await fetchMlShipment(shipmentId, token.access_token);
    if (sh === 'error') return { action: 'await_return', because: 'unknown' };
    outbound = sh;
  }

  const left = outboundLeftWarehouse(outbound) || (!shipmentId && orderLooksFulfilled(order));
  if (!left) return { action: 'revert_now', because: 'never_left' };
  if (outboundBackAtSeller(outbound)) return { action: 'revert_now', because: 'back_to_sender' };

  const orderId = s(order?.id);
  const packId = s(order?.pack_id);
  let claims = orderId ? await searchClaims(token.access_token, { order_id: orderId }) : [];
  if (claims && packId) {
    const packClaims = await searchClaims(token.access_token, { pack_id: packId });
    if (packClaims == null) return { action: 'await_return', because: 'unknown' };
    const seen = new Set(claims.map((c) => s(c?.id)));
    for (const c of packClaims) {
      const id = s(c?.id);
      if (id && !seen.has(id)) claims.push(c);
    }
  }
  if (claims == null) return { action: 'await_return', because: 'unknown' };

  const returns = await returnsForClaims(claims, token.access_token);
  return decideMlCancelStock({
    outbound: outbound || (left ? { status: 'delivered' } : null),
    returns,
  });
}

export function orderIdsFromShipment(shipment: any): string[] {
  const ids = new Set<string>();
  const one = s(shipment?.order_id);
  if (one) ids.add(one);
  for (const o of Array.isArray(shipment?.orders) ? shipment.orders : []) {
    const id = s(o?.id);
    if (id) ids.add(id);
  }
  return [...ids];
}

export async function orderIdsForClaim(claimId: string): Promise<string[]> {
  const token = await getMlAccessToken();
  if (!token) return [];
  const r = await mlGet(`/post-purchase/v1/claims/${encodeURIComponent(claimId)}`, token.access_token);
  if (!r || r.status !== 200) return [];
  const claim = r.data || {};
  const resource = s(claim.resource).toLowerCase();
  const resourceId = s(claim.resource_id);
  if (!resourceId) return [];
  if (resource === 'order') return [resourceId];
  if (resource === 'shipment') {
    const sh = await fetchMlShipment(resourceId, token.access_token);
    if (!sh || sh === 'error') return [];
    return orderIdsFromShipment(sh);
  }
  if (resource === 'purchase' || resource === 'pack') {
    const pack = await mlGet(`/packs/${encodeURIComponent(resourceId)}`, token.access_token);
    if (!pack || pack.status !== 200) return [];
    return (Array.isArray(pack.data?.orders) ? pack.data.orders : []).map((o: any) => s(o?.id)).filter(Boolean);
  }
  return [];
}

export async function orderIdsForShipment(shipmentId: string): Promise<string[]> {
  const token = await getMlAccessToken();
  if (!token) return [];
  const sh = await fetchMlShipment(shipmentId, token.access_token);
  if (!sh || sh === 'error') return [];
  const status = String(sh.status || '').toLowerCase();
  const sub = String(sh.substatus || '').toLowerCase();
  const relevant = status === 'delivered' || status === 'not_delivered' || status === 'cancelled' || sub.includes('return');
  if (!relevant) return [];
  return orderIdsFromShipment(sh);
}
