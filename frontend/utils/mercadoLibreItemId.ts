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

export type VariantExternalIds = {
  tiendaNube?: string | number | null;
  tiendaNubeVariant?: string | number | null;
  mercadoLibre?: string | number | null;
  mercadoLibreVariant?: string | number | null;
  mercadoLibreItemId?: string | number | null;
};

/** Vinculación real de la variante (no solo el ID padre del producto en ML). */
export function isVariantLinkedToMercadoLibre(externalIds?: VariantExternalIds | null): boolean {
  if (!externalIds) return false;
  const vVar = externalIds.mercadoLibreVariant != null && String(externalIds.mercadoLibreVariant).trim() !== '';
  const vItem = externalIds.mercadoLibreItemId != null && String(externalIds.mercadoLibreItemId).trim() !== '';
  return vVar || vItem;
}

export function isVariantLinkedToTiendaNube(externalIds?: VariantExternalIds | null): boolean {
  if (!externalIds) return false;
  return externalIds.tiendaNubeVariant != null && String(externalIds.tiendaNubeVariant).trim() !== '';
}

export type ChannelStockDisplay = { text: string; className: string; title: string };

/** Texto del stock publicado en Mercado Libre o Tienda Nube, en lenguaje claro. */
export function getChannelStockDisplay(channelName: string, linked: boolean, stock: number | undefined): ChannelStockDisplay {
  if (!linked) {
    return {
      text: 'Sin publicación',
      className: 'text-amber-400/90',
      title: `${channelName}: este talle y color no está publicado. Tocá el enlace para conectarlo.`,
    };
  }
  if (stock === undefined) {
    return {
      text: 'No se pudo leer',
      className: 'text-slate-300',
      title: `${channelName}: está publicado, pero no pudimos leer cuánto hay. Volvé a emparejar el talle y el color.`,
    };
  }
  if (stock <= 0) {
    return {
      text: 'Agotado',
      className: 'text-red-400/90 font-medium',
      title: `${channelName}: la publicación figura sin stock.`,
    };
  }
  return {
    text: String(stock),
    className: 'text-white font-semibold tabular-nums',
    title: `${channelName}: hay ${stock} en la publicación.`,
  };
}

/**
 * Aclara, debajo de los números, por qué el depósito y las tiendas no dicen lo mismo
 * o por qué falta un dato.
 */
export function getPublicationStockHint(input: {
  depot: number;
  mlLinked: boolean;
  tnLinked: boolean;
  mlStock?: number;
  tnStock?: number;
}): string | null {
  const { depot, mlLinked, tnLinked, mlStock, tnStock } = input;
  if (!mlLinked && !tnLinked) {
    return 'Este talle y color no está publicado en ninguna tienda.';
  }

  const notes: string[] = [];
  const mlUnknown = mlLinked && mlStock === undefined;
  const tnUnknown = tnLinked && tnStock === undefined;
  if (mlUnknown && tnUnknown) {
    notes.push('Está publicado, pero no pudimos leer cuánto hay. Volvé a emparejar el talle y el color.');
  } else {
    if (!mlLinked) notes.push('Falta publicarlo en Mercado Libre.');
    if (!tnLinked) notes.push('Falta publicarlo en Tienda Nube.');
    if (mlUnknown) notes.push('No pudimos leer el stock de Mercado Libre.');
    if (tnUnknown) notes.push('No pudimos leer el stock de Tienda Nube.');
  }

  const published = [mlLinked ? mlStock : undefined, tnLinked ? tnStock : undefined].filter(
    (n): n is number => n !== undefined
  );
  if (published.length > 0 && published.some((n) => n !== depot)) {
    notes.push('Puede no coincidir con el depósito si la tienda vende de a varias unidades.');
  }

  return notes.length > 0 ? notes.join(' ') : null;
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
