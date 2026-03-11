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
  filterSize?: string;
  filterCategory?: string;
  filterColor?: string;
}

export function getStoredInventoryState(): StoredInventoryState {
  try {
    const raw = sessionStorage.getItem(INVENTORY_STORAGE_KEY);
    if (!raw) return { search: '', page: 1, subView: 'mine', hideZeroStock: false };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const page = typeof parsed.page === 'number' && parsed.page >= 1 ? parsed.page : 1;
    const subView = parsed.subView === 'ml' || parsed.subView === 'tn' ? parsed.subView : 'mine';
    const hideZeroStock = parsed.hideZeroStock === true;
    return {
      search: typeof parsed.search === 'string' ? parsed.search : '',
      page,
      subView,
      hideZeroStock,
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
  filters?: { filterSize?: string; filterCategory?: string; filterColor?: string }
): void {
  try {
    const obj: Record<string, unknown> = { search, page, subView, hideZeroStock: hideZeroStock === true };
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

/** Parsea Excel de stock: columna CODIGO, COLOR, y columnas P, M, G, GG, XG, XXG, XXXG. */
export async function parseStockExcel(file: File): Promise<Array<Record<string, unknown>>> {
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as (string | number)[][];
  if (rows.length < 2) return [];
  const headers = (rows[0] || []).map(h => String(h ?? '').trim().toUpperCase());
  const codigoCol = headers.findIndex(h => h === 'CODIGO' || h === 'CÓDIGO' || h === 'COD');
  const colorCol = headers.findIndex(h => h === 'COLOR' || h === 'COL');
  const sizeCols: { key: string; index: number }[] = [];
  const sizeNames = ['P', 'M', 'G', 'GG', 'XG', 'XXG', 'XXXG'];
  for (const name of sizeNames) {
    const idx = headers.findIndex(h => h === name);
    if (idx >= 0) sizeCols.push({ key: name, index: idx });
  }
  if (codigoCol < 0 || colorCol < 0 || sizeCols.length === 0) return [];
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
      else if (typeof v === 'number') obj[key] = v;
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
