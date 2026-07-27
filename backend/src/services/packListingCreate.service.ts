import axios from 'axios';
import { get, query } from '../database/db';
import {
  getValidMLToken,
  mercadoLibreItemIdCandidates,
  mlColorSizeFromTitle,
  normalizeMercadoLibreItemId,
  resolveMercadoLibreCatalogProductItems,
  resolveMercadoLibreUserProductItems
} from '../controllers/integrations.controller';
import { tnPostWithRetry } from '../utils/tiendanubeClient';
import {
  nombreTalleDesdeCodigo,
  TALLE_CODIGO_A_NOMBRE,
  TALLE_CODIGO_A_RANGO_ML,
  TALLE_LETRAS_EQUIVALENTES
} from '../talles-tango';
import {
  computeAvailableStockFromItems,
  createPublicationBundle,
  findBundlesByProduct,
  savePublicationBundleGroup,
  type PublicationBundleGroup,
  type PublicationBundlePlatform,
  type PublicationBundleItem
} from './publicationStockBundle.service';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';

function appendTitleSuffix(title: string, suffix: string): string {
  const t = (title || '').trim();
  const s = (suffix || '').trim();
  if (!s) return t;
  if (t.toLowerCase().includes(s.toLowerCase())) return t;
  return `${t}${s}`;
}

export type PreviewImageDto = { url: string; pictureId?: string };

export type PackListingPublicationContent = {
  title?: string;
  description?: string;
  price?: number;
  pictures?: Array<{ url?: string; pictureId?: string; selected?: boolean }>;
};

/** URL de mejor calidad para mostrar y publicar (ML suele entregar -I; usamos -O). */
export function mlBestPictureUrl(p: any): string {
  const candidates: unknown[] = [p?.secure_url, p?.url, p?.max_size];
  if (p?.size && typeof p.size === 'object') {
    candidates.push(...Object.values(p.size));
  }
  for (const raw of candidates) {
    let u = String(raw ?? '').trim();
    if (!u.startsWith('http')) continue;
    if (/mlstatic\.com/i.test(u)) {
      u = u.replace(/-([A-Z])\.(jpe?g|png|webp)/gi, '-O.$2');
    }
    return u;
  }
  return '';
}

function collectMlPicturesFromItem(item: any): PreviewImageDto[] {
  const seen = new Set<string>();
  const out: PreviewImageDto[] = [];
  for (const p of Array.isArray(item?.pictures) ? item.pictures : []) {
    const url = mlBestPictureUrl(p);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, pictureId: p?.id != null ? String(p.id) : undefined });
  }
  return out;
}

/** ID de foto ML (ej. 760054-MLA109651780820_042026), no IDs de atributos BRAND/COLOR. */
function looksLikeMlPictureId(id: string): boolean {
  const s = String(id || '').trim();
  if (!s || /^https?:\/\//i.test(s)) return false;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(s) && !/-MLA/i.test(s)) return false;
  return /-MLA/i.test(s) || /^\d{4,}-/.test(s);
}

function sanitizeMlPicturesForApi(
  raw: unknown
): Array<{ id: string } | { source: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string } | { source: string }> = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (e.value_name != null && e.id != null && !looksLikeMlPictureId(String(e.id))) continue;
    const id = String(e.id ?? '').trim();
    const source = String(e.source ?? e.secure_url ?? e.url ?? '').trim();
    if (id && looksLikeMlPictureId(id)) {
      const key = `id:${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ id });
      }
      continue;
    }
    if (source.startsWith('http')) {
      const key = `src:${source}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ source });
      }
    }
  }
  return out;
}

/** Atributo para POST /items (value_id y/o value_name según el id). */
export type MlItemCreateAttribute = {
  id: string;
  value_name?: string;
  value_id?: string | number;
};

function mlNormalizeSizeLabel(size: string): string {
  return String(size || '')
    .trim()
    .toLowerCase()
    .replace(/^talle\s+/i, '')
    .replace(/único/g, 'unico');
}

/** Código numérico (130) + letra Tango (P) + alias ML (S, EG…) para buscar variación / guía. */
function mlSizeLabelsForMatch(size: string): string[] {
  const raw = String(size || '').trim();
  const out = new Set<string>();
  const push = (s: string) => {
    const t = mlNormalizeSizeLabel(s);
    if (t) out.add(t);
  };
  push(raw);
  if (/^\d{2,3}$/.test(raw)) {
    const letter = nombreTalleDesdeCodigo(raw);
    push(letter);
    for (const alias of TALLE_LETRAS_EQUIVALENTES[raw] || []) push(alias);
    const range = TALLE_CODIGO_A_RANGO_ML[raw];
    if (range) {
      push(range);
      push(range.replace(/-/g, ' '));
      const parts = range.split('-').map((p) => p.trim()).filter(Boolean);
      for (const p of parts) push(p);
      push(`${letter} ${range}`);
      push(`talle ${letter} ${range}`);
    }
  } else {
    push(nombreTalleDesdeCodigo(raw));
    const code = Object.entries(TALLE_CODIGO_A_NOMBRE).find(([, name]) => name.toLowerCase() === raw.toLowerCase())?.[0];
    if (code && TALLE_CODIGO_A_RANGO_ML[code]) {
      const range = TALLE_CODIGO_A_RANGO_ML[code];
      push(range);
      push(`${raw} ${range}`);
    }
  }
  return [...out];
}

function mlLabelMatchesChartToken(label: string, token: string): boolean {
  if (!label || !token) return false;
  if (label === token) return true;
  if (token.includes(label) || label.includes(token)) return true;
  if (label.length >= 1 && (token.startsWith(`${label} `) || token.startsWith(`${label}-`))) return true;
  return false;
}

function mlChartRowTextTokens(row: any): Set<string> {
  const tokens = new Set<string>();
  const visit = (node: unknown, depth = 0): void => {
    if (depth > 10 || node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      const raw = String(node).trim();
      if (!raw || raw.length > 120) return;
      const norm = mlNormalizeSizeLabel(raw);
      if (norm) tokens.add(norm);
      for (const part of raw.split(/[\s,;/\-–—]+/)) {
        const p = mlNormalizeSizeLabel(part);
        if (p) tokens.add(p);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const value of Object.values(node as Record<string, unknown>)) visit(value, depth + 1);
    }
  };
  visit(row);
  return tokens;
}

function mlSizeValueFromChartRow(row: any, sizeLabel: string): string {
  const attrs = Array.isArray(row?.attributes) ? row.attributes : [];
  for (const att of attrs) {
    const attId = mlAttrIdUpper(att?.id ?? att?.name);
    if (attId !== 'SIZE' && !ML_SIZE_ATTR_IDS.has(attId)) continue;
    const vals = Array.isArray(att?.values) ? att.values : [];
    for (const v of vals) {
      const name = String(v?.name ?? v?.value_name ?? '').trim();
      if (name) return name;
    }
  }
  return mlSizeValueNameForMercadoLibre(sizeLabel);
}

/** Valor SIZE para POST ML: letra de catálogo (M), no código Tango (140). */
function mlSizeValueNameForMercadoLibre(sizeCode: string): string {
  const raw = String(sizeCode || '').trim();
  if (!raw) return 'U';
  const letter = nombreTalleDesdeCodigo(raw);
  if (/^\d{2,3}$/.test(raw) && letter && letter !== raw) return letter;
  return raw;
}

function mlExtractAttributeValueName(entry: Record<string, unknown>): string {
  let value_name = String(entry.value_name ?? '').trim();
  if (!value_name || value_name === 'null') {
    const valueId = entry.value_id;
    if (valueId != null && String(valueId).trim() !== '') value_name = String(valueId).trim();
  }
  if (!value_name) value_name = String(entry.value ?? '').trim();
  if (!value_name && Array.isArray(entry.values) && (entry.values as unknown[]).length) {
    const v0 = (entry.values as Record<string, unknown>[])[0];
    if (v0 && typeof v0 === 'object') {
      value_name = String(
        v0.name ?? v0.value_name ?? (v0.struct as Record<string, unknown> | undefined)?.number ?? v0.id ?? ''
      ).trim();
    }
  }
  const struct = entry.value_struct as Record<string, unknown> | undefined;
  if (!value_name && struct && struct.number != null) {
    value_name = String(struct.number).trim();
  }
  return value_name;
}

function mlRawEntryToCreateAttribute(entry: unknown): MlItemCreateAttribute | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const id = String(e.id ?? '').trim();
  if (!id || looksLikeMlPictureId(id)) return null;
  const upper = mlAttrIdUpper(id);
  const value_name = mlExtractAttributeValueName(e);
  let value_id: string | number | undefined;
  const rawVid = e.value_id;
  if (rawVid != null && String(rawVid).trim() !== '') {
    const s = String(rawVid).trim();
    // ML exige value_id como string en POST /items (ej. SIZE_GRID_ID "2484883").
    value_id = s;
  }
  if (!value_name && value_id == null) return null;
  const out: MlItemCreateAttribute = { id: upper };
  if (value_name) out.value_name = value_name;
  if (value_id != null) out.value_id = value_id;
  if (upper === 'SIZE_GRID_ID' && out.value_id == null && value_name && /^\d+$/.test(value_name)) {
    out.value_id = value_name;
  }
  if (upper === 'SIZE_GRID_ROW_ID') {
    const rid =
      out.value_id != null && String(out.value_id).includes(':')
        ? String(out.value_id).trim()
        : value_name.includes(':')
          ? value_name
          : '';
    if (rid) {
      out.value_id = rid;
      delete out.value_name;
    }
  }
  return out;
}

function sanitizeMlCreateAttributes(raw: unknown): MlItemCreateAttribute[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MlItemCreateAttribute[] = [];
  for (const entry of raw) {
    const attr = mlRawEntryToCreateAttribute(entry);
    if (!attr) continue;
    const key = mlAttrIdUpper(attr.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(attr);
  }
  return out;
}

function sanitizeMlAttributesForApi(raw: unknown): Array<{ id: string; value_name: string }> {
  return sanitizeMlCreateAttributes(raw)
    .filter((a) => Boolean(a.value_name))
    .map((a) => ({ id: a.id, value_name: a.value_name! }));
}

/** Formato que exige ML en POST /items (SIZE_GRID_ID y SIZE_GRID_ROW_ID con value_id). */
function mlAttributesForPostPayload(attrs: MlItemCreateAttribute[]): Array<Record<string, unknown>> {
  return attrs
    .map((a) => {
      const id = mlAttrIdUpper(a.id);
      const row: Record<string, unknown> = { id };
      if (id === 'SIZE_GRID_ID' && a.value_id != null) {
        row.value_id = String(a.value_id);
        return row;
      }
      if (id === 'SIZE_GRID_ROW_ID') {
        const rowId = mlSizeGridRowIdValue(a);
        if (rowId) row.value_id = rowId;
        return row;
      }
      if (a.value_name) row.value_name = a.value_name;
      else if (a.value_id != null) row.value_id = a.value_id;
      return row;
    })
    .filter((row) => row.value_name != null || row.value_id != null);
}

function normalizeMlVariationAttributeCombinations(
  raw: unknown
): Array<{ id: string; value_name: string }> {
  if (!Array.isArray(raw)) return [];
  return (raw as any[])
    .map((a) => ({
      id: String(a?.id ?? '').trim(),
      value_name: String(a?.value_name ?? '').trim()
    }))
    .filter((a) => a.id && a.value_name);
}

/** Clave única COLOR + SIZE para deduplicar variaciones. */
function mlVariationCombinationKey(
  attributeCombinations: Array<{ id: string; value_name: string }>
): string {
  let color = '';
  let size = '';
  for (const a of attributeCombinations) {
    const id = mlAttrIdUpper(a.id);
    if (ML_COLOR_ATTR_IDS.has(id)) color = a.value_name;
    if (ML_SIZE_ATTR_IDS.has(id)) size = a.value_name;
  }
  return `${color}||${size}`;
}

function dedupeMlPackVariations(
  variations: Array<Record<string, unknown>>
): { variations: Array<Record<string, unknown>>; skippedKeys: string[] } {
  const byKey = new Map<string, Record<string, unknown>>();
  const skippedKeys: string[] = [];
  for (const row of variations) {
    const ac = normalizeMlVariationAttributeCombinations(row.attribute_combinations);
    const key = mlVariationCombinationKey(ac);
    const existing = byKey.get(key);
    if (existing) {
      skippedKeys.push(key);
      const mergedQty =
        Math.max(0, Number(existing.available_quantity) || 0) +
        Math.max(0, Number(row.available_quantity) || 0);
      existing.available_quantity = mergedQty;
      continue;
    }
    byKey.set(key, { ...row, attribute_combinations: ac });
  }
  return { variations: [...byKey.values()], skippedKeys };
}

function sanitizeMlVariationsForApi(raw: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const mapped = raw.map((entry) => {
    const row = entry as Record<string, unknown>;
    const ac = normalizeMlVariationAttributeCombinations(row.attribute_combinations);
    const out: Record<string, unknown> = {
      price: Number(row.price),
      available_quantity: Math.max(0, Math.floor(Number(row.available_quantity) || 0)),
      attribute_combinations: ac
    };
    const sku = String(row.seller_custom_field ?? '').trim();
    if (sku) out.seller_custom_field = sku;
    return out;
  });
  return dedupeMlPackVariations(mapped).variations;
}

/** Atributos comerciales permitidos en POST /items (publicación clásica con variations). */
const ML_ITEM_CREATE_ATTR_ALLOWLIST_CLASSIC = new Set([
  'BRAND',
  'AGE_GROUP',
  'GENDER',
  'COMPOSITION',
  'MAIN_MATERIAL',
  'MALE_UNDERWEAR_TYPE',
  'MODEL',
  'SALE_FORMAT',
  'UNITS_PER_PACK'
]);

/** User Product (family_name, sin variations): solo atributos comerciales seguros. */
const ML_ITEM_CREATE_ATTR_ALLOWLIST_USER_PRODUCT = new Set([
  'BRAND',
  'COMPOSITION',
  'GENDER',
  'MAIN_MATERIAL',
  'MALE_UNDERWEAR_TYPE',
  'MODEL',
  'SALE_FORMAT',
  'UNITS_PER_PACK'
]);

/** Nunca enviar al crear (metadatos ML / flags internos). */
const ML_ITEM_CREATE_ATTR_BLOCKLIST = new Set([
  'GIFTABLE',
  'FILTRABLE_GENDER',
  'IS_EMERGING_BRAND',
  'IS_HIGHLIGHT_BRAND',
  'IS_TOM_BRAND',
  'ITEM_CONDITION'
]);

/** User Product: COLOR es de variación; SIZE/guía van a nivel ítem (una MLA por talle). */
const ML_USER_PRODUCT_ATTR_NEVER_SEND = new Set(['COLOR', ...ML_ITEM_CREATE_ATTR_BLOCKLIST]);

/** Guía de talles + SIZE en User Product (MLA429740). */
const ML_USER_PRODUCT_FASHION_ATTR_IDS = new Set(['SIZE_GRID_ID', 'SIZE_GRID_ROW_ID', 'SIZE']);

/** Impuestos y paquete obligatorios en MLA429740 (sin SIZE_GRID_ID fijo). */
const ML_MANDATORY_CATEGORY_ATTRIBUTE_IDS = new Set([
  'VALUE_ADDED_TAX',
  'IMPORT_DUTY',
  'SELLER_PACKAGE_HEIGHT',
  'SELLER_PACKAGE_WIDTH',
  'SELLER_PACKAGE_LENGTH',
  'SELLER_PACKAGE_WEIGHT'
]);

const ML_MANDATORY_CATEGORY_ATTRIBUTE_DEFAULTS: Record<string, MlItemCreateAttribute> = {
  VALUE_ADDED_TAX: { id: 'VALUE_ADDED_TAX', value_name: '21 %' },
  IMPORT_DUTY: { id: 'IMPORT_DUTY', value_name: '0 %' },
  SELLER_PACKAGE_HEIGHT: { id: 'SELLER_PACKAGE_HEIGHT', value_name: '25 cm' },
  SELLER_PACKAGE_WIDTH: { id: 'SELLER_PACKAGE_WIDTH', value_name: '18 cm' },
  SELLER_PACKAGE_LENGTH: { id: 'SELLER_PACKAGE_LENGTH', value_name: '5 cm' },
  SELLER_PACKAGE_WEIGHT: { id: 'SELLER_PACKAGE_WEIGHT', value_name: '59 g' }
};

/** Categorías que publican solo como User Product (family_name, sin variations). */
const ML_USER_PRODUCT_CATEGORY_IDS = new Set(['MLA429740']);

/** Claves solo para logs/debug; nunca deben ir al POST de ML. */
const ML_ITEM_BODY_INTERNAL_KEYS = new Set(['_flags', '_meta', '__debug']);

function stripMlInternalBodyKeys(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (ML_ITEM_BODY_INTERNAL_KEYS.has(key) || key.startsWith('_')) continue;
    out[key] = value;
  }
  return out;
}

