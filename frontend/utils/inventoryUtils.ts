/**
 * Utilidades puras para el módulo de Inventario.
 * Funciones y constantes extraídas de Inventory.tsx para reducir tamaño y facilitar tests.
 */
import * as XLSX from 'xlsx';
import { Product } from '../types';
import { nombreTalleDesdeCodigo, codigoTalleParaSku } from './tallesTango';

export const INVENTORY_STORAGE_KEY = 'lupo_inventory';

export const CONCURRENT_VARIANT_REQUESTS = 4;

/** Orden de talles para filtros y modales (evitar duplicados P / 130 - P). */
export const SIZE_ORDER = ['P', 'M', 'G', 'GG', 'U', 'XG', 'XXG', 'XXXG', 'S', 'L', 'XL', 'XXL', 'XXXL', 'XS'];
export const SIZE_ORDER_MODAL = ['P', 'M', 'G', 'GG', 'U', 'XG', 'XXG', 'XXXG', 'S', 'L', 'XL', 'XXL', 'XXXL', 'XS'];

export interface StoredInventoryState {
  search: string;
  page: number;
  subView: 'mine' | 'ml' | 'tn';
  hideZeroStock?: boolean;
  showHiddenVariants?: boolean;
  filterSize?: string;
  filterCategory?: string;
  filterColor?: string;
}

export function isVariantInventoryHidden(product: { inventoryHidden?: boolean }): boolean {
  return product.inventoryHidden === true;
}

export function getStoredInventoryState(): StoredInventoryState {
  try {
    const raw = sessionStorage.getItem(INVENTORY_STORAGE_KEY);
    if (!raw) return { search: '', page: 1, subView: 'mine', hideZeroStock: false };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const page = typeof parsed.page === 'number' && parsed.page >= 1 ? parsed.page : 1;
    const subView = parsed.subView === 'ml' || parsed.subView === 'tn' ? parsed.subView : 'mine';
    const hideZeroStock = parsed.hideZeroStock === true;
    const showHiddenVariants = parsed.showHiddenVariants === true;
    return {
      search: typeof parsed.search === 'string' ? parsed.search : '',
      page,
      subView,
      hideZeroStock,
      showHiddenVariants,
      filterSize: typeof parsed.filterSize === 'string' ? parsed.filterSize : undefined,
      filterCategory: typeof parsed.filterCategory === 'string' ? parsed.filterCategory : undefined,
      filterColor: typeof parsed.filterColor === 'string' ? parsed.filterColor : undefined,
    };
  } catch {
    return { search: '', page: 1, subView: 'mine', hideZeroStock: false };
  }
}

