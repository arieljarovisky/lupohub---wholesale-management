import { Product } from '../types';

export type SuggestedPackItem = {
  variantId: string;
  unitsPerSale: number;
  label: string;
  color: string;
  size: string;
  stock: number;
};

export type SuggestedPackVariant = {
  label: string;
  items: SuggestedPackItem[];
  /** Packs completos posibles (mínimo de stock / unidades). */
  availablePacks: number;
};

export type SuggestedPublicationPack = {
  id: string;
  title: string;
  subtitle: string;
  baseSku: string;
  size: string;
  colorCount: number;
  packVariants: SuggestedPackVariant[];
  score: number;
};

type VariantRow = {
  variantId: string;
  baseSku: string;
  productName: string;
  color: string;
  size: string;
  stock: number;
  label: string;
};

export function productGroupKey(p: Product): string {
  const base = (p.base_sku || '').trim();
  if (base) return base;
  const pid = (p.product_id || '').trim();
  if (pid) return pid;
  const sku = (p.sku || '').trim();
  if (!sku) return p.id;
  const parts = sku.split('-');
  if (parts.length >= 3) return parts.slice(0, -2).join('-');
  return sku.replace(/-[^-]+-[^-]+$/i, '').trim() || sku;
}

function variantLabel(p: Product, baseSku: string): string {
  const base = baseSku || p.base_sku || p.sku || '';
  return `${base} · ${p.color || '—'} · ${p.size || '—'} (stock ${p.stock ?? 0})`;
}

function colorAbbrevLabel(colors: string[]): string {
  const names = colors.map((c) => c.trim()).filter(Boolean);
  if (names.length === 0) return 'Pack';
  if (names.length === 1) return names[0];
  const shorts = names.map((n) => {
    const w = n.split(/\s+/).filter(Boolean);
    if (w.length >= 2) return w.map((x) => x[0]?.toUpperCase() || '').join('');
    return n.length <= 4 ? n.toUpperCase() : n.slice(0, 3).toUpperCase();
  });
  if (shorts.every((s) => s.length <= 3)) return shorts.join('');
  return names.join(' / ');
}