function sanitizeMlSaleTermsForApi(raw: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const out = raw
    .map((st) => {
      if (!st || typeof st !== 'object') return null;
      const id = String((st as any).id ?? '').trim();
      if (!id) return null;
      const row: Record<string, unknown> = { id };
      const valueId = (st as any).value_id;
      if (valueId != null && String(valueId).trim() !== '') row.value_id = valueId;
      const valueName = String((st as any).value_name ?? '').trim();
      if (valueName) row.value_name = valueName;
      return row;
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
  return out.length ? out : undefined;
}

/** Solo atributos permitidos para el tipo de publicación; sin duplicados. */
function filterMlItemAttributesForCreatePost(
  attrs: MlItemCreateAttribute[],
  opts?: { userProduct?: boolean }
): MlItemCreateAttribute[] {
  const allowlist = opts?.userProduct
    ? ML_ITEM_CREATE_ATTR_ALLOWLIST_USER_PRODUCT
    : ML_ITEM_CREATE_ATTR_ALLOWLIST_CLASSIC;
  const seen = new Set<string>();
  const out: MlItemCreateAttribute[] = [];
  for (const a of attrs) {
    const upper = mlAttrIdUpper(a.id);
    if (ML_MANDATORY_CATEGORY_ATTRIBUTE_IDS.has(upper)) {
      if (!a.value_name && a.value_id == null) continue;
      if (seen.has(upper)) continue;
      seen.add(upper);
      out.push({ id: upper, value_name: a.value_name, value_id: a.value_id });
      continue;
    }
    if (opts?.userProduct && ML_USER_PRODUCT_FASHION_ATTR_IDS.has(upper)) {
      if (!a.value_name && a.value_id == null) continue;
      if (seen.has(upper)) continue;
      seen.add(upper);
      out.push({ id: upper, value_name: a.value_name, value_id: a.value_id });
      continue;
    }
    if (opts?.userProduct) {
      if (ML_USER_PRODUCT_ATTR_NEVER_SEND.has(upper)) continue;
      if (!allowlist.has(upper)) continue;
    } else {
      if (ML_ITEM_CREATE_ATTR_BLOCKLIST.has(upper)) continue;
      if (!allowlist.has(upper)) continue;
    }
    if (!a.value_name && a.value_id == null) continue;
    if (seen.has(upper)) continue;
    seen.add(upper);
    out.push({ id: upper, value_name: a.value_name, value_id: a.value_id });
  }
  return out;
}

/** Preserva atributos obligatorios de categoría desde el ítem origen o defaults. */
function mlMergeMandatoryCategoryAttributes(
  attrs: MlItemCreateAttribute[],
  sourceRaw: unknown,
  categoryId: string
): MlItemCreateAttribute[] {
  const cat = String(categoryId || '').trim();
  if (!cat || !ML_USER_PRODUCT_CATEGORY_IDS.has(cat)) return attrs;

  const sourceAttrs = sanitizeMlCreateAttributes(sourceRaw);
  let out = [...attrs];
  for (const attrId of ML_MANDATORY_CATEGORY_ATTRIBUTE_IDS) {
    const fromSource = sourceAttrs.find((a) => mlAttrIdUpper(a.id) === attrId);
    const hasSourceValue =
      fromSource && (fromSource.value_name || fromSource.value_id != null);
    const pick = hasSourceValue ? fromSource! : ML_MANDATORY_CATEGORY_ATTRIBUTE_DEFAULTS[attrId];
    if (pick) out = upsertMlCreateAttribute(out, pick);
  }
  return out;
}

function logMlPayloadAttributeIds(payload: Record<string, unknown>, debugContext?: string): void {
  const attrs = Array.isArray(payload.attributes) ? payload.attributes : [];
  const ids = attrs.map((a) => String((a as Record<string, unknown>)?.id ?? '')).filter(Boolean);
  const ctx = debugContext ? ` ${debugContext}` : '';
  console.log(`[ML] attribute ids before POST${ctx}`, ids);
}

function mlPickCreateAttributeFromList(attrs: unknown, attrId: string): MlItemCreateAttribute | null {
  if (!Array.isArray(attrs)) return null;
  for (const entry of attrs) {
    const attr = mlRawEntryToCreateAttribute(entry);
    if (attr && mlAttrIdUpper(attr.id) === mlAttrIdUpper(attrId)) return attr;
  }
  return null;
}

function mlSizeGridRowIdValue(row: MlItemCreateAttribute | undefined): string {
  if (!row) return '';
  const vid = row.value_id != null ? String(row.value_id).trim() : '';
  if (vid.includes(':')) return vid;
  const vn = String(row.value_name ?? '').trim();
  if (vn.includes(':')) return vn;
  return '';
}

function mlNormalizeSizeGridRowAttr(row: MlItemCreateAttribute): MlItemCreateAttribute {
  const rowId = mlSizeGridRowIdValue(row);
  if (!rowId) return row;
  return { id: 'SIZE_GRID_ROW_ID', value_id: rowId };
}

function mlMakeSizeGridRowAttr(rowId: string): MlItemCreateAttribute {
  return { id: 'SIZE_GRID_ROW_ID', value_id: String(rowId).trim() };
}

function mlVariationSizeMatchesLabels(varSizeName: string, labels: string[]): boolean {
  const norm = mlNormalizeSizeLabel(varSizeName);
  if (!norm) return false;
  return labels.some((l) => l === norm);
}

function mlFindSourceVariationBySize(sourceItem: any, size: string): any | null {
  const labels = mlSizeLabelsForMatch(size);
  if (!labels.length) return null;
  for (const v of Array.isArray(sourceItem?.variations) ? sourceItem.variations : []) {
    const ac = Array.isArray(v?.attribute_combinations) ? v.attribute_combinations : [];
    const varSize = ac.find((a: any) => ML_SIZE_ATTR_IDS.has(mlAttrIdUpper(a?.id)));
    if (mlVariationSizeMatchesLabels(String(varSize?.value_name ?? ''), labels)) return v;
  }
  return null;
}

function mlSourceSizeGridId(sourceItem: any): string {
  const fromItem = mlPickCreateAttributeFromList(sourceItem?.attributes, 'SIZE_GRID_ID');
  const id = String(fromItem?.value_id ?? fromItem?.value_name ?? '').trim();
  if (id && /^\d+$/.test(id)) return id;
  for (const v of Array.isArray(sourceItem?.variations) ? sourceItem.variations : []) {
    const fromVar = mlPickCreateAttributeFromList(v?.attributes, 'SIZE_GRID_ID');
    const vid = String(fromVar?.value_id ?? fromVar?.value_name ?? '').trim();
    if (vid && /^\d+$/.test(vid)) return vid;
  }
  return '';
}

function mlSizeGridRowFromSourceItem(sourceItem: any, size: string): MlItemCreateAttribute | null {
  const variation = mlFindSourceVariationBySize(sourceItem, size);
  if (variation) {
    const fromVar = mlPickCreateAttributeFromList(variation.attributes, 'SIZE_GRID_ROW_ID');
    if (fromVar) return mlNormalizeSizeGridRowAttr(fromVar);
  }
  const fromItem = mlPickCreateAttributeFromList(sourceItem?.attributes, 'SIZE_GRID_ROW_ID');
  if (fromItem) return mlNormalizeSizeGridRowAttr(fromItem);
  return null;
}

function mlSizeAttrFromSourceVariation(sourceItem: any, sizeLabel: string): MlItemCreateAttribute | null {
  const variation = mlFindSourceVariationBySize(sourceItem, sizeLabel);
  if (!variation) return null;
  const fromVar = mlPickCreateAttributeFromList(variation.attributes, 'SIZE');
  if (fromVar?.value_name) return { id: 'SIZE', value_name: String(fromVar.value_name) };
  const ac = Array.isArray(variation.attribute_combinations) ? variation.attribute_combinations : [];
  for (const a of ac) {
    if (!ML_SIZE_ATTR_IDS.has(mlAttrIdUpper(a?.id))) continue;
    const vn = String(a?.value_name ?? '').trim();
    if (vn) return { id: 'SIZE', value_name: vn };
  }
  return null;
}

/** Solo SIZE (letra); SIZE_GRID_ID/ROW se resuelven en mlUserProductFashionAttrsFromSource. */
function mlSizeAttrForUserProduct(size: string): MlItemCreateAttribute | null {
  const targetSize = String(size || '').trim();
  if (!targetSize) return null;
  return { id: 'SIZE', value_name: mlSizeValueNameForMercadoLibre(targetSize) };
}

function mlCollectGridTemplateRequiredAttrIds(specs: unknown): string[] {
  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
      return;
    }
    const o = node as Record<string, unknown>;
    const tags = Array.isArray(o.tags) ? o.tags.map((t) => String(t)) : [];
    const id = String(o.id ?? '').trim();
    if (id && tags.includes('grid_template_required')) ids.add(mlAttrIdUpper(id));
    for (const value of Object.values(o)) walk(value);
  };
  walk(specs);
  return [...ids];
}

async function mlFetchGridTemplateRequiredAttrIds(
  accessToken: string,
  domainId: string
): Promise<string[]> {
  const id = String(domainId || '').trim();
  if (!id) return [];
  try {
    const res = await axios.get(
      `https://api.mercadolibre.com/domains/${encodeURIComponent(id)}/technical_specs`,
      {
        params: { section: 'grids' },
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true
      }
    );
    if (res.status === 200 && res.data) {
      const found = mlCollectGridTemplateRequiredAttrIds(res.data);
      if (found.length) {
        console.log('[ML pack] grid_template_required attrs', { domainId: id, attrs: found });
        return found;
      }
    }
    const resAll = await axios.get(
      `https://api.mercadolibre.com/domains/${encodeURIComponent(id)}/technical_specs`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true
      }
    );
    if (resAll.status === 200 && resAll.data) {
      return mlCollectGridTemplateRequiredAttrIds(resAll.data);
    }
  } catch (err: any) {
    console.warn('[ML pack] technical_specs grids error', id, err?.message || err);
  }
  return [];
}

async function mlChartSearchAttributesForDomain(
  accessToken: string,
  domainId: string,
  sourceItem: any
): Promise<Array<{ id: string; values: Array<{ name: string }> }>> {
  const requiredIds = await mlFetchGridTemplateRequiredAttrIds(accessToken, domainId);
  const filterIdSet = new Set<string>(requiredIds.length ? requiredIds : ['GENDER', 'BRAND']);
  // ML suele exigir BRAND+GENDER en charts/search aunque solo GENDER sea grid_template_required.
  filterIdSet.add('GENDER');
  filterIdSet.add('BRAND');
  const fromItem = sanitizeMlCreateAttributes(sourceItem?.attributes);
  const out: Array<{ id: string; values: Array<{ name: string }> }> = [];
  for (const fid of filterIdSet) {
    const a = fromItem.find((x) => mlAttrIdUpper(x.id) === fid);
    if (!a?.value_name) continue;
    out.push({ id: fid, values: [{ name: a.value_name }] });
  }
  if (!out.length) {
    console.warn('[ML pack] charts/search sin filtros (faltan attrs en origen)', [...filterIdSet]);
  }
  return out;
}

function mlChartSizeCandidates(v: any): string[] {
  const out: string[] = [];
  const push = (s: unknown) => {
    const t = String(s ?? '').trim();
    if (t) out.push(mlNormalizeSizeLabel(t));
  };
  push(v?.name);
  push(v?.value_name);
  if (v?.struct && typeof v.struct === 'object') push((v.struct as any).number);
  push(v?.id);
  return out;
}

function mlChartRowMatchesSizeLabel(row: any, sizeLabel: string): boolean {
  const labels = mlSizeLabelsForMatch(sizeLabel);
  if (!labels.length) return false;
  const rowTokens = mlChartRowTextTokens(row);
  for (const label of labels) {
    for (const token of rowTokens) {
      if (mlLabelMatchesChartToken(label, token)) return true;
    }
  }
  const attrs = Array.isArray(row?.attributes) ? row.attributes : [];
  for (const att of attrs) {
    const attId = mlAttrIdUpper(att?.id ?? att?.name);
    if (attId !== 'SIZE' && !ML_SIZE_ATTR_IDS.has(attId)) continue;
    const vals = Array.isArray(att?.values) ? att.values : [];
    for (const v of vals) {
      for (const candidate of mlChartSizeCandidates(v)) {
        for (const label of labels) {
          if (mlLabelMatchesChartToken(label, candidate)) return true;
        }
      }
    }
  }
  return false;
}

async function mlFetchSizeGridRowForSize(
  accessToken: string,
  chartId: string | number,
  sizeLabel: string
): Promise<{ rowId: string; row?: any } | null> {
  const chartKey = String(chartId ?? '').trim();
  if (!chartKey) return null;
  try {
    const res = await axios.get(
      `https://api.mercadolibre.com/catalog/charts/${encodeURIComponent(chartKey)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true
      }
    );
    if (res.status !== 200 || !res.data) {
      console.warn('[ML pack] Guía de talles HTTP', chartKey, res.status, res.data?.message || res.data?.error);
      return null;
    }
    const rows = Array.isArray(res.data.rows) ? res.data.rows : [];
    for (const row of rows) {
      if (!mlChartRowMatchesSizeLabel(row, sizeLabel)) continue;
      const rowId = String(row.id ?? '').trim();
      if (rowId) return { rowId, row };
    }
    const wanted = mlSizeLabelsForMatch(sizeLabel);
    const summaries = rows.slice(0, 12).map((row: any) => ({
      id: row.id,
      tokens: [...mlChartRowTextTokens(row)].slice(0, 10)
    }));
    console.warn('[ML pack] Guía sin fila para talle', {
      chartKey,
      sizeLabel,
      wanted,
      rowCount: rows.length,
      rows: summaries
    });
  } catch (err: any) {
    console.warn('[ML pack] No se pudo leer guía de talles', chartKey, err?.message || err);
  }
  return null;
}

async function mlFetchSizeGridRowIdForSize(
  accessToken: string,
  chartId: string | number,
  sizeLabel: string
): Promise<string> {
  const found = await mlFetchSizeGridRowForSize(accessToken, chartId, sizeLabel);
  return found?.rowId ?? '';
}

function mlSiteIdFromItem(sourceItem: any): string {
  const cat = String(sourceItem?.category_id || 'MLA');
  const m = cat.match(/^([A-Z]{3})/);
  return m ? m[1] : 'MLA';
}

function mlDomainIdForChartSearch(domainId: string): string {
  const d = String(domainId || '').trim();
  const m = d.match(/^[A-Z]{3}-(.+)$/);
  return m ? m[1] : d;
}

async function mlDiscoverDomainId(
  accessToken: string,
  siteId: string,
  query: string,
  categoryId?: string
): Promise<string> {
  const q = String(query || '').trim();
  if (q) {
    try {
      const res = await axios.get(
        `https://api.mercadolibre.com/sites/${siteId}/domain_discovery/search`,
        {
          params: { q, limit: 1 },
          headers: { Authorization: `Bearer ${accessToken}` },
          validateStatus: () => true
        }
      );
      if (res.status === 200 && Array.isArray(res.data) && res.data[0]?.domain_id) {
        const domainId = String(res.data[0].domain_id).trim();
        console.log('[ML pack] domain_discovery', { q, domain_id: domainId, category_id: res.data[0]?.category_id });
        return domainId;
      }
    } catch (err: any) {
      console.warn('[ML pack] domain_discovery error', err?.message || err);
    }
  }

  const cat = String(categoryId || '').trim();
  if (cat) {
    try {
      const res = await axios.get(`https://api.mercadolibre.com/categories/${cat}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true
      });
      const settings = res.data?.settings;
      const fromSettings = String(settings?.catalog_domain || settings?.domain || '').trim();
      if (fromSettings) return fromSettings.includes('-') ? fromSettings : `${siteId}-${fromSettings}`;
    } catch {
      /* opcional */
    }
  }
  return '';
}

async function mlDomainSupportsSizeGrid(accessToken: string, domainId: string): Promise<boolean> {
  const id = String(domainId || '').trim();
  if (!id) return false;
  try {
    const res = await axios.get(`https://api.mercadolibre.com/domains/${encodeURIComponent(id)}/technical_specs`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true
    });
    if (res.status !== 200) return true;
    const blob = JSON.stringify(res.data || {});
    return /grid_id|SIZE_GRID_ID|grid_row_id|SIZE_GRID_ROW_ID/i.test(blob);
  } catch {
    return true;
  }
}

