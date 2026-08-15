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
  /** Solo SKUs cortos/variantes Tango (6 dígitos). Dos artículos de 7 dígitos (ej. 457504 vs 457588) no deben fusionarse. */
  if (dc.length === 6) {
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

function normalizeColorCode(code: string): string {
  const t = String(code ?? '').trim();
  if (!t) return '';
  if (/^\d+$/.test(t)) return t.replace(/^0+/, '') || '0';
  return t;
}

/** Clave estable para agrupar variantes por color (evita fusionar colores con color_code vacío). */
export function variantColorKey(colorCode: string, colorName: string): string {
  const code = normalizeColorCode(String(colorCode ?? '').trim());
  if (code) return `c:${code}`;
  const name = String(colorName ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return `n:${name}`;
}

function isNumericArticleCode(s: string): boolean {
  const t = String(s ?? '').trim();
  if (!t || /[A-Za-z]/.test(t)) return false;
  return t.replace(/\D/g, '').length >= 4;
}

/** Mismo artículo aunque el SKU del registro difiera (0127501 vs 127501). Códigos de 7 dígitos distintos no se fusionan (457504 ≠ 457588). */
export function articleCodesMatch(a: string, b: string): boolean {
  const ta = (a || '').trim();
  const tb = (b || '').trim();
  if (!ta || !tb) return false;
  const normAlpha = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/[A-Za-z]/.test(ta) || /[A-Za-z]/.test(tb)) {
    return normAlpha(ta) === normAlpha(tb);
  }

  const pa = padArticleCodeTo7(ta);
  const pb = padArticleCodeTo7(tb);
  if (pa === pb) return true;

  if (isNumericArticleCode(ta) && isNumericArticleCode(tb) && pa.length === 7 && pb.length === 7) {
    return false;
  }

  const ka = mergeGroupKeys(ta);
  const kb = mergeGroupKeys(tb);
  if (ka.some((k) => kb.includes(k))) return true;

  const da = digitCore(ta);
  const db = digitCore(tb);
  if (da.length >= 4 && db.length >= 4 && da.length < 7 && db.length < 7 && (da.includes(db) || db.includes(da))) {
    return true;
  }
  return false;
}

/** SKU de variante (base-color-talle): devuelve solo el prefijo de artículo. */
function articlePrefixFromSku(sku: string): string {
  const parts = sku.split('-').filter(Boolean);
  if (parts.length >= 3) return parts.slice(0, -2).join('-');
  return sku;
}

/**
 * Código visible del artículo: conserva letras (ej. U4045, AB1234).
 * Solo rellena con ceros a la izquierda si el código es exclusivamente numérico.
 */
export function resolveDisplayArticleCode(requestedCode: string): string {
  const req = (requestedCode || '').trim();
  if (!req) return '';
  if (/[A-Za-z]/.test(req)) {
    return articlePrefixFromSku(req);
  }
  const digits = req.replace(/\D/g, '');
  if (!digits) return req;
  // SKU concatenado artículo+talle+color: solo el artículo (ej. 4090001140997 → 4090001).
  if (!req.includes('-') && digits.length >= 11 && digits.length <= 17) {
    const art = digits.slice(0, -6);
    return art.length <= 7 ? art.padStart(7, '0') : art;
  }
  return digits.length <= 7 ? digits.padStart(7, '0') : digits;
}

/**
 * Código de artículo para filas de pedido: siempre preferir el SKU del producto padre.
 * Evita interpretar SKUs de variante corruptos (ej. 1275-11170112 → 1275111).
 */
export function articleCodeForOrderRow(parentProductSku: string | undefined, variantSku?: string): string {
  const parent = String(parentProductSku ?? '').trim();
  if (parent) {
    const parts = parent.split('-').filter(Boolean);
    if (parts.length >= 3) return parts.slice(0, -2).join('-');
    return resolveDisplayArticleCode(parent);
  }
  const sku = String(variantSku ?? '').trim();
  if (!sku) return '';
  const parts = sku.split('-').filter(Boolean);
  if (parts.length >= 3) return parts.slice(0, -2).join('-');
  const digits = sku.replace(/\D/g, '');
  // Variante Tango mal parseada (1275-11170112): no usar los primeros 7 dígitos.
  if (parts.length === 2 && digits.length > 9) return '';
  // Concatenado artículo+talle+color (ej. 4090001140997 → 4090001).
  if (!sku.includes('-') && digits.length >= 11 && digits.length <= 17 && /^\d+$/.test(sku.replace(/\s/g, ''))) {
    const art = digits.slice(0, -6);
    return art.length <= 7 ? art.padStart(7, '0') : art;
  }
  if (digits.length >= 7 && digits.length <= 9) return digits.slice(0, 7);
  return resolveDisplayArticleCode(sku);
}

/** Variantes de código para reintentar búsqueda en API (0127501, 127501, etc.). */
export function skuLookupCandidates(sku: string): string[] {
  const t = String(sku ?? '').trim();
  const out = new Set<string>();
  if (t) {
    out.add(t);
    const base = t.split('-')[0];
    if (base && base !== t) out.add(base);
  }
  const digits = String(t).replace(/\D/g, '');
  const looksNumericOnly = digits.length > 0 && !/[A-Za-z]/.test(t);
  if (digits && looksNumericOnly) {
    out.add(digits);
    const stripped = digits.replace(/^0+/, '') || '0';
    out.add(stripped);
    if (digits.length <= 7) out.add(digits.padStart(7, '0'));
    if (stripped.length <= 7) out.add(stripped.padStart(7, '0'));
  }
  return [...out];
}
