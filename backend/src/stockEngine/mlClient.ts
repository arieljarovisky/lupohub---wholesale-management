/** Cliente mínimo de Mercado Libre para el motor de stock (token siempre vigente, reintentos 429/409). */
import axios from 'axios';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Token válido (se refresca si está por vencer). Import dinámico para no crear ciclos de módulos. */
export async function getMlAccessToken(): Promise<{ access_token: string; user_id: string } | null> {
  const { getValidMLToken } = await import('../controllers/integrations.controller');
  return getValidMLToken();
}

export async function withMlRetry<T>(fn: () => Promise<T>, retries = 5): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const status = e?.response?.status;
      const network = e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNABORTED';
      if (attempt < retries && (status === 429 || status === 409 || status >= 500 || network)) {
        await sleep(status === 429 ? Math.min(15000, 2000 * (attempt + 1)) : 1200 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

export function mlNormalizeItemId(raw: unknown): string {
  let s = (raw ?? '').toString().trim();
  if (!s) return '';
  try {
    s = decodeURIComponent(s);
  } catch {
    /* ignore */
  }
  s = s.replace(/\s+/g, '').toUpperCase();
  if (/^HTTPS?:\/\//i.test(s)) {
    const m = s.match(/\/(ML[A-Z]{0,5}-?\d+)(?:[/?#]|$)/i);
    if (m?.[1]) s = m[1].toUpperCase();
  }
  const mDash = s.match(/^(ML[A-Z]{0,5})-(\d+)$/);
  if (mDash) s = `${mDash[1]}${mDash[2]}`;
  const legacy = s.match(/^ML-(\d+)$/);
  if (legacy) s = `MLA${legacy[1]}`;
  return s;
}

export function mlItemIdCandidates(raw: unknown): string[] {
  const base = mlNormalizeItemId(raw);
  if (!base) return [];
  if (/^\d+$/.test(base)) {
    return ['MLA', 'MLU', 'MLB', 'MLM', 'MCO', 'MLC', 'MPE', 'MEC', 'MLV'].map((site) => `${site}${base}`);
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

/** Para IDs "user product" (MLAU…): busca los ítems reales del vendedor que lo usan. */
async function userProductItemCandidates(raw: string, headers: Record<string, string>, sellerId: string): Promise<string[]> {
  const up = mlNormalizeItemId(raw);
  if (!/^MLAU\d+$/i.test(up) || !sellerId) return [];
  const ids = new Set<string>();
  for (const status of ['active', 'paused']) {
    const res = await axios.get(`https://api.mercadolibre.com/users/${encodeURIComponent(sellerId)}/items/search`, {
      headers,
      params: { user_product_id: up, status, limit: 100 },
      validateStatus: () => true,
    });
    if (res.status >= 400) continue;
    for (const id of Array.isArray(res.data?.results) ? res.data.results : []) {
      if (id) ids.add(String(id));
    }
  }
  return Array.from(ids);
}

export type MlItemFetch =
  | { ok: true; itemId: string; item: any }
  | { ok: false; status: number; message: string };

/**
 * Trae el ítem de ML probando variantes del ID (MLA/MLAU, etc.).
 * Si se pasa `expectedVariationId`, prefiere el ítem que tenga esa variación.
 */
export async function fetchMlItem(
  rawItemId: string,
  token: { access_token: string; user_id: string },
  expectedVariationId?: string
): Promise<MlItemFetch> {
  const headers = { Authorization: `Bearer ${token.access_token}` };
  let lastStatus = 404;
  let lastMsg = 'La publicación no existe en Mercado Libre';
  let fallback: { itemId: string; item: any } | null = null;

  const tryList = async (candidates: string[]): Promise<{ itemId: string; item: any } | null> => {
    for (const c of candidates) {
      const r = await withMlRetry(() =>
        axios.get(`https://api.mercadolibre.com/items/${encodeURIComponent(c)}?include_attributes=all`, {
          headers,
          validateStatus: (s) => s < 500 && s !== 429,
        })
      );
      if (r.status !== 200 || !r.data || r.data.error) {
        lastStatus = r.status;
        lastMsg = r.data?.message || lastMsg;
        continue;
      }
      const variations: any[] = Array.isArray(r.data.variations) ? r.data.variations : [];
      if (
        expectedVariationId &&
        variations.length > 0 &&
        !variations.some((v) => String(v?.id) === String(expectedVariationId))
      ) {
        fallback = fallback ?? { itemId: c, item: r.data };
        continue;
      }
      return { itemId: c, item: r.data };
    }
    return null;
  };

  const direct = await tryList(mlItemIdCandidates(rawItemId));
  if (direct) return { ok: true, ...direct };
  const fromUp = await tryList(await userProductItemCandidates(rawItemId, headers, String(token.user_id || '')));
  if (fromUp) return { ok: true, ...fromUp };
  if (fallback) return { ok: true, ...(fallback as { itemId: string; item: any }) };
  return { ok: false, status: lastStatus, message: lastMsg };
}

export function mlErrorMessage(e: any): string {
  const d = e?.response?.data;
  const cause = Array.isArray(d?.cause) && d.cause.length ? d.cause.map((c: any) => c?.message || c?.code).filter(Boolean).join('; ') : '';
  return [d?.message || e?.message || 'Error desconocido', cause].filter(Boolean).join(' — ').slice(0, 500);
}