function mlChartSummariesFromSearchResponse(data: any): Array<{ id: string; type: string }> {
  const charts = Array.isArray(data?.charts) ? data.charts : [];
  const out: Array<{ id: string; type: string }> = [];
  for (const c of charts) {
    const id = String(c?.id ?? '').trim();
    if (!id || !/^\d+$/.test(id)) continue;
    out.push({ id, type: String(c?.type || '').toUpperCase() });
  }
  return out;
}

/** Solo chart_id devueltos por POST /catalog/charts/search (válidos para POST /items del vendedor). */
function mlPickChartIdFromSearchResponse(data: any, preferredChartId?: string): string {
  const charts = mlChartSummariesFromSearchResponse(data);
  const preferred = String(preferredChartId ?? '').trim();
  if (preferred && charts.some((c) => c.id === preferred)) return preferred;

  const pickType = (type: string) => charts.find((c) => c.type === type)?.id ?? '';
  const brand = pickType('BRAND');
  if (brand) return brand;
  const specific = pickType('SPECIFIC');
  if (specific) return specific;
  const standard = pickType('STANDARD');
  if (standard) return standard;
  return charts[0]?.id ?? '';
}

async function mlSearchCatalogChartId(
  accessToken: string,
  opts: {
    domainId: string;
    siteId: string;
    sellerId: string;
    searchAttributes: Array<{ id: string; values: Array<{ name: string }> }>;
    preferredChartId?: string;
  }
): Promise<string> {
  const sellerNum = Number(opts.sellerId);
  if (!Number.isFinite(sellerNum) || sellerNum <= 0) return '';

  const fullDomain = String(opts.domainId || '').trim();
  const shortDomain = mlDomainIdForChartSearch(fullDomain);
  const domainCandidates = [shortDomain, fullDomain].filter((d, i, arr) => d && arr.indexOf(d) === i);

  const attrSets: Array<Array<{ id: string; values: Array<{ name: string }> }>> = [];
  if (opts.searchAttributes.length) attrSets.push(opts.searchAttributes);
  const genderBrand = opts.searchAttributes.filter((a) =>
    ['GENDER', 'BRAND'].includes(mlAttrIdUpper(a.id))
  );
  if (genderBrand.length && genderBrand.length !== opts.searchAttributes.length) {
    attrSets.push(genderBrand);
  }
  attrSets.push([]);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'x-caller-id': String(sellerNum)
  };

  for (const domain_id of domainCandidates) {
    for (const attributes of attrSets) {
      for (const type of ['BRAND', 'SPECIFIC', undefined] as const) {
        const body: Record<string, unknown> = {
          domain_id,
          site_id: opts.siteId,
          seller_id: sellerNum,
          attributes
        };
        if (type) body.type = type;

        try {
          const res = await axios.post('https://api.mercadolibre.com/catalog/charts/search', body, {
            headers,
            validateStatus: () => true
          });
          if (res.status !== 200 || !res.data) {
            console.warn(
              '[ML pack] charts/search HTTP',
              res.status,
              domain_id,
              type || 'all',
              `attrs=${attributes.length}`,
              res.data?.message || res.data?.error
            );
            continue;
          }
          const chartId = mlPickChartIdFromSearchResponse(res.data, opts.preferredChartId);
          if (chartId) {
            const available = mlChartSummariesFromSearchResponse(res.data).map((c) => `${c.id}:${c.type}`);
            console.log('[ML pack] charts/search OK', {
              chartId,
              domain_id,
              type: type || 'all',
              attrCount: attributes.length,
              preferred: opts.preferredChartId || undefined,
              availableCharts: available.slice(0, 12)
            });
            return chartId;
          }
        } catch (err: any) {
          console.warn('[ML pack] charts/search error', domain_id, err?.message || err);
        }
      }
    }
  }
  return '';
}

async function mlResolveFashionGridViaMercadoLibreApi(
  sourceItem: any,
  size: string,
  accessToken: string,
  sellerId: string,
  familyName?: string
): Promise<{
  grid?: MlItemCreateAttribute;
  row?: MlItemCreateAttribute;
  size?: MlItemCreateAttribute;
  domainId?: string;
  chartId?: string;
} | null> {
  const siteId = mlSiteIdFromItem(sourceItem);
  const query = String(familyName || sourceItem?.family_name || sourceItem?.title || '').trim();
  const domainId = await mlDiscoverDomainId(
    accessToken,
    siteId,
    query,
    String(sourceItem?.category_id || '')
  );
  if (!domainId) {
    console.warn('[ML pack] Sin domain_id (domain_discovery)');
    return null;
  }

  const supportsGrid = await mlDomainSupportsSizeGrid(accessToken, domainId);
  if (!supportsGrid) {
    console.warn('[ML pack] Dominio sin guía de talles en technical_specs', domainId);
    return null;
  }

  const searchAttributes = await mlChartSearchAttributesForDomain(accessToken, domainId, sourceItem);
  const sourceChartId = String(
    mlPickCreateAttributeFromList(sourceItem?.attributes, 'SIZE_GRID_ID')?.value_id ?? ''
  ).trim();
  const chartId = await mlSearchCatalogChartId(accessToken, {
    domainId,
    siteId,
    sellerId,
    searchAttributes,
    preferredChartId: sourceChartId || undefined
  });
  if (!chartId) {
    console.warn('[ML pack] charts/search sin chart_id', { domainId, searchAttributes });
    return { domainId };
  }

  const sizeLabel = String(size || '').trim();
  const rowMatch = sizeLabel ? await mlFetchSizeGridRowForSize(accessToken, chartId, sizeLabel) : null;
  const rowId = rowMatch?.rowId ?? '';
  const sizeName = rowMatch?.row
    ? mlSizeValueFromChartRow(rowMatch.row, sizeLabel)
    : mlSizeValueNameForMercadoLibre(sizeLabel);

  return {
    domainId,
    chartId,
    grid: { id: 'SIZE_GRID_ID', value_id: String(chartId) },
    row: rowId ? mlMakeSizeGridRowAttr(rowId) : undefined,
    size: sizeLabel ? { id: 'SIZE', value_name: sizeName } : undefined
  };
}

function mlSizeGridRowMatchesChart(row: MlItemCreateAttribute | undefined, chartId: string): boolean {
  if (!row || !chartId) return false;
  const rowName = String(row.value_name ?? row.value_id ?? '').trim();
  return rowName.startsWith(`${chartId}:`);
}

function mlFashionSizeAttrForPack(
  sourceItem: any,
  sizeLabel: string,
  chartRow: any | null
): MlItemCreateAttribute {
  if (chartRow) {
    return { id: 'SIZE', value_name: mlSizeValueFromChartRow(chartRow, sizeLabel) };
  }
  const variation = mlFindSourceVariationBySize(sourceItem, sizeLabel);
  const fromVar = mlPickCreateAttributeFromList(variation?.attributes, 'SIZE');
  if (fromVar?.value_name) {
    return { id: 'SIZE', value_name: String(fromVar.value_name) };
  }
  return (
    mlSizeAttrForUserProduct(sizeLabel) ?? {
      id: 'SIZE',
      value_name: mlSizeValueNameForMercadoLibre(sizeLabel)
    }
  );
}

/**
 * Guía de talles idéntica a la publicación MLA origen (SIZE_GRID_ID + fila + SIZE del talle).
 * No sustituye por charts/search: el pack debe compartir la misma guía que el ítem modelo.
 */
async function mlFashionAttrsFromSourcePublication(
  sourceItem: any,
  sizeLabel: string,
  accessToken: string
): Promise<MlItemCreateAttribute[]> {
  const chartId = mlSourceSizeGridId(sourceItem);
  if (!chartId) {
    throw new Error(
      'La publicación origen no tiene SIZE_GRID_ID (guía de talles). ' +
        'Usá como modelo una publicación MLA individual con guía configurada en Mercado Libre.'
    );
  }

  let row: MlItemCreateAttribute | undefined;
  const fromSource = mlSizeGridRowFromSourceItem(sourceItem, sizeLabel);
  if (fromSource && mlSizeGridRowMatchesChart(fromSource, chartId)) {
    row = mlNormalizeSizeGridRowAttr(fromSource);
  }
  if (!mlSizeGridRowIdValue(row) && sizeLabel) {
    const rowMatch = await mlFetchSizeGridRowForSize(accessToken, chartId, sizeLabel);
    if (rowMatch?.rowId) {
      row = mlMakeSizeGridRowAttr(rowMatch.rowId);
    }
  }
  const rowIdFinal = mlSizeGridRowIdValue(row);
  if (!rowIdFinal) {
    const letter = mlSizeValueNameForMercadoLibre(sizeLabel);
    throw new Error(
      `La publicación origen (guía ${chartId}) no tiene fila para el talle ${sizeLabel} (${letter}). ` +
        'Verificá que la MLA modelo tenga variación con ese talle y SIZE_GRID_ROW_ID, o elegí otra publicación origen.'
    );
  }
  const rowAttr = mlMakeSizeGridRowAttr(rowIdFinal);

  const sizeAttr =
    mlSizeAttrFromSourceVariation(sourceItem, sizeLabel) ??
    mlFashionSizeAttrForPack(sourceItem, sizeLabel, null);

  console.log('[ML pack] fashion grid = publicación origen', {
    sourceItemId: String(sourceItem?.id ?? ''),
    chartId,
    sizeCode: sizeLabel,
    row: rowIdFinal,
    sizeName: sizeAttr.value_name
  });

  return [{ id: 'SIZE_GRID_ID', value_id: chartId }, rowAttr, sizeAttr];
}

async function mlAssertSourceItemSameSeller(
  sourceItem: any,
  integrationSellerId: string
): Promise<void> {
  const sourceSeller = String(sourceItem?.seller_id ?? '').trim();
  const tokenSeller = String(integrationSellerId ?? '').trim();
  if (!sourceSeller || !tokenSeller || sourceSeller === tokenSeller) return;
  throw new Error(
    `La publicación origen (MLA ${sourceItem?.id}) pertenece al vendedor ${sourceSeller}, ` +
      `pero la cuenta conectada en LupoHub es ${tokenSeller}. ` +
      'La guía de talles solo es válida si el pack se crea con la misma cuenta ML que la publicación modelo.'
  );
}

async function mlUserProductFashionAttrsFromSource(
  sourceItem: any,
  size: string,
  accessToken: string,
  sellerId: string,
  _familyName?: string
): Promise<MlItemCreateAttribute[]> {
  const sizeLabel = String(size || '').trim();
  await mlAssertSourceItemSameSeller(sourceItem, sellerId);
  return mlFashionAttrsFromSourcePublication(sourceItem, sizeLabel, accessToken);
}

function sanitizeMlShippingForApi(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (s.mode != null) out.mode = s.mode;
  if (s.local_pick_up != null) out.local_pick_up = s.local_pick_up;
  if (s.free_shipping != null) out.free_shipping = s.free_shipping;
  if (s.logistic_type != null) out.logistic_type = s.logistic_type;
  return Object.keys(out).length ? out : undefined;
}

/** Entrada explícita para armar POST /items sin spreads del ítem ML origen. */
export type MlItemPayloadInput = {
  title?: string;
  family_name?: string;
  category_id: string;
  price: number;
  available_quantity: number;
  currency_id?: string;
  buying_mode?: string;
  listing_type_id?: string;
  condition?: string;
  pictures?: Array<{ id?: string; source?: string }>;
  attributes?: unknown;
  seller_custom_field?: string;
  sale_terms?: unknown;
  shipping?: unknown;
  status?: string;
  video_id?: string;
  userProduct?: boolean;
  /** Atributos crudos del ítem origen (para preservar obligatorios de categoría). */
  sourceAttributes?: unknown;
};

function mlPictureIdForPayload(id: unknown): string | null {
  const s = String(id ?? '').trim();
  if (!s) return null;
  if (looksLikeMlPictureId(s)) return s;
  if (s.includes('MLA')) return s;
  return null;
}

function mlAttributesForPayloadInput(
  raw: unknown,
  opts?: { userProduct?: boolean; categoryId?: string; sourceAttributes?: unknown }
): MlItemCreateAttribute[] {
  const normalized: MlItemCreateAttribute[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const attr = mlRawEntryToCreateAttribute(entry);
      if (attr) normalized.push(attr);
    }
  }
  let filtered = filterMlItemAttributesForCreatePost(normalized, { userProduct: opts?.userProduct });
  const categoryId = String(opts?.categoryId ?? '').trim();
  if (categoryId) {
    filtered = mlMergeMandatoryCategoryAttributes(
      filtered,
      opts?.sourceAttributes ?? raw,
      categoryId
    );
  }
  return filtered;
}

/** Arma payload POST /items sin mutar ni mezclar objetos de ML. */
export function buildMercadoLibreItemPayload(input: MlItemPayloadInput): Record<string, unknown> {
  const userProduct = Boolean(input.userProduct);

  const pictures = (input.pictures || [])
    .map((p) => mlPictureIdForPayload(p?.id))
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ id }));

  const categoryId = String(input.category_id || '').trim();
  const attrModels = mlAttributesForPayloadInput(input.attributes, {
    userProduct,
    categoryId,
    sourceAttributes: input.sourceAttributes
  });
  const attributes = mlAttributesForPostPayload(attrModels);

  const payload: Record<string, unknown> = {
    category_id: String(input.category_id || '').trim(),
    price: Number(input.price),
    available_quantity: Math.max(0, Math.floor(Number(input.available_quantity) || 0)),
    currency_id: input.currency_id || 'ARS',
    buying_mode: input.buying_mode || 'buy_it_now',
    listing_type_id: input.listing_type_id || 'gold_special',
    condition: input.condition || 'new',
    pictures,
    attributes
  };

  const familyName = String(input.family_name ?? '').trim();
  if (familyName) payload.family_name = familyName;

  const title = String(input.title ?? '').trim();
  if (title && !userProduct) payload.title = title;

  const sku = String(input.seller_custom_field ?? '').trim();
  if (sku) payload.seller_custom_field = sku;

  if (input.status === 'paused') payload.status = 'paused';
  const videoId = String(input.video_id ?? '').trim();
  if (videoId) payload.video_id = videoId;

  const saleTerms = sanitizeMlSaleTermsForApi(input.sale_terms);
  if (saleTerms?.length) payload.sale_terms = saleTerms;

  const shipping = sanitizeMlShippingForApi(input.shipping);
  if (shipping) payload.shipping = shipping;

  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

