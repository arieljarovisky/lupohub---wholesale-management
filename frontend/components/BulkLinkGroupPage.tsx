import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Link,
  Loader2,
  History,
  Zap,
  CheckCircle2,
  AlertCircle,
  Circle,
  Search,
  Cloud,
  HelpCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Layers,
  Plus,
  Trash2,
  GitMerge,
  X,
  Unlink,
} from 'lucide-react';
import { api } from '../services/api';
import VariantExtraPublicationsPanel from './VariantExtraPublicationsPanel';
import { labelTalle, codigoTalleParaSku } from '../utils/tallesTango';
import { sizesAreBizDuplicatePair, sizesMatchForLink, getSizeCanonicalSet, colorsMatchForLink } from '../utils/inventoryUtils';
import { normalizeMercadoLibreItemId, mercadoLibreItemIdsMatch, mercadoLibreItemIdCandidates } from '../utils/mercadoLibreItemId';
import { normalizeTiendaNubeProductId } from '../utils/tiendaNubeUrl';

const INVENTORY_PRODUCT_FETCH_OPTS = { includeRelated: false } as const;

function formatSizeForLink(size: string | undefined | null): string {
  if (size == null || String(size).trim() === '') return '';
  const s = String(size).trim();
  if (/^\d{2,3}$/.test(s)) return labelTalle(s) || s;
  const code = codigoTalleParaSku(s);
  return code && code !== s ? `${code} - ${s}` : s;
}

