import React, { useState, useEffect, useRef, useMemo, useCallback, startTransition } from 'react';
import { createPortal } from 'react-dom';
import { Search, Filter, Plus, Cloud, Zap, Package, RefreshCw, AlertTriangle, Minus, CheckCircle2, XCircle, Edit2, Check, ChevronDown, Box, X, Layers, Tag, DollarSign, Palette, Ruler, PlusCircle, Download, Link, Ship, Info, Upload, Lock, Trash2, Loader2, MoreVertical, Eye, EyeOff, Copy, History, GitMerge, Unlink } from 'lucide-react';
import { Product, Role, Attribute } from '../types';
import { api } from '../services/api';
import { labelTalle, codigoTalleParaSku, nombreTalleDesdeCodigo } from '../utils/tallesTango';
import {
  getStoredInventoryState,
  setStoredInventoryState,
  runWithConcurrency,
  parseStockExcel,
  getProductColorCode,
  getProductSizeCode,
  getSizeCanonicalSet,
  matchesSizeFilter,
  SIZE_ORDER_MODAL,
  SIZE_ORDER,
  isVariantInventoryHidden,
} from '../utils/inventoryUtils';
import { useNotification } from '../context/NotificationContext';
import * as XLSX from 'xlsx';
import MercadoLibreStock from './MercadoLibreStock';
import TiendaNubeStock from './TiendaNubeStock';
import PublicationStockBundles from './PublicationStockBundles';
import {
  normalizeMercadoLibreItemId,
  extractMercadoLibreVariationIdFromUrl,
  isVariantLinkedToMercadoLibre,
  isVariantLinkedToTiendaNube,
  getChannelStockDisplay
} from '../utils/mercadoLibreItemId';
import { normalizeTiendaNubeProductId, extractTiendaNubeVariantFromUrl } from '../utils/tiendaNubeUrl';

/** Referencia estable: cuando no hay filtro ML≠TN, el agrupado no debe recalcularse por cada actualización de stocks externos. */
const STABLE_EMPTY_EXTERNAL_STOCKS: Record<string, { stockML?: number; stockTN?: number; stockLupoShop?: number }> =
  {};

function InventoryViewSwitch(
  props: { view: 'mine' | 'ml' | 'tn'; ml: React.ReactNode; tn: React.ReactNode; mine: React.ReactNode }
) {
  if (props.view === 'ml') return props.ml;
  if (props.view === 'tn') return props.tn;
  return props.mine;
}

interface InventoryProps {
  products: Product[];
  attributes?: Attribute[];
  role: Role;
  onCreateProducts?: (products: Product[]) => void;
  onUpdateStock?: (productId: string, newStock: number) => void | Promise<void>;
  onImportComplete?: () => void;
  onNavigate?: (view: string) => void;
}

interface ArticleStockMovement {
  id: string;
  variant_id: string;
  previous_stock: number;
  new_stock: number;
  quantity_change: number;
  movement_type: string;
  reference: string | null;
  created_at: string;
  sku: string;
  product_name: string;
  order_id?: string | null;
  customer_name?: string | null;
  adjust_user_name?: string | null;
}

/** Formato de talle para dropdowns de vinculación: muestra código numérico y nombre (ej. "160 - GG") para que coincida con la columna local. */
function formatSizeForLink(size: string | undefined | null): string {
  if (size == null || String(size).trim() === '') return '';
  const s = String(size).trim();
  if (/^\d{2,3}$/.test(s)) return labelTalle(s) || s;
  const code = codigoTalleParaSku(s);
  return code && code !== s ? `${code} - ${s}` : s;
}

/** Inventario: solo variantes del producto pedido (sin fusionar familias de SKU). */
const INVENTORY_PRODUCT_FETCH_OPTS = { includeRelated: false } as const;

type InventoryVariantRow = Awaited<ReturnType<typeof api.getVariantsBySku>>[number];

function mapInventoryVariantsFromApi(
  groupKey: string,
  variants: InventoryVariantRow[],
  meta: { name: string; category: string; price: number; description?: string }
): Product[] {
  return variants.map((v) => ({
    id: v.variantId,
    sku: v.variantSku || `${groupKey}-${v.sizeCode}-${v.colorCode}`,
    name: meta.name,
    category: meta.category,
    price: meta.price,
    description: meta.description ?? '',
    size: v.sizeCode,
    color: v.colorName,
    colorCode: v.colorCode,
    stock: v.stock,
    inventoryHidden: v.inventoryHidden === true,
    integrations: {
      local: true,
      tiendaNube: isVariantLinkedToTiendaNube(v.externalIds),
      mercadoLibre: isVariantLinkedToMercadoLibre(v.externalIds),
    },
    externalIds: v.externalIds,
  }));
}