export function validateMlPayload(
  payload: Record<string, unknown>,
  opts?: { userProduct?: boolean }
): void {
  const categoryId = String(payload.category_id ?? '').trim();
  if (!categoryId) throw new Error('Missing category_id');

  const price = Number(payload.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Missing price');

  const qty = Number(payload.available_quantity);
  if (!Number.isFinite(qty) || qty < 0) throw new Error('Missing available_quantity');

  if (opts?.userProduct) {
    if (!String(payload.family_name ?? '').trim()) throw new Error('Missing family_name');
    if (payload.title != null && String(payload.title).trim() !== '') {
      throw new Error('User Product payload must not include title');
    }
    if (Array.isArray(payload.variations) && payload.variations.length > 0) {
      throw new Error('User Product payload must not include variations');
    }
  } else {
    if (!String(payload.title ?? '').trim()) throw new Error('Missing title');
  }

  for (const p of Array.isArray(payload.pictures) ? payload.pictures : []) {
    const pic = p as Record<string, unknown>;
    const id = String(pic.id ?? '').trim();
    if (!id || !id.includes('MLA')) {
      throw new Error(`Invalid picture object: ${JSON.stringify(p)}`);
    }
    if (Object.keys(pic).some((k) => k !== 'id')) {
      throw new Error(`Picture must only have id: ${JSON.stringify(p)}`);
    }
  }

  const attrs = Array.isArray(payload.attributes) ? payload.attributes : [];
  for (const a of attrs) {
    const attr = a as Record<string, unknown>;
    const id = String(attr.id ?? '').trim();
    if (!id || id.includes('MLA')) {
      throw new Error(`Invalid attribute object: ${JSON.stringify(a)}`);
    }
    const keys = Object.keys(attr);
    if (id === 'SIZE_GRID_ID') {
      if (!keys.includes('id') || attr.value_id == null) {
        throw new Error(`SIZE_GRID_ID requires value_id: ${JSON.stringify(a)}`);
      }
      if (keys.some((k) => !['id', 'value_id'].includes(k))) {
        throw new Error(`Invalid SIZE_GRID_ID shape: ${JSON.stringify(a)}`);
      }
      continue;
    }
    if (id === 'SIZE_GRID_ROW_ID') {
      const rid = String(attr.value_id ?? attr.value_name ?? '').trim();
      if (!rid || !rid.includes(':')) {
        throw new Error(`SIZE_GRID_ROW_ID requires value_id grid:row: ${JSON.stringify(a)}`);
      }
      if (keys.some((k) => !['id', 'value_id'].includes(k))) {
        throw new Error(`Invalid SIZE_GRID_ROW_ID shape: ${JSON.stringify(a)}`);
      }
      const gridAttr = attrs.find(
        (x) => mlAttrIdUpper(String((x as Record<string, unknown>).id ?? '')) === 'SIZE_GRID_ID'
      ) as Record<string, unknown> | undefined;
      const gridId = String(gridAttr?.value_id ?? '').trim();
      if (gridId && !rid.startsWith(`${gridId}:`)) {
        throw new Error(`SIZE_GRID_ROW_ID ${rid} no coincide con SIZE_GRID_ID ${gridId}`);
      }
      continue;
    }
    if (keys.length !== 2 || !keys.includes('id') || !keys.includes('value_name')) {
      throw new Error(`Attribute must only have id and value_name: ${JSON.stringify(a)}`);
    }
    const vn = attr.value_name;
    if (vn === null || vn === undefined || String(vn).trim() === '') {
      throw new Error(`Invalid attribute value: ${JSON.stringify(a)}`);
    }
  }

  if (opts?.userProduct && ML_USER_PRODUCT_CATEGORY_IDS.has(categoryId)) {
    for (const mandatoryId of ML_MANDATORY_CATEGORY_ATTRIBUTE_IDS) {
      const found = attrs.some((a) => mlAttrIdUpper(String((a as any)?.id ?? '')) === mandatoryId);
      if (!found) throw new Error(`Missing mandatory attribute: ${mandatoryId}`);
    }
    for (const fashionId of ML_USER_PRODUCT_FASHION_ATTR_IDS) {
      const found = attrs.some((a) => mlAttrIdUpper(String((a as any)?.id ?? '')) === fashionId);
      if (!found) throw new Error(`Missing fashion attribute: ${fashionId}`);
    }
  }

  const forbiddenRootInArray = ['_flags', 'user_product_mode', 'publishing_size', 'removed_variations'];
  for (const key of forbiddenRootInArray) {
    if (key in payload && Array.isArray((payload as any)[key])) {
      throw new Error(`Internal field leaked into payload: ${key}`);
    }
  }
}

function mlDraftToPayloadInput(
  draft: Record<string, unknown>,
  opts: { userProduct: boolean }
): MlItemPayloadInput {
  const pictures: Array<{ id?: string; source?: string }> = [];
  if (Array.isArray(draft.pictures)) {
    for (const p of draft.pictures) {
      if (!p || typeof p !== 'object') continue;
      const row = p as Record<string, unknown>;
      pictures.push({
        id: row.id != null ? String(row.id) : undefined,
        source: row.source != null ? String(row.source) : undefined
      });
    }
  }

  return {
    title: String(draft.title ?? '').trim() || undefined,
    family_name: String(draft.family_name ?? '').trim() || undefined,
    category_id: String(draft.category_id ?? ''),
    price: Number(draft.price),
    available_quantity: Number(draft.available_quantity),
    currency_id: String(draft.currency_id ?? 'ARS'),
    buying_mode: String(draft.buying_mode ?? 'buy_it_now'),
    listing_type_id: String(draft.listing_type_id ?? 'gold_special'),
    condition: String(draft.condition ?? 'new'),
    pictures,
    attributes: draft.attributes,
    seller_custom_field: String(draft.seller_custom_field ?? '').trim() || undefined,
    sale_terms: draft.sale_terms,
    shipping: draft.shipping,
    status: draft.status != null ? String(draft.status) : undefined,
    video_id: draft.video_id != null ? String(draft.video_id) : undefined,
    userProduct: opts.userProduct,
    sourceAttributes: draft.sourceAttributes
  };
}

function mlListingFieldsFromSourceItem(sourceItem: any): {
  category_id: string;
  currency_id: string;
  buying_mode: string;
  listing_type_id: string;
  condition: string;
  sale_terms?: unknown;
  shipping?: unknown;
  video_id?: string;
} {
  return {
    category_id: String(sourceItem?.category_id ?? ''),
    currency_id: String(sourceItem?.currency_id || 'ARS'),
    buying_mode: String(sourceItem?.buying_mode || 'buy_it_now'),
    listing_type_id: String(sourceItem?.listing_type_id || 'gold_special'),
    condition: String(sourceItem?.condition || 'new'),
    sale_terms: sourceItem?.sale_terms,
    shipping: sourceItem?.shipping,
    video_id: sourceItem?.video_id != null ? String(sourceItem.video_id) : undefined
  };
}

/** Body limpio para POST /items: pictures y attributes separados y sin campos extra de la API origen. */
export function sanitizeMercadoLibreItemCreateBody(
  body: Record<string, unknown>
): Record<string, unknown> {
  const pictures = sanitizeMlPicturesForApi(body.pictures);
  const attributes = sanitizeMlAttributesForApi(body.attributes);
  const variations = sanitizeMlVariationsForApi(body.variations);

  const out: Record<string, unknown> = {
    category_id: body.category_id,
    currency_id: body.currency_id || 'ARS',
    buying_mode: body.buying_mode || 'buy_it_now',
    listing_type_id: body.listing_type_id || 'gold_special',
    condition: body.condition || 'new',
    price: Number(body.price),
    available_quantity: Math.max(0, Math.floor(Number(body.available_quantity) || 0)),
    pictures,
    attributes
  };

  const familyName = String(body.family_name ?? '').trim();
  if (variations?.length) {
    out.variations = variations;
    // ML rechaza family_name + variations en el mismo POST.
    delete out.family_name;
    const title = String(body.title ?? '').trim();
    if (title) out.title = title;
  } else if (familyName) {
    // User Product: solo family_name (sin title).
    out.family_name = familyName;
  } else {
    const title = String(body.title ?? '').trim();
    if (title) out.title = title;
  }

  const sku = String(body.seller_custom_field ?? '').trim();
  if (sku) out.seller_custom_field = sku;
  if (body.status) out.status = body.status;
  if (body.video_id) out.video_id = body.video_id;
  const saleTerms = sanitizeMlSaleTermsForApi(body.sale_terms);
  if (saleTerms?.length) out.sale_terms = saleTerms;
  const shipping = sanitizeMlShippingForApi(body.shipping);
  if (shipping) out.shipping = shipping;

  return stripMlInternalBodyKeys(out);
}

function mlIsUserProductPostPayload(body: Record<string, unknown>): boolean {
  const hasFamilyName = Boolean(String(body.family_name ?? '').trim());
  const variations = Array.isArray(body.variations) ? body.variations : [];
  return hasFamilyName && variations.length === 0;
}

/** Payload final exclusivo para POST /items (sin _flags ni claves internas). */
export function mlPayloadForMercadoLibreApiPost(body: Record<string, unknown>): Record<string, unknown> {
  const draftVariations = Array.isArray(body.variations) ? body.variations : [];
  const userProduct =
    body.userProduct === true ||
    (Boolean(String(body.family_name ?? '').trim()) && draftVariations.length === 0);

  const input = mlDraftToPayloadInput(body, { userProduct });
  const payload = buildMercadoLibreItemPayload(input);

  if (!userProduct && draftVariations.length > 0) {
    const variations = sanitizeMlVariationsForApi(draftVariations);
    if (variations?.length) {
      const classic = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
      delete classic.family_name;
      classic.variations = variations;
      validateMlPayload(classic, { userProduct: false });
      logMlPayloadAttributeIds(classic);
      console.log('[ML PAYLOAD CLEAN]', JSON.stringify(classic, null, 2));
      return classic;
    }
  }

  if (userProduct) {
    delete payload.title;
    const attrs = Array.isArray(payload.attributes) ? payload.attributes : [];
    const findAttr = (attrId: string) =>
      attrs.find(
        (a) => mlAttrIdUpper(String((a as Record<string, unknown>).id ?? '')) === attrId
      );
    console.log('[ML USER PRODUCT FINAL]', {
      hasTitle: payload.title != null && String(payload.title).trim() !== '',
      family_name: payload.family_name,
      user_product_mode: userProduct,
      sizeGridId: findAttr('SIZE_GRID_ID'),
      sizeGridRowId: findAttr('SIZE_GRID_ROW_ID')
    });
  }

  validateMlPayload(payload, { userProduct });
  logMlPayloadAttributeIds(payload);
  console.log('[ML PAYLOAD CLEAN]', JSON.stringify(payload, null, 2));
  return payload;
}

function buildMlItemCreateDebugFlags(safe: Record<string, unknown>): Record<string, unknown> {
  const variations = Array.isArray(safe.variations) ? safe.variations : [];
  const hasFamilyName = Boolean(String(safe.family_name ?? '').trim());
  const hasTitle = Boolean(String(safe.title ?? '').trim());
  const userProductMode = hasFamilyName && variations.length === 0;
  return {
    user_product_mode: userProductMode,
    uses_family_name_field: hasFamilyName,
    removed_family_name_because_variations: variations.length > 0,
    removed_variations_for_user_product: userProductMode,
    removed_title_for_user_product: userProductMode,
    has_item_price: safe.price != null,
    has_item_stock: safe.available_quantity != null,
    variation_count: variations.length,
    picture_count: Array.isArray(safe.pictures) ? safe.pictures.length : 0,
    attribute_count: Array.isArray(safe.attributes) ? safe.attributes.length : 0
  };
}

function mlPicturesPayload(
  content?: PackListingPublicationContent,
  fallbackItem?: any
): Array<{ id?: string; source?: string }> {
  if (content?.pictures?.length) {
    const selected = content.pictures.filter((p) => p.selected !== false);
    const payload = selected
      .map((p) => {
        const pictureId = String(p.pictureId ?? '').trim();
        if (pictureId && looksLikeMlPictureId(pictureId)) return { id: pictureId };
        const url = String(p.url || '').trim();
        if (url.startsWith('http')) return { source: url };
        return null;
      })
      .filter(Boolean) as Array<{ id?: string; source?: string }>;
    if (payload.length) return payload;
  }
  if (fallbackItem) return mlPicturesFromItem(fallbackItem);
  return [];
}

function mlPicturesFromItem(item: any): Array<{ id?: string; source?: string }> {
  const out: Array<{ id?: string; source?: string }> = [];
  for (const p of collectMlPicturesFromItem(item)) {
    if (p.pictureId && looksLikeMlPictureId(p.pictureId)) {
      out.push({ id: p.pictureId });
    } else if (p.url?.startsWith('http')) {
      out.push({ source: p.url });
    }
  }
  return out;
}

async function applyMlItemDescription(
  itemId: string,
  description: string,
  accessToken: string
): Promise<void> {
  const text = String(description || '').trim();
  if (!text) return;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
  await axios.post(
    `https://api.mercadolibre.com/items/${itemId}/description`,
    { plain_text: text },
    { headers, validateStatus: () => true }
  );
}

function mlSkuFromItem(item: any): string {
  let s = (item?.seller_sku ?? item?.seller_custom_field ?? '').toString().trim();
  if (!s && Array.isArray(item?.attributes)) {
    const skuAttr = item.attributes.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU');
    s = (skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '') : '').toString().trim();
  }
  return s;
}

const ML_COLOR_ATTR_IDS = new Set(['COLOR', 'COLOUR', 'COR']);
const ML_SIZE_ATTR_IDS = new Set(['SIZE', 'SIZE_TYPE', 'TALLE', 'TALLA']);

function mlAttrIdUpper(id: unknown): string {
  return String(id || '').trim().toUpperCase();
}

function mlColorSizeFromVariation(v: any, fallbackTitle?: string): { color: string; size: string } {
  let color = '';
  let size = '';
  (v?.attribute_combinations || []).forEach((attr: any) => {
    const id = mlAttrIdUpper(attr?.id);
    const name = (attr?.value_name || attr?.name || '').toString().trim();
    if (ML_COLOR_ATTR_IDS.has(id)) color = name;
    if (ML_SIZE_ATTR_IDS.has(id)) size = name;
  });
  if ((!color || !size) && fallbackTitle) {
    const parsed = mlColorSizeFromTitle(fallbackTitle);
    if (!color) color = parsed.color;
    if (!size) size = parsed.size;
  }
  return { color: color || 'Único', size: size || 'U' };
}

/** Atributos de variación que exige la publicación origen (p. ej. Color + Talle). */
function mlVariationAttrTemplates(sourceItem: any): Array<{ id: string; name?: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; name?: string }> = [];
  for (const v of Array.isArray(sourceItem?.variations) ? sourceItem.variations : []) {
    for (const ac of Array.isArray(v?.attribute_combinations) ? v.attribute_combinations : []) {
      const id = String(ac?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: ac?.name });
    }
  }
  if (!out.length) {
    out.push({ id: 'COLOR', name: 'Color' }, { id: 'SIZE', name: 'Talle' });
  }
  return out;
}

function mlValueForVariationAttr(
  attrId: string,
  opts: { color: string; size: string; label: string }
): string {
  const id = mlAttrIdUpper(attrId);
  if (ML_COLOR_ATTR_IDS.has(id)) return opts.color || opts.label || 'Único';
  if (ML_SIZE_ATTR_IDS.has(id)) return opts.size || 'U';
  return opts.label || opts.color || 'Único';
}

function buildMlVariationAttributeCombinations(
  templates: Array<{ id: string; name?: string }>,
  opts: { color: string; size: string; label: string }
): Array<{ id: string; name?: string; value_name: string }> {
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    value_name: mlValueForVariationAttr(t.id, opts)
  }));
}

function packColorNameForMlVariation(color: string): string {
  const c = String(color || '').trim();
  if (!c) return 'Surtido';
  if (c.includes(' - ')) return 'Surtido';
  return c;
}

function buildMlPackVariationAttributeCombinations(opts: {
  color: string;
  size: string;
}): Array<{ id: string; value_name: string }> {
  const colorName = packColorNameForMlVariation(opts.color);
  const sizeName = mlSizeValueNameForMercadoLibre(String(opts.size || '').trim() || 'U');
  return [
    { id: 'COLOR', value_name: colorName },
    { id: 'SIZE', value_name: sizeName }
  ];
}

function inferPackUnitsPerSale(
  title: string,
  packItems?: PublicationBundleItem[]
): number {
  const t = String(title || '');
  const m =
    t.match(/pack\s*x\s*(\d+)/i) ||
    t.match(/pack\s+(\d+)/i) ||
    t.match(/x\s*(\d+)(?:\s|$|[^0-9])/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 99) return n;
  }
  if (packItems?.length) {
    const perItem = packItems.map((it) =>
      Math.max(1, Math.floor(Number(it.unitsPerSale) || 1))
    );
    const maxUnits = Math.max(...perItem);
    if (maxUnits > 1) return maxUnits;
  }
  return 3;
}

