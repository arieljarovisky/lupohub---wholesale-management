import React, { useState, useEffect } from 'react';
import { Search, Filter, Plus, Cloud, Zap, RefreshCw, AlertTriangle, Minus, CheckCircle2, XCircle, Edit2, Check, ChevronDown, Box, X, Layers, Tag, DollarSign, Palette, Ruler, PlusCircle, Download, Link } from 'lucide-react';
import { Product, Role, Attribute } from '../types';
import { syncAllStock } from '../services/apiIntegration';
import { api } from '../services/api';
import * as XLSX from 'xlsx';

interface InventoryProps {
  products: Product[];
  attributes?: Attribute[];
  role: Role;
  onCreateProducts?: (products: Product[]) => void;
  onUpdateStock?: (productId: string, newStock: number) => void;
}

const Inventory: React.FC<InventoryProps> = ({ products, attributes = [], role, onCreateProducts, onUpdateStock }) => {
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

  // Filter States
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterSize, setFilterSize] = useState('ALL');
  const [filterStockLevel, setFilterStockLevel] = useState<'ALL' | 'LOW' | 'OUT'>('ALL');
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
    
    const parsedColor = getProductColorCode(p);
    const filterColorStr = filterColor.toString().trim().toLowerCase();
    
    // Find the selected attribute to check against both code and name
    const selectedAttr = availableColors.find(c => ((c as any).code || c.name) === filterColor);
    const targetCode = (selectedAttr ? ((selectedAttr as any).code || '') : filterColor).toString().trim().toLowerCase();
    const targetName = (selectedAttr ? (selectedAttr.name || '') : '').toString().trim().toLowerCase();

    // Check explicit color property
    const explicitColor = ((p as any).color || '').toString().trim().toLowerCase();
    
    // Check parsed color from SKU
    const parsedColorStr = parsedColor.toString().trim().toLowerCase();

    // Check if SKU contains the target code as a segment (more robust than just last part)
    const sku = (p.sku || '').toString();
    const skuParts = sku.toLowerCase().split('-');
    const skuHasCode = targetCode && skuParts.includes(targetCode);

    if (
        (explicitColor && (explicitColor === targetCode || explicitColor === targetName)) ||
        (parsedColorStr === filterColorStr) || 
        (parsedColorStr === targetCode) || 
        (targetName && parsedColorStr === targetName) ||
        skuHasCode
    ) {
      return true;
    } else {
      // Try numeric comparison to handle "03" vs "3" differences
      const n1 = parseInt(parsedColor);
      const n2 = parseInt(filterColorStr);
      const n3 = parseInt(targetCode);
      if ((!isNaN(n1) && !isNaN(n2) && n1 === n2) || (!isNaN(n1) && !isNaN(n3) && n1 === n3)) {
        return true;
      }
    }
    return false;
  }

  // 1. Server-side paging (fallback to client if API offline)
  useEffect(() => {
    if (!serverMode) return;
    (async () => {
      try {
        const sortMap: any = { SKU: 'sku', STOCK: 'stock', VARIANTS: 'sku' };
        const res = await api.getProductsPaged(currentPage, pageSize, searchTerm || undefined, sortMap[sortKey] || 'sku', sortDir);
        setServerItems(res.items);
        setServerTotal(res.total);
      } catch {
        setServerMode(false);
      }
    })();
  }, [serverMode, currentPage, pageSize, searchTerm, sortKey, sortDir]);

  // 2. Filter individual products first (incluye padres para poder evaluar variantes)
  const filteredProducts = (serverMode ? serverItems : products).filter(p => {
    const sku = (p.sku || '').toString();
    const matchesSearch = sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'ALL' || p.category === filterCategory;
    const sizeCode = getProductSizeCode(p);
    const matchesSize = filterSize === 'ALL' || sizeCode === filterSize;
    
    const isParent = sku.split('-').length <= 1;
    const matchesColor = filterColor === 'ALL' ? true : (checkColorMatch(p, filterColor) || isParent);

    // Debug logging requested by user
    if (filterColor !== 'ALL' && !matchesColor) {
       // Log only occasionally or if needed
       // console.log(`[FilterMismatch] SKU: ${sku}, Filter: '${filterColor}'`);
    }
    
    let matchesStock = true;
    const stockValue = (p as any).stock_total ?? (p as any).stock ?? 0;
    if (filterStockLevel === 'LOW') matchesStock = stockValue > 0 && stockValue < 20;
    if (filterStockLevel === 'OUT') matchesStock = stockValue <= 0;

    // If we are filtering by color and the product has no color info (likely a parent product),
    // allow it to pass ONLY IF we cannot determine it's definitely NOT that color.
    // However, usually we want strict filtering. 
    // BUT, if the list contains PARENTS (no color) and we filter by color, we hide everything.
    // STRATEGY: If parsedColor is empty, and SKU has no dashes (likely parent), we might want to include it 
    // IF we are going to filter groups later.
    // BUT groups.filter checks variants.
    // So, let's keep strict filtering but ensure variants are detected.
    
    return matchesSearch && matchesCategory && matchesSize && matchesColor && matchesStock;
  });

    // 2. Group filtered products by BASE SKU (prefix before size/color suffix)
  const baseSource = React.useMemo(() => (filterColor === 'ALL' ? filteredProducts : (serverMode ? serverItems : products)), [filterColor, filteredProducts, serverMode, serverItems, products]);
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

  // Prefetch variants for color filtering at group level
  useEffect(() => {
    if (filterColor === 'ALL') {
      setLoadingVariantsByGroup({});
      return;
    }
    if (filterColor === 'ALL') return;
    const baseSkus: string[] = Array.from(new Set<string>(products.map(product => {
      const sku = (product.sku || 'SIN-CODIGO').toString();
      const parts = sku.split('-');
      if (parts.length >= 3) return parts.slice(0, -2).join('-');
      if (parts.length === 2) return parts.join('-');
      return sku;
    })));
    const missing: string[] = baseSkus.filter(k => !loadedVariants[k]);
    if (missing.length === 0) return;
    Promise.all(missing.map(async (groupName) => {
      try {
        const variants = await api.getVariantsBySku(groupName);
        const mapped: Product[] = variants.map((v) => ({
          id: v.variantId,
          sku: `${groupName}-${v.sizeCode}-${v.colorCode}`,
          name: groupedProducts[groupName]?.[0]?.name || '',
          category: groupedProducts[groupName]?.[0]?.category || 'General',
          price: groupedProducts[groupName]?.[0]?.price || 0,
          description: '',
          size: v.sizeCode,
          color: v.colorName,
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
      }
    })).catch(() => {});
  }, [filterColor, products]);
  
  // Prefetch variants for visible groups on initial load (no color filter)
  useEffect(() => {
    if (filterColor !== 'ALL') return;
    const baseSkus: string[] = Array.from(new Set<string>(filteredProducts.map(product => {
      const sku = (product.sku || 'SIN-CODIGO').toString();
      const parts = sku.split('-');
      if (parts.length >= 3) return parts.slice(0, -2).join('-');
      if (parts.length === 2) return parts.join('-');
      return sku;
    })));
    const missing: string[] = baseSkus.filter(k => !loadedVariants[k]);
    const limit = missing.slice(0, 50);
    if (limit.length === 0) return;
    setLoadingVariantsByGroup(prev => ({ ...prev, ...Object.fromEntries(limit.map(k => [k, true])) }));
    Promise.all(limit.map(async (groupName) => {
      try {
        const variants = await api.getVariantsBySku(groupName);
        const mapped: Product[] = variants.map((v) => ({
          id: v.variantId,
          sku: `${groupName}-${v.sizeCode}-${v.colorCode}`,
          name: groupedProducts[groupName]?.[0]?.name || '',
          category: groupedProducts[groupName]?.[0]?.category || 'General',
          price: groupedProducts[groupName]?.[0]?.price || 0,
          description: '',
          size: v.sizeCode,
          color: v.colorName,
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
        setLoadingVariantsByGroup(prev => ({ ...prev, [groupName]: false }));
      }
    })).catch(() => {
      setLoadingVariantsByGroup(prev => ({ ...prev, ...Object.fromEntries(limit.map(k => [k, false])) }));
    });
  }, [filteredProducts, filterColor]);

  const exportProductsToExcel = () => {
    const rows: any[] = [];
    Object.entries(groupedProducts).forEach(([groupKey, groupVariants]) => {
      const variants = loadedVariants[groupKey] || groupVariants;
      variants.forEach(p => {
        const parts = (p.sku || '').toString().split('-');
        const parsedSize = p.size || (parts.length >= 3 ? parts[parts.length - 2] : '');
        const parsedColor = p.color || (parts.length >= 3 ? parts[parts.length - 1] : '');
        rows.push({
          SKU: p.sku,
          Nombre: p.name,
          Categoría: p.category,
          Talle: parsedSize,
          Color: parsedColor,
          Stock: ((p as any).stock_total ?? (p as any).stock ?? 0),
          Precio: (p as any).base_price ?? (p as any).price ?? 0,
          Descripción: (p as any).description || '',
        });
      });
    });
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');
    const filename = `productos_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  const handleSyncStock = async () => {
    setIsSyncing(true);
    await syncAllStock(products);
    setTimeout(() => setIsSyncing(false), 1500);
  };

  const adjustStock = (productId: string, currentStock: number, delta: number) => {
    if (!onUpdateStock) return;
    onUpdateStock(productId, Math.max(0, currentStock + delta));
  };

  const handleManualStockChange = (productId: string, value: string) => {
    if (!onUpdateStock) return;
    const num = parseInt(value);
    if (!isNaN(num)) onUpdateStock(productId, Math.max(0, num));
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
  };

  const handleSaveLink = async () => {
    if (!linkingVariant) return;
    try {
      // 1. Update Variant External IDs
      await api.updateVariantExternalIds(linkingVariant.id, {
        tiendaNubeVariantId: linkTnVariantId || undefined,
        mercadoLibreVariantId: linkMlId || undefined // ML item ID is often used as variant ID for simple items or mapped
      });

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
        // Also update ML ID on parent if ML uses Item ID as parent
        if (linkMlId) {
             await api.updateProductExternalIds(parentProduct.id, {
                mercadoLibreId: linkMlId
             });
        }
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
        
        <button 
          onClick={exportProductsToExcel}
          className="flex-shrink-0 flex items-center gap-2 bg-slate-800 text-green-400 px-4 py-2.5 rounded-xl border border-slate-700 active:bg-slate-700 shadow-sm"
        >
          <Download size={16} />
          <span className="text-sm font-semibold">Exportar Excel</span>
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
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input 
              type="text" 
              placeholder="Buscar Código de Producto..." 
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full pl-10 pr-4 py-3.5 bg-slate-900 border border-slate-800 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-white text-sm shadow-sm"
            />
          </div>
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 rounded-xl border flex items-center gap-2 font-bold transition-all ${showFilters ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}
          >
            <Filter size={18} />
            <span className="hidden md:inline">Filtros</span>
            {(filterCategory !== 'ALL' || filterSize !== 'ALL' || filterColor !== 'ALL' || filterStockLevel !== 'ALL') && (
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
          </div>
        )}
      </div>

      {/* Grouped List Container */}
      <div className="space-y-4">
        {(() => {
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
              if (!loadedVariants[g.groupKey]) return true; // mantener visible hasta cargar
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
          const start = (safePage - 1) * pageSize;
          const end = start + pageSize;
          const pageGroups = groups.slice(start, end);
          return pageGroups.map(({ groupKey, groupVariants, totalStock, category }) => {
          const variantsToRender = getGroupFilteredVariants(groupKey, groupVariants);

          const isExpanded = expandedGroups.includes(groupKey);
          const skuLabel = groupKey;
          const displayName = groupVariants[0]?.name || skuLabel;
          
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
                    <div className="flex items-center gap-2 mt-1">
                       <span className="text-[10px] font-black uppercase tracking-wider bg-slate-900 text-slate-400 px-2 py-0.5 rounded-lg border border-slate-700">
                         {category}
                       </span>
                       <span className="text-[10px] font-mono text-blue-400 bg-blue-900/20 px-2 py-0.5 rounded-lg border border-blue-900/30">{skuLabel}</span>
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
                                   <span className="text-slate-500 font-normal text-xs uppercase mr-1">Talle:</span>{sizeLabel}
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

      <div className="flex justify-between items-center mt-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Ordenar</span>
          <select 
            value={sortKey}
            onChange={(e) => { setSortKey(e.target.value as any); setCurrentPage(1); }}
            className="bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white outline-none appearance-none"
          >
            <option value="SKU">Código</option>
            <option value="STOCK">Stock Total</option>
            <option value="VARIANTS">Variantes</option>
          </select>
          <button 
            onClick={() => { setSortDir(prev => prev === 'asc' ? 'desc' : 'asc'); setCurrentPage(1); }}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300"
          >
            {sortDir === 'asc' ? 'ASC' : 'DESC'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Por página</span>
          <select 
            value={pageSize}
            onChange={(e) => { setPageSize(parseInt(e.target.value)); setCurrentPage(1); }}
            className="bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-white outline-none appearance-none"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
          <button 
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300"
          >
            Prev
          </button>
          <button 
            onClick={() => setCurrentPage(prev => prev + 1)}
            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300"
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="bg-slate-900 rounded-3xl border border-slate-800 w-full max-w-md flex flex-col shadow-2xl animate-fade-in-up">
              <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/50 rounded-t-3xl">
                 <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Link size={20} className="text-indigo-400" />
                    Vincular Producto
                 </h3>
                 <button onClick={() => setLinkingVariant(null)} className="text-slate-400 hover:text-white bg-slate-800 p-2 rounded-full hover:bg-slate-700 transition">
                    <X size={20} />
                 </button>
              </div>
              <div className="p-6 space-y-6">
                 <div className="bg-blue-900/10 border border-blue-900/30 p-4 rounded-xl mb-4">
                    <p className="text-xs text-blue-300 font-medium mb-1">Vinculando variante:</p>
                    <p className="text-sm text-white font-mono">{linkingVariant.sku}</p>
                 </div>

                 <div className="space-y-4">
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1 ml-1"><Cloud size={12} className="text-blue-400"/> Tienda Nube (Producto ID)</label>
                       <input 
                         type="text" 
                         value={linkTnId}
                         onChange={(e) => setLinkTnId(e.target.value)}
                         placeholder="ID del Producto (Parent)"
                         className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-blue-500 outline-none font-mono text-sm"
                       />
                       <p className="text-[10px] text-slate-600 ml-1">Se aplicará a todo el grupo {linkingVariant.sku.split('-').slice(0,-2).join('-') || 'Base'}</p>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1 ml-1"><Cloud size={12} className="text-blue-400"/> Tienda Nube (Variante ID)</label>
                       <input 
                         type="text" 
                         value={linkTnVariantId}
                         onChange={(e) => setLinkTnVariantId(e.target.value)}
                         placeholder="ID de la Variante"
                         className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-blue-500 outline-none font-mono text-sm"
                       />
                    </div>
                    <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-1 ml-1"><Zap size={12} className="text-yellow-500"/> Mercado Libre (Item ID)</label>
                       <input 
                         type="text" 
                         value={linkMlId}
                         onChange={(e) => setLinkMlId(e.target.value)}
                         placeholder="MLA..."
                         className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-yellow-500 outline-none font-mono text-sm"
                       />
                    </div>
                 </div>
              </div>
              <div className="p-6 border-t border-slate-800 bg-slate-900 rounded-b-3xl flex justify-end gap-3">
                 <button 
                   onClick={() => setLinkingVariant(null)}
                   className="px-4 py-2 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition text-sm"
                 >
                   Cancelar
                 </button>
                 <button 
                   onClick={handleSaveLink}
                   className="px-6 py-2 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/20 active:scale-95 transition-all flex items-center gap-2 text-sm"
                 >
                   <CheckCircle2 size={16} />
                   Guardar Vínculos
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;