export function setStoredInventoryState(
  search: string,
  page: number,
  subView: 'mine' | 'ml' | 'tn',
  hideZeroStock?: boolean,
  filters?: { filterSize?: string; filterCategory?: string; filterColor?: string; showHiddenVariants?: boolean }
): void {
  try {
    const obj: Record<string, unknown> = {
      search,
      page,
      subView,
      hideZeroStock: hideZeroStock === true,
      showHiddenVariants: filters?.showHiddenVariants === true,
    };
    if (filters) {
      obj.filterSize = filters.filterSize ?? 'ALL';
      obj.filterCategory = filters.filterCategory ?? 'ALL';
      obj.filterColor = filters.filterColor ?? 'ALL';
    }
    sessionStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  async function run(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      try {
        await fn(items[i]);
      } catch {
        // ignore per-item errors
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
}

/** Código de artículo a 7 dígitos con ceros adelante (ej. 52302 → 0052302). */
export function padArticleCodeTo7(s: string): string {
  const digits = String(s ?? '').replace(/\D/g, '');
  if (!digits) return s;
  return digits.length <= 7 ? digits.padStart(7, '0') : digits;
}

/**
 * Importación matriz de pedidos: no rellena a 7 dígitos.
 * Si la celda es solo números, deja el código “natural” sin ceros a la izquierda (ej. 22684, no 0022684).
 */
export function normalizeArticleCodeForMatrixImport(s: string): string {
  const t = String(s ?? '').trim();
  if (!t) return '';
  const digits = t.replace(/\D/g, '');
  if (!digits) return t;
  const onlyNum = /^\d+$/.test(t.replace(/\s/g, ''));
  if (onlyNum) {
    return digits.replace(/^0+/, '') || '0';
  }
  return t;
}

/** Parsea Excel de stock: CODIGO + COLOR + columnas de talles (P, M, G… y/o 10, 12, 130 - P, etc.). */
export async function parseStockExcel(file: File): Promise<Array<Record<string, unknown>>> {
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as (string | number)[][];
  if (rows.length < 2) return [];

  const originalHeaders = (rows[0] || []).map((h) => String(h ?? '').trim());
  const normHeaders = originalHeaders.map((h) =>
    h
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );

  const codigoCandidates = ['CODIGO', 'COD', 'ARTICULO', 'MODELO', 'SKU BASE', 'SKU'];
  let codigoCol = -1;
  for (const cand of codigoCandidates) {
    const idx = normHeaders.findIndex((h) => h === cand);
    if (idx >= 0) {
      codigoCol = idx;
      break;
    }
  }

  const colorCandidates = ['COLOR', 'COL', 'CODIGO COLOR', 'COD. COLOR', 'COD COLOR'];
  let colorCol = -1;
  for (const cand of colorCandidates) {
    const idx = normHeaders.findIndex((h) => h === cand || h.startsWith(cand + ' '));
    if (idx >= 0) {
      colorCol = idx;
      break;
    }
  }

  if (codigoCol < 0 || colorCol < 0) return [];

  const metaExclude = new Set(
    [
      'DESCRIPCION',
      'MODELO',
      'PRECIO',
      'TOTAL',
      'SUBTOTAL',
      'IMPORTE',
      'STOCK',
      'DEPOSITO',
      'NOTAS',
      'OBSERVACIONES',
      'CATEGORIA',
      'PROVEEDOR',
      'MARCA',
      'FECHA',
      'DESPACHO',
      'NOMBRE',
      'PRODUCTO',
      'ARTICULO',
      'CODIGO',
      'COLOR',
      'COL',
      'COD',
      'CANTIDAD',
    ].map((x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  );

  const legacySizeNames = ['P', 'M', 'G', 'GG', 'U', 'XG', 'XXG', 'XXXG'];
  const sizeColsDynamic: { header: string; index: number }[] = [];
  for (let i = 0; i < originalHeaders.length; i++) {
    if (i === codigoCol || i === colorCol) continue;
    const orig = originalHeaders[i];
    if (!orig) continue;
    const nh = normHeaders[i];
    if (!nh) continue;
    if (metaExclude.has(nh) || nh.startsWith('PRECIO') || nh.startsWith('OBS')) continue;
    sizeColsDynamic.push({ header: orig, index: i });
  }

  let sizeCols: { key: string; index: number }[] = [];
  if (sizeColsDynamic.length > 0) {
    sizeCols = sizeColsDynamic.map((s) => ({ key: s.header, index: s.index }));
  } else {
    for (const name of legacySizeNames) {
      const idx = normHeaders.findIndex((h) => h === name);
      if (idx >= 0) sizeCols.push({ key: name, index: idx });
    }
  }

  if (sizeCols.length === 0) return [];

  let lastCodigo = '';
  const out: Array<Record<string, unknown>> = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const rawCodigo = row[codigoCol];
    const codigo = rawCodigo != null && String(rawCodigo).trim() !== '' ? String(rawCodigo).trim() : lastCodigo;
    if (codigo) lastCodigo = codigo;
    const rawColor = row[colorCol];
    const color = rawColor != null ? String(rawColor).trim() : '';
    if (!codigo || !color) continue;
    const obj: Record<string, unknown> = { codigo: padArticleCodeTo7(codigo), color };
    for (const { key, index } of sizeCols) {
      const v = row[index];
      if (v === null || v === undefined || v === '') obj[key] = 0;
      else if (typeof v === 'number' && !Number.isNaN(v)) obj[key] = Math.max(0, Math.floor(v));
      else if (String(v).trim().toUpperCase() === 'X') obj[key] = 0;
      else obj[key] = parseInt(String(v).replace(/\D/g, ''), 10) || 0;
    }
    out.push(obj);
  }
  return out;
}

export function getProductColorCode(p: Product): string {
  const val = ((p as Record<string, unknown>).color || '').toString().trim().toLowerCase();
  if (val) return val;
  const sku = (p.sku || '').toString().trim();
  const parts = sku.split('-');
  if (parts.length > 1) return parts[parts.length - 1].trim().toLowerCase();
  return '';
}

export function getProductSizeCode(p: Product): string {
  const val = ((p as Record<string, unknown>).size || '').toString().trim().toUpperCase();
  if (val) return val;
  const sku = (p.sku || '').toString().trim();
  const parts = sku.split('-');
  if (parts.length >= 3) return (parts[parts.length - 2] || '').toString().trim().toUpperCase();
  return '';
}

/** Conjunto de códigos equivalentes para comparar talle (ej: "M" y "140" son el mismo talle). */
export function getSizeCanonicalSet(sizeStr: string): Set<string> {
  const s = (sizeStr || '').toString().trim().toUpperCase();
  if (!s) return new Set();
  const fromTango = nombreTalleDesdeCodigo(s);
  const toTango = codigoTalleParaSku(s);
  const set = new Set<string>([s]);
  if (fromTango) set.add(fromTango);
  if (toTango) set.add(toTango);
  return set;
}

export function matchesSizeFilter(productSizeCode: string, selectedFilterSize: string): boolean {
  if (selectedFilterSize === 'ALL') return true;
  const productSet = getSizeCanonicalSet(productSizeCode);
  const filterSet = getSizeCanonicalSet(selectedFilterSize);
  return [...filterSet].some(fc => productSet.has(fc));
}