function applyPackProductAttributeOverrides(
  attrs: MlItemCreateAttribute[],
  title: string,
  packItems?: PublicationBundleItem[]
): MlItemCreateAttribute[] {
  const skip = new Set(['UNDERPANTS_RISE', 'FAMILY_NAME']);
  let out = attrs.filter((a) => !skip.has(mlAttrIdUpper(a.id)));
  out = upsertMlItemAttribute(out, 'SALE_FORMAT', 'Pack');
  out = upsertMlItemAttribute(out, 'UNITS_PER_PACK', String(inferPackUnitsPerSale(title, packItems)));
  return out;
}

function mlItemAttributesForPackListing(
  sourceItem: any,
  skuSuffix: string,
  title: string,
  packItems: PublicationBundleItem[],
  opts?: { withVariations?: boolean }
): MlItemCreateAttribute[] {
  let attrs = mlAttributesForPackCreate(sourceItem, skuSuffix, { omitFamilyName: true });
  if (opts?.withVariations) {
    attrs = attrs.filter(
      (a) =>
        !ML_COLOR_ATTR_IDS.has(mlAttrIdUpper(a.id)) && !ML_SIZE_ATTR_IDS.has(mlAttrIdUpper(a.id))
    );
  }
  return applyPackProductAttributeOverrides(attrs, title, packItems);
}

function assertValidMlPackVariations(
  variations: Array<Record<string, unknown>>,
  packLabels: string[]
): void {
  if (!variations.length) {
    throw new Error('El pack debe generar al menos una variación de Mercado Libre');
  }
  const comboKeys = new Set<string>();
  for (let i = 0; i < variations.length; i++) {
    const label = packLabels[i] || `Combo ${i + 1}`;
    const v = variations[i];
    const price = Number(v.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`La variante "${label}" necesita price > 0 para Mercado Libre`);
    }
    const qty = Number(v.available_quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new Error(`La variante "${label}" necesita available_quantity válido`);
    }
    const ac = normalizeMlVariationAttributeCombinations(v.attribute_combinations);
    if (!ac.length) {
      throw new Error(`La variante "${label}" debe incluir attribute_combinations (COLOR y SIZE)`);
    }
    let hasColor = false;
    let hasSize = false;
    for (const a of ac) {
      const id = mlAttrIdUpper(a.id);
      if (ML_COLOR_ATTR_IDS.has(id)) hasColor = true;
      if (ML_SIZE_ATTR_IDS.has(id)) hasSize = true;
    }
    if (!hasColor || !hasSize) {
      throw new Error(`La variante "${label}" debe incluir COLOR y SIZE en attribute_combinations`);
    }
    const key = mlVariationCombinationKey(ac);
    if (comboKeys.has(key)) {
      throw new Error(`Hay variaciones duplicadas con la misma combinación COLOR/SIZE (${key})`);
    }
    comboKeys.add(key);
    if (!String(v.seller_custom_field ?? '').trim()) {
      throw new Error(`La variante "${label}" necesita seller_custom_field (SKU del pack)`);
    }
  }
}

function formatMlCreateError(postRes: { data?: any; statusText?: string }): string {
  const causes = Array.isArray(postRes.data?.cause)
    ? postRes.data.cause.map((c: any) => c.message || c.code || JSON.stringify(c)).filter(Boolean)
    : [];
  const base =
    postRes.data?.message ||
    postRes.data?.error ||
    causes.join('; ') ||
    postRes.statusText ||
    'error desconocido';
  return causes.length ? `${base} (${causes.join('; ')})` : String(base);
}

/** Vista para logs/errores: payload real + _flags aparte (no mezclar en el POST). */
export function summarizeMlItemCreateBody(body: Record<string, unknown>): Record<string, unknown> {
  const payload = mlPayloadForMercadoLibreApiPost(body);
  return {
    payload,
    _flags: buildMlItemCreateDebugFlags(payload)
  };
}

/** Error ML que exige User Product (family_name sin variations en el mismo body). */
export function mlCreateErrorRequiresUserProduct(message: string): boolean {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('variations is invalid with family name') ||
    m.includes('invalid with family name') ||
    (m.includes('family_name') && m.includes('required_fields')) ||
    (m.includes('family_name') && m.includes('does not contains'))
  );
}

function mlPostPayloadFashionFields(payload: Record<string, unknown>): Record<string, unknown> {
  const attrs = Array.isArray(payload.attributes) ? payload.attributes : [];
  const pick = (attrId: string) => {
    const row = attrs.find(
      (a) => mlAttrIdUpper(String((a as Record<string, unknown>).id ?? '')) === attrId
    ) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    if (attrId === 'SIZE_GRID_ID') return { value_id: row.value_id };
    if (attrId === 'SIZE_GRID_ROW_ID') return { value_id: row.value_id };
    return { value_name: row.value_name };
  };
  return {
    title: String(payload.title ?? '').trim() || undefined,
    family_name: String(payload.family_name ?? '').trim() || undefined,
    SIZE_GRID_ID: pick('SIZE_GRID_ID'),
    SIZE_GRID_ROW_ID: pick('SIZE_GRID_ROW_ID'),
    SIZE: pick('SIZE')
  };
}

function logMlItemCreateBeforePost(
  draftBody: Record<string, unknown>,
  payloadToSend: Record<string, unknown>,
  debugContext?: string,
  extra?: Record<string, unknown>
): void {
  const ctx = debugContext ? ` ${debugContext}` : '';
  console.log(`[ML POST /items] campos pack${ctx}`, mlPostPayloadFashionFields(payloadToSend));
  const hadFamilyName = Boolean(String(draftBody.family_name ?? '').trim());
  const draftVariations = Array.isArray(draftBody.variations) ? draftBody.variations : [];
  const postedVariations = Array.isArray(payloadToSend.variations) ? payloadToSend.variations : [];
  const removedFamilyName = hadFamilyName && postedVariations.length > 0;
  const removedVariations =
    draftVariations.length > 0 && postedVariations.length === 0 && Boolean(payloadToSend.family_name);
  const strippedInternalKeys = Object.keys(draftBody).filter(
    (k) => k.startsWith('_') || ML_ITEM_BODY_INTERNAL_KEYS.has(k)
  );
  const combinations = postedVariations.map((v: any) => ({
    price: v?.price,
    available_quantity: v?.available_quantity,
    seller_custom_field: v?.seller_custom_field,
    attribute_combinations: v?.attribute_combinations
  }));

  console.log(
    `[ML POST /items]${ctx}`,
    JSON.stringify(
      {
        user_product_mode: extra?.user_product_mode ?? Boolean(payloadToSend.family_name && !postedVariations.length),
        publishing_size: extra?.publishing_size,
        removed_variations: removedVariations || extra?.removed_variations === true,
        removed_family_name: removedFamilyName,
        stripped_internal_keys: strippedInternalKeys,
        had_family_name_in_draft: hadFamilyName,
        variation_count: postedVariations.length,
        combinations,
        ...extra,
        payload: payloadToSend,
        _flags: buildMlItemCreateDebugFlags(payloadToSend)
      },
      null,
      2
    )
  );
}

function mlAttributesForPackCreate(
  item: any,
  skuSuffix: string,
  opts?: { omitFamilyName?: boolean }
): MlItemCreateAttribute[] {
  const raw = mlAttributesForDuplicate(item, skuSuffix);
  const filtered = opts?.omitFamilyName
    ? raw.filter((a) => mlAttrIdUpper(a.id) !== 'FAMILY_NAME')
    : raw;
  return sanitizeMlCreateAttributes(filtered);
}

function upsertMlCreateAttribute(
  attrs: MlItemCreateAttribute[],
  entry: MlItemCreateAttribute
): MlItemCreateAttribute[] {
  const upper = mlAttrIdUpper(entry.id);
  if (!upper) return attrs;
  const rest = attrs.filter((a) => mlAttrIdUpper(a.id) !== upper);
  return [...rest, { id: upper, value_name: entry.value_name, value_id: entry.value_id }];
}

function upsertMlItemAttribute(
  attrs: MlItemCreateAttribute[],
  attrId: string,
  valueName: string
): MlItemCreateAttribute[] {
  const value = String(valueName || '').trim();
  if (!value) return attrs;
  return upsertMlCreateAttribute(attrs, { id: attrId, value_name: value });
}

async function resolvePackVariantColorSize(
  packItems: PublicationBundleItem[],
  sourceItem: any,
  label: string
): Promise<{ color: string; size: string }> {
  let color = '';
  let size = '';
  const ids = packItems.map((i) => i.variantId).filter(Boolean);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const rows = (await query(
      `SELECT pv.id, c.name AS color_name, s.size_code AS size_code
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN colors c ON c.id = pc.color_id
       JOIN sizes s ON s.id = pv.size_id
       WHERE pv.id IN (${placeholders})`,
      ids
    )) as Array<{ color_name?: string; size_code?: string }>;
    if (rows.length) {
      const sizes = [...new Set(rows.map((r) => String(r.size_code || '').trim()).filter(Boolean))];
      if (sizes.length === 1) size = sizes[0];
      else if (sizes.length > 1) size = sizes[0];
      const colors = rows.map((r) => String(r.color_name || '').trim()).filter(Boolean);
      if (colors.length === 1) color = colors[0];
      else if (colors.length > 1) color = colors.join(' - ');
    }
  }
  const title = String(sourceItem?.title || '').trim();
  const fromSource = mlColorSizeFromVariation(sourceItem?.variations?.[0], title);
  if (!size) size = fromSource.size;
  if (!color) color = label.trim() || fromSource.color;
  return { color: color || 'Único', size: size || 'U' };
}

function mlAttributesForDuplicate(item: any, skuSuffix: string): MlItemCreateAttribute[] {
  if (!Array.isArray(item?.attributes)) return [];
  const baseSku = mlSkuFromItem(item);
  const newSku = baseSku ? `${baseSku}${skuSuffix}` : '';
  const out: MlItemCreateAttribute[] = [];
  for (const a of item.attributes) {
    const attr = mlRawEntryToCreateAttribute(a);
    if (!attr) continue;
    if (mlAttrIdUpper(attr.id) === 'SELLER_SKU' && newSku) attr.value_name = newSku;
    out.push(attr);
  }
  return out;
}

/** User Product: exige family_name; no admite `variations` en el mismo POST. */
export function mlItemUsesFamilyNameModel(item: any): boolean {
  if (mlFamilyNameFromItem(item)) return true;
  const up = item?.user_product_id;
  if (up != null && String(up).trim() !== '') return true;
  if (item?.catalog_listing === true) return true;
  const categoryId = String(item?.category_id ?? '').trim();
  if (categoryId && ML_USER_PRODUCT_CATEGORY_IDS.has(categoryId)) return true;
  return false;
}

function packListingBaseTitle(
  sourceItem: any,
  opts: { titleSuffix: string; content?: PackListingPublicationContent }
): string {
  const raw =
    opts.content?.title?.trim() ||
    appendTitleSuffix(String(sourceItem.title || 'Pack'), opts.titleSuffix);
  return raw
    .replace(/\s*Talle\s+[\w\d]+.*$/i, '')
    .replace(/\s*\(Pack\)\s*$/i, '')
    .trim();
}

function packListingTitleForSize(baseTitle: string, size: string): string {
  const base = String(baseTitle || '').trim() || 'Pack';
  const sz = String(size || '').trim() || 'U';
  if (base.toLowerCase().includes(`talle ${sz.toLowerCase()}`)) return base;
  return `${base} Talle ${sz}`;
}

/** family_name del pack (no el de la unidad origen): "Base Pack X3". */
function mlPackFamilyNameForListing(
  baseTitle: string,
  packItems?: PublicationBundleItem[],
  titleForInfer?: string
): string {
  const clean = String(baseTitle || '')
    .trim()
    .replace(/\s*Talle\s+.+$/i, '')
    .replace(/\s*\(Pack\)\s*$/i, '')
    .replace(/\s*Pack\s*X\d+\s*$/i, '')
    .trim();
  const units = inferPackUnitsPerSale(titleForInfer || clean, packItems);
  return `${clean || 'Pack'} Pack X${units}`;
}

function buildPackListingSellerCustomField(
  sourceItem: any,
  _skuSuffix: string,
  size: string
): string {
  let core = mlSkuFromItem(sourceItem);
  if (!core && Array.isArray(sourceItem?.attributes)) {
    const modelAttr = sourceItem.attributes.find(
      (a: any) => mlAttrIdUpper(a?.id) === 'MODEL'
    );
    core = String(modelAttr?.value_name ?? modelAttr?.value ?? '').trim();
  }
  core = (core || 'item')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const sizeCode = String(size || 'U')
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '');
  return `PACK-${core}-${sizeCode}`;
}

function mlFamilyNameFromItem(item: any): string {
  const direct = String(item?.family_name ?? '').trim();
  if (direct) return direct;
  const attr = (Array.isArray(item?.attributes) ? item.attributes : []).find(
    (a: any) => mlAttrIdUpper(a?.id) === 'FAMILY_NAME'
  );
  const fromAttr = (attr?.value_name ?? attr?.value ?? '').toString().trim();
  if (fromAttr) return fromAttr;
  if (item?.user_product_id != null && String(item.user_product_id).trim()) {
    const title = String(item?.title || '').trim();
    if (title) return title;
  }
  return '';
}

async function postMercadoLibreNewItem(
  accessToken: string,
  body: Record<string, unknown>,
  debugContext?: string,
  logExtra?: Record<string, unknown>
): Promise<any> {
  const payloadToSend = mlPayloadForMercadoLibreApiPost(body);
  const pics = payloadToSend.pictures;
  if (!Array.isArray(pics) || !pics.length) {
    throw new Error(
      'No hay fotos válidas para Mercado Libre (revisá que pictureId sea de imagen ML, no un atributo)'
    );
  }
  logMlItemCreateBeforePost(body, payloadToSend, debugContext, logExtra);

  const postRes = await axios.post('https://api.mercadolibre.com/items', payloadToSend, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    validateStatus: () => true
  });
  if (postRes.status !== 201 && postRes.status !== 200) {
    const cause = postRes.data?.cause;
    console.error('[ML] POST /items rechazado', {
      status: postRes.status,
      debugContext,
      message: postRes.data?.message,
      error: postRes.data?.error,
      data: postRes.data
    });
    console.error(
      '[ML] POST /items cause',
      JSON.stringify(cause, null, 2)
    );
    const preview = JSON.stringify(payloadToSend);
    throw new Error(
      `Mercado Libre rechazó la creación: ${formatMlCreateError(postRes)}. Payload enviado a ML: ${preview}`
    );
  }
  const newItem = postRes.data;
  const itemId = String(newItem?.id || '');
  if (!itemId) throw new Error('Mercado Libre no devolvió el ID de la nueva publicación');
  return newItem;
}

async function applyDescriptionFromSource(
  newItemId: string,
  sourceItem: any,
  accessToken: string,
  descriptionOverride?: string
): Promise<void> {
  let description = descriptionOverride?.trim() || '';
  if (!description) {
    try {
      const descRes = await axios.get(`https://api.mercadolibre.com/items/${sourceItem.id}/description`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true
      });
      if (descRes.status === 200) description = String(descRes.data?.plain_text || '').trim();
    } catch {
      /* opcional */
    }
  }
  await applyMlItemDescription(newItemId, description, accessToken);
}

/** Convierte variantes internas (label + items) al array `variations` de ML. */
async function buildMlPackVariations(
  sourceItem: any,
  packVariants: Array<{ label: string; items: PublicationBundleItem[] }>,
  opts: { skuSuffix: string; price: number }
): Promise<Array<Record<string, unknown>>> {
  if (!Number.isFinite(opts.price) || opts.price <= 0) {
    throw new Error('Indicá un precio válido para la publicación pack');
  }

  const rows = await Promise.all(
    packVariants.map(async (pv, idx) => {
      const stock = computeAvailableStockFromItems(pv.items);
      const comboLabel = (pv.label || `Combo ${idx + 1}`).trim();
      const { color, size } = await resolvePackVariantColorSize(pv.items, sourceItem, comboLabel);
      const varSku = buildPackListingSellerCustomField(sourceItem, opts.skuSuffix, size);
      return {
        price: opts.price,
        available_quantity: Math.max(0, Math.floor(stock)),
        attribute_combinations: buildMlPackVariationAttributeCombinations({ color, size }),
        seller_custom_field: varSku
      };
    })
  );

  const { variations: deduped, skippedKeys } = dedupeMlPackVariations(rows);
  if (skippedKeys.length) {
    console.warn(
      `[ML pack] Variaciones duplicadas COLOR/SIZE omitidas o fusionadas: ${skippedKeys.join(', ')}`
    );
  }

  assertValidMlPackVariations(
    deduped,
    packVariants.map((pv, i) => (pv.label || `Combo ${i + 1}`).trim())
  );
  return deduped;
}