function normColorTokenForUnify(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function variantColorTokensForUnify(p: Product): string[] {
  const s = new Set<string>();
  const c = normColorTokenForUnify(String(p.color || ''));
  const code = normColorTokenForUnify(String(getProductColorCode(p) || ''));
  if (c) s.add(c);
  if (code) s.add(code);
  return [...s];
}

/** Mismo color visible (nombre o código cruzados), alineado con la validación del backend. */
function variantsColorFamilyMatch(a: Product, b: Product): boolean {
  const ta = variantColorTokensForUnify(a);
  const tb = variantColorTokensForUnify(b);
  for (const x of ta) {
    for (const y of tb) {
      if (x && y && x === y) return true;
    }
  }
  return false;
}

const Inventory: React.FC<InventoryProps> = ({ products, attributes = [], role, onCreateProducts, onUpdateStock, onImportComplete, onNavigate }) => {
  const { showToast, showConfirm } = useNotification();
  const stored = getStoredInventoryState();
  const [searchTerm, setSearchTerm] = useState(stored.search);
  const [hideZeroStock, setHideZeroStock] = useState(stored.hideZeroStock ?? false);
  const [showHiddenVariants, setShowHiddenVariants] = useState(stored.showHiddenVariants ?? false);
  const [syncLoading, setSyncLoading] = useState<'tn' | 'ml' | 'both' | 'fromML' | null>(null);
  const [syncResult, setSyncResult] = useState<{ platform: string; updated: number; errors: number; logs: string[]; fromML?: { imported: number; errorsFromML: number; sentToTN: number; errorsToTN: number } } | null>(null);
  const [showSyncResultModal, setShowSyncResultModal] = useState(false);
  const [topDotsOpen, setTopDotsOpen] = useState(false);
  const topDotsRef = useRef<HTMLDivElement>(null);
  const [topDotsPosition, setTopDotsPosition] = useState<{ top: number; left: number } | null>(null);
  const [cardDotsOpenKey, setCardDotsOpenKey] = useState<string | null>(null);
  const cardDotsRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** Para hacer scroll al expandir un artículo y que se vea el “Cargando variantes…”. */
  const groupCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** Stock al abrir el editor numérico (para no reenviar si no hubo cambio y para revertir si falla el API). */
  const baselineManualStockRef = useRef<Record<string, number>>({});
  /** Último stock confirmado por el API (para no pisar un 0 con un PUT viejo a 1). */
  const lastAckStockRef = useRef<Record<string, number>>({});
  /** Generación por variante: ignora respuestas viejas si hubo otro ajuste más reciente. */
  const stockSaveGenRef = useRef<Record<string, number>>({});
  /** Cola latest-wins: mientras hay un PUT en vuelo, solo se recuerda el último valor. */
  const stockSaveInFlightRef = useRef<Record<string, boolean>>({});
  const stockSaveQueuedRef = useRef<Record<string, number | null>>({});
  /** Evita que onBlur dispare un commit espurio justo después de +/- o Confirmar. */
  const skipStockBlurRef = useRef(false);
  /** Texto del input mientras se edita (no pisar stock con 0 al borrar el campo). */
  const [stockEditDraft, setStockEditDraft] = useState('');
  /** Paso de ajuste rápido (−/+): 1, 5 o 10. */
  const [stockAdjustStep, setStockAdjustStep] = useState<1 | 5 | 10>(1);
  const stockHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stockHoldIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stockHoldValueRef = useRef<number | null>(null);
  const stockHoldProductRef = useRef<string | null>(null);
  const [cardDotsPosition, setCardDotsPosition] = useState<{ top: number; left: number } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [editingStockId, setEditingStockId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const [selectionModeEnabled, setSelectionModeEnabled] = useState(false);
  const [syncSelectedLoading, setSyncSelectedLoading] = useState<'tn' | 'ml' | 'both' | null>(null);
  const [syncingGroupKey, setSyncingGroupKey] = useState<string | null>(null);
  
  // Creation Modal State
  const [isCreating, setIsCreating] = useState(false);
  const [isVariantMode, setIsVariantMode] = useState(false); // New mode for adding variants
  const [newBaseSku, setNewBaseSku] = useState('');
  const [newProductName, setNewProductName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedColorIds, setSelectedColorIds] = useState<string[]>([]);
  const [initialStock, setInitialStock] = useState('0');


  /** Fusión manual: varios productos padre → uno (stock y variantes). */
  const [showMergeManualModal, setShowMergeManualModal] = useState(false);
  const [mergePickSearch, setMergePickSearch] = useState('');
  const [mergePickLoading, setMergePickLoading] = useState(false);
  const [mergePickResults, setMergePickResults] = useState<Array<{ productId: string; baseSku: string; name: string }>>([]);
  const [mergeSelected, setMergeSelected] = useState<Array<{ productId: string; baseSku: string; name: string }>>([]);
  const [mergeKeeperProductId, setMergeKeeperProductId] = useState<string | null>(null);
  const [mergeSaving, setMergeSaving] = useState(false);
  const [mergeSuggestions, setMergeSuggestions] = useState<Array<{ productId: string; baseSku: string; name: string }>>([]);
  const [mergeSuggestionsLoading, setMergeSuggestionsLoading] = useState(false);
  const mergeSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Unificar dos variantes del mismo talle: elegís cuál se absorbe y cuál queda (colores compatibles). */
  const [variantUnifyModal, setVariantUnifyModal] = useState<{
    groupKey: string;
    sameSizeVariants: Product[];
    articleName: string;
    articleCategory: string;
    articlePrice: number;
  } | null>(null);
  const [variantUnifyAbsorbId, setVariantUnifyAbsorbId] = useState<string | null>(null);
  const [variantUnifyKeeperId, setVariantUnifyKeeperId] = useState<string | null>(null);
  const [variantUnifySaving, setVariantUnifySaving] = useState(false);

  // Editar producto (artículo)
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingProductGroupKey, setEditingProductGroupKey] = useState<string | null>(null);
  const [editProductForm, setEditProductForm] = useState<{ sku: string; name: string; category: string; base_price: string; description: string; mercadoLibrePackSize: string; tiendaNubePackSize: string; mayoristaPackSize: string }>({ sku: '', name: '', category: 'General', base_price: '', description: '', mercadoLibrePackSize: '1', tiendaNubePackSize: '1', mayoristaPackSize: '1' });
  const [loadingEditProduct, setLoadingEditProduct] = useState(false);
  const [savingEditProduct, setSavingEditProduct] = useState(false);

  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editVariantForm, setEditVariantForm] = useState<{ sku: string; externalSku: string }>({ sku: '', externalSku: '' });
  const [editVariantLinkIds, setEditVariantLinkIds] = useState<{ mlItemId: string | null; mlVariantId: string | null; tnProductId: string | null; tnVariantId: string | null }>({ mlItemId: null, mlVariantId: null, tnProductId: null, tnVariantId: null });
  const [loadingEditVariant, setLoadingEditVariant] = useState(false);
  const [savingEditVariant, setSavingEditVariant] = useState(false);
  const [fetchingExternalSku, setFetchingExternalSku] = useState<'ml' | 'tn' | null>(null);

  // Despacho Modal State
  const [showDespachoModal, setShowDespachoModal] = useState(false);
  const [selectedProductForDespacho, setSelectedProductForDespacho] = useState<any>(null);
  const [despachosList, setDespachosList] = useState<any[]>([]);
  const [selectedDespachoId, setSelectedDespachoId] = useState('');
  const [despachoCantidad, setDespachoCantidad] = useState('');
  const [despachoCosto, setDespachoCosto] = useState('');
  /** Si es true, al agregar al despacho se suma la cantidad al stock del depósito (ingreso físico). */
  const [despachoIncrementStock, setDespachoIncrementStock] = useState(true);
  const [savingDespacho, setSavingDespacho] = useState(false);
  const [showStockHistoryModal, setShowStockHistoryModal] = useState(false);
  const [stockHistoryLoading, setStockHistoryLoading] = useState(false);
  const [stockHistoryRows, setStockHistoryRows] = useState<ArticleStockMovement[]>([]);
  const [stockHistoryArticle, setStockHistoryArticle] = useState<{ productId: string; title: string } | null>(null);

  // Import Tango State
  const [importingTango, setImportingTango] = useState(false);
  const [importingStockExcel, setImportingStockExcel] = useState(false);
  const [stockExcelResult, setStockExcelResult] = useState<{ updated: number; notFoundCount: number; notFound?: string[]; errors?: string[] } | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingSyncIssues, setExportingSyncIssues] = useState(false);
  const [inventorySubView, setInventorySubView] = useState<'mine' | 'ml' | 'tn'>(stored.subView);
  const [showPublicationBundles, setShowPublicationBundles] = useState(false);
  const [mlSearchTerm, setMlSearchTerm] = useState('');
  const [tnSearchTerm, setTnSearchTerm] = useState('');
  const [tangoImportResult, setTangoImportResult] = useState<{
    productsCreated: number;
    variantsCreated: number;
    variantsUpdated: number;
    totalProcessed: number;
    stockUpdatesSkipped?: number;
    keepStockOnExistingVariants?: boolean;
    errors: string[];
  } | null>(null);
  const [tangoKeepStockOnExisting, setTangoKeepStockOnExisting] = useState(true);
  const [serverListRefreshKey, setServerListRefreshKey] = useState(0);
  const tangoFileInputRef = useRef<HTMLInputElement>(null);
  const stockExcelFileInputRef = useRef<HTMLInputElement>(null);

  // Filter States (inicializar desde sesión para que no se pierdan al re-renderizar)
  const [filterCategory, setFilterCategory] = useState(stored.filterCategory ?? 'ALL');
  const [filterSize, setFilterSize] = useState(stored.filterSize ?? 'ALL');
  const [filterStockLevel, setFilterStockLevel] = useState<'ALL' | 'LOW' | 'OUT'>('ALL');
  const [filterSync, setFilterSync] = useState<'ALL' | 'ML' | 'TN' | 'BOTH' | 'NONE' | 'MISMATCH'>('ALL');
  /** Búsqueda aplicada al GET /products (debounce) para no disparar una tormenta de requests al escribir. */
  const [serverListSearch, setServerListSearch] = useState(() => (stored.search ?? '').trim());
  const [filterColor, setFilterColor] = useState(stored.filterColor ?? 'ALL');
  const [colorQuery, setColorQuery] = useState('');
  const [colorOpen, setColorOpen] = useState(false);
  const [sortKey, setSortKey] = useState<'SKU' | 'STOCK' | 'VARIANTS' | 'CREATED' | 'UPDATED'>('SKU');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const productTsMs = (p: Product, field: 'product_created_at' | 'product_updated_at') => {
    const raw = (p as any)[field];
    if (!raw) return 0;
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  const groupTsMs = (variants: Product[], field: 'product_created_at' | 'product_updated_at') =>
    Math.max(0, ...variants.map((v) => productTsMs(v, field)));
  const [currentPage, setCurrentPage] = useState(stored.page);
  const [pageSize, setPageSize] = useState(10);
  const [serverMode, setServerMode] = useState(true);
  const [serverItems, setServerItems] = useState<Product[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [variantExternalStocks, setVariantExternalStocks] = useState<Record<string, { stockML?: number; stockTN?: number; stockLupoShop?: number }>>({});
  const extStocksForMismatchFilter =
    filterSync === 'MISMATCH' ? variantExternalStocks : STABLE_EMPTY_EXTERNAL_STOCKS;

  const isAdminOrWarehouse = role === Role.ADMIN || role === Role.WAREHOUSE;
  const canManagePublicationBundles = isAdminOrWarehouse;

  // Persistir búsqueda, página, pestaña y filtros para que al actualizar o volver no se pierdan
  useEffect(() => {
    setStoredInventoryState(searchTerm, currentPage, inventorySubView, hideZeroStock, {
      filterSize,
      filterCategory,
      filterColor,
      showHiddenVariants,
    });
  }, [searchTerm, currentPage, inventorySubView, hideZeroStock, showHiddenVariants, filterSize, filterCategory, filterColor]);

  const availableSizes = useMemo(
    () => attributes.filter(a => a.type === 'size'),
    [attributes]
  );

  // Use only colors from the database (attributes loaded from API /colors)
  const availableColors = useMemo(() => {
    return attributes
      .filter(a => a.type === 'color')
      .sort((a, b) => {
        const valA = ((a as any).code || a.name || '').toString();
        const valB = ((b as any).code || b.name || '').toString();
        const na = parseInt(valA);
        const nb = parseInt(valB);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return valA.localeCompare(valB);
      });
  }, [attributes]);

  // Talles sin duplicados para el modal "Generar Inventario" (P y 130 - P son el mismo talle)
  const SIZE_ORDER_MODAL = ['P', 'M', 'G', 'GG', 'U', 'XG', 'XXG', 'XXXG', 'S', 'L', 'XL', 'XXL', 'XXXL', 'XS'];
  const uniqueSizesForModal = React.useMemo(() => {
    const byCanonical = new Map<string, Attribute>();
    for (const a of availableSizes) {
      const raw = ((a as any).code ?? a.name ?? '').toString().trim().toUpperCase();
      const code = codigoTalleParaSku(raw) || raw;
      const canonical = (nombreTalleDesdeCodigo(code) || code).toUpperCase();
      const existing = byCanonical.get(canonical);
      const isNumeric = /^\d{2,3}$/.test(code);
      if (!existing || (isNumeric && !/^\d{2,3}$/.test((existing as any).code ?? ''))) {
        byCanonical.set(canonical, { ...a, name: a.name, ...(code ? { code } : {}) } as Attribute);
      }
    }
    const list = Array.from(byCanonical.values());
    list.sort((a, b) => {
      const ca = (nombreTalleDesdeCodigo((a as any).code ?? a.name) || ((a as any).code ?? a.name ?? '')).toString().toUpperCase();
      const cb = (nombreTalleDesdeCodigo((b as any).code ?? b.name) || ((b as any).code ?? b.name ?? '')).toString().toUpperCase();
      const ia = SIZE_ORDER_MODAL.indexOf(ca);
      const ib = SIZE_ORDER_MODAL.indexOf(cb);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return ca.localeCompare(cb);
    });
    return list;
  }, [availableSizes]);

  useEffect(() => {
    const q = (searchTerm ?? '').trim();
    const t = window.setTimeout(() => setServerListSearch(q), 380);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const checkColorMatch = useCallback((p: Product, colorKey: string) => {
    if (colorKey === 'ALL') return true;

    const filterColorLower = colorKey.toString().trim().toLowerCase();

    const selectedAttr = availableColors.find(c => ((c as any).code || c.name) === colorKey);
    const targetCode = (selectedAttr ? ((selectedAttr as any).code || '') : colorKey).toString().trim().toLowerCase();
    const targetName = (selectedAttr ? (selectedAttr.name || '') : colorKey).toString().trim().toLowerCase();

    const explicitColor = ((p as any).color || '').toString().trim().toLowerCase();
    const explicitColorCode = ((p as any).colorCode || '').toString().trim().toLowerCase();

    const sku = (p.sku || '').toString();
    const skuParts = sku.split('-');
    const skuColorPart = skuParts.length >= 1 ? skuParts[skuParts.length - 1].toLowerCase() : '';

    if (explicitColorCode) {
      if (explicitColorCode === targetCode || explicitColorCode === filterColorLower) {
        return true;
      }
    }

    if (explicitColor) {
      if (explicitColor === targetName || explicitColor === targetCode || explicitColor === filterColorLower) {
        return true;
      }
      if (targetName && explicitColor.includes(targetName)) {
        return true;
      }
      if (targetName && targetName.includes(explicitColor)) {
        return true;
      }
    }

    if (skuColorPart) {
      if (skuColorPart === targetCode || skuColorPart === targetName || skuColorPart === filterColorLower) {
        return true;
      }
      if (targetCode && skuParts.some(part => part.toLowerCase() === targetCode)) {
        return true;
      }
    }

    const numExplicit = parseInt(explicitColor);
    const numExplicitCode = parseInt(explicitColorCode);
    const numSkuColor = parseInt(skuColorPart);
    const numTarget = parseInt(targetCode);
    const numFilter = parseInt(filterColorLower);

    if (!isNaN(numTarget)) {
      if ((!isNaN(numExplicitCode) && numExplicitCode === numTarget) ||
          (!isNaN(numExplicit) && numExplicit === numTarget) ||
          (!isNaN(numSkuColor) && numSkuColor === numTarget)) {
        return true;
      }
    }
    if (!isNaN(numFilter)) {
      if ((!isNaN(numExplicitCode) && numExplicitCode === numFilter) ||
          (!isNaN(numExplicit) && numExplicit === numFilter) ||
          (!isNaN(numSkuColor) && numSkuColor === numFilter)) {
        return true;
      }
    }

    return false;
  }, [availableColors]);

  // Cargar despachos para el modal
  const loadDespachos = async () => {
    try {
      const res = await api.getDespachos({ limit: 100 });
      setDespachosList(res.despachos || []);
    } catch (e) {
      console.error('Error loading despachos:', e);
    }
  };

  const handleOpenDespachoModal = (product: any) => {
    setSelectedProductForDespacho(product);
    setSelectedDespachoId('');
    setDespachoCantidad(product.stock?.toString() || '0');
    setDespachoCosto('');
    setDespachoIncrementStock(true);
    loadDespachos();
    setShowDespachoModal(true);
  };

  const handleAssignDespacho = async () => {
    if (!selectedDespachoId || !selectedProductForDespacho) {
      showToast('info', 'Seleccioná un despacho');
      return;
    }

    setSavingDespacho(true);
    try {
      const res = await api.addDespachoItem(selectedDespachoId, {
        product_id: selectedProductForDespacho.productId || selectedProductForDespacho.id,
        variant_id: selectedProductForDespacho.variantId || null,
        cantidad: parseInt(despachoCantidad) || 0,
        costo_unitario: despachoCosto ? parseFloat(despachoCosto) : null,
        descripcion_item: `${selectedProductForDespacho.name} - ${selectedProductForDespacho.sku}`,
        incrementStock: despachoIncrementStock
      });
      
      setShowDespachoModal(false);
      showToast(
        'success',
        res?.stockIncremented === false
          ? 'Asignado al despacho sin modificar stock del depósito.'
          : 'Producto asignado al despacho y sumado al stock.'
      );
    } catch (error: any) {
      showToast('error', error.message || 'No se pudo asignar');
    } finally {
      setSavingDespacho(false);
    }
  };

  const openArticleStockHistory = async (opts: { productId?: string; variantIds: string[]; title: string }) => {
    setStockHistoryArticle({ productId: opts.productId || '', title: opts.title });
    setShowStockHistoryModal(true);
    setStockHistoryLoading(true);
    setStockHistoryRows([]);
    try {
      const rows = await api.getStockMovements({
        ...(opts.productId ? { productId: opts.productId } : {}),
        variantIds: opts.variantIds,
        limit: 200
      });
      setStockHistoryRows(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      setStockHistoryRows([]);
      showToast('error', e?.message || 'No se pudo cargar el historial de stock del artículo');
    } finally {
      setStockHistoryLoading(false);
    }
  };

  const formatMovementDateTime = (value: string) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value || '—';
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const movementTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      PEDIDO_MAYORISTA: 'Pedido mayorista',
      VENTA_TIENDA_NUBE: 'Venta Tienda Nube',
      VENTA_MERCADO_LIBRE: 'Venta Mercado Libre',
      CANCEL_VENTA_TIENDA_NUBE: 'Cancelación TN',
      AJUSTE_MANUAL: 'Ajuste manual',
      DEVOLUCION: 'Devolución',
      IMPORTACION_TN: 'Importación TN',
      IMPORTACION_ML: 'Importación ML',
      IMPORTACION_EXCEL: 'Importación Excel',
      SNAPSHOT_INICIAL: 'Snapshot inicial',
    };
    return labels[type] || type || 'Movimiento';
  };

  const movementReferenceLabel = (m: ArticleStockMovement) => {
    const baseRef = (m.reference || '').trim();
    if (m.movement_type === 'PEDIDO_MAYORISTA') {
      const parts: string[] = [];
      if (m.order_id || baseRef) parts.push(m.order_id ? `Pedido: ${m.order_id}` : baseRef);
      if (m.customer_name) parts.push(`Cliente: ${m.customer_name}`);
      return parts.join(' | ') || 'Pedido mayorista';
    }
    if (m.movement_type === 'AJUSTE_MANUAL') {
      if (m.adjust_user_name) return `Ajuste por usuario: ${m.adjust_user_name}`;
      return baseRef || 'Ajuste manual';
    }
    return baseRef || '—';
  };

  // Server: páginas moderadas, lotes paralelos acotados, ceder el hilo entre lotes y transición para no congelar la UI.
  const FETCH_PAGE_SIZE = 2000;
  const MAX_PRODUCTS = 50000;
  const FETCH_PAGE_CONCURRENCY = 3;
  const loadIdRef = useRef(0);
  const yieldToMain = () =>
    new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  useEffect(() => {
    if (!serverMode) return;
    const loadId = ++loadIdRef.current;
    (async () => {
      try {
        const sortMap: Record<string, 'sku' | 'name' | 'stock' | 'created_at' | 'updated_at'> = {
          SKU: 'sku',
          STOCK: 'stock',
          VARIANTS: 'sku',
          CREATED: 'created_at',
          UPDATED: 'updated_at',
        };
        const q = serverListSearch || undefined;
        const first = await api.getProductsPaged(1, FETCH_PAGE_SIZE, q, sortMap[sortKey] || 'sku', sortDir, filterSync);
        if (loadId !== loadIdRef.current) return;
        setServerTotal(first.total);
        setServerItems(first.items);
        if (first.total <= FETCH_PAGE_SIZE) return;
        const totalToLoad = Math.min(first.total, MAX_PRODUCTS);
        const totalPages = Math.ceil(totalToLoad / FETCH_PAGE_SIZE);
        for (let start = 2; start <= totalPages; start += FETCH_PAGE_CONCURRENCY) {
          const end = Math.min(start + FETCH_PAGE_CONCURRENCY - 1, totalPages);
          const pageNums: number[] = [];
          for (let p = start; p <= end; p++) pageNums.push(p);
          const restPages = await Promise.all(
            pageNums.map((page) =>
              api.getProductsPaged(page, FETCH_PAGE_SIZE, q, sortMap[sortKey] || 'sku', sortDir, filterSync, { skipTotal: true })
            )
          );
          if (loadId !== loadIdRef.current) return;
          const chunk = restPages.flatMap((r) => r.items);
          startTransition(() => {
            setServerItems((prev) => [...prev, ...chunk]);
          });
          await yieldToMain();
        }
      } catch {
        if (loadId === loadIdRef.current) setServerMode(false);
      }
    })();
  }, [serverMode, serverListSearch, sortKey, sortDir, filterSync, serverListRefreshKey]);

  const filteredProducts = useMemo(() => {
    const source = serverMode ? serverItems : products;
    return source.filter((p) => {
      const sku = (p.sku || '').toString().toLowerCase();
      const name = (p.name || '').toString().toLowerCase();
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm || sku.includes(searchLower) || name.includes(searchLower);
      const matchesCategory = filterCategory === 'ALL' || p.category === filterCategory;
      const sizeCode = getProductSizeCode(p);
      const matchesSize = matchesSizeFilter(sizeCode, filterSize);

      const isParent = sku.split('-').length <= 1;
      const matchesColor = filterColor === 'ALL' ? true : checkColorMatch(p, filterColor) || isParent;

      let matchesStock = true;
      const stockValue = (p as any).stock_total ?? (p as any).stock ?? 0;
      if (filterStockLevel === 'LOW') matchesStock = stockValue > 0 && stockValue < 20;
      if (filterStockLevel === 'OUT') matchesStock = stockValue <= 0;

      return matchesSearch && matchesCategory && matchesSize && matchesColor && matchesStock;
    });
  }, [
    serverMode,
    serverItems,
    products,
    searchTerm,
    filterCategory,
    filterSize,
    filterStockLevel,
    filterColor,
    checkColorMatch,
  ]);

    // 2. Group filtered products by BASE SKU (prefix before size/color suffix)
  // When color filter is active, we still need to respect search and other filters
  const baseSource = React.useMemo(() => {
    if (filterColor === 'ALL') return filteredProducts;
    // When filtering by color, apply all filters except color (color will be filtered at variant level)
    const source = serverMode ? serverItems : products;
    return source.filter(p => {
      const sku = (p.sku || '').toString().toLowerCase();
      const name = (p.name || '').toString().toLowerCase();
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm || sku.includes(searchLower) || name.includes(searchLower);
      const matchesCategory = filterCategory === 'ALL' || p.category === filterCategory;
      const sizeCode = getProductSizeCode(p);
      const matchesSize = matchesSizeFilter(sizeCode, filterSize);
      let matchesStock = true;
      const stockValue = (p as any).stock_total ?? (p as any).stock ?? 0;
      if (filterStockLevel === 'LOW') matchesStock = stockValue > 0 && stockValue < 20;
      if (filterStockLevel === 'OUT') matchesStock = stockValue <= 0;
      return matchesSearch && matchesCategory && matchesSize && matchesStock;
    });
  }, [filterColor, filteredProducts, serverMode, serverItems, products, searchTerm, filterCategory, filterSize, filterStockLevel]);
  const groupedProducts = React.useMemo(() => baseSource.reduce((acc, product) => {
    const sku = (product.sku || 'SIN-CODIGO').toString();
    const parts = sku.split('-');
    let baseSku = (product as any).base_sku;
    if (baseSku == null || baseSku === '') {
      baseSku = sku;
      if (parts.length >= 3) {
        baseSku = parts.slice(0, -2).join('-');
      } else if (parts.length === 2) {
        baseSku = parts.join('-');
      }
    }
    
    const key = String(baseSku);
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(product);
    return acc;
  }, {} as Record<string, Product[]>), [baseSource]);

  const categories = React.useMemo(() => Array.from(new Set(products.map(p => p.category))), [products]);
  const sizes = React.useMemo(() => Array.from(new Set(products.map(p => (p as any).size).filter(Boolean))), [products]);

  // Opciones de talle sin duplicados: 130 y P son el mismo talle, mostramos uno solo (preferimos código numérico para que coincida con SKU)
  const SIZE_ORDER = ['P', 'M', 'G', 'GG', 'U', 'XG', 'XXG', 'XXXG', 'S', 'L', 'XL', 'XXL', 'XXXL', 'XS'];
  const sizeOptions = React.useMemo(() => {
    const attrSizes = attributes.filter(a => a.type === 'size');
    const opts = attrSizes.map(a => {
      const code = (((a as any).code || a.name || '') as string).toString().toUpperCase();
      const label = (a as any).code ? `${((a as any).code || '').toString().toUpperCase()} - ${(a.name || '').toString()}` : (a.name || '').toString();
      return { code, label };
    }).filter(s => s.code);
    if (opts.length === 0) {
      const derived = Array.from(new Set(products.map(p => getProductSizeCode(p)).filter(Boolean)));
      return derived.map(code => ({ code, label: code }));
    }
    const byCanonical = new Map<string, { code: string; label: string }>();
    for (const o of opts) {
      const canonical = (nombreTalleDesdeCodigo(o.code) || o.code).toUpperCase();
      const existing = byCanonical.get(canonical);
      const oIsNumeric = /^\d{2,3}$/.test(o.code);
      if (!existing || (oIsNumeric && !/^\d{2,3}$/.test(existing.code))) {
        byCanonical.set(canonical, o);
      }
    }
    const list = Array.from(byCanonical.values());
    list.sort((a, b) => {
      const ca = (nombreTalleDesdeCodigo(a.code) || a.code).toUpperCase();
      const cb = (nombreTalleDesdeCodigo(b.code) || b.code).toUpperCase();
      const ia = SIZE_ORDER.indexOf(ca);
      const ib = SIZE_ORDER.indexOf(cb);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return ca.localeCompare(cb);
    });
    return list;
  }, [attributes, products]);

  const selectedColorItem = filterColor !== 'ALL' ? availableColors.find(c => (c as any).name === filterColor || (c as any).code === filterColor) : null;
  const selectedColorLabel = selectedColorItem ? `${(selectedColorItem as any).name || ''}` : colorQuery;

  // Ref para no re-ejecutar prefetch por color en cada cambio de products
  const baseSkusRef = useRef<string[]>([]);
  useEffect(() => {
    const source = serverMode ? serverItems : products;
    baseSkusRef.current = Array.from(new Set<string>(source.map((product: Product) => {
      const base = (product as any).base_sku;
      if (base != null && base !== '') return String(base);
      const sku = (product.sku || 'SIN-CODIGO').toString();
      const parts = sku.split('-');
      if (parts.length >= 3) return parts.slice(0, -2).join('-');
      if (parts.length === 2) return parts.join('-');
      return sku;
    })));
  }, [serverMode, serverItems, products]);

  // Si el filtro de talle guardado (ej. "P") ya no está en las opciones pero hay una opción equivalente (ej. "130 - P"), usar ese value
  useEffect(() => {
    if (filterSize === 'ALL' || sizeOptions.some(o => o.code === filterSize)) return;
    const canonicalFilter = (nombreTalleDesdeCodigo(filterSize) || filterSize).toUpperCase();
    const match = sizeOptions.find(o => (nombreTalleDesdeCodigo(o.code) || o.code).toUpperCase() === canonicalFilter);
    if (match) setFilterSize(match.code);
  }, [sizeOptions, filterSize]);

  // Cuando el filtro es "ML ≠ TN": cargar stocks externos de todas las variantes visibles para poder filtrar y mostrar ML/TN
  const MISMATCH_BATCH_SIZE = 100;
  const MISMATCH_MAX_VARIANTS = 500;
  useEffect(() => {
    if (filterSync !== 'MISMATCH') return;
    const ids = Array.from(new Set(baseSource.map((p: Product) => p.id).filter(Boolean))) as string[];
    const idsLimited = ids.slice(0, MISMATCH_MAX_VARIANTS);
    if (idsLimited.length === 0) return;
    let cancelled = false;
    const batches: string[][] = [];
    for (let i = 0; i < idsLimited.length; i += MISMATCH_BATCH_SIZE) {
      batches.push(idsLimited.slice(i, i + MISMATCH_BATCH_SIZE));
    }
    Promise.all(batches.map(batch => api.getVariantExternalStocks(batch)))
      .then(results => {
        if (cancelled) return;
        const merged: Record<string, { stockML?: number; stockTN?: number; stockLupoShop?: number }> = {};
        results.forEach(r => { if (r?.stocks) Object.assign(merged, r.stocks); });
        setVariantExternalStocks(prev => ({ ...prev, ...merged }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [filterSync, baseSource]);

  // Solo al elegir un color: cargar variantes de pocos grupos para filtrar (máx 8, 2 en paralelo)
  useEffect(() => {
    if (filterColor === 'ALL') {
      setLoadingVariantsByGroup({});
      return;
    }
    const baseSkus = baseSkusRef.current;
    const missing: string[] = baseSkus.filter(k => !loadedVariants[k]).slice(0, 8);
    if (missing.length === 0) return;
    let cancelled = false;
    setLoadingVariantsByGroup(prev => ({ ...prev, ...Object.fromEntries(missing.map(k => [k, true])) }));
    runWithConcurrency(missing, 2, async (groupName) => {
      if (cancelled) return;
      try {
        const variants = await api.getVariantsBySku(groupName, INVENTORY_PRODUCT_FETCH_OPTS);
        if (cancelled) return;
        const mapped = mapInventoryVariantsFromApi(groupName, variants, {
          name: groupedProducts[groupName]?.[0]?.name || '',
          category: groupedProducts[groupName]?.[0]?.category || 'General',
          price: groupedProducts[groupName]?.[0]?.price || 0,
        });
        setLoadedVariants(prev => ({ ...prev, [groupName]: mapped }));
        const ids = mapped.map((p) => p.id);
        api.getVariantExternalStocks(ids).then(res => {
          if (!cancelled && res?.stocks) setVariantExternalStocks(prev => ({ ...prev, ...res.stocks }));
        }).catch(() => {});
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoadingVariantsByGroup(prev => ({ ...prev, [groupName]: false }));
      }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoadingVariantsByGroup(prev => ({ ...prev, ...Object.fromEntries(missing.map(k => [k, false])) }));
    });
    return () => { cancelled = true; };
  }, [filterColor]);

  const exportProductsToExcel = async () => {
    setExportingExcel(true);
    try {
      const rows = await api.exportInventory();
      const excelRows = rows.map((r: any) => ({
        'Código artículo': r.product_sku,
        'Nombre producto': r.product_name,
        'Categoría': r.category || '',
        'SKU variante': r.variant_sku || '',
        'Talle': r.talle_display ? `${r.size_code} - ${r.talle_display}` : r.size_code,
        'Color': r.color_code && r.color_name && r.color_code !== r.color_name ? `${r.color_code} - ${r.color_name}` : (r.color_name || r.color_code || ''),
        'Stock': Number(r.stock ?? 0),
        'Precio': Number(r.base_price ?? 0),
      }));
      const worksheet = XLSX.utils.json_to_sheet(excelRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventario');
      const filename = `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(workbook, filename);
    } catch (e) {
      console.error(e);
      showToast('error', 'Error al exportar. Revisá que el backend esté conectado.');
    } finally {
      setExportingExcel(false);
    }
  };

  const SYNC_MODE_LABELS: Record<string, string> = {
    publicacion_padre: 'Publicación padre ML',
    publicacion_propia: 'Publicación propia ML',
    vinculo_incompleto: 'Vínculo incompleto',
  };

  const ISSUE_TYPE_LABELS: Record<string, string> = {
    SIN_VINCULOS: 'Sin vínculos',
    SIN_ML: 'Sin Mercado Libre',
    SIN_TN: 'Sin Tienda Nube',
    ML_NO_ENCONTRADO: 'ML no encontrado',
    ML_VARIACION_NO_ENCONTRADA: 'Variación ML no encontrada',
    ML_MULTI_VARIACIONES: 'ML con múltiples variaciones',
    TN_NO_ENCONTRADO: 'TN no encontrado (404)',
    TN_NO_VERIFICADO: 'TN no verificado',
  };

  const exportSyncIssuesToExcel = async () => {
    setExportingSyncIssues(true);
    try {
      showToast('info', 'Analizando sincronización ML→TN… puede tardar unos minutos.');
      const rows = await api.getMlTnSyncIssues();
      if (!rows.length) {
        showToast('success', 'No hay artículos con problemas de sincronización ML→TN.');
        return;
      }
      const excelRows = rows.map((r) => ({
        'Código artículo': r.product_sku,
        'Nombre producto': r.product_name,
        'SKU variante': r.variant_sku,
        'Talle': r.size_code || '',
        'Color': r.color_name || '',
        'Stock LupoHub': Number(r.stock_lupohub ?? 0),
        'Modo sync': SYNC_MODE_LABELS[r.sync_mode] || r.sync_mode,
        'ML publicación': r.ml_id || '',
        'ML variación': r.ml_variant_id || '',
        'ML ítem propio': r.ml_item_id || '',
        'TN producto': r.tn_product_id || '',
        'TN variante': r.tn_variant_id || '',
        'Tipo error': ISSUE_TYPE_LABELS[r.issue_type] || r.issue_type,
        'Detalle': r.issue_message,
      }));
      const worksheet = XLSX.utils.json_to_sheet(excelRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sync ML-TN');
      const filename = `sync_ml_tn_errores_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(workbook, filename);
      showToast('success', `Exportados ${rows.length} artículo(s) con problemas de sincronización.`);
    } catch (e: any) {
      console.error(e);
      showToast('error', e?.message || 'Error al exportar problemas de sincronización.');
    } finally {
      setExportingSyncIssues(false);
    }
  };

  const handleImportTangoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingTango(true);
    setTangoImportResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        if (!data) throw new Error('No se pudo leer el archivo');
        const wb = XLSX.read(data, { type: 'binary' });
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(firstSheet);
        if (rows.length === 0) {
          setTangoImportResult(null);
          showToast('info', 'Sin filas válidas. Usá columna "Código" (Tango completo) o columnas Código/Articulo/SKU + Talle + Color (números). Opcional: Descripción.');
          setImportingTango(false);
          return;
        }
        api.importTangoArticles(rows, true, { keepStockOnExistingVariants: tangoKeepStockOnExisting }).then((res) => {
          setTangoImportResult(res);
          setServerListRefreshKey((k) => k + 1);
          onImportComplete?.();
        }).catch((err) => {
          showToast('error', err?.message || 'Error al importar. Revisá columnas Código (completo o artículo) + Talle + Color.');
        }).finally(() => {
          setImportingTango(false);
          if (tangoFileInputRef.current) tangoFileInputRef.current.value = '';
        });
      } catch (err: any) {
        setImportingTango(false);
        showToast('error', err?.message || 'Error leyendo el Excel.');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleImportStockExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingStockExcel(true);
    setStockExcelResult(null);
    try {
      const rows = await parseStockExcel(file);
      if (rows.length === 0) {
        showToast('warning', 'El Excel no tiene filas válidas. Primera fila: CODIGO/Código, COLOR y columnas de talles (P, M, G, GG, U, XG, XXG, XXXG o 10, 12, 130 - P, etc.).');
        return;
      }
      const res = await api.importStockFromExcel(rows);
      setStockExcelResult({
        updated: res.updated ?? 0,
        notFoundCount: res.notFoundCount ?? (res.notFound?.length ?? 0),
        notFound: res.notFound,
        errors: res.errors
      });
      setServerListRefreshKey(k => k + 1);
      onImportComplete?.();
      if ((res.notFoundCount ?? 0) > 0) {
        showToast('success', `Stock actualizado: ${res.updated} variantes. No encontradas: ${res.notFoundCount}.`);
      } else {
        showToast('success', `Stock importado: ${res.updated} variantes actualizadas.`);
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Error importando stock desde Excel.');
    } finally {
      setImportingStockExcel(false);
      e.target.value = '';
    }
  };

  /** Opcional: importar stock desde ML a LupoHub y enviar a TN (ML como fuente en ese flujo). */
  const handleSyncFromMercadoLibre = async () => {
    setTopDotsOpen(false);
    setSyncLoading('fromML');
    setSyncResult(null);
    setShowSyncResultModal(true);
    try {
      const res = await api.syncAllStockFromMercadoLibre();
      setSyncResult({
        platform: 'Stock desde Mercado Libre',
        updated: res.importedFromML + res.sentToTN,
        errors: res.errorsFromML + res.errorsToTN,
        logs: res.logs || [],
        fromML: { imported: res.importedFromML, errorsFromML: res.errorsFromML, sentToTN: res.sentToTN, errorsToTN: res.errorsToTN }
      });
      if (res.logs?.length) {
        console.group('[LupoHub] Stock desde ML - Logs');
        res.logs.forEach((line: string) => console.log(line));
        console.groupEnd();
      } else {
        console.group('[LupoHub] Stock desde ML - Logs');
        console.log(`Sync finalizado. LupoHub: ${res.importedFromML} actualizados, ${res.errorsFromML} errores. TN: ${res.sentToTN} enviados, ${res.errorsToTN} errores.`);
        console.groupEnd();
      }
      if (onImportComplete) onImportComplete();
      const totalOk = res.importedFromML + res.sentToTN;
      const totalErr = res.errorsFromML + res.errorsToTN;
      if (totalErr === 0 && totalOk > 0) showToast('success', `Stock actualizado desde Mercado Libre: ${res.importedFromML} variantes a LupoHub, ${res.sentToTN} enviadas a Tienda Nube.`);
      else if (totalErr > 0) showToast('warning', `Actualizado con algunos errores. Revisá el detalle.`);
      setServerListRefreshKey(k => k + 1);
    } catch (e: any) {
      setSyncResult({
        platform: 'Stock desde Mercado Libre',
        updated: 0,
        errors: 1,
        logs: [e?.message || 'Error de conexión'],
        fromML: undefined
      });
      showToast('error', e?.message || 'Error al traer stock desde Mercado Libre');
    } finally {
      setSyncLoading(null);
    }
  };

  const handleSyncStock = async () => {
    setTopDotsOpen(false);
    setSyncLoading('both');
    setSyncResult(null);
    setShowSyncResultModal(true);
    try {
      const [tnRes, mlRes] = await Promise.all([
        api.syncStockToTiendaNube({ downloadFailures: false }),
        api.syncStockToMercadoLibre({ downloadFailures: false })
      ]);
      const totalUpdated = tnRes.updated + mlRes.updated;
      const totalErrors = tnRes.errors + mlRes.errors;
      const logs = [
        ...(tnRes.logs || []).map(l => `[TN] ${l}`),
        ...(mlRes.logs || []).map(l => `[ML] ${l}`)
      ];
      setSyncResult({
        platform: 'Tienda Nube y Mercado Libre',
        updated: totalUpdated,
        errors: totalErrors,
        logs
      });
      if (totalErrors > 0) {
        try {
          await api.downloadStockSyncFailuresReport('both');
          showToast('info', 'Se descargó el Excel con los artículos que no se actualizaron.');
        } catch {
          /* ignore */
        }
      }
      if (onImportComplete && (totalUpdated > 0 || totalErrors > 0)) onImportComplete();
      if (totalErrors === 0 && totalUpdated > 0) showToast('success', `Sincronizado: ${totalUpdated} variantes a TN y ML.`);
      else if (totalErrors > 0) showToast('warning', `Sincronizado con errores: ${totalUpdated} OK, ${totalErrors} fallos. Revisá el Excel.`);
      setServerListRefreshKey(k => k + 1);
    } catch (e: any) {
      setSyncResult({
        platform: 'Error',
        updated: 0,
        errors: 1,
        logs: [e?.message || 'Error de conexión']
      });
      showToast('error', e?.message || 'Error al sincronizar stock');
    } finally {
      setSyncLoading(null);
    }
  };

  const handleSyncToTiendaNube = async () => {
    setTopDotsOpen(false);
    setSyncLoading('tn');
    setSyncResult(null);
    setShowSyncResultModal(true);
    try {
      const res = await api.syncStockToTiendaNube();
      setSyncResult({ platform: 'Tienda Nube', ...res });
      if (onImportComplete && (res.updated > 0 || res.errors > 0)) onImportComplete();
      if (res.errors === 0 && res.updated > 0) showToast('success', `${res.updated} variantes enviadas a Tienda Nube.`);
      else if (res.errors > 0) showToast('warning', `${res.updated} OK, ${res.errors} errores. Revisá el detalle.`);
      setServerListRefreshKey(k => k + 1);
    } catch (e: any) {
      setSyncResult({ platform: 'Tienda Nube', updated: 0, errors: 1, logs: [e?.message || 'Error de conexión'] });
      showToast('error', e?.message || 'Error al sincronizar con Tienda Nube');
    } finally {
      setSyncLoading(null);
    }
  };

  const handleSyncToMercadoLibre = async () => {
    setTopDotsOpen(false);
    setSyncLoading('ml');
    setSyncResult(null);
    setShowSyncResultModal(true);
    try {
      const res = await api.syncStockToMercadoLibre();
      setSyncResult({ platform: 'Mercado Libre', ...res });
      if (onImportComplete && (res.updated > 0 || res.errors > 0)) onImportComplete();
      if (res.errors === 0 && res.updated > 0) showToast('success', `${res.updated} variantes enviadas a Mercado Libre.`);
      else if (res.errors > 0) showToast('warning', `${res.updated} OK, ${res.errors} errores. Revisá el detalle.`);
      setServerListRefreshKey(k => k + 1);
    } catch (e: any) {
      setSyncResult({ platform: 'Mercado Libre', updated: 0, errors: 1, logs: [e?.message || 'Error de conexión'] });
      showToast('error', e?.message || 'Error al sincronizar con Mercado Libre');
    } finally {
      setSyncLoading(null);
    }
  };

  const handleSyncSelectedToTiendaNube = async () => {
    if (selectedVariantIds.length === 0) return;
    setSyncSelectedLoading('tn');
    try {
      const res = await api.syncSelectedStockToTiendaNube(selectedVariantIds);
      if (res.errors === 0 && res.updated > 0) showToast('success', `${res.updated} variante(s) enviadas a Tienda Nube.`);
      else if (res.errors > 0) showToast('warning', `${res.updated} OK, ${res.errors} errores. Revisá el detalle.`);
      else showToast('info', 'Ninguna variante con vínculo TN en la selección.');
      setServerListRefreshKey(k => k + 1);
      // Refrescar stocks externos para ver inmediatamente si quedó sincronizado.
      setTimeout(() => {
        api.getVariantExternalStocks(selectedVariantIds).then((ext) => {
          if (ext?.stocks) setVariantExternalStocks((prev) => ({ ...prev, ...ext.stocks }));
        }).catch(() => {});
      }, 1200);
    } catch (e: any) {
      showToast('error', e?.message || 'Error al enviar a Tienda Nube');
    } finally {
      setSyncSelectedLoading(null);
    }
  };

  const handleSyncSelectedToMercadoLibre = async () => {
    if (selectedVariantIds.length === 0) return;
    setSyncSelectedLoading('ml');
    try {
      const res = await api.syncSelectedStockToMercadoLibre(selectedVariantIds);
      if (res.errors === 0 && res.updated > 0) showToast('success', `${res.updated} variante(s) enviadas a Mercado Libre.`);
      else if (res.errors > 0) showToast('warning', `${res.updated} OK, ${res.errors} errores. Revisá el detalle.`);
      else showToast('info', 'Ninguna variante con vínculo ML en la selección.');
      setServerListRefreshKey(k => k + 1);
      // Refrescar stocks externos para ver inmediatamente si quedó sincronizado.
      setTimeout(() => {
        api.getVariantExternalStocks(selectedVariantIds).then((ext) => {
          if (ext?.stocks) setVariantExternalStocks((prev) => ({ ...prev, ...ext.stocks }));
        }).catch(() => {});
      }, 1200);
    } catch (e: any) {
      showToast('error', e?.message || 'Error al enviar a Mercado Libre');
    } finally {
      setSyncSelectedLoading(null);
    }
  };

  /** Envía stock de la selección a ML y TN (incluye 0 = sin stock). */
  const handleSyncSelectedToBoth = async () => {
    if (selectedVariantIds.length === 0) return;
    const ids = [...selectedVariantIds];
    setSyncSelectedLoading('both');
    try {
      const [ml, tn] = await Promise.all([
        api.syncSelectedStockToMercadoLibre(ids),
        api.syncSelectedStockToTiendaNube(ids),
      ]);
      const errors = (ml.errors || 0) + (tn.errors || 0);
      if (errors === 0 && ((ml.updated || 0) + (tn.updated || 0)) > 0) {
        showToast('success', `ML ${ml.updated} y TN ${tn.updated} actualizadas (incluye stock 0).`);
      } else if (errors > 0) {
        showToast('warning', `ML ${ml.updated} OK/${ml.errors} err · TN ${tn.updated} OK/${tn.errors} err`);
      } else {
        showToast('info', 'Ninguna variante con vínculo ML/TN en la selección.');
      }
      setServerListRefreshKey(k => k + 1);
      setTimeout(() => {
        api.getVariantExternalStocks(ids).then((ext) => {
          if (ext?.stocks) setVariantExternalStocks((prev) => ({ ...prev, ...ext.stocks }));
        }).catch(() => {});
      }, 1200);
    } catch (e: any) {
      showToast('error', e?.message || 'Error al enviar a ML y TN');
    } finally {
      setSyncSelectedLoading(null);
    }
  };

  /** Masivo por artículo: todas las variantes del grupo (incluido stock 0) → ML + TN. */
  const handleSyncGroupStockToBoth = async (groupKey: string, variantIds: string[]) => {
    const ids = Array.from(new Set((variantIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (ids.length === 0) {
      showToast('info', 'Este artículo no tiene variantes para sincronizar.');
      return;
    }
    setSyncingGroupKey(groupKey);
    try {
      const [ml, tn] = await Promise.all([
        api.syncSelectedStockToMercadoLibre(ids),
        api.syncSelectedStockToTiendaNube(ids),
      ]);
      const errors = (ml.errors || 0) + (tn.errors || 0);
      if (errors === 0 && ((ml.updated || 0) + (tn.updated || 0)) > 0) {
        showToast('success', `${groupKey}: ML ${ml.updated} · TN ${tn.updated} (incluye stock 0).`);
      } else if (errors > 0) {
        showToast('warning', `${groupKey}: ML ${ml.updated}/${ml.errors} · TN ${tn.updated}/${tn.errors}`);
      } else {
        showToast('info', `${groupKey}: ninguna variante con vínculo ML/TN.`);
      }
      setServerListRefreshKey(k => k + 1);
      setTimeout(() => {
        api.getVariantExternalStocks(ids).then((ext) => {
          if (ext?.stocks) setVariantExternalStocks((prev) => ({ ...prev, ...ext.stocks }));
        }).catch(() => {});
      }, 1200);
    } catch (e: any) {
      showToast('error', e?.message || `Error al sincronizar ${groupKey}`);
    } finally {
      setSyncingGroupKey(null);
    }
  };

  useEffect(() => {
    if (!topDotsOpen) return;
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (topDotsRef.current?.contains(target)) return;
      if ((target as Element).closest?.('[data-top-dots-dropdown]')) return;
      setTopDotsOpen(false);
    };
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, [topDotsOpen]);

  useEffect(() => {
    if (!topDotsOpen || !topDotsRef.current) {
      setTopDotsPosition(null);
      return;
    }
    const update = () => {
      if (topDotsRef.current) {
        const rect = topDotsRef.current.getBoundingClientRect();
        setTopDotsPosition({ top: rect.bottom + 6, left: rect.right - 268 });
      }
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [topDotsOpen]);

  useEffect(() => {
    if (!cardDotsOpenKey) return;
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const key = cardDotsOpenKey;
      const el = key ? cardDotsRefs.current[key] : null;
      if (el?.contains(target)) return;
      if ((target as Element).closest?.('[data-card-dots-dropdown]')) return;
      setCardDotsOpenKey(null);
    };
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, [cardDotsOpenKey]);

  useEffect(() => {
    if (!cardDotsOpenKey) {
      setCardDotsPosition(null);
      return;
    }
    const update = () => {
      const el = cardDotsRefs.current[cardDotsOpenKey];
      if (el) {
        const rect = el.getBoundingClientRect();
        setCardDotsPosition({ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 200) });
      }
    };
    update();
    const t = requestAnimationFrame(update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [cardDotsOpenKey]);

  // Refrescar stocks ML/TN en la UI después de que el backend sincronice (debounce ~2.8s)
  const refreshExternalStocksAfterSync = (variantId: string) => {
    // Backend ya no debouncea 2,8s en ajuste manual; refrescar ML/TN un poco antes para alinear la UI.
    setTimeout(() => {
      api.getVariantExternalStocks([variantId]).then(res => {
        if (res?.stocks) setVariantExternalStocks(prev => ({ ...prev, ...res.stocks }));
      }).catch(() => {});
    }, 1800);
  };

  /** Actualiza stock en la lista del servidor (modo paginado) sin refetch completo → no resetea página ni dispara loadData global. */
  const patchServerItemStock = (variantId: string, newStock: number) => {
    setServerItems(prev =>
      prev.map(p => (p.id === variantId ? { ...p, stock_total: newStock, stock: newStock } : p))
    );
  };

  const patchVariantHidden = (variantId: string, hidden: boolean) => {
    setLoadedVariants((prev) => {
      const next = { ...prev };
      for (const gk of Object.keys(next)) {
        const idx = next[gk].findIndex((p) => p.id === variantId);
        if (idx >= 0) {
          next[gk] = [...next[gk]];
          (next[gk][idx] as Product & { inventoryHidden?: boolean }).inventoryHidden = hidden;
          break;
        }
      }
      return next;
    });
    setServerItems((prev) =>
      prev.map((p) => (p.id === variantId ? { ...p, inventoryHidden: hidden } : p))
    );
  };

  const toggleVariantHidden = async (variantId: string, currentlyHidden: boolean) => {
    const nextHidden = !currentlyHidden;
    try {
      await api.updateVariant(variantId, { inventoryHidden: nextHidden });
      patchVariantHidden(variantId, nextHidden);
      showToast('success', nextHidden ? 'Variante oculta del inventario' : 'Variante visible de nuevo');
    } catch (e: any) {
      showToast('error', e?.message || 'No se pudo actualizar la variante');
    }
  };

  const parseStockDraft = (value: string, fallback: number): number => {
    const v = value.trim();
    if (v === '') return fallback;
    const n = parseInt(v, 10);
    return isNaN(n) ? fallback : Math.max(0, n);
  };

  const applyLocalStock = (productId: string, newStock: number) => {
    setLoadedVariants(prev => {
      const next = { ...prev };
      for (const gk of Object.keys(next)) {
        const idx = next[gk].findIndex((p: any) => p.id === productId);
        if (idx >= 0) {
          next[gk] = [...next[gk]];
          (next[gk][idx] as any).stock = newStock;
          break;
        }
      }
      return next;
    });
    patchServerItemStock(productId, newStock);
  };

  const flushStockSave = (productId: string) => {
    if (!onUpdateStock) return;
    if (stockSaveInFlightRef.current[productId]) return;
    const queued = stockSaveQueuedRef.current[productId];
    if (queued == null) return;

    stockSaveQueuedRef.current[productId] = null;
    stockSaveInFlightRef.current[productId] = true;
    const genAtSend = stockSaveGenRef.current[productId] || 0;
    const stockToSend = queued;

    Promise.resolve(onUpdateStock(productId, stockToSend))
      .then(() => {
        if ((stockSaveGenRef.current[productId] || 0) === genAtSend) {
          lastAckStockRef.current[productId] = stockToSend;
          baselineManualStockRef.current[productId] = stockToSend;
        }
      })
      .catch(() => {
        if ((stockSaveGenRef.current[productId] || 0) !== genAtSend) return;
        const ack = lastAckStockRef.current[productId] ?? baselineManualStockRef.current[productId] ?? 0;
        baselineManualStockRef.current[productId] = ack;
        applyLocalStock(productId, ack);
        setStockEditDraft(String(ack));
      })
      .finally(() => {
        stockSaveInFlightRef.current[productId] = false;
        if (stockSaveQueuedRef.current[productId] != null) {
          flushStockSave(productId);
        } else if ((stockSaveGenRef.current[productId] || 0) === genAtSend) {
          refreshExternalStocksAfterSync(productId);
        }
      });
  };

  /** Optimistic UI + cola latest-wins: un 0 posterior no puede ser pisado por un PUT viejo a 1. */
  const persistManualStock = (productId: string, newStock: number) => {
    if (!onUpdateStock) return;
    const gen = (stockSaveGenRef.current[productId] || 0) + 1;
    stockSaveGenRef.current[productId] = gen;
    baselineManualStockRef.current[productId] = newStock;
    applyLocalStock(productId, newStock);
    setStockEditDraft(String(newStock));
    stockSaveQueuedRef.current[productId] = newStock;
    flushStockSave(productId);
  };

  const clearStockHold = () => {
    if (stockHoldTimerRef.current) {
      clearTimeout(stockHoldTimerRef.current);
      stockHoldTimerRef.current = null;
    }
    if (stockHoldIntervalRef.current) {
      clearInterval(stockHoldIntervalRef.current);
      stockHoldIntervalRef.current = null;
    }
  };

  /** −/+ con el paso elegido; mantener pulsado repite (guarda al soltar). */
  const startStockHold = (productId: string, direction: -1 | 1) => {
    if (!onUpdateStock) return;
    armSkipStockBlur();
    clearStockHold();
    const step = stockAdjustStep * direction;
    let current = parseStockDraft(stockEditDraft, 0);
    stockHoldProductRef.current = productId;
    const tick = () => {
      const next = Math.max(0, current + step);
      if (next === current) return;
      current = next;
      stockHoldValueRef.current = next;
      setStockEditDraft(String(next));
      applyLocalStock(productId, next);
    };
    tick();
    stockHoldTimerRef.current = setTimeout(() => {
      stockHoldIntervalRef.current = setInterval(tick, 70);
    }, 380);
  };

  const endStockHold = () => {
    const productId = stockHoldProductRef.current;
    const value = stockHoldValueRef.current;
    clearStockHold();
    stockHoldProductRef.current = null;
    stockHoldValueRef.current = null;
    if (productId != null && value != null && onUpdateStock) {
      persistManualStock(productId, value);
    }
  };

  /** Solo actualiza el draft mientras editás (sin API ni stock=0 al borrar). */
  const onManualStockInputChange = (_productId: string, value: string) => {
    // Permitir vacío y solo dígitos (tipear 50, 120, etc.).
    if (value === '' || /^\d+$/.test(value)) {
      setStockEditDraft(value);
    }
  };

  /** Guarda stock manual al salir del input o al confirmar (incluye 0 explícito). */
  const commitManualStock = (productId: string, value: string, opts?: { force?: boolean }) => {
    if (!onUpdateStock) return;
    // skipStockBlur evita el blur al clickear −/+/✓; el ✓ debe forzar el guardado.
    if (skipStockBlurRef.current && !opts?.force) return;
    const baseline = baselineManualStockRef.current[productId] ?? 0;
    const trimmed = value.trim();
    // Campo vacío al salir = cancelar edición (volver al baseline), no forzar 0.
    // Para dejar sin stock hay que escribir 0 o bajar con −.
    if (trimmed === '') {
      setStockEditDraft(String(baseline));
      applyLocalStock(productId, baseline);
      return;
    }
    const newStock = parseStockDraft(trimmed, baseline);
    if (newStock === baseline) {
      setStockEditDraft(String(baseline));
      return;
    }
    persistManualStock(productId, newStock);
  };

  const armSkipStockBlur = () => {
    skipStockBlurRef.current = true;
    window.setTimeout(() => {
      skipStockBlurRef.current = false;
    }, 300);
  };

  const [loadedVariants, setLoadedVariants] = useState<Record<string, Product[]>>({});
  const [loadingVariantsByGroup, setLoadingVariantsByGroup] = useState<Record<string, boolean>>({});

  const getGroupRawVariants = (groupKey: string, groupVariants: Product[]) => {
    const lv = loadedVariants[groupKey];
    return (lv && lv.length > 0) ? lv : groupVariants;
  };
  const applyInventoryVisibilityFilter = (list: Product[]) =>
    showHiddenVariants
      ? list
      : list.filter((p) => !isVariantInventoryHidden(p as Product & { inventoryHidden?: boolean }));

  const getGroupFilteredVariants = (groupKey: string, groupVariants: Product[]) => {
    const raw = getGroupRawVariants(groupKey, groupVariants);
    const byColor = filterColor === 'ALL' ? raw : raw.filter(p => checkColorMatch(p, filterColor));
    if (filterSync === 'MISMATCH') {
      return applyInventoryVisibilityFilter(byColor.filter(p => {
        const ext = extStocksForMismatchFilter[p.id];
        const ml = ext?.stockML;
        const tn = ext?.stockTN;
        // Solo excluir cuando ya tenemos ambos stocks y coinciden. Si falta ML o TN (carga,
        // error de API o vínculo incompleto) no ocultamos la fila — antes la lista quedaba vacía.
        if (ml !== undefined && tn !== undefined) return ml !== tn;
        return true;
      }));
    }
    return applyInventoryVisibilityFilter(byColor);
  };
  const getGroupDisplayStock = (groupKey: string, groupVariants: Product[]) => {
    const variants = getGroupFilteredVariants(groupKey, groupVariants);
    return variants.reduce((sum, p) => {
      const val = (p as any).stock_total ?? (p as any).stock ?? 0;
      return sum + Number(val);
    }, 0);
  };
  /** Stock total para mostrar en el encabezado: si hay variantes cargadas (expandido), sumar desde ahí; si no, usar groupVariants/totalStock. Así el total coincide con lo que se ve al expandir. */
  const getGroupDisplayStockResolved = (groupKey: string, groupVariants: Product[], totalStock: number): number => {
    const loaded = loadedVariants[groupKey];
    if (loaded?.length > 0) {
      const list = getGroupFilteredVariants(groupKey, groupVariants);
      return list.reduce((sum, p) => sum + Number((p as any).stock ?? (p as any).stock_total ?? 0), 0);
    }
    return filterColor === 'ALL' && showHiddenVariants ? totalStock : getGroupDisplayStock(groupKey, groupVariants);
  };
  const getGroupHasLowStock = (groupKey: string, groupVariants: Product[]) => {
    const variants = getGroupFilteredVariants(groupKey, groupVariants);
    return variants.some(p => {
      const val = Number((p as any).stock ?? (p as any).stock_total ?? 0);
      return val > 0 && val < 20;
    });
  };

  const selectedSet = React.useMemo(() => new Set(selectedVariantIds), [selectedVariantIds]);

  const getVariantIdsForGroup = (groupKey: string, groupVariants: Product[]): string[] => {
    const list = loadedVariants[groupKey]?.length ? loadedVariants[groupKey] : getGroupFilteredVariants(groupKey, groupVariants);
    return list.map(p => String(p.id)).filter(Boolean);
  };

  const toggleVariantSelection = (variantId: string) => {
    setSelectedVariantIds(prev => {
      const set = new Set(prev);
      if (set.has(variantId)) set.delete(variantId);
      else set.add(variantId);
      return Array.from(set);
    });
  };

  const toggleGroupSelection = (groupKey: string, groupVariants: Product[]) => {
    const ids = getVariantIdsForGroup(groupKey, groupVariants);
    if (ids.length === 0) return;
    const set = new Set(selectedVariantIds);
    const allSelected = ids.every(id => set.has(id));
    if (allSelected) ids.forEach(id => set.delete(id));
    else ids.forEach(id => set.add(id));
    setSelectedVariantIds(Array.from(set));
  };

  const isGroupFullySelected = (groupKey: string, groupVariants: Product[]) => {
    const ids = getVariantIdsForGroup(groupKey, groupVariants);
    return ids.length > 0 && ids.every(id => selectedSet.has(id));
  };

  const isGroupPartiallySelected = (groupKey: string, groupVariants: Product[]) => {
    const ids = getVariantIdsForGroup(groupKey, groupVariants);
    return ids.some(id => selectedSet.has(id));
  };

  // Grupos ya filtrados y ordenados + total de páginas (para que el paginado refleje los filtros)
  const displayGroupsInfo = React.useMemo(() => {
    let groups = Object.entries(groupedProducts).map(([groupKey, groupVariants]: [string, Product[]]) => {
      const totalStock = groupVariants.reduce((sum, p) => {
        const val = (p as any).stock_total ?? (p as any).stock ?? 0;
        return sum + Number(val);
      }, 0);
      const displayStock = getGroupDisplayStockResolved(groupKey, groupVariants, totalStock);
      const category = groupVariants[0]?.category || 'General';
      return { groupKey, groupVariants, totalStock, displayStock, category };
    });
    if (hideZeroStock) {
      groups = groups.filter(g => g.displayStock > 0);
    }
    if (filterColor !== 'ALL') {
      groups = groups.filter(g => {
        const variants = getGroupFilteredVariants(g.groupKey, g.groupVariants);
        if (!loadedVariants[g.groupKey]) return true;
        return variants.length > 0;
      });
    }
    groups.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'SKU') cmp = a.groupKey.localeCompare(b.groupKey);
      else if (sortKey === 'STOCK') {
        const sa = a.displayStock;
        const sb = b.displayStock;
        cmp = sa - sb;
      }
      else if (sortKey === 'VARIANTS') cmp = a.groupVariants.length - b.groupVariants.length;
      else if (sortKey === 'CREATED') {
        cmp = groupTsMs(a.groupVariants, 'product_created_at') - groupTsMs(b.groupVariants, 'product_created_at');
      } else if (sortKey === 'UPDATED') {
        cmp = groupTsMs(a.groupVariants, 'product_updated_at') - groupTsMs(b.groupVariants, 'product_updated_at');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
    const safePage = Math.min(currentPage, totalPages);
    return { displayGroups: groups, totalPages, safePage };
  }, [groupedProducts, filterColor, filterSync, extStocksForMismatchFilter, sortKey, sortDir, pageSize, currentPage, loadedVariants, hideZeroStock]);

  // Si tras filtrar la página actual supera el total, volver a la última página válida
  React.useEffect(() => {
    if (displayGroupsInfo.totalPages > 0 && currentPage > displayGroupsInfo.totalPages) {
      setCurrentPage(displayGroupsInfo.totalPages);
    }
  }, [displayGroupsInfo.totalPages, currentPage]);

  const toggleGroup = (groupName: string) => {
    const willExpand = !expandedGroups.includes(groupName);
    setExpandedGroups(prev => {
      const next = prev.includes(groupName) ? prev.filter(g => g !== groupName) : [...prev, groupName];
      return next;
    });
    if (willExpand) {
      requestAnimationFrame(() => {
        groupCardRefs.current[groupName]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      });
    }
    if (!loadedVariants[groupName] || (loadedVariants[groupName] && loadedVariants[groupName].length === 0)) {
      setLoadingVariantsByGroup(prev => ({ ...prev, [groupName]: true }));
      api.getVariantsBySku(groupName, INVENTORY_PRODUCT_FETCH_OPTS).then(variants => {
        const mapped = mapInventoryVariantsFromApi(groupName, variants, {
          name: groupedProducts[groupName]?.[0]?.name || '',
          category: groupedProducts[groupName]?.[0]?.category || 'General',
          price: groupedProducts[groupName]?.[0]?.price || 0,
        });
        setLoadedVariants(prev => ({ ...prev, [groupName]: mapped }));
        const ids = mapped.map((p) => p.id);
        api.getVariantExternalStocks(ids).then(res => {
          if (res?.stocks) setVariantExternalStocks(prev => ({ ...prev, ...res.stocks }));
        }).catch(() => {});
      }).catch(() => {
        // keep fallback group items
      }).finally(() => {
        setLoadingVariantsByGroup(prev => ({ ...prev, [groupName]: false }));
      });
    }
  };

  const openBulkLinkGroupPage = (groupKey: string) => {
    if (onNavigate) {
      onNavigate(`link_group?groupKey=${encodeURIComponent(groupKey)}`);
      return;
    }
    showToast('info', 'No se pudo abrir la página de vinculación grupal');
  };

  const [unlinkingGroupKey, setUnlinkingGroupKey] = useState<string | null>(null);

  const groupHasPlatformLinks = useCallback(
    (groupKey: string, groupVariants: Product[], platform: 'ml' | 'tn') => {
      const loaded = loadedVariants[groupKey];
      const list = loaded?.length ? loaded : groupVariants;
      if (platform === 'ml') {
        return list.some(
          (p) => p.integrations?.mercadoLibre || isVariantLinkedToMercadoLibre((p as Product).externalIds)
        );
      }
      return list.some(
        (p) => p.integrations?.tiendaNube || isVariantLinkedToTiendaNube((p as Product).externalIds)
      );
    },
    [loadedVariants]
  );

  const handleUnlinkGroupPlatforms = useCallback(
    (
      groupKey: string,
      productId: string,
      groupVariants: Product[],
      platform: 'mercadolibre' | 'tiendanube' | 'both'
    ) => {
      const label =
        platform === 'both'
          ? 'Mercado Libre y Tienda Nube'
          : platform === 'mercadolibre'
            ? 'Mercado Libre'
            : 'Tienda Nube';
      showConfirm({
        title: 'Desvincular publicaciones',
        message: `¿Desvincular el artículo ${groupKey} de ${label}? Se quitarán los vínculos de todas las variantes.`,
        confirmLabel: 'Desvincular',
        onConfirm: () => {
          void (async () => {
            setUnlinkingGroupKey(groupKey);
            try {
              await api.unlinkProductPlatforms(productId, {
                tiendaNube: platform === 'tiendanube' || platform === 'both',
                mercadoLibre: platform === 'mercadolibre' || platform === 'both',
                variants: true,
              });
              showToast('success', `Artículo desvinculado de ${label}.`);
              const variantIds = (loadedVariants[groupKey] || groupVariants).map((p) => p.id);
              setLoadedVariants((prev) => {
                const next = { ...prev };
                delete next[groupKey];
                return next;
              });
              setVariantExternalStocks((prev) => {
                const next = { ...prev };
                variantIds.forEach((id) => delete next[id]);
                return next;
              });
              onImportComplete?.();
              if (expandedGroups.includes(groupKey)) {
                setLoadingVariantsByGroup((prev) => ({ ...prev, [groupKey]: true }));
                try {
                  const variants = await api.getVariantsBySku(groupKey, INVENTORY_PRODUCT_FETCH_OPTS);
                  const mapped = mapInventoryVariantsFromApi(groupKey, variants, {
                    name: groupVariants[0]?.name || '',
                    category: groupVariants[0]?.category || 'General',
                    price: groupVariants[0]?.price || 0,
                  });
                  setLoadedVariants((prev) => ({ ...prev, [groupKey]: mapped }));
                  const vIds = mapped.map((p) => p.id);
                  if (vIds.length > 0) {
                    const res = await api.getVariantExternalStocks(vIds);
                    if (res?.stocks) {
                      setVariantExternalStocks((prev) => ({ ...prev, ...res.stocks }));
                    }
                  }
                } catch {
                  /* ignore */
                } finally {
                  setLoadingVariantsByGroup((prev) => ({ ...prev, [groupKey]: false }));
                }
              }
            } catch (e: unknown) {
              showToast('error', (e as Error)?.message || 'Error al desvincular');
            } finally {
              setUnlinkingGroupKey(null);
            }
          })();
        },
      });
    },
    [showConfirm, showToast, onImportComplete, expandedGroups, loadedVariants]
  );

  const openMergeManualModal = useCallback(() => {
    setShowMergeManualModal(true);
    setMergePickSearch('');
    setMergePickResults([]);
    setMergeSelected([]);
    setMergeKeeperProductId(null);
    setMergeSaving(false);
    setMergeSuggestions([]);
    setMergeSuggestionsLoading(false);
  }, []);

  const openMergeManualModalFromGroup = useCallback((groupKey: string, groupVariants: Product[]) => {
    const gv = groupVariants[0];
    const productId = String((gv as any)?.product_id || '').trim();
    const name = String(gv?.name || '').trim();
    const initial = productId
      ? [{ productId, baseSku: groupKey, name }]
      : [];
    setShowMergeManualModal(true);
    setMergePickSearch('');
    setMergePickResults([]);
    setMergeSelected(initial);
    setMergeKeeperProductId(productId || null);
    setMergeSaving(false);
    setMergeSuggestions([]);
    setMergeSuggestionsLoading(!!productId);

    if (!productId) {
      setMergeSuggestionsLoading(false);
      return;
    }

    const q = name || groupKey;
    api
      .getDuplicateProducts({ q, limit: 80 })
      .then((res) => {
        const seen = new Set<string>([productId]);
        const out: Array<{ productId: string; baseSku: string; name: string }> = [];
        const groups = [
          ...(res.duplicateByName || []),
          ...(res.duplicateBySkuCore || []),
          ...(res.duplicateBySkuDigitPrefix || []),
        ];
        for (const g of groups) {
          const hasCurrent = g.products.some((p) => p.id === productId);
          if (!hasCurrent) continue;
          for (const p of g.products) {
            if (!p.id || seen.has(p.id)) continue;
            seen.add(p.id);
            out.push({
              productId: p.id,
              baseSku: String(p.sku || '').trim(),
              name: String(p.name || '').trim(),
            });
          }
        }
        setMergeSuggestions(out);
      })
      .catch(() => setMergeSuggestions([]))
      .finally(() => setMergeSuggestionsLoading(false));
  }, []);

  useEffect(() => {
    if (!showMergeManualModal) return;
    if (mergeSearchTimerRef.current) clearTimeout(mergeSearchTimerRef.current);
    mergeSearchTimerRef.current = setTimeout(async () => {
      const q = mergePickSearch.trim();
      if (!q) {
        setMergePickResults([]);
        setMergePickLoading(false);
        return;
      }
      setMergePickLoading(true);
      try {
        const r = await api.getProductsPaged(1, 50, q, 'sku', 'asc', 'ALL', { skipTotal: true });
        const map = new Map<string, { productId: string; baseSku: string; name: string }>();
        for (const p of r.items) {
          const pid = String((p as any).product_id || '').trim();
          if (!pid) continue;
          const baseSku =
            String((p as any).base_sku || '')
              .trim()
              .replace(/\s+/g, ' ') ||
            (String(p.sku || '').includes('-')
              ? String(p.sku || '')
                  .split('-')
                  .slice(0, -2)
                  .join('-')
              : String(p.sku || ''));
          const name = String(p.name || '').trim();
          if (!map.has(pid)) map.set(pid, { productId: pid, baseSku: baseSku || String(p.sku || ''), name });
        }
        setMergePickResults([...map.values()].slice(0, 40));
      } catch {
        setMergePickResults([]);
      } finally {
        setMergePickLoading(false);
      }
    }, 320);
    return () => {
      if (mergeSearchTimerRef.current) clearTimeout(mergeSearchTimerRef.current);
    };
  }, [mergePickSearch, showMergeManualModal]);

  const addMergeCandidate = (row: { productId: string; baseSku: string; name: string }) => {
    setMergeSelected((prev) => {
      if (prev.some((x) => x.productId === row.productId)) return prev;
      const next = [...prev, row];
      setMergeKeeperProductId((curr) => {
        if (!curr || !next.some((x) => x.productId === curr)) {
          const sorted = [...next].sort((a, b) => b.name.length - a.name.length);
          return sorted[0]?.productId ?? null;
        }
        return curr;
      });
      return next;
    });
  };

  const removeMergeCandidate = (productId: string) => {
    setMergeSelected((prev) => {
      const next = prev.filter((p) => p.productId !== productId);
      setMergeKeeperProductId((curr) => {
        if (curr !== productId) return curr;
        if (next.length === 0) return null;
        return [...next].sort((a, b) => b.name.length - a.name.length)[0]!.productId;
      });
      return next;
    });
  };

  const runManualMerge = () => {
    if (!mergeKeeperProductId || mergeSelected.length < 2) {
      showToast('error', 'Agregá al menos dos artículos y elegí cuál queda como principal.');
      return;
    }
    const others = mergeSelected.filter((p) => p.productId !== mergeKeeperProductId).map((p) => p.productId);
    if (others.length === 0) {
      showToast('error', 'Tenés que marcar otro artículo además del principal para absorber.');
      return;
    }
    const keeperLabel =
      mergeSelected.find((p) => p.productId === mergeKeeperProductId)?.baseSku || 'principal';
    showConfirm({
      title: 'Unificar artículos',
      message: `Se fusionarán ${others.length} artículo(s) en el código "${keeperLabel}". El stock y las variantes pasan al artículo principal y los duplicados se eliminan. No se puede deshacer.`,
      confirmLabel: 'Unificar',
      onConfirm: async () => {
        setMergeSaving(true);
        try {
          const res = await api.mergeManualProducts({
            keeperProductId: mergeKeeperProductId,
            duplicateProductIds: others,
          });
          if (res.errors?.length && !res.productsRemoved) {
            showToast('error', (res as any).message || res.errors.join(' ') || 'Error al fusionar');
          } else {
            showToast(
              'success',
              `Fusión lista: ${res.productsRemoved} artículo(s) absorbido(s), ${res.variantsMerged} variante(s) unificada(s).`
            );
            if (res.errors?.length) showToast('info', res.errors.slice(0, 4).join(' · '));
            setShowMergeManualModal(false);
            setServerListRefreshKey((k) => k + 1);
            onImportComplete?.();
          }
        } catch (e: any) {
          const msg = e?.response?.data?.message || e?.message || 'Error al fusionar';
          const errs = e?.response?.data?.errors;
          showToast('error', Array.isArray(errs) && errs.length ? `${msg}: ${errs.join(' ')}` : msg);
        } finally {
          setMergeSaving(false);
        }
      },
    });
  };

  const openVariantUnifyModal = (
    product: Product,
    groupKey: string,
    groupVariants: Product[],
    variantsToShow: Product[]
  ) => {
    const sz = getProductSizeCode(product);
    const sameSizeVariants = variantsToShow.filter((p) => getProductSizeCode(p) === sz);
    if (sameSizeVariants.length < 2) {
      showToast('info', 'Hace falta al menos dos variantes con este talle en la lista expandida.');
      return;
    }
    const hasCompatible = sameSizeVariants.some(
      (v) => v.id !== product.id && variantsColorFamilyMatch(product, v)
    );
    if (!hasCompatible) {
      showToast(
        'info',
        'No hay otra variante con color compatible (mismo nombre o código) para unificar con esta.'
      );
      return;
    }
    const gv0 = groupVariants[0];
    setVariantUnifyModal({
      groupKey,
      sameSizeVariants,
      articleName: String(gv0?.name || ''),
      articleCategory: String(gv0?.category || 'General'),
      articlePrice: Number((gv0 as any)?.price || 0),
    });
    setVariantUnifyAbsorbId(product.id);
    const firstKeeper = sameSizeVariants.find(
      (v) => v.id !== product.id && variantsColorFamilyMatch(product, v)
    );
    setVariantUnifyKeeperId(firstKeeper?.id ?? null);
  };

  const handleVariantUnifyAbsorbChange = (absorbId: string) => {
    if (!variantUnifyModal) return;
    const ap = variantUnifyModal.sameSizeVariants.find((x) => x.id === absorbId);
    setVariantUnifyAbsorbId(absorbId);
    if (!ap) {
      setVariantUnifyKeeperId(null);
      return;
    }
    const cand = variantUnifyModal.sameSizeVariants.filter(
      (v) => v.id !== absorbId && variantsColorFamilyMatch(ap, v)
    );
    setVariantUnifyKeeperId((prev) =>
      prev && cand.some((c) => c.id === prev) ? prev : cand[0]?.id ?? null
    );
  };

  const confirmVariantUnify = () => {
    if (!variantUnifyModal || !variantUnifyKeeperId || !variantUnifyAbsorbId) return;
    if (variantUnifyKeeperId === variantUnifyAbsorbId) {
      showToast('error', 'La variante que absorbés y la que queda tienen que ser distintas.');
      return;
    }
    const absorbProd = variantUnifyModal.sameSizeVariants.find((v) => v.id === variantUnifyAbsorbId);
    const keeperProd = variantUnifyModal.sameSizeVariants.find((v) => v.id === variantUnifyKeeperId);
    if (!absorbProd || !keeperProd || !variantsColorFamilyMatch(absorbProd, keeperProd)) {
      showToast('error', 'Elegí combinaciones con el mismo color (nombre o código).');
      return;
    }
    const { groupKey, articleName, articleCategory, articlePrice } = variantUnifyModal;
    showConfirm({
      title: 'Unificar variantes',
      message: `Se absorberá ${absorbProd.sku || variantUnifyAbsorbId} en ${keeperProd.sku || variantUnifyKeeperId} (stock y vínculos ML/TN en la que queda). ¿Continuar?`,
      confirmLabel: 'Unificar',
      onConfirm: async () => {
        setVariantUnifySaving(true);
        try {
          await api.mergeManualVariantsPair({
            keeperVariantId: variantUnifyKeeperId,
            absorbVariantId: variantUnifyAbsorbId,
          });
          showToast('success', 'Variantes unificadas.');
          setVariantUnifyModal(null);
          setVariantUnifyAbsorbId(null);
          setVariantUnifyKeeperId(null);
          setServerListRefreshKey((k) => k + 1);
          try {
            const variants = await api.getVariantsBySku(groupKey, INVENTORY_PRODUCT_FETCH_OPTS);
            const mapped = mapInventoryVariantsFromApi(groupKey, variants, {
              name: articleName,
              category: articleCategory,
              price: articlePrice,
            });
            setLoadedVariants((prev) => ({ ...prev, [groupKey]: mapped }));
            const ids = mapped.map((p) => p.id);
            if (ids.length) {
              const res = await api.getVariantExternalStocks(ids);
              if (res?.stocks) setVariantExternalStocks((prev) => ({ ...prev, ...res.stocks }));
            }
          } catch {
            setLoadedVariants((prev) => {
              const n = { ...prev };
              delete n[groupKey];
              return n;
            });
          }
          onImportComplete?.();
        } catch (e: any) {
          showToast('error', e?.response?.data?.message || e?.message || 'Error al unificar variantes');
        } finally {
          setVariantUnifySaving(false);
        }
      },
    });
  };

  const handleDeleteVariant = (variantId: string, skuLabel: string, groupKey?: string) => {
    showConfirm({
      title: 'Eliminar variante',
      message: `¿Eliminar la variante ${skuLabel}? Se borrará también su stock. No se puede deshacer.`,
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        try {
          await api.deleteVariant(variantId);
          showToast('success', 'Variante eliminada');
          setServerListRefreshKey(k => k + 1);
          if (groupKey) {
            setLoadedVariants(prev => {
              const next = { ...prev };
              if (Array.isArray(next[groupKey])) {
                next[groupKey] = next[groupKey].filter((v: any) => v.id !== variantId);
                if (next[groupKey].length === 0) next[groupKey] = undefined;
              }
              return next;
            });
          }
          onImportComplete?.();
        } catch (e: any) {
          showToast('error', e?.message || 'Error al eliminar la variante');
        }
      },
    });
  };

  const handleDeleteProduct = (productId: string, groupKey: string, groupName: string) => {
    showConfirm({
      title: 'Eliminar artículo completo',
      message: `¿Eliminar el artículo "${groupName}" (${groupKey}) y todas sus variantes? No se puede deshacer.`,
      confirmLabel: 'Eliminar todo',
      onConfirm: async () => {
        try {
          await api.deleteProduct(productId);
          showToast('success', 'Artículo y variantes eliminados');
          setServerListRefreshKey(k => k + 1);
          setLoadedVariants(prev => ({ ...prev, [groupKey]: undefined }));
          setServerItems(prev => prev.filter(p => p.id !== productId));
          setServerTotal(t => Math.max(0, t - 1));
          onImportComplete?.();
        } catch (e: any) {
          showToast('error', e?.message || 'Error al eliminar el artículo');
        }
      },
    });
  };

  // --- Creation Logic ---

  const openCreationModal = (variantData?: {name: string, skuBase: string, category: string, price: number}) => {
    if (variantData) {
      // Pre-fill for variant mode
      setIsVariantMode(true);
      setNewProductName(variantData.name);
      setNewBaseSku(variantData.skuBase);
      setNewCategory(variantData.category);
      setNewPrice(variantData.price.toString());
    } else {
      // Reset for new batch mode
      setIsVariantMode(false);
      setNewProductName('');
      setNewBaseSku('');
      setNewCategory('');
      setNewPrice('');
      setNewDescription('');
    }
    setSelectedSizes([]);
    setSelectedColorIds([]);
    setInitialStock('0');
    setIsCreating(true);
  };

  const handleAddVariant = (groupName: string) => {
    const existingGroup = groupedProducts[groupName];
    if (!existingGroup || existingGroup.length === 0) return;
    
    const baseProduct = existingGroup[0];
    const skuParts = (baseProduct.sku || '').split('-');
    const skuBase = (baseProduct as any).base_sku != null && (baseProduct as any).base_sku !== ''
      ? String((baseProduct as any).base_sku)
      : (skuParts.length >= 3 ? skuParts.slice(0, -2).join('-') : baseProduct.sku);

    openCreationModal({
      name: baseProduct.name,
      skuBase: skuBase,
      category: baseProduct.category,
      price: baseProduct.price
    });
  };

  useEffect(() => {
    if (!editingProductId) return;
    setLoadingEditProduct(true);
    api.getProductById(editingProductId).then((p) => {
      if (p) {
        setEditProductForm({
          sku: p.sku || '',
          name: p.name || '',
          category: p.category || 'General',
          base_price: String(p.base_price ?? ''),
          description: p.description || '',
          mercadoLibrePackSize: String(p.mercado_libre_pack_size ?? 1),
          tiendaNubePackSize: String(p.tienda_nube_pack_size ?? 1),
          mayoristaPackSize: String((p as { mayorista_pack_size?: number }).mayorista_pack_size ?? 1)
        });
      }
    }).finally(() => setLoadingEditProduct(false));
  }, [editingProductId]);

  useEffect(() => {
    if (!editingVariantId) return;
    const variantId = editingVariantId;
    setEditVariantForm({ sku: '', externalSku: '' });
    setLoadingEditVariant(true);
    setEditVariantLinkIds({ mlItemId: null, mlVariantId: null, tnProductId: null, tnVariantId: null });
    let cancelled = false;
    api.getVariantById(variantId).then((v: any) => {
      if (cancelled) return;
      if (v) {
        setEditVariantForm({
          sku: v.sku ?? '',
          externalSku: v.external_sku ?? ''
        });
        setEditVariantLinkIds({
          mlItemId: v.mercado_libre_item_id ?? null,
          mlVariantId: v.mercado_libre_variant_id != null ? String(v.mercado_libre_variant_id) : null,
          tnProductId: v.tienda_nube_id != null ? String(v.tienda_nube_id) : null,
          tnVariantId: v.tienda_nube_variant_id != null ? String(v.tienda_nube_variant_id) : null
        });
      }
    }).finally(() => {
      if (!cancelled) setLoadingEditVariant(false);
    });
    return () => { cancelled = true; };
  }, [editingVariantId]);

  const handleSaveEditProduct = async () => {
    if (!editingProductId) return;
    const sku = editProductForm.sku.trim();
    const name = editProductForm.name.trim();
    const base_price = parseFloat(editProductForm.base_price);
    const mlPack = parseInt(editProductForm.mercadoLibrePackSize, 10);
    const tnPack = parseInt(editProductForm.tiendaNubePackSize, 10);
    const mayPack = parseInt(editProductForm.mayoristaPackSize, 10);
    if (!sku) {
      showToast('error', 'El SKU es obligatorio');
      return;
    }
    if (!name) {
      showToast('error', 'El nombre es obligatorio');
      return;
    }
    if (isNaN(base_price) || base_price < 0) {
      showToast('error', 'Precio debe ser un número mayor o igual a 0');
      return;
    }
    setSavingEditProduct(true);
    try {
      await api.updateProduct({
        id: editingProductId,
        sku,
        name,
        category: editProductForm.category || 'General',
        price: base_price,
        description: editProductForm.description || undefined,
        mercadoLibrePackSize: isNaN(mlPack) || mlPack < 1 ? undefined : mlPack,
        tiendaNubePackSize: isNaN(tnPack) || tnPack < 1 ? undefined : tnPack,
        mayoristaPackSize: isNaN(mayPack) || mayPack < 1 ? undefined : mayPack
      } as Product & { mercadoLibrePackSize?: number; tiendaNubePackSize?: number; mayoristaPackSize?: number });
      showToast('success', 'Producto actualizado');
      const groupKeyToRefetch = editingProductGroupKey;
      setEditingProductId(null);
      setEditingProductGroupKey(null);
      setServerListRefreshKey(k => k + 1);
      onImportComplete?.();
      if (groupKeyToRefetch) {
        api.getVariantsBySku(groupKeyToRefetch, INVENTORY_PRODUCT_FETCH_OPTS).then(variants => {
          const mapped = mapInventoryVariantsFromApi(groupKeyToRefetch, variants, {
            name,
            category: editProductForm.category || 'General',
            price: base_price,
            description: editProductForm.description || '',
          });
          setLoadedVariants(prev => ({ ...prev, [groupKeyToRefetch]: mapped }));
          api.getVariantExternalStocks(mapped.map(p => p.id)).then(res => {
            if (res?.stocks) setVariantExternalStocks(prev => ({ ...prev, ...res.stocks }));
          }).catch(() => {});
        }).catch(() => {});
      }
    } catch (e: any) {
      showToast('error', e?.message || 'Error al guardar');
    } finally {
      setSavingEditProduct(false);
    }
  };

  const handleFetchExternalSkuFromMl = async () => {
    const { mlItemId, mlVariantId } = editVariantLinkIds;
    if (!mlItemId) return;
    setFetchingExternalSku('ml');
    try {
      const res = await api.getMercadoLibreItemVariations(mlItemId);
      const variations = res?.variations || [];
      const match = variations.find((v: any) => String(v.variationId) === String(mlVariantId));
      const sku = match?.sku ?? (variations[0]?.sku ?? '');
      if (sku) setEditVariantForm(f => ({ ...f, externalSku: sku }));
      else showToast('info', 'No se encontró el SKU en Mercado Libre para esta variante.');
    } catch (e: any) {
      showToast('error', e?.message || 'Error al traer SKU de Mercado Libre');
    } finally {
      setFetchingExternalSku(null);
    }
  };

  const handleFetchExternalSkuFromTn = async () => {
    const { tnProductId, tnVariantId } = editVariantLinkIds;
    if (!tnProductId) return;
    setFetchingExternalSku('tn');
    try {
      const res = await api.getTiendaNubeProductVariants(tnProductId);
      const variants = res?.variants || [];
      const match = variants.find((v: any) => String(v.variantId) === String(tnVariantId));
      const sku = match?.sku ?? (variants[0]?.sku ?? '');
      if (sku) setEditVariantForm(f => ({ ...f, externalSku: sku }));
      else showToast('info', 'No se encontró el SKU en Tienda Nube para esta variante.');
    } catch (e: any) {
      showToast('error', e?.message || 'Error al traer SKU de Tienda Nube');
    } finally {
      setFetchingExternalSku(null);
    }
  };

  const handleSaveEditVariant = async () => {
    if (!editingVariantId) return;
    const variantId = editingVariantId;
    const groupKey = Object.keys(loadedVariants).find(sku => loadedVariants[sku]?.some((v: any) => v.id === variantId));
    setSavingEditVariant(true);
    try {
      await api.updateVariant(variantId, {
        sku: editVariantForm.sku.trim() || undefined,
        externalSku: editVariantForm.externalSku.trim() || undefined
      });
      showToast('success', 'Variante actualizada');
      setEditingVariantId(null);
      setServerListRefreshKey(k => k + 1);
      onImportComplete?.();
      if (groupKey) {
        const variants = await api.getVariantsBySku(groupKey, INVENTORY_PRODUCT_FETCH_OPTS);
        const mapped = mapInventoryVariantsFromApi(groupKey, variants, {
          name: groupedProducts[groupKey]?.[0]?.name || '',
          category: groupedProducts[groupKey]?.[0]?.category || 'General',
          price: groupedProducts[groupKey]?.[0]?.price || 0,
        });
        setLoadedVariants(prev => ({ ...prev, [groupKey]: mapped }));
        api.getVariantExternalStocks(mapped.map(p => p.id)).then(res => {
          if (res?.stocks) setVariantExternalStocks(prev => ({ ...prev, ...res.stocks }));
        }).catch(() => {});
      }
    } catch (e: any) {
      showToast('error', e?.message || 'Error al guardar variante');
    } finally {
      setSavingEditVariant(false);
    }
  };

  const toggleSizeSelection = (sizeName: string) => {
    setSelectedSizes(prev => 
      prev.includes(sizeName) ? prev.filter(s => s !== sizeName) : [...prev, sizeName]
    );
  };

  const toggleColorSelection = (colorId: string) => {
    setSelectedColorIds(prev =>
      prev.includes(colorId) ? prev.filter(id => id !== colorId) : [...prev, colorId]
    );
  };

  const handleCreateBatch = () => {
    if (!newProductName?.trim() || !newBaseSku?.trim() || selectedSizes.length === 0 || selectedColorIds.length === 0) return;
    if (!onCreateProducts) return;

    const baseSku = newBaseSku.trim();
    const newProducts: Product[] = [];
    let index = 0;

    selectedSizes.forEach(sizeName => {
      selectedColorIds.forEach(colorId => {
        index++;
        const sizeAttr = availableSizes.find((s: any) => (s.name || '').toString() === sizeName || ((s as any).code || '').toString() === sizeName);
        const colorAttr = availableColors.find((c: any) => c.id === colorId);
        if (!colorAttr) return;
        const colorName = (colorAttr.name || (colorAttr as any).code || '').toString();
        const rawSizeCode = (sizeAttr && (sizeAttr as any).code != null) ? String((sizeAttr as any).code).trim() : sizeName;
        const rawColorCode = (colorAttr && (colorAttr as any).code != null) ? String((colorAttr as any).code).trim() : colorName.toUpperCase().replace(/\s+/g, '').substring(0, 3);
        const sizeCode = codigoTalleParaSku(rawSizeCode) || rawSizeCode.replace(/\s+/g, '');
        const colorCode = /^\d+$/.test(rawColorCode) ? rawColorCode : rawColorCode;
        const finalSku = `${baseSku}-${sizeCode}-${colorCode}`;

        newProducts.push({
          id: `p-${Date.now()}-${index}`,
          sku: finalSku,
          name: newProductName,
          category: newCategory || 'General',
          price: parseFloat(newPrice) || 0,
          description: newDescription,
          size: sizeName,
          color: colorName,
          stock: parseInt(initialStock) || 0,
          integrations: { local: true, mercadoLibre: false, tiendaNube: false }
        });
      });
    });

    const baseKey = newBaseSku.trim();
    setExpandedGroups(prev => (prev.includes(baseKey) ? prev : [...prev, baseKey]));
    setLoadedVariants(prev => {
      const next = { ...prev };
      delete next[baseKey];
      return next;
    });
    setIsCreating(false);
    Promise.resolve(onCreateProducts(newProducts)).then(() => {
      setServerListRefreshKey(k => k + 1);
    }).catch(() => {});
  };

  const result = (
    <div className="space-y-4 relative min-w-0 overflow-hidden">
      {/* Navegación de vistas: Mi inventario | ML | TN — sin scroll horizontal */}
      <div className="flex flex-col md:flex-row gap-2 md:gap-0 min-w-0">
        <div className="md:hidden relative w-full min-w-0">
          <select
            value={inventorySubView}
            onChange={(e) => setInventorySubView(e.target.value as 'mine' | 'ml' | 'tn')}
            className="w-full max-w-full bg-slate-800 border border-slate-600 rounded-xl py-3 pl-4 pr-10 text-white text-sm font-medium appearance-none cursor-pointer focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            aria-label="Vista de inventario"
          >
            <option value="mine">Mi inventario</option>
            <option value="ml">Vista Mercado Libre</option>
            <option value="tn">Vista Tienda Nube</option>
          </select>
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
            <ChevronDown size={18} />
          </div>
        </div>
        <div className="hidden md:flex rounded-xl bg-slate-800/60 border border-slate-700/80 p-1 gap-0.5 min-w-0 w-full max-w-full">
          <button
            type="button"
            onClick={() => setInventorySubView('mine')}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-sm font-semibold transition-all ${inventorySubView === 'mine' ? 'bg-blue-600/80 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'}`}
          >
            <Package size={18} className="shrink-0" />
            <span className="truncate">Mi inventario</span>
          </button>
          <button
            type="button"
            onClick={() => setInventorySubView('ml')}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-sm font-semibold transition-all ${inventorySubView === 'ml' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'}`}
          >
            <Zap size={18} className="shrink-0" />
            <span className="truncate">Mercado Libre</span>
          </button>
          <button
            type="button"
            onClick={() => setInventorySubView('tn')}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-sm font-semibold transition-all ${inventorySubView === 'tn' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'}`}
          >
            <Cloud size={18} className="shrink-0" />
            <span className="truncate">Tienda Nube</span>
          </button>
        </div>
      </div>

      <InventoryViewSwitch
        view={inventorySubView}
        ml={<MercadoLibreStock searchTerm={mlSearchTerm} onSearchChange={setMlSearchTerm} showToast={showToast} onProductImported={(baseSku) => { setServerListRefreshKey(k => k + 1); if (baseSku) { setInventorySubView('mine'); setSearchTerm(baseSku); } onImportComplete?.(); }} />}
        tn={<TiendaNubeStock searchTerm={tnSearchTerm} onSearchChange={setTnSearchTerm} showToast={showToast} onProductImported={(baseSku) => { setServerListRefreshKey(k => k + 1); if (baseSku) { setInventorySubView('mine'); setSearchTerm(baseSku); } onImportComplete?.(); }} />}
        mine={(
        <>
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-2 flex items-center gap-2 text-slate-400 text-xs">
        <Info size={16} className="shrink-0 text-blue-400" />
        <span>
          <strong className="text-slate-300">Importar Tango:</strong> una columna <strong className="text-slate-300">Código</strong> con artículo+talle+color concatenados, <strong className="text-slate-300">o</strong> hoja tipo planilla:{' '}
          <strong className="text-slate-300">Codigo</strong> (artículo) + <strong className="text-slate-300">Talle</strong> (P, M, G, GG, XG o número Tango) + <strong className="text-slate-300">Codigo Co</strong>/<strong className="text-slate-300">Codigo color</strong> + opcional{' '}
          <strong className="text-slate-300">Color</strong> (nombre), <strong className="text-slate-300">Modelo</strong>, <strong className="text-slate-300">Cantidad</strong>, <strong className="text-slate-300">RGB</strong>. Opcional <strong className="text-slate-300">Descripción</strong>.
        </span>
      </div>

      {canManagePublicationBundles && (
        <div className="bg-violet-950/30 border border-violet-800/50 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2 text-xs text-slate-300 min-w-0">
            <Layers size={16} className="text-violet-400 shrink-0 mt-0.5" />
            <span>
              <strong className="text-violet-200">Pack multicolor (ML / TN):</strong> configurá publicaciones que al vender 1 pack descuentan varias variantes
              (ej. pack 3 boxer → 1 negro + 1 gris + 1 blanco). El stock en la publicación se calcula como el mínimo de packs posibles.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowPublicationBundles(true)}
            className="shrink-0 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold"
          >
            Gestionar packs
          </button>
        </div>
      )}

      <label className="flex items-start gap-2.5 mb-3 px-1 cursor-pointer select-none max-w-3xl">
        <input
          type="checkbox"
          checked={tangoKeepStockOnExisting}
          onChange={(e) => setTangoKeepStockOnExisting(e.target.checked)}
          className="mt-0.5 rounded border-slate-600 text-amber-500 focus:ring-amber-500 shrink-0"
        />
        <span className="text-xs text-slate-400 leading-snug">
          <strong className="text-slate-300">Reimportar sin tocar stock:</strong> si está marcado, las filas cuya variante ya existía no actualizan la cantidad en depósito (solo se crean artículos/talles/colores/variantes nuevos y el stock del Excel aplica solo a esos). Desmarcá si querés que el Excel <strong className="text-slate-300">pise</strong> el stock de todo lo que coincida.
        </span>
      </label>

      {/* Resultado importación Tango */}
      {tangoImportResult && (
        <div className="bg-emerald-900/40 border border-emerald-700 rounded-xl px-4 py-3 flex items-start justify-between gap-2">
          <div className="text-sm text-emerald-200">
            <p className="font-semibold">Importación Tango finalizada</p>
            <p className="mt-1">
              {tangoImportResult.productsCreated} productos nuevos, {tangoImportResult.variantsCreated} variantes creadas{tangoImportResult.variantsUpdated ? `, ${tangoImportResult.variantsUpdated} filas ya existentes (SKU actualizado)` : ''}. Procesadas: {tangoImportResult.totalProcessed} filas.
            </p>
            {typeof tangoImportResult.stockUpdatesSkipped === 'number' && tangoImportResult.stockUpdatesSkipped > 0 && (
              <p className="mt-1 text-slate-300 text-xs">
                Stock no modificado en {tangoImportResult.stockUpdatesSkipped} fila(s) que ya tenían variante (reimportación sin duplicar cantidad).
              </p>
            )}
            {tangoImportResult.errors.length > 0 && (
              <p className="mt-1 text-amber-300 text-xs">Errores: {tangoImportResult.errors.slice(0, 3).join('; ')}{tangoImportResult.errors.length > 3 ? ` (+${tangoImportResult.errors.length - 3} más)` : ''}</p>
            )}
          </div>
          <button type="button" onClick={() => setTangoImportResult(null)} className="text-slate-400 hover:text-white p-1">
            <X size={18} />
          </button>
        </div>
      )}

      {/* Top Action Bar — acciones en menú */}
      <div className="flex items-center justify-end gap-2">
        <input
          ref={tangoFileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleImportTangoFile}
        />
        <input
          ref={stockExcelFileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleImportStockExcel}
        />
        <div className="relative shrink-0" ref={topDotsRef}>
          <button
            type="button"
            onClick={() => setTopDotsOpen(prev => !prev)}
            disabled={!!syncLoading}
            className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-2.5 min-h-[44px] rounded-2xl bg-slate-900/60 backdrop-blur-sm border border-slate-700/50 text-slate-300 hover:text-white hover:bg-slate-800/80 hover:border-slate-600 transition-all touch-manipulation disabled:opacity-60"
            aria-label="Acciones de inventario"
            aria-expanded={topDotsOpen}
          >
            {syncLoading ? (
              <Loader2 size={18} className="animate-spin shrink-0" />
            ) : (
              <MoreVertical size={18} className="shrink-0" />
            )}
            <span className="text-sm font-medium">
              {syncLoading === 'fromML' ? 'Sincronizando…' : syncLoading === 'both' ? 'Enviando…' : syncLoading ? 'Enviando…' : 'Acciones'}
            </span>
            <ChevronDown size={14} className={`shrink-0 opacity-60 transition-transform ${topDotsOpen ? 'rotate-180' : ''}`} />
          </button>
          {topDotsOpen && topDotsPosition && createPortal(
            <div
              data-top-dots-dropdown
              className="py-2 min-w-[268px] max-h-[min(70vh,520px)] overflow-y-auto bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl shadow-black/40 z-[9999]"
              style={{
                position: 'fixed',
                top: topDotsPosition.top,
                left: Math.max(8, Math.min(topDotsPosition.left, window.innerWidth - 276)),
                zIndex: 9999
              }}
            >
              {isAdminOrWarehouse && (
                <>
                  <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Sincronizar stock</p>
                  <button type="button" onClick={() => { setTopDotsOpen(false); handleSyncToMercadoLibre(); }} disabled={!!syncLoading} className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white rounded-xl disabled:opacity-50 max-w-[calc(100%-12px)]">
                    <Zap size={17} className="text-slate-400 shrink-0" />
                    Enviar a Mercado Libre
                  </button>
                  <button type="button" onClick={() => { setTopDotsOpen(false); handleSyncToTiendaNube(); }} disabled={!!syncLoading} className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white rounded-xl disabled:opacity-50 max-w-[calc(100%-12px)]">
                    <Cloud size={17} className="text-slate-400 shrink-0" />
                    Enviar a Tienda Nube
                  </button>
                  <button type="button" onClick={() => { setTopDotsOpen(false); handleSyncStock(); }} disabled={!!syncLoading} className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-emerald-300 hover:bg-emerald-900/30 hover:text-emerald-200 rounded-xl disabled:opacity-50 max-w-[calc(100%-12px)] border border-emerald-700/40" title="Envía el stock de LupoHub de TODOS los artículos vinculados a Mercado Libre y Tienda Nube (incluye stock 0)">
                    <RefreshCw size={17} className="text-emerald-400 shrink-0" />
                    Enviar stock ML + TN (todos)
                  </button>
                  <button type="button" onClick={() => { setTopDotsOpen(false); handleSyncFromMercadoLibre(); }} disabled={!!syncLoading} className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-slate-400 hover:bg-white/5 hover:text-slate-200 rounded-xl disabled:opacity-50 max-w-[calc(100%-12px)]">
                    <RefreshCw size={17} className="text-slate-500 shrink-0" />
                    Importar desde ML (opcional)
                  </button>
                  <div className="my-1.5 mx-3 border-t border-slate-700/50" />
                </>
              )}
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Importar / exportar</p>
              <button type="button" onClick={() => { setTopDotsOpen(false); tangoFileInputRef.current?.click(); }} disabled={importingTango} className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white rounded-xl disabled:opacity-50 max-w-[calc(100%-12px)]">
                {importingTango ? <Loader2 size={17} className="animate-spin shrink-0" /> : <Upload size={17} className="text-slate-400 shrink-0" />}
                Importar Tango
              </button>
              <button type="button" onClick={() => { setTopDotsOpen(false); stockExcelFileInputRef.current?.click(); }} disabled={importingStockExcel} className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white rounded-xl disabled:opacity-50 max-w-[calc(100%-12px)]">
                {importingStockExcel ? <Loader2 size={17} className="animate-spin shrink-0" /> : <Package size={17} className="text-slate-400 shrink-0" />}
                Importar stock Excel
              </button>
              <button type="button" onClick={() => { setTopDotsOpen(false); exportProductsToExcel(); }} disabled={exportingExcel} className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white rounded-xl disabled:opacity-50 max-w-[calc(100%-12px)]">
                {exportingExcel ? <Loader2 size={17} className="animate-spin shrink-0" /> : <Download size={17} className="text-slate-400 shrink-0" />}
                Exportar Excel
              </button>
              <button type="button" onClick={() => { setTopDotsOpen(false); exportSyncIssuesToExcel(); }} disabled={exportingSyncIssues} className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-amber-200/90 hover:bg-amber-500/10 hover:text-amber-100 rounded-xl disabled:opacity-50 max-w-[calc(100%-12px)]">
                {exportingSyncIssues ? <Loader2 size={17} className="animate-spin shrink-0 text-amber-400" /> : <AlertTriangle size={17} className="text-amber-400 shrink-0" />}
                Exportar errores sync ML→TN
              </button>
              {(canManagePublicationBundles || isAdminOrWarehouse) && (
                <div className="my-1.5 mx-3 border-t border-slate-700/50" />
              )}
              {canManagePublicationBundles && (
                <button type="button" onClick={() => { setTopDotsOpen(false); setShowPublicationBundles(true); }} className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white rounded-xl max-w-[calc(100%-12px)]">
                  <Layers size={17} className="text-slate-400 shrink-0" />
                  Packs multicolor
                </button>
              )}
              {isAdminOrWarehouse && (
                <button type="button" onClick={() => { setTopDotsOpen(false); openMergeManualModal(); }} className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white rounded-xl max-w-[calc(100%-12px)]">
                  <GitMerge size={17} className="text-slate-400 shrink-0" />
                  Unificar artículos
                </button>
              )}
              {isAdminOrWarehouse && (
                <>
                  <div className="my-1.5 mx-3 border-t border-slate-700/50" />
                  <button type="button" onClick={() => { setTopDotsOpen(false); openCreationModal(); }} className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm font-medium text-indigo-200 hover:bg-indigo-500/15 rounded-xl max-w-[calc(100%-12px)]">
                    <Plus size={17} className="text-indigo-400 shrink-0" />
                    Nuevo modelo
                  </button>
                </>
              )}
            </div>,
            document.body
          )}
        </div>
      </div>

      {/* Search Bar & Filters */}
      <div className="space-y-4 w-full">
        <div className="flex flex-col sm:flex-row gap-2 w-full min-w-0">
          <div className="relative flex-1 w-full min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={18} />
            <input 
              type="text" 
              placeholder="Buscar Código de Producto..." 
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full min-w-0 pl-10 pr-4 py-3 sm:py-3.5 min-h-[48px] bg-slate-900/80 border border-slate-700/50 rounded-2xl focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 outline-none text-white text-sm box-border transition-colors"
            />
          </div>
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={`flex-shrink-0 min-h-[48px] px-4 rounded-2xl border flex items-center justify-center gap-2 text-sm font-medium transition-all touch-manipulation ${showFilters ? 'bg-blue-500/20 text-blue-200 border-blue-500/50' : 'bg-slate-900/60 text-slate-400 border-slate-700/50 hover:text-white hover:border-slate-600 backdrop-blur-sm'}`}
          >
            <Filter size={18} />
            <span className="hidden md:inline">Filtros</span>
            {(filterCategory !== 'ALL' || filterSize !== 'ALL' || filterColor !== 'ALL' || filterStockLevel !== 'ALL' || filterSync !== 'ALL' || hideZeroStock || showHiddenVariants) && (
              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
            )}
          </button>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-3 sm:p-4 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 animate-fade-in">
             <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Categoría</label>
                <div className="relative">
                   <select 
                     value={filterCategory}
                     onChange={(e) => { setFilterCategory(e.target.value); setCurrentPage(1); }}
                     className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white outline-none appearance-none"
                   >
                     <option value="ALL">Todas</option>
                     {categories.map(c => <option key={c} value={c}>{c}</option>)}
                   </select>
                   <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={14} />
                </div>
             </div>
             
             <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Talle</label>
                <div className="relative">
                   <select 
                     value={filterSize}
                     onChange={(e) => { setFilterSize(e.target.value); setCurrentPage(1); }}
                     className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white outline-none appearance-none"
                   >
                     <option value="ALL">Todos</option>
                     {sizeOptions.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                   </select>
                   <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={14} />
                </div>
             </div>

             <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Color</label>
                <div className="relative">
                   <select 
                     value={filterColor}
                     onChange={(e) => { setFilterColor(e.target.value); setCurrentPage(1); }}
                     className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white outline-none appearance-none"
                   >
                     <option value="ALL">Todos</option>
                     {availableColors.map(c => {
                       const code = (c as any).code != null ? String((c as any).code).trim() : '';
                        const label = code ? `${code} - ${c.name || ''}` : (c.name || '');
                        const val = code || c.name;
                        return <option key={c.id} value={val}>{label}</option>;
                     })}
                   </select>
                   <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={14} />
                </div>
             </div>

             <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Estado</label>
                <div className="relative">
                   <select 
                     value={filterStockLevel}
                     onChange={(e) => { setFilterStockLevel(e.target.value as any); setCurrentPage(1); }}
                     className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white outline-none appearance-none"
                   >
                     <option value="ALL">Todos</option>
                     <option value="LOW">Poco Stock</option>
                     <option value="OUT">Agotado</option>
                   </select>
                   <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={14} />
                </div>
             </div>

             <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Sincronización</label>
                <div className="relative">
                   <select 
                     value={filterSync}
                     onChange={(e) => { setFilterSync(e.target.value as any); setCurrentPage(1); }}
                     className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white outline-none appearance-none"
                   >
                     <option value="ALL">Todos</option>
                     <option value="ML">Mercado Libre</option>
                     <option value="TN">Tienda Nube</option>
                     <option value="BOTH">En ambos</option>
                  <option value="MISMATCH">ML ≠ TN</option>
                     <option value="NONE">No sincronizado</option>
                   </select>
                   <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={14} />
                </div>
             </div>

             <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => { setHideZeroStock(prev => !prev); setCurrentPage(1); }}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border text-sm font-bold transition-colors touch-manipulation min-h-[42px] ${hideZeroStock ? 'bg-slate-700 border-cyan-500 text-cyan-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'}`}
                  title={hideZeroStock ? 'Mostrar todas las variantes' : 'Ocultar variantes con 0 stock'}
                >
                  <EyeOff size={16} />
                  Ocultar sin stock
                </button>
             </div>
             <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => { setShowHiddenVariants(prev => !prev); setCurrentPage(1); }}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border text-sm font-bold transition-colors touch-manipulation min-h-[42px] ${showHiddenVariants ? 'bg-slate-700 border-violet-500 text-violet-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'}`}
                  title={showHiddenVariants ? 'Ocultar variantes marcadas como descontinuadas' : 'Ver variantes ocultas / descontinuadas'}
                >
                  <Eye size={16} />
                  {showHiddenVariants ? 'Viendo ocultas' : 'Ver ocultas'}
                </button>
             </div>
          </div>
        )}
      </div>

      {/* Botón para activar modo selección (solo Mi inventario, admin/warehouse) */}
      {inventorySubView === 'mine' && isAdminOrWarehouse && !selectionModeEnabled && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 sm:px-4 py-2.5 sm:py-3 bg-slate-900/40 border border-slate-700/40 rounded-2xl backdrop-blur-sm">
          <span className="text-slate-500 text-sm">Enviá variantes a ML o TN con selección múltiple.</span>
          <button
            type="button"
            onClick={() => setSelectionModeEnabled(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm font-medium hover:bg-amber-500/20 transition-colors"
          >
            <Check size={16} className="opacity-80" />
            Seleccionar variantes
          </button>
        </div>
      )}

      {/* Barra de selección para enviar a TN/ML */}
      {inventorySubView === 'mine' && selectionModeEnabled && selectedVariantIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 sm:px-4 sm:py-3 bg-amber-500/5 border border-amber-500/20 rounded-2xl backdrop-blur-sm">
          <span className="text-amber-200/90 font-medium text-sm mr-auto">
            {selectedVariantIds.length} variante{selectedVariantIds.length !== 1 ? 's' : ''} seleccionada{selectedVariantIds.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={handleSyncSelectedToTiendaNube}
            disabled={!!syncSelectedLoading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-sm font-medium hover:bg-cyan-500/20 disabled:opacity-50 transition-colors"
          >
            {syncSelectedLoading === 'tn' ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}
            Tienda Nube
          </button>
          <button
            onClick={handleSyncSelectedToMercadoLibre}
            disabled={!!syncSelectedLoading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm font-medium hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
          >
            {syncSelectedLoading === 'ml' ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            Mercado Libre
          </button>
          <button
            onClick={handleSyncSelectedToBoth}
            disabled={!!syncSelectedLoading}
            title="Envía el stock de LupoHub (incluido 0) a Mercado Libre y Tienda Nube"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-sm font-medium hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
          >
            {syncSelectedLoading === 'both' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            ML + TN
          </button>
          <button
            onClick={() => setSelectedVariantIds([])}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-slate-400 text-sm hover:text-slate-200 hover:bg-white/5 transition-colors"
          >
            <X size={16} />
            Limpiar
          </button>
          <button
            onClick={() => setSelectionModeEnabled(false)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-slate-400 text-sm hover:text-slate-200 hover:bg-white/5 transition-colors"
            title="Ocultar cuadros de selección"
          >
            Listo
          </button>
        </div>
      )}

      {inventorySubView === 'mine' && selectionModeEnabled && selectedVariantIds.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 sm:px-4 py-2.5 sm:py-3 bg-slate-900/40 border border-slate-700/40 rounded-2xl backdrop-blur-sm">
          <span className="text-slate-500 text-sm">Expandí un artículo y marcá las variantes a enviar.</span>
          <button
            type="button"
            onClick={() => setSelectionModeEnabled(false)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-slate-400 text-sm hover:text-slate-200 hover:bg-white/5 transition-colors"
          >
            Cerrar selección
          </button>
        </div>
      )}

      {/* Grouped List Container */}
      <div className="space-y-4">
        {(() => {
          const { displayGroups, totalPages, safePage } = displayGroupsInfo;
          const start = (safePage - 1) * pageSize;
          const end = start + pageSize;
          const pageGroups = displayGroups.slice(start, end);
          return pageGroups.map(({ groupKey, groupVariants, totalStock, category }) => {
          const variantsToRender = getGroupFilteredVariants(groupKey, groupVariants);
          const variantsToShow = hideZeroStock
            ? variantsToRender.filter(p => Number((p as any).stock ?? (p as any).stock_total ?? 0) > 0)
            : variantsToRender;

          const isExpanded = expandedGroups.includes(groupKey);
          const skuLabel = groupKey;
          const rawName = (groupVariants[0]?.name || '').toString().trim();
          const displayName = rawName ? `${skuLabel} - ${rawName}` : skuLabel;
          const codigoLabel = `Código: ${skuLabel}`;
          const articleProductId = (groupVariants[0] as any)?.product_id as string | undefined;
          const articleVariantIds = Array.from(
            new Set(
              (groupVariants || [])
                .map((v: any) => String(v?.id || '').trim())
                .filter(Boolean)
            )
          );
          
          const displayTotalStock = getGroupDisplayStockResolved(groupKey, groupVariants, totalStock);
          const hasLowStock = getGroupHasLowStock(groupKey, groupVariants);
          const isFullyOut = displayTotalStock === 0;

          return (
            <div
              key={groupKey}
              ref={(el) => { groupCardRefs.current[groupKey] = el; }}
              className={`bg-slate-800 rounded-xl sm:rounded-2xl border transition-all overflow-hidden ${isExpanded ? 'border-blue-500/50 shadow-lg shadow-blue-900/10' : 'border-slate-700'}`}
            >
              {/* Group Header (Clickable) */}
              <div 
                onClick={() => toggleGroup(groupKey)}
                className="p-3 sm:p-4 md:p-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-2 cursor-pointer hover:bg-slate-750 active:bg-slate-700/50 transition-colors touch-manipulation"
              >
                <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                  {isAdminOrWarehouse && selectionModeEnabled && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleGroupSelection(groupKey, groupVariants); }}
                      className="shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-lg border-2 flex items-center justify-center transition-colors touch-manipulation"
                      title={isGroupFullySelected(groupKey, groupVariants) ? 'Quitar artículo de la selección' : 'Seleccionar artículo (todas las variantes)'}
                      style={{
                        borderColor: isGroupFullySelected(groupKey, groupVariants) ? 'rgb(234 179 8)' : isGroupPartiallySelected(groupKey, groupVariants) ? 'rgb(234 179 8)' : 'rgb(71 85 105)',
                        backgroundColor: isGroupFullySelected(groupKey, groupVariants) ? 'rgba(234,179,8,0.2)' : isGroupPartiallySelected(groupKey, groupVariants) ? 'rgba(234,179,8,0.1)' : 'transparent'
                      }}
                    >
                      {isGroupFullySelected(groupKey, groupVariants) && <Check size={18} className="text-amber-400" strokeWidth={3} />}
                      {!isGroupFullySelected(groupKey, groupVariants) && isGroupPartiallySelected(groupKey, groupVariants) && <span className="w-2 h-2 rounded-full bg-amber-500" />}
                    </button>
                  )}
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 flex-shrink-0 ${isFullyOut ? 'bg-red-900/20 text-red-500' : 'bg-blue-900/20 text-blue-400'}`}>
                    <Box size={24} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-white text-base sm:text-lg leading-snug line-clamp-2 break-words">{displayName}</h3>
                    <div className="flex items-center gap-1.5 sm:gap-2 mt-1 flex-wrap">
                       <span className="text-[10px] font-mono font-bold text-slate-300 bg-slate-800 px-1.5 sm:px-2 py-0.5 rounded border border-slate-600 max-w-[200px] sm:max-w-none truncate" title="Código de artículo (Tango / sistema)">
                         {codigoLabel}
                       </span>
                       <span className="text-[10px] font-black uppercase tracking-wider bg-slate-900 text-slate-400 px-1.5 sm:px-2 py-0.5 rounded-lg border border-slate-700">
                         {category}
                       </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-row flex-wrap items-center justify-end sm:justify-start gap-3 sm:gap-4 md:gap-8 shrink-0">
                   {/* Stock */}
                   <div className="text-right">
                      <div className={`px-2 py-1 rounded-lg font-black text-sm sm:text-base ${isFullyOut ? 'text-red-500 bg-red-900/20' : displayTotalStock < 50 ? 'text-yellow-500 bg-yellow-900/20' : 'text-green-400 bg-green-900/20'}`}>
                         {displayTotalStock} <span className="text-[10px] sm:text-xs text-slate-500 font-normal">un</span>
                      </div>
                      <div className="text-[9px] uppercase font-black text-slate-500 tracking-widest hidden sm:block">Stock</div>
                   </div>
                   
                   {isAdminOrWarehouse && (
                     <div className="relative" ref={el => { cardDotsRefs.current[groupKey] = el; }}>
                       <button
                         type="button"
                         onClick={(e) => { e.stopPropagation(); setCardDotsOpenKey(prev => prev === groupKey ? null : groupKey); }}
                         className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl border border-transparent text-slate-400 hover:text-white hover:bg-slate-700/40 hover:border-slate-600/50 transition-all touch-manipulation"
                         aria-label="Acciones del artículo"
                         aria-expanded={cardDotsOpenKey === groupKey}
                       >
                         <MoreVertical size={18} />
                       </button>
                       {cardDotsOpenKey === groupKey && cardDotsPosition && createPortal(
                         <div
                           data-card-dots-dropdown
                           className="py-1.5 min-w-[200px] bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-xl shadow-black/30 z-[9998]"
                           style={{
                             position: 'fixed',
                             top: cardDotsPosition.top,
                             left: Math.max(8, cardDotsPosition.left),
                             zIndex: 9998
                           }}
                         >
                           <button
                             type="button"
                             onClick={(e) => { e.stopPropagation(); setCardDotsOpenKey(null); handleAddVariant(groupKey); }}
                             className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white rounded-xl max-w-[calc(100%-12px)]"
                           >
                             <PlusCircle size={17} className="text-slate-400 shrink-0" />
                             Agregar variante
                           </button>
                           {(groupVariants[0] as any)?.product_id && (
                             <>
                               <button
                                 type="button"
                                 onClick={(e) => { e.stopPropagation(); setCardDotsOpenKey(null); setEditingProductGroupKey(groupKey); setEditingProductId((groupVariants[0] as any).product_id); }}
                                 className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white rounded-xl max-w-[calc(100%-12px)]"
                               >
                                 <Edit2 size={17} className="text-slate-400 shrink-0" />
                                 Editar artículo
                               </button>
                               <button
                                 type="button"
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   setCardDotsOpenKey(null);
                                   openMergeManualModalFromGroup(groupKey, groupVariants);
                                 }}
                                 className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-violet-200 hover:bg-violet-500/10 rounded-xl max-w-[calc(100%-12px)]"
                               >
                                 <GitMerge size={17} className="shrink-0" />
                                 Unificar con otro artículo
                               </button>
                               <button
                                 type="button"
                                 onClick={(e) => { e.stopPropagation(); setCardDotsOpenKey(null); handleDeleteProduct((groupVariants[0] as any).product_id, groupKey, displayName); }}
                                 className="w-full flex items-center gap-3 mx-1.5 px-3 py-2.5 text-left text-sm text-red-300/90 hover:bg-red-500/10 rounded-xl max-w-[calc(100%-12px)]"
                               >
                                 <Trash2 size={17} className="shrink-0" />
                                 Eliminar artículo
                               </button>
                             </>
                           )}
                         </div>,
                         document.body
                       )}
                     </div>
                   )}

                   <div className={`p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl border transition-all duration-200 ${isExpanded ? 'bg-blue-500/20 border-blue-500/40 text-blue-300 rotate-180' : 'bg-transparent border-slate-700/40 text-slate-500'}`}>
                      <ChevronDown size={18} />
                   </div>
                </div>
              </div>

              {/* Collapsed Warning/Info Summary */}
              {!isExpanded && (isAdminOrWarehouse) && (hasLowStock || isFullyOut) && (
                <div className="px-5 pb-3 flex gap-2">
                   {isFullyOut && (
                     <span className="inline-flex items-center gap-1 text-[10px] font-black text-red-400 bg-red-900/10 px-2 py-1 rounded border border-red-900/20">
                       <XCircle size={12} /> ARTÍCULO SIN STOCK
                     </span>
                   )}
                   {!isFullyOut && hasLowStock && (
                     <span className="inline-flex items-center gap-1 text-[10px] font-black text-yellow-500 bg-yellow-900/10 px-2 py-1 rounded border border-yellow-900/20">
                       <AlertTriangle size={12} /> VARIANTES CRÍTICAS
                     </span>
                   )}
                </div>
              )}

              {/* Expanded Variants List */}
              {isExpanded && (
                <div className="border-t border-slate-700 bg-slate-900/30 animate-fade-in">
                  <div className="p-2 sm:p-4 space-y-2">
                    {isAdminOrWarehouse && !loadingVariantsByGroup[groupKey] && groupVariants.length > 0 && (
                      <>
                      <div className="flex flex-col sm:flex-row justify-end gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleSyncGroupStockToBoth(groupKey, articleVariantIds);
                          }}
                          disabled={syncingGroupKey === groupKey || !!syncSelectedLoading}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors min-h-[44px] touch-manipulation border border-emerald-500/40 disabled:opacity-50"
                          title="Envía el stock de LupoHub de TODAS las variantes de este artículo a Mercado Libre y Tienda Nube (incluye stock 0)"
                        >
                          {syncingGroupKey === groupKey ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                          Enviar stock ML + TN
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openMergeManualModalFromGroup(groupKey, groupVariants); }}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-semibold transition-colors min-h-[44px] touch-manipulation border border-violet-500/40"
                        >
                          <GitMerge size={16} />
                          Unificar con otro artículo
                        </button>
                        {articleProductId && groupHasPlatformLinks(groupKey, groupVariants, 'ml') && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnlinkGroupPlatforms(groupKey, articleProductId, groupVariants, 'mercadolibre');
                            }}
                            disabled={unlinkingGroupKey === groupKey}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-amber-950/50 hover:bg-amber-900/60 text-amber-100 text-sm font-semibold transition-colors min-h-[44px] touch-manipulation border border-amber-700/50 disabled:opacity-50"
                          >
                            {unlinkingGroupKey === groupKey ? <Loader2 size={16} className="animate-spin" /> : <Unlink size={16} />}
                            Desvincular ML
                          </button>
                        )}
                        {articleProductId && groupHasPlatformLinks(groupKey, groupVariants, 'tn') && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnlinkGroupPlatforms(groupKey, articleProductId, groupVariants, 'tiendanube');
                            }}
                            disabled={unlinkingGroupKey === groupKey}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-cyan-950/50 hover:bg-cyan-900/60 text-cyan-100 text-sm font-semibold transition-colors min-h-[44px] touch-manipulation border border-cyan-700/50 disabled:opacity-50"
                          >
                            {unlinkingGroupKey === groupKey ? <Loader2 size={16} className="animate-spin" /> : <Unlink size={16} />}
                            Desvincular TN
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openBulkLinkGroupPage(groupKey); }}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors min-h-[44px] touch-manipulation"
                          title="Vincular todas las variantes del artículo con Mercado Libre y Tienda Nube"
                        >
                          <Link size={16} />
                          Vincular y sincronizar con ML / TN
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 text-right mt-2">
                        <strong className="text-slate-400">Enviar stock ML + TN</strong> actualiza todas las variantes del artículo (incluido 0).
                        {' '}Vincular es un flujo aparte para emparejar publicaciones ML/TN por talle/color.
                      </p>
                      </>
                    )}
                    {loadingVariantsByGroup[groupKey] && (
                      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 text-slate-400 text-sm flex items-center gap-3">
                        <Loader2 className="animate-spin text-blue-400 shrink-0" size={22} />
                        <span>Cargando variantes…</span>
                      </div>
                    )}
                    {!loadingVariantsByGroup[groupKey] && variantsToShow.length === 0 && (filterColor !== 'ALL' || hideZeroStock || !showHiddenVariants || filterSync === 'MISMATCH') && (
                      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 text-slate-400 text-sm">
                        {hideZeroStock
                          ? 'No hay variantes con stock para mostrar.'
                          : !showHiddenVariants
                            ? 'No hay variantes visibles. Activá «Ver ocultas» si ocultaste variantes descontinuadas.'
                          : filterSync === 'MISMATCH'
                            ? 'No hay variantes con diferencia ML/TN en este artículo (o aún se están cargando los stocks externos).'
                            : 'No hay variantes para el color seleccionado.'}
                      </div>
                    )}
                    {[...variantsToShow]
                      .sort((a, b) => {
                        const partsA = (a.sku || '').toString().split('-');
                        const partsB = (b.sku || '').toString().split('-');
                        const sizeA = (a.size || (partsA.length >= 3 ? partsA[partsA.length - 2] : '') || '').toString();
                        const sizeB = (b.size || (partsB.length >= 3 ? partsB[partsB.length - 2] : '') || '').toString();
                        const colorA = (a.color || (partsA.length >= 3 ? partsA[partsA.length - 1] : '') || '').toString();
                        const colorB = (b.color || (partsB.length >= 3 ? partsB[partsB.length - 1] : '') || '').toString();
                        const sizeOrder = ['U','P','S','M','G','GG','XG','XXG','XXXG'];
                        const ia = sizeOrder.indexOf(sizeA);
                        const ib = sizeOrder.indexOf(sizeB);
                        const ra = ia === -1 ? 999 : ia;
                        const rb = ib === -1 ? 999 : ib;
                        if (ra !== rb) return ra - rb;
                        if (sizeA !== sizeB) return sizeA.localeCompare(sizeB);
                        return colorA.localeCompare(colorB);
                      })
                      .map(product => {
                      const isLow = product.stock > 0 && product.stock < 20;
                      const isOut = product.stock <= 0;
                      const isEditing = editingStockId === product.id;
                      const isHidden = isVariantInventoryHidden(product as Product & { inventoryHidden?: boolean });
                      const parts = (product.sku || '').toString().split('-');
                      const sizeLabel = product.size || (parts.length >= 3 ? parts[parts.length - 2] : '');
                      const colorLabel = product.color || (parts.length >= 3 ? parts[parts.length - 1] : '');
                      const talleDisplay = labelTalle(sizeLabel) || sizeLabel;

                      return (
                        <div key={product.id} className={`bg-slate-800 rounded-xl p-3 border flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 ${isHidden ? 'border-violet-800/60 opacity-60' : 'border-slate-700'}`}>
                           {isAdminOrWarehouse && selectionModeEnabled && (
                             <button
                               type="button"
                               onClick={() => toggleVariantSelection(product.id)}
                               className="shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-lg border-2 flex items-center justify-center transition-colors self-start md:self-center"
                               title={selectedSet.has(product.id) ? 'Quitar de la selección' : 'Seleccionar variante'}
                               style={{
                                 borderColor: selectedSet.has(product.id) ? 'rgb(234 179 8)' : 'rgb(71 85 105)',
                                 backgroundColor: selectedSet.has(product.id) ? 'rgba(234,179,8,0.2)' : 'transparent'
                               }}
                             >
                               {selectedSet.has(product.id) && <Check size={16} className="text-amber-400" strokeWidth={3} />}
                             </button>
                           )}
                           {/* Variant Info */}
                           <div className="flex-1 min-w-0">
                             <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-[10px] font-mono text-blue-400 bg-blue-900/20 px-1.5 py-0.5 rounded border border-blue-900/30 truncate max-w-[140px] sm:max-w-none">
                                   {product.sku}
                                </span>
                                {isHidden && (
                                  <span className="text-[9px] font-bold uppercase tracking-wide text-violet-300 bg-violet-950/50 px-1.5 py-0.5 rounded border border-violet-800/50">
                                    Oculta
                                  </span>
                                )}
                                <div className="flex gap-1 shrink-0">
                                  {isVariantLinkedToTiendaNube(product.externalIds) && <Cloud size={12} className="text-blue-400" />}
                                  {isVariantLinkedToMercadoLibre(product.externalIds) && <Zap size={12} className="text-yellow-500" />}
                                </div>
                             </div>
                             <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-sm text-white font-medium">
                                   <span className="text-slate-500 font-normal text-xs uppercase mr-1">Talle:</span>{talleDisplay}
                                </span>
                                <span className="w-px h-3 bg-slate-700 hidden sm:inline"></span>
                                <span className="text-sm text-white font-medium flex items-center gap-1">
                                   <span className="text-slate-500 font-normal text-xs uppercase mr-1">Color:</span>
                                   {colorLabel}
                                </span>
                             </div>
                           </div>

                           {/* Stock Control Area */}
                           <div className="flex items-center justify-between md:justify-end gap-2 sm:gap-4 border-t md:border-t-0 border-slate-700 pt-3 md:pt-0 flex-wrap">
                              {isAdminOrWarehouse ? (
                                <div className="flex items-center gap-3">
                                  {isEditing ? (
                                    <div className="flex flex-col gap-1.5 animate-fade-in bg-slate-900 p-2 sm:p-1.5 rounded-lg border border-slate-600">
                                      <div className="flex items-center gap-1.5 justify-center">
                                        {([1, 5, 10] as const).map((step) => (
                                          <button
                                            key={step}
                                            type="button"
                                            onMouseDown={(e) => {
                                              e.preventDefault();
                                              armSkipStockBlur();
                                            }}
                                            onClick={() => setStockAdjustStep(step)}
                                            className={`px-2 py-0.5 rounded text-[10px] font-bold border touch-manipulation ${
                                              stockAdjustStep === step
                                                ? 'bg-blue-600 border-blue-500 text-white'
                                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                                            }`}
                                            title={`Ajustar de a ${step}`}
                                          >
                                            ±{step}
                                          </button>
                                        ))}
                                        <span className="text-[9px] text-slate-500 ml-1 hidden sm:inline">o escribí el total</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          startStockHold(product.id, -1);
                                        }}
                                        onMouseUp={endStockHold}
                                        onMouseLeave={endStockHold}
                                        onTouchStart={(e) => {
                                          e.preventDefault();
                                          startStockHold(product.id, -1);
                                        }}
                                        onTouchEnd={endStockHold}
                                        onTouchCancel={endStockHold}
                                        className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center bg-slate-800 rounded-lg sm:rounded hover:bg-slate-700 text-slate-300 active:scale-95 touch-manipulation"
                                        title={`Bajar ${stockAdjustStep} (mantener para repetir)`}
                                      >
                                        <Minus size={18} className="sm:w-4 sm:h-4" />
                                      </button>
                                      <input 
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        autoFocus
                                        value={stockEditDraft}
                                        onFocus={(e) => e.currentTarget.select()}
                                        onChange={(e) => onManualStockInputChange(product.id, e.target.value)}
                                        onBlur={(e) => commitManualStock(product.id, e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            commitManualStock(product.id, (e.target as HTMLInputElement).value);
                                            setEditingStockId(null);
                                          }
                                        }}
                                        className="w-16 sm:w-14 bg-transparent text-center font-bold text-white text-lg outline-none"
                                        title="Escribí la cantidad final y Enter o ✓"
                                      />
                                      <button
                                        type="button"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          startStockHold(product.id, 1);
                                        }}
                                        onMouseUp={endStockHold}
                                        onMouseLeave={endStockHold}
                                        onTouchStart={(e) => {
                                          e.preventDefault();
                                          startStockHold(product.id, 1);
                                        }}
                                        onTouchEnd={endStockHold}
                                        onTouchCancel={endStockHold}
                                        className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center bg-blue-600 rounded-lg sm:rounded text-white hover:bg-blue-500 active:scale-95 touch-manipulation"
                                        title={`Subir ${stockAdjustStep} (mantener para repetir)`}
                                      >
                                        <Plus size={18} className="sm:w-4 sm:h-4" />
                                      </button>
                                      <button 
                                        type="button"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          armSkipStockBlur();
                                        }}
                                        onClick={() => {
                                          clearStockHold();
                                          commitManualStock(product.id, stockEditDraft, { force: true });
                                          setEditingStockId(null);
                                        }}
                                        className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center bg-green-600 rounded-lg sm:rounded text-white hover:bg-green-500 active:scale-95 ml-1 touch-manipulation"
                                        title="Guardar y cerrar"
                                      >
                                        <Check size={18} className="sm:w-4 sm:h-4" />
                                      </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                                       <div className="text-right">
                                         <span className={`block text-xl font-black leading-none ${isOut ? 'text-red-500' : isLow ? 'text-yellow-500' : 'text-white'}`}>
                                           {product.stock}
                                         </span>
                                         <span className="text-[9px] text-slate-500 uppercase font-bold">Unidades</span>
                                       </div>
                                       <div className="flex flex-col gap-0.5 text-xs">
                                         {(() => {
                                           const mlLinked = isVariantLinkedToMercadoLibre(product.externalIds);
                                           const tnLinked = isVariantLinkedToTiendaNube(product.externalIds);
                                           const mlDisp = getChannelStockDisplay(mlLinked, variantExternalStocks[product.id]?.stockML);
                                           const tnDisp = getChannelStockDisplay(tnLinked, variantExternalStocks[product.id]?.stockTN);
                                           return (
                                             <>
                                         <div className="flex items-center gap-1.5">
                                           <Zap size={10} className={mlLinked ? 'text-amber-500 shrink-0' : 'text-slate-600 shrink-0'} />
                                           <span className="text-slate-400">ML:</span>
                                           <span className={mlDisp.className}>{mlDisp.text}</span>
                                         </div>
                                         <div className="flex items-center gap-1.5">
                                           <Cloud size={10} className={tnLinked ? 'text-blue-400 shrink-0' : 'text-slate-600 shrink-0'} />
                                           <span className="text-slate-400">TN:</span>
                                           <span className={tnDisp.className}>{tnDisp.text}</span>
                                         </div>
                                             </>
                                           );
                                         })()}
                                       </div>
                                      <button
                                       type="button"
                                       onClick={() => void toggleVariantHidden(product.id, isHidden)}
                                       className={`p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border transition-colors touch-manipulation ${
                                         isHidden
                                           ? 'bg-violet-900/40 border-violet-700 text-violet-300 hover:bg-violet-900/60'
                                           : 'bg-slate-750 hover:bg-slate-700 border-slate-700 text-slate-400 hover:text-violet-300'
                                       }`}
                                       title={isHidden ? 'Mostrar variante en inventario' : 'Ocultar variante descontinuada'}
                                      >
                                       {isHidden ? <Eye size={16} /> : <EyeOff size={16} />}
                                      </button>
                                      <button
                                       type="button"
                                       onClick={() => openVariantUnifyModal(product, groupKey, groupVariants, variantsToShow)}
                                       className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-750 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-violet-300 border border-slate-700 transition-colors touch-manipulation"
                                       title="Unificar con otra variante del mismo talle y mismo color (nombre)"
                                      >
                                       <GitMerge size={16} />
                                      </button>
                                      <button
                                       type="button"
                                       onClick={() => {
                                         openArticleStockHistory({
                                           productId: articleProductId,
                                           variantIds: articleVariantIds,
                                           title: displayName
                                         });
                                       }}
                                       className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-750 hover:bg-violet-700 rounded-lg text-slate-400 hover:text-violet-200 border border-slate-700 transition-colors touch-manipulation"
                                       title="Ver historial de stock del artículo"
                                      >
                                       <History size={16} />
                                      </button>
                                      <button 
                                       onClick={() => setEditingVariantId(product.id)}
                                       className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-750 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-amber-400 border border-slate-700 transition-colors touch-manipulation"
                                       title="Editar código de la variante (ej. 0052302140111-M-AZUL_MARINO_-_BLANCO)"
                                      >
                                       <Tag size={16} />
                                      </button>
                                      <button 
                                       onClick={() => handleOpenDespachoModal(product)}
                                       className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-750 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-amber-400 border border-slate-700 transition-colors touch-manipulation"
                                       title="Asignar a Despacho de Importación"
                                      >
                                       <Ship size={16} />
                                      </button>
                                      <button 
                                       type="button"
                                       onClick={() => {
                                         const current = Number((product as any).stock ?? (product as any).stock_total ?? 0);
                                         baselineManualStockRef.current[product.id] = current;
                                         lastAckStockRef.current[product.id] = current;
                                         setStockEditDraft(String(current));
                                         setEditingStockId(product.id);
                                       }}
                                       className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-750 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-blue-400 border border-slate-700 transition-colors touch-manipulation"
                                      >
                                       <Edit2 size={16} />
                                      </button>
                                      <button 
                                       onClick={() => handleDeleteVariant(product.id, product.sku || '', groupKey)}
                                       className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-750 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-red-400 border border-slate-700 transition-colors touch-manipulation"
                                       title="Eliminar variante"
                                      >
                                       <Trash2 size={16} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  {isOut ? (
                                    <div className="flex items-center gap-1.5 text-red-500 font-black text-xs uppercase tracking-tight bg-red-900/10 px-3 py-1.5 rounded-lg border border-red-900/20">
                                      <XCircle size={14} /> Agotado
                                    </div>
                                  ) : (
                                    <div className={`flex items-center gap-1.5 font-black text-xs uppercase tracking-tight px-3 py-1.5 rounded-lg border ${isLow ? 'text-yellow-500 bg-yellow-900/10 border-yellow-900/20' : 'text-green-400 bg-green-900/10 border-green-900/20'}`}>
                                      <CheckCircle2 size={14} /> Disponible
                                    </div>
                                  )}
                                </div>
                              )}
                           </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
          });
        })()}
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 mt-4 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest hidden sm:inline">Ordenar</span>
          <select 
            value={sortKey}
            onChange={(e) => {
              const next = e.target.value as typeof sortKey;
              setSortKey(next);
              if (next === 'CREATED' || next === 'UPDATED') setSortDir('desc');
              setCurrentPage(1);
            }}
            className="bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-xs text-white outline-none appearance-none min-h-[44px] touch-manipulation"
          >
            <option value="SKU">Código</option>
            <option value="STOCK">Stock Total</option>
            <option value="VARIANTS">Variantes</option>
            <option value="UPDATED">Última modificación</option>
            <option value="CREATED">Última creación</option>
          </select>
          <button 
            onClick={() => { setSortDir(prev => prev === 'asc' ? 'desc' : 'asc'); setCurrentPage(1); }}
            className="px-3 py-2.5 min-h-[44px] bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 touch-manipulation"
          >
            {sortDir === 'asc' ? 'ASC' : 'DESC'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            Pág {displayGroupsInfo.safePage}/{displayGroupsInfo.totalPages}
          </span>
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest hidden sm:inline">Por página</span>
          <select 
            value={pageSize}
            onChange={(e) => { setPageSize(parseInt(e.target.value)); setCurrentPage(1); }}
            className="bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-xs text-white outline-none appearance-none min-h-[44px] touch-manipulation"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
          <button 
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={displayGroupsInfo.safePage <= 1}
            className="px-3 py-2.5 min-h-[44px] bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
          >
            Prev
          </button>
          <button 
            onClick={() => setCurrentPage(prev => prev + 1)}
            disabled={displayGroupsInfo.safePage >= displayGroupsInfo.totalPages}
            className="px-3 py-2.5 min-h-[44px] bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
          >
            Next
          </button>
        </div>
      </div>
      {Object.keys(groupedProducts).length === 0 && (
        <div className="text-center py-24 bg-slate-900/30 rounded-3xl border-2 border-dashed border-slate-800">
           <Box size={48} className="mx-auto text-slate-800 mb-3 opacity-20" />
           <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Sin coincidencias para los filtros aplicados</p>
        </div>
      )}

      {/* Floating Action Button (FAB) for Mobile/Desktop */}
      {isAdminOrWarehouse && (
        <button
          onClick={() => openCreationModal()}
          className="fixed bottom-20 md:bottom-8 right-4 md:right-8 bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-full shadow-2xl shadow-blue-900/50 z-40 active:scale-95 transition-all"
        >
          <Plus size={24} />
        </button>
      )}

      {showStockHistoryModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-hidden bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col">
            <div className="px-4 sm:px-5 py-3 border-b border-slate-700 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-white font-black text-base sm:text-lg">Historial de stock por artículo</h3>
                <p className="text-slate-400 text-xs truncate">{stockHistoryArticle?.title || '—'}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowStockHistoryModal(false)}
                className="p-2 min-w-[40px] min-h-[40px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                aria-label="Cerrar historial"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-3 sm:p-4 overflow-auto">
              {stockHistoryLoading ? (
                <div className="py-10 text-slate-400 flex items-center justify-center gap-2 text-sm">
                  <Loader2 size={16} className="animate-spin" />
                  Cargando historial...
                </div>
              ) : stockHistoryRows.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-sm">No hay movimientos de stock para este artículo.</div>
              ) : (
                <div className="overflow-auto rounded-xl border border-slate-700">
                  <table className="min-w-full text-xs sm:text-sm">
                    <thead className="bg-slate-800/80 text-slate-300 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Fecha</th>
                        <th className="text-left px-3 py-2">Tipo</th>
                        <th className="text-left px-3 py-2">SKU variante</th>
                        <th className="text-right px-3 py-2">Cambio</th>
                        <th className="text-right px-3 py-2">Anterior</th>
                        <th className="text-right px-3 py-2">Nuevo</th>
                        <th className="text-left px-3 py-2">Referencia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {stockHistoryRows.map((m) => (
                        <tr key={m.id} className="text-slate-200 hover:bg-slate-800/40">
                          <td className="px-3 py-2 whitespace-nowrap">{formatMovementDateTime(m.created_at)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{movementTypeLabel(m.movement_type)}</td>
                          <td className="px-3 py-2 font-mono">{m.sku || '—'}</td>
                          <td className={`px-3 py-2 text-right font-bold ${Number(m.quantity_change) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {Number(m.quantity_change) > 0 ? `+${m.quantity_change}` : m.quantity_change}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.previous_stock}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.new_stock}</td>
                          <td className="px-3 py-2 max-w-[360px] truncate" title={movementReferenceLabel(m)}>{movementReferenceLabel(m)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showMergeManualModal && (
        <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col shadow-2xl">
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-2 rounded-xl bg-violet-600/30 text-violet-300 shrink-0">
                  <GitMerge size={22} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-white font-bold text-base truncate">Unificar artículos</h3>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Buscá por código o nombre, agregá los duplicados y elegí cuál queda como principal.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !mergeSaving && setShowMergeManualModal(false)}
                className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 shrink-0"
                aria-label="Cerrar"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
              {mergeSelected.length > 0 && (
                <div className="rounded-xl border border-violet-500/40 bg-violet-950/25 px-3 py-2 text-xs text-violet-100/90">
                  El artículo marcado como <strong className="text-violet-200">principal</strong> conserva su código; los demás se absorben (stock, variantes y vínculos ML/TN). No se puede deshacer.
                </div>
              )}

              {(mergeSuggestionsLoading || mergeSuggestions.length > 0) && (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Posibles duplicados
                  </p>
                  {mergeSuggestionsLoading ? (
                    <div className="p-3 text-slate-500 text-sm flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" /> Buscando artículos parecidos…
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-36 overflow-y-auto rounded-lg border border-slate-700 divide-y divide-slate-800">
                      {mergeSuggestions.map((row) => (
                        <div key={row.productId} className="flex items-center gap-2 p-2 hover:bg-slate-800/80">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-white font-mono truncate">{row.baseSku}</p>
                            <p className="text-xs text-slate-400 truncate">{row.name || '—'}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => addMergeCandidate(row)}
                            disabled={mergeSelected.some((s) => s.productId === row.productId)}
                            className="shrink-0 px-2 py-1 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40"
                          >
                            Agregar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Buscar artículo</label>
                <input
                  type="text"
                  value={mergePickSearch}
                  onChange={(e) => setMergePickSearch(e.target.value)}
                  placeholder="Ej: 40600, Cola less…"
                  className="mt-1 w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-600 text-white text-sm outline-none focus:ring-2 focus:ring-violet-500"
                />
                <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-700 divide-y divide-slate-800">
                  {mergePickLoading ? (
                    <div className="p-3 text-slate-500 text-sm flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" /> Buscando…
                    </div>
                  ) : mergePickSearch.trim() && mergePickResults.length === 0 ? (
                    <div className="p-3 text-slate-500 text-sm">Sin resultados.</div>
                  ) : (
                    mergePickResults.map((row) => (
                      <div key={row.productId} className="flex items-center gap-2 p-2 hover:bg-slate-800/80">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-white font-medium truncate">{row.baseSku}</p>
                          <p className="text-xs text-slate-400 truncate">{row.name || '—'}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addMergeCandidate(row)}
                          disabled={mergeSelected.some((s) => s.productId === row.productId)}
                          className="shrink-0 px-2 py-1 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Agregar
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  A fusionar ({mergeSelected.length}) — principal
                </p>
                {mergeSelected.length === 0 ? (
                  <p className="text-sm text-slate-500 py-2">Todavía no agregaste artículos.</p>
                ) : (
                  <ul className="space-y-2">
                    {mergeSelected.map((row) => (
                      <li
                        key={row.productId}
                        className={`flex items-start gap-2 p-2 rounded-xl border ${
                          mergeKeeperProductId === row.productId
                            ? 'border-violet-500/60 bg-violet-950/30'
                            : 'border-slate-700 bg-slate-800/40'
                        }`}
                      >
                        <label className="flex items-start gap-2 min-w-0 flex-1 cursor-pointer">
                          <input
                            type="radio"
                            name="mergeKeeper"
                            className="mt-1 accent-violet-500"
                            checked={mergeKeeperProductId === row.productId}
                            onChange={() => setMergeKeeperProductId(row.productId)}
                          />
                          <span className="min-w-0">
                            <span className="text-sm font-mono text-white block">{row.baseSku}</span>
                            <span className="text-xs text-slate-400 block truncate">{row.name || '—'}</span>
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => removeMergeCandidate(row.productId)}
                          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:bg-red-900/40 hover:text-red-300"
                          aria-label="Quitar"
                        >
                          <X size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-slate-700 flex flex-col sm:flex-row gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowMergeManualModal(false)}
                disabled={mergeSaving}
                className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={runManualMerge}
                disabled={mergeSaving || mergeSelected.length < 2 || !mergeKeeperProductId}
                className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {mergeSaving ? <Loader2 size={16} className="animate-spin" /> : <GitMerge size={16} />}
                Unificar ahora
              </button>
            </div>
          </div>
        </div>
      )}

      {variantUnifyModal && (() => {
        const absorbProd = variantUnifyModal.sameSizeVariants.find((v) => v.id === variantUnifyAbsorbId);
        const keeperOptions = absorbProd
          ? variantUnifyModal.sameSizeVariants.filter(
              (v) => v.id !== absorbProd.id && variantsColorFamilyMatch(absorbProd, v)
            )
          : [];
        const szLabel = absorbProd ? formatSizeForLink(getProductSizeCode(absorbProd)) : '';
        return (
        <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col shadow-2xl">
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-2 shrink-0">
              <div className="min-w-0">
                <h3 className="text-white font-bold text-base">Unificar variantes</h3>
                <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                  Mismo talle{szLabel ? ` (${szLabel})` : ''}. Elegí qué variante se absorbe (se elimina) y cuál queda; los colores tienen que coincidir por nombre o código.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (variantUnifySaving) return;
                  setVariantUnifyModal(null);
                  setVariantUnifyAbsorbId(null);
                  setVariantUnifyKeeperId(null);
                }}
                className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 shrink-0"
                aria-label="Cerrar"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                  Variante a absorber (se elimina)
                </label>
                <select
                  className="w-full rounded-xl border border-slate-600 bg-slate-800 text-slate-100 text-sm px-3 py-2.5"
                  value={variantUnifyAbsorbId ?? ''}
                  onChange={(e) => handleVariantUnifyAbsorbChange(e.target.value)}
                  disabled={variantUnifySaving}
                >
                  {variantUnifyModal.sameSizeVariants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {(v.sku || v.id).slice(0, 48)} — {v.color || getProductColorCode(v) || '?'} — stock {v.stock ?? 0}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                  Variante destino (queda)
                </label>
                <select
                  className="w-full rounded-xl border border-slate-600 bg-slate-800 text-slate-100 text-sm px-3 py-2.5 disabled:opacity-50"
                  value={variantUnifyKeeperId ?? ''}
                  onChange={(e) => setVariantUnifyKeeperId(e.target.value || null)}
                  disabled={variantUnifySaving || keeperOptions.length === 0}
                >
                  {keeperOptions.length === 0 ? (
                    <option value="">Sin par compatible para este color</option>
                  ) : (
                    keeperOptions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {(v.sku || v.id).slice(0, 48)} — {v.color || getProductColorCode(v) || '?'} — stock {v.stock ?? 0}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>
            <div className="p-4 border-t border-slate-700 flex flex-col sm:flex-row gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setVariantUnifyModal(null);
                  setVariantUnifyAbsorbId(null);
                  setVariantUnifyKeeperId(null);
                }}
                disabled={variantUnifySaving}
                className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmVariantUnify}
                disabled={
                  variantUnifySaving ||
                  !variantUnifyKeeperId ||
                  !variantUnifyAbsorbId ||
                  variantUnifyKeeperId === variantUnifyAbsorbId ||
                  keeperOptions.length === 0
                }
                className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {variantUnifySaving ? <Loader2 size={16} className="animate-spin" /> : <GitMerge size={16} />}
                Confirmar
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* CREATE PRODUCT MODAL */}
      {isCreating && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
           <div className="bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-800 w-full sm:max-w-4xl max-h-[92vh] sm:max-h-[90vh] flex flex-col shadow-2xl animate-fade-in-up flex-1 sm:flex-initial pt-[env(safe-area-inset-top)] sm:pt-0">
              {/* Modal Header */}
              <div className="p-4 sm:p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/50 rounded-t-3xl shrink-0">
                 <div className="flex items-center gap-3 min-w-0">
                    <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-900/20 shrink-0">
                       <Layers size={24} />
                    </div>
                    <div className="min-w-0">
                       <h3 className="text-lg sm:text-xl font-bold text-white truncate">
                         {isVariantMode ? 'Agregar Variantes' : 'Alta Masiva de Productos'}
                       </h3>
                       <p className="text-xs text-slate-400 truncate">
                         {isVariantMode ? `Sumando talles/colores a ${newProductName}` : 'Generador de matriz de variantes (SKUs)'}
                       </p>
                    </div>
                 </div>
                 <button onClick={() => setIsCreating(false)} className="text-slate-400 hover:text-white bg-slate-800 p-2.5 min-w-[44px] min-h-[44px] rounded-full hover:bg-slate-700 transition touch-manipulation shrink-0" aria-label="Cerrar">
                    <X size={24} />
                 </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-8 min-h-0 touch-scroll">
                 {/* 1. Base Information */}
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1 ml-1"><Tag size={12}/> SKU Base (Prefijo)</label>
                       <input 
                         type="text" 
                         value={newBaseSku}
                         onChange={(e) => setNewBaseSku(e.target.value.toUpperCase())}
                         placeholder="Ej: LP-1001"
                         disabled={isVariantMode}
                         className={`w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white font-mono focus:border-blue-500 outline-none uppercase ${isVariantMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                       />
                       <p className="text-[10px] text-slate-500 ml-1">El SKU de cada variante se genera automáticamente: base + código talle + código color (ej: 0055402-250-099)</p>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1 ml-1"><Box size={12}/> Nombre del Modelo</label>
                       <input 
                         type="text" 
                         value={newProductName}
                         onChange={(e) => setNewProductName(e.target.value)}
                         placeholder="Ej: Boxer Seamless"
                         disabled={isVariantMode}
                         className={`w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white focus:border-blue-500 outline-none ${isVariantMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                       />
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1 ml-1"><Layers size={12}/> Categoría</label>
                       <input 
                         type="text" 
                         value={newCategory}
                         onChange={(e) => setNewCategory(e.target.value)}
                         placeholder="Ej: Underwear, Sport, Socks"
                         list="category-suggestions"
                         disabled={isVariantMode}
                         className={`w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white focus:border-blue-500 outline-none ${isVariantMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                       />
                       <datalist id="category-suggestions">
                          {categories.map(c => <option key={c} value={c} />)}
                       </datalist>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1 ml-1"><DollarSign size={12}/> Precio Unitario</label>
                       <input 
                         type="number" 
                         value={newPrice}
                         onChange={(e) => setNewPrice(e.target.value)}
                         placeholder="0.00"
                         className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-white focus:border-blue-500 outline-none font-mono"
                       />
                    </div>
                 </div>

                 {/* 2. Variants Matrix Selection */}
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Sizes */}
                    <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-800">
                       <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Ruler size={16} className="text-blue-400"/> Selección de Talles</h4>
                       <div className="flex flex-wrap gap-2">
                          {uniqueSizesForModal.map(size => {
                             const sizeKey = (size as any).code ?? size.name ?? '';
                             const isSelected = selectedSizes.includes(sizeKey);
                             return (
                               <button 
                                 key={size.id}
                                 onClick={() => toggleSizeSelection(sizeKey)}
                                 className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${
                                   isSelected 
                                   ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/40' 
                                   : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500'
                                 }`}
                               >
                                 {(labelTalle((size as any).code ?? size.name) || (size.name))}
                               </button>
                             );
                          })}
                          {uniqueSizesForModal.length === 0 && <p className="text-xs text-slate-500">No hay talles configurados.</p>}
                       </div>
                    </div>

                    {/* Colors */}
                    <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-800">
                       <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Palette size={16} className="text-pink-400"/> Selección de Colores</h4>
                       <div className="flex flex-wrap gap-2">
                          {availableColors.map(color => {
                             const code = (color as any).code != null ? String((color as any).code).trim() : '';
                             const label = code ? `${code} - ${color.name || ''}` : (color.name || '');
                             const isSelected = selectedColorIds.includes(color.id);
                             return (
                               <button 
                                 key={color.id}
                                 onClick={() => toggleColorSelection(color.id)}
                                 className={`pl-3 pr-4 py-2 rounded-lg text-sm font-bold transition-all border flex items-center gap-2 ${
                                   isSelected 
                                   ? 'bg-pink-600 text-white border-pink-500 shadow-lg shadow-pink-900/40' 
                                   : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500'
                                 }`}
                               >
                                 <div className="w-3 h-3 rounded-full border border-white/20" style={{background: color.value}}></div>
                                 {label}
                               </button>
                             );
                          })}
                          {availableColors.length === 0 && <p className="text-xs text-slate-500">No hay colores configurados.</p>}
                       </div>
                    </div>
                 </div>

                 {/* 3. Initial Stock */}
                 <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
                     <div className="flex-1">
                        <h4 className="text-sm font-bold text-white mb-1">Stock Inicial por Variante</h4>
                        <p className="text-xs text-slate-500">Este valor se aplicará a todas las combinaciones generadas.</p>
                     </div>
                     <div className="flex items-center gap-3">
                        <button onClick={() => setInitialStock(prev => Math.max(0, parseInt(prev) - 10).toString())} className="p-3 bg-slate-900 rounded-xl text-slate-400 hover:text-white"><Minus size={16}/></button>
                        <input 
                           type="number" 
                           value={initialStock}
                           onChange={(e) => setInitialStock(e.target.value)}
                           className="w-24 bg-slate-950 border border-slate-700 rounded-xl p-3 text-center text-white font-mono font-bold text-lg outline-none focus:border-blue-500"
                        />
                        <button onClick={() => setInitialStock(prev => (parseInt(prev) + 10).toString())} className="p-3 bg-slate-900 rounded-xl text-slate-400 hover:text-white"><Plus size={16}/></button>
                     </div>
                 </div>
              </div>

              {/* Modal Footer */}
              <div className="p-6 border-t border-slate-800 bg-slate-900 rounded-b-3xl flex justify-between items-center">
                 <div className="text-xs text-slate-400">
                    Resumen: <strong className="text-white text-lg ml-1">{selectedSizes.length * selectedColorIds.length}</strong> variantes serán creadas.
                 </div>
                 <div className="flex gap-3">
                    <button 
                      onClick={() => setIsCreating(false)}
                      className="px-6 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); handleCreateBatch(); }}
                      disabled={!newProductName?.trim() || !newBaseSku?.trim() || selectedSizes.length === 0 || selectedColorIds.length === 0}
                      className="px-8 py-3 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-blue-900/40 active:scale-95 transition-all flex items-center gap-2"
                    >
                      <CheckCircle2 size={20} />
                      {isVariantMode ? 'Agregar Variantes' : 'Generar Inventario'}
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* EDIT PRODUCT MODAL */}
      {editingProductId && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-700 w-full sm:max-w-lg flex flex-col shadow-2xl animate-fade-in-up max-h-[92vh] overflow-hidden flex-1 sm:flex-initial pt-[env(safe-area-inset-top)] sm:pt-0">
            <div className="shrink-0 p-4 sm:p-5 border-b border-slate-700 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit2 size={20} className="text-amber-400" />
                Editar artículo
              </h3>
              <button onClick={() => { setEditingProductId(null); setEditingProductGroupKey(null); }} className="p-2.5 min-w-[44px] min-h-[44px] rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition touch-manipulation shrink-0" aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 min-h-0">
              {loadingEditProduct ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={32} className="text-amber-400 animate-spin" />
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">SKU</label>
                    <input
                      type="text"
                      value={editProductForm.sku}
                      onChange={(e) => setEditProductForm(f => ({ ...f, sku: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-amber-500 outline-none font-mono"
                      placeholder="Código del artículo"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Nombre</label>
                    <input
                      type="text"
                      value={editProductForm.name}
                      onChange={(e) => setEditProductForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-amber-500 outline-none"
                      placeholder="Nombre del artículo"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Categoría</label>
                    <input
                      type="text"
                      value={editProductForm.category}
                      onChange={(e) => setEditProductForm(f => ({ ...f, category: e.target.value }))}
                      list="edit-category-list"
                      className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-amber-500 outline-none"
                      placeholder="General"
                    />
                    <datalist id="edit-category-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Precio base</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={editProductForm.base_price}
                      onChange={(e) => setEditProductForm(f => ({ ...f, base_price: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-amber-500 outline-none"
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Descripción (opcional)</label>
                    <textarea
                      value={editProductForm.description}
                      onChange={(e) => setEditProductForm(f => ({ ...f, description: e.target.value }))}
                      rows={3}
                      className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-amber-500 outline-none resize-none"
                      placeholder="Descripción del artículo"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Pack ML (x)</label>
                      <input
                        type="number"
                        min={1}
                        value={editProductForm.mercadoLibrePackSize}
                        onChange={(e) => setEditProductForm(f => ({ ...f, mercadoLibrePackSize: e.target.value }))}
                        className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-amber-500 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Pack TN (x)</label>
                      <input
                        type="number"
                        min={1}
                        value={editProductForm.tiendaNubePackSize}
                        onChange={(e) => setEditProductForm(f => ({ ...f, tiendaNubePackSize: e.target.value }))}
                        className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-amber-500 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Pack mayorista (x)</label>
                      <input
                        type="number"
                        min={1}
                        value={editProductForm.mayoristaPackSize}
                        onChange={(e) => setEditProductForm(f => ({ ...f, mayoristaPackSize: e.target.value }))}
                        className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-amber-500 outline-none"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500">Pack ML/TN: unidades por caja al publicar (stock enviado = stock ÷ pack). Pack mayorista: si &gt; 1, en pedidos podés vender por unidad o por pack; el stock se descuenta en unidades.</p>
                </>
              )}
            </div>
            {!loadingEditProduct && (
              <div className="shrink-0 p-4 border-t border-slate-700 flex gap-3 justify-end">
                <button onClick={() => { setEditingProductId(null); setEditingProductGroupKey(null); }} className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-medium">
                  Cancelar
                </button>
                <button onClick={handleSaveEditProduct} disabled={savingEditProduct} className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold disabled:opacity-50 flex items-center gap-2">
                  {savingEditProduct ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                  Guardar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* EDIT VARIANT MODAL */}
      {editingVariantId && (
        <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-700 w-full sm:max-w-lg flex flex-col shadow-2xl animate-fade-in-up max-h-[100dvh] sm:max-h-[92vh] overflow-hidden flex-1 sm:flex-initial pt-[env(safe-area-inset-top)] sm:pt-0">
            <div className="shrink-0 p-4 sm:p-5 border-b border-slate-700 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Tag size={20} className="text-amber-400" />
                Editar variante
              </h3>
              <button onClick={() => setEditingVariantId(null)} className="p-2.5 min-w-[44px] min-h-[44px] rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition touch-manipulation shrink-0" aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 min-h-0">
              {loadingEditVariant ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={32} className="text-amber-400 animate-spin" />
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">SKU (código interno)</label>
                    <input
                      type="text"
                      value={editVariantForm.sku}
                      onChange={(e) => setEditVariantForm(f => ({ ...f, sku: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-amber-500 outline-none font-mono"
                      placeholder="Ej. 0055402-250-099"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">SKU externo (debe coincidir con ML / TN)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editVariantForm.externalSku}
                        onChange={(e) => setEditVariantForm(f => ({ ...f, externalSku: e.target.value }))}
                        className="flex-1 min-w-0 bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:border-amber-500 outline-none font-mono"
                        placeholder="Mismo que interno o el que tiene en ML/TN"
                      />
                      <button
                        type="button"
                        onClick={() => setEditVariantForm(f => ({ ...f, externalSku: f.sku }))}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 hover:text-white border border-slate-600 transition-colors font-medium text-xs whitespace-nowrap"
                        title="Usar el mismo código que el interno"
                      >
                        <Copy size={16} />
                        Copiar interno
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        type="button"
                        onClick={handleFetchExternalSkuFromMl}
                        disabled={!editVariantLinkIds.mlItemId || fetchingExternalSku !== null}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-900/40 hover:bg-amber-800/50 text-amber-200 border border-amber-700/50 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Rellenar con el SKU que tiene en Mercado Libre"
                      >
                        {fetchingExternalSku === 'ml' ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                        Traer de Mercado Libre
                      </button>
                      <button
                        type="button"
                        onClick={handleFetchExternalSkuFromTn}
                        disabled={!editVariantLinkIds.tnProductId || fetchingExternalSku !== null}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900/40 hover:bg-blue-800/50 text-blue-200 border border-blue-700/50 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Rellenar con el SKU que tiene en Tienda Nube"
                      >
                        {fetchingExternalSku === 'tn' ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                        Traer de Tienda Nube
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            {!loadingEditVariant && (
              <div className="shrink-0 p-4 border-t border-slate-700 flex gap-3 justify-end pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button onClick={() => setEditingVariantId(null)} className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-medium">
                  Cancelar
                </button>
                <button onClick={handleSaveEditVariant} disabled={savingEditVariant} className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold disabled:opacity-50 flex items-center gap-2">
                  {savingEditVariant ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                  Guardar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Asignar a Despacho */}
      {showDespachoModal && selectedProductForDespacho && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
           <div className="bg-slate-900 rounded-3xl w-full max-w-md border border-slate-800 shadow-2xl overflow-hidden">
              <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/50 rounded-t-3xl">
                 <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Ship size={20} className="text-amber-400" />
                    Asignar a Despacho
                 </h3>
                 <button onClick={() => setShowDespachoModal(false)} className="text-slate-400 hover:text-white bg-slate-800 p-2 rounded-full hover:bg-slate-700 transition">
                    <X size={20} />
                 </button>
              </div>
              <div className="p-6 space-y-4">
                 <div className="bg-amber-900/10 border border-amber-900/30 p-4 rounded-xl">
                    <p className="text-sm text-amber-200 font-medium">{selectedProductForDespacho.name}</p>
                    <p className="text-xs text-slate-400 mt-1 font-mono">{selectedProductForDespacho.sku}</p>
                 </div>
                 
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Despacho</label>
                    <select
                      value={selectedDespachoId}
                      onChange={(e) => setSelectedDespachoId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none text-sm"
                    >
                      <option value="">Seleccionar despacho...</option>
                      {despachosList.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.numero_despacho} - {d.pais_origen} ({d.estado})
                        </option>
                      ))}
                    </select>
                 </div>

                 <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={despachoIncrementStock}
                      onChange={(e) => setDespachoIncrementStock(e.target.checked)}
                      className="mt-1 rounded border-slate-600 text-amber-500 focus:ring-amber-500 shrink-0"
                    />
                    <span className="text-xs text-slate-400 leading-snug">
                      <strong className="text-slate-300">Sumar al stock del depósito</strong> esta cantidad (mercadería que ingresa). Desmarcá si el stock ya lo cargaste por otro medio (ej. importación Tango) y solo querés el registro del despacho.
                    </span>
                 </label>

                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Cantidad</label>
                       <input 
                         type="number" 
                         value={despachoCantidad}
                         onChange={(e) => setDespachoCantidad(e.target.value)}
                         placeholder="0"
                         className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none text-sm"
                       />
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Costo Unit. (USD)</label>
                       <input 
                         type="number" 
                         step="0.01"
                         value={despachoCosto}
                         onChange={(e) => setDespachoCosto(e.target.value)}
                         placeholder="0.00"
                         className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none text-sm"
                       />
                    </div>
                 </div>
              </div>
              <div className="p-6 border-t border-slate-800 bg-slate-900 rounded-b-3xl flex justify-end gap-3">
                 <button 
                   onClick={() => setShowDespachoModal(false)}
                   className="px-4 py-2 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition text-sm"
                 >
                   Cancelar
                 </button>
                 <button 
                   onClick={handleAssignDespacho}
                   disabled={savingDespacho || !selectedDespachoId}
                   className="px-6 py-2 rounded-xl font-bold bg-amber-600 text-white hover:bg-amber-500 shadow-lg shadow-amber-900/20 active:scale-95 transition-all flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                   {savingDespacho ? (
                     <>
                       <RefreshCw size={16} className="animate-spin" />
                       Guardando...
                     </>
                   ) : (
                     <>
                       <CheckCircle2 size={16} />
                       Asignar
                     </>
                   )}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Modal resultado sincronización masiva */}
      {showSyncResultModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={() => { if (!syncLoading) setShowSyncResultModal(false); }}>
          <div className="bg-slate-900 rounded-2xl w-full max-w-md border border-slate-800 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">{syncResult?.platform || 'Sincronizar stock'}</h3>
              <button type="button" onClick={() => { if (!syncLoading) setShowSyncResultModal(false); }} className="text-slate-400 hover:text-white p-2 rounded-lg" aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {syncLoading && (
                <div className="py-6 flex flex-col items-center gap-3">
                  <Loader2 className="animate-spin text-blue-500" size={32} />
                  <p className="text-sm text-slate-300 font-medium">
                    {syncLoading === 'fromML' ? 'Importando stock desde Mercado Libre…' : syncLoading === 'both' ? 'Enviando tu stock a Tienda Nube y Mercado Libre…' : syncLoading === 'tn' ? 'Enviando a Tienda Nube…' : 'Enviando a Mercado Libre…'}
                  </p>
                  <p className="text-xs text-slate-500">Puede tardar unos minutos</p>
                </div>
              )}
              {syncResult && !syncLoading && (
                <>
                  <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-bold">Actualizadas</p>
                      <p className="text-xl font-bold text-green-400">{syncResult.updated}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-bold">Errores</p>
                      <p className="text-xl font-bold text-red-400">{syncResult.errors}</p>
                    </div>
                  </div>
                  {syncResult.fromML && (
                    <div className="space-y-2">
                      <div className="bg-amber-900/20 border border-amber-700/40 p-3 rounded-xl text-xs text-amber-200/90 space-y-2">
                        <p className="text-[10px] font-bold text-amber-400/90 uppercase mb-1">Flujo del stock</p>
                        <div className="grid grid-cols-2 gap-2">
                          <span>Mercado Libre → LupoHub:</span><span>{syncResult.fromML.imported} OK, {syncResult.fromML.errorsFromML} errores</span>
                          <span>LupoHub → Tienda Nube:</span><span>{syncResult.fromML.sentToTN} OK, {syncResult.fromML.errorsToTN} errores</span>
                        </div>
                        <p className="text-slate-500 pt-1">Tu stock en LupoHub es la fuente de verdad. Este flujo es opcional: solo usalo si quisiste traer una vez el stock desde ML.</p>
                      </div>
                      <div className="bg-blue-900/30 border border-blue-700/50 p-3 rounded-xl text-xs text-blue-200/90">
                        <p className="font-semibold text-blue-300 mb-1">¿Por qué el resto sigue en 0?</p>
                        <p className="text-slate-400">Solo se actualiza el stock de las <strong className="text-slate-300">variantes que ya vinculaste</strong> a una publicación de Mercado Libre. Las que no están vinculadas no se tocan. Para enviar tu stock a ML: usá <strong className="text-slate-300">Enviar mi stock a Mercado Libre</strong> en el menú de sincronización.</p>
                      </div>
                    </div>
                  )}
                  {syncResult.logs && syncResult.logs.length > 0 && (
                    <div className="bg-black/80 p-3 rounded-lg border border-slate-800 max-h-48 overflow-y-auto font-mono text-[10px]">
                      {syncResult.logs.slice(0, 50).map((line, i) => (
                        <div key={i} className={line.includes('[OK]') || line.includes('Updated') ? 'text-green-400' : line.includes('[ERROR]') || line.includes('Error') ? 'text-red-400' : 'text-slate-400'}>{line}</div>
                      ))}
                      {syncResult.logs.length > 50 && <div className="text-slate-500">… y {syncResult.logs.length - 50} líneas más</div>}
                    </div>
                  )}
                  {syncResult.errors > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const p = syncResult.platform.includes('Tienda') && syncResult.platform.includes('Mercado')
                          ? 'both'
                          : syncResult.platform.includes('Mercado')
                            ? 'ml'
                            : syncResult.platform.includes('Tienda')
                              ? 'tn'
                              : 'both';
                        void api.downloadStockSyncFailuresReport(p as 'ml' | 'tn' | 'both').then(
                          () => showToast('success', 'Excel descargado'),
                          () => showToast('error', 'No se pudo descargar el Excel')
                        );
                      }}
                      className="w-full py-2.5 rounded-xl font-semibold bg-emerald-700 hover:bg-emerald-600 text-white text-sm flex items-center justify-center gap-2"
                    >
                      <Download size={16} />
                      Descargar Excel de no actualizados
                    </button>
                  )}
                </>
              )}
            </div>
            {!syncLoading && (
              <div className="p-4 border-t border-slate-800">
                <button type="button" onClick={() => setShowSyncResultModal(false)} className="w-full py-2.5 rounded-xl font-semibold bg-slate-700 text-white hover:bg-slate-600 text-sm">
                  Cerrar
                </button>
              </div>
            )}
          </div>
        </div>
        )}
          </>
        )}
      />

      <PublicationStockBundles
        open={showPublicationBundles}
        onClose={() => setShowPublicationBundles(false)}
        products={products}
        role={role}
        showToast={showToast}
      />
    </div>
  );
  return result;
};

export default Inventory;
