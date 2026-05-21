import { Product } from '../types';
import { SIZE_ORDER } from './inventoryUtils';

/** Cantidad de colores distintos por pack surtido (ej. pack x3). */
export const DEFAULT_PACK_COLOR_COUNT = 3;

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

export function colorAbbrevLabel(colors: string[]): string {
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
 * Sugiere packs multicolor x3 surtidos por artículo y talle (mejores tríos según stock).
 */
export function suggestPublicationPacks(
  products: Product[],
  opts?: {
    minColors?: number;
    minStockPerColor?: number;
    maxSuggestions?: number;
    query?: string;
    baseSku?: string;
    packSize?: number;
  }
): SuggestedPublicationPack[] {
  const packSize = Math.max(2, opts?.packSize ?? DEFAULT_PACK_COLOR_COUNT);
  const minColors = Math.max(packSize, opts?.minColors ?? packSize);
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

    const colorOpts: ArticlePackColorOption[] = colors.map((r) => ({
      variantId: r.variantId,
      color: r.color,
      size: r.size,
      stock: r.stock
    }));

    const combosX3 = suggestPackCombosOfSize(colorOpts, { packSize, maxCombos: 6 });
    const packVariants: SuggestedPackVariant[] = combosX3.map((combo) => ({
      label: combo.label,
      items: packItemsFromColorOptions(colorOpts, combo.variantIds),
      availablePacks: combo.availablePacks
    }));

    if (!packVariants.length) continue;

    const productName = colors[0]?.productName || baseSku;
    const best = packVariants[0];
    const title = `${productName} · Talle ${size}`;
    const subtitle = `Pack x${packSize} surtido · ${packVariants.length} combo(s) · mejor: ${best.availablePacks} pack(s)`;

    if (q) {
      const hay = `${title} ${subtitle} ${baseSku} ${packVariants.map((v) => v.label).join(' ')} ${colors.map((c) => c.color).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    out.push({
      id: `${baseSku}|${size}|x${packSize}`,
      title,
      subtitle,
      baseSku,
      size,
      colorCount: packSize,
      packVariants,
      score: best.availablePacks * 100 + packVariants.length
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, maxSuggestions);
}

export function suggestAllPublicationPacks(
  products: Product[],
  opts?: { query?: string; baseSku?: string; packSize?: number }
): SuggestedPublicationPack[] {
  return suggestPublicationPacks(products, {
    query: opts?.query,
    baseSku: opts?.baseSku,
    packSize: opts?.packSize ?? DEFAULT_PACK_COLOR_COUNT
  });
}

export type ArticlePackColorOption = {
  variantId: string;
  color: string;
  size: string;
  stock: number;
};

export type PackComboSuggestion = {
  label: string;
  colorNames: string[];
  variantIds: string[];
  /** Cuántos packs x3 se pueden vender (mínimo de stock entre los 3 colores). */
  availablePacks: number;
  minStock: number;
  score: number;
};

export type ArticlePackSizeGroup = {
  size: string;
  colors: ArticlePackColorOption[];
  packLabel: string;
  /** Pack con todos los colores con stock (referencia). */
  availablePacks: number;
  /** Mejores combinaciones de exactamente 3 colores surtidos. */
  suggestedCombosX3: PackComboSuggestion[];
  /** Mejor combo x3 del talle (máximo stock disponible). */
  bestComboX3: PackComboSuggestion | null;
};

function combinationsOfSize<T>(items: T[], k: number): T[][] {
  if (k <= 0 || items.length < k) return [];
  if (k === 1) return items.map((x) => [x]);
  const out: T[][] = [];
  const walk = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i <= items.length - (k - acc.length); i++) {
      acc.push(items[i]);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

/**
 * Mejores packs de N colores surtidos según stock: prioriza más packs vendibles (min stock del trio).
 */
export function suggestPackCombosOfSize(
  colors: ArticlePackColorOption[],
  opts?: { packSize?: number; maxCombos?: number; minStockPerColor?: number }
): PackComboSuggestion[] {
  const packSize = Math.max(2, opts?.packSize ?? DEFAULT_PACK_COLOR_COUNT);
  const maxCombos = opts?.maxCombos ?? 8;
  const minStock = Math.max(0, opts?.minStockPerColor ?? 1);

  const eligible = colors.filter((c) => c.stock >= minStock);
  if (eligible.length < packSize) return [];

  const combos: PackComboSuggestion[] = [];
  for (const trio of combinationsOfSize(eligible, packSize)) {
    const stocks = trio.map((c) => c.stock);
    const minS = Math.min(...stocks);
    if (minS < 1) continue;
    const colorNames = trio.map((c) => c.color);
    const totalStock = stocks.reduce((a, b) => a + b, 0);
    combos.push({
      label: colorAbbrevLabel(colorNames),
      colorNames,
      variantIds: trio.map((c) => c.variantId),
      availablePacks: minS,
      minStock: minS,
      score: minS * 10_000 + totalStock
    });
  }

  combos.sort((a, b) => b.score - a.score);

  const picked: PackComboSuggestion[] = [];
  for (const c of combos) {
    if (picked.length >= maxCombos) break;
    const tooSimilar = picked.some((p) => {
      const shared = p.variantIds.filter((id) => c.variantIds.includes(id)).length;
      return shared >= packSize - 1;
    });
    if (!tooSimilar) picked.push(c);
  }
  return picked;
}

export type ArticlePackMatrix = {
  baseSku: string;
  productName: string;
  sizeGroups: ArticlePackSizeGroup[];
};

function compareSizeCodes(a: string, b: string): number {
  const ca = a.trim().toUpperCase();
  const cb = b.trim().toUpperCase();
  const ia = SIZE_ORDER.indexOf(ca);
  const ib = SIZE_ORDER.indexOf(cb);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  const na = parseInt(ca, 10);
  const nb = parseInt(cb, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return ca.localeCompare(cb, 'es');
}

/** Matriz artículo → talles → colores (para elegir colores y armar combinaciones de pack). */
export function buildArticlePackMatrix(
  products: Product[],
  baseSku: string,
  opts?: { query?: string; minStock?: number }
): ArticlePackMatrix | null {
  const key = baseSku.trim();
  if (!key) return null;
  const q = (opts?.query || '').trim().toLowerCase();
  const minStock = Math.max(0, opts?.minStock ?? 1);

  const rows: VariantRow[] = [];
  for (const p of products) {
    if (productGroupKey(p) !== key) continue;
    const stock = Number(p.stock) || 0;
    const color = (p.color || '').trim() || 'Sin color';
    const size = (p.size || '').trim() || 'U';
    if (q) {
      const hay = `${color} ${size} ${p.name || ''} ${p.sku || ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push({
      variantId: p.id,
      baseSku: key,
      productName: (p.name || '').trim(),
      color,
      size,
      stock,
      label: variantLabel(p, key)
    });
  }

  if (!rows.length) return null;

  const bySize = new Map<string, Map<string, VariantRow>>();
  for (const r of rows) {
    let byColor = bySize.get(r.size);
    if (!byColor) {
      byColor = new Map();
      bySize.set(r.size, byColor);
    }
    const ck = r.color.toLowerCase();
    const prev = byColor.get(ck);
    if (!prev || r.stock > prev.stock) byColor.set(ck, r);
  }

  const sizeGroups: ArticlePackSizeGroup[] = [];
  for (const [size, byColor] of bySize) {
    const colors = [...byColor.values()]
      .sort((a, b) => a.color.localeCompare(b.color, 'es'))
      .map((r) => ({
        variantId: r.variantId,
        color: r.color,
        size: r.size,
        stock: r.stock
      }));
    const withStock = colors.filter((c) => c.stock >= minStock);
    const items: SuggestedPackItem[] = withStock.map((c) => ({
      variantId: c.variantId,
      unitsPerSale: 1,
      label: '',
      color: c.color,
      size: c.size,
      stock: c.stock
    }));
    const suggestedCombosX3 = suggestPackCombosOfSize(withStock, {
      packSize: DEFAULT_PACK_COLOR_COUNT,
      maxCombos: 8,
      minStockPerColor: minStock
    });

    sizeGroups.push({
      size,
      colors,
      packLabel: colorAbbrevLabel(withStock.map((c) => c.color)),
      availablePacks: computeAvailablePacks(items),
      suggestedCombosX3,
      bestComboX3: suggestedCombosX3[0] ?? null
    });
  }

  sizeGroups.sort((a, b) => compareSizeCodes(a.size, b.size));

  return {
    baseSku: key,
    productName: rows[0]?.productName || key,
    sizeGroups
  };
}

export function packItemsFromColorOptions(
  colors: ArticlePackColorOption[],
  variantIds: string[]
): SuggestedPackItem[] {
  const pick = new Set(variantIds);
  return colors
    .filter((c) => pick.has(c.variantId))
    .map((c) => ({
      variantId: c.variantId,
      unitsPerSale: 1,
      label: `${c.color} · ${c.size} (stock ${c.stock})`,
      color: c.color,
      size: c.size,
      stock: c.stock
    }));
}