async function buildMercadoLibrePackListingBodyClassic(
  sourceItem: any,
  packVariants: Array<{ label: string; items: PublicationBundleItem[] }>,
  opts: {
    titleSuffix: string;
    skuSuffix: string;
    status?: 'active' | 'paused';
    content?: PackListingPublicationContent;
  }
): Promise<Record<string, unknown>> {
  if (!packVariants.length) throw new Error('Agregá al menos una combinación de colores');

  const pictures = mlPicturesPayload(opts.content, sourceItem);
  if (!pictures.length) throw new Error('Seleccioná al menos una foto para la publicación');

  const title =
    opts.content?.title?.trim() ||
    appendTitleSuffix(String(sourceItem.title || 'Pack'), opts.titleSuffix);
  const price =
    opts.content?.price != null && Number.isFinite(Number(opts.content.price))
      ? Number(opts.content.price)
      : Number(sourceItem.price) || 0;

  const variations = await buildMlPackVariations(sourceItem, packVariants, {
    skuSuffix: opts.skuSuffix,
    price
  });

  const itemQty = variations.reduce(
    (sum, v) => sum + Math.max(0, Number(v.available_quantity) || 0),
    0
  );

  const allPackItems = packVariants.flatMap((pv) => pv.items);
  const attrs = mlItemAttributesForPackListing(sourceItem, opts.skuSuffix, title, allPackItems, {
    withVariations: true
  });
  const listing = mlListingFieldsFromSourceItem(sourceItem);
  const pictureRows = sanitizeMlPicturesForApi(pictures);

  const draft: Record<string, unknown> = {
    category_id: listing.category_id,
    currency_id: listing.currency_id,
    buying_mode: listing.buying_mode,
    listing_type_id: listing.listing_type_id,
    condition: listing.condition,
    title,
    price,
    available_quantity: itemQty,
    pictures: pictureRows,
    attributes: attrs,
    sourceAttributes: sourceItem?.attributes,
    variations
  };
  if (listing.video_id) draft.video_id = listing.video_id;
  if (listing.sale_terms) draft.sale_terms = listing.sale_terms;
  if (listing.shipping) draft.shipping = listing.shipping;
  if (opts.status === 'paused') draft.status = 'paused';

  return draft;
}

/** User Product: una publicación por talle, con family_name y sin variations. */
async function mlMercadoLibreSellerId(sourceItem: any, accessToken: string): Promise<string> {
  const fromItem = String(sourceItem?.seller_id ?? '').trim();
  if (fromItem) return fromItem;
  try {
    const res = await axios.get('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true
    });
    if (res.status === 200 && res.data?.id != null) return String(res.data.id);
  } catch {
    /* opcional */
  }
  return '';
}

async function buildMercadoLibrePackListingBodyUserProductSingle(
  sourceItem: any,
  packVariant: { label: string; items: PublicationBundleItem[] },
  opts: {
    titleSuffix: string;
    skuSuffix: string;
    status?: 'active' | 'paused';
    content?: PackListingPublicationContent;
    baseTitle: string;
    packFamilyName: string;
    accessToken: string;
    sellerId?: string;
  }
): Promise<Record<string, unknown>> {
  const pictures = mlPicturesPayload(opts.content, sourceItem);
  if (!pictures.length) throw new Error('Seleccioná al menos una foto para la publicación');

  const price =
    opts.content?.price != null && Number.isFinite(Number(opts.content.price))
      ? Number(opts.content.price)
      : Number(sourceItem.price) || 0;
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Indicá un precio válido para la publicación pack');
  }

  const comboLabel = (packVariant.label || '').trim();
  const { size } = await resolvePackVariantColorSize(
    packVariant.items,
    sourceItem,
    comboLabel
  );
  const itemQty = Math.max(0, Math.floor(computeAvailableStockFromItems(packVariant.items)));
  const sellerField = buildPackListingSellerCustomField(sourceItem, opts.skuSuffix, size);

  let attrs = mlItemAttributesForPackListing(
    sourceItem,
    opts.skuSuffix,
    opts.baseTitle,
    packVariant.items,
    { withVariations: false }
  );

  const sellerId =
    String(opts.sellerId ?? '').trim() ||
    (await mlMercadoLibreSellerId(sourceItem, opts.accessToken));
  const fashionAttrs = await mlUserProductFashionAttrsFromSource(
    sourceItem,
    size,
    opts.accessToken,
    sellerId,
    opts.packFamilyName
  );
  for (const fa of fashionAttrs) {
    attrs = upsertMlCreateAttribute(attrs, fa);
  }

  const listing = mlListingFieldsFromSourceItem(sourceItem);
  const pictureRows = sanitizeMlPicturesForApi(pictures);

  const draft: Record<string, unknown> = {
    category_id: listing.category_id,
    currency_id: listing.currency_id,
    buying_mode: listing.buying_mode,
    listing_type_id: listing.listing_type_id,
    condition: listing.condition,
    family_name: opts.packFamilyName,
    price,
    available_quantity: itemQty,
    pictures: pictureRows,
    attributes: attrs,
    sourceAttributes: sourceItem?.attributes,
    seller_custom_field: sellerField,
    userProduct: true
  };
  if (listing.video_id) draft.video_id = listing.video_id;
  if (listing.sale_terms) draft.sale_terms = listing.sale_terms;
  if (listing.shipping) draft.shipping = listing.shipping;
  if (opts.status === 'paused') draft.status = 'paused';

  return draft;
}

async function createMercadoLibrePackListingUserProduct(
  sourceItem: any,
  packVariants: Array<{ label: string; items: PublicationBundleItem[] }>,
  opts: {
    titleSuffix: string;
    skuSuffix: string;
    status?: 'active' | 'paused';
    content?: PackListingPublicationContent;
  }
): Promise<{ itemId: string; item: any; variationIds: string[] }> {
  const mlToken = await getValidMLToken();
  if (!mlToken) throw new Error('No hay integración con Mercado Libre');
  if (!packVariants.length) throw new Error('Agregá al menos una combinación de colores');

  const baseTitle = packListingBaseTitle(sourceItem, opts);
  const allPackItems = packVariants.flatMap((pv) => pv.items);
  const packFamilyName = mlPackFamilyNameForListing(baseTitle, allPackItems, baseTitle);
  const sellerId = await mlMercadoLibreSellerId(sourceItem, mlToken.access_token);
  const listingIds: string[] = [];
  let lastItem: any = null;

  console.log(
    `[ML pack User Product] Creando ${packVariants.length} publicación(es) separada(s) (sin variations). pack family_name="${packFamilyName}"`
  );

  for (let idx = 0; idx < packVariants.length; idx++) {
    const pv = packVariants[idx];
    const comboLabel = (pv.label || `Combo ${idx + 1}`).trim();
    const { size } = await resolvePackVariantColorSize(pv.items, sourceItem, comboLabel);

    const body = await buildMercadoLibrePackListingBodyUserProductSingle(sourceItem, pv, {
      ...opts,
      baseTitle,
      packFamilyName,
      accessToken: mlToken.access_token,
      sellerId
    });

    const newItem = await postMercadoLibreNewItem(
      mlToken.access_token,
      body,
      `user_product pack ${idx + 1}/${packVariants.length}`,
      {
        user_product_mode: true,
        removed_variations: true,
        removed_title_for_user_product: true,
        publishing_size: size,
        pack_combo_label: comboLabel
      }
    );
    const itemId = String(newItem.id);
    listingIds.push(itemId);
    lastItem = newItem;
    await applyDescriptionFromSource(itemId, sourceItem, mlToken.access_token, opts.content?.description);
  }

  return { itemId: listingIds[0], item: lastItem, variationIds: listingIds };
}

export type MlFashionGridPreviewRow = {
  variationId?: string;
  sizeDisplay: string;
  sizeGridRowId: string;
  sizeAttribute: string;
};

export type MlFashionGridPreview = {
  sizeGridId: string;
  familyName?: string;
  sourceSellerId?: string;
  integrationSellerId?: string;
  sellerMatchesIntegration: boolean;
  sellerWarning?: string;
  rows: MlFashionGridPreviewRow[];
};

/** Vista previa de guía de talles que se copiará al crear el pack (misma MLA origen). */
export function buildMlFashionGridPreview(
  sourceItem: any,
  integrationSellerId?: string
): MlFashionGridPreview | null {
  const sizeGridId = mlSourceSizeGridId(sourceItem);
  if (!sizeGridId) return null;

  const sourceSellerId = String(sourceItem?.seller_id ?? '').trim();
  const tokenSeller = String(integrationSellerId ?? '').trim();
  const sellerMatchesIntegration =
    !sourceSellerId || !tokenSeller || sourceSellerId === tokenSeller;

  const rows: MlFashionGridPreviewRow[] = [];
  const variations = Array.isArray(sourceItem?.variations) ? sourceItem.variations : [];

  for (const v of variations) {
    const rowAttr = mlPickCreateAttributeFromList(v?.attributes, 'SIZE_GRID_ROW_ID');
    const rowId = String(rowAttr?.value_name ?? rowAttr?.value_id ?? '').trim();
    if (!rowId) continue;
    const sizeAttr = mlPickCreateAttributeFromList(v?.attributes, 'SIZE');
    const ac = Array.isArray(v?.attribute_combinations) ? v.attribute_combinations : [];
    const sizeAc = ac.find((a: any) => ML_SIZE_ATTR_IDS.has(mlAttrIdUpper(a?.id)));
    const sizeDisplay = String(sizeAc?.value_name ?? sizeAttr?.value_name ?? '').trim() || '—';
    rows.push({
      variationId: v?.id != null ? String(v.id) : undefined,
      sizeDisplay,
      sizeGridRowId: rowId,
      sizeAttribute: String(sizeAttr?.value_name ?? sizeDisplay)
    });
  }

  if (!rows.length) {
    const rowAttr = mlPickCreateAttributeFromList(sourceItem?.attributes, 'SIZE_GRID_ROW_ID');
    const sizeAttr = mlPickCreateAttributeFromList(sourceItem?.attributes, 'SIZE');
    const rowId = String(rowAttr?.value_name ?? rowAttr?.value_id ?? '').trim();
    if (rowId) {
      rows.push({
        sizeDisplay: String(sizeAttr?.value_name ?? '—'),
        sizeGridRowId: rowId,
        sizeAttribute: String(sizeAttr?.value_name ?? '—')
      });
    }
  }

  return {
    sizeGridId,
    familyName: mlFamilyNameFromItem(sourceItem) || undefined,
    sourceSellerId: sourceSellerId || undefined,
    integrationSellerId: tokenSeller || undefined,
    sellerMatchesIntegration,
    sellerWarning: sellerMatchesIntegration
      ? undefined
      : `La publicación origen es del vendedor ${sourceSellerId} y la cuenta conectada es ${tokenSeller}. La guía puede fallar al publicar.`,
    rows
  };
}

export type PublicationSourcePreview = {
  platform: PublicationBundlePlatform;
  resolvedId: string;
  title: string;
  description: string;
  images: PreviewImageDto[];
  price?: number;
  fashionGrid?: MlFashionGridPreview;
};