function computeAvailablePacks(items: SuggestedPackItem[]): number {
  if (!items.length) return 0;
  let min = Infinity;
  for (const it of items) {
    const u = Math.max(1, it.unitsPerSale);
    const packs = Math.floor((it.stock || 0) / u);
    min = Math.min(min, packs);
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0;
}

/**
 * Sugiere packs multicolor por artículo y talle: 1 unidad de cada color con stock.
 */
export function suggestPublicationPacks(
  products: Product[],
  opts?: {
    minColors?: number;
    minStockPerColor?: number;
    maxSuggestions?: number;
    query?: string;
    baseSku?: string;
  }
): SuggestedPublicationPack[] {
  const minColors = Math.max(2, opts?.minColors ?? 2);
  const minStock = Math.max(0, opts?.minStockPerColor ?? 1);
  const maxSuggestions = opts?.maxSuggestions ?? 24;
  const q = (opts?.query || '').trim().toLowerCase();
  const onlyBase = (opts?.baseSku || '').trim();

  const rows: VariantRow[] = [];
  for (const p of products) {
    const baseSku = productGroupKey(p);
    if (onlyBase && baseSku !== onlyBase) continue;
    const stock = Number(p.stock) || 0;
    if (stock < minStock) continue;
    const color = (p.color || '').trim() || 'Sin color';
    const size = (p.size || '').trim() || 'U';
    rows.push({
      variantId: p.id,
      baseSku,
      productName: (p.name || '').trim(),
      color,
      size,
      stock,
      label: variantLabel(p, baseSku)
    });
  }

  const byArticleSize = new Map<string, VariantRow[]>();
  for (const r of rows) {
    const key = `${r.baseSku}\0${r.size}`;
    const list = byArticleSize.get(key) || [];
    list.push(r);
    byArticleSize.set(key, list);
  }

  const out: SuggestedPublicationPack[] = [];

  for (const [key, list] of byArticleSize) {
    const [baseSku, size] = key.split('\0');
    const byColor = new Map<string, VariantRow>();
    for (const r of list) {
      const ck = r.color.toLowerCase();
      const prev = byColor.get(ck);
      if (!prev || r.stock > prev.stock) byColor.set(ck, r);
    }
    const colors = [...byColor.values()];
    if (colors.length < minColors) continue;

    const items: SuggestedPackItem[] = colors.map((r) => ({
      variantId: r.variantId,
      unitsPerSale: 1,
      label: r.label,
      color: r.color,
      size: r.size,
      stock: r.stock
    }));
    const label = colorAbbrevLabel(colors.map((c) => c.color));
    const availablePacks = computeAvailablePacks(items);
    if (availablePacks < 1) continue;

    const productName = colors[0]?.productName || baseSku;
    const title = `${productName} · Talle ${size}`;
    const subtitle = `${colors.length} colores · hasta ${availablePacks} pack(s)`;

    if (q) {
      const hay = `${title} ${subtitle} ${baseSku} ${label} ${colors.map((c) => c.color).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    out.push({
      id: `${baseSku}|${size}|${label}`,
      title,
      subtitle,
      baseSku,
      size,
      colorCount: colors.length,
      packVariants: [{ label, items, availablePacks }],
      score: availablePacks * colors.length
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, maxSuggestions);
}

/** Variantes de pack con distintas combinaciones de colores (subconjuntos de 3). */
export function suggestMultiComboPublicationPacks(
  products: Product[],
  opts?: { minColors?: number; maxCombos?: number; query?: string; baseSku?: string }
): SuggestedPublicationPack[] {
  const base = suggestPublicationPacks(products, {
    minColors: Math.max(3, opts?.minColors ?? 3),
    maxSuggestions: 12,
    query: opts?.query,
    baseSku: opts?.baseSku
  });
  const maxCombos = opts?.maxCombos ?? 3;
  const multi: SuggestedPublicationPack[] = [];

  for (const pack of base) {
    const pv = pack.packVariants[0];
    if (!pv || pv.items.length < 3) continue;
    const sorted = [...pv.items].sort((a, b) => b.stock - a.stock);
    const combos: SuggestedPackItem[][] = [];
    if (sorted.length >= 3) combos.push(sorted.slice(0, 3));
    if (sorted.length >= 4) combos.push([sorted[0], sorted[1], sorted[3]]);
    if (sorted.length >= 5) combos.push([sorted[0], sorted[2], sorted[4]]);

    const packVariants: SuggestedPackVariant[] = combos.slice(0, maxCombos).map((items) => {
      const label = colorAbbrevLabel(items.map((i) => i.color));
      return { label, items, availablePacks: computeAvailablePacks(items) };
    }).filter((v) => v.availablePacks > 0);

    if (packVariants.length >= 2) {
      multi.push({
        ...pack,
        id: `${pack.id}|multi`,
        title: `${pack.title} (varias combinaciones)`,
        subtitle: `${packVariants.length} combos de colores`,
        packVariants,
        score: pack.score + packVariants.length * 10
      });
    }
  }

  return multi;
}

export function suggestAllPublicationPacks(
  products: Product[],
  opts?: { query?: string; includeMultiCombo?: boolean; baseSku?: string }
): SuggestedPublicationPack[] {
  const simple = suggestPublicationPacks(products, { query: opts?.query, baseSku: opts?.baseSku });
  if (opts?.includeMultiCombo === false) return simple;
  const multi = suggestMultiComboPublicationPacks(products, {
    query: opts?.query,
    baseSku: opts?.baseSku
  });
  const seen = new Set(simple.map((s) => s.id));
  const merged = [...simple];
  for (const m of multi) {
    if (!seen.has(m.id)) merged.push(m);
  }
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, 30);
}
