import React, { useState, useEffect, useRef } from 'react';
import { Search, Filter, Plus, Cloud, Zap, Package, RefreshCw, AlertTriangle, Minus, CheckCircle2, XCircle, Edit2, Check, ChevronDown, Box, X, Layers, Tag, DollarSign, Palette, Ruler, PlusCircle, Download, Link, Ship, Info, Upload, Lock } from 'lucide-react';
import { Product, Role, Attribute } from '../types';
import { syncAllStock } from '../services/apiIntegration';
import { api } from '../services/api';
import { labelTalle } from '../utils/tallesTango';
import * as XLSX from 'xlsx';
import MercadoLibreStock from './MercadoLibreStock';
import TiendaNubeStock from './TiendaNubeStock';

const CONCURRENT_VARIANT_REQUESTS = 4;
async function runWithConcurrency<T>(
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

interface InventoryProps {
  products: Product[];
  attributes?: Attribute[];
  role: Role;
  onCreateProducts?: (products: Product[]) => void;
  onUpdateStock?: (productId: string, newStock: number) => void;
  onImportComplete?: () => void;
}

const Inventory: React.FC<InventoryProps> = ({ products, attributes = [], role, onCreateProducts, onUpdateStock, onImportComplete }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [editingStockId, setEditingStockId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  
  // Creation Modal State
  const [isCreating, setIsCreating] = useState(false);
  const [isVariantMode, setIsVariantMode] = useState(false); // New mode for adding variants
  const [newBaseSku, setNewBaseSku] = useState('');
  const [newProductName, setNewProductName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
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

  // Despacho Modal State
  const [showDespachoModal, setShowDespachoModal] = useState(false);
  const [selectedProductForDespacho, setSelectedProductForDespacho] = useState<any>(null);
  const [despachosList, setDespachosList] = useState<any[]>([]);
  const [selectedDespachoId, setSelectedDespachoId] = useState('');
  const [despachoCantidad, setDespachoCantidad] = useState('');
  const [despachoCosto, setDespachoCosto] = useState('');
  const [savingDespacho, setSavingDespacho] = useState(false);

  // Import Tango State
  const [importingTango, setImportingTango] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [inventorySubView, setInventorySubView] = useState<'mine' | 'ml' | 'tn'>('mine');
  const [tangoImportResult, setTangoImportResult] = useState<{ productsCreated: number; variantsCreated: number; variantsUpdated: number; totalProcessed: number; errors: string[] } | null>(null);
  const [serverListRefreshKey, setServerListRefreshKey] = useState(0);
  const tangoFileInputRef = useRef<HTMLInputElement>(null);

  // Filter States
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterSize, setFilterSize] = useState('ALL');
  const [filterStockLevel, setFilterStockLevel] = useState<'ALL' | 'LOW' | 'OUT'>('ALL');
  const [filterSync, setFilterSync] = useState<'ALL' | 'ML' | 'TN' | 'BOTH' | 'NONE'>('ALL');
  const [filterColor, setFilterColor] = useState('ALL');
  const [colorQuery, setColorQuery] = useState('');
  const [colorOpen, setColorOpen] = useState(false);
  const [sortKey, setSortKey] = useState<'SKU' | 'STOCK' | 'VARIANTS'>('SKU');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [serverMode, setServerMode] = useState(true);
  const [serverItems, setServerItems] = useState<Product[]>([]);
  const [serverTotal, setServerTotal] = useState(0);

  const isAdminOrWarehouse = role === Role.ADMIN || role === Role.WAREHOUSE;

  const availableSizes = attributes.filter(a => a.type === 'size');
  
  // Use only colors from the database (attributes loaded from API /colors)
   // But ensure they are sorted numerically/alphabetically
   const availableColors = attributes.filter(a => a.type === 'color').sort((a, b) => {
      const valA = ((a as any).code || a.name || '').toString();
      const valB = ((b as any).code || b.name || '').toString();
      // Try numeric sort
      const na = parseInt(valA);
      const nb = parseInt(valB);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return valA.localeCompare(valB);
   });


  function getProductColorCode(p: Product) {
    const val = ((p as any).color || '').toString().trim().toLowerCase();
    if (val) return val;
    
    const sku = (p.sku || '').toString().trim();
    // Try to find color code pattern (digits at the end or as last segment)
    // 1. Try split by '-'
    const parts = sku.split('-');
    if (parts.length > 1) {
      // Check if last part looks like a color code (digits, possibly with some letters but usually digits for colors like 111, 800)
      // Or if it's a known color format.
      // Assuming last part is color if >= 2 segments.
      return parts[parts.length - 1].trim().toLowerCase();
    }
    
    return '';
  }
  
  function getProductSizeCode(p: Product) {
    const val = ((p as any).size || '').toString().trim().toUpperCase();
    if (val) return val;
    const sku = (p.sku || '').toString().trim();
    const parts = sku.split('-');
    if (parts.length >= 3) {
      return (parts[parts.length - 2] || '').toString().trim().toUpperCase();
    }
    return '';
  }

  useEffect(() => {
    try {
      console.table(products.map(p => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        stock: (p as any).stock_total ?? (p as any).stock ?? 0,
        price: (p as any).base_price ?? (p as any).price ?? 0
      })));
    } catch {
      console.log('Productos', products);
    }
  }, [products]);

  // Helper function to check color match, extracted to be reusable
  function checkColorMatch(p: Product, filterColor: string) {
    if (filterColor === 'ALL') return true;
    
    const filterColorLower = filterColor.toString().trim().toLowerCase();
    
    // Find the selected attribute to get both code and name
    const selectedAttr = availableColors.find(c => ((c as any).code || c.name) === filterColor);
    const targetCode = (selectedAttr ? ((selectedAttr as any).code || '') : filterColor).toString().trim().toLowerCase();
    const targetName = (selectedAttr ? (selectedAttr.name || '') : filterColor).toString().trim().toLowerCase();

    // Get color from product's explicit color property (set when loading variants)
    const explicitColor = ((p as any).color || '').toString().trim().toLowerCase();
    // Get colorCode if available (from loaded variants)
    const explicitColorCode = ((p as any).colorCode || '').toString().trim().toLowerCase();
    
    // Get color from SKU (last segment)
    const sku = (p.sku || '').toString();
    const skuParts = sku.split('-');
    const skuColorPart = skuParts.length >= 1 ? skuParts[skuParts.length - 1].toLowerCase() : '';
    
    // Match by explicit colorCode (most reliable for loaded variants)
    if (explicitColorCode) {
      if (explicitColorCode === targetCode || explicitColorCode === filterColorLower) {
        return true;
      }
    }
    
    // Match by explicit color name
    if (explicitColor) {
      if (explicitColor === targetName || explicitColor === targetCode || explicitColor === filterColorLower) {
        return true;
      }
      // Partial match for color names (e.g., "Negro" matches "negro")
      if (targetName && explicitColor.includes(targetName)) {
        return true;
      }
      if (targetName && targetName.includes(explicitColor)) {
        return true;
      }
    }
    
    // Match by SKU color segment
    if (skuColorPart) {
      if (skuColorPart === targetCode || skuColorPart === targetName || skuColorPart === filterColorLower) {
        return true;
      }
      // Check if any SKU part matches the target code
      if (targetCode && skuParts.some(part => part.toLowerCase() === targetCode)) {
        return true;
      }
    }
    
    // Numeric comparison for codes like "03" vs "3"
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
  }

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
    loadDespachos();
    setShowDespachoModal(true);
  };

  const handleAssignDespacho = async () => {
    if (!selectedDespachoId || !selectedProductForDespacho) {
      alert('Seleccioná un despacho');
      return;
    }

    setSavingDespacho(true);
    try {
      await api.addDespachoItem(selectedDespachoId, {
        product_id: selectedProductForDespacho.productId || selectedProductForDespacho.id,
        variant_id: selectedProductForDespacho.variantId || null,
        cantidad: parseInt(despachoCantidad) || 0,
        costo_unitario: despachoCosto ? parseFloat(despachoCosto) : null,
        descripcion_item: `${selectedProductForDespacho.name} - ${selectedProductForDespacho.sku}`
      });
      
      setShowDespachoModal(false);
      alert('Producto asignado al despacho correctamente');
    } catch (error: any) {
      alert('Error: ' + (error.message || 'No se pudo asignar'));
    } finally {
      setSavingDespacho(false);
    }
  };

  // 1. Server: cargar todos los productos (en páginas de 100) para que el paginado sea solo de vista
  const FETCH_PAGE_SIZE = 100;
  const MAX_PRODUCTS = 2000;
  useEffect(() => {
    if (!serverMode) return;
    (async () => {
      try {
        const sortMap: any = { SKU: 'sku', STOCK: 'stock', VARIANTS: 'sku' };
        const first = await api.getProductsPaged(1, FETCH_PAGE_SIZE, searchTerm || undefined, sortMap[sortKey] || 'sku', sortDir, filterSync);
        setServerTotal(first.total);
        if (first.total <= FETCH_PAGE_SIZE) {
          setServerItems(first.items);
          return;
        }
        const allItems = [...first.items];
        const totalToLoad = Math.min(first.total, MAX_PRODUCTS);
        const totalPages = Math.ceil(totalToLoad / FETCH_PAGE_SIZE);
        for (let p = 2; p <= totalPages; p++) {
          const next = await api.getProductsPaged(p, FETCH_PAGE_SIZE, searchTerm || undefined, sortMap[sortKey] || 'sku', sortDir, filterSync);
          allItems.push(...next.items);
        }
        setServerItems(allItems);
      } catch {
        setServerMode(false);
      }
    })();
  }, [serverMode, searchTerm, sortKey, sortDir, filterSync, serverListRefreshKey]);

  // 2. Filter individual products first (incluye padres para poder evaluar variantes)
  const filteredProducts = (serverMode ? serverItems : products).filter(p => {
    const sku = (p.sku || '').toString().toLowerCase();
    const name = (p.name || '').toString().toLowerCase();
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm || sku.includes(searchLower) || name.includes(searchLower);
    const matchesCategory = filterCategory === 'ALL' || p.category === filterCategory;
    const sizeCode = getProductSizeCode(p);
    const matchesSize = filterSize === 'ALL' || sizeCode === filterSize;
    
    const isParent = sku.split('-').length <= 1;
    const matchesColor = filterColor === 'ALL' ? true : (checkColorMatch(p, filterColor) || isParent);
    
    let matchesStock = true;
    const stockValue = (p as any).stock_total ?? (p as any).stock ?? 0;
    if (filterStockLevel === 'LOW') matchesStock = stockValue > 0 && stockValue < 20;
    if (filterStockLevel === 'OUT') matchesStock = stockValue <= 0;
    
    return matchesSearch && matchesCategory && matchesSize && matchesColor && matchesStock;
  });

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
      const matchesSize = filterSize === 'ALL' || sizeCode === filterSize;
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
    let baseSku = sku;
    if (parts.length >= 3) {
      baseSku = parts.slice(0, -2).join('-');
    } else if (parts.length === 2) {
      baseSku = parts.join('-');
    }
    
    const key = baseSku;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(product);
    return acc;
  }, {} as Record<string, Product[]>), [baseSource]);

  const categories = React.useMemo(() => Array.from(new Set(products.map(p => p.category))), [products]);
  const sizes = React.useMemo(() => Array.from(new Set(products.map(p => (p as any).size).filter(Boolean))), [products]);
  
  const sizeOptions = (() => {
    const attrSizes = attributes.filter(a => a.type === 'size');
    const opts = attrSizes.map(a => {
      const code = (((a as any).code || a.name || '') as string).toString().toUpperCase();
      const label = (a as any).code ? `${((a as any).code || '').toString().toUpperCase()} - ${(a.name || '').toString()}` : (a.name || '').toString();
      return { code, label };
    }).filter(s => s.code);
    if (opts.length > 0) {
      const uniqueByCode = Array.from(new Map(opts.map(o => [o.code, o])).values());
      return uniqueByCode;
    }
    const derived = Array.from(new Set(products.map(p => getProductSizeCode(p)).filter(Boolean)));
    return derived.map(code => ({ code, label: code }));
  })();

  const selectedColorItem = filterColor !== 'ALL' ? availableColors.find(c => (c as any).name === filterColor || (c as any).code === filterColor) : null;
  const selectedColorLabel = selectedColorItem ? `${(selectedColorItem as any).name || ''}` : colorQuery;

  // Ref para no re-ejecutar prefetch por color en cada cambio de products
  const baseSkusRef = useRef<string[]>([]);
  useEffect(() => {
    const source = serverMode ? serverItems : products;
    baseSkusRef.current = Array.from(new Set<string>(source.map((product: Product) => {
      const sku = (product.sku || 'SIN-CODIGO').toString();
      const parts = sku.split('-');
      if (parts.length >= 3) return parts.slice(0, -2).join('-');
      if (parts.length === 2) return parts.join('-');
      return sku;
    })));
  }, [serverMode, serverItems, products]);

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
            tiendaNube: !!(v.externalIds?.tiendaNube && v.externalIds?.tiendaNubeVariant),
            mercadoLibre: !!v.externalIds?.mercadoLibre 
          },
          externalIds: v.externalIds
        }));
        setLoadedVariants(prev => ({ ...prev, [groupName]: mapped }));
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
      alert('Error al exportar. Revisá que el backend esté conectado.');
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
          alert('El archivo no tiene filas. Debe tener columna "Código" (7+3+3) y opcional "Descripción".');
          setImportingTango(false);
          return;
        }
        api.importTangoArticles(rows, true).then((res) => {
          setTangoImportResult(res);
          setServerListRefreshKey((k) => k + 1);
          onImportComplete?.();
        }).catch((err) => {
          alert(err?.message || 'Error al importar. Revisá que el Excel tenga columna Código.');
        }).finally(() => {
          setImportingTango(false);
          if (tangoFileInputRef.current) tangoFileInputRef.current.value = '';
        });
      } catch (err: any) {
        setImportingTango(false);
        alert(err?.message || 'Error leyendo el Excel.');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleSyncStock = async () => {
    setIsSyncing(true);
    await syncAllStock(products);
    setTimeout(() => setIsSyncing(false), 1500);
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
    onUpdateStock(productId, newStock);
  };

  const handleManualStockChange = (productId: string, value: string) => {
    if (!onUpdateStock) return;
    const num = parseInt(value);
    if (isNaN(num)) return;
    const newStock = Math.max(0, num);
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
    onUpdateStock(productId, newStock);
  };

  const [loadedVariants, setLoadedVariants] = useState<Record<string, Product[]>>({});
  const [loadingVariantsByGroup, setLoadingVariantsByGroup] = useState<Record<string, boolean>>({});

  const getGroupRawVariants = (groupKey: string, groupVariants: Product[]) => {
    const lv = loadedVariants[groupKey];
    return (lv && lv.length > 0) ? lv : groupVariants;
  };
  const getGroupFilteredVariants = (groupKey: string, groupVariants: Product[]) => {
    const raw = getGroupRawVariants(groupKey, groupVariants);
    if (filterColor === 'ALL') return raw;
    return raw.filter(p => checkColorMatch(p, filterColor));
  };
  const getGroupDisplayStock = (groupKey: string, groupVariants: Product[]) => {
    const variants = getGroupFilteredVariants(groupKey, groupVariants);
    return variants.reduce((sum, p) => {
      const val = (p as any).stock_total ?? (p as any).stock ?? 0;
      return sum + Number(val);
    }, 0);
  };
  const getGroupHasLowStock = (groupKey: string, groupVariants: Product[]) => {
    const variants = getGroupFilteredVariants(groupKey, groupVariants);
    return variants.some(p => {
      const val = (p as any).stock_total ?? (p as any).stock ?? 0;
      return val > 0 && val < 20;
    });
  };

  // Grupos ya filtrados y ordenados + total de páginas (para que el paginado refleje los filtros)
  const displayGroupsInfo = React.useMemo(() => {
    let groups = Object.entries(groupedProducts).map(([groupKey, groupVariants]: [string, Product[]]) => {
      const totalStock = groupVariants.reduce((sum, p) => {
        const val = (p as any).stock_total ?? (p as any).stock ?? 0;
        return sum + Number(val);
      }, 0);
      const category = groupVariants[0]?.category || 'General';
      return { groupKey, groupVariants, totalStock, category };
    });
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
        const sa = filterColor === 'ALL' ? a.totalStock : getGroupDisplayStock(a.groupKey, a.groupVariants);
        const sb = filterColor === 'ALL' ? b.totalStock : getGroupDisplayStock(b.groupKey, b.groupVariants);
        cmp = sa - sb;
      }
      else if (sortKey === 'VARIANTS') cmp = a.groupVariants.length - b.groupVariants.length;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
    const safePage = Math.min(currentPage, totalPages);
    return { displayGroups: groups, totalPages, safePage };
  }, [groupedProducts, filterColor, sortKey, sortDir, pageSize, currentPage, loadedVariants]);

  // Si tras filtrar la página actual supera el total, volver a la última página válida
  React.useEffect(() => {
    if (displayGroupsInfo.totalPages > 0 && currentPage > displayGroupsInfo.totalPages) {
      setCurrentPage(displayGroupsInfo.totalPages);
    }
  }, [displayGroupsInfo.totalPages, currentPage]);

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => {
      const next = prev.includes(groupName) ? prev.filter(g => g !== groupName) : [...prev, groupName];
      return next;
    });
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
            tiendaNube: !!(v.externalIds?.tiendaNube && v.externalIds?.tiendaNubeVariant),
            mercadoLibre: !!v.externalIds?.mercadoLibre 
          },
          externalIds: v.externalIds
        }));
        setLoadedVariants(prev => ({ ...prev, [groupName]: mapped }));
      }).catch(() => {
        // keep fallback group items
      }).finally(() => {
        setLoadingVariantsByGroup(prev => ({ ...prev, [groupName]: false }));
      });
    }
  };

  const handleOpenLinkModal = (product: Product) => {
    setLinkingVariant(product);
    setLinkTnId(product.externalIds?.tiendaNube || '');
    setLinkTnVariantId(product.externalIds?.tiendaNubeVariant || '');
    setLinkMlId(product.externalIds?.mercadoLibre || '');
    setLinkPackMl(1);
    setLinkPackTn(1);
    setLinkExternalSku((product.sku ?? '').toString());
    setLinkMlVariantId('');
    setLinkSaveStockFromML(null);
    setLinkProduct(null);
    const parts = (product.sku || '').toString().split('-');
    const groupKey = parts.length >= 3 ? parts.slice(0, -2).join('-') : product.sku || '';
    if (groupKey) {
      api.getProductBySku(groupKey).then((p) => {
        if (p) {
          setLinkProduct({ id: p.id, name: p.name, sku: p.sku, price: p.base_price, category: p.category, description: (p as any).description });
          setLinkPackMl(p.mercado_libre_pack_size ?? 1);
          setLinkPackTn(p.tienda_nube_pack_size ?? 1);
          const variant = (p as any).variants?.find((v: any) => v.variant_id === product.id);
          setLinkExternalSku((variant?.external_sku ?? product.sku ?? '').toString());
        } else {
          setLinkExternalSku((product.sku ?? '').toString());
        }
      });
    }
  };

  const handleSaveLink = async () => {
    if (!linkingVariant) return;
    try {
      setLinkSaveStockFromML(null);
      // 1. Update Variant External IDs (si hay Item ML, el backend trae el stock de ML y lo guarda en inventario)
      const linkRes = await api.updateVariantExternalIds(linkingVariant.id, {
        tiendaNubeVariantId: linkTnVariantId || undefined,
        mercadoLibreVariantId: linkMlVariantId || linkMlId || undefined,
        mercadoLibreItemId: linkMlId || undefined,
        externalSku: linkExternalSku.trim() || undefined
      });
      if (typeof (linkRes as any).stockFromML === 'number') {
        setLinkSaveStockFromML((linkRes as any).stockFromML);
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
      
      const parts = linkingVariant.sku.split('-');
      const groupKey = parts.length >= 3 ? parts.slice(0, -2).join('-') : linkingVariant.sku;
      const parentProduct = groupedProducts[groupKey]?.[0];
      
      if (parentProduct && linkTnId) {
        await api.updateProductExternalIds(parentProduct.id, {
          tiendaNubeId: linkTnId
        });
        if (linkMlId) {
             await api.updateProductExternalIds(parentProduct.id, {
                mercadoLibreId: linkMlId
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

      // Update local state to reflect changes immediately
      setLoadedVariants(prev => {
        const group = prev[groupKey] || [];
        return {
          ...prev,
          [groupKey]: group.map(p => p.id === linkingVariant.id ? {
            ...p,
            externalIds: {
              ...p.externalIds,
              tiendaNube: linkTnId,
              tiendaNubeVariant: linkTnVariantId,
              mercadoLibre: linkMlId
            },
            integrations: {
                ...p.integrations,
                tiendaNube: !!(linkTnId && linkTnVariantId),
                mercadoLibre: !!linkMlId
            }
          } : p)
        };
      });

      setLinkingVariant(null);
    } catch (error) {
      console.error(error);
      alert("Error guardando vinculación");
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
    setSelectedColors([]);
    setInitialStock('0');
    setIsCreating(true);
  };

  const handleAddVariant = (groupName: string) => {
    const existingGroup = groupedProducts[groupName];
    if (!existingGroup || existingGroup.length === 0) return;
    
    const baseProduct = existingGroup[0];
    const skuParts = baseProduct.sku.split('-');
    const skuBase = skuParts.length >= 3 ? skuParts.slice(0, -2).join('-') : baseProduct.sku;

    openCreationModal({
      name: baseProduct.name,
      skuBase: skuBase,
      category: baseProduct.category,
      price: baseProduct.price
    });
  };

  const toggleSizeSelection = (sizeName: string) => {
    setSelectedSizes(prev => 
      prev.includes(sizeName) ? prev.filter(s => s !== sizeName) : [...prev, sizeName]
    );
  };

  const toggleColorSelection = (colorName: string) => {
    setSelectedColors(prev => 
      prev.includes(colorName) ? prev.filter(c => c !== colorName) : [...prev, colorName]
    );
  };

  const handleCreateBatch = () => {
    if (!newProductName || !newBaseSku || !newPrice || selectedSizes.length === 0 || selectedColors.length === 0) return;
    if (!onCreateProducts) return;

    const newProducts: Product[] = [];
    let index = 0;

    selectedSizes.forEach(size => {
      selectedColors.forEach(color => {
        index++;
        const skuSuffix = `${size.toUpperCase().substring(0, 2)}-${color.toUpperCase().substring(0, 2)}`;
        const finalSku = `${newBaseSku}-${skuSuffix}`;
        
        newProducts.push({
          id: `p-${Date.now()}-${index}`,
          sku: finalSku,
          name: newProductName,
          category: newCategory || 'General',
          price: parseFloat(newPrice) || 0,
          description: newDescription,
          size: size,
          color: color,
          stock: parseInt(initialStock) || 0,
          integrations: { local: true, mercadoLibre: false, tiendaNube: false }
        });
      });
    });

    onCreateProducts(newProducts);
    setIsCreating(false);
  };

  return (
    <div className="space-y-4 relative">
      {/* Toggle: Mi inventario vs Vista Mercado Libre vs Vista Tienda Nube */}
      <div className="flex rounded-xl bg-slate-800/80 border border-slate-700 p-1">
        <button
          type="button"
          onClick={() => setInventorySubView('mine')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${inventorySubView === 'mine' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
        >
          <Package size={18} />
          Mi inventario
        </button>
        <button
          type="button"
          onClick={() => setInventorySubView('ml')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${inventorySubView === 'ml' ? 'bg-yellow-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
        >
          <Zap size={18} />
          Vista Mercado Libre
        </button>
        <button
          type="button"
          onClick={() => setInventorySubView('tn')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${inventorySubView === 'tn' ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
        >
          <Cloud size={18} />
          Vista Tienda Nube
        </button>
      </div>

      {inventorySubView === 'ml' ? (
        <MercadoLibreStock />
      ) : inventorySubView === 'tn' ? (
        <TiendaNubeStock />
      ) : (
        <>
      {/* Ayuda: unificación código / nombre */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-2 flex items-center gap-2 text-slate-400 text-xs">
        <Info size={16} className="shrink-0 text-blue-400" />
        <span>
          <strong className="text-slate-300">Código</strong> es tu artículo (ej. Tango). <strong className="text-slate-300">Nombre</strong> se completa al sincronizar con Tienda Nube o Mercado Libre (título de la publicación). Así unificás todo en un solo listado.
        </span>
      </div>

      {/* Resultado importación Tango */}
      {tangoImportResult && (
        <div className="bg-emerald-900/40 border border-emerald-700 rounded-xl px-4 py-3 flex items-start justify-between gap-2">
          <div className="text-sm text-emerald-200">
            <p className="font-semibold">Importación Tango finalizada</p>
            <p className="mt-1">
              {tangoImportResult.productsCreated} productos nuevos, {tangoImportResult.variantsCreated} variantes creadas{tangoImportResult.variantsUpdated ? `, ${tangoImportResult.variantsUpdated} actualizadas` : ''}. Procesadas: {tangoImportResult.totalProcessed} filas.
            </p>
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
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {isAdminOrWarehouse && (
          <button 
            onClick={handleSyncStock}
            disabled={isSyncing}
            className="flex-shrink-0 flex items-center gap-2 bg-slate-800 text-blue-400 px-4 py-2.5 rounded-xl border border-slate-700 active:bg-slate-700 shadow-sm"
          >
            <RefreshCw size={16} className={isSyncing ? "animate-spin" : ""} />
            <span className="text-sm font-semibold">Sincronizar APIs</span>
          </button>
        )}
        
        <input
          ref={tangoFileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleImportTangoFile}
        />
        <button
          type="button"
          onClick={() => tangoFileInputRef.current?.click()}
          disabled={importingTango}
          className="flex-shrink-0 flex items-center gap-2 bg-slate-800 text-amber-400 px-4 py-2.5 rounded-xl border border-slate-700 active:bg-slate-700 shadow-sm disabled:opacity-50"
        >
          {importingTango ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
          <span className="text-sm font-semibold">{importingTango ? 'Importando…' : 'Importar Tango'}</span>
        </button>
        <button 
          onClick={exportProductsToExcel}
          disabled={exportingExcel}
          className="flex-shrink-0 flex items-center gap-2 bg-slate-800 text-green-400 px-4 py-2.5 rounded-xl border border-slate-700 active:bg-slate-700 shadow-sm disabled:opacity-50"
        >
          {exportingExcel ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
          <span className="text-sm font-semibold">{exportingExcel ? 'Exportando…' : 'Exportar Excel'}</span>
        </button>

        {isAdminOrWarehouse && (
          <button 
            onClick={() => openCreationModal()}
            className="flex-shrink-0 flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-bold shadow-lg shadow-indigo-900/20 active:scale-95 transition-transform"
          >
            <Plus size={18} />
            <span className="text-sm">Nuevo Modelo</span>
          </button>
        )}
      </div>

      {/* Search Bar & Filters */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input 
              type="text" 
              placeholder="Buscar Código de Producto..." 
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full pl-10 pr-4 py-3 sm:py-3.5 min-h-[48px] bg-slate-900 border border-slate-800 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-white text-sm shadow-sm"
            />
          </div>
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={`min-h-[48px] px-4 rounded-xl border flex items-center justify-center gap-2 font-bold transition-all touch-manipulation ${showFilters ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}
          >
            <Filter size={18} />
            <span className="hidden md:inline">Filtros</span>
            {(filterCategory !== 'ALL' || filterSize !== 'ALL' || filterColor !== 'ALL' || filterStockLevel !== 'ALL' || filterSync !== 'ALL') && (
              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
            )}
          </button>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-in">
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
                       const code = (c as any).code;
                        const label = code ? `${code} ${c.name || ''}` : (c.name || '');
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
                     <option value="NONE">No sincronizado</option>
                   </select>
                   <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={14} />
                </div>
             </div>
          </div>
        )}
      </div>

      {/* Grouped List Container */}
      <div className="space-y-4">
        {(() => {
          const { displayGroups, totalPages, safePage } = displayGroupsInfo;
          const start = (safePage - 1) * pageSize;
          const end = start + pageSize;
          const pageGroups = displayGroups.slice(start, end);
          return pageGroups.map(({ groupKey, groupVariants, totalStock, category }) => {
          const variantsToRender = getGroupFilteredVariants(groupKey, groupVariants);

          const isExpanded = expandedGroups.includes(groupKey);
          const skuLabel = groupKey;
          const rawName = (groupVariants[0]?.name || '').toString().trim();
          const hasRealName = rawName.length > 0 && rawName !== skuLabel;
          const displayName = hasRealName ? rawName : `Artículo ${skuLabel}`;
          const codigoLabel = `Código: ${skuLabel}`;
          
          const filteredTotalStock = getGroupDisplayStock(groupKey, groupVariants);
          const hasLowStock = getGroupHasLowStock(groupKey, groupVariants);
          const displayTotalStock = filterColor === 'ALL' ? totalStock : filteredTotalStock;
          const isFullyOut = displayTotalStock === 0;

          return (
            <div key={groupKey} className={`bg-slate-800 rounded-2xl border transition-all overflow-hidden ${isExpanded ? 'border-blue-500/50 shadow-lg shadow-blue-900/10' : 'border-slate-700'}`}>
              {/* Group Header (Clickable) */}
              <div 
                onClick={() => toggleGroup(groupKey)}
                className="p-4 md:p-5 flex items-center justify-between cursor-pointer hover:bg-slate-750 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${isFullyOut ? 'bg-red-900/20 text-red-500' : 'bg-blue-900/20 text-blue-400'}`}>
                    <Box size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-lg leading-tight">{displayName}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                       <span className="text-[10px] font-mono font-bold text-slate-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-600" title="Código de artículo (Tango / sistema)">
                         {codigoLabel}
                       </span>
                       <span className="text-[10px] font-black uppercase tracking-wider bg-slate-900 text-slate-400 px-2 py-0.5 rounded-lg border border-slate-700">
                         {category}
                       </span>
                       <span className="text-[10px] font-black text-green-400 bg-green-900/20 px-2 py-0.5 rounded-lg border border-green-900/30">
                         ${groupVariants[0]?.price?.toLocaleString()}
                       </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 md:gap-8">
                   <div className="text-right hidden sm:block">
                      <div className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-0.5">Stock Total</div>
                      {isAdminOrWarehouse ? (
                        <div className={`text-xl font-black ${isFullyOut ? 'text-red-500' : displayTotalStock < 50 ? 'text-yellow-500' : 'text-green-400'}`}>
                           {displayTotalStock} <span className="text-xs text-slate-600">un.</span>
                        </div>
                      ) : (
                        <div className={`text-sm font-black uppercase ${isFullyOut ? 'text-red-500' : 'text-green-400'}`}>
                           {isFullyOut ? 'AGOTADO' : 'DISPONIBLE'}
                        </div>
                      )}
                   </div>
                   
                   {/* Add Variant Button */}
                   {isAdminOrWarehouse && (
                     <button
                       onClick={(e) => { e.stopPropagation(); handleAddVariant(groupKey); }}
                       className="p-2 bg-slate-700 hover:bg-blue-600 hover:text-white rounded-lg text-slate-300 transition-colors"
                       title="Agregar variante a este modelo"
                     >
                       <PlusCircle size={20} />
                     </button>
                   )}

                   <div className={`p-1.5 rounded-full transition-transform duration-300 ${isExpanded ? 'bg-blue-600 text-white rotate-180' : 'bg-slate-700 text-slate-400'}`}>
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
                    {loadingVariantsByGroup[groupKey] && (
                      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 text-slate-400 text-sm">
                        Cargando variantes...
                      </div>
                    )}
                    {!loadingVariantsByGroup[groupKey] && variantsToRender.length === 0 && filterColor !== 'ALL' && (
                      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 text-slate-400 text-sm">
                        No hay variantes para el color seleccionado.
                      </div>
                    )}
                    {[...variantsToRender]
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
                        <div key={product.id} className="bg-slate-800 rounded-xl p-3 border border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
                           {/* Variant Info */}
                           <div className="flex-1">
                             <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] font-mono text-blue-400 bg-blue-900/20 px-1.5 py-0.5 rounded border border-blue-900/30">
                                   {product.sku}
                                </span>
                                <div className="flex gap-1">
                                  {product.integrations?.tiendaNube && <Cloud size={12} className="text-blue-400" />}
                                  {product.integrations?.mercadoLibre && <Zap size={12} className="text-yellow-500" />}
                                </div>
                             </div>
                             <div className="flex items-center gap-3">
                                <span className="text-sm text-white font-medium">
                                   <span className="text-slate-500 font-normal text-xs uppercase mr-1">Talle:</span>{talleDisplay}
                                </span>
                                <span className="w-px h-3 bg-slate-700"></span>
                                <span className="text-sm text-white font-medium flex items-center gap-1">
                                   <span className="text-slate-500 font-normal text-xs uppercase mr-1">Color:</span>
                                   {colorLabel}
                                </span>
                             </div>
                           </div>

                           {/* Stock Control Area */}
                           <div className="flex items-center justify-between md:justify-end gap-4 border-t md:border-t-0 border-slate-700 pt-3 md:pt-0">
                              {isAdminOrWarehouse ? (
                                <div className="flex items-center gap-3">
                                  {isEditing ? (
                                    <div className="flex items-center gap-2 animate-fade-in bg-slate-900 p-1.5 rounded-lg border border-slate-600">
                                      <button 
                                        onClick={() => adjustStock(product.id, product.stock, -1)}
                                        className="w-8 h-8 flex items-center justify-center bg-slate-800 rounded hover:bg-slate-700 text-slate-300 active:scale-95"
                                      >
                                        <Minus size={16} />
                                      </button>
                                      <input 
                                        type="number" 
                                        autoFocus
                                        value={product.stock}
                                        onChange={(e) => handleManualStockChange(product.id, e.target.value)}
                                        className="w-12 bg-transparent text-center font-bold text-white text-lg outline-none"
                                      />
                                      <button 
                                        onClick={() => adjustStock(product.id, product.stock, 1)}
                                        className="w-8 h-8 flex items-center justify-center bg-blue-600 rounded text-white hover:bg-blue-500 active:scale-95"
                                      >
                                        <Plus size={16} />
                                      </button>
                                      <button 
                                        onClick={() => setEditingStockId(null)}
                                        className="w-8 h-8 flex items-center justify-center bg-green-600 rounded text-white hover:bg-green-500 active:scale-95 ml-1"
                                      >
                                        <Check size={16} />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-4">
                                       <div className="text-right">
                                         <span className={`block text-xl font-black leading-none ${isOut ? 'text-red-500' : isLow ? 'text-yellow-500' : 'text-white'}`}>
                                           {product.stock}
                                         </span>
                                         <span className="text-[9px] text-slate-500 uppercase font-bold">Unidades</span>
                                       </div>
                                      <button 
                                       onClick={() => handleOpenLinkModal(product)}
                                       className="p-2 bg-slate-750 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-indigo-400 border border-slate-700 transition-colors"
                                       title="Vincular con Mercado Libre / Tienda Nube"
                                      >
                                       <Link size={16} />
                                      </button>
                                      <button 
                                       onClick={() => handleOpenDespachoModal(product)}
                                       className="p-2 bg-slate-750 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-amber-400 border border-slate-700 transition-colors"
                                       title="Asignar a Despacho de Importación"
                                      >
                                       <Ship size={16} />
                                      </button>
                                      <button 
                                       onClick={() => setEditingStockId(product.id)}
                                       className="p-2 bg-slate-750 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-blue-400 border border-slate-700 transition-colors"
                                      >
                                       <Edit2 size={16} />
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

      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Ordenar</span>
          <select 
            value={sortKey}
            onChange={(e) => { setSortKey(e.target.value as any); setCurrentPage(1); }}
            className="bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-xs text-white outline-none appearance-none min-h-[44px]"
          >
            <option value="SKU">Código</option>
            <option value="STOCK">Stock Total</option>
            <option value="VARIANTS">Variantes</option>
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
            Página {displayGroupsInfo.safePage} de {displayGroupsInfo.totalPages}
          </span>
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Por página</span>
          <select 
            value={pageSize}
            onChange={(e) => { setPageSize(parseInt(e.target.value)); setCurrentPage(1); }}
            className="bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-xs text-white outline-none appearance-none min-h-[44px]"
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

      {/* CREATE PRODUCT MODAL */}
      {isCreating && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="bg-slate-900 rounded-3xl border border-slate-800 w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl animate-fade-in-up">
              {/* Modal Header */}
              <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/50 rounded-t-3xl">
                 <div className="flex items-center gap-3">
                    <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-900/20">
                       <Layers size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">
                        {isVariantMode ? 'Agregar Variantes' : 'Alta Masiva de Productos'}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {isVariantMode ? `Sumando talles/colores a ${newProductName}` : 'Generador de matriz de variantes (SKUs)'}
                      </p>
                    </div>
                 </div>
                 <button onClick={() => setIsCreating(false)} className="text-slate-400 hover:text-white bg-slate-800 p-2 rounded-full hover:bg-slate-700 transition">
                    <X size={24} />
                 </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
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
                       {!isVariantMode && <p className="text-[10px] text-slate-600 ml-1">Se agregarán sufijos automáticamente (ej: -M-BK)</p>}
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
                          {availableSizes.map(size => {
                             const isSelected = selectedSizes.includes(size.name);
                             return (
                               <button 
                                 key={size.id}
                                 onClick={() => toggleSizeSelection(size.name)}
                                 className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${
                                   isSelected 
                                   ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/40' 
                                   : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500'
                                 }`}
                               >
                                 {size.name}
                               </button>
                             );
                          })}
                          {availableSizes.length === 0 && <p className="text-xs text-slate-500">No hay talles configurados.</p>}
                       </div>
                    </div>

                    {/* Colors */}
                    <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-800">
                       <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><Palette size={16} className="text-pink-400"/> Selección de Colores</h4>
                       <div className="flex flex-wrap gap-2">
                          {availableColors.map(color => {
                             const isSelected = selectedColors.includes(color.name);
                             return (
                               <button 
                                 key={color.id}
                                 onClick={() => toggleColorSelection(color.name)}
                                 className={`pl-3 pr-4 py-2 rounded-lg text-sm font-bold transition-all border flex items-center gap-2 ${
                                   isSelected 
                                   ? 'bg-pink-600 text-white border-pink-500 shadow-lg shadow-pink-900/40' 
                                   : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500'
                                 }`}
                               >
                                 <div className="w-3 h-3 rounded-full border border-white/20" style={{background: color.value}}></div>
                                 {color.name}
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
                    Resumen: <strong className="text-white text-lg ml-1">{selectedSizes.length * selectedColors.length}</strong> variantes serán creadas.
                 </div>
                 <div className="flex gap-3">
                    <button 
                      onClick={() => setIsCreating(false)}
                      className="px-6 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition"
                    >
                      Cancelar
                    </button>
                    <button 
                      onClick={handleCreateBatch}
                      disabled={!newProductName || !newBaseSku || selectedSizes.length === 0 || selectedColors.length === 0}
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

      {/* LINK EXTERNAL IDS MODAL */}
      {linkingVariant && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
           <div className="bg-slate-900 rounded-2xl border border-slate-700/80 w-full max-w-lg flex flex-col shadow-2xl animate-fade-in-up max-h-[90vh] overflow-hidden">
              <div className="shrink-0 p-5 border-b border-slate-700/80 flex justify-between items-center">
                 <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-indigo-500/20"><Link size={18} className="text-indigo-400" /></span>
                    Vincular producto
                 </h3>
                 <button onClick={() => setLinkingVariant(null)} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700/80 transition" aria-label="Cerrar">
                    <X size={20} />
                 </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
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

                 {/* Tienda Nube */}
                 <div className="space-y-3 rounded-xl bg-slate-800/30 border border-slate-700/50 p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                       <Cloud size={12} className="text-cyan-400/80" />
                       Tienda Nube
                    </p>
                    <div className="grid grid-cols-1 gap-3">
                       <div>
                          <label className="text-[11px] text-slate-500 block mb-1">ID del producto</label>
                          <input 
                            type="text" 
                            value={linkTnId}
                            onChange={(e) => setLinkTnId(e.target.value)}
                            placeholder="ID padre (grupo)"
                            className="w-full bg-slate-800/60 border border-slate-600/60 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:border-cyan-500/70 outline-none font-mono text-sm"
                          />
                       </div>
                       <div>
                          <label className="text-[11px] text-slate-500 block mb-1">ID de la variante</label>
                          <input 
                            type="text" 
                            value={linkTnVariantId}
                            onChange={(e) => setLinkTnVariantId(e.target.value)}
                            placeholder="ID variante"
                            className="w-full bg-slate-800/60 border border-slate-600/60 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:border-cyan-500/70 outline-none font-mono text-sm"
                          />
                       </div>
                    </div>
                    <p className="text-[10px] text-slate-500">Aplica al grupo {linkingVariant.sku.split('-').slice(0,-2).join('-') || 'base'}.</p>
                 </div>

                 {/* Mercado Libre */}
                 <div className="space-y-3 rounded-xl bg-slate-800/30 border border-slate-700/50 p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                       <Zap size={12} className="text-amber-400/80" />
                       Mercado Libre
                    </p>
                    <p className="text-[10px] text-slate-500">Al guardar con Item ID, se trae el stock actual de ML a tu inventario.</p>
                    <div className="grid grid-cols-1 gap-3">
                       <div>
                          <label className="text-[11px] text-slate-500 block mb-1">ID publicación (ítem) ML</label>
                          <input 
                            type="text" 
                            value={linkMlId}
                            onChange={(e) => setLinkMlId(e.target.value)}
                            placeholder="Ej: MLA123..."
                            className="w-full bg-slate-800/60 border border-slate-600/60 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:border-amber-500/70 outline-none font-mono text-sm"
                          />
                       </div>
                       <div>
                          <label className="text-[11px] text-slate-500 block mb-1">ID variación ML (si tiene talles/colores)</label>
                          <input 
                            type="text" 
                            value={linkMlVariantId}
                            onChange={(e) => setLinkMlVariantId(e.target.value)}
                            placeholder="Ej: 12345678901"
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

                 {/* Packs */}
                 <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                       <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Pack (unidades por publicación)</p>
                       <span className="text-[10px] text-slate-500" title="Stock enviado = stock local ÷ pack">100 un. ÷ x2 = 50 en la publicación</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                       <div className="space-y-2">
                          <label className="text-[11px] text-slate-500">Mercado Libre</label>
                          <div className="flex flex-wrap gap-1.5">
                             {[1, 2, 3, 6, 12].map((n) => (
                               <button
                                 key={n}
                                 type="button"
                                 onClick={() => setLinkPackMl(n)}
                                 className={`px-2.5 py-1.5 rounded-lg text-sm font-bold transition ${linkPackMl === n ? 'bg-amber-500/90 text-white' : 'bg-slate-700/80 text-slate-400 hover:bg-slate-600 hover:text-white'}`}
                               >
                                 x{n}
                               </button>
                             ))}
                          </div>
                          <input type="number" min={1} max={999} value={linkPackMl} onChange={(e) => setLinkPackMl(Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1)))} className="w-full bg-slate-800/60 border border-slate-600/60 rounded-lg px-3 py-2 text-white font-mono text-sm outline-none focus:border-amber-500/70" placeholder="Otro" />
                       </div>
                       <div className="space-y-2">
                          <label className="text-[11px] text-slate-500">Tienda Nube</label>
                          <div className="flex flex-wrap gap-1.5">
                             {[1, 2, 3, 6, 12].map((n) => (
                               <button
                                 key={n}
                                 type="button"
                                 onClick={() => setLinkPackTn(n)}
                                 className={`px-2.5 py-1.5 rounded-lg text-sm font-bold transition ${linkPackTn === n ? 'bg-cyan-500/90 text-white' : 'bg-slate-700/80 text-slate-400 hover:bg-slate-600 hover:text-white'}`}
                               >
                                 x{n}
                               </button>
                             ))}
                          </div>
                          <input type="number" min={1} max={999} value={linkPackTn} onChange={(e) => setLinkPackTn(Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1)))} className="w-full bg-slate-800/60 border border-slate-600/60 rounded-lg px-3 py-2 text-white font-mono text-sm outline-none focus:border-cyan-500/70" placeholder="Otro" />
                       </div>
                    </div>
                 </div>
              </div>
              <div className="shrink-0 p-5 border-t border-slate-700/80 flex justify-end gap-3 bg-slate-900/80">
                 <button 
                   onClick={() => setLinkingVariant(null)}
                   className="px-4 py-2.5 rounded-xl font-semibold text-slate-300 bg-slate-700/60 hover:bg-slate-600 border border-slate-600/60 transition text-sm"
                 >
                   Cancelar
                 </button>
                 <button 
                   onClick={handleSaveLink}
                   className="px-5 py-2.5 rounded-xl font-semibold bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/30 active:scale-[0.98] transition flex items-center gap-2 text-sm"
                 >
                   <CheckCircle2 size={16} />
                   Guardar vínculos
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Modal Asignar a Despacho */}
      {showDespachoModal && selectedProductForDespacho && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
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
        </>
      )}
    </div>
  );
};

export default Inventory;