function localizedTnText(field: unknown): string {
  if (field == null) return '';
  if (typeof field === 'string') return field.trim();
  if (typeof field === 'object') {
    const o = field as Record<string, unknown>;
    for (const k of ['es', 'es_AR', 'en', 'pt']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    const first = Object.values(o).find((v) => typeof v === 'string' && String(v).trim());
    if (typeof first === 'string') return first.trim();
  }
  return '';
}

export async function fetchPublicationSourcePreview(
  platform: PublicationBundlePlatform,
  rawId: string
): Promise<PublicationSourcePreview | null> {
  const id = String(rawId || '').trim();
  if (!id) return null;

  if (platform === 'mercadolibre') {
    const resolved = await fetchMercadoLibreItemResolved(id);
    if (!resolved) return null;
    const { item, itemId } = resolved;
    let description = '';
    const mlToken = await getValidMLToken();
    if (mlToken) {
      try {
        const descRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, {
          headers: { Authorization: `Bearer ${mlToken.access_token}` },
          validateStatus: () => true
        });
        if (descRes.status === 200) {
          description = (descRes.data?.plain_text ?? descRes.data?.text ?? '').toString().trim();
        }
      } catch {
        /* sin descripción */
      }
    }
    if (!description && item.subtitle) description = String(item.subtitle).trim();
    const images = collectMlPicturesFromItem(item);
    const fashionGrid = buildMlFashionGridPreview(item, mlToken?.user_id);
    return {
      platform: 'mercadolibre',
      resolvedId: itemId,
      title: String(item.title || '').trim(),
      description,
      images,
      price: Number(item.price) || undefined,
      fashionGrid: fashionGrid ?? undefined
    };
  }

  const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
  if (!integration?.access_token) return null;
  const storeId = integration.store_id || integration.user_id;
  if (!storeId) return null;
  const tnId = id.replace(/\D/g, '') || id;
  const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
  const productRes = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${tnId}`, {
    headers,
    validateStatus: () => true
  });
  if (productRes.status !== 200 || !productRes.data) return null;
  const p = productRes.data;
  const description = localizedTnText(p.description) || localizedTnText(p.seo_description);
  const images: PreviewImageDto[] = (Array.isArray(p.images) ? p.images : [])
    .map((im: any) => {
      const url = im?.src ? String(im.src).trim() : '';
      return url.startsWith('http') ? { url, pictureId: im?.id != null ? String(im.id) : undefined } : null;
    })
    .filter(Boolean) as PreviewImageDto[];
  const variants = await fetchAllTnVariants(storeId, integration.access_token, String(tnId));
  const price = variants[0]?.price != null ? Number(variants[0].price) : undefined;
  return {
    platform: 'tiendanube',
    resolvedId: String(p.id ?? tnId),
    title: localizedTnText(p.name),
    description,
    images,
    price: Number.isFinite(price) ? price : undefined
  };
}

const COLOR_COMBO_SEPARATORS = /\s*(?:[-/·,+|\\]| y | e | x |\s\+\s)\s*/gi;
const ASSORTED_COLOR_PATTERN = /^(?:surtido|surtidos|variado|variados|varios|mix|combo|multicolor|assorted|aleatorio)$/i;

/** Parte un nombre de variación como "Negro-Gris-Blanco" en colores individuales. */
export function splitColorComboLabel(raw: string): string[] {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return [];
  if (ASSORTED_COLOR_PATTERN.test(trimmed)) return [];
  const parts = trimmed
    .split(COLOR_COMBO_SEPARATORS)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [trimmed];
  return parts;
}

export type ListingPackVariation = {
  variationId: string;
  /** Ítem ML real (en User Product / MLAU cada combo suele ser un MLA aparte). */
  itemId?: string;
  colorValueName: string;
  sizeValueName: string;
  parsedColors: string[];
  isAssorted: boolean;
  sku?: string;
  availableQuantity?: number;
  pictureIds?: string[];
};

export type ListingPackVariationsResponse = {
  platform: PublicationBundlePlatform;
  resolvedId: string;
  title: string;
  variations: ListingPackVariation[];
};

function tnVariantColorSize(variant: any): { color: string; size: string } {
  const values = Array.isArray(variant?.values) ? variant.values : [];
  if (values.length === 0) return { color: '', size: '' };
  const labels = values.map((v: any) => localizedTnText(v));
  const color = labels[0] || '';
  const size = labels[1] || '';
  return { color, size };
}

function mlColorSizeFromItem(item: any): { color: string; size: string } {
  let color = '';
  let size = '';
  for (const attr of Array.isArray(item?.attributes) ? item.attributes : []) {
    const id = mlAttrIdUpper(attr?.id);
    const name = (attr?.value_name || attr?.name || '').toString().trim();
    if (!name) continue;
    if (ML_COLOR_ATTR_IDS.has(id)) color = name;
    if (ML_SIZE_ATTR_IDS.has(id)) size = name;
  }
  const variations = Array.isArray(item?.variations) ? item.variations : [];
  if ((!color || !size) && variations[0]) {
    const fromVar = mlColorSizeFromVariation(variations[0], String(item?.title || ''));
    if (!color) color = fromVar.color;
    if (!size) size = fromVar.size;
  }
  if ((!color || !size) && item?.title) {
    const parsed = mlColorSizeFromTitle(String(item.title));
    if (!color) color = parsed.color;
    if (!size) size = parsed.size;
  }
  return { color: color || 'Único', size: size || 'U' };
}

function listingPackVariationFromColorSize(opts: {
  color: string;
  size: string;
  variationId?: string;
  itemId?: string;
  sku?: string;
  availableQuantity?: number;
  pictureIds?: string[];
}): ListingPackVariation {
  const rawColor = String(opts.color || '').trim();
  const parsed = splitColorComboLabel(rawColor);
  const isAssorted = parsed.length === 0 && rawColor.length > 0;
  return {
    variationId: opts.variationId != null ? String(opts.variationId) : '',
    itemId: opts.itemId ? String(opts.itemId).trim() : undefined,
    colorValueName: rawColor,
    sizeValueName: String(opts.size || '').trim(),
    parsedColors: parsed,
    isAssorted,
    sku: opts.sku,
    availableQuantity: opts.availableQuantity,
    pictureIds: opts.pictureIds
  };
}

async function fetchMlUserProductChildPackVariations(
  userProductId: string,
  accessToken: string,
  sellerId: string | number
): Promise<{ title: string; resolvedId: string; variations: ListingPackVariation[] } | null> {
  const upResolved = await resolveMercadoLibreUserProductItems(
    userProductId,
    sellerId,
    accessToken
  );
  const rawIds = upResolved.debug.rawItemIds.length
    ? upResolved.debug.rawItemIds
    : upResolved.itemCandidates;
  if (!rawIds.length) return null;

  const out: ListingPackVariation[] = [];
  const seenItems = new Set<string>();
  let title = '';
  let resolvedId = userProductId;

  for (const candidate of rawIds) {
    const item = await fetchMercadoLibreItemById(candidate, accessToken);
    if (!item) continue;
    const itemId = normalizeMercadoLibreItemId(item.id) || String(item.id || candidate).trim();
    if (!itemId || seenItems.has(itemId)) continue;
    seenItems.add(itemId);
    if (!title && item.title) title = String(item.title).trim();
    resolvedId = itemId;

    const variations = Array.isArray(item.variations) ? item.variations : [];
    // User Product: cada ítem hijo suele ser 0–1 variación (un combo). Tratarlo como publicación entera.
    if (variations.length <= 1) {
      const fromItem = mlColorSizeFromItem(item);
      const v0 = variations[0];
      const sku =
        (v0?.seller_custom_field && String(v0.seller_custom_field).trim()) ||
        (item?.seller_custom_field && String(item.seller_custom_field).trim()) ||
        undefined;
      out.push(
        listingPackVariationFromColorSize({
          color: fromItem.color,
          size: fromItem.size,
          // Vacío: el stock se sincroniza al ítem MLA, no a variation_id
          variationId: '',
          itemId,
          sku,
          availableQuantity:
            v0?.available_quantity != null
              ? Number(v0.available_quantity)
              : item?.available_quantity != null
                ? Number(item.available_quantity)
                : undefined,
          pictureIds: Array.isArray(v0?.picture_ids)
            ? v0.picture_ids.map((p: any) => String(p)).filter(Boolean)
            : undefined
        })
      );
      continue;
    }

    const enriched = await enrichMercadoLibreItemVariations(item, accessToken);
    for (const v of Array.isArray(enriched?.variations) ? enriched.variations : variations) {
      const { color, size } = mlColorSizeFromVariation(v, String(item?.title || ''));
      out.push(
        listingPackVariationFromColorSize({
          color,
          size,
          variationId: v?.id != null ? String(v.id) : '',
          itemId,
          sku: v?.seller_custom_field ? String(v.seller_custom_field).trim() : undefined,
          availableQuantity:
            v?.available_quantity != null ? Number(v.available_quantity) : undefined,
          pictureIds: Array.isArray(v?.picture_ids)
            ? v.picture_ids.map((p: any) => String(p)).filter(Boolean)
            : undefined
        })
      );
    }
  }

  if (!out.length) return null;
  return { title, resolvedId: userProductId || resolvedId, variations: out };
}

export async function fetchListingPackVariations(
  platform: PublicationBundlePlatform,
  rawId: string
): Promise<ListingPackVariationsResponse | null> {
  const id = String(rawId || '').trim();
  if (!id) return null;

  if (platform === 'mercadolibre') {
    const normalized = normalizeMercadoLibreItemId(id);
    const mlToken = await getValidMLToken();
    if (!mlToken) return null;

    // MLAU / User Product: expandir todos los MLA hijos (1 ítem = 1 combo del pack).
    if (/^MLAU\d+$/i.test(normalized)) {
      const expanded = await fetchMlUserProductChildPackVariations(
        normalized,
        mlToken.access_token,
        mlToken.user_id
      );
      if (!expanded) return null;
      return {
        platform: 'mercadolibre',
        resolvedId: expanded.resolvedId,
        title: expanded.title,
        variations: expanded.variations
      };
    }

    const resolved = await fetchMercadoLibreItemResolved(id);
    if (!resolved) return null;
    const { item, itemId, userProductId } = resolved;

    // Si el ítem pertenece a un UP con varios hermanos, preferir expandir el UP completo.
    const upId =
      (userProductId && String(userProductId).trim()) ||
      (item?.user_product_id != null ? String(item.user_product_id).trim() : '');
    if (/^MLAU\d+$/i.test(upId)) {
      const expanded = await fetchMlUserProductChildPackVariations(
        upId,
        mlToken.access_token,
        mlToken.user_id
      );
      if (expanded && expanded.variations.length > 1) {
        return {
          platform: 'mercadolibre',
          resolvedId: upId,
          title: expanded.title || String(item?.title || '').trim(),
          variations: expanded.variations
        };
      }
    }

    const variations = Array.isArray(item?.variations) ? item.variations : [];
    const out: ListingPackVariation[] = variations.map((v: any) => {
      const { color, size } = mlColorSizeFromVariation(v, String(item?.title || ''));
      return listingPackVariationFromColorSize({
        color,
        size,
        variationId: v?.id != null ? String(v.id) : '',
        itemId,
        sku: v?.seller_custom_field ? String(v.seller_custom_field).trim() : undefined,
        availableQuantity:
          v?.available_quantity != null ? Number(v.available_quantity) : undefined,
        pictureIds: Array.isArray(v?.picture_ids)
          ? v.picture_ids.map((p: any) => String(p)).filter(Boolean)
          : undefined
      });
    });
    return {
      platform: 'mercadolibre',
      resolvedId: itemId,
      title: String(item?.title || '').trim(),
      variations: out.filter((v) => v.variationId || v.itemId)
    };
  }

  const integration = await get(
    `SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`
  );
  if (!integration?.access_token) return null;
  const storeId = integration.store_id || integration.user_id;
  if (!storeId) return null;
  const tnId = id.replace(/\D/g, '') || id;
  const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
  const productRes = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${tnId}`, {
    headers,
    validateStatus: () => true
  });
  if (productRes.status !== 200 || !productRes.data) return null;
  const tnVariants = await fetchAllTnVariants(storeId, integration.access_token, String(tnId));
  const out: ListingPackVariation[] = tnVariants.map((v: any) => {
    const { color, size } = tnVariantColorSize(v);
    return listingPackVariationFromColorSize({
      color,
      size,
      variationId: v?.id != null ? String(v.id) : '',
      sku: v?.sku ? String(v.sku).trim() : undefined,
      availableQuantity: v?.stock != null ? Number(v.stock) : undefined
    });
  });
  return {
    platform: 'tiendanube',
    resolvedId: String(productRes.data?.id ?? tnId),
    title: localizedTnText(productRes.data?.name),
    variations: out.filter((v) => v.variationId)
  };
}

/** Completa attributes de cada variación (el GET del ítem a veces no los trae). */
async function enrichMercadoLibreItemVariations(item: any, accessToken: string): Promise<any> {
  const itemId = String(item?.id || '').trim();
  const variations = Array.isArray(item?.variations) ? item.variations : [];
  if (!itemId || variations.length < 1) return item;

  const headers = { Authorization: `Bearer ${accessToken}` };
  let changed = false;
  const enriched = await Promise.all(
    variations.map(async (v: any) => {
      const hasRow = mlPickCreateAttributeFromList(v?.attributes, 'SIZE_GRID_ROW_ID');
      const rowOk =
        Boolean(hasRow?.value_name) ||
        (hasRow?.value_id != null && String(hasRow.value_id).includes(':'));
      if (rowOk) return v;

      const vid = v?.id;
      if (vid == null) return v;
      try {
        const r = await axios.get(`https://api.mercadolibre.com/items/${itemId}/variations/${vid}`, {
          headers,
          validateStatus: () => true
        });
        if (r.status === 200 && r.data) {
          changed = true;
          return {
            ...v,
            attribute_combinations: v.attribute_combinations ?? r.data.attribute_combinations,
            attributes: r.data.attributes ?? v.attributes
          };
        }
      } catch {
        /* opcional */
      }
      return v;
    })
  );
  return changed ? { ...item, variations: enriched } : item;
}

async function fetchMercadoLibreItemById(
  candidate: string,
  accessToken: string
): Promise<any | null> {
  const id = String(candidate || '').trim();
  if (!id) return null;
  try {
    const r = await axios.get(`https://api.mercadolibre.com/items/${encodeURIComponent(id)}`, {
      params: { include_attributes: 'all' },
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true
    });
    if (r.status === 200 && r.data && !r.data.error) return r.data;
  } catch {
    /* siguiente candidato */
  }
  return null;
}

export async function fetchMercadoLibreItemResolved(
  rawItemId: string
): Promise<{ item: any; itemId: string; userProductId?: string } | null> {
  const mlToken = await getValidMLToken();
  if (!mlToken) return null;
  const normalized = normalizeMercadoLibreItemId(rawItemId);
  const candidates = mercadoLibreItemIdCandidates(rawItemId);
  if (!normalized && !candidates.length) return null;

  const accessToken = mlToken.access_token;
  const sellerId = mlToken.user_id;

  const finish = async (
    raw: any,
    candidate: string,
    userProductId?: string
  ): Promise<{ item: any; itemId: string; userProductId?: string } | null> => {
    if (!raw) return null;
    const item = await enrichMercadoLibreItemVariations(raw, accessToken);
    return {
      item,
      itemId: String(item.id || candidate),
      userProductId: userProductId || undefined
    };
  };

  const tryCandidates = async (ids: string[], userProductId?: string) => {
    const seen = new Set<string>();
    for (const candidate of ids) {
      const c = String(candidate || '').trim();
      if (!c || seen.has(c)) continue;
      seen.add(c);
      const raw = await fetchMercadoLibreItemById(c, accessToken);
      const done = await finish(raw, c, userProductId);
      if (done) return done;
    }
    return null;
  };

  // MLAU = user_product_id: buscar ítems del vendedor (GET /items/MLAU... suele fallar).
  if (/^MLAU\d+$/i.test(normalized)) {
    const upResolved = await resolveMercadoLibreUserProductItems(
      normalized,
      sellerId,
      accessToken
    );
    console.log('[ML pack] Resolviendo MLAU', {
      userProductId: normalized,
      itemCandidates: upResolved.itemCandidates.length,
      debug: upResolved.debug
    });
    const fromUp = await tryCandidates(upResolved.itemCandidates, normalized);
    if (fromUp) return fromUp;
  }

  const direct = await tryCandidates(candidates);
  if (direct) return direct;

  const catalogIds = await resolveMercadoLibreCatalogProductItems(String(rawItemId || ''), accessToken);
  const fromCatalog = await tryCandidates(catalogIds);
  if (fromCatalog) return fromCatalog;

  if (normalized && !/^MLAU\d+$/i.test(normalized)) {
    const upResolved = await resolveMercadoLibreUserProductItems(normalized, sellerId, accessToken);
    const fromUp = await tryCandidates(upResolved.itemCandidates, /^MLAU/i.test(normalized) ? normalized : undefined);
    if (fromUp) return fromUp;
  }

  return null;
}

export async function createMercadoLibrePackListingFromItem(
  sourceItem: any,
  opts: {
    titleSuffix: string;
    skuSuffix: string;
    availableQuantity: number;
    status?: 'active' | 'paused';
    content?: PackListingPublicationContent;
    packItems?: PublicationBundleItem[];
    packLabel?: string;
  }
): Promise<{ itemId: string; item: any }> {
  const created = await createMercadoLibrePackListingWithVariants(
    sourceItem,
    [{ label: (opts.packLabel || '').trim(), items: opts.packItems || [] }],
    {
      titleSuffix: opts.titleSuffix,
      skuSuffix: opts.skuSuffix,
      status: opts.status,
      content: opts.content
    }
  );
  return { itemId: created.itemId, item: created.item };
}

export async function createMercadoLibrePackListingWithVariants(
  sourceItem: any,
  packVariants: Array<{ label: string; items: PublicationBundleItem[] }>,
  opts: {
    titleSuffix: string;
    skuSuffix: string;
    status?: 'active' | 'paused';
    content?: PackListingPublicationContent;
  }
): Promise<{ itemId: string; item: any; variationIds: string[] }> {
  const mlToken = await getValidMLToken();
  if (!mlToken) throw new Error('No hay integración con Mercado Libre');
  if (!packVariants.length) throw new Error('Agregá al menos una combinación de colores');

  if (mlItemUsesFamilyNameModel(sourceItem)) {
    return createMercadoLibrePackListingUserProduct(sourceItem, packVariants, opts);
  }

  try {
    const body = await buildMercadoLibrePackListingBodyClassic(sourceItem, packVariants, opts);
    const newItem = await postMercadoLibreNewItem(
      mlToken.access_token,
      body,
      `pack classic variations=${packVariants.length}`,
      { user_product_mode: false, removed_variations: false }
    );
    const itemId = String(newItem.id);
    const variationIds = (Array.isArray(newItem.variations) ? newItem.variations : []).map((v: any) =>
      String(v?.id || '')
    );
    await applyDescriptionFromSource(itemId, sourceItem, mlToken.access_token, opts.content?.description);
    return { itemId, item: newItem, variationIds };
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (!mlCreateErrorRequiresUserProduct(msg)) throw err;
    console.warn(
      '[ML pack] ML exigió User Product (family_name sin variations). Reintentando una publicación por talle.'
    );
    return createMercadoLibrePackListingUserProduct(sourceItem, packVariants, opts);
  }
}

function tnImagesFromContent(
  content?: PackListingPublicationContent,
  product?: any
): Array<{ src: string }> {
  if (content?.pictures?.length) {
    const imgs = content.pictures
      .filter((p) => p.selected !== false)
      .map((p) => String(p.url || '').trim())
      .filter((u) => u.startsWith('http'))
      .map((src) => ({ src }));
    if (imgs.length) return imgs;
  }
  return (Array.isArray(product?.images) ? product.images : [])
    .map((im: any) => (im?.src ? { src: String(im.src) } : null))
    .filter(Boolean) as Array<{ src: string }>;
}

function tnDescriptionFromContent(content?: PackListingPublicationContent, product?: any): Record<string, string> {
  const text = content?.description?.trim();
  if (text) return { es: text, en: text, pt: text };
  const base = product?.description;
  if (base && typeof base === 'object') return { ...base };
  if (typeof base === 'string' && base.trim()) return { es: base.trim(), en: '', pt: '' };
  return { es: '', en: '', pt: '' };
}