function formatOptionLabel(item: { sku?: string; size?: string; color?: string; variationId?: string; variantId?: string }): string {
  const parts = [
    item.sku?.trim() || '',
    [formatSizeForLink(item.size), item.color].filter(Boolean).join(' / '),
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  const id = (item.variationId ?? item.variantId ?? '').toString().trim();
  return id ? `ID ${id}` : '—';
}

function formatMlOptionLabel(row: MlVariationRow): string {
  const label = formatOptionLabel(row);
  return label.startsWith('ID ') ? label : `${row.variationId} · ${label}`;
}

function dedupeMlCatalogRows(rows: MlVariationRow[]): MlVariationRow[] {
  const byKey = new Map<string, MlVariationRow>();
  for (const row of rows) {
    const source = normalizeMercadoLibreItemId(row.sourceId || '') || row.sourceId || '';
    const itemId = normalizeMercadoLibreItemId(row.itemId || '') || row.itemId;
    const key = `${source}::${itemId}::${row.variationId}`;
    const prev = byKey.get(key);
    if (!prev || (!prev.sku && row.sku) || (!prev.color && row.color) || (!prev.size && row.size)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

const norm = (s: string) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

const PACK_OPTIONS = [1, 2, 3, 6, 12] as const;

type RowLinkStatus = 'complete' | 'partial' | 'empty';

type PublicationSource = {
  id: string;
  variationCount?: number;
  loadError?: string;
  /** Precargado desde vínculos guardados al abrir el artículo */
  autoLoaded?: boolean;
  /** Unidades por venta en esta publicación (ej. pack x3 → 3) */
  packSize?: number;
};

type MlVariationRow = {
  itemId: string;
  variationId: string;
  sku: string;
  color: string;
  size: string;
  stock?: number;
  /** Publicación del Paso 1 desde la que se cargó (puede ser MLAU… distinto del itemId real) */
  sourceId?: string;
};

function variantHasStock(v: { stock?: number }): boolean {
  return Number(v.stock ?? 0) > 0;
}

type TnVariantRow = {
  productId: string;
  variantId: string;
  sku: string;
  color: string;
  size: string;
};

type VariantAssignment = {
  ml?: string;
  mlItemId?: string;
  /** Variación ML por publicación (itemId normalizado → variationId) */
  mlByItemId?: Record<string, string>;
  tn?: string;
  tnProductId?: string;
};

function mlItemKey(itemId: string): string {
  return normalizeMercadoLibreItemId(itemId) || itemId;
}

function getMlVariationForItem(a: VariantAssignment | undefined, itemId: string): string {
  if (!a) return '';
  const key = mlItemKey(itemId);
  if (a.mlByItemId?.[key]) return a.mlByItemId[key];
  if (
    a.mlItemId &&
    mercadoLibreItemIdsMatch(a.mlItemId, itemId) &&
    a.ml &&
    !isMercadoLibrePublicationId(a.ml)
  ) {
    return a.ml;
  }
  return '';
}

function setMlVariationForItem(
  a: VariantAssignment | undefined,
  itemId: string,
  variationId: string
): VariantAssignment {
  const key = mlItemKey(itemId);
  const mlByItemId = { ...(a?.mlByItemId || {}) };
  if (variationId) mlByItemId[key] = variationId;
  else delete mlByItemId[key];
  return {
    ...(a || {}),
    mlByItemId: Object.keys(mlByItemId).length > 0 ? mlByItemId : undefined,
  };
}

function primaryMlSourceItemId(sources: PublicationSource[]): string | null {
  if (sources.length === 0) return null;
  const x1 = sources.find((s) => Math.max(1, s.packSize ?? 1) === 1);
  const pick = x1 ?? sources[0];
  return mlItemKey(pick.id);
}

function syncPrimaryMlAssignment(
  a: VariantAssignment | undefined,
  sources: PublicationSource[]
): VariantAssignment {
  if (!a) return {};
  const primaryItem = primaryMlSourceItemId(sources);
  if (!primaryItem) return a;
  let variationId = getMlVariationForItem(a, primaryItem);
  // Si la variación quedó guardada bajo otro MLA de la misma ficha (User Product / color),
  // reutilizarla para la publicación canónica del Paso 1.
  if (!variationId) {
    const ml = (a.ml || '').trim();
    if (ml && !isMercadoLibrePublicationId(ml)) variationId = ml;
  }
  if (!variationId && sources.length === 1) {
    const fromMap = Object.values(a.mlByItemId || {}).find((v) => !!(v || '').trim());
    if (fromMap?.trim()) variationId = fromMap.trim();
  }
  if (!variationId) {
    return { ...a, ml: '', mlItemId: undefined };
  }
  const withSourceKey = setMlVariationForItem(a, primaryItem, variationId);
  const realItemId = (a.mlItemId && String(a.mlItemId).trim()) || primaryItem;
  return {
    ...withSourceKey,
    ml: variationId,
    mlItemId: normalizeMercadoLibreItemId(realItemId) || realItemId,
  };
}

function hasAnyMlAssignment(a: VariantAssignment | undefined): boolean {
  if (!a) return false;
  if (a.ml?.trim() && !isMercadoLibrePublicationId(a.ml)) return true;
  return Object.values(a.mlByItemId || {}).some((v) => !!v.trim());
}

function iterMlAssignmentKeys(a: VariantAssignment | undefined): string[] {
  if (!a) return [];
  const keys: string[] = [];
  if (a.mlByItemId) {
    for (const [itemId, variationId] of Object.entries(a.mlByItemId)) {
      const vid = variationId.trim();
      if (!vid) continue;
      const key = mlAssignmentKey(vid, itemId);
      if (key) keys.push(key);
    }
  }
  const ml = (a.ml || '').trim();
  if (ml && !isMercadoLibrePublicationId(ml)) {
    const key = mlAssignmentKey(ml, a.mlItemId);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

function primaryMlItemIdFromAssignment(a?: VariantAssignment): string | null {
  if (!a) return null;
  const ml = (a.ml || '').trim();
  if (/^ML[A-Z]{1,5}\d+$/i.test(ml)) return ml.toUpperCase();
  const item = (a.mlItemId || '').trim();
  return item || null;
}

function primaryMlItemIdFromVariantExternal(v: { externalIds?: { mercadoLibreItemId?: unknown } }): string | null {
  const own =
    v.externalIds?.mercadoLibreItemId != null && String(v.externalIds.mercadoLibreItemId).trim() !== ''
      ? String(v.externalIds.mercadoLibreItemId).trim()
      : '';
  if (!own) return null;
  return /^ML[A-Z]{1,5}\d+$/i.test(own) ? own.toUpperCase() : own;
}

function parseIdsFromInput(raw: string, platform: 'ml' | 'tn'): string[] {
  const parts = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const id =
      platform === 'ml' ? normalizeMercadoLibreItemId(part) : normalizeTiendaNubeProductId(part);
    if (!id) continue;
    if (platform === 'tn' && !/^\d+$/.test(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function matchLocalToRow(
  local: { sku: string; size: string; color: string },
  row: { sku?: string; size?: string; color?: string }
): boolean {
  const skuN = norm(local.sku);
  if (skuN && row.sku && norm(row.sku) === skuN) return true;
  const colorOk = colorsMatchForLink(local.color, row.color || '');
  if (!colorOk) return false;
  if (sizesMatchForLink(local.size, row.size || '')) return true;
  return norm(row.size || '') === norm(local.size);
}

function mlSourceIdKeys(ids: string[]): Set<string> {
  const keys = new Set<string>();
  for (const raw of ids) {
    for (const c of mercadoLibreItemIdCandidates(raw)) {
      keys.add(c.toLowerCase());
    }
  }
  return keys;
}

function mlRowBelongsToSource(row: MlVariationRow, sourceId: string): boolean {
  if (!sourceId) return true;
  if (row.sourceId && mercadoLibreItemIdsMatch(row.sourceId, sourceId)) return true;
  // Fallback: publicaciones MLA normales donde sourceId === itemId
  if (!row.sourceId && mercadoLibreItemIdsMatch(row.itemId, sourceId)) return true;
  return false;
}

function mlVariationsForSource(rows: MlVariationRow[], itemId: string): MlVariationRow[] {
  return rows.filter((m) => mlRowBelongsToSource(m, itemId));
}

function mlOptionKey(row: MlVariationRow): string {
  const itemId = normalizeMercadoLibreItemId(row.itemId || '') || row.itemId;
  return `${itemId}::${row.variationId}`;
}

function tnOptionKey(row: TnVariantRow): string {
  return `${row.productId}::${row.variantId}`;
}

function isMercadoLibrePublicationId(value: string): boolean {
  return /^ML[A-Z]{1,5}\d+$/i.test((value || '').trim());
}

function findMlCatalogMatchForLocal(
  local: { sku: string; size: string; color: string },
  mlList: MlVariationRow[],
  preferredItemId?: string
): MlVariationRow | null {
  const pref = (preferredItemId || '').trim();
  const pool = pref
    ? mlList.filter((m) => mercadoLibreItemIdsMatch(pref, m.itemId))
    : mlList;
  const scoped = pool.length > 0 ? pool : mlList;
  const skuN = norm(local.sku);
  let match = skuN ? scoped.find((m) => norm(m.sku) === skuN) : null;
  if (!match) {
    match = scoped.find((m) => matchLocalToRow(local, m)) || null;
  }
  return match;
}

function mlKeyUsedByOtherVariant(
  assignments: Record<string, VariantAssignment>,
  variantId: string,
  key: string
): boolean {
  for (const [vid, a] of Object.entries(assignments)) {
    if (vid === variantId) continue;
    const otherKey = mlAssignmentKey(a?.ml || '', a?.mlItemId);
    if (otherKey === key) return true;
  }
  return false;
}

function repairMlAssignmentsFromCatalog(
  localVariants: Array<{ variantId: string; sku: string; size: string; color: string; stock: number }>,
  current: Record<string, VariantAssignment>,
  mlList: MlVariationRow[]
): Record<string, VariantAssignment> {
  if (mlList.length === 0) return { ...current };

  const next: Record<string, VariantAssignment> = { ...current };
  const usedKeys = new Set<string>();

  // Normalizar IDs guardados contra el catálogo cargado (sin tratar la propia fila como duplicada).
  for (const local of localVariants) {
    const a = next[local.variantId];
    const ml = (a?.ml || '').trim();
    if (!ml || isMercadoLibrePublicationId(ml)) continue;
    const exact = mlList.find(
      (m) =>
        m.variationId === ml && (!a?.mlItemId || mercadoLibreItemIdsMatch(a.mlItemId, m.itemId))
    );
    if (exact) {
      next[local.variantId] = { ...a, ml: exact.variationId, mlItemId: exact.itemId };
      const key = mlOptionKey(exact);
      if (key) usedKeys.add(key);
    }
  }

  for (const local of localVariants) {
    if (!variantHasStock(local)) continue;
    const a = next[local.variantId] || { ml: '', tn: '' };
    const ml = (a.ml || '').trim();
    const key = ml && !isMercadoLibrePublicationId(ml) ? mlAssignmentKey(ml, a.mlItemId) : null;
    const isDuplicate = key != null && mlKeyUsedByOtherVariant(next, local.variantId, key);
    const needsRepair = !ml || isMercadoLibrePublicationId(ml) || isDuplicate;
    if (!needsRepair) continue;

    const preferredItemId = isMercadoLibrePublicationId(ml)
      ? ml
      : (a.mlItemId || undefined);
    const match = findMlCatalogMatchForLocal(local, mlList, preferredItemId);
    if (!match) {
      // Solo borrar si nunca hubo un ID válido o es duplicado/MLA mal guardado.
      if (needsRepair && (!ml || isMercadoLibrePublicationId(ml) || isDuplicate)) {
        next[local.variantId] = {
          ...a,
          ml: '',
          mlItemId: preferredItemId
            ? normalizeMercadoLibreItemId(preferredItemId) || preferredItemId
            : a.mlItemId,
        };
      }
      continue;
    }

    const matchKey = mlOptionKey(match);
    if (mlKeyUsedByOtherVariant(next, local.variantId, matchKey)) continue;
    if (key) usedKeys.delete(key);
    usedKeys.add(matchKey);
    next[local.variantId] = { ...a, ml: match.variationId, mlItemId: match.itemId };
  }

  return next;
}

function mlAssignmentKey(ml: string, mlItemId?: string): string | null {
  const trimmed = ml.trim();
  if (!trimmed) return null;
  if (isMercadoLibrePublicationId(trimmed)) {
    return normalizeMercadoLibreItemId(trimmed) || trimmed.toUpperCase();
  }
  if (mlItemId) return mlOptionKey({ itemId: mlItemId, variationId: trimmed } as MlVariationRow);
  return trimmed;
}

function tnAssignmentKey(tn: string, tnProductId?: string): string | null {
  const trimmed = tn.trim();
  if (!trimmed) return null;
  if (tnProductId) return tnOptionKey({ productId: tnProductId, variantId: trimmed } as TnVariantRow);
  return trimmed;
}

function getRowLinkStatus(ml?: string, tn?: string): RowLinkStatus {
  const hasMl = !!ml?.trim();
  const hasTn = !!tn?.trim();
  if (hasMl && hasTn) return 'complete';
  if (hasMl || hasTn) return 'partial';
  return 'empty';
}

function hasMlAssignment(a?: VariantAssignment): boolean {
  return hasAnyMlAssignment(a);
}

function variantHadTnLink(externalIds?: { tiendaNubeVariant?: string | number | null }): boolean {
  return externalIds?.tiendaNubeVariant != null && String(externalIds.tiendaNubeVariant).trim() !== '';
}

function variantHadMlLink(externalIds?: {
  mercadoLibreVariant?: string | number | null;
  mercadoLibreItemId?: string | null;
}): boolean {
  if (!externalIds) return false;
  if (externalIds.mercadoLibreVariant != null && String(externalIds.mercadoLibreVariant).trim() !== '') {
    return true;
  }
  return externalIds.mercadoLibreItemId != null && String(externalIds.mercadoLibreItemId).trim() !== '';
}

function clearMlAssignmentFields(assignment?: VariantAssignment): VariantAssignment {
  return {
    ...assignment,
    ml: '',
    mlItemId: undefined,
    mlByItemId: undefined,
  };
}

type DismissedSources = { ml: string[]; tn: string[] };

function dismissedSourcesKey(groupKey: string): string {
  return `bulkLinkDismissed:${groupKey}`;
}

function readDismissedSources(groupKey: string): DismissedSources {
  try {
    const raw = sessionStorage.getItem(dismissedSourcesKey(groupKey));
    if (!raw) return { ml: [], tn: [] };
    const parsed = JSON.parse(raw) as DismissedSources;
    return {
      ml: Array.isArray(parsed.ml) ? parsed.ml.map(String) : [],
      tn: Array.isArray(parsed.tn) ? parsed.tn.map(String) : [],
    };
  } catch {
    return { ml: [], tn: [] };
  }
}

function writeDismissedSources(groupKey: string, dismissed: DismissedSources): void {
  try {
    sessionStorage.setItem(dismissedSourcesKey(groupKey), JSON.stringify(dismissed));
  } catch {
    /* quota */
  }
}

function applyDismissedSources(groupKey: string, mlSet: Set<string>, tnSet: Set<string>): void {
  const dismissed = readDismissedSources(groupKey);
  dismissed.ml.forEach((id) => {
    const norm = normalizeMercadoLibreItemId(id) || id;
    for (const entry of [...mlSet]) {
      if ((normalizeMercadoLibreItemId(entry) || entry) === norm) mlSet.delete(entry);
    }
  });
  dismissed.tn.forEach((id) => {
    const norm = normalizedTnCatalogId(id);
    for (const entry of [...tnSet]) {
      if (normalizedTnCatalogId(entry) === norm) tnSet.delete(entry);
    }
  });
}

/** Fuentes aún vinculadas en la base: siempre deben cargarse aunque el usuario las haya descartado antes. */
function enforceLinkedCatalogSources(
  mlSet: Set<string>,
  tnSet: Set<string>,
  linkedMlNorms: Set<string>,
  linkedTnNorms: Set<string>
): void {
  linkedMlNorms.forEach((id) => {
    const norm = normalizeMercadoLibreItemId(id) || id;
    if (norm) mlSet.add(norm);
  });
  linkedTnNorms.forEach((id) => {
    const norm = normalizedTnCatalogId(id);
    if (norm && /^\d+$/.test(norm)) tnSet.add(norm);
  });
}

function addNormalizedMlId(mlSet: Set<string>, raw: unknown): void {
  if (raw == null || String(raw).trim() === '') return;
  const norm = normalizeMercadoLibreItemId(String(raw).trim());
  if (norm) mlSet.add(norm);
}

function normalizedTnCatalogId(raw: unknown): string {
  return normalizeTiendaNubeProductId(raw) || String(raw ?? '').trim();
}

function isTnCatalogIdDismissed(dismissed: DismissedSources, raw: unknown): boolean {
  const norm = normalizedTnCatalogId(raw);
  if (!norm) return false;
  return dismissed.tn.some((id) => normalizedTnCatalogId(id) === norm);
}

function isMlCatalogIdDismissed(dismissed: DismissedSources, raw: unknown): boolean {
  const norm = normalizeMercadoLibreItemId(String(raw ?? '').trim());
  if (!norm) return false;
  return dismissed.ml.some((id) => (normalizeMercadoLibreItemId(id) || id) === norm);
}

function addTnCatalogId(tnSet: Set<string>, raw: unknown, dismissed: DismissedSources): void {
  const norm = normalizedTnCatalogId(raw);
  if (!norm || !/^\d+$/.test(norm) || isTnCatalogIdDismissed(dismissed, norm)) return;
  tnSet.add(norm);
}

function addMlCatalogId(mlSet: Set<string>, raw: unknown, dismissed: DismissedSources): void {
  if (isMlCatalogIdDismissed(dismissed, raw)) return;
  addNormalizedMlId(mlSet, raw);
}

/**
 * Paso 1: una publicación canónica pack×1 (ficha ML con variantes) + packs reales (pack_size > 1).
 * No trata cada MLA por color/talle como publicación aparte.
 */
function buildMlCatalogSources(opts: {
  parentMl: string | null;
  primaryByVariant: Map<string, string>;
  publications: Array<{ external_product_id?: string; pack_size?: number }>;
  dismissed: DismissedSources;
}): { sourceIds: string[]; packSizeById: Map<string, number>; catalogLinkedNorms: Set<string> } {
  const packSizeById = new Map<string, number>();
  const bump = (raw: unknown, pack: number) => {
    if (raw == null || String(raw).trim() === '') return;
    const norm = normalizeMercadoLibreItemId(String(raw).trim());
    if (!norm) return;
    const p = Math.max(1, Number(pack) || 1);
    packSizeById.set(norm, Math.max(packSizeById.get(norm) || 1, p));
  };

  for (const pub of opts.publications) {
    bump(pub.external_product_id, Number(pub.pack_size) || 1);
  }
  for (const primary of opts.primaryByVariant.values()) {
    bump(primary, 1);
  }
  if (opts.parentMl) bump(opts.parentMl, 1);

  const primaryCounts = new Map<string, number>();
  for (const primary of opts.primaryByVariant.values()) {
    const norm = normalizeMercadoLibreItemId(primary);
    if (!norm) continue;
    primaryCounts.set(norm, (primaryCounts.get(norm) || 0) + 1);
  }

  let canonicalX1: string | null = opts.parentMl
    ? normalizeMercadoLibreItemId(opts.parentMl) || opts.parentMl
    : null;
  if (!canonicalX1 && primaryCounts.size > 0) {
    let best: string | null = null;
    let bestN = -1;
    for (const [id, n] of primaryCounts) {
      if (n > bestN) {
        best = id;
        bestN = n;
      }
    }
    canonicalX1 = best;
  }
  if (!canonicalX1) {
    for (const [id, pack] of packSizeById) {
      if (pack <= 1) {
        canonicalX1 = id;
        break;
      }
    }
  }

  const sourceIds: string[] = [];
  const catalogLinkedNorms = new Set<string>();
  const addSource = (id: string, pack: number) => {
    const norm = normalizeMercadoLibreItemId(id) || id;
    if (!norm || isMlCatalogIdDismissed(opts.dismissed, norm)) return;
    if (!sourceIds.includes(norm)) sourceIds.push(norm);
    catalogLinkedNorms.add(norm);
    packSizeById.set(norm, Math.max(packSizeById.get(norm) || 1, pack));
  };

  if (canonicalX1) addSource(canonicalX1, 1);
  for (const [id, pack] of packSizeById) {
    if (pack > 1) addSource(id, pack);
  }

  return { sourceIds, packSizeById, catalogLinkedNorms };
}

function mlSelectValue(
  mlVal: string,
  mlItemId: string | undefined,
  catalog: MlVariationRow[]
): string {
  const trimmed = (mlVal || '').trim();
  if (!trimmed || /^ML[A-Z]{1,5}\d+$/i.test(trimmed)) return '';
  const itemId = (mlItemId || '').trim();
  if (itemId) return mlOptionKey({ itemId, variationId: trimmed } as MlVariationRow);
  const found = catalog.find((m) => m.variationId === trimmed);
  return found ? mlOptionKey(found) : '';
}

function tnSelectValue(
  tnVal: string,
  tnProductId: string | undefined,
  catalog: TnVariantRow[]
): string {
  const trimmed = (tnVal || '').trim();
  if (!trimmed) return '';
  const productId = (tnProductId || '').trim();
  if (productId) return tnOptionKey({ productId, variantId: trimmed } as TnVariantRow);
  const found = catalog.find((t) => t.variantId === trimmed);
  return found ? tnOptionKey(found) : trimmed;
}

export interface BulkLinkGroupPageProps {
  groupKey: string;
  onNavigate: (view: string) => void;
  onImportComplete?: () => void;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

const BulkLinkGroupPage: React.FC<BulkLinkGroupPageProps> = ({
  groupKey,
  onNavigate,
  onImportComplete,
  showToast,
}) => {
  const [productId, setProductId] = useState<string | null>(null);
  const [productName, setProductName] = useState('');
  const [variants, setVariants] = useState<
    Array<{ variantId: string; sku: string; size: string; color: string; stock: number; externalIds?: any }>
  >([]);
  const [mlSources, setMlSources] = useState<PublicationSource[]>([]);
  const [tnSources, setTnSources] = useState<PublicationSource[]>([]);
  const [mlDraft, setMlDraft] = useState('');
  const [tnDraft, setTnDraft] = useState('');
  const [mlVariations, setMlVariations] = useState<MlVariationRow[]>([]);
  const [tnVariants, setTnVariants] = useState<TnVariantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Record<string, VariantAssignment>>({});
  const [skuEdits, setSkuEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [mlSearch, setMlSearch] = useState('');
  const [tnSearch, setTnSearch] = useState('');
  const [showMlTip, setShowMlTip] = useState(false);
  const [step1Expanded, setStep1Expanded] = useState(true);
  const autoCollapsedStep1Ref = useRef(false);
  const [packMl, setPackMl] = useState(1);
  const [packTn, setPackTn] = useState(1);
  const [expandedExtraVariantId, setExpandedExtraVariantId] = useState<string | null>(null);
  const [pubCounts, setPubCounts] = useState<Record<string, number>>({});
  const [selectedUnifyIds, setSelectedUnifyIds] = useState<string[]>([]);
  const [unifyModalOpen, setUnifyModalOpen] = useState(false);
  const [unifyAbsorbId, setUnifyAbsorbId] = useState<string | null>(null);
  const [unifyKeeperId, setUnifyKeeperId] = useState<string | null>(null);
  const [unifySaving, setUnifySaving] = useState(false);
  /** Variantes cuyo ML/TN fue emparejado automáticamente y aún no está guardado en DB. */
  const [suggestedLinkIds, setSuggestedLinkIds] = useState<Set<string>>(() => new Set());
  const [pendingCatalogFetch, setPendingCatalogFetch] = useState<{
    loadId: number;
    assignments: Record<string, VariantAssignment>;
    variants: Array<{ variantId: string; sku: string; size: string; color: string; stock: number; externalIds?: any }>;
    mlSourceIds: string[];
    tnSourceIds: string[];
  } | null>(null);
  const catalogFetchStartedRef = useRef<number | null>(null);
  const dismissedSourcesRef = useRef<DismissedSources>({ ml: [], tn: [] });

  const goBack = () => onNavigate('inventory');

  const dismissMlSource = (id: string) => {
    const norm = normalizeMercadoLibreItemId(id) || id;
    if (!dismissedSourcesRef.current.ml.includes(norm)) {
      dismissedSourcesRef.current = {
        ...dismissedSourcesRef.current,
        ml: [...dismissedSourcesRef.current.ml, norm],
      };
      writeDismissedSources(groupKey, dismissedSourcesRef.current);
    }
    setMlSources((prev) => prev.filter((s) => s.id !== id));
    setMlVariations((prev) =>
      prev.filter((row) => !mlRowBelongsToSource(row, id) && row.itemId !== id && row.itemId !== norm)
    );
  };

  const dismissTnSource = (id: string) => {
    const norm = normalizedTnCatalogId(id);
    if (!dismissedSourcesRef.current.tn.includes(norm)) {
      dismissedSourcesRef.current = {
        ...dismissedSourcesRef.current,
        tn: [...dismissedSourcesRef.current.tn, norm],
      };
      writeDismissedSources(groupKey, dismissedSourcesRef.current);
    }
    setTnSources((prev) => prev.filter((s) => normalizedTnCatalogId(s.id) !== norm));
    setTnVariants((prev) => prev.filter((row) => normalizedTnCatalogId(row.productId) !== norm));
  };

  const restoreDismissedSource = (platform: 'ml' | 'tn', id: string) => {
    const norm = platform === 'ml' ? normalizeMercadoLibreItemId(id) || id : normalizedTnCatalogId(id);
    dismissedSourcesRef.current = {
      ml:
        platform === 'ml'
          ? dismissedSourcesRef.current.ml.filter((x) => (normalizeMercadoLibreItemId(x) || x) !== norm)
          : dismissedSourcesRef.current.ml,
      tn:
        platform === 'tn'
          ? dismissedSourcesRef.current.tn.filter((x) => normalizedTnCatalogId(x) !== norm)
          : dismissedSourcesRef.current.tn,
    };
    writeDismissedSources(groupKey, dismissedSourcesRef.current);
  };

  const loadArticle = useCallback(async () => {
    if (!groupKey) return;
    catalogFetchStartedRef.current = null;
    dismissedSourcesRef.current = readDismissedSources(groupKey);
    setPendingCatalogFetch(null);
    setMlSources([]);
    setTnSources([]);
    setMlVariations([]);
    setTnVariants([]);
    setLoading(true);
    try {
      setSuggestedLinkIds(new Set());
      const p: any = await api.getProductBySku(groupKey, INVENTORY_PRODUCT_FETCH_OPTS);
      if (!p) {
        showToast('error', 'Artículo no encontrado');
        goBack();
        return;
      }
      setProductId(p.id);
      setProductName(p.name || groupKey);
      setPackMl(p.mercado_libre_pack_size ?? 1);
      setPackTn(p.tienda_nube_pack_size ?? 1);
      const parentMl = normalizeMercadoLibreItemId(p.externalIds?.mercadoLibre || '');
      const parentTn = normalizeTiendaNubeProductId(p.externalIds?.tiendaNube || '');
      const list = (p.variants || []).map((v: any) => {
        const variantId = v.variant_id;
        const rawSku = (v.variant_sku ?? '').toString().trim();
        const extSku = (v.external_sku ?? '').toString().trim();
        const fallbackSku = `${groupKey}-${v.size_code}-${v.color_code}`;
        const sku =
          rawSku && rawSku !== String(variantId) ? rawSku : extSku ? extSku : fallbackSku;
        return {
          variantId,
          sku,
          size: v.size_code,
          color: v.color_name,
          stock: Number(v.stock ?? 0),
          externalIds: v.externalIds,
        };
      });
      setVariants(list);
      const pubResults = await Promise.all(
        list.map((v: { variantId: string }) =>
          api.getVariantPublications(v.variantId).catch(() => [] as Array<{ platform: string; external_product_id: string }>)
        )
      );
      let dismissed = readDismissedSources(groupKey);
      const linkedTnNorms = new Set<string>();
      pubResults.flat().forEach((pub) => {
        if (pub.platform === 'tiendanube' && pub.external_product_id) {
          const norm = normalizedTnCatalogId(pub.external_product_id);
          if (norm) linkedTnNorms.add(norm);
        }
      });
      if (parentTn) {
        const norm = normalizedTnCatalogId(parentTn);
        if (norm) linkedTnNorms.add(norm);
      }
      const tnSet = new Set<string>();
      const primaryMlByVariant = new Map<string, string>();
      list.forEach((v: { variantId: string; externalIds?: { mercadoLibreItemId?: unknown } }, idx: number) => {
        const fromExt = primaryMlItemIdFromVariantExternal(v);
        const pubs = pubResults[idx] || [];
        const mlPub = pubs.find((p: { platform: string }) => p.platform === 'mercadolibre') as
          | { external_product_id?: string }
          | undefined;
        const primary =
          fromExt ||
          (mlPub?.external_product_id != null && String(mlPub.external_product_id).trim() !== ''
            ? String(mlPub.external_product_id).trim()
            : '');
        if (primary) primaryMlByVariant.set(v.variantId, primary);
      });
      pubResults.flat().forEach((pub) => {
        if (pub.platform === 'tiendanube' && pub.external_product_id) {
          addTnCatalogId(tnSet, pub.external_product_id, dismissed);
        }
      });
      const nextAssign: Record<string, VariantAssignment> = {};
      list.forEach((v: any, idx: number) => {
        const pubs = pubResults[idx] || [];
        const mlPub = pubs.find((p: { platform: string }) => p.platform === 'mercadolibre') as
          | { external_product_id?: string; external_variant_id?: string }
          | undefined;
        const tnPub = pubs.find((p: { platform: string }) => p.platform === 'tiendanube');
        const savedMlItemId =
          v.externalIds?.mercadoLibreItemId != null && String(v.externalIds.mercadoLibreItemId).trim() !== ''
            ? String(v.externalIds.mercadoLibreItemId).trim()
            : '';
        const savedMlVarId =
          v.externalIds?.mercadoLibreVariant != null && String(v.externalIds.mercadoLibreVariant).trim() !== ''
            ? String(v.externalIds.mercadoLibreVariant).trim()
            : mlPub?.external_variant_id != null && String(mlPub.external_variant_id).trim() !== ''
              ? String(mlPub.external_variant_id).trim()
              : '';
        const mlVal = savedMlVarId && !isMercadoLibrePublicationId(savedMlVarId) ? savedMlVarId : '';
        const mlItemId = (() => {
          if (savedMlVarId && isMercadoLibrePublicationId(savedMlVarId)) {
            return normalizeMercadoLibreItemId(savedMlVarId) || savedMlVarId.toUpperCase();
          }
          if (savedMlItemId) {
            return isMercadoLibrePublicationId(savedMlItemId)
              ? normalizeMercadoLibreItemId(savedMlItemId) || savedMlItemId.toUpperCase()
              : savedMlItemId;
          }
          if (mlVal) {
            return (
              mlPub?.external_product_id ||
              (parentMl ? normalizeMercadoLibreItemId(parentMl) || parentMl : undefined)
            );
          }
          return undefined;
        })();
        const tnVal =
          v.externalIds?.tiendaNubeVariant != null && String(v.externalIds.tiendaNubeVariant).trim() !== ''
            ? String(v.externalIds.tiendaNubeVariant).trim()
            : (tnPub as { external_variant_id?: string } | undefined)?.external_variant_id != null &&
                String((tnPub as { external_variant_id?: string }).external_variant_id).trim() !== ''
              ? String((tnPub as { external_variant_id?: string }).external_variant_id).trim()
              : '';
        const tnProductIdRaw =
          (tnPub as { external_product_id?: string } | undefined)?.external_product_id ||
          parentTn ||
          undefined;
        const tnProductId = tnProductIdRaw ? normalizedTnCatalogId(tnProductIdRaw) : undefined;
        const mlByItemId: Record<string, string> = {};
        if (mlItemId && mlVal) {
          mlByItemId[mlItemKey(mlItemId)] = mlVal;
        }
        pubs.forEach((pub: { platform: string; external_product_id?: string; external_variant_id?: string }) => {
          if (pub.platform !== 'mercadolibre' || !pub.external_product_id) return;
          const varId =
            pub.external_variant_id != null && String(pub.external_variant_id).trim() !== ''
              ? String(pub.external_variant_id).trim()
              : '';
          if (!varId || isMercadoLibrePublicationId(varId)) return;
          mlByItemId[mlItemKey(pub.external_product_id)] = varId;
        });
        nextAssign[v.variantId] = {
          ml: mlVal,
          mlItemId: mlItemId,
          mlByItemId: Object.keys(mlByItemId).length > 0 ? mlByItemId : undefined,
          tn: tnVal,
          tnProductId,
        };
      });

      const mlPubsForCatalog = pubResults
        .flat()
        .filter((pub) => pub.platform === 'mercadolibre' && pub.external_product_id)
        .map((pub) => ({
          external_product_id: String(pub.external_product_id),
          pack_size: Number((pub as { pack_size?: number }).pack_size) || 1,
        }));
      const {
        sourceIds: mlCatalogIds,
        packSizeById: mlPackSizeById,
        catalogLinkedNorms,
      } = buildMlCatalogSources({
        parentMl,
        primaryByVariant: primaryMlByVariant,
        publications: mlPubsForCatalog,
        dismissed,
      });

      // Solo forzar de nuevo fuentes de catálogo (canónica + packs), no cada MLA por color.
      const prunedMlDismissed = dismissed.ml.filter(
        (id) => !catalogLinkedNorms.has(normalizeMercadoLibreItemId(id) || id)
      );
      const prunedTnDismissed = dismissed.tn.filter(
        (id) => !linkedTnNorms.has(normalizedTnCatalogId(id))
      );
      if (prunedMlDismissed.length !== dismissed.ml.length || prunedTnDismissed.length !== dismissed.tn.length) {
        dismissed = { ml: prunedMlDismissed, tn: prunedTnDismissed };
        writeDismissedSources(groupKey, dismissed);
      }
      dismissedSourcesRef.current = dismissed;

      const mlSet = new Set<string>(mlCatalogIds);
      addTnCatalogId(tnSet, parentTn, dismissed);
      applyDismissedSources(groupKey, mlSet, tnSet);
      enforceLinkedCatalogSources(mlSet, tnSet, catalogLinkedNorms, linkedTnNorms);
      const mlSourceIds = [...mlSet];
      const tnSourceIds = [...tnSet];
      const catalogSources: PublicationSource[] = mlSourceIds.map((id) => ({
        id,
        autoLoaded: true,
        packSize: mlPackSizeById.get(normalizeMercadoLibreItemId(id) || id) || 1,
      }));
      const syncedAssign: Record<string, VariantAssignment> = {};
      for (const v of list) {
        syncedAssign[v.variantId] = syncPrimaryMlAssignment(nextAssign[v.variantId], catalogSources);
      }
      setMlSources(catalogSources);
      setTnSources(tnSourceIds.map((id) => ({ id, autoLoaded: true })));
      setAssignments(syncedAssign);
      const skuMap: Record<string, string> = {};
      list.forEach((v: any) => {
        skuMap[v.variantId] = String(v.sku || '');
      });
      setSkuEdits(skuMap);
      setSelectedUnifyIds((prev) => prev.filter((id) => list.some((v: { variantId: string }) => v.variantId === id)));
      if (mlSourceIds.length > 0 || tnSourceIds.length > 0) {
        const loadId = Date.now();
        setPendingCatalogFetch({
          loadId,
          assignments: syncedAssign,
          variants: list,
          mlSourceIds,
          tnSourceIds,
        });
      }
    } catch {
      showToast('error', 'Error cargando el artículo');
    } finally {
      setLoading(false);
    }
  }, [groupKey, onNavigate, showToast]);

  useEffect(() => {
    void loadArticle();
  }, [loadArticle]);

  const runAutoMatch = (
    localVariants: typeof variants,
    mlList: MlVariationRow[],
    tnList: TnVariantRow[],
    current?: Record<string, VariantAssignment>,
    sourceList?: PublicationSource[]
  ): Record<string, VariantAssignment> => {
    const prev = current ?? assignments;
    const next: Record<string, VariantAssignment> = { ...prev };
    const usedMl = new Set<string>();
    const usedTn = new Set<string>();
    const newlySuggested = new Set<string>();
    const activeMlSources = sourceList ?? mlSources;
    localVariants.forEach((local) => {
      const a = next[local.variantId];
      iterMlAssignmentKeys(a).forEach((key) => usedMl.add(key));
      if (a?.tn?.trim()) {
        const tn = a.tn.trim();
        const pid = a.tnProductId?.trim();
        usedTn.add(pid ? tnOptionKey({ productId: pid, variantId: tn } as TnVariantRow) : tn);
      }
    });
    localVariants.forEach((local) => {
      if (!variantHasStock(local)) return;
      const skuN = norm(local.sku);
      const sizeN = norm(local.size);
      if (!next[local.variantId]) next[local.variantId] = { ml: '', tn: '' };
      if (isMercadoLibrePublicationId(next[local.variantId].ml || '')) {
        next[local.variantId] = {
          ...next[local.variantId],
          mlItemId:
            next[local.variantId].mlItemId ||
            normalizeMercadoLibreItemId(next[local.variantId].ml || '') ||
            next[local.variantId].ml,
          ml: '',
        };
      }
      const hadMl = hasAnyMlAssignment(next[local.variantId]);
      const hadTn = !!next[local.variantId].tn?.trim();
      const mlSourcesToMatch =
        activeMlSources.length > 0
          ? activeMlSources
          : [{ id: '', packSize: 1 } as PublicationSource];
      for (const src of mlSourcesToMatch) {
        const srcItemId = src.id ? mlItemKey(src.id) : '';
        const scoped =
          srcItemId && activeMlSources.length > 0
            ? mlList.filter((m) => mlRowBelongsToSource(m, src.id))
            : mlList;
        if (scoped.length === 0) continue;
        if (srcItemId && getMlVariationForItem(next[local.variantId], srcItemId)) continue;
        if (!srcItemId && next[local.variantId].ml?.trim()) continue;
        let match = skuN ? scoped.find((m) => norm(m.sku) === skuN) : null;
        if (!match) {
          match = scoped.find(
            (m) =>
              colorsMatchForLink(local.color, m.color || '') &&
              (norm(m.size) === sizeN || sizesMatchForLink(local.size, m.size || ''))
          );
        }
        if (!match && scoped.length === 1) match = scoped[0];
        if (!match) continue;
        const key = mlOptionKey(match);
        if (usedMl.has(key)) continue;
        next[local.variantId] = srcItemId
          ? setMlVariationForItem(next[local.variantId], srcItemId, match.variationId)
          : { ...next[local.variantId], ml: match.variationId, mlItemId: match.itemId };
        usedMl.add(key);
        if (!hadMl) newlySuggested.add(local.variantId);
      }
      next[local.variantId] = syncPrimaryMlAssignment(next[local.variantId], activeMlSources);
      if (!next[local.variantId].tn?.trim() && tnList.length > 0) {
        let match = skuN ? tnList.find((t) => norm(t.sku) === skuN) : null;
        if (!match) {
          match = tnList.find(
            (t) =>
              colorsMatchForLink(local.color, t.color || '') &&
              (norm(t.size) === sizeN || sizesMatchForLink(local.size, t.size || ''))
          );
        }
        if (!match && tnList.length === 1) match = tnList[0];
        if (match) {
          const key = tnOptionKey(match);
          if (!usedTn.has(key)) {
            next[local.variantId].tn = match.variantId;
            next[local.variantId].tnProductId = match.productId;
            usedTn.add(key);
            if (!hadTn) newlySuggested.add(local.variantId);
          }
        }
      }
    });
    setAssignments(next);
    if (newlySuggested.size > 0) {
      setSuggestedLinkIds((prev) => {
        const merged = new Set(prev);
        newlySuggested.forEach((id) => merged.add(id));
        return merged;
      });
    }
    return next;
  };

  const optionMatch = (
    query: string,
    item: {
      sku?: string;
      size?: string;
      color?: string;
      itemId?: string;
      productId?: string;
      variationId?: string;
      variantId?: string;
    }
  ) => {
    const q = norm(query);
    if (!q) return true;
    const id = item.variationId ?? item.variantId ?? item.itemId ?? item.productId ?? '';
    const text = [
      item.sku || '',
      formatSizeForLink(item.size),
      item.color || '',
      item.itemId || '',
      item.productId || '',
      String(id),
    ].join(' ');
    return norm(text).includes(q);
  };

  const filteredMl = useMemo(
    () => mlVariations.filter((m) => optionMatch(mlSearch, m)),
    [mlVariations, mlSearch]
  );
  const filteredTn = useMemo(
    () => tnVariants.filter((t) => optionMatch(tnSearch, t)),
    [tnVariants, tnSearch]
  );

  const assignedMlKeys = useMemo(() => {
    const map = new Map<string, string>();
    variants.forEach((v) => {
      iterMlAssignmentKeys(assignments[v.variantId]).forEach((key) => map.set(key, v.variantId));
    });
    return map;
  }, [variants, assignments]);

  const assignedTnKeys = useMemo(() => {
    const map = new Map<string, string>();
    variants.forEach((v) => {
      const a = assignments[v.variantId];
      const tn = a?.tn?.trim();
      if (!tn) return;
      const key = tnAssignmentKey(tn, a?.tnProductId);
      if (key) map.set(key, v.variantId);
    });
    return map;
  }, [variants, assignments]);

  const getVisibleMlOptionsForSource = useCallback(
    (_variantId: string, itemId: string, selectedVariationId?: string) => {
      const pubRows = mlVariationsForSource(mlVariations, itemId);
      const scoped = mlSearch.trim()
        ? pubRows.filter((m) => optionMatch(mlSearch, m))
        : pubRows;
      const selected = (selectedVariationId || '').trim();
      if (!selected) return scoped;
      if (scoped.some((m) => m.variationId === selected)) return scoped;
      const opt = mlVariations.find(
        (m) => m.variationId === selected && mlRowBelongsToSource(m, itemId)
      );
      if (opt) return [opt, ...scoped];
      return scoped;
    },
    [mlVariations, mlSearch]
  );

  const linkStats = useMemo(() => {
    let ml = 0;
    let tn = 0;
    let both = 0;
    variants.forEach((v) => {
      const a = assignments[v.variantId];
      const hasMl = hasAnyMlAssignment(a);
      const hasTn = !!a?.tn?.trim();
      if (hasMl) ml++;
      if (hasTn) tn++;
      if (hasMl && hasTn) both++;
    });
    const total = variants.length;
    const progress = total ? Math.round(((ml + tn) / (total * 2)) * 100) : 0;
    return { total, ml, tn, both, progress };
  }, [variants, assignments]);

  const catalogsLoaded = mlVariations.length > 0 || tnVariants.length > 0;
  const currentStep = catalogsLoaded ? 2 : 1;

  useEffect(() => {
    if (loading || autoCollapsedStep1Ref.current) return;
    const hasLinks = variants.some((v) => {
      const a = assignments[v.variantId];
      return !!(hasAnyMlAssignment(a) || a?.tn?.trim());
    });
    if (catalogsLoaded || hasLinks) {
      autoCollapsedStep1Ref.current = true;
      setStep1Expanded(false);
    }
  }, [loading, variants, assignments, catalogsLoaded]);

  const getVisibleTnOptions = (variantId: string, selectedValue?: string, selectedProductId?: string) => {
    const selected = (selectedValue || '').trim();
    const pool = filteredTn.length > 0 ? filteredTn : tnVariants;
    if (!selected) return pool;
    if (
      pool.some(
        (t) => String(t.variantId) === selected && (!selectedProductId || t.productId === selectedProductId)
      )
    ) {
      return pool;
    }
    const opt = tnVariants.find(
      (t) => String(t.variantId) === selected && (!selectedProductId || t.productId === selectedProductId)
    );
    return opt ? [opt, ...pool] : pool;
  };

  const resolveMlLabel = (variantId: string) => {
    const a = assignments[variantId];
    const value = (a?.ml || '').trim();
    if (!value) return null;
    if (/^ML[A-Z]{1,5}\d+$/i.test(value)) return `Publicación ${value.toUpperCase()}`;
    const opt = mlVariations.find(
      (m) =>
        m.variationId === value && (!a?.mlItemId || m.itemId === a.mlItemId)
    );
    if (opt) return `${opt.itemId} · ${formatMlOptionLabel(opt)}`;
    return a?.mlItemId ? `${a.mlItemId} / ${value}` : `Variación ${value}`;
  };

  const resolveTnLabel = (variantId: string) => {
    const a = assignments[variantId];
    const value = (a?.tn || '').trim();
    if (!value) return null;
    const opt = tnVariants.find(
      (t) => t.variantId === value && (!a?.tnProductId || t.productId === a.tnProductId)
    );
    if (opt) return `${opt.productId} · ${formatOptionLabel(opt)}`;
    return a?.tnProductId ? `${a.tnProductId} / ${value}` : `Variante ${value}`;
  };

  const refreshPublicationCount = useCallback((variantId: string, count: number) => {
    setPubCounts((prev) => ({ ...prev, [variantId]: count }));
  }, []);

  const findMlAssignmentConflict = (
    variantId: string,
    ml: string,
    mlItemId?: string
  ): string | null => {
    const key = mlAssignmentKey(ml, mlItemId);
    if (!key) return null;
    for (const v of variants) {
      if (v.variantId === variantId) continue;
      for (const otherKey of iterMlAssignmentKeys(assignments[v.variantId])) {
        if (otherKey === key) return v.variantId;
      }
    }
    return null;
  };

  const findTnAssignmentConflict = (
    variantId: string,
    tn: string,
    tnProductId?: string
  ): string | null => {
    const key = tnAssignmentKey(tn, tnProductId);
    if (!key) return null;
    for (const v of variants) {
      if (v.variantId === variantId) continue;
      const a = assignments[v.variantId];
      const otherTn = a?.tn?.trim();
      if (!otherTn) continue;
      if (tnAssignmentKey(otherTn, a?.tnProductId) === key) return v.variantId;
    }
    return null;
  };

  useEffect(() => {
    if (variants.length === 0) return;
    let cancelled = false;
    Promise.all(
      variants.map(async (v) => {
        try {
          const pubs = await api.getVariantPublications(v.variantId);
          return [v.variantId, pubs.length] as const;
        } catch {
          return [v.variantId, 0] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setPubCounts(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [variants]);

  const toggleUnifySelect = (variantId: string) => {
    setSelectedUnifyIds((prev) => {
      if (prev.includes(variantId)) return prev.filter((id) => id !== variantId);
      if (prev.length >= 2) {
        showToast('info', 'Elegí como máximo dos variantes para unificar.');
        return prev;
      }
      return [...prev, variantId];
    });
  };

  const openUnifyModal = (preset?: { absorbId: string; keeperId: string }) => {
    if (preset) {
      setSelectedUnifyIds([preset.absorbId, preset.keeperId]);
      setUnifyAbsorbId(preset.absorbId);
      setUnifyKeeperId(preset.keeperId);
      setUnifyModalOpen(true);
      return;
    }
    if (selectedUnifyIds.length !== 2) {
      showToast('info', 'Marcá exactamente dos variantes para unificar.');
      return;
    }
    const [a, b] = selectedUnifyIds;
    setUnifyAbsorbId(a);
    setUnifyKeeperId(b);
    setUnifyModalOpen(true);
  };

  const confirmVariantUnify = async () => {
    if (!unifyAbsorbId || !unifyKeeperId || unifyAbsorbId === unifyKeeperId) {
      showToast('error', 'Elegí dos variantes distintas.');
      return;
    }
    const absorb = variants.find((v) => v.variantId === unifyAbsorbId);
    const keeper = variants.find((v) => v.variantId === unifyKeeperId);
    if (!absorb || !keeper) return;
    if (norm(absorb.color) !== norm(keeper.color)) {
      showToast('error', 'Solo se pueden unificar variantes del mismo color.');
      return;
    }
    const differentSize = norm(absorb.size) !== norm(keeper.size);
    setUnifySaving(true);
    try {
      await api.mergeManualVariantsPair({
        keeperVariantId: unifyKeeperId,
        absorbVariantId: unifyAbsorbId,
        allowDifferentSize: differentSize,
      });
      showToast('success', 'Variantes unificadas. Stock y vínculos ML/TN quedaron en la variante que elegiste conservar.');
      setUnifyModalOpen(false);
      setUnifyAbsorbId(null);
      setUnifyKeeperId(null);
      setSelectedUnifyIds([]);
      onImportComplete?.();
      await loadArticle();
    } catch (e: any) {
      showToast('error', e?.message || 'Error al unificar variantes');
    } finally {
      setUnifySaving(false);
    }
  };

  const duplicateMlByVariant = useMemo(() => {
    const keyToIds = new Map<string, string[]>();
    variants.forEach((v) => {
      iterMlAssignmentKeys(assignments[v.variantId]).forEach((key) => {
        const list = keyToIds.get(key) || [];
        list.push(v.variantId);
        keyToIds.set(key, list);
      });
    });
    const dup = new Set<string>();
    const partner = new Map<string, string>();
    keyToIds.forEach((ids) => {
      if (ids.length < 2) return;
      ids.forEach((id) => {
        dup.add(id);
        const other = ids.find((x) => x !== id);
        if (other) partner.set(id, other);
      });
    });
    return { dup, partner };
  }, [variants, assignments]);

  const duplicateTnByVariant = useMemo(() => {
    const keyToIds = new Map<string, string[]>();
    variants.forEach((v) => {
      const a = assignments[v.variantId];
      const tn = a?.tn?.trim();
      if (!tn) return;
      const key = tnAssignmentKey(tn, a?.tnProductId);
      if (!key) return;
      const list = keyToIds.get(key) || [];
      list.push(v.variantId);
      keyToIds.set(key, list);
    });
    const dup = new Set<string>();
    keyToIds.forEach((ids) => {
      if (ids.length > 1) ids.forEach((id) => dup.add(id));
    });
    return dup;
  }, [variants, assignments]);

  const conflictingVariantIds = useMemo(() => {
    const ids = new Set<string>();
    duplicateMlByVariant.dup.forEach((id) => ids.add(id));
    duplicateTnByVariant.forEach((id) => ids.add(id));
    return ids;
  }, [duplicateMlByVariant, duplicateTnByVariant]);

  const assignmentConflictCount = conflictingVariantIds.size;

  const hasAnyMlLinks = useMemo(() => {
    if (linkStats.ml > 0) return true;
    if (mlSources.length > 0) return true;
    return variants.some(
      (v) => variantHadMlLink(v.externalIds) || hasMlAssignment(assignments[v.variantId])
    );
  }, [variants, assignments, linkStats.ml, mlSources.length]);
  const hasAnyTnLinks = useMemo(() => {
    if (linkStats.tn > 0) return true;
    if (tnSources.length > 0) return true;
    return variants.some(
      (v) => variantHadTnLink(v.externalIds) || !!assignments[v.variantId]?.tn?.trim()
    );
  }, [variants, assignments, linkStats.tn, tnSources.length]);

  const handleUnlinkPlatforms = async (platform: 'mercadolibre' | 'tiendanube' | 'both') => {
    if (!productId) return;
    const label =
      platform === 'both'
        ? 'Mercado Libre y Tienda Nube'
        : platform === 'mercadolibre'
          ? 'Mercado Libre'
          : 'Tienda Nube';
    if (
      !window.confirm(
        `¿Desvincular este artículo de ${label}? Se quitarán los vínculos de todas las variantes en la base de datos.`
      )
    ) {
      return;
    }
    setUnlinking(true);
    try {
      await api.unlinkProductPlatforms(productId, {
        tiendaNube: platform === 'tiendanube' || platform === 'both',
        mercadoLibre: platform === 'mercadolibre' || platform === 'both',
        variants: true,
      });
      if (platform === 'mercadolibre' || platform === 'both') {
        setMlSources([]);
        setMlVariations([]);
      }
      if (platform === 'tiendanube' || platform === 'both') {
        setTnSources([]);
        setTnVariants([]);
      }
      setAssignments((prev) => {
        const next = { ...prev };
        variants.forEach((v) => {
          const row = { ...next[v.variantId] };
          if (platform === 'mercadolibre' || platform === 'both') {
            row.ml = '';
            row.mlItemId = undefined;
          }
          if (platform === 'tiendanube' || platform === 'both') {
            row.tn = '';
            row.tnProductId = undefined;
          }
          next[v.variantId] = row;
        });
        return next;
      });
      showToast('success', `Artículo desvinculado de ${label}.`);
      onImportComplete?.();
      void loadArticle();
    } catch (e: any) {
      showToast('error', e?.message || 'Error al desvincular');
    } finally {
      setUnlinking(false);
    }
  };

  const suggestedUnifyPair = useMemo((): { absorbId: string; keeperId: string } | null => {
    const uTokens = new Set(['U', '170']);
    const xgTokens = new Set(['XG', '180']);
    const sizeKind = (size: string): 'u' | 'xg' | 'other' => {
      const set = getSizeCanonicalSet(size);
      if ([...set].some((x) => uTokens.has(x))) return 'u';
      if ([...set].some((x) => xgTokens.has(x))) return 'xg';
      return 'other';
    };
    for (let i = 0; i < variants.length; i++) {
      for (let j = i + 1; j < variants.length; j++) {
        const va = variants[i];
        const vb = variants[j];
        if (norm(va.color) !== norm(vb.color)) continue;
        const uXgDup = sizesAreBizDuplicatePair(va.size, vb.size);
        const sameTn =
          duplicateTnByVariant.has(va.variantId) && duplicateTnByVariant.has(vb.variantId);
        const sameMl =
          duplicateMlByVariant.dup.has(va.variantId) && duplicateMlByVariant.dup.has(vb.variantId);
        if (!uXgDup && !sameTn && !sameMl) continue;
        const ka = sizeKind(va.size);
        const kb = sizeKind(vb.size);
        if (ka === 'u' && kb === 'xg') return { absorbId: va.variantId, keeperId: vb.variantId };
        if (ka === 'xg' && kb === 'u') return { absorbId: vb.variantId, keeperId: va.variantId };
        return { absorbId: va.variantId, keeperId: vb.variantId };
      }
    }
    return null;
  }, [variants, duplicateTnByVariant, duplicateMlByVariant]);

  const appendMlSources = (raw: string) => {
    const ids = parseIdsFromInput(raw, 'ml');
    if (ids.length === 0) {
      showToast('error', 'No se pudo obtener ningún ID de ML');
      return false;
    }
    const nextSources = [...mlSources];
    const seen = new Set(nextSources.map((s) => normalizeMercadoLibreItemId(s.id) || s.id));
    let addedCount = 0;
    ids.forEach((id) => {
      restoreDismissedSource('ml', id);
      const norm = normalizeMercadoLibreItemId(id) || id;
      if (!seen.has(norm)) {
        seen.add(norm);
        nextSources.push({ id, packSize: packMl });
        addedCount++;
      }
    });
    if (addedCount === 0) {
      showToast('info', 'Esas publicaciones ML ya están en la lista.');
      return false;
    }
    setMlSources(nextSources);
    void (async () => {
      setLoading(true);
      try {
        const { rows: mlList } = await fetchMlCatalogRows(nextSources);
        const baseAssignments = repairMlAssignmentsFromCatalog(variants, assignments, mlList);
        runAutoMatch(variants, mlList, tnVariants, baseAssignments, nextSources);
        showToast(
          'success',
          `Agregada(s) ${addedCount} publicación(es). ${mlList.length} variaciones ML cargadas.`
        );
      } catch {
        showToast('error', 'No se pudieron cargar las variaciones de la publicación nueva.');
      } finally {
        setLoading(false);
      }
    })();
    return true;
  };

  const appendTnSources = (raw: string) => {
    const ids = parseIdsFromInput(raw, 'tn');
    if (ids.length === 0) {
      showToast('error', 'No se pudo obtener ningún ID de TN');
      return false;
    }
    setTnSources((prev) => {
      const seen = new Set(prev.map((s) => normalizedTnCatalogId(s.id)));
      const next = [...prev];
      ids.forEach((id) => {
        restoreDismissedSource('tn', id);
        const norm = normalizedTnCatalogId(id);
        if (!seen.has(norm)) {
          seen.add(norm);
          next.push({ id, packSize: packTn });
        }
      });
      return next;
    });
    return true;
  };

  const updateMlSourcePack = (id: string, packSize: number) => {
    setMlSources((prev) => prev.map((s) => (s.id === id ? { ...s, packSize } : s)));
  };

  const updateTnSourcePack = (id: string, packSize: number) => {
    setTnSources((prev) => prev.map((s) => (s.id === id ? { ...s, packSize } : s)));
  };

  const fetchMlCatalogRows = async (sources: PublicationSource[]) => {
    const allRows: MlVariationRow[] = [];
    const nextSources = await Promise.all(
      sources.map(async (src) => {
        try {
          const res = await api.getMercadoLibreItemVariations(src.id);
          const fallbackItemId =
            normalizeMercadoLibreItemId(res.resolvedItemId || res.itemId || src.id) || src.id;
          const sourceId = normalizeMercadoLibreItemId(src.id) || src.id;
          const rows = (res.variations || []).map((v) => {
            const rawItemId = (v as { itemId?: string }).itemId;
            const itemId =
              (rawItemId && normalizeMercadoLibreItemId(rawItemId)) ||
              fallbackItemId;
            return {
              itemId,
              variationId: String(v.variationId),
              sku: v.sku,
              color: v.color,
              size: v.size,
              stock: Number(v.stock ?? 0),
              sourceId,
            };
          });
          allRows.push(...rows);
          return { ...src, variationCount: rows.length, loadError: undefined, autoLoaded: src.autoLoaded };
        } catch (e: any) {
          return { ...src, loadError: e?.message || 'Error al cargar', autoLoaded: src.autoLoaded };
        }
      })
    );
    const fetchedKeys = mlSourceIdKeys(sources.map((s) => s.id));
    const updated = new Map(nextSources.map((s) => [s.id, s]));
    setMlSources((prev) =>
      prev.map((s) => {
        const patch =
          updated.get(s.id) ||
          [...updated.values()].find((u) => mercadoLibreItemIdsMatch(u.id, s.id));
        return patch
          ? { ...s, variationCount: patch.variationCount, loadError: patch.loadError }
          : s;
      })
    );
    setMlVariations((prev) => {
      const kept = prev.filter((row) => {
        // Reemplazar todo lo que se acaba de pedir (por sourceId o por itemId).
        if (row.sourceId) {
          for (const c of mercadoLibreItemIdCandidates(row.sourceId)) {
            if (fetchedKeys.has(c.toLowerCase())) return false;
          }
        }
        for (const c of mercadoLibreItemIdCandidates(row.itemId)) {
          if (fetchedKeys.has(c.toLowerCase())) return false;
        }
        return true;
      });
      return dedupeMlCatalogRows([...kept, ...allRows]);
    });
    return { rows: allRows, sources: nextSources };
  };

  const fetchTnCatalogRows = async (sources: PublicationSource[]) => {
    const allRows: TnVariantRow[] = [];
    const nextSources = await Promise.all(
      sources.map(async (src) => {
        try {
          const res = await api.getTiendaNubeProductVariants(src.id);
          const productId = String(res.productId ?? src.id);
          const rows = (res.variants || []).map((v) => ({
            productId,
            variantId: String(v.variantId),
            sku: v.sku,
            color: v.color,
            size: v.size,
          }));
          allRows.push(...rows);
          return { ...src, variationCount: rows.length, loadError: undefined, autoLoaded: src.autoLoaded };
        } catch (e: any) {
          return { ...src, loadError: e?.message || 'Error al cargar', autoLoaded: src.autoLoaded };
        }
      })
    );
    const fetchedIds = new Set(sources.map((s) => s.id));
    const updated = new Map(nextSources.map((s) => [s.id, s]));
    setTnSources((prev) =>
      prev.map((s) => {
        const patch = updated.get(s.id);
        return patch ? { ...s, variationCount: patch.variationCount, loadError: patch.loadError } : s;
      })
    );
    setTnVariants((prev) => {
      const kept = prev.filter((row) => !fetchedIds.has(row.productId));
      return [...kept, ...allRows];
    });
    return { rows: allRows, sources: nextSources };
  };

  useEffect(() => {
    if (!pendingCatalogFetch) return;
    if (catalogFetchStartedRef.current === pendingCatalogFetch.loadId) return;
    const { mlSourceIds, tnSourceIds } = pendingCatalogFetch;
    if (mlSourceIds.length === 0 && tnSourceIds.length === 0) return;

    catalogFetchStartedRef.current = pendingCatalogFetch.loadId;
    const { assignments: baseAssign, variants: localVariants } = pendingCatalogFetch;
    setPendingCatalogFetch(null);
    const mlSrc: PublicationSource[] = mlSourceIds.map((id) => {
      const existing = mlSources.find((s) => mercadoLibreItemIdsMatch(s.id, id));
      return {
        id,
        autoLoaded: true,
        packSize: existing?.packSize ?? 1,
      };
    });
    const tnSrc: PublicationSource[] = tnSourceIds.map((id) => ({ id, autoLoaded: true }));

    void (async () => {
      setLoading(true);
      try {
        const [mlResult, tnResult] = await Promise.all([
          mlSrc.length > 0
            ? fetchMlCatalogRows(mlSrc)
            : Promise.resolve({ rows: [] as MlVariationRow[], sources: [] as PublicationSource[] }),
          tnSrc.length > 0
            ? fetchTnCatalogRows(tnSrc)
            : Promise.resolve({ rows: [] as TnVariantRow[], sources: [] as PublicationSource[] }),
        ]);

        let nextAssign = repairMlAssignmentsFromCatalog(localVariants, baseAssign, mlResult.rows);

        if (tnSrc.length === 1 && tnResult.rows.length > 0) {
          const soleProductId = String(tnResult.rows[0].productId);
          for (const v of localVariants) {
            const a = nextAssign[v.variantId];
            if (!a?.tn?.trim()) continue;
            if (a.tnProductId !== soleProductId) {
              nextAssign[v.variantId] = { ...a, tnProductId: soleProductId };
            }
          }
        }

        runAutoMatch(localVariants, mlResult.rows, tnResult.rows, nextAssign, mlSrc);

        const errors: string[] = [];
        [...mlResult.sources, ...tnResult.sources].forEach((s) => {
          if (s.loadError) errors.push(`${s.id}: ${s.loadError}`);
        });
        if (errors.length) {
          showToast('error', errors.join(' '));
        }
      } catch {
        showToast('error', 'No se pudieron cargar los catálogos ML/TN');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-carga inicial al abrir el artículo
  }, [pendingCatalogFetch]);

  const handleLoadAllMl = async () => {
    if (mlSources.length === 0) {
      showToast('info', 'Agregá al menos una publicación ML.');
      return;
    }
    setLoading(true);
    const { rows: mlList } = await fetchMlCatalogRows(mlSources);
    const baseAssignments = repairMlAssignmentsFromCatalog(variants, assignments, mlList);
    runAutoMatch(variants, mlList, tnVariants, baseAssignments, mlSources);
    setLoading(false);
    showToast('success', `Cargadas ${mlList.length} variaciones de ${mlSources.length} publicación(es) ML.`);
  };

  const handleLoadAllTn = async () => {
    if (tnSources.length === 0) {
      showToast('info', 'Agregá al menos un producto TN.');
      return;
    }
    setLoading(true);
    const { rows: tnList } = await fetchTnCatalogRows(tnSources);
    let baseAssignments = assignments;
    if (tnSources.length === 1 && tnList.length > 0) {
      const soleProductId = String(tnList[0].productId);
      const remapped = { ...assignments };
      let changed = false;
      for (const v of variants) {
        const a = remapped[v.variantId];
        if (!a?.tn?.trim()) continue;
        if (a.tnProductId !== soleProductId) {
          remapped[v.variantId] = { ...a, tnProductId: soleProductId };
          changed = true;
        }
      }
      if (changed) {
        setAssignments(remapped);
        baseAssignments = remapped;
      }
    }
    runAutoMatch(variants, mlVariations, tnList, baseAssignments, mlSources);
    setLoading(false);
    showToast('success', `Cargadas ${tnList.length} variantes de ${tnSources.length} producto(s) TN.`);
  };

  const handleLoadAllAndMatch = async () => {
    if (mlSources.length === 0 && tnSources.length === 0) {
      showToast('info', 'Agregá publicaciones ML y/o TN en el paso 1.');
      return;
    }
    setLoading(true);
    const [mlResult, tnResult] = await Promise.all([
      mlSources.length > 0 ? fetchMlCatalogRows(mlSources) : Promise.resolve({ rows: [] as MlVariationRow[], sources: [] as PublicationSource[] }),
      tnSources.length > 0 ? fetchTnCatalogRows(tnSources) : Promise.resolve({ rows: [] as TnVariantRow[], sources: [] as PublicationSource[] }),
    ]);
    const repaired = repairMlAssignmentsFromCatalog(variants, assignments, mlResult.rows);
    const next = runAutoMatch(variants, mlResult.rows, tnResult.rows, repaired, mlSources);
    setLoading(false);
    const errors: string[] = [];
    [...mlResult.sources, ...tnResult.sources].forEach((s) => {
      if (s.loadError) errors.push(`${s.id}: ${s.loadError}`);
    });
    if (errors.length) showToast('error', errors.join(' '));
    else {
      const linked = Object.values(next).filter((a) => a.ml?.trim() || a.tn?.trim()).length;
      showToast(
        'success',
        linked > 0
          ? `Emparejadas ${linked} variantes desde ${mlSources.length} ML y ${tnSources.length} TN.`
          : 'Listas cargadas; no hubo emparejamiento automático.'
      );
    }
  };

  const syncAllSourcePublications = async () => {
    let added = 0;
    const mlPackByItemId = new Map(
      mlSources.map((s) => {
        const normId = normalizeMercadoLibreItemId(s.id) || s.id;
        return [normId, Math.max(1, s.packSize ?? packMl)];
      })
    );
    const tnPackByProductId = new Map(
      tnSources.map((s) => [s.id, Math.max(1, s.packSize ?? packTn)])
    );
    const mlSourceIds = new Set(
      mlSources.map((s) => normalizeMercadoLibreItemId(s.id)).filter(Boolean) as string[]
    );
    const tnSourceIds = new Set(tnSources.map((s) => s.id).filter(Boolean));

    const primaryMlByVariant = new Map<string, string | null>();
    const allPrimaryMl = new Set<string>();
    for (const v of variants) {
      const primary = primaryMlItemIdFromAssignment(assignments[v.variantId]);
      primaryMlByVariant.set(v.variantId, primary);
      if (primary) {
        const norm = normalizeMercadoLibreItemId(primary) || primary;
        allPrimaryMl.add(norm);
      }
    }

    const primaryTnByVariant = new Map<string, string | null>();
    const allPrimaryTn = new Set<string>();
    for (const v of variants) {
      const a = assignments[v.variantId];
      const key = tnAssignmentKey(a?.tn?.trim() || '', a?.tnProductId);
      primaryTnByVariant.set(v.variantId, key);
      if (key) allPrimaryTn.add(key);
    }

    for (const v of variants) {
      const a = assignments[v.variantId];
      const local = {
        sku: (skuEdits[v.variantId] ?? v.sku ?? '').toString(),
        size: v.size,
        color: v.color,
      };
      const ownPrimaryMl = primaryMlByVariant.get(v.variantId);
      const ownPrimaryMlNorm = ownPrimaryMl ? normalizeMercadoLibreItemId(ownPrimaryMl) || ownPrimaryMl : null;
      const hasMlAssignment = hasAnyMlAssignment(a);

      if (hasMlAssignment) {
        for (const src of mlSources) {
          const itemId = mlItemKey(src.id);
          const explicitVar = getMlVariationForItem(a, itemId);
          if (explicitVar) {
            const row = mlVariations.find(
              (m) => m.variationId === explicitVar && mlRowBelongsToSource(m, src.id)
            );
            if (row) {
              try {
                await api.addVariantPublication(v.variantId, {
                  platform: 'mercadolibre',
                  externalProductId: row.itemId,
                  externalVariantId: row.variationId,
                  packSize: mlPackByItemId.get(itemId) ?? packMl,
                });
                added++;
              } catch {
                /* ya vinculada */
              }
              continue;
            }
          }
          for (const row of mlVariations) {
            if (!matchLocalToRow(local, row)) continue;
            if (!mlRowBelongsToSource(row, src.id)) continue;
            const rowItemId = normalizeMercadoLibreItemId(row.itemId);
            if (!rowItemId) continue;
            if (rowItemId !== ownPrimaryMlNorm && allPrimaryMl.has(rowItemId)) continue;
            try {
              await api.addVariantPublication(v.variantId, {
                platform: 'mercadolibre',
                externalProductId: row.itemId,
                externalVariantId: row.variationId,
                packSize: mlPackByItemId.get(itemId) ?? packMl,
              });
              added++;
            } catch {
              /* ya vinculada */
            }
            break;
          }
        }
      }

      const hasTnAssignment = !!(a?.tn?.trim());
      if (hasTnAssignment) {
        const ownPrimaryTn = primaryTnByVariant.get(v.variantId);
        for (const row of tnVariants) {
          if (!matchLocalToRow(local, row)) continue;
          if (!tnSourceIds.has(row.productId)) continue;
          const rowKey = tnOptionKey(row);
          if (rowKey !== ownPrimaryTn && allPrimaryTn.has(rowKey)) continue;
          try {
            await api.addVariantPublication(v.variantId, {
              platform: 'tiendanube',
              externalProductId: row.productId,
              externalVariantId: row.variantId,
              packSize: tnPackByProductId.get(row.productId) ?? packTn,
            });
            added++;
          } catch {
            /* ya vinculada */
          }
        }
      }
    }
    return added;
  };

  /** Quita publicaciones ML/TN que pertenecen al vínculo principal de otra variante del mismo artículo. */
  const cleanupSiblingPublications = async () => {
    const primaryMlByVariant = new Map<string, string | null>();
    const allPrimaryMl = new Set<string>();
    for (const v of variants) {
      const primary = primaryMlItemIdFromAssignment(assignments[v.variantId]);
      primaryMlByVariant.set(v.variantId, primary);
      if (primary) allPrimaryMl.add(normalizeMercadoLibreItemId(primary) || primary);
    }

    const primaryTnByVariant = new Map<string, string | null>();
    const allPrimaryTn = new Set<string>();
    for (const v of variants) {
      const a = assignments[v.variantId];
      const key = tnAssignmentKey(a?.tn?.trim() || '', a?.tnProductId);
      primaryTnByVariant.set(v.variantId, key);
      if (key) allPrimaryTn.add(key);
    }

    let removed = 0;
    for (const v of variants) {
      const pubs = await api.getVariantPublications(v.variantId).catch(() => []);
      const ownMl = primaryMlByVariant.get(v.variantId);
      const ownMlNorm = ownMl ? normalizeMercadoLibreItemId(ownMl) || ownMl : null;
      const ownTn = primaryTnByVariant.get(v.variantId);
      for (const pub of pubs) {
        if (pub.platform === 'mercadolibre' && pub.external_product_id) {
          const id = normalizeMercadoLibreItemId(pub.external_product_id) || String(pub.external_product_id).trim();
          if (id && id !== ownMlNorm && allPrimaryMl.has(id)) {
            await api.deleteVariantPublication(v.variantId, pub.id);
            removed++;
          }
        }
        if (pub.platform === 'tiendanube' && pub.external_variant_id) {
          const key = tnAssignmentKey(String(pub.external_variant_id), pub.external_product_id);
          if (key && key !== ownTn && allPrimaryTn.has(key)) {
            await api.deleteVariantPublication(v.variantId, pub.id);
            removed++;
          }
        }
      }
    }
    return removed;
  };

  const handleSave = async () => {
    if (!productId) return;
    const saveAssignments = Object.fromEntries(
      variants.map((v) => [
        v.variantId,
        syncPrimaryMlAssignment(assignments[v.variantId], mlSources),
      ])
    );
    const mlSeen = new Map<string, string>();
    const tnSeen = new Map<string, string>();
    for (const v of variants) {
      const a = saveAssignments[v.variantId];
      const tn = a?.tn?.trim() || '';
      for (const mlKey of iterMlAssignmentKeys(a)) {
        const other = mlSeen.get(mlKey);
        if (other) {
          showToast('error', `La variación ML ya está asignada a otra fila. Cada variación externa solo puede vincularse a una variante local.`);
          return;
        }
        mlSeen.set(mlKey, v.variantId);
      }
      if (tn) {
        if (!a?.tnProductId?.trim()) {
          showToast('error', `Falta el producto TN para la variante ${formatOptionLabel(v)}.`);
          return;
        }
        const tnKey = tnAssignmentKey(tn, a?.tnProductId);
        if (!tnKey) continue;
        const other = tnSeen.get(tnKey);
        if (other) {
          showToast('error', `La variante TN ya está asignada a otra fila. Cada variante externa solo puede vincularse a una variante local.`);
          return;
        }
        tnSeen.set(tnKey, v.variantId);
      }
    }
    setSaving(true);
    try {
      for (const v of variants) {
        const nextSku = (skuEdits[v.variantId] ?? v.sku ?? '').toString().trim();
        if (!nextSku || nextSku === v.sku) continue;
        await api.updateVariant(String(v.variantId), { sku: nextSku });
      }
      const mlUnlinks = variants.filter((v) => {
        const a = saveAssignments[v.variantId];
        return variantHadMlLink(v.externalIds) && !hasMlAssignment(a);
      });
      const links = variants
        .map((v) => {
          const a = saveAssignments[v.variantId];
          const ml = a?.ml?.trim() || '';
          const tn = a?.tn?.trim() || '';
          const isMlItemId = /^ML[A-Z]{1,5}\d+$/i.test(ml);
          const catalogRow =
            !isMlItemId && ml
              ? mlVariations.find(
                  (m) =>
                    m.variationId === ml &&
                    (!a?.mlItemId ||
                      mercadoLibreItemIdsMatch(a.mlItemId, m.itemId) ||
                      mlSources.some((s) => mlRowBelongsToSource(m, s.id)))
                )
              : undefined;
          return {
            variantId: String(v.variantId),
            mercadoLibreVariantId: !isMlItemId && ml ? ml : undefined,
            mercadoLibreItemId: isMlItemId
              ? ml
              : ml
                ? catalogRow?.itemId || (a?.mlItemId?.trim() ? a.mlItemId.trim() : undefined)
                : undefined,
            tiendaNubeVariantId: tn || undefined,
            tiendaNubeProductId: a?.tnProductId?.trim() || undefined,
          };
        })
        .filter(
          (l) => l.mercadoLibreVariantId != null || l.mercadoLibreItemId != null || l.tiendaNubeVariantId != null
        );
      if (links.length === 0 && mlUnlinks.length === 0) {
        showToast('info', 'Asigná al menos una variación ML o variante TN.');
        setSaving(false);
        return;
      }
      for (const v of mlUnlinks) {
        await api.updateVariantExternalIds(v.variantId, {
          mercadoLibreVariantId: null,
          mercadoLibreItemId: null,
        });
      }
      let updated = mlUnlinks.length;
      let synced = 0;
      if (links.length > 0) {
        const allMlOwn =
          links.every((l) => {
            const ml = saveAssignments[l.variantId]?.ml?.trim() || '';
            return !ml || /^ML[A-Z]{1,5}\d+$/i.test(ml);
          }) && links.some((l) => /^ML[A-Z]{1,5}\d+$/i.test(saveAssignments[l.variantId]?.ml?.trim() || ''));
        const primaryMl = mlSources[0]?.id;
        const primaryTn = tnSources[0]?.id;
        const res = await api.bulkLinkVariants({
          productId,
          mercadoLibreItemId: allMlOwn ? undefined : primaryMl || undefined,
          tiendaNubeProductId: primaryTn && /^\d+$/.test(primaryTn) ? primaryTn : undefined,
          links,
        });
        updated = (res as any)?.updated ?? links.length;
        synced = (res as any)?.synced ?? 0;
      }
      const removed = await cleanupSiblingPublications();
      const extraPubs = await syncAllSourcePublications();
      onImportComplete?.();
      setSuggestedLinkIds(new Set());
      const removedNote = removed > 0 ? ` Se quitaron ${removed} publicación(es) duplicada(s) de otras variantes.` : '';
      showToast(
        'success',
        synced > 0
          ? `Guardadas ${updated} vinculación(es). Stock enviado a ${synced} variante(s).${extraPubs > 0 ? ` ${extraPubs} publicación(es) extra sincronizadas.` : ''}${removedNote}`
          : `Guardadas ${updated} vinculación(es).${extraPubs > 0 ? ` ${extraPubs} publicación(es) extra sincronizadas.` : ''}${removedNote}`
      );
      goBack();
    } catch (e: any) {
      showToast('error', e?.message || 'Error al guardar vinculaciones.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && variants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 size={36} className="text-indigo-400 animate-spin" />
        <p className="text-sm text-slate-400">Cargando variantes del artículo…</p>
      </div>
    );
  }

  const steps = [
    { n: 1, label: 'Cargar publicaciones', active: currentStep === 1, done: catalogsLoaded },
    { n: 2, label: 'Revisar emparejamientos', active: currentStep === 2, done: linkStats.ml > 0 || linkStats.tn > 0 },
    { n: 3, label: 'Guardar', active: false, done: false },
  ];

  return (
    <div className="flex flex-col gap-4 pb-24 md:pb-8 w-full">
      {/* Header */}
      <header className="shrink-0 flex flex-wrap items-start gap-4 pb-1">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/80 text-sm font-medium transition-colors"
        >
          <ArrowLeft size={18} />
          Inventario
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30">
              <Link size={18} className="text-indigo-400" />
            </span>
            Vincular y sincronizar con ML y TN
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Cada variante local debe tener su propia variación en ML/TN. Si dos filas comparten el mismo ID externo, al guardar una puede desvincular a la otra.
          </p>
          <p className="text-sm text-slate-400 mt-0.5 truncate">
            <span className="text-slate-200">{productName}</span>
            <span className="mx-2 text-slate-600">·</span>
            <span className="font-mono text-slate-300">{groupKey}</span>
            <span className="mx-2 text-slate-600">·</span>
            <span>{linkStats.total} variantes</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {(hasAnyMlLinks || hasAnyTnLinks) && (
            <>
              {hasAnyMlLinks && (
                <button
                  type="button"
                  onClick={() => void handleUnlinkPlatforms('mercadolibre')}
                  disabled={unlinking || saving || !productId}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-amber-200 bg-amber-950/40 border border-amber-800/50 hover:bg-amber-900/50 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                >
                  {unlinking ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
                  Desvincular ML
                </button>
              )}
              {hasAnyTnLinks && (
                <button
                  type="button"
                  onClick={() => void handleUnlinkPlatforms('tiendanube')}
                  disabled={unlinking || saving || !productId}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-cyan-200 bg-cyan-950/40 border border-cyan-800/50 hover:bg-cyan-900/50 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                >
                  {unlinking ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
                  Desvincular TN
                </button>
              )}
              {hasAnyMlLinks && hasAnyTnLinks && (
                <button
                  type="button"
                  onClick={() => void handleUnlinkPlatforms('both')}
                  disabled={unlinking || saving || !productId}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-rose-200 bg-rose-950/40 border border-rose-800/50 hover:bg-rose-900/50 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                >
                  {unlinking ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
                  Desvincular todo
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => onNavigate('stock_history')}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-violet-600/80 border border-slate-700 text-slate-300 hover:text-white text-sm font-medium flex items-center gap-2 transition-colors"
          >
            <History size={16} />
            Historial
          </button>
        </div>
      </header>

      {suggestedLinkIds.size > 0 && (
        <div className="rounded-xl border border-amber-600/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100/95">
          <p className="font-semibold text-amber-200">
            {suggestedLinkIds.size} variante(s) con emparejamiento sugerido (aún no guardado)
          </p>
          <p className="text-xs text-amber-200/70 mt-1">
            El inventario solo marca como vinculado lo que está guardado. Revisá las filas y tocá{' '}
            <strong className="text-amber-100">Guardar vinculaciones</strong> para que dejen de aparecer como “Sin vincular”.
          </p>
        </div>
      )}

      {/* Pasos */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 sm:gap-0">
        {steps.map((step, i) => (
          <React.Fragment key={step.n}>
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                step.active
                  ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/40'
                  : step.done
                    ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-700/40'
                    : 'bg-slate-800/60 text-slate-500 border border-slate-700/60'
              }`}
            >
              <span
                className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black ${
                  step.done ? 'bg-emerald-600 text-white' : step.active ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-400'
                }`}
              >
                {step.done ? '✓' : step.n}
              </span>
              {step.label}
            </div>
            {i < steps.length - 1 && (
              <div className="hidden sm:block w-8 h-px bg-slate-700 mx-1" aria-hidden />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Paso 1: cargar publicaciones */}
      <section className="shrink-0 rounded-2xl border border-slate-700/80 bg-slate-800/40 overflow-hidden">
        {!step1Expanded ? (
          <button
            type="button"
            onClick={() => setStep1Expanded(true)}
            className="w-full px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-left hover:bg-slate-800/60 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              {catalogsLoaded ? (
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              ) : (
                <Circle size={16} className="text-slate-500 shrink-0" />
              )}
              <span className="text-sm font-semibold text-slate-200">Paso 1 · Publicaciones a sincronizar</span>
              <span className="text-xs text-slate-500 truncate hidden sm:inline">
                {mlSources.length} publicación{mlSources.length === 1 ? '' : 'es'} ML
                {tnSources.length > 0 ? ` · ${tnSources.length} TN` : ''}
              </span>
            </div>
            <span className="text-xs text-indigo-400 font-medium flex items-center gap-1 shrink-0">
              Mostrar <ChevronDown size={14} />
            </span>
          </button>
        ) : (
          <>
        <div className="px-4 py-3 border-b border-slate-700/60 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white">Paso 1 · Publicaciones a sincronizar</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Una ficha de ML con varias variantes = <strong className="text-slate-300">1 publicación</strong>.
              Agregá packs u otras publicaciones solo si son avisos distintos (x2, x3, etc.). Al guardar, el stock
              se sincroniza según el emparejamiento por{' '}
              <strong className="text-slate-300">SKU</strong> o <strong className="text-slate-300">talle y color</strong>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep1Expanded(false)}
              className="flex items-center gap-1 text-xs text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 border border-slate-600 transition-colors"
            >
              Ocultar <ChevronUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => setShowMlTip((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-amber-300/90 hover:text-amber-200 px-2 py-1 rounded-lg hover:bg-amber-950/30 transition-colors"
            >
              <HelpCircle size={14} />
              {showMlTip ? 'Ocultar ayuda' : '¿Publicaciones ML separadas?'}
            </button>
          </div>
        </div>

        {showMlTip && (
          <div className="mx-4 mt-3 mb-1 text-xs text-amber-100/90 bg-amber-950/30 border border-amber-700/40 rounded-xl px-3 py-2.5 leading-relaxed">
            Podés agregar otra publicación ML solo si es un aviso distinto (pack x2/x3, otra ficha). Las variantes
            (colores/talles) de la misma ficha se eligen en el Paso 2, no como publicaciones aparte.
            Si una variante es una publicación ML propia, escribí el MLA completo en la fila del paso 2.
          </div>
        )}

        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ML sources */}
          <div className="rounded-xl border border-amber-700/40 bg-amber-950/15 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/20">
                  <Zap size={16} className="text-amber-400" />
                </span>
                <div>
                  <p className="text-sm font-bold text-amber-100">Mercado Libre</p>
                  <p className="text-[11px] text-amber-200/60">{mlSources.length} publicación(es)</p>
                </div>
              </div>
              {mlVariations.length > 0 && (
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-600/30">
                  {mlVariations.length} variaciones
                </span>
              )}
            </div>
            <div className="space-y-2 max-h-[160px] overflow-y-auto">
              {mlSources.length === 0 ? (
                <p className="text-xs text-slate-500 py-2 text-center border border-dashed border-amber-800/40 rounded-lg">
                  Sin publicaciones ML
                </p>
              ) : (
                mlSources.map((src) => {
                  const srcPack = Math.max(1, src.packSize ?? packMl);
                  return (
                  <div
                    key={src.id}
                    className="flex flex-wrap items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-900/50 border border-amber-800/30"
                  >
                    <span className="flex-1 min-w-0 font-mono text-xs text-amber-100 truncate">{src.id}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {PACK_OPTIONS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => updateMlSourcePack(src.id, n)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                            srcPack === n
                              ? 'bg-amber-600 text-white'
                              : 'bg-slate-800 text-slate-400 hover:text-amber-200'
                          }`}
                          title={`Pack x${n}`}
                        >
                          x{n}
                        </button>
                      ))}
                    </div>
                    {src.variationCount != null && (
                      <span className="text-[10px] text-emerald-400 shrink-0">{src.variationCount} var.</span>
                    )}
                    {src.loadError && (
                      <span className="text-[10px] text-red-400 shrink-0" title={src.loadError}>
                        Error
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => dismissMlSource(src.id)}
                      className="p-1 text-slate-500 hover:text-red-400 shrink-0"
                      aria-label="Quitar"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  );
                })
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={mlDraft}
                onChange={(e) => setMlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && mlDraft.trim()) {
                    e.preventDefault();
                    if (appendMlSources(mlDraft)) setMlDraft('');
                  }
                }}
                placeholder="Link o MLA… (varios separados por coma o Enter)"
                className="flex-1 min-w-0 bg-slate-900/60 border border-amber-800/50 rounded-lg px-3 py-2 text-white font-mono text-xs outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={() => {
                  if (appendMlSources(mlDraft)) setMlDraft('');
                }}
                disabled={!mlDraft.trim()}
                className="shrink-0 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-50"
              >
                <Plus size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={handleLoadAllMl}
              disabled={mlSources.length === 0 || loading}
              className="w-full px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Cargar todas ML
            </button>
          </div>

          {/* TN sources */}
          <div className="rounded-xl border border-cyan-700/40 bg-cyan-950/15 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-500/20">
                  <Cloud size={16} className="text-cyan-400" />
                </span>
                <div>
                  <p className="text-sm font-bold text-cyan-100">Tienda Nube</p>
                  <p className="text-[11px] text-cyan-200/60">{tnSources.length} producto(s)</p>
                </div>
              </div>
              {tnVariants.length > 0 && (
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-600/30">
                  {tnVariants.length} variantes
                </span>
              )}
            </div>
            <div className="space-y-2 max-h-[160px] overflow-y-auto">
              {tnSources.length === 0 ? (
                <p className="text-xs text-slate-500 py-2 text-center border border-dashed border-cyan-800/40 rounded-lg">
                  Sin productos TN
                </p>
              ) : (
                tnSources.map((src) => {
                  const srcPack = Math.max(1, src.packSize ?? packTn);
                  return (
                  <div
                    key={src.id}
                    className="flex flex-wrap items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-900/50 border border-cyan-800/30"
                  >
                    <span className="flex-1 min-w-0 font-mono text-xs text-cyan-100 truncate">{src.id}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {PACK_OPTIONS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => updateTnSourcePack(src.id, n)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                            srcPack === n
                              ? 'bg-cyan-600 text-white'
                              : 'bg-slate-800 text-slate-400 hover:text-cyan-200'
                          }`}
                          title={`Pack x${n}`}
                        >
                          x{n}
                        </button>
                      ))}
                    </div>
                    {src.variationCount != null && (
                      <span className="text-[10px] text-emerald-400 shrink-0">{src.variationCount} var.</span>
                    )}
                    {src.loadError && (
                      <span className="text-[10px] text-red-400 shrink-0" title={src.loadError}>
                        Error
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => dismissTnSource(src.id)}
                      className="p-1 text-slate-500 hover:text-red-400 shrink-0"
                      aria-label="Quitar"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  );
                })
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tnDraft}
                onChange={(e) => setTnDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tnDraft.trim()) {
                    e.preventDefault();
                    if (appendTnSources(tnDraft)) setTnDraft('');
                  }
                }}
                placeholder="Link o ID TN… (varios separados por coma)"
                className="flex-1 min-w-0 bg-slate-900/60 border border-cyan-800/50 rounded-lg px-3 py-2 text-white font-mono text-xs outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={() => {
                  if (appendTnSources(tnDraft)) setTnDraft('');
                }}
                disabled={!tnDraft.trim()}
                className="shrink-0 px-3 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold disabled:opacity-50"
              >
                <Plus size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={handleLoadAllTn}
              disabled={tnSources.length === 0 || loading}
              className="w-full px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Cargar todas TN
            </button>
          </div>
        </div>

        <div className="px-4 pb-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleLoadAllAndMatch}
            disabled={(mlSources.length === 0 && tnSources.length === 0) || loading || variants.length === 0}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-indigo-900/30 transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Cargar todas y emparejar
          </button>
          {catalogsLoaded && (
            <button
              type="button"
              onClick={() => runAutoMatch(variants, mlVariations, tnVariants)}
              className="text-sm text-indigo-400 hover:text-indigo-300 font-medium px-2 py-1 rounded-lg hover:bg-indigo-950/40 transition-colors"
            >
              Volver a emparejar (solo filas vacías)
            </button>
          )}
          {loading && (
            <span className="text-xs text-slate-500 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Consultando APIs…
            </span>
          )}
        </div>
          </>
        )}
      </section>

      {/* Paso 2: emparejar variantes — altura natural, scroll de página */}
      <section className="rounded-2xl border border-slate-700/80 bg-slate-900/30 overflow-hidden">
        <div className="shrink-0 px-4 py-3 border-b border-slate-700/60 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">Paso 2 · Emparejar variantes</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Una variación ML o variante TN solo puede asignarse a una fila. Si tenés duplicados locales, marcá dos filas y usá{' '}
                <strong className="text-violet-300">Unificar</strong>. Las publicaciones <strong>extra</strong> del paso 1 (pack u otro canal) se sincronizan al guardar; no se agregan las de otras variantes del mismo artículo.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {suggestedUnifyPair && selectedUnifyIds.length !== 2 && (
                <button
                  type="button"
                  onClick={() => openUnifyModal(suggestedUnifyPair)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors"
                >
                  <GitMerge size={13} />
                  Unificar U y XG (mismo artículo)
                </button>
              )}
              {selectedUnifyIds.length === 2 && (
                <button
                  type="button"
                  onClick={() => openUnifyModal()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors"
                >
                  <GitMerge size={13} />
                  Unificar 2 seleccionadas
                </button>
              )}
              <span className="px-2 py-1 rounded-lg bg-amber-950/40 text-amber-300 border border-amber-800/40 font-semibold">
                ML {linkStats.ml}/{linkStats.total}
              </span>
              <span className="px-2 py-1 rounded-lg bg-cyan-950/40 text-cyan-300 border border-cyan-800/40 font-semibold">
                TN {linkStats.tn}/{linkStats.total}
              </span>
              <span className="px-2 py-1 rounded-lg bg-emerald-950/40 text-emerald-300 border border-emerald-800/40 font-semibold">
                Completas {linkStats.both}/{linkStats.total}
              </span>
              {assignmentConflictCount > 0 && (
                <span className="px-2 py-1 rounded-lg bg-rose-950/50 text-rose-300 border border-rose-800/50 font-semibold">
                  Conflictos {assignmentConflictCount}
                </span>
              )}
            </div>
          </div>
          {suggestedUnifyPair && (
            <div className="rounded-xl border border-violet-700/50 bg-violet-950/25 px-3 py-2.5 text-xs text-violet-100 leading-relaxed">
              <strong className="text-violet-200">U y XG son el mismo artículo</strong> en este caso: tenés dos filas
              locales (170/U y 180/XG) apuntando al mismo listing. Unificá para dejar una sola variante con todo el
              stock y los vínculos ML/TN.
            </div>
          )}
          {assignmentConflictCount > 0 && (
            <div className="rounded-xl border border-rose-700/50 bg-rose-950/25 px-3 py-2.5 text-xs text-rose-100 leading-relaxed">
              <strong className="text-rose-200">Hay asignaciones duplicadas.</strong> Cada variación ML y cada variante
              TN solo puede vincularse a una fila local. Revisá las filas marcadas en rojo antes de guardar.
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-emerald-500 transition-all duration-500"
                style={{ width: `${linkStats.progress}%` }}
              />
            </div>
            <span className="text-xs font-mono text-slate-400 w-10 text-right">{linkStats.progress}%</span>
          </div>
          {catalogsLoaded && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={mlSearch}
                  onChange={(e) => setMlSearch(e.target.value)}
                  placeholder={`Filtrar opciones ML (${mlVariations.length})`}
                  className="w-full bg-slate-800/80 border border-slate-600/80 rounded-lg pl-8 pr-3 py-2 text-white text-xs outline-none focus:border-amber-500/60"
                />
              </div>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={tnSearch}
                  onChange={(e) => setTnSearch(e.target.value)}
                  placeholder={`Filtrar opciones TN (${tnVariants.length})`}
                  className="w-full bg-slate-800/80 border border-slate-600/80 rounded-lg pl-8 pr-3 py-2 text-white text-xs outline-none focus:border-cyan-500/60"
                />
              </div>
            </div>
          )}
        </div>

        {variants.length === 0 ? (
          <p className="text-slate-500 text-center py-16 text-sm">Este artículo no tiene variantes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur-sm">
                <tr className="border-b border-slate-700/80">
                  <th className="text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider p-3 w-10" title="Seleccionar para unificar">
                    ○
                  </th>
                  <th className="text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider p-3 w-8" />
                  <th className="text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider p-3">
                    Mi variante
                  </th>
                  <th className="text-left text-[11px] font-bold text-amber-400/90 uppercase tracking-wider p-3">
                    Mercado Libre
                  </th>
                  <th className="text-left text-[11px] font-bold text-cyan-400/90 uppercase tracking-wider p-3">
                    Tienda Nube
                  </th>
                  <th className="text-left text-[11px] font-bold text-indigo-400/90 uppercase tracking-wider p-3 w-[120px]">
                    Más publ.
                  </th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => {
                  const rowAssignment = assignments[v.variantId];
                  const mlVal = rowAssignment?.ml ?? '';
                  const hasMlLinked = hasAnyMlAssignment(rowAssignment);
                  const tnVal = rowAssignment?.tn ?? '';
                  const tnProductId = rowAssignment?.tnProductId ?? '';
                  const status = getRowLinkStatus(hasMlLinked ? 'linked' : '', tnVal);
                  const mlLabel = resolveMlLabel(v.variantId);
                  const tnLabel = resolveTnLabel(v.variantId);
                  const pubCount = pubCounts[v.variantId] ?? 0;
                  const isExtraOpen = expandedExtraVariantId === v.variantId;
                  const isUnifySelected = selectedUnifyIds.includes(v.variantId);
                  const hasDuplicateMl = duplicateMlByVariant.dup.has(v.variantId);
                  const mlConflictPartnerId = duplicateMlByVariant.partner.get(v.variantId);
                  const mlConflictPartner = mlConflictPartnerId
                    ? variants.find((x) => x.variantId === mlConflictPartnerId)
                    : undefined;
                  const hasDuplicateTn = duplicateTnByVariant.has(v.variantId);
                  const hasAssignmentConflict = hasDuplicateMl || hasDuplicateTn;

                  return (
                    <React.Fragment key={v.variantId}>
                    <tr
                      className={`border-b border-slate-700/40 transition-colors hover:bg-slate-800/40 ${
                        hasAssignmentConflict
                          ? 'bg-rose-950/20'
                          : status === 'complete'
                          ? 'bg-emerald-950/10'
                          : status === 'partial'
                            ? 'bg-amber-950/10'
                            : ''
                      } ${isExtraOpen ? 'bg-indigo-950/20' : ''} ${isUnifySelected ? 'ring-1 ring-inset ring-violet-500/50' : ''}`}
                    >
                      <td className="p-3 align-top">
                        <input
                          type="checkbox"
                          checked={isUnifySelected}
                          onChange={() => toggleUnifySelect(v.variantId)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-violet-500 focus:ring-violet-500/50"
                          title="Seleccionar para unificar"
                        />
                      </td>
                      <td className="p-3 align-top">
                        <div className="flex flex-col items-start gap-1">
                        {hasAssignmentConflict ? (
                          <AlertCircle
                            size={18}
                            className="text-rose-400"
                            title={
                              hasDuplicateMl && hasDuplicateTn
                                ? 'Misma variación ML y variante TN que otra fila'
                                : hasDuplicateMl
                                  ? 'Misma variación ML que otra fila'
                                  : 'Misma variante TN que otra fila'
                            }
                          />
                        ) : status === 'complete' ? (
                          <CheckCircle2 size={18} className="text-emerald-400" title="ML y TN vinculados" />
                        ) : status === 'partial' ? (
                          <AlertCircle size={18} className="text-amber-400" title="Falta ML o TN" />
                        ) : (
                          <Circle size={18} className="text-slate-600" title="Sin vincular" />
                        )}
                        {suggestedLinkIds.has(v.variantId) && (
                          <span
                            className="text-[9px] font-bold uppercase tracking-wide text-amber-300 bg-amber-900/40 border border-amber-700/50 px-1.5 py-0.5 rounded"
                            title="Emparejado automáticamente: guardá para que el inventario lo tome como vinculado"
                          >
                            Sugerido
                          </span>
                        )}
                        </div>
                      </td>
                      <td className="p-3 align-top min-w-[180px]">
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            value={skuEdits[v.variantId] ?? v.sku ?? ''}
                            onChange={(e) => setSkuEdits((prev) => ({ ...prev, [v.variantId]: e.target.value }))}
                            className="w-full bg-slate-800/80 border border-slate-600 rounded-lg px-2.5 py-2 text-blue-200 text-xs font-mono outline-none focus:border-indigo-500/60"
                            title="SKU (editable para mejorar el emparejamiento)"
                          />
                          <p className="text-xs text-slate-400 pl-0.5">
                            <span className="text-slate-300 font-medium">{formatSizeForLink(v.size)}</span>
                            <span className="text-slate-600 mx-1">·</span>
                            {v.color}
                          </p>
                        </div>
                      </td>
                      <td className="p-3 align-top min-w-[220px]">
                        <div className="space-y-2">
                          {hasDuplicateMl && (
                            <p className="text-[10px] text-rose-400 pl-0.5">
                              Misma variación ML que otra fila
                              {mlConflictPartner ? ` (${formatOptionLabel(mlConflictPartner)})` : ''}
                              . Corregí o unificá las variantes duplicadas.
                            </p>
                          )}
                          {mlSources.length > 0 ? (
                            mlSources.map((src) => {
                              const srcPack = Math.max(1, src.packSize ?? packMl);
                              const selectedVar = getMlVariationForItem(rowAssignment, src.id);
                              const pubRows = mlVariationsForSource(mlVariations, src.id);
                              const options = getVisibleMlOptionsForSource(v.variantId, src.id, selectedVar);
                              const selectedOpt = options.find((m) => m.variationId === selectedVar);
                              return (
                                <div
                                  key={src.id}
                                  className="rounded-lg border border-amber-800/30 bg-slate-900/40 p-2 space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-[10px] text-amber-200/90 truncate">{src.id}</span>
                                    <span className="text-[9px] font-bold text-amber-400/80 shrink-0">
                                      Pack x{srcPack}
                                      {src.variationCount != null ? ` · ${src.variationCount} var.` : ''}
                                    </span>
                                  </div>
                                  {src.loadError && (
                                    <p className="text-[10px] text-red-400" title={src.loadError}>
                                      Error al cargar: {src.loadError}
                                    </p>
                                  )}
                                  {mlVariations.length > 0 || pubRows.length > 0 ? (
                                    <select
                                      value={selectedVar}
                                      onChange={(e) => {
                                        const variationId = e.target.value;
                                        if (!variationId) {
                                          setAssignments((prev) => ({
                                            ...prev,
                                            [v.variantId]: syncPrimaryMlAssignment(
                                              setMlVariationForItem(prev[v.variantId], src.id, ''),
                                              mlSources
                                            ),
                                          }));
                                          return;
                                        }
                                        const chosen = options.find((m) => m.variationId === variationId);
                                        const conflictItemId = chosen?.itemId || src.id;
                                        const conflict = findMlAssignmentConflict(
                                          v.variantId,
                                          variationId,
                                          conflictItemId
                                        );
                                        if (conflict) {
                                          const other = variants.find((x) => x.variantId === conflict);
                                          showToast(
                                            'error',
                                            `Esa variación ML ya está en otra fila${other ? ` (${formatOptionLabel(other)})` : ''}.`
                                          );
                                          return;
                                        }
                                        setAssignments((prev) => ({
                                          ...prev,
                                          [v.variantId]: syncPrimaryMlAssignment(
                                            {
                                              ...setMlVariationForItem(prev[v.variantId], src.id, variationId),
                                              ml: variationId,
                                              mlItemId: chosen?.itemId || src.id,
                                            },
                                            mlSources
                                          ),
                                        }));
                                      }}
                                      className={`w-full bg-slate-800 border rounded-lg px-2 py-1.5 text-slate-300 text-xs outline-none ${
                                        hasDuplicateMl
                                          ? 'border-rose-500/70 focus:border-rose-400'
                                          : 'border-slate-600 focus:border-amber-500/60'
                                      }`}
                                    >
                                      <option value="">Elegir variación…</option>
                                      {options.map((m) => {
                                        const owner = assignedMlKeys.get(mlOptionKey(m));
                                        const takenElsewhere = owner && owner !== v.variantId;
                                        return (
                                          <option
                                            key={`${m.sourceId || ''}::${m.itemId}::${m.variationId}`}
                                            value={m.variationId}
                                          >
                                            {formatMlOptionLabel(m)}
                                            {m.itemId && !mercadoLibreItemIdsMatch(m.itemId, src.id)
                                              ? ` · ${m.itemId}`
                                              : ''}
                                            {takenElsewhere ? ' · en otra fila' : ''}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  ) : (
                                    <p className="text-[10px] text-slate-500">Cargá ML arriba</p>
                                  )}
                                  {selectedOpt && (
                                    <p className="text-[10px] text-amber-200/70 truncate" title={formatMlOptionLabel(selectedOpt)}>
                                      ↳ {formatMlOptionLabel(selectedOpt)}
                                    </p>
                                  )}
                                  {pubRows.length === 0 && !src.loadError ? (
                                    <p className="text-[10px] text-amber-400/90">
                                      Variaciones sin cargar — apretá «Cargar todas ML» en el Paso 1.
                                    </p>
                                  ) : mlVariations.length > 0 && !selectedVar && options.length === 0 ? (
                                    <p className="text-[10px] text-amber-400/90">
                                      {mlSearch.trim()
                                        ? 'Sin coincidencias con el filtro de búsqueda.'
                                        : 'Sin variaciones disponibles para esta publicación.'}
                                    </p>
                                  ) : null}
                                </div>
                              );
                            })
                          ) : (
                            <>
                              <input
                                type="text"
                                value={mlVal}
                                onChange={(e) => {
                                  const trimmed = e.target.value.trim();
                                  setAssignments((prev) => ({
                                    ...prev,
                                    [v.variantId]: !trimmed
                                      ? clearMlAssignmentFields(prev[v.variantId])
                                      : {
                                          ...prev[v.variantId],
                                          ml: trimmed,
                                          mlItemId: /^ML[A-Z]{1,5}\d+$/i.test(trimmed)
                                            ? undefined
                                            : prev[v.variantId]?.mlItemId,
                                        },
                                  }));
                                }}
                                placeholder={mlVariations.length > 0 ? 'ID variación o MLA' : 'MLA o variación'}
                                className={`w-full bg-slate-800/80 border rounded-lg px-2.5 py-2 text-white text-xs font-mono outline-none ${
                                  hasDuplicateMl
                                    ? 'border-rose-500/70 focus:border-rose-400'
                                    : 'border-amber-800/40 focus:border-amber-500/70'
                                }`}
                              />
                              {mlLabel && (
                                <p className="text-[10px] text-amber-200/70 truncate pl-0.5" title={mlLabel}>
                                  ↳ {mlLabel}
                                </p>
                              )}
                              {mlVariations.length > 0 ? (
                                <select
                                  value={mlSelectValue(mlVal, rowAssignment?.mlItemId, mlVariations)}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (!val) {
                                      setAssignments((prev) => ({
                                        ...prev,
                                        [v.variantId]: clearMlAssignmentFields(prev[v.variantId]),
                                      }));
                                      return;
                                    }
                                    const [itemId, variationId] = val.split('::');
                                    const conflict = findMlAssignmentConflict(v.variantId, variationId, itemId);
                                    if (conflict) {
                                      const other = variants.find((x) => x.variantId === conflict);
                                      showToast(
                                        'error',
                                        `Esa variación ML ya está en otra fila${other ? ` (${formatOptionLabel(other)})` : ''}.`
                                      );
                                      return;
                                    }
                                    setAssignments((prev) => ({
                                      ...prev,
                                      [v.variantId]: syncPrimaryMlAssignment(
                                        setMlVariationForItem(prev[v.variantId], itemId, variationId),
                                        mlSources
                                      ),
                                    }));
                                  }}
                                  className={`w-full bg-slate-800 border rounded-lg px-2 py-1.5 text-slate-300 text-xs outline-none ${
                                    hasDuplicateMl
                                      ? 'border-rose-500/70 focus:border-rose-400'
                                      : 'border-slate-600 focus:border-amber-500/60'
                                  }`}
                                >
                                  <option value="">Elegir de ML cargado…</option>
                                  {(filteredMl.length > 0 ? filteredMl : mlVariations).map((m) => {
                                    const owner = assignedMlKeys.get(mlOptionKey(m));
                                    const takenElsewhere = owner && owner !== v.variantId;
                                    return (
                                      <option key={mlOptionKey(m)} value={mlOptionKey(m)}>
                                        {m.itemId} · {formatMlOptionLabel(m)}
                                        {takenElsewhere ? ' · en otra fila' : ''}
                                      </option>
                                    );
                                  })}
                                </select>
                              ) : (
                                !mlVal && (
                                  <p className="text-[10px] text-slate-500 pl-0.5">Cargá ML arriba o pegá un MLA</p>
                                )
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="p-3 align-top min-w-[220px]">
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            value={tnVal}
                            onChange={(e) => {
                              const trimmed = e.target.value.trim();
                              setAssignments((prev) => ({
                                ...prev,
                                [v.variantId]: !trimmed
                                  ? { ...prev[v.variantId], tn: '', tnProductId: undefined }
                                  : {
                                      ...prev[v.variantId],
                                      tn: trimmed,
                                    },
                              }));
                            }}
                            placeholder={tnVariants.length > 0 ? 'ID variante TN' : 'ID variante TN'}
                            className={`w-full bg-slate-800/80 border rounded-lg px-2.5 py-2 text-white text-xs font-mono outline-none ${
                              hasDuplicateTn
                                ? 'border-rose-500/70 focus:border-rose-400'
                                : 'border-cyan-800/40 focus:border-cyan-500/70'
                            }`}
                          />
                          <input
                            type="text"
                            value={tnProductId}
                            onChange={(e) => {
                              const trimmed = e.target.value.trim();
                              setAssignments((prev) => ({
                                ...prev,
                                [v.variantId]: {
                                  ...prev[v.variantId],
                                  tnProductId: trimmed || undefined,
                                },
                              }));
                            }}
                            placeholder="ID producto TN (opcional)"
                            className="w-full bg-slate-900/60 border border-cyan-900/40 rounded-lg px-2.5 py-1.5 text-cyan-100/80 text-[11px] font-mono outline-none focus:border-cyan-500/60"
                          />
                          {tnVariants.length > 0 ? (
                            <select
                              value={tnSelectValue(tnVal, tnProductId, tnVariants)}
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (!raw) {
                                  setAssignments((prev) => ({
                                    ...prev,
                                    [v.variantId]: { ...prev[v.variantId], tn: '', tnProductId: undefined },
                                  }));
                                  return;
                                }
                                const [productId, tnValNew] = raw.includes('::')
                                  ? raw.split('::')
                                  : ['', raw];
                                const tnOpt = tnVariants.find(
                                  (t) => t.variantId === tnValNew && (!productId || t.productId === productId)
                                );
                                const resolvedProductId = tnOpt?.productId || productId || undefined;
                                const conflict = findTnAssignmentConflict(v.variantId, tnValNew, resolvedProductId);
                                if (conflict) {
                                  const other = variants.find((x) => x.variantId === conflict);
                                  showToast(
                                    'error',
                                    `Esa variante TN ya está en otra fila${other ? ` (${formatOptionLabel(other)})` : ''}.`
                                  );
                                  return;
                                }
                                setAssignments((prev) => ({
                                  ...prev,
                                  [v.variantId]: {
                                    ...prev[v.variantId],
                                    tn: tnValNew,
                                    tnProductId: resolvedProductId,
                                  },
                                }));
                              }}
                              className={`w-full bg-slate-800 border rounded-lg px-2 py-1.5 text-slate-300 text-xs outline-none ${
                                hasDuplicateTn
                                  ? 'border-rose-500/70 focus:border-rose-400'
                                  : 'border-slate-600 focus:border-cyan-500/60'
                              }`}
                            >
                              <option value="">Elegir variante TN…</option>
                              {getVisibleTnOptions(v.variantId, tnVal, tnProductId).map((t) => (
                                <option key={tnOptionKey(t)} value={tnOptionKey(t)}>
                                  {t.productId} · {formatOptionLabel(t)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            !tnVal && (
                              <p className="text-[10px] text-slate-500 pl-0.5">Cargá TN arriba o pegá un ID</p>
                            )
                          )}
                          {tnLabel && tnVal && (
                            <p className="text-[10px] text-cyan-200/70 truncate pl-0.5" title={tnLabel}>
                              ↳ {tnLabel}
                            </p>
                          )}
                          {hasDuplicateTn && (
                            <p className="text-[10px] text-rose-400 pl-0.5">
                              Misma variante TN que otra fila — si U y XG son el mismo artículo, unificá las filas.
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="p-3 align-top">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedExtraVariantId((prev) => (prev === v.variantId ? null : v.variantId))
                          }
                          className={`w-full flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                            isExtraOpen
                              ? 'border-indigo-500 bg-indigo-600/25 text-indigo-200'
                              : pubCount > 0
                                ? 'border-indigo-700/50 bg-indigo-950/30 text-indigo-300 hover:bg-indigo-950/50'
                                : 'border-slate-600 bg-slate-800/50 text-slate-400 hover:text-indigo-300 hover:border-indigo-700/50'
                          }`}
                          title="Gestionar publicaciones adicionales para sincronizar stock"
                        >
                          <Layers size={16} />
                          <span>{pubCount > 0 ? `${pubCount}` : '+'}</span>
                          <span className="text-[9px] font-normal opacity-80">{isExtraOpen ? 'Cerrar' : 'Más'}</span>
                        </button>
                      </td>
                    </tr>
                    {isExtraOpen && (
                      <tr className="border-b border-slate-700/40">
                        <td colSpan={6} className="p-0">
                          <VariantExtraPublicationsPanel
                            variantId={v.variantId}
                            variantSku={skuEdits[v.variantId] ?? v.sku ?? ''}
                            productId={productId}
                            packMl={packMl}
                            packTn={packTn}
                            showToast={showToast}
                            onCountChange={(count) => refreshPublicationCount(v.variantId, count)}
                          />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="flex flex-col sm:flex-row sm:items-center gap-3 pt-4 mt-2 border-t border-slate-700/60">
        <div className="flex-1 text-xs text-slate-400">
          {linkStats.ml + linkStats.tn > 0 ? (
            <>
              <span className="text-slate-300 font-medium">{linkStats.ml + linkStats.tn}</span> vínculos listos
              {linkStats.both < linkStats.total && (
                <span className="text-amber-400/90 ml-1">
                  · faltan {linkStats.total - linkStats.both} variantes sin ML+TN completos
                </span>
              )}
              {assignmentConflictCount > 0 && (
                <span className="text-rose-400/90 ml-1">
                  · {assignmentConflictCount} fila{assignmentConflictCount === 1 ? '' : 's'} con asignación duplicada
                </span>
              )}
            </>
          ) : (
            'Cargá las publicaciones y emparejá al menos una variante para guardar.'
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end sm:items-center">
          <div className="flex gap-2 sm:ml-auto">
          <button
            type="button"
            onClick={goBack}
            className="px-5 py-2.5 rounded-xl font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-sm transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || unlinking || !productId || variants.length === 0 || assignmentConflictCount > 0}
            className="px-6 py-2.5 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 text-sm shadow-lg shadow-indigo-900/25 flex items-center justify-center gap-2 min-w-[180px] transition-colors"
            title={assignmentConflictCount > 0 ? 'Corregí las asignaciones duplicadas antes de guardar' : undefined}
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Guardando…
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                Guardar vinculaciones
              </>
            )}
          </button>
          </div>
        </div>
      </footer>

      {unifyModalOpen && (() => {
        const absorb = variants.find((v) => v.variantId === unifyAbsorbId);
        const keeper = variants.find((v) => v.variantId === unifyKeeperId);
        const differentSize = absorb && keeper ? norm(absorb.size) !== norm(keeper.size) : false;
        const uXgDuplicate = absorb && keeper ? sizesAreBizDuplicatePair(absorb.size, keeper.size) : false;
        const unifyOptions = variants.filter((v) => selectedUnifyIds.includes(v.variantId));
        return (
          <div className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col shadow-2xl">
              <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-2 shrink-0">
                <div className="min-w-0">
                  <h3 className="text-white font-bold text-base flex items-center gap-2">
                    <GitMerge size={18} className="text-violet-400" />
                    Unificar variantes
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                    La variante que se absorbe se elimina; stock y vínculos ML/TN pasan a la que queda.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (unifySaving) return;
                    setUnifyModalOpen(false);
                  }}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 space-y-4 overflow-y-auto">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Absorber (se elimina)</label>
                  <select
                    value={unifyAbsorbId ?? ''}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      setUnifyAbsorbId(id);
                      if (id && id === unifyKeeperId) {
                        const other = unifyOptions.find((v) => v.variantId !== id);
                        setUnifyKeeperId(other?.variantId ?? null);
                      }
                    }}
                    disabled={unifySaving}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-violet-500/60"
                  >
                    {unifyOptions.map((v) => (
                      <option key={v.variantId} value={v.variantId}>
                        {formatOptionLabel(v)} · {v.sku}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Conservar (queda)</label>
                  <select
                    value={unifyKeeperId ?? ''}
                    onChange={(e) => setUnifyKeeperId(e.target.value || null)}
                    disabled={unifySaving}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-violet-500/60"
                  >
                    {unifyOptions
                      .filter((v) => v.variantId !== unifyAbsorbId)
                      .map((v) => (
                        <option key={v.variantId} value={v.variantId}>
                          {formatOptionLabel(v)} · {v.sku}
                        </option>
                      ))}
                  </select>
                </div>
                {uXgDuplicate ? (
                  <div className="rounded-xl border border-violet-700/50 bg-violet-950/30 px-3 py-2.5 text-xs text-violet-100 leading-relaxed">
                    <strong className="text-violet-200">Mismo artículo:</strong> U (170) y XG (180) son códigos
                    distintos para la misma prenda. La variante que conservás mantiene su talle; la otra se elimina y su
                    stock se suma.
                  </div>
                ) : (
                  differentSize && (
                    <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 px-3 py-2.5 text-xs text-amber-200 leading-relaxed">
                      Talles distintos ({formatSizeForLink(absorb?.size)} vs {formatSizeForLink(keeper?.size)}).
                      La variante que conservás mantiene su talle; la otra desaparece con su stock sumado.
                    </div>
                  )
                )}
              </div>
              <div className="p-4 border-t border-slate-700 flex flex-col sm:flex-row gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setUnifyModalOpen(false)}
                  disabled={unifySaving}
                  className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void confirmVariantUnify()}
                  disabled={unifySaving || !unifyKeeperId || !unifyAbsorbId || unifyKeeperId === unifyAbsorbId}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {unifySaving ? <Loader2 size={16} className="animate-spin" /> : <GitMerge size={16} />}
                  Unificar ahora
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default BulkLinkGroupPage;
