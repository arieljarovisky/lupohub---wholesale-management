/**
 * Misma lógica que en backend (integrations.controller) para tolerar MLAU / MLA / MLU
 * y búsquedas por número solo.
 */

export function normalizeMercadoLibreItemId(raw: unknown): string {
  let s = (raw ?? '').toString().trim();
  if (!s) return '';
  try {
    s = decodeURIComponent(s);
  } catch {
    /* ignore */
  }
  s = s.replace(/\s+/g, '');

  if (/^https?:\/\//i.test(s)) {
    const catalog = s.match(/\/p\/(ML[A-Z]{0,5}-?\d+)/i);
    if (catalog?.[1]) {
      s = catalog[1];
    } else {
      const m = s.match(/\/(ML[A-Z]{0,5}-?\d+)(?:[/?#]|$)/i);
      if (m?.[1]) s = m[1];
    }
  }

  s = s.toUpperCase();
  const mDash = s.match(/^(ML[A-Z]{0,5})-(\d+)$/);
  if (mDash) s = `${mDash[1]}${mDash[2]}`;
  const legacy = s.match(/^ML-(\d+)$/);
  if (legacy) s = `MLA${legacy[1]}`;

  return s;
}

export function mercadoLibreItemIdCandidates(raw: unknown): string[] {
  const base = normalizeMercadoLibreItemId(raw);
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

/** ID de variación en query (?variation_id= en publicaciones con variaciones). */
export function extractMercadoLibreVariationIdFromUrl(raw: unknown): string | undefined {
  const s = (raw ?? '').toString().trim();
  if (!/^https?:\/\//i.test(s)) return undefined;
  try {
    const u = new URL(s);
    const v =
      u.searchParams.get('variation_id') ||
      u.searchParams.get('variationId') ||
      u.searchParams.get('variation');
    if (v) {
      const t = v.trim();
      if (/^\d+$/.test(t)) return t;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/** True si el texto buscado y el id de ítem se refieren al mismo listing (MLAU vs MLA, etc.). */
export function mercadoLibreItemIdsMatch(searchRaw: string, itemId: string): boolean {
  const a = normalizeMercadoLibreItemId(searchRaw);
  const b = normalizeMercadoLibreItemId(itemId);
  if (!a || !b) return false;
  const setA = new Set(mercadoLibreItemIdCandidates(a).map((x) => x.toLowerCase()));
  const setB = new Set(mercadoLibreItemIdCandidates(b).map((x) => x.toLowerCase()));
  for (const x of setA) {
    if (setB.has(x)) return true;
  }
  return false;
}