function appendSuffixToLocalizedName(field: any, suffix: string): any {
  if (!suffix) return field;
  if (field == null) return field;
  if (typeof field === 'string') return `${field}${suffix}`;
  if (typeof field === 'object') {
    const out: Record<string, string> = { ...field };
    for (const k of Object.keys(out)) {
      const v = out[k];
      if (typeof v === 'string' && v.trim()) out[k] = `${v}${suffix}`;
    }
    return out;
  }
  return field;
}

function tiendaNubeCategoryIdsOnly(raw: any): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c: any) => (typeof c === 'object' && c != null ? c.id : c))
    .filter((id: any) => id != null && String(id).trim() !== '')
    .map((id: any) => Number(id))
    .filter((n: number) => Number.isFinite(n));
}

function stripVariantForTiendaNubeCreate(v: any, skuSuffix: string, idx: number, stock: number): any {
  const baseSku =
    v?.sku != null && String(v.sku).trim() !== '' ? String(v.sku).trim() : `VAR-${idx + 1}`;
  return {
    price: v?.price != null ? String(v.price) : '0',
    stock_management: true,
    stock: Math.max(0, Math.floor(stock)),
    sku: `${baseSku}${skuSuffix}`,
    values: Array.isArray(v?.values) ? v.values : []
  };
}

async function fetchAllTnVariants(storeId: string, accessToken: string, productId: string): Promise<any[]> {
  const headers = { Authentication: `bearer ${accessToken}`, 'User-Agent': TN_USER_AGENT };
  let variantsList: any[] = [];
  let vPage = 1;
  let hasMore = true;
  while (hasMore) {
    const variantsRes = await axios.get(
      `https://api.tiendanube.com/v1/${storeId}/products/${productId}/variants`,
      { headers, params: { page: vPage, per_page: 200 }, validateStatus: () => true }
    );
    const chunk = variantsRes.status === 200 && Array.isArray(variantsRes.data) ? variantsRes.data : [];
    variantsList = variantsList.concat(chunk);
    if (chunk.length < 200) hasMore = false;
    else vPage++;
    if (vPage > 50) hasMore = false;
  }
  return variantsList;
}

export async function createTiendaNubePackListingFromProduct(
  sourceProductId: string,
  opts: {
    titleSuffix: string;
    skuSuffix: string;
    availableQuantity: number;
    published: boolean;
    content?: PackListingPublicationContent;
  }
): Promise<{ productId: number; variantId: number }> {
  const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
  if (!integration?.access_token) throw new Error('No hay integración con Tienda Nube');
  const storeId = integration.store_id || integration.user_id;
  if (!storeId) throw new Error('No se encontró store_id de Tienda Nube');

  const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
  const productRes = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${sourceProductId}`, {
    headers,
    validateStatus: () => true
  });
  if (productRes.status !== 200) {
    throw new Error('Producto no encontrado en Tienda Nube');
  }

  const p = productRes.data;
  const variantsList = await fetchAllTnVariants(storeId, integration.access_token, String(sourceProductId));
  const baseVariant = variantsList[0] || { price: '0', values: [] };
  const packVariant = stripVariantForTiendaNubeCreate(
    baseVariant,
    opts.skuSuffix,
    0,
    opts.availableQuantity
  );
  if (opts.content?.price != null && Number.isFinite(Number(opts.content.price))) {
    packVariant.price = String(opts.content.price);
  }

  const tnName = opts.content?.title?.trim()
    ? { es: opts.content.title.trim(), en: opts.content.title.trim(), pt: opts.content.title.trim() }
    : appendSuffixToLocalizedName(p.name, opts.titleSuffix);

  const body: any = {
    name: tnName,
    description: tnDescriptionFromContent(opts.content, p),
    attributes: Array.isArray(p.attributes) ? p.attributes : [],
    categories: tiendaNubeCategoryIdsOnly(p.categories),
    published: opts.published,
    free_shipping: !!p.free_shipping,
    tags: typeof p.tags === 'string' ? p.tags : '',
    variants: [packVariant]
  };
  if (p.brand != null && String(p.brand).trim() !== '') body.brand = p.brand;
  if (p.video_url && String(p.video_url).startsWith('https://')) body.video_url = p.video_url;
  const imgs = tnImagesFromContent(opts.content, p);
  if (imgs.length > 0) body.images = imgs.slice(0, 250);
  else throw new Error('Seleccioná al menos una imagen para la publicación');

  const url = `https://api.tiendanube.com/v1/${storeId}/products`;
  const postHeaders = { ...headers, 'Content-Type': 'application/json' };
  const r = await tnPostWithRetry(axios, url, body, { headers: postHeaders, validateStatus: () => true });
  if (r.status !== 201) {
    const detail = r.data?.description || r.data?.message || r.statusText;
    throw new Error(`Tienda Nube rechazó la creación: ${detail}`);
  }

  const newId = Number(r.data?.id);
  if (!Number.isFinite(newId)) throw new Error('Tienda Nube no devolvió el ID del nuevo producto');

  const newVariants = await fetchAllTnVariants(storeId, integration.access_token, String(newId));
  const variantId = Number(newVariants[0]?.id);
  if (!Number.isFinite(variantId)) {
    throw new Error('No se pudo obtener la variante del nuevo producto en Tienda Nube');
  }

  return { productId: newId, variantId };
}

export async function createTiendaNubePackListingWithVariants(
  sourceProductId: string,
  packVariants: Array<{ label: string; items: PublicationBundleItem[] }>,
  opts: {
    titleSuffix: string;
    skuSuffix: string;
    published: boolean;
    content?: PackListingPublicationContent;
  }
): Promise<{ productId: number; variantIds: number[] }> {
  const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
  if (!integration?.access_token) throw new Error('No hay integración con Tienda Nube');
  const storeId = integration.store_id || integration.user_id;
  if (!storeId) throw new Error('No se encontró store_id de Tienda Nube');

  const headers = { Authentication: `bearer ${integration.access_token}`, 'User-Agent': TN_USER_AGENT };
  const productRes = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${sourceProductId}`, {
    headers,
    validateStatus: () => true
  });
  if (productRes.status !== 200) throw new Error('Producto no encontrado en Tienda Nube');

  const p = productRes.data;
  const variantsList = await fetchAllTnVariants(storeId, integration.access_token, String(sourceProductId));
  const baseVariant = variantsList[0] || { price: '0', values: [] };
  const valueTemplate = Array.isArray(baseVariant.values) && baseVariant.values.length > 0 ? baseVariant.values : [];

  const basePrice =
    opts.content?.price != null && Number.isFinite(Number(opts.content.price))
      ? String(opts.content.price)
      : null;

  const attrNames = (Array.isArray(p.attributes) ? p.attributes : []).map((a: any) =>
    localizedTnText(a).toLowerCase()
  );
  const tnVariants = await Promise.all(
    packVariants.map(async (pv, idx) => {
      const stock = computeAvailableStockFromItems(pv.items);
      const comboLabel = (pv.label || `Combo ${idx + 1}`).trim();
      const { color, size } = await resolvePackVariantColorSize(pv.items, {}, comboLabel);
      const values =
        valueTemplate.length > 0
          ? valueTemplate.map((val: any, i: number) => {
              const attrLabel = attrNames[i] || '';
              let text = comboLabel;
              if (/color/i.test(attrLabel)) text = color;
              else if (/talle|talla|size/i.test(attrLabel)) text = size;
              else if (i === 0) text = color;
              else if (i === 1) text = size;
              return { ...val, es: text, en: text, pt: text };
            })
          : [
              { es: color, en: color, pt: color },
              { es: size, en: size, pt: size }
            ];
      const row = {
        ...stripVariantForTiendaNubeCreate(baseVariant, `${opts.skuSuffix}-${idx + 1}`, idx, stock),
        values
      };
      if (basePrice) row.price = basePrice;
      return row;
    })
  );

  const tnName = opts.content?.title?.trim()
    ? { es: opts.content.title.trim(), en: opts.content.title.trim(), pt: opts.content.title.trim() }
    : appendSuffixToLocalizedName(p.name, opts.titleSuffix);

  const body: any = {
    name: tnName,
    description: tnDescriptionFromContent(opts.content, p),
    attributes: Array.isArray(p.attributes) ? p.attributes : [],
    categories: tiendaNubeCategoryIdsOnly(p.categories),
    published: opts.published,
    free_shipping: !!p.free_shipping,
    tags: typeof p.tags === 'string' ? p.tags : '',
    variants: tnVariants
  };
  if (p.brand != null && String(p.brand).trim() !== '') body.brand = p.brand;
  const imgs = tnImagesFromContent(opts.content, p);
  if (imgs.length > 0) body.images = imgs.slice(0, 250);
  else throw new Error('Seleccioná al menos una imagen para la publicación');

  const url = `https://api.tiendanube.com/v1/${storeId}/products`;
  const postHeaders = { ...headers, 'Content-Type': 'application/json' };
  const r = await tnPostWithRetry(axios, url, body, { headers: postHeaders, validateStatus: () => true });
  if (r.status !== 201) {
    const detail = r.data?.description || r.data?.message || r.statusText;
    throw new Error(`Tienda Nube rechazó la creación: ${detail}`);
  }

  const newId = Number(r.data?.id);
  if (!Number.isFinite(newId)) throw new Error('Tienda Nube no devolvió el ID del nuevo producto');

  const newVariants = await fetchAllTnVariants(storeId, integration.access_token, String(newId));
  const variantIds = newVariants.map((v) => Number(v?.id)).filter((n) => Number.isFinite(n));
  return { productId: newId, variantIds };
}

async function bundleItemsWithStock(
  items: Array<{ variantId: string; unitsPerSale?: number }>
): Promise<PublicationBundleItem[]> {
  const out: PublicationBundleItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.variantId?.trim()) continue;
    const row = await get(
      `SELECT COALESCE(s.stock, 0) AS stock, pv.sku FROM product_variants pv
       LEFT JOIN stocks s ON s.variant_id = pv.id WHERE pv.id = ?`,
      [it.variantId.trim()]
    );
    out.push({
      id: '',
      variantId: it.variantId.trim(),
      unitsPerSale: Math.max(1, Math.floor(Number(it.unitsPerSale) || 1)),
      sortOrder: i,
      sku: row?.sku ?? '',
      stock: Number(row?.stock) || 0
    });
  }
  return out;
}

type PackVariantInput = {
  label?: string;
  items: Array<{ variantId: string; unitsPerSale?: number }>;
};

export async function createPackListingAndBundle(input: {
  platform: PublicationBundlePlatform;
  sourceExternalProductId: string;
  titleSuffix?: string;
  skuSuffix?: string;
  label?: string;
  published?: boolean;
  items?: Array<{ variantId: string; unitsPerSale?: number }>;
  variants?: PackVariantInput[];
  publicationContent?: PackListingPublicationContent;
}): Promise<{
  group: PublicationBundleGroup;
  newExternalProductId: string;
  sourceExternalProductId: string;
  message: string;
}> {
  const variantInputs: PackVariantInput[] =
    input.variants?.length
      ? input.variants
      : input.items?.length
        ? [{ label: input.label, items: input.items }]
        : [];
  if (!variantInputs.length) {
    throw new Error('Agregá al menos una combinación de colores (variante de pack)');
  }

  const titleSuffix = (input.titleSuffix ?? ' (Pack)').toString();
  const skuSuffix = (input.skuSuffix ?? '-PACK').toString();
  const sourceId = String(input.sourceExternalProductId || '').trim();
  if (!sourceId) throw new Error('Indicá la publicación individual de origen (ID o link)');

  const packVariants: Array<{ label: string; items: PublicationBundleItem[]; rawItems: PackVariantInput['items'] }> =
    [];
  for (let i = 0; i < variantInputs.length; i++) {
    const vi = variantInputs[i];
    const items = await bundleItemsWithStock(vi.items || []);
    if (!items.length) continue;
    packVariants.push({
      label: (vi.label || `Combo ${i + 1}`).trim(),
      items,
      rawItems: vi.items
    });
  }
  if (!packVariants.length) throw new Error('Cada variante debe tener al menos un color/componente');

  let newProductId = '';
  const bundleVariants: Array<{
    label: string;
    externalVariantId?: string;
    items: PackVariantInput['items'];
  }> = [];

  if (input.platform === 'mercadolibre') {
    const resolved = await fetchMercadoLibreItemResolved(sourceId);
    if (!resolved) throw new Error('Publicación origen no encontrada en Mercado Libre');

    if (packVariants.length === 1) {
      const created = await createMercadoLibrePackListingFromItem(resolved.item, {
        titleSuffix,
        skuSuffix,
        availableQuantity: computeAvailableStockFromItems(packVariants[0].items),
        status: input.published === false ? 'paused' : 'active',
        content: input.publicationContent,
        packItems: packVariants[0].items,
        packLabel: packVariants[0].label
      });
      newProductId = created.itemId;
      bundleVariants.push({
        label: packVariants[0].label,
        externalVariantId: '',
        items: packVariants[0].rawItems
      });
    } else {
      const created = await createMercadoLibrePackListingWithVariants(resolved.item, packVariants, {
        titleSuffix,
        skuSuffix,
        status: input.published === false ? 'paused' : 'active',
        content: input.publicationContent
      });

      const userProductMulti =
        mlItemUsesFamilyNameModel(resolved.item) && created.variationIds.length > 1;

      if (userProductMulti) {
        for (let idx = 0; idx < packVariants.length; idx++) {
          const mlaId = created.variationIds[idx];
          if (!mlaId) continue;
          await createPublicationBundle({
            platform: 'mercadolibre',
            externalProductId: mlaId,
            externalVariantId: '',
            label: packVariants[idx].label,
            items: packVariants[idx].rawItems
          });
        }
        const allBundles = [];
        for (const mlaId of created.variationIds) {
          allBundles.push(...(await findBundlesByProduct('mercadolibre', mlaId)));
        }
        return {
          group: {
            platform: 'mercadolibre',
            externalProductId: created.itemId,
            listingLabel: input.label?.trim() || null,
            variants: allBundles
          },
          newExternalProductId: created.itemId,
          sourceExternalProductId: normalizeMercadoLibreItemId(sourceId) || sourceId,
          message: `Se crearon ${packVariants.length} publicaciones ML (User Product, un talle por MLA): ${created.variationIds.join(', ')}`
        };
      }

      newProductId = created.itemId;
      packVariants.forEach((pv, idx) => {
        bundleVariants.push({
          label: pv.label,
          externalVariantId: created.variationIds[idx] || '',
          items: pv.rawItems
        });
      });
    }
  } else {
    const tnSourceId = sourceId.replace(/\D/g, '') || sourceId;
    if (packVariants.length === 1) {
      const created = await createTiendaNubePackListingFromProduct(tnSourceId, {
        titleSuffix,
        skuSuffix,
        availableQuantity: computeAvailableStockFromItems(packVariants[0].items),
        published: input.published !== false,
        content: input.publicationContent
      });
      newProductId = String(created.productId);
      bundleVariants.push({
        label: packVariants[0].label,
        externalVariantId: String(created.variantId),
        items: packVariants[0].rawItems
      });
    } else {
      const created = await createTiendaNubePackListingWithVariants(tnSourceId, packVariants, {
        titleSuffix,
        skuSuffix,
        published: input.published !== false,
        content: input.publicationContent
      });
      newProductId = String(created.productId);
      packVariants.forEach((pv, idx) => {
        bundleVariants.push({
          label: pv.label,
          externalVariantId: String(created.variantIds[idx] || ''),
          items: pv.rawItems
        });
      });
    }
  }

  const group = await savePublicationBundleGroup({
    platform: input.platform,
    externalProductId: newProductId,
    listingLabel: input.label?.trim() || null,
    variants: bundleVariants.map((v) => ({
      label: v.label,
      externalVariantId: v.externalVariantId,
      items: v.items
    }))
  });

  const n = group.variants.length;
  return {
    group,
    newExternalProductId: newProductId,
    sourceExternalProductId: normalizeMercadoLibreItemId(sourceId) || sourceId,
    message:
      input.platform === 'mercadolibre'
        ? `Publicación pack en ML (${newProductId}) con ${n} variante(s) de colores y mismas fotos`
        : `Producto pack en TN (${newProductId}) con ${n} variante(s) y mismas imágenes`
  };
}
