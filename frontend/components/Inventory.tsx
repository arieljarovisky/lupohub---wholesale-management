import React, { useState, useEffect, useRef, useMemo, useCallback, startTransition } from 'react';
import { createPortal } from 'react-dom';
import { Search, Filter, Plus, Cloud, Zap, Package, RefreshCw, AlertTriangle, Minus, CheckCircle2, XCircle, Edit2, Check, ChevronDown, Box, X, Layers, Tag, DollarSign, Palette, Ruler, PlusCircle, Download, Link, Ship, Info, Upload, Lock, Trash2, Loader2, MoreVertical, EyeOff, Copy, History, GitMerge } from 'lucide-react';
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

const Inventory: React.FC<InventoryProps> = ({ products, attributes = [], role, onCreateProducts, onUpdateStock, onImportComplete }) => {
  const { showToast, showConfirm } = useNotification();
  const stored = getStoredInventoryState();
  const [searchTerm, setSearchTerm] = useState(stored.search);
  const [hideZeroStock, setHideZeroStock] = useState(stored.hideZeroStock ?? false);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const [syncLoading, setSyncLoading] = useState<'tn' | 'ml' | 'both' | 'fromML' | null>(null);
  const [syncResult, setSyncResult] = useState<{ platform: string; updated: number; errors: number; logs: string[]; fromML?: { imported: number; errorsFromML: number; sentToTN: number; errorsToTN: number } } | null>(null);
  const [showSyncResultModal, setShowSyncResultModal] = useState(false);
  const syncMenuRef = useRef<HTMLDivElement>(null);
  const [syncDropdownPosition, setSyncDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [topDotsOpen, setTopDotsOpen] = useState(false);
  const topDotsRef = useRef<HTMLDivElement>(null);
  const [topDotsPosition, setTopDotsPosition] = useState<{ top: number; left: number } | null>(null);
  const [cardDotsOpenKey, setCardDotsOpenKey] = useState<string | null>(null);
  const cardDotsRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** Para hacer scroll al expandir un artículo y que se vea el “Cargando variantes…”. */
  const groupCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** Stock al abrir el editor numérico (para no reenviar si no hubo cambio y para revertir si falla el API). */
  const baselineManualStockRef = useRef<Record<string, number>>({});
  const [cardDotsPosition, setCardDotsPosition] = useState<{ top: number; left: number } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [editingStockId, setEditingStockId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const [selectionModeEnabled, setSelectionModeEnabled] = useState(false);
  const [syncSelectedLoading, setSyncSelectedLoading] = useState<'tn' | 'ml' | null>(null);
  
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

  // Linking Modal State
  const [linkingVariant, setLinkingVariant] = useState<Product | null>(null);
  const [linkTnId, setLinkTnId] = useState('');
  const [linkTnVariantId, setLinkTnVariantId] = useState('');
  const [linkMlId, setLinkMlId] = useState('');
  const [linkMlVariantId, setLinkMlVariantId] = useState('');
  const [linkSaveStockFromML, setLinkSaveStockFromML] = useState<number | null>(null);
  const [linkProduct, setLinkProduct] = useState<{ id: string; name?: string; sku?: string; price?: number; category?: string; description?: string } | null>(null);
  const [linkPackMl, setLinkPackMl] = useState(1);
  const [linkPackTn, setLinkPackTn] = useState(1);
  const [linkExternalSku, setLinkExternalSku] = useState('');
  const [linkMlVariations, setLinkMlVariations] = useState<{ variationId: number | string; sku: string; color: string; size: string; stock: number }[] | null>(null);
  const [linkTnVariants, setLinkTnVariants] = useState<{ variantId: number | string; sku: string; color: string; size: string; stock: number }[] | null>(null);
  const [loadingMlVariations, setLoadingMlVariations] = useState(false);
  const [loadingTnVariants, setLoadingTnVariants] = useState(false);
  const [variantPublications, setVariantPublications] = useState<Array<{ id: string; platform: string; external_product_id: string; external_variant_id: string; pack_size: number }>>([]);
  const [addPubPlatform, setAddPubPlatform] = useState<'mercadolibre' | 'tiendanube'>('mercadolibre');
  const [addPubProductId, setAddPubProductId] = useState('');
  const [addPubVariantId, setAddPubVariantId] = useState('');
  const [addPubPackSize, setAddPubPackSize] = useState(1);
  const [addPubSaving, setAddPubSaving] = useState(false);
  const [showAddPublicationForm, setShowAddPublicationForm] = useState(false);

  // Vincular grupo en lote
  const [showBulkLinkModal, setShowBulkLinkModal] = useState(false);
  const [bulkLinkGroupKey, setBulkLinkGroupKey] = useState<string | null>(null);
  const [bulkLinkProductId, setBulkLinkProductId] = useState<string | null>(null);
  const [bulkLinkVariants, setBulkLinkVariants] = useState<Array<{ variantId: string; sku: string; size: string; color: string; externalIds?: any }>>([]);
  const [bulkLinkMlId, setBulkLinkMlId] = useState('');
  const [bulkLinkTnId, setBulkLinkTnId] = useState('');
  const [bulkLinkMlVariations, setBulkLinkMlVariations] = useState<{ variationId: number | string; sku: string; color: string; size: string }[]>([]);
  const [bulkLinkTnVariants, setBulkLinkTnVariants] = useState<{ variantId: number | string; sku: string; color: string; size: string }[]>([]);
  const [bulkLinkLoading, setBulkLinkLoading] = useState(false);
  const [bulkLinkAssignments, setBulkLinkAssignments] = useState<Record<string, { ml?: string; tn?: string }>>({});
  const [bulkLinkSkuEdits, setBulkLinkSkuEdits] = useState<Record<string, string>>({});
  const [bulkLinkSaving, setBulkLinkSaving] = useState(false);
  const [bulkLinkMlSearch, setBulkLinkMlSearch] = useState('');
  const [bulkLinkTnSearch, setBulkLinkTnSearch] = useState('');

  /** Fusión manual: varios productos padre → uno (stock y variantes). */
  const [showMergeManualModal, setShowMergeManualModal] = useState(false);
  const [mergePickSearch, setMergePickSearch] = useState('');
  const [mergePickLoading, setMergePickLoading] = useState(false);
  const [mergePickResults, setMergePickResults] = useState<Array<{ productId: string; baseSku: string; name: string }>>([]);
  const [mergeSelected, setMergeSelected] = useState<Array<{ productId: string; baseSku: string; name: string }>>([]);
  const [mergeKeeperProductId, setMergeKeeperProductId] = useState<string | null>(null);
  const [mergeSaving, setMergeSaving] = useState(false);
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
      filterColor
    });
  }, [searchTerm, currentPage, inventorySubView, hideZeroStock, filterSize, filterCategory, filterColor]);

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
        const variants = await api.getVariantsBySku(groupName);
        if (cancelled) return;
        const mapped: Product[] = variants.map((v) => ({
          id: v.variantId,
          sku: `${groupName}-${v.sizeCode}-${v.colorCode}`,
          name: groupedProducts[groupName]?.[0]?.name || '',
          category: groupedProducts[groupName]?.[0]?.category || 'General',
          price: groupedProducts[groupName]?.[0]?.price || 0,
          description: '',
          size: v.sizeCode,
          color: v.colorName,
          colorCode: v.colorCode,
          stock: v.stock,
          integrations: { 
            local: true, 
            tiendaNube: isVariantLinkedToTiendaNube(v.externalIds),
            mercadoLibre: isVariantLinkedToMercadoLibre(v.externalIds)
          },
          externalIds: v.externalIds
        }));
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
    setSyncMenuOpen(false);
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
    setSyncMenuOpen(false);
    setSyncLoading('both');
    setSyncResult(null);
    setShowSyncResultModal(true);
    try {
      const [tnRes, mlRes] = await Promise.all([
        api.syncStockToTiendaNube(),
        api.syncStockToMercadoLibre()
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
      if (onImportComplete && (totalUpdated > 0 || totalErrors > 0)) onImportComplete();
      if (totalErrors === 0 && totalUpdated > 0) showToast('success', `Sincronizado: ${totalUpdated} variantes a TN y ML.`);
      else if (totalErrors > 0) showToast('warning', `Sincronizado con errores: ${totalUpdated} OK, ${totalErrors} fallos. Revisá el detalle.`);
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
    setSyncMenuOpen(false);
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
    setSyncMenuOpen(false);
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

  useEffect(() => {
    if (!syncMenuOpen) return;
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (syncMenuRef.current?.contains(target)) return;
      if ((target as Element).closest?.('[data-sync-dropdown]')) return;
      setSyncMenuOpen(false);
    };
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, [syncMenuOpen]);

  // Posicionar el dropdown del sync con posición fija para que no genere scroll en el contenedor
  useEffect(() => {
    if (!syncMenuOpen || !syncMenuRef.current) {
      setSyncDropdownPosition(null);
      return;
    }
    const update = () => {
      if (syncMenuRef.current) {
        const rect = syncMenuRef.current.getBoundingClientRect();
        setSyncDropdownPosition({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 240) });
      }
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [syncMenuOpen]);

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
        setTopDotsPosition({ top: rect.bottom + 4, left: rect.right - 200 });
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

  const adjustStock = (productId: string, currentStock: number, delta: number) => {
    if (!onUpdateStock) return;
    const newStock = Math.max(0, currentStock + delta);
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
    Promise.resolve(onUpdateStock(productId, newStock)).catch(() => {
      setLoadedVariants(prev => {
        const next = { ...prev };
        for (const gk of Object.keys(next)) {
          const idx = next[gk].findIndex((p: any) => p.id === productId);
          if (idx >= 0) {
            next[gk] = [...next[gk]];
            (next[gk][idx] as any).stock = currentStock;
            break;
          }
        }
        return next;
      });
      patchServerItemStock(productId, currentStock);
    });
    refreshExternalStocksAfterSync(productId);
  };

  /** Solo actualiza la UI mientras editás el número (sin API). */
  const onManualStockInputChange = (productId: string, value: string) => {
    const v = value.trim();
    const n = parseInt(v, 10);
    const newStock = v === '' ? 0 : (isNaN(n) ? 0 : Math.max(0, n));
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
  };

  /** Guarda stock manual al salir del input o al confirmar (evita doble envío). */
  const commitManualStock = (productId: string, value: string) => {
    if (!onUpdateStock) return;
    const baseline = baselineManualStockRef.current[productId] ?? 0;
    const v = value.trim();
    const n = parseInt(v, 10);
    const newStock = v === '' || isNaN(n) ? 0 : Math.max(0, n);
    if (newStock === baseline) return;

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
    Promise.resolve(onUpdateStock(productId, newStock))
      .then(() => {
        baselineManualStockRef.current[productId] = newStock;
      })
      .catch(() => {
        setLoadedVariants(prev => {
          const next = { ...prev };
          for (const gk of Object.keys(next)) {
            const idx = next[gk].findIndex((p: any) => p.id === productId);
            if (idx >= 0) {
              next[gk] = [...next[gk]];
              (next[gk][idx] as any).stock = baseline;
              break;
            }
          }
          return next;
        });
        patchServerItemStock(productId, baseline);
      });
    refreshExternalStocksAfterSync(productId);
  };

  const [loadedVariants, setLoadedVariants] = useState<Record<string, Product[]>>({});
  const [loadingVariantsByGroup, setLoadingVariantsByGroup] = useState<Record<string, boolean>>({});

  const getGroupRawVariants = (groupKey: string, groupVariants: Product[]) => {
    const lv = loadedVariants[groupKey];
    return (lv && lv.length > 0) ? lv : groupVariants;
  };
  const getGroupFilteredVariants = (groupKey: string, groupVariants: Product[]) => {
    const raw = getGroupRawVariants(groupKey, groupVariants);
    const byColor = filterColor === 'ALL' ? raw : raw.filter(p => checkColorMatch(p, filterColor));
    if (filterSync === 'MISMATCH') {
      return byColor.filter(p => {
        const ext = extStocksForMismatchFilter[p.id];
        const ml = ext?.stockML;
        const tn = ext?.stockTN;
        // Solo excluir cuando ya tenemos ambos stocks y coinciden. Si falta ML o TN (carga,
        // error de API o vínculo incompleto) no ocultamos la fila — antes la lista quedaba vacía.
        if (ml !== undefined && tn !== undefined) return ml !== tn;
        return true;
      });
    }
    return byColor;
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
      const list = filterColor === 'ALL' ? loaded : loaded.filter(p => checkColorMatch(p, filterColor));
      return list.reduce((sum, p) => sum + Number((p as any).stock ?? (p as any).stock_total ?? 0), 0);
    }
    return filterColor === 'ALL' ? totalStock : getGroupDisplayStock(groupKey, groupVariants);
  };
  const getGroupHasLowStock = (groupKey: string, groupVariants: Product[]) => {
    const loaded = loadedVariants[groupKey];
    if (loaded?.length > 0) {
      const list = filterColor === 'ALL' ? loaded : loaded.filter(p => checkColorMatch(p, filterColor));
      return list.some(p => {
        const val = Number((p as any).stock ?? (p as any).stock_total ?? 0);
        return val > 0 && val < 20;
      });
    }
    const variants = getGroupFilteredVariants(groupKey, groupVariants);
    return variants.some(p => {
      const val = (p as any).stock_total ?? (p as any).stock ?? 0;
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
      api.getVariantsBySku(groupName).then(variants => {
        const mapped: Product[] = variants.map((v) => ({
          id: v.variantId,
          sku: `${groupName}-${v.sizeCode}-${v.colorCode}`,
          name: groupedProducts[groupName]?.[0]?.name || '',
          category: groupedProducts[groupName]?.[0]?.category || 'General',
          price: groupedProducts[groupName]?.[0]?.price || 0,
          description: '',
          size: v.sizeCode,
          color: v.colorName,
          colorCode: v.colorCode,
          stock: v.stock,
          integrations: { 
            local: true, 
            tiendaNube: isVariantLinkedToTiendaNube(v.externalIds),
            mercadoLibre: isVariantLinkedToMercadoLibre(v.externalIds)
          },
          externalIds: v.externalIds
        }));
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

  const handleLoadMlVariations = async () => {
    const id = normalizeMercadoLibreItemId(linkMlId);
    if (!id) return;
    setLoadingMlVariations(true);
    setLinkMlVariations(null);
    try {
      const res = await api.getMercadoLibreItemVariations(id);
      setLinkMlVariations(res.variations || []);
      const variantFromUrl = extractMercadoLibreVariationIdFromUrl(linkMlId);
      const skuToMatch = (linkExternalSku || linkingVariant?.sku || '').toString().trim();
      const match = (res.variations || []).find(
        (v) => v.sku && skuToMatch && v.sku.trim() === skuToMatch
      );
      if (variantFromUrl && (res.variations || []).some((v) => String(v.variationId) === variantFromUrl)) {
        setLinkMlVariantId(variantFromUrl);
      } else if (match) setLinkMlVariantId(String(match.variationId));
      else if (res.variations?.length === 1) setLinkMlVariantId(String(res.variations[0].variationId));
    } catch (e) {
      console.error(e);
      showToast('error', 'No se pudieron cargar las variaciones. Revisá que el ID de publicación sea correcto.');
    } finally {
      setLoadingMlVariations(false);
    }
  };

  const handleLoadTnVariants = async () => {
    const id = normalizeTiendaNubeProductId(linkTnId);
    if (!id || !/^\d+$/.test(id)) {
      showToast('error', 'No se pudo obtener el ID del producto. Pegá el link de la publicación o el número de producto TN.');
      return;
    }
    setLoadingTnVariants(true);
    setLinkTnVariants(null);
    try {
      const res = await api.getTiendaNubeProductVariants(id);
      setLinkTnVariants(res.variants || []);
      const variantFromUrl = extractTiendaNubeVariantFromUrl(linkTnId);
      const skuToMatch = (linkExternalSku || linkingVariant?.sku || '').toString().trim();
      const match = (res.variants || []).find(
        (v) => v.sku && skuToMatch && v.sku.trim() === skuToMatch
      );
      if (variantFromUrl && (res.variants || []).some((v) => String(v.variantId) === variantFromUrl)) {
        setLinkTnVariantId(variantFromUrl);
      } else if (match) setLinkTnVariantId(String(match.variantId));
      else if (res.variants?.length === 1) setLinkTnVariantId(String(res.variants[0].variantId));
    } catch (e) {
      console.error(e);
      showToast('error', 'No se pudieron cargar las variantes. Revisá que el ID de producto sea correcto.');
    } finally {
      setLoadingTnVariants(false);
    }
  };

  const openBulkLinkModal = (groupKey: string) => {
    setBulkLinkGroupKey(groupKey);
    setShowBulkLinkModal(true);
    setBulkLinkMlId('');
    setBulkLinkTnId('');
    setBulkLinkMlVariations([]);
    setBulkLinkTnVariants([]);
    setBulkLinkAssignments({});
    setBulkLinkMlSearch('');
    setBulkLinkTnSearch('');
  };

  const openMergeManualModal = useCallback(() => {
    setShowMergeManualModal(true);
    setMergePickSearch('');
    setMergePickResults([]);
    setMergeSelected([]);
    setMergeKeeperProductId(null);
    setMergeSaving(false);
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
            const variants = await api.getVariantsBySku(groupKey);
            const mapped: Product[] = variants.map((v) => ({
              id: v.variantId,
              sku: `${groupKey}-${v.sizeCode}-${v.colorCode}`,
              name: articleName,
              category: articleCategory,
              price: articlePrice,
              description: '',
              size: v.sizeCode,
              color: v.colorName,
              colorCode: v.colorCode,
              stock: v.stock,
              integrations: {
                local: true,
                tiendaNube: !!(v.externalIds?.tiendaNube && v.externalIds?.tiendaNubeVariant),
                mercadoLibre: isVariantLinkedToMercadoLibre(v.externalIds),
              },
              externalIds: v.externalIds,
            }));
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

  const norm = (s: string) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
  const bulkLinkSkuMatch = (skuA: string, skuB: string) => {
    const a = norm(skuA);
    const b = norm(skuB);
    if (!a || !b) return false;
    if (a === b) return true;
    const aBase = a.replace(/\s+ac\.?$/i, '').replace(/\s*—.*$/, '').trim();
    const bBase = b.replace(/\s+ac\.?$/i, '').replace(/\s*—.*$/, '').trim();
    return aBase === bBase || a.startsWith(bBase) || b.startsWith(aBase);
  };
  const runBulkAutoMatch = (
    localVariants: Array<{ variantId: string; sku: string; size: string; color: string }>,
    mlList: { variationId: number | string; sku: string; size: string; color: string }[],
    tnList: { variantId: number | string; sku: string; size: string; color: string }[],
    currentAssignments?: Record<string, { ml?: string; tn?: string }>
  ) => {
    const prev = currentAssignments !== undefined ? currentAssignments : bulkLinkAssignments;
    const next = { ...prev };
    localVariants.forEach(local => {
      const skuN = norm(local.sku);
      const sizeN = norm(local.size);
      const colorN = norm(local.color);
      if (!next[local.variantId]) next[local.variantId] = { ml: '', tn: '' };
      // ML: primero por SKU (ML y TN usan el mismo SKU), luego por talle+color
      if (!next[local.variantId].ml && mlList.length > 0) {
        let match = skuN ? mlList.find(m => norm(m.sku) === skuN) : null;
        if (!match) match = mlList.find(m => norm(m.size) === sizeN && norm(m.color) === colorN);
        if (match) next[local.variantId].ml = String(match.variationId);
        else if (mlList.length === 1) next[local.variantId].ml = String(mlList[0].variationId);
      }
      // TN: mismo criterio (mismo SKU que ML)
      if (!next[local.variantId].tn && tnList.length > 0) {
        let match = skuN ? tnList.find(t => norm(t.sku) === skuN) : null;
        if (!match) match = tnList.find(t => norm(t.size) === sizeN && norm(t.color) === colorN);
        if (match) next[local.variantId].tn = String(match.variantId);
        else if (tnList.length === 1) next[local.variantId].tn = String(tnList[0].variantId);
      }
    });
    setBulkLinkAssignments(next);
    return next;
  };

  const bulkLinkOptionMatch = (
    query: string,
    item: { sku?: string; size?: string; color?: string; variationId?: string | number; variantId?: string | number }
  ) => {
    const q = norm(query);
    if (!q) return true;
    const id = item.variationId ?? item.variantId ?? '';
    const text = [item.sku || '', formatSizeForLink(item.size), item.color || '', String(id)].join(' ');
    return norm(text).includes(q);
  };

  const filteredBulkLinkMlVariations = React.useMemo(
    () => bulkLinkMlVariations.filter((m) => bulkLinkOptionMatch(bulkLinkMlSearch, m)),
    [bulkLinkMlVariations, bulkLinkMlSearch]
  );
  const filteredBulkLinkTnVariants = React.useMemo(
    () => bulkLinkTnVariants.filter((t) => bulkLinkOptionMatch(bulkLinkTnSearch, t)),
    [bulkLinkTnVariants, bulkLinkTnSearch]
  );
  const getVisibleBulkLinkTnVariants = (selectedValue?: string) => {
    const selected = (selectedValue || '').trim();
    const base = filteredBulkLinkTnVariants.length > 0 ? filteredBulkLinkTnVariants : bulkLinkTnVariants;
    if (!selected) return base;
    const hasSelected = base.some((t) => String(t.variantId) === selected);
    if (hasSelected) return base;
    const selectedOption = bulkLinkTnVariants.find((t) => String(t.variantId) === selected);
    return selectedOption ? [selectedOption, ...base] : base;
  };

  React.useEffect(() => {
    if (!showBulkLinkModal || !bulkLinkGroupKey) return;
    setBulkLinkLoading(true);
    api.getProductBySku(bulkLinkGroupKey).then((p: any) => {
      if (!p) {
        setBulkLinkVariants([]);
        setBulkLinkProductId(null);
        setBulkLinkLoading(false);
        return;
      }
      setBulkLinkProductId(p.id);
      setBulkLinkMlId(p.externalIds?.mercadoLibre || '');
      setBulkLinkTnId(p.externalIds?.tiendaNube || '');
      const variants = (p.variants || []).map((v: any) => {
        const variantId = v.variant_id;
        const rawSku = (v.variant_sku ?? '').toString().trim();
        const extSku = (v.external_sku ?? '').toString().trim();
        const fallbackSku = `${bulkLinkGroupKey}-${v.size_code}-${v.color_code}`;
        const sku =
          rawSku && rawSku !== String(variantId)
            ? rawSku
            : extSku
              ? extSku
              : fallbackSku;
        return {
          variantId,
          sku,
          size: v.size_code,
          color: v.color_name,
          externalIds: v.externalIds
        };
      });
      setBulkLinkVariants(variants);
      const assignments: Record<string, { ml: string; tn: string }> = {};
      variants.forEach((v: any) => {
        const mlVal = (v.externalIds?.mercadoLibreItemId != null && String(v.externalIds.mercadoLibreItemId).trim() !== '')
          ? String(v.externalIds.mercadoLibreItemId).trim()
          : (v.externalIds?.mercadoLibreVariant != null ? String(v.externalIds.mercadoLibreVariant) : '');
        assignments[v.variantId] = {
          ml: mlVal,
          tn: v.externalIds?.tiendaNubeVariant ? String(v.externalIds.tiendaNubeVariant) : ''
        };
      });
      setBulkLinkAssignments(assignments);
      const skuMap: Record<string, string> = {};
      variants.forEach((v: any) => { skuMap[v.variantId] = String(v.sku || ''); });
      setBulkLinkSkuEdits(skuMap);
      setBulkLinkLoading(false);
    }).catch(() => setBulkLinkLoading(false));
  }, [showBulkLinkModal, bulkLinkGroupKey]);

  const handleBulkLoadMl = async () => {
    const id = normalizeMercadoLibreItemId(bulkLinkMlId);
    if (!id) return;
    setBulkLinkLoading(true);
    try {
      const res = await api.getMercadoLibreItemVariations(id);
      const mlList = res.variations || [];
      setBulkLinkMlVariations(mlList);
      runBulkAutoMatch(bulkLinkVariants, mlList, bulkLinkTnVariants);
    } catch (e) {
      console.error(e);
      showToast('error', 'No se pudieron cargar las variaciones de ML.');
    } finally {
      setBulkLinkLoading(false);
    }
  };

  const handleBulkLoadTn = async () => {
    const id = normalizeTiendaNubeProductId(bulkLinkTnId);
    if (!id || !/^\d+$/.test(id)) {
      showToast('error', 'No se pudo obtener el ID del producto TN desde el texto pegado.');
      return;
    }
    setBulkLinkLoading(true);
    try {
      const res = await api.getTiendaNubeProductVariants(id);
      const tnList = res.variants || [];
      setBulkLinkTnVariants(tnList);
      runBulkAutoMatch(bulkLinkVariants, bulkLinkMlVariations, tnList);
    } catch (e) {
      console.error(e);
      showToast('error', 'No se pudieron cargar las variantes de TN.');
    } finally {
      setBulkLinkLoading(false);
    }
  };

  const handleBulkLoadBothAndMatch = async () => {
    const mlId = normalizeMercadoLibreItemId(bulkLinkMlId);
    const tnId = normalizeTiendaNubeProductId(bulkLinkTnId);
    if (!mlId || !tnId || !/^\d+$/.test(tnId)) {
      showToast('info', 'Ingresá ambos enlaces o IDs (ML y TN) para cargar y emparejar todo.');
      return;
    }
    setBulkLinkLoading(true);
    const [mlSettled, tnSettled] = await Promise.allSettled([
      api.getMercadoLibreItemVariations(mlId),
      api.getTiendaNubeProductVariants(tnId)
    ]);
    let mlList: { variationId: number | string; sku: string; color: string; size: string; stock: number }[] = [];
    let tnList: { variantId: number | string; sku: string; color: string; size: string; stock: number }[] = [];
    const errors: string[] = [];

    if (mlSettled.status === 'fulfilled') {
      mlList = mlSettled.value?.variations || [];
      setBulkLinkMlVariations(mlList);
      if (mlList.length === 0) errors.push('ML no devolvió variaciones (revisá el ID de la publicación).');
    } else {
      const msg = (mlSettled.reason?.message || mlSettled.reason)?.toString() || 'Error desconocido';
      errors.push(`Mercado Libre: ${msg}`);
    }
    if (tnSettled.status === 'fulfilled') {
      tnList = tnSettled.value?.variants || [];
      setBulkLinkTnVariants(tnList);
      if (tnList.length === 0) errors.push('Tienda Nube no devolvió variantes (revisá el ID del producto).');
    } else {
      const msg = (tnSettled.reason?.message || tnSettled.reason)?.toString() || 'Error desconocido';
      errors.push(`Tienda Nube: ${msg}`);
    }

    runBulkAutoMatch(bulkLinkVariants, mlList, tnList);

    if (errors.length > 0) {
      showToast('error', errors.join(' '));
    } else {
      const nextAssignments = runBulkAutoMatch(bulkLinkVariants, mlList, tnList);
      const linkedCount = Object.values(nextAssignments).filter((a: { ml?: string; tn?: string }) => (a.ml?.trim() || a.tn?.trim())).length;
      if (linkedCount === 0) {
        showToast('info', 'Se cargaron las listas pero no se emparejó ninguna variante por SKU ni por talle/color. Revisá que coincidan o asigná manualmente en la tabla.');
      } else {
        showToast('success', `Se cargaron ${mlList.length} variaciones de ML y ${tnList.length} de TN. Se emparejaron ${linkedCount} variantes. Revisá la tabla y guardá.`);
      }
    }
    setBulkLinkLoading(false);
  };

  const handleBulkLinkSave = async () => {
    if (!bulkLinkGroupKey || !bulkLinkProductId) return;
    setBulkLinkSaving(true);
    try {
      // Permitir corregir SKU local de cada variante en el mismo modal.
      for (const v of bulkLinkVariants) {
        const nextSku = (bulkLinkSkuEdits[v.variantId] ?? v.sku ?? '').toString().trim();
        if (!nextSku || nextSku === v.sku) continue;
        await api.updateVariant(String(v.variantId), { sku: nextSku });
      }

      const links = bulkLinkVariants.map(v => {
        const ml = bulkLinkAssignments[v.variantId]?.ml?.trim() || '';
        const tn = bulkLinkAssignments[v.variantId]?.tn?.trim() || '';
        const isMlItemId = /^ML[A-Z]{1,5}\d+$/i.test(ml);
        return {
          variantId: String(v.variantId),
          mercadoLibreVariantId: !isMlItemId && ml ? ml : undefined,
          mercadoLibreItemId: isMlItemId ? ml : undefined,
          tiendaNubeVariantId: tn || undefined
        };
      }).filter(l => l.mercadoLibreVariantId != null || l.mercadoLibreItemId != null || l.tiendaNubeVariantId != null);
      if (links.length === 0) {
        showToast('info', 'Asigná al menos una variación ML o variante TN en la tabla.');
        setBulkLinkSaving(false);
        return;
      }
      const res = await api.bulkLinkVariants({
        productId: bulkLinkProductId,
        mercadoLibreItemId: normalizeMercadoLibreItemId(bulkLinkMlId) || undefined,
        tiendaNubeProductId: (() => {
          const n = normalizeTiendaNubeProductId(bulkLinkTnId);
          return /^\d+$/.test(n) ? n : bulkLinkTnId.trim() || undefined;
        })(),
        links
      });
      const updated = (res as any)?.updated ?? links.length;
      const synced = (res as any)?.synced ?? 0;
      await api.getVariantsBySku(bulkLinkGroupKey).then(variants => {
        const mapped: Product[] = variants.map((v) => ({
          id: v.variantId,
          sku: (v as any).sku || `${bulkLinkGroupKey}-${v.sizeCode}-${v.colorCode}`,
          name: groupedProducts[bulkLinkGroupKey]?.[0]?.name || '',
          category: groupedProducts[bulkLinkGroupKey]?.[0]?.category || 'General',
          price: groupedProducts[bulkLinkGroupKey]?.[0]?.price || 0,
          description: '',
          size: v.sizeCode,
          color: v.colorName,
          colorCode: v.colorCode,
          stock: v.stock,
          integrations: {
            local: true,
            tiendaNube: !!(v.externalIds?.tiendaNube && v.externalIds?.tiendaNubeVariant),
            mercadoLibre: isVariantLinkedToMercadoLibre(v.externalIds)
          },
          externalIds: v.externalIds
        }));
        setLoadedVariants(prev => ({ ...prev, [bulkLinkGroupKey]: mapped }));
      });
      setShowBulkLinkModal(false);
      setBulkLinkGroupKey(null);
      if (updated > 0) {
        setServerListRefreshKey(k => k + 1);
        onImportComplete?.();
        const msg = synced > 0
          ? `Se guardaron ${updated} vinculación(es) y se trajo el stock de Mercado Libre a tu inventario (${synced} variante(s) actualizadas).`
          : `Se guardaron ${updated} vinculación(es).`;
        showToast('success', msg);
      }
    } catch (e: any) {
      console.error('Bulk link error:', e);
      const msg = e?.message || (typeof e === 'string' ? e : 'Error al guardar vinculaciones.');
      showToast('error', msg);
    } finally {
      setBulkLinkSaving(false);
    }
  };

  const handleOpenLinkModal = (product: Product) => {
    setLinkingVariant(product);
    setShowAddPublicationForm(false);
    setLinkTnId(product.externalIds?.tiendaNube || '');
    setLinkTnVariantId(product.externalIds?.tiendaNubeVariant || '');
    setLinkMlId((product.externalIds as any)?.mercadoLibreItemId || product.externalIds?.mercadoLibre || '');
    setLinkPackMl(1);
    setLinkPackTn(1);
    setLinkExternalSku((product.sku ?? '').toString());
    setLinkMlVariantId((product.externalIds as any)?.mercadoLibreVariant?.toString() ?? '');
    setLinkSaveStockFromML(null);
    setLinkProduct(null);
    setLinkMlVariations(null);
    setLinkTnVariants(null);

    // Resolver el SKU base real desde el backend para evitar 404 por parseo de SKU
    api.getVariantById(product.id).then((v) => {
      const groupKey = (v?.base_sku || (product as any).base_sku || '').toString().trim();
      if (!groupKey) return;
      api.getProductBySku(groupKey).then((p) => {
        if (p) {
          setLinkProduct({ id: p.id, name: p.name, sku: p.sku, price: p.base_price, category: p.category, description: (p as any).description });
          setLinkPackMl(p.mercado_libre_pack_size ?? 1);
          setLinkPackTn(p.tienda_nube_pack_size ?? 1);
          const variant = (p as any).variants?.find((x: any) => x.variant_id === product.id);
          setLinkExternalSku((variant?.external_sku ?? product.sku ?? '').toString());
        } else {
          setLinkExternalSku((product.sku ?? '').toString());
        }
      });
    });
  };

  const handleSaveLink = async () => {
    if (!linkingVariant) return;
    try {
      setLinkSaveStockFromML(null);
      const tnResolved = (() => {
        const t = linkTnId.trim();
        if (!t) return '';
        const n = normalizeTiendaNubeProductId(t);
        return /^\d+$/.test(n) ? n : '';
      })();
      const mlResolved = linkMlId.trim() ? normalizeMercadoLibreItemId(linkMlId) || linkMlId.trim() : '';
      // 1. Update Variant External IDs (si hay Item ML, el backend trae el stock de ML y lo guarda en inventario)
      const linkRes = await api.updateVariantExternalIds(linkingVariant.id, {
        tiendaNubeVariantId: linkTnVariantId || undefined,
        tiendaNubeProductId: tnResolved || undefined,
        mercadoLibreVariantId: linkMlVariantId || mlResolved || undefined,
        mercadoLibreItemId: mlResolved || undefined,
        externalSku: linkExternalSku.trim() || undefined
      } as { tiendaNubeVariantId?: string; tiendaNubeProductId?: string; mercadoLibreVariantId?: string; mercadoLibreItemId?: string; externalSku?: string });
      const newStockFromML = typeof (linkRes as any).stockFromML === 'number' ? (linkRes as any).stockFromML : undefined;
      if (newStockFromML !== undefined) {
        setLinkSaveStockFromML(newStockFromML);
      }

      // 2. Update Product (Parent) External IDs if provided
      // We don't have the parent ID easily here, but the backend getProductBySku returns it.
      // However, linkingVariant is a mapped object.
      // If we want to link the parent, we need the parent ID.
      // The mapped object doesn't carry the parent ID directly, but we can assume 'linkTnId' is for the parent.
      // We can iterate over the group to find the parent ID? No, the group key is SKU.
      // Wait, 'getVariantsBySku' does not return parent DB ID.
      // This is a small issue. But 'tienda_nube_id' is on the 'products' table.
      // If I want to update it, I need the 'products.id'.
      // But 'linkingVariant.id' is the 'product_variants.id'.
      // I can't update parent with variant ID.
      
      // Solution: The user probably sets TN ID once per group.
      // But here we are linking per variant.
      // If I want to support Parent linking, I need to fetch the parent ID.
      // OR, I can just update the variant mapping and assume the parent mapping is done elsewhere or not needed if I sync by variant ID?
      // TN API needs Product ID + Variant ID.
      // So I MUST store Parent ID.
      // If I can't update Parent ID, I can't sync.
      
      // Let's modify 'getVariantsBySku' to return parent ID?
      // Or 'getProducts' returns parent ID.
      // 'groupedProducts' has the parent products from 'getProducts'.
      // So I can find the parent product using the group key (SKU base).
      
      const v = await api.getVariantById(linkingVariant.id);
      const groupKey = (v?.base_sku || (linkingVariant as any).base_sku || '').toString().trim();
      const parentProductId = (linkProduct?.id || '').toString().trim();

      if (parentProductId && tnResolved) {
        await api.updateProductExternalIds(parentProductId, {
          tiendaNubeId: tnResolved
        });
        if (mlResolved) {
             await api.updateProductExternalIds(parentProductId, {
                mercadoLibreId: mlResolved
             });
        }
      }
      if (linkProduct) {
        await api.updateProduct({
          ...linkProduct,
          id: linkProduct.id,
          name: linkProduct.name ?? '',
          sku: linkProduct.sku ?? '',
          price: linkProduct.price ?? 0,
          mercadoLibrePackSize: linkPackMl,
          tiendaNubePackSize: linkPackTn
        } as Product & { mercadoLibrePackSize: number; tiendaNubePackSize: number });
      }

      // Actualizar estado local de una: vínculos y stock (si vino de ML)
      setLoadedVariants(prev => {
        const group = prev[groupKey] || [];
        return {
          ...prev,
          [groupKey]: group.map(p => p.id === linkingVariant.id ? {
            ...p,
            ...(newStockFromML !== undefined && { stock: newStockFromML, stock_total: newStockFromML } as any),
            externalIds: {
              ...p.externalIds,
              tiendaNube: tnResolved || linkTnId,
              tiendaNubeVariant: linkTnVariantId,
              mercadoLibre: mlResolved || linkMlId,
              mercadoLibreVariant: linkMlVariantId || undefined,
              mercadoLibreItemId: mlResolved || undefined
            },
            integrations: {
                ...p.integrations,
                tiendaNube: isVariantLinkedToTiendaNube({
                  tiendaNubeVariant: linkTnVariantId
                }),
                mercadoLibre: isVariantLinkedToMercadoLibre({
                  mercadoLibreVariant: linkMlVariantId,
                  mercadoLibreItemId: mlResolved
                })
            }
          } : p)
        };
      });

      // Refrescar variantes del grupo desde el servidor para que el stock (y todo) quede al día
      if (groupKey) api.getVariantsBySku(groupKey).then(variants => {
        const mapped: Product[] = variants.map((v) => ({
          id: v.variantId,
          sku: `${groupKey}-${v.sizeCode}-${v.colorCode}`,
          name: groupedProducts[groupKey]?.[0]?.name || '',
          category: groupedProducts[groupKey]?.[0]?.category || 'General',
          price: groupedProducts[groupKey]?.[0]?.price || 0,
          description: '',
          size: v.sizeCode,
          color: v.colorName,
          colorCode: v.colorCode,
          stock: v.stock,
          integrations: {
            local: true,
            tiendaNube: isVariantLinkedToTiendaNube(v.externalIds),
            mercadoLibre: isVariantLinkedToMercadoLibre(v.externalIds)
          },
          externalIds: v.externalIds
        }));
        setLoadedVariants(prev => ({ ...prev, [groupKey]: mapped }));
      }).catch(() => {});

      setServerListRefreshKey(k => k + 1);
      onImportComplete?.();
      setLinkingVariant(null);
    } catch (error) {
      console.error(error);
      showToast('error', 'Error guardando vinculación');
    }
  };

  const handleUnlinkArticle = async (platform: 'tiendanube' | 'mercadolibre' | 'both') => {
    if (!linkingVariant) return;
    try {
      const v = await api.getVariantById(linkingVariant.id);
      const groupKey = (v?.base_sku || (linkingVariant as any).base_sku || '').toString().trim();
      const parentProductId = (linkProduct?.id || '').toString().trim();
      if (!parentProductId) {
        showToast('error', 'No se pudo resolver el ID del artículo para desvincular.');
        return;
      }

      const opts =
        platform === 'both'
          ? { tiendaNube: true, mercadoLibre: true, variants: true }
          : platform === 'tiendanube'
            ? { tiendaNube: true, mercadoLibre: false, variants: true }
            : { tiendaNube: false, mercadoLibre: true, variants: true };

      await api.unlinkProductPlatforms(parentProductId, opts);

      // Refrescar variantes del grupo y cerrar modal
      if (groupKey) api.getVariantsBySku(groupKey).then(variants => {
        const mapped: Product[] = variants.map((v) => ({
          id: v.variantId,
          sku: `${groupKey}-${v.sizeCode}-${v.colorCode}`,
          name: groupedProducts[groupKey]?.[0]?.name || '',
          category: groupedProducts[groupKey]?.[0]?.category || 'General',
          price: groupedProducts[groupKey]?.[0]?.price || 0,
          description: '',
          size: v.sizeCode,
          color: v.colorName,
          colorCode: v.colorCode,
          stock: v.stock,
          integrations: {
            local: true,
            tiendaNube: isVariantLinkedToTiendaNube(v.externalIds),
            mercadoLibre: isVariantLinkedToMercadoLibre(v.externalIds)
          },
          externalIds: v.externalIds
        }));
        setLoadedVariants(prev => ({ ...prev, [groupKey]: mapped }));
      });

      showToast('success', platform === 'both' ? 'Artículo desvinculado de TN y ML.' : platform === 'tiendanube' ? 'Artículo desvinculado de Tienda Nube.' : 'Artículo desvinculado de Mercado Libre.');
      setLinkingVariant(null);
    } catch (e: any) {
      const msg = e?.message || 'Error al desvincular artículo.';
      showToast('error', msg);
    }
  };

  useEffect(() => {
    if (!linkingVariant?.id) {
      setVariantPublications([]);
      return;
    }
    api.getVariantPublications(linkingVariant.id).then(setVariantPublications).catch(() => setVariantPublications([]));
  }, [linkingVariant?.id]);

  const refreshVariantPublications = () => {
    if (linkingVariant?.id) api.getVariantPublications(linkingVariant.id).then(setVariantPublications).catch(() => {});
  };

  const handleAddVariantPublication = async () => {
    if (!linkingVariant?.id || !addPubProductId.trim()) {
      showToast('error', 'Ingresá el ID o el link de la publicación (producto/ítem)');
      return;
    }
    const mlProd = normalizeMercadoLibreItemId(addPubProductId);
    const tnProd = normalizeTiendaNubeProductId(addPubProductId);
    const externalProductId = addPubPlatform === 'mercadolibre' ? mlProd : tnProd;
    if (addPubPlatform === 'mercadolibre' && !externalProductId) {
      showToast('error', 'No se pudo obtener el ID de la publicación ML. Pegá el link o el MLA…');
      return;
    }
    if (addPubPlatform === 'tiendanube' && (!externalProductId || !/^\d+$/.test(externalProductId))) {
      showToast('error', 'No se pudo obtener el ID del producto TN. Pegá el link o el número.');
      return;
    }
    let externalVariantId = addPubVariantId.trim();
    if (!externalVariantId) {
      if (addPubPlatform === 'tiendanube') {
        externalVariantId =
          extractTiendaNubeVariantFromUrl(addPubProductId) || extractTiendaNubeVariantFromUrl(addPubVariantId) || '';
      } else {
        externalVariantId =
          extractMercadoLibreVariationIdFromUrl(addPubProductId) || extractMercadoLibreVariationIdFromUrl(addPubVariantId) || '';
      }
    }
    setAddPubSaving(true);
    try {
      await api.addVariantPublication(linkingVariant.id, {
        platform: addPubPlatform,
        externalProductId,
        externalVariantId: externalVariantId || undefined,
        packSize: addPubPackSize
      });
      showToast('success', 'Publicación agregada. El stock se sincronizará a esta publicación.');
      setAddPubProductId('');
      setAddPubVariantId('');
      setAddPubPackSize(1);
      refreshVariantPublications();
      setShowAddPublicationForm(false);
    } catch (e: any) {
      showToast('error', e?.message || 'Error agregando publicación');
    } finally {
      setAddPubSaving(false);
    }
  };

  const handleDeleteVariantPublication = async (publicationId: string) => {
    if (!linkingVariant?.id) return;
    try {
      await api.deleteVariantPublication(linkingVariant.id, publicationId);
      showToast('success', 'Publicación desvinculada');
      refreshVariantPublications();
    } catch (e: any) {
      showToast('error', e?.message || 'Error al desvincular');
    }
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
    setLoadingEditVariant(true);
    setEditVariantLinkIds({ mlItemId: null, mlVariantId: null, tnProductId: null, tnVariantId: null });
    api.getVariantById(editingVariantId).then((v: any) => {
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
    }).finally(() => setLoadingEditVariant(false));
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
        api.getVariantsBySku(groupKeyToRefetch).then(variants => {
          const mapped: Product[] = variants.map((v) => ({
            id: v.variantId,
            sku: `${groupKeyToRefetch}-${v.sizeCode}-${v.colorCode}`,
            name,
            category: editProductForm.category || 'General',
            price: base_price,
            description: editProductForm.description || '',
            size: v.sizeCode,
            color: v.colorName,
            colorCode: v.colorCode,
            stock: v.stock,
            integrations: {
              local: true,
              tiendaNube: isVariantLinkedToTiendaNube(v.externalIds),
              mercadoLibre: isVariantLinkedToMercadoLibre(v.externalIds)
            },
            externalIds: v.externalIds
          }));
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
        const variants = await api.getVariantsBySku(groupKey);
        const mapped: Product[] = variants.map((v) => ({
          id: v.variantId,
          sku: `${groupKey}-${v.sizeCode}-${v.colorCode}`,
          name: groupedProducts[groupKey]?.[0]?.name || '',
          category: groupedProducts[groupKey]?.[0]?.category || 'General',
          price: groupedProducts[groupKey]?.[0]?.price || 0,
          description: '',
          size: v.sizeCode,
          color: v.colorName,
          colorCode: v.colorCode,
          stock: v.stock,
          integrations: {
            local: true,
            tiendaNube: isVariantLinkedToTiendaNube(v.externalIds),
            mercadoLibre: isVariantLinkedToMercadoLibre(v.externalIds)
          },
          externalIds: v.externalIds
        }));
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

      {/* Top Action Bar */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-2 overflow-x-auto touch-scroll pb-2 scrollbar-hide -mx-1 px-1 sm:mx-0 sm:px-0">
        {/* Móvil: menú de tres puntos con todas las acciones */}
        <div className="flex sm:hidden items-center gap-2 w-full">
          <div className="flex-1 min-w-0" />
          <div className="relative shrink-0" ref={topDotsRef}>
            <button
              type="button"
              onClick={() => setTopDotsOpen(prev => !prev)}
              className="flex items-center justify-center w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 active:bg-slate-600 transition-colors touch-manipulation"
              aria-label="Acciones"
            >
              <MoreVertical size={22} />
            </button>
            {topDotsOpen && topDotsPosition && createPortal(
              <div
                data-top-dots-dropdown
                className="py-1.5 min-w-[220px] bg-slate-800 border border-slate-600 rounded-xl shadow-xl z-[9999]"
                style={{
                  position: 'fixed',
                  top: topDotsPosition.top,
                  left: Math.max(8, Math.min(topDotsPosition.left, window.innerWidth - 228)),
                  zIndex: 9999
                }}
              >
                {isAdminOrWarehouse && (
                  <>
                    <div className="px-3 py-2 border-b border-slate-700">
                      <p className="text-[10px] font-bold text-green-400 uppercase">Fuente de verdad: tu stock (LupoHub)</p>
                    </div>
                    <button type="button" onClick={() => { setTopDotsOpen(false); handleSyncToMercadoLibre(); }} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-amber-200 hover:bg-amber-500/20 rounded-lg border-b border-slate-700/50">
                      <Zap size={18} className="text-amber-400 shrink-0" />
                      Enviar mi stock a Mercado Libre
                    </button>
                    <button type="button" onClick={() => { setTopDotsOpen(false); handleSyncToTiendaNube(); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700 rounded-lg">
                      <Cloud size={18} className="text-cyan-400" />
                      Enviar mi stock a Tienda Nube
                    </button>
                    <button type="button" onClick={() => { setTopDotsOpen(false); handleSyncStock(); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700 rounded-lg border-b border-slate-700/50">
                      <RefreshCw size={18} className="text-blue-400" />
                      Enviar a ambas (TN + ML)
                    </button>
                    <div className="px-3 py-1.5 pt-2">
                      <p className="text-[10px] text-slate-500">Opcional: traer desde ML</p>
                    </div>
                    <button type="button" onClick={() => { setTopDotsOpen(false); handleSyncFromMercadoLibre(); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-400 hover:bg-slate-700 rounded-lg">
                      <RefreshCw size={18} className="text-amber-400 shrink-0" />
                      Importar stock desde Mercado Libre
                    </button>
                  </>
                )}
                {canManagePublicationBundles && (
                  <button type="button" onClick={() => { setTopDotsOpen(false); setShowPublicationBundles(true); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-violet-200 hover:bg-violet-500/15 rounded-lg border-b border-slate-700/50">
                    <Layers size={18} className="text-violet-400 shrink-0" />
                    Packs multicolor (publicaciones)
                  </button>
                )}
                {isAdminOrWarehouse && (
                  <button type="button" onClick={() => { setTopDotsOpen(false); openMergeManualModal(); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-violet-200 hover:bg-violet-500/15 rounded-lg border-b border-slate-700/50">
                    <GitMerge size={18} className="text-violet-400 shrink-0" />
                    Unificar artículos
                  </button>
                )}
                <button type="button" onClick={() => { setTopDotsOpen(false); tangoFileInputRef.current?.click(); }} disabled={importingTango} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-200 hover:bg-slate-700 rounded-lg disabled:opacity-50">
                  {importingTango ? <Loader2 size={18} className="animate-spin text-amber-400" /> : <Upload size={18} className="text-amber-400" />}
                  Importar Tango
                </button>
                <button type="button" onClick={() => { setTopDotsOpen(false); stockExcelFileInputRef.current?.click(); }} disabled={importingStockExcel} className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700 rounded-lg disabled:opacity-50">
                  {importingStockExcel ? <Loader2 size={18} className="animate-spin text-cyan-400" /> : <Package size={18} className="text-cyan-400" />}
                  Importar stock desde Excel
                </button>
                <button type="button" onClick={() => { setTopDotsOpen(false); exportProductsToExcel(); }} disabled={exportingExcel} className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700 rounded-lg disabled:opacity-50">
                  {exportingExcel ? <Loader2 size={18} className="animate-spin text-green-400" /> : <Download size={18} className="text-green-400" />}
                  Exportar Excel
                </button>
                {isAdminOrWarehouse && (
                  <button type="button" onClick={() => { setTopDotsOpen(false); openCreationModal(); }} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20 rounded-lg border-t border-slate-700/50">
                    <Plus size={18} className="text-indigo-400" />
                    Nuevo Modelo
                  </button>
                )}
              </div>,
              document.body
            )}
          </div>
        </div>

        {/* Desktop: botones visibles */}
        <div className="hidden sm:flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-2 flex-1">
        {isAdminOrWarehouse && (
          <div className="flex-shrink-0 relative" ref={syncMenuRef}>
            <button
              type="button"
              onClick={() => setSyncMenuOpen(prev => !prev)}
              disabled={!!syncLoading}
              className="flex items-center justify-center sm:justify-start gap-2 bg-slate-800 text-blue-400 px-3 sm:px-4 py-2.5 rounded-xl border border-slate-700 active:bg-slate-700 shadow-sm min-h-[44px]"
            >
              {syncLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <RefreshCw size={18} />
              )}
              <span className="text-sm font-semibold hidden sm:inline">
                {syncLoading === 'fromML' ? 'Importando desde ML…' : syncLoading === 'both' ? 'Enviando a TN + ML…' : syncLoading === 'tn' ? 'Enviando a TN…' : syncLoading === 'ml' ? 'Enviando a ML…' : 'Enviar mi stock'}
              </span>
              <ChevronDown size={16} className={`hidden sm:block transition-transform ${syncMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {syncMenuOpen && !syncLoading && syncDropdownPosition && createPortal(
              <div
                data-sync-dropdown
                className="py-1 min-w-[240px] bg-slate-800 border border-slate-700 rounded-xl shadow-xl"
                style={{
                  position: 'fixed',
                  top: syncDropdownPosition.top,
                  left: syncDropdownPosition.left,
                  width: syncDropdownPosition.width,
                  zIndex: 9999
                }}
              >
                <div className="px-3 py-2 border-b border-slate-700">
                  <p className="text-[10px] font-bold text-green-400 uppercase">Fuente de verdad: tu stock (LupoHub)</p>
                </div>
                <button
                  type="button"
                  onClick={handleSyncToMercadoLibre}
                  className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-amber-200 hover:bg-amber-500/20 rounded-lg border-b border-slate-700/50"
                >
                  <Zap size={18} className="text-amber-400 shrink-0" />
                  Enviar mi stock a Mercado Libre
                </button>
                <div className="px-3 py-1.5">
                  <p className="text-[10px] text-slate-500">Enviar stock local a:</p>
                </div>
                <button
                  type="button"
                  onClick={handleSyncToTiendaNube}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700 rounded-lg"
                >
                  <Cloud size={18} className="text-cyan-400" />
                  Enviar a Tienda Nube
                </button>
                <button
                  type="button"
                  onClick={handleSyncStock}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700 rounded-lg"
                >
                  <RefreshCw size={18} className="text-blue-400" />
                  Enviar a ambas (TN + ML)
                </button>
                <div className="px-3 py-1.5 pt-2">
                  <p className="text-[10px] text-slate-500">Opcional: importar desde ML</p>
                </div>
                <button
                  type="button"
                  onClick={handleSyncFromMercadoLibre}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-400 hover:bg-slate-700 rounded-lg"
                >
                  <RefreshCw size={18} className="text-amber-400 shrink-0" />
                  Traer stock desde Mercado Libre
                </button>
              </div>,
              document.body
            )}
          </div>
        )}
        
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
        <button
          type="button"
          onClick={() => tangoFileInputRef.current?.click()}
          disabled={importingTango}
          className="flex-shrink-0 flex items-center justify-center sm:justify-start gap-2 bg-slate-800 text-amber-400 px-3 sm:px-4 py-2.5 rounded-xl border border-slate-700 active:bg-slate-700 shadow-sm disabled:opacity-50 min-h-[44px]"
        >
          {importingTango ? <RefreshCw size={18} className="animate-spin" /> : <Upload size={18} />}
          <span className="text-sm font-semibold hidden sm:inline">{importingTango ? 'Importando…' : 'Importar Tango'}</span>
        </button>
        <button
          type="button"
          onClick={() => stockExcelFileInputRef.current?.click()}
          disabled={importingStockExcel}
          className="flex-shrink-0 flex items-center justify-center sm:justify-start gap-2 bg-slate-800 text-cyan-400 px-3 sm:px-4 py-2.5 rounded-xl border border-slate-700 active:bg-slate-700 shadow-sm disabled:opacity-50 min-h-[44px]"
        >
          {importingStockExcel ? <Loader2 size={18} className="animate-spin" /> : <Package size={18} />}
          <span className="text-sm font-semibold hidden sm:inline">{importingStockExcel ? 'Importando stock…' : 'Importar stock Excel'}</span>
        </button>
        <button 
          onClick={exportProductsToExcel}
          disabled={exportingExcel}
          className="flex-shrink-0 flex items-center justify-center sm:justify-start gap-2 bg-slate-800 text-green-400 px-3 sm:px-4 py-2.5 rounded-xl border border-slate-700 active:bg-slate-700 shadow-sm disabled:opacity-50 min-h-[44px]"
        >
          {exportingExcel ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
          <span className="text-sm font-semibold hidden sm:inline">{exportingExcel ? 'Exportando…' : 'Exportar Excel'}</span>
        </button>

        {canManagePublicationBundles && (
          <button
            type="button"
            onClick={() => setShowPublicationBundles(true)}
            className="flex-shrink-0 flex items-center justify-center sm:justify-start gap-2 bg-violet-900/40 text-violet-200 px-3 sm:px-4 py-2.5 rounded-xl border border-violet-700/60 hover:bg-violet-800/40 shadow-sm min-h-[44px]"
          >
            <Layers size={18} />
            <span className="text-sm font-semibold hidden sm:inline">Packs multicolor</span>
          </button>
        )}

        {isAdminOrWarehouse && (
          <button
            type="button"
            onClick={() => openMergeManualModal()}
            className="flex-shrink-0 flex items-center justify-center sm:justify-start gap-2 bg-slate-800 text-violet-300 px-3 sm:px-4 py-2.5 rounded-xl border border-violet-900/40 active:bg-slate-700 shadow-sm min-h-[44px]"
          >
            <GitMerge size={18} />
            <span className="text-sm font-semibold hidden sm:inline">Unificar artículos</span>
          </button>
        )}

        {isAdminOrWarehouse && (
          <button 
            onClick={() => openCreationModal()}
            className="flex-shrink-0 flex items-center justify-center sm:justify-start gap-2 bg-indigo-600 text-white px-3 sm:px-4 py-2.5 rounded-xl font-bold shadow-lg shadow-indigo-900/20 active:scale-95 transition-transform min-h-[44px]"
          >
            <Plus size={18} />
            <span className="text-sm hidden sm:inline">Nuevo Modelo</span>
          </button>
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
              className="w-full min-w-0 pl-10 pr-4 py-3 sm:py-3.5 min-h-[48px] bg-slate-900 border border-slate-800 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-white text-sm shadow-sm box-border"
            />
          </div>
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={`flex-shrink-0 min-h-[48px] px-4 rounded-xl border flex items-center justify-center gap-2 font-bold transition-all touch-manipulation ${showFilters ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}
          >
            <Filter size={18} />
            <span className="hidden md:inline">Filtros</span>
            {(filterCategory !== 'ALL' || filterSize !== 'ALL' || filterColor !== 'ALL' || filterStockLevel !== 'ALL' || filterSync !== 'ALL' || hideZeroStock) && (
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
          </div>
        )}
      </div>

      {/* Botón para activar modo selección (solo Mi inventario, admin/warehouse) */}
      {inventorySubView === 'mine' && isAdminOrWarehouse && !selectionModeEnabled && (
        <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4 bg-slate-800/60 border border-slate-600 rounded-xl">
          <span className="text-slate-400 text-sm">Para enviar variantes a Mercado Libre o Tienda Nube, activá la selección.</span>
          <button
            type="button"
            onClick={() => setSelectionModeEnabled(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold transition-colors"
          >
            <Check size={18} className="opacity-80" />
            Seleccionar variantes
          </button>
        </div>
      )}

      {/* Barra de selección para enviar a TN/ML */}
      {inventorySubView === 'mine' && selectionModeEnabled && selectedVariantIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
          <span className="text-amber-200 font-semibold text-sm">
            {selectedVariantIds.length} variante{selectedVariantIds.length !== 1 ? 's' : ''} seleccionada{selectedVariantIds.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={handleSyncSelectedToTiendaNube}
            disabled={!!syncSelectedLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold disabled:opacity-50"
          >
            {syncSelectedLoading === 'tn' ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}
            Enviar a Tienda Nube
          </button>
          <button
            onClick={handleSyncSelectedToMercadoLibre}
            disabled={!!syncSelectedLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold disabled:opacity-50"
          >
            {syncSelectedLoading === 'ml' ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            Enviar a Mercado Libre
          </button>
          <button
            onClick={() => setSelectedVariantIds([])}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium"
          >
            <X size={16} />
            Limpiar selección
          </button>
          <button
            onClick={() => setSelectionModeEnabled(false)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-slate-200 text-sm font-medium"
            title="Ocultar cuadros de selección"
          >
            Listo
          </button>
        </div>
      )}

      {/* Barra cuando modo selección está activo pero sin variantes seleccionadas: opción de cerrar */}
      {inventorySubView === 'mine' && selectionModeEnabled && selectedVariantIds.length === 0 && (
        <div className="flex flex-wrap items-center gap-3 p-3 sm:p-4 bg-slate-800/60 border border-slate-600 rounded-xl">
          <span className="text-slate-400 text-sm">Expandí un artículo y marcá las variantes a enviar.</span>
          <button
            type="button"
            onClick={() => setSelectionModeEnabled(false)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-slate-200 text-sm font-medium"
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
                   
                   {/* Móvil: menú de tres puntos (Agregar variante, Editar, Eliminar) */}
                   {isAdminOrWarehouse && (
                     <div className="sm:hidden relative" ref={el => { cardDotsRefs.current[groupKey] = el; }}>
                       <button
                         type="button"
                         onClick={(e) => { e.stopPropagation(); setCardDotsOpenKey(prev => prev === groupKey ? null : groupKey); }}
                         className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 transition-colors touch-manipulation"
                         aria-label="Acciones del artículo"
                       >
                         <MoreVertical size={20} />
                       </button>
                       {cardDotsOpenKey === groupKey && cardDotsPosition && createPortal(
                         <div
                           data-card-dots-dropdown
                           className="py-1 min-w-[200px] bg-slate-800 border border-slate-600 rounded-xl shadow-xl z-[9998]"
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
                             className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-200 hover:bg-slate-700 rounded-lg"
                           >
                             <PlusCircle size={18} className="text-blue-400 shrink-0" />
                             Agregar variante
                           </button>
                           {(groupVariants[0] as any)?.product_id && (
                             <>
                               <button
                                 type="button"
                                 onClick={(e) => { e.stopPropagation(); setCardDotsOpenKey(null); setEditingProductGroupKey(groupKey); setEditingProductId((groupVariants[0] as any).product_id); }}
                                 className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-slate-700 rounded-lg"
                               >
                                 <Edit2 size={18} className="text-amber-400 shrink-0" />
                                 Editar artículo
                               </button>
                               <button
                                 type="button"
                                 onClick={(e) => { e.stopPropagation(); setCardDotsOpenKey(null); handleDeleteProduct((groupVariants[0] as any).product_id, groupKey, displayName); }}
                                 className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-red-200 hover:bg-red-900/30 rounded-lg"
                               >
                                 <Trash2 size={18} className="shrink-0" />
                                 Eliminar artículo
                               </button>
                             </>
                           )}
                         </div>,
                         document.body
                       )}
                     </div>
                   )}

                   {/* Desktop: botones individuales */}
                   {isAdminOrWarehouse && (
                     <button
                       onClick={(e) => { e.stopPropagation(); handleAddVariant(groupKey); }}
                       className="hidden sm:flex p-2.5 min-w-[44px] min-h-[44px] items-center justify-center bg-slate-700 hover:bg-blue-600 hover:text-white rounded-lg text-slate-300 transition-colors touch-manipulation"
                       title="Agregar variante a este modelo"
                     >
                       <PlusCircle size={20} />
                     </button>
                   )}
                   {isAdminOrWarehouse && (groupVariants[0] as any)?.product_id && (
                     <>
                       <button
                         onClick={(e) => { e.stopPropagation(); setEditingProductGroupKey(groupKey); setEditingProductId((groupVariants[0] as any).product_id); }}
                         className="hidden sm:flex p-2.5 min-w-[44px] min-h-[44px] items-center justify-center bg-slate-700 hover:bg-amber-600 hover:text-white rounded-lg text-slate-300 transition-colors touch-manipulation"
                         title="Editar artículo"
                       >
                         <Edit2 size={20} />
                       </button>
                       <button
                         onClick={(e) => { e.stopPropagation(); handleDeleteProduct((groupVariants[0] as any).product_id, groupKey, displayName); }}
                         className="hidden sm:flex p-2.5 min-w-[44px] min-h-[44px] items-center justify-center bg-slate-700 hover:bg-red-600 hover:text-white rounded-lg text-slate-300 transition-colors touch-manipulation"
                         title="Eliminar artículo y todas sus variantes"
                       >
                         <Trash2 size={20} />
                       </button>
                     </>
                   )}

                   <div className={`p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-transform duration-300 ${isExpanded ? 'bg-blue-600 text-white rotate-180' : 'bg-slate-700 text-slate-400'}`}>
                      <ChevronDown size={20} />
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
                    {isAdminOrWarehouse && !loadingVariantsByGroup[groupKey] && variantsToShow.length > 0 && (
                      <div className="flex flex-col sm:flex-row justify-end gap-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openBulkLinkModal(groupKey); }}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors min-h-[44px] touch-manipulation"
                        >
                          <Link size={16} />
                          Vincular grupo con ML / TN
                        </button>
                      </div>
                    )}
                    {loadingVariantsByGroup[groupKey] && (
                      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 text-slate-400 text-sm flex items-center gap-3">
                        <Loader2 className="animate-spin text-blue-400 shrink-0" size={22} />
                        <span>Cargando variantes…</span>
                      </div>
                    )}
                    {!loadingVariantsByGroup[groupKey] && variantsToShow.length === 0 && (filterColor !== 'ALL' || hideZeroStock || filterSync === 'MISMATCH') && (
                      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 text-slate-400 text-sm">
                        {hideZeroStock
                          ? 'No hay variantes con stock para mostrar.'
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
                      const parts = (product.sku || '').toString().split('-');
                      const sizeLabel = product.size || (parts.length >= 3 ? parts[parts.length - 2] : '');
                      const colorLabel = product.color || (parts.length >= 3 ? parts[parts.length - 1] : '');
                      const talleDisplay = labelTalle(sizeLabel) || sizeLabel;

                      return (
                        <div key={product.id} className="bg-slate-800 rounded-xl p-3 border border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
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
                                    <div className="flex items-center gap-2 animate-fade-in bg-slate-900 p-2 sm:p-1.5 rounded-lg border border-slate-600">
                                      <button 
                                        onClick={() => adjustStock(product.id, product.stock, -1)}
                                        className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center bg-slate-800 rounded-lg sm:rounded hover:bg-slate-700 text-slate-300 active:scale-95 touch-manipulation"
                                      >
                                        <Minus size={18} className="sm:w-4 sm:h-4" />
                                      </button>
                                      <input 
                                        type="number" 
                                        autoFocus
                                        value={product.stock}
                                        onChange={(e) => onManualStockInputChange(product.id, e.target.value)}
                                        onBlur={(e) => commitManualStock(product.id, e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            (e.target as HTMLInputElement).blur();
                                            setEditingStockId(null);
                                          }
                                        }}
                                        className="w-14 sm:w-12 bg-transparent text-center font-bold text-white text-lg outline-none"
                                      />
                                      <button 
                                        onClick={() => adjustStock(product.id, product.stock, 1)}
                                        className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center bg-blue-600 rounded-lg sm:rounded text-white hover:bg-blue-500 active:scale-95 touch-manipulation"
                                      >
                                        <Plus size={18} className="sm:w-4 sm:h-4" />
                                      </button>
                                      <button 
                                        type="button"
                                        onClick={() => setEditingStockId(null)}
                                        className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center bg-green-600 rounded-lg sm:rounded text-white hover:bg-green-500 active:scale-95 ml-1 touch-manipulation"
                                        title="Listo (el stock se guarda al salir del campo)"
                                      >
                                        <Check size={18} className="sm:w-4 sm:h-4" />
                                      </button>
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
                                       onClick={() => handleOpenLinkModal(product)}
                                       className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-750 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-indigo-400 border border-slate-700 transition-colors touch-manipulation"
                                       title="Vincular con Mercado Libre / Tienda Nube"
                                      >
                                       <Link size={16} />
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
                                         baselineManualStockRef.current[product.id] = Number((product as any).stock ?? (product as any).stock_total ?? 0);
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

      {/* LINK EXTERNAL IDS MODAL */}
      {linkingVariant && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
           <div className="bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-700/80 w-full sm:max-w-2xl flex flex-col shadow-2xl animate-fade-in-up max-h-[92vh] sm:max-h-[90vh] overflow-hidden flex-1 sm:flex-initial pt-[env(safe-area-inset-top)] sm:pt-0">
              <div className="shrink-0 p-4 sm:p-5 border-b border-slate-700/80 flex justify-between items-center">
                 <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2 min-w-0">
                    <span className="p-1.5 rounded-lg bg-indigo-500/20 shrink-0"><Link size={18} className="text-indigo-400" /></span>
                    <span className="truncate">Vincular producto</span>
                 </h3>
                 <button onClick={() => setLinkingVariant(null)} className="p-2.5 min-w-[44px] min-h-[44px] rounded-xl text-slate-400 hover:text-white hover:bg-slate-700/80 transition touch-manipulation shrink-0" aria-label="Cerrar">
                    <X size={20} />
                 </button>
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 space-y-6 min-h-0 touch-scroll">
                 {/* Lo que tenés que saber: explicación directa */}
                 <div className="rounded-xl bg-amber-950/40 border-2 border-amber-600/50 p-4 space-y-3">
                    <h4 className="text-sm font-black text-amber-200 uppercase tracking-wide flex items-center gap-2">
                       <AlertTriangle size={18} className="shrink-0" /> Lo que tenés que saber
                    </h4>
                    <ul className="text-[13px] text-slate-200 space-y-2 list-none">
                       <li className="flex gap-2"><span className="text-amber-400 font-bold shrink-0">•</span> <strong>Tu stock está siempre en unidades</strong> (lo que tenés en depósito).</li>
                       <li className="flex gap-2"><span className="text-amber-400 font-bold shrink-0">•</span> Para cada publicación elegís si vendés por <strong>unidad (x1)</strong> o por <strong>pack (x2, x6, etc.)</strong>.</li>
                       <li className="flex gap-2"><span className="text-amber-400 font-bold shrink-0">•</span> <strong>Venta por unidad (x1):</strong> si venden 1, se descuenta <strong>1</strong> del stock.</li>
                       <li className="flex gap-2"><span className="text-amber-400 font-bold shrink-0">•</span> <strong>Venta por pack (x2):</strong> si venden 1 pack, se descuentan <strong>2</strong> unidades del stock.</li>
                       <li className="flex gap-2"><span className="text-amber-400 font-bold shrink-0">•</span> La misma variante puede estar en dos publicaciones (una “por unidad” y otra “pack x2”); cada venta descuenta lo que corresponde.</li>
                    </ul>
                 </div>

                 {/* SKU unificado: inventario, ML y TN */}
                 <div className="rounded-xl bg-indigo-900/20 border border-indigo-700/50 p-4 space-y-3">
                    <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wide flex items-center gap-1.5">
                       <Tag size={12} />
                       SKU unificado (inventario, Mercado Libre y Tienda Nube)
                    </p>
                    <p className="text-[11px] text-slate-400">
                       Usá el mismo código en los tres. Así se sincroniza el stock y se identifican los pedidos con un solo SKU.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                       <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-600/50 text-slate-400 text-xs">
                          <Lock size={12} className="shrink-0" /> En inventario:
                       </span>
                       <span className="font-mono text-sm text-white">{linkingVariant.sku}</span>
                    </div>
                    <div className="flex gap-2 flex-wrap items-center">
                       <input 
                         type="text" 
                         value={linkExternalSku}
                         onChange={(e) => setLinkExternalSku(e.target.value)}
                         placeholder="Mismo código para ML y TN (o dejalo igual)"
                         className="flex-1 min-w-[140px] bg-slate-800/60 border border-slate-600/60 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/30 outline-none font-mono text-sm transition"
                       />
                       <button
                         type="button"
                         onClick={() => setLinkExternalSku(linkingVariant.sku)}
                         className="px-3 py-2.5 rounded-xl bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs font-bold whitespace-nowrap transition"
                       >
                          Usar mismo código
                       </button>
                    </div>
                    <p className="text-[10px] text-slate-500">
                       Si en ML o TN usás otro código, ingresalo arriba. Si dejás el mismo que en inventario (o tocás &quot;Usar mismo código&quot;), queda unificado.
                    </p>
                 </div>

                 {/* Cómo obtener los IDs */}
                 <div className="rounded-xl bg-slate-800/50 border border-slate-600/50 p-3">
                    <p className="text-[11px] text-slate-400 mb-1 font-semibold">¿Dónde obtengo los IDs?</p>
                    <p className="text-[10px] text-slate-500">
                       Podés pegar el <strong>link de la publicación</strong> o el <strong>ID del padre</strong> (ML o TN) y tocar <strong>&quot;Cargar variantes&quot;</strong>: se listan las variantes y, si el SKU coincide con el de esta fila, se elige sola. También podés copiar IDs desde <strong>Vista Mercado Libre</strong> / <strong>Vista Tienda Nube</strong> (expandir la fila y usar el ícono copiar).
                    </p>
                 </div>

                 {/* TIENDA NUBE arriba, MERCADO LIBRE abajo */}
                 <div className="flex flex-col gap-4">
                 {/* Tienda Nube */}
                 <div className="space-y-3 rounded-xl bg-slate-800/50 border border-cyan-700/40 p-4">
                    <h4 className="text-xs font-black text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                       <Cloud size={14} className="text-cyan-400" /> Tienda Nube
                    </h4>
                    <div className="grid grid-cols-1 gap-3">
                       <div>
                          <label className="text-[11px] text-slate-500 block mb-1">ID o link del producto</label>
                          <div className="flex gap-2">
                             <input 
                               type="text" 
                               value={linkTnId}
                               onChange={(e) => { setLinkTnId(e.target.value); setLinkTnVariants(null); }}
                               placeholder="Link o ID numérico TN"
                               className="flex-1 bg-slate-800/60 border border-slate-600/60 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:border-cyan-500/70 outline-none font-mono text-sm"
                             />
                             <button
                               type="button"
                               onClick={handleLoadTnVariants}
                               disabled={!linkTnId.trim() || loadingTnVariants}
                               className="px-3 py-2.5 rounded-lg bg-cyan-600/80 hover:bg-cyan-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                             >
                               {loadingTnVariants ? '...' : 'Cargar variantes'}
                             </button>
                          </div>
                       </div>
                       {linkTnVariants && linkTnVariants.length > 0 && (
                          <div>
                             <label className="text-[11px] text-slate-500 block mb-1">Elegir variante (por SKU/talle/color)</label>
                             <select
                               value={linkTnVariantId}
                               onChange={(e) => setLinkTnVariantId(e.target.value)}
                               className="w-full bg-slate-800/60 border border-slate-600/60 rounded-lg px-3 py-2.5 text-white focus:border-cyan-500/70 outline-none font-mono text-sm"
                             >
                               <option value="">Seleccionar...</option>
                               {linkTnVariants.map((v) => (
                                 <option key={String(v.variantId)} value={String(v.variantId)}>
                                   {v.sku || '(sin SKU)'} — {[formatSizeForLink(v.size), v.color].filter(Boolean).join(' / ') || '—'}
                                 </option>
                               ))}
                             </select>
                          </div>
                       )}
                       <div>
                          <label className="text-[11px] text-slate-500 block mb-1">ID de la variante</label>
                          <input 
                            type="text" 
                            value={linkTnVariantId}
                            onChange={(e) => setLinkTnVariantId(e.target.value)}
                            placeholder="Se llena al cargar variantes o manual"
                            className="w-full bg-slate-800/60 border border-slate-600/60 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:border-cyan-500/70 outline-none font-mono text-sm"
                          />
                       </div>
                    </div>
                    <p className="text-[10px] text-slate-500">Poné el ID del producto y tocá Cargar variantes para que se reconozcan por SKU.</p>
                 </div>

                 {/* Mercado Libre */}
                 <div className="space-y-3 rounded-xl bg-slate-800/50 border border-amber-700/40 p-4">
                    <h4 className="text-xs font-black text-amber-300 uppercase tracking-wider flex items-center gap-2">
                       <Zap size={14} className="text-amber-400" /> Mercado Libre
                    </h4>
                    <p className="text-[10px] text-amber-200/90 bg-amber-900/30 border border-amber-700/50 rounded-lg px-2.5 py-2">Si esta variante tiene su propia publicación en ML (una por talle/color), poné solo el ID de esa publicación abajo y guardá. El stock se sincronizará con esa publicación.</p>
                    <div className="grid grid-cols-1 gap-3">
                       <div>
                          <label className="text-[11px] text-slate-500 block mb-1">ID o link de la publicación ML</label>
                          <div className="flex gap-2">
                             <input 
                               type="text" 
                               value={linkMlId}
                               onChange={(e) => { setLinkMlId(e.target.value); setLinkMlVariations(null); }}
                               placeholder="Link o MLA…"
                               className="flex-1 bg-slate-800/60 border border-slate-600/60 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:border-amber-500/70 outline-none font-mono text-sm"
                             />
                             <button
                               type="button"
                               onClick={handleLoadMlVariations}
                               disabled={!linkMlId.trim() || loadingMlVariations}
                               className="px-3 py-2.5 rounded-lg bg-amber-600/80 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                             >
                               {loadingMlVariations ? '...' : 'Cargar variantes'}
                             </button>
                          </div>
                       </div>
                       {linkMlVariations && linkMlVariations.length > 0 && (
                          <div>
                             <label className="text-[11px] text-slate-500 block mb-1">Elegir variación (por SKU/talle/color)</label>
                             <select
                               value={linkMlVariantId}
                               onChange={(e) => setLinkMlVariantId(e.target.value)}
                               className="w-full bg-slate-800/60 border border-slate-600/60 rounded-lg px-3 py-2.5 text-white focus:border-amber-500/70 outline-none font-mono text-sm"
                             >
                               <option value="">Seleccionar...</option>
                               {linkMlVariations.map((v) => (
                                 <option key={v.variationId} value={String(v.variationId)}>
                                   {v.sku || '(sin SKU)'} — {[formatSizeForLink(v.size), v.color].filter(Boolean).join(' / ') || '—'}
                                 </option>
                               ))}
                             </select>
                          </div>
                       )}
                       <div>
                          <label className="text-[11px] font-medium text-slate-400 block mb-1.5">ID variación ML (si tiene talles/colores)</label>
                          <input 
                            type="text" 
                            value={linkMlVariantId}
                            onChange={(e) => setLinkMlVariantId(e.target.value)}
                            placeholder="Ej: 177049455976 — se llena al cargar variantes o manual"
                            className="w-full bg-slate-800/60 border border-slate-600/60 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:border-amber-500/70 outline-none font-mono text-sm"
                          />
                       </div>
                    </div>
                    {linkSaveStockFromML !== null && (
                      <p className="text-xs text-green-400 font-medium flex items-center gap-1.5">
                        <CheckCircle2 size={14} /> Stock traído de Mercado Libre: {linkSaveStockFromML} unidades guardadas en tu inventario.
                      </p>
                    )}
                 </div>
                 </div>

                 {/* PACK (UNIDADES POR PUBLICACIÓN) - igual que la referencia */}
                 <div className="rounded-xl bg-slate-800/50 border border-slate-600/60 p-4 sm:p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                       <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider">Pack (unidades por publicación)</h4>
                       <p className="text-[11px] text-slate-400 font-medium bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-600/50">
                          <span className="text-white">100 un.</span>
                          <span className="text-slate-500 mx-1">÷</span>
                          <span className="text-amber-400 font-bold">x2</span>
                          <span className="text-slate-500 mx-1">=</span>
                          <span className="text-green-400 font-bold">50</span>
                          <span className="text-slate-500 ml-1">en la publicación</span>
                       </p>
                    </div>
                    <p className="text-[10px] text-slate-500 -mt-2">
                      Cuántas unidades de tu depósito forman una unidad en la publicación. x1 = venta por unidad; x2 = pack de 2 (cada venta descuenta 2 del stock).
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                       <div className="space-y-3">
                          <label className="text-[11px] font-semibold text-amber-400/90 uppercase tracking-wide block">Mercado Libre</label>
                          <div className="flex flex-wrap gap-2">
                             {[1, 2, 3, 6, 12].map((n) => (
                               <button
                                 key={n}
                                 type="button"
                                 onClick={() => setLinkPackMl(n)}
                                 className={`min-w-[44px] px-3 py-2 rounded-lg text-sm font-bold transition ${linkPackMl === n ? 'bg-amber-500 text-white shadow-md shadow-amber-900/30' : 'bg-slate-700/80 text-slate-400 hover:bg-slate-600 hover:text-white border border-slate-600/50'}`}
                               >
                                 x{n}
                               </button>
                             ))}
                          </div>
                          <input type="number" min={1} max={999} value={linkPackMl} onChange={(e) => setLinkPackMl(Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1)))} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white font-mono text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30" placeholder="Otro valor" aria-label="Pack ML (unidades por publicación)" />
                       </div>
                       <div className="space-y-3">
                          <label className="text-[11px] font-semibold text-cyan-400/90 uppercase tracking-wide block">Tienda Nube</label>
                          <div className="flex flex-wrap gap-2">
                             {[1, 2, 3, 6, 12].map((n) => (
                               <button
                                 key={n}
                                 type="button"
                                 onClick={() => setLinkPackTn(n)}
                                 className={`min-w-[44px] px-3 py-2 rounded-lg text-sm font-bold transition ${linkPackTn === n ? 'bg-cyan-500 text-white shadow-md shadow-cyan-900/30' : 'bg-slate-700/80 text-slate-400 hover:bg-slate-600 hover:text-white border border-slate-600/50'}`}
                               >
                                 x{n}
                               </button>
                             ))}
                          </div>
                          <input type="number" min={1} max={999} value={linkPackTn} onChange={(e) => setLinkPackTn(Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1)))} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white font-mono text-sm outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30" placeholder="Otro valor" aria-label="Pack TN (unidades por publicación)" />
                       </div>
                    </div>
                 </div>

                 {/* Botón para agregar otra publicación (por pack) */}
                 <div className="space-y-3">
                    {variantPublications.length > 0 && (
                       <ul className="space-y-2">
                          {variantPublications.map((pub) => (
                             <li key={pub.id} className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
                                <span className="text-xs font-mono text-slate-300 truncate">
                                   {pub.platform === 'mercadolibre' ? 'ML' : 'TN'} {pub.external_product_id}{pub.external_variant_id ? ` / ${pub.external_variant_id}` : ''} · pack x{pub.pack_size}
                                </span>
                                <button type="button" onClick={() => handleDeleteVariantPublication(pub.id)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-700/50 transition shrink-0" aria-label="Quitar"><Trash2 size={14} /></button>
                             </li>
                          ))}
                       </ul>
                    )}
                    {!showAddPublicationForm ? (
                       <button
                         type="button"
                         onClick={() => setShowAddPublicationForm(true)}
                         className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600/90 hover:bg-indigo-500 text-white text-sm font-semibold border border-indigo-500/50 transition"
                       >
                          <Plus size={18} />
                          Agregar otra publicación (por pack)
                       </button>
                    ) : (
                       <div className="rounded-lg bg-slate-900/60 border border-slate-600/60 p-4 space-y-3">
                          <p className="text-[11px] font-semibold text-slate-400">Nueva publicación por pack</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                             <div>
                                <label className="text-[11px] text-slate-500 block mb-1">Plataforma</label>
                                <select value={addPubPlatform} onChange={(e) => setAddPubPlatform(e.target.value as 'mercadolibre' | 'tiendanube')} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-indigo-500">
                                   <option value="mercadolibre">Mercado Libre</option>
                                   <option value="tiendanube">Tienda Nube</option>
                                </select>
                             </div>
                             <div>
                                <label className="text-[11px] text-slate-500 block mb-1">{addPubPlatform === 'tiendanube' ? 'ID o link producto TN' : 'ID o link publicación ML'}</label>
                                <input type="text" value={addPubProductId} onChange={(e) => setAddPubProductId(e.target.value)} placeholder={addPubPlatform === 'tiendanube' ? 'Link o número de producto' : 'Link o MLA…'} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white font-mono text-sm placeholder-slate-500 outline-none focus:border-indigo-500" />
                             </div>
                          </div>
                          <div>
                             <label className="text-[11px] text-slate-500 block mb-1">{addPubPlatform === 'tiendanube' ? 'ID variante TN (opcional)' : 'ID variación ML (opcional)'}</label>
                             <input type="text" value={addPubVariantId} onChange={(e) => setAddPubVariantId(e.target.value)} placeholder="Si tiene talles/colores" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white font-mono text-sm placeholder-slate-500 outline-none focus:border-indigo-500" />
                          </div>
                          <div>
                             <label className="text-[11px] text-slate-500 block mb-1.5">Pack (unidades por publicación)</label>
                             <div className="flex flex-wrap gap-2 items-center">
                                {[1, 2, 3, 6, 12].map((n) => (
                                  <button key={n} type="button" onClick={() => setAddPubPackSize(n)} className={`min-w-[44px] px-3 py-2 rounded-lg text-sm font-bold transition ${addPubPackSize === n ? 'bg-indigo-500 text-white' : 'bg-slate-700/80 text-slate-400 hover:bg-slate-600 hover:text-white border border-slate-600/50'}`}>x{n}</button>
                                ))}
                                <input type="number" min={1} max={999} value={addPubPackSize} onChange={(e) => setAddPubPackSize(Math.max(1, parseInt(e.target.value, 10) || 1))} className="w-20 bg-slate-800 border border-slate-600 rounded-lg px-2 py-2 text-white font-mono text-sm outline-none focus:border-indigo-500" title="Otro valor" />
                             </div>
                             <p className="text-[10px] text-slate-500 mt-1">x2 = pack de 2 (cada venta descuenta 2 del stock).</p>
                          </div>
                          <div className="flex gap-2 pt-1">
                             <button type="button" onClick={() => setShowAddPublicationForm(false)} className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium transition">Cancelar</button>
                             <button type="button" onClick={handleAddVariantPublication} disabled={addPubSaving || !addPubProductId.trim()} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 whitespace-nowrap">{(addPubSaving ? '...' : 'Agregar publicación')}</button>
                          </div>
                       </div>
                    )}
                 </div>

              </div>
              <div className="shrink-0 p-4 sm:p-5 border-t border-slate-700/80 bg-slate-900/80 space-y-3 min-w-0">
                 <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Desvincular</p>
                 <div className="flex flex-wrap gap-2">
                   <button
                     type="button"
                     onClick={() => handleUnlinkArticle('tiendanube')}
                     className="flex-1 min-w-[calc(50%-0.25rem)] sm:min-w-0 sm:flex-initial px-3 sm:px-4 py-2.5 rounded-xl font-semibold text-cyan-200 bg-cyan-900/20 hover:bg-cyan-800/30 border border-cyan-700/30 transition text-xs sm:text-sm touch-manipulation min-h-[44px]"
                     title="Quita el vínculo del artículo y sus variantes con Tienda Nube"
                   >
                     Desvincular TN
                   </button>
                   <button
                     type="button"
                     onClick={() => handleUnlinkArticle('mercadolibre')}
                     className="flex-1 min-w-[calc(50%-0.25rem)] sm:min-w-0 sm:flex-initial px-3 sm:px-4 py-2.5 rounded-xl font-semibold text-amber-200 bg-amber-900/20 hover:bg-amber-800/30 border border-amber-700/30 transition text-xs sm:text-sm touch-manipulation min-h-[44px]"
                     title="Quita el vínculo del artículo y sus variantes con Mercado Libre"
                   >
                     Desvincular ML
                   </button>
                   <button
                     type="button"
                     onClick={() => handleUnlinkArticle('both')}
                     className="w-full sm:w-auto px-3 sm:px-4 py-2.5 rounded-xl font-semibold text-red-200 bg-red-900/20 hover:bg-red-800/30 border border-red-700/30 transition text-xs sm:text-sm touch-manipulation min-h-[44px]"
                     title="Quita el vínculo del artículo y sus variantes con TN y ML"
                   >
                     Desvincular todo
                   </button>
                 </div>
                 <div className="flex flex-col sm:flex-row gap-2 sm:justify-end sm:items-center pt-1 border-t border-slate-700/50">
                   <button
                     type="button"
                     onClick={() => setLinkingVariant(null)}
                     className="w-full sm:w-auto px-4 py-2.5 rounded-xl font-semibold text-slate-300 bg-slate-700/60 hover:bg-slate-600 border border-slate-600/60 transition text-sm touch-manipulation min-h-[44px]"
                   >
                     Cancelar
                   </button>
                   <button
                     type="button"
                     onClick={handleSaveLink}
                     className="w-full sm:w-auto px-5 py-2.5 rounded-xl font-semibold bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/30 active:scale-[0.98] transition flex items-center justify-center gap-2 text-sm touch-manipulation min-h-[44px]"
                   >
                     <CheckCircle2 size={16} className="shrink-0" />
                     Guardar vínculos
                   </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Modal Vincular grupo en lote */}
      {showBulkLinkModal && bulkLinkGroupKey && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setShowBulkLinkModal(false)}>
          <div className="bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-700 shadow-2xl w-full sm:max-w-4xl max-h-[92vh] sm:max-h-[90vh] flex flex-col flex-1 sm:flex-initial pt-[env(safe-area-inset-top)] sm:pt-0" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-700 flex justify-between items-center shrink-0">
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 min-w-0">
                <Link size={20} className="text-indigo-400 shrink-0" />
                <span className="truncate">Vincular grupo con ML y TN</span>
              </h3>
              <button type="button" onClick={() => setShowBulkLinkModal(false)} className="text-slate-400 hover:text-white p-2.5 min-w-[44px] min-h-[44px] rounded-lg hover:bg-slate-700 transition touch-manipulation" aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto overflow-x-auto flex-1 space-y-4 min-h-0 touch-scroll">
              <p className="text-sm text-slate-400">
                Grupo: <strong className="text-white font-mono">{bulkLinkGroupKey}</strong>. Podés pegar el <strong>link</strong> o el ID de publicación ML y de producto TN. Como ML y TN usan el mismo SKU, se empareja primero por <strong>SKU</strong> y si no coincide por <strong>talle y color</strong>.
              </p>
              <p className="text-sm text-amber-200/90 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
                <strong>Si cada variante es una publicación en ML</strong> (sin ID padre): no hace falta cargar &quot;ID publicación Mercado Libre&quot;. Escribí en la columna <strong>Variación ML</strong> el ID de cada publicación (ej. MLA3022605728) por fila y guardá.
              </p>
              {bulkLinkLoading && bulkLinkVariants.length === 0 ? (
                <div className="text-slate-400 py-8 text-center">Cargando variantes del grupo...</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-400">Link o ID publicación ML</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={bulkLinkMlId}
                          onChange={(e) => setBulkLinkMlId(e.target.value)}
                          placeholder="Link o MLA…"
                          className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-sm"
                        />
                        <button type="button" onClick={handleBulkLoadMl} disabled={!bulkLinkMlId.trim() || bulkLinkLoading} className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50">
                          {bulkLinkLoading ? '...' : 'Cargar'}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-400">Link o ID producto TN</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={bulkLinkTnId}
                          onChange={(e) => setBulkLinkTnId(e.target.value)}
                          placeholder="Link o número"
                          className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-sm"
                        />
                        <button type="button" onClick={handleBulkLoadTn} disabled={!bulkLinkTnId.trim() || bulkLinkLoading} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium disabled:opacity-50">
                          {bulkLinkLoading ? '...' : 'Cargar'}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
                    <button
                      type="button"
                      onClick={handleBulkLoadBothAndMatch}
                      disabled={!bulkLinkMlId.trim() || !bulkLinkTnId.trim() || bulkLinkLoading || bulkLinkVariants.length === 0}
                      className="px-4 py-3 sm:py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 min-h-[44px] touch-manipulation"
                    >
                      <Link size={16} />
                      Cargar y emparejar todo
                    </button>
                    <span className="text-xs text-slate-500">Con ambos enlaces o IDs cargados se emparejan automáticamente por SKU y talle/color.</span>
                  </div>
                  {(bulkLinkMlVariations.length > 0 || bulkLinkTnVariants.length > 0) && (
                    <button type="button" onClick={() => runBulkAutoMatch(bulkLinkVariants, bulkLinkMlVariations, bulkLinkTnVariants)} className="text-sm text-indigo-400 hover:text-indigo-300">
                      Volver a emparejar (SKU, luego talle/color)
                    </button>
                  )}
                  {(bulkLinkMlVariations.length > 0 || bulkLinkTnVariants.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={bulkLinkMlSearch}
                        onChange={(e) => setBulkLinkMlSearch(e.target.value)}
                        placeholder={`Filtrar opciones ML (${bulkLinkMlVariations.length}) por SKU/talle/color/ID`}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-xs"
                      />
                      <input
                        type="text"
                        value={bulkLinkTnSearch}
                        onChange={(e) => setBulkLinkTnSearch(e.target.value)}
                        placeholder={`Filtrar opciones TN (${bulkLinkTnVariants.length}) por SKU/talle/color/ID`}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-xs"
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const variantIds = Array.from(
                        new Set(
                          (bulkLinkVariants || [])
                            .map((v) => String(v?.variantId || '').trim())
                            .filter(Boolean)
                        )
                      );
                      if (!bulkLinkProductId && variantIds.length === 0) return;
                      openArticleStockHistory({
                        productId: bulkLinkProductId || undefined,
                        variantIds,
                        title: bulkLinkGroupKey || 'Artículo'
                      });
                    }}
                    disabled={!bulkLinkProductId && (bulkLinkVariants || []).length === 0}
                    className="px-3 py-2.5 min-h-[44px] inline-flex items-center justify-center gap-2 bg-slate-700 hover:bg-violet-600 hover:text-white rounded-lg text-slate-200 text-sm font-semibold transition-colors touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Ver historial de stock del artículo"
                  >
                    <History size={18} />
                    <span className="hidden sm:inline">Historial</span>
                  </button>
                  {bulkLinkVariants.length > 0 && (
                    <div className="rounded-xl border border-slate-700 overflow-x-auto touch-scroll scrollbar-hide -mx-1 sm:mx-0">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead>
                          <tr className="border-b border-slate-700 bg-slate-800/80">
                            <th className="text-left text-slate-400 font-semibold p-3">Mi variante (talle / color)</th>
                            <th className="text-left text-slate-400 font-semibold p-3">Variación ML</th>
                            <th className="text-left text-slate-400 font-semibold p-3">Variante TN</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bulkLinkVariants.map(v => (
                            <tr key={v.variantId} className="border-b border-slate-700/50 hover:bg-slate-800/30">
                              <td className="p-3">
                                <input
                                  type="text"
                                  value={bulkLinkSkuEdits[v.variantId] ?? v.sku ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setBulkLinkSkuEdits(prev => ({ ...prev, [v.variantId]: val }));
                                  }}
                                  placeholder="SKU local"
                                  className="w-full max-w-[240px] bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-blue-200 text-xs font-mono"
                                />
                                <span className="text-slate-500 ml-2">— {v.size} / {v.color}</span>
                              </td>
                              <td className="p-3">
                                <div className="flex flex-col gap-1.5">
                                  <input
                                    type="text"
                                    value={bulkLinkAssignments[v.variantId]?.ml ?? ''}
                                    onChange={(e) => {
                                      const val = e.target.value.trim();
                                      setBulkLinkAssignments(prev => ({
                                        ...prev,
                                        [v.variantId]: { ...prev[v.variantId], ml: val }
                                      }));
                                    }}
                                    placeholder="MLA... (cada variante = una publicación)"
                                    className="w-full max-w-[220px] bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs font-mono"
                                  />
                                  {bulkLinkMlVariations.length > 0 && (
                                    <select
                                      value=""
                                      onChange={(e) => {
                                        const mlVal = e.target.value;
                                        if (!mlVal) return;
                                        setBulkLinkAssignments(prev => ({
                                          ...prev,
                                          [v.variantId]: { ...prev[v.variantId], ml: mlVal }
                                        }));
                                      }}
                                      className="w-full max-w-[220px] bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-slate-300 text-xs"
                                    >
                                      <option value="">Rellenar desde publicación cargada</option>
                                      {filteredBulkLinkMlVariations.map(m => (
                                        <option key={String(m.variationId)} value={String(m.variationId)}>
                                          {m.sku || '(sin SKU)'} — {[formatSizeForLink(m.size), m.color].filter(Boolean).join(' / ') || '—'}
                                        </option>
                                      ))}
                                      {filteredBulkLinkMlVariations.length === 0 && (
                                        <option value="" disabled>Sin coincidencias con el filtro</option>
                                      )}
                                    </select>
                                  )}
                                  {(() => {
                                    const mlVal = bulkLinkAssignments[v.variantId]?.ml ?? '';
                                    const mlMatch = mlVal && bulkLinkMlVariations.find(m => String(m.variationId) === String(mlVal));
                                    if (!mlMatch) return null;
                                    return (
                                      <span className="text-xs text-slate-400 mt-0.5">
                                        <span className="font-mono text-amber-200/90">{mlMatch.sku || '—'}</span>
                                        <span className="ml-1.5">— {[formatSizeForLink(mlMatch.size), mlMatch.color].filter(Boolean).join(' / ') || '—'}</span>
                                      </span>
                                    );
                                  })()}
                                </div>
                              </td>
                              <td className="p-3">
                                {(() => {
                                  const tnCurrent = bulkLinkAssignments[v.variantId]?.tn ?? '';
                                  const tnOptions = getVisibleBulkLinkTnVariants(tnCurrent);
                                  return (
                                <select
                                  value={tnCurrent}
                                  onChange={(e) => {
                                    const tnVal = e.target.value;
                                    const tnOpt = bulkLinkTnVariants.find(t => String(t.variantId) === tnVal);
                                    const mlMatch = tnOpt && bulkLinkMlVariations.find(m => bulkLinkSkuMatch(tnOpt.sku, m.sku));
                                    setBulkLinkAssignments(prev => ({
                                      ...prev,
                                      [v.variantId]: {
                                        ml: mlMatch ? String(mlMatch.variationId) : (prev[v.variantId]?.ml ?? ''),
                                        tn: tnVal
                                      }
                                    }));
                                  }}
                                  className="w-full max-w-[220px] bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs"
                                >
                                  <option value="">—</option>
                                  {tnOptions.map(t => (
                                    <option key={String(t.variantId)} value={String(t.variantId)}>
                                      {t.sku || '(sin SKU)'} — {[formatSizeForLink(t.size), t.color].filter(Boolean).join(' / ') || '—'}
                                    </option>
                                  ))}
                                  {tnOptions.length === 0 && (
                                    <option value="" disabled>Sin coincidencias con el filtro</option>
                                  )}
                                </select>
                                  );
                                })()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="p-4 border-t border-slate-700 flex flex-col-reverse sm:flex-row justify-end gap-3 bg-slate-800/30 shrink-0">
              <button type="button" onClick={() => setShowBulkLinkModal(false)} className="px-4 py-3 sm:py-2.5 rounded-xl font-semibold text-slate-300 bg-slate-700 hover:bg-slate-600 text-sm touch-manipulation min-h-[44px]">
                Cancelar
              </button>
              <button type="button" onClick={handleBulkLinkSave} disabled={bulkLinkSaving || !bulkLinkProductId || bulkLinkVariants.length === 0} className="px-5 py-3 sm:py-2.5 rounded-xl font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 text-sm flex items-center justify-center gap-2 touch-manipulation min-h-[44px]">
                {bulkLinkSaving ? 'Guardando...' : 'Guardar vinculaciones'}
              </button>
            </div>
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
