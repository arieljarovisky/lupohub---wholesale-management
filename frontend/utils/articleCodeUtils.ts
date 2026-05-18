import { padArticleCodeTo7 } from './inventoryUtils';

function digitCore(s: string): string {
  const d = String(s ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.replace(/^0+/, '') || '0';
}

function mergeGroupKeys(sku: string): string[] {
  const out = new Set<string>();
  const dc = digitCore(sku);
  if (dc.length >= 4) out.add(`d:${dc}`);
  if (dc.length >= 6) {
    const pre = dc.slice(0, -2);
    if (pre.length >= 4) out.add(`dpre:${pre}`);
  }
  const c = String(sku ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]/g, '');
  if (c.length >= 4) out.add(`c:${c}`);
  return [...out];
}

/** Mismo artículo aunque el SKU del registro difiera (0127501 vs 1275-11 / 1275111). */
export function articleCodesMatch(a: string, b: string): boolean {
  const ta = (a || '').trim();
  const tb = (b || '').trim();
  if (!ta || !tb) return false;
  if (padArticleCodeTo7(ta) === padArticleCodeTo7(tb)) return true;
  const ka = mergeGroupKeys(ta);
  const kb = mergeGroupKeys(tb);
  if (ka.some((k) => kb.includes(k))) return true;
  const da = digitCore(ta);
  const db = digitCore(tb);
  if (da.length >= 4 && db.length >= 4 && (da.includes(db) || db.includes(da))) return true;
  return false;
}

/** Código visible del grupo: el que eligió el usuario, no el SKU interno del producto duplicado. */
export function resolveDisplayArticleCode(requestedCode: string): string {
  const req = (requestedCode || '').trim();
  if (!req) return '';
  return padArticleCodeTo7(req);
}
