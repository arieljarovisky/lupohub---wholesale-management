/**
 * Extrae el ID numérico de producto de Tienda Nube desde texto plano o URL de la tienda.
 * Los slugs suelen ser `123456789-nombre` o `nombre-123456789` en el path `/productos/...`.
 */

export function normalizeTiendaNubeProductId(raw: unknown): string {
  let s = (raw ?? '').toString().trim();
  if (!s) return '';
  try {
    s = decodeURIComponent(s);
  } catch {
    /* ignore */
  }
  s = s.replace(/\s+/g, '');

  if (/^\d{2,15}$/.test(s)) return s;

  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const q = u.searchParams;
      const fromQuery =
        q.get('product_id') ||
        q.get('productId') ||
        q.get('id') ||
        q.get('product');
      if (fromQuery) {
        const t = fromQuery.trim();
        if (/^\d{2,15}$/.test(t)) return t;
      }

      const path = u.pathname || '';
      for (const re of [/\/productos\/([^/?#]+)/i, /\/producto\/([^/?#]+)/i]) {
        const m = path.match(re);
        if (!m?.[1]) continue;
        const seg = decodeURIComponent(m[1]);
        const lead = seg.match(/^(\d{2,15})(?:-|\.|$)/);
        if (lead) return lead[1];
        const trail = seg.match(/(?:^|-)(\d{2,15})(?:$|[^0-9])/);
        if (trail) return trail[1];
        const pEnd = seg.match(/-p-(\d{2,15})$/i);
        if (pEnd) return pEnd[1];
      }
    } catch {
      /* ignore */
    }
  }

  if (!/^https?:\/\//i.test(s)) {
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 2 && digits.length <= 15 && /^\d+$/.test(digits)) {
      return digits;
    }
  }

  return s;
}

/** Variante preseleccionada en la URL (?variant= o ?variant_id=). */
export function extractTiendaNubeVariantFromUrl(raw: unknown): string | undefined {
  const s = (raw ?? '').toString().trim();
  if (!/^https?:\/\//i.test(s)) return undefined;
  try {
    const u = new URL(s);
    const v =
      u.searchParams.get('variant') ||
      u.searchParams.get('variant_id') ||
      u.searchParams.get('variantId');
    if (v) {
      const t = v.trim();
      if (/^\d+$/.test(t)) return t;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}
