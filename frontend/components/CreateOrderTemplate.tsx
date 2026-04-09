import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ArrowLeft, Plus, Trash2, Search, Save, Package, ChevronDown, ChevronRight, Check, Palette, FileEdit, List } from 'lucide-react';
import { Order, OrderStatus, Product, Customer, Role } from '../types';
import type { PriceList } from '../types';
import { api } from '../services/api';
import { labelTalle } from '../utils/tallesTango';
import { useNotification } from '../context/NotificationContext';

const DRAFT_KEY = 'lupo_order_template_draft';

interface CreateOrderTemplateProps {
  products: Product[];
  customers: Customer[];
  onSave: (order: Order) => void | Promise<void>;
  onCancel: () => void;
  sellerId?: string | null;
  initialOrder?: Order | null;
  role?: Role;
  priceLists?: PriceList[];
  selectedPriceListId?: string | null;
  onPriceListChange?: (id: string | null) => void;
}

/** Una fila de la plantilla: un artículo (código) + un color, con cantidades por talle. */
interface TemplateRow {
  id: string;
  productCode: string;
  productName: string;
  productId: string;
  colorCode: string;
  colorName: string;
  /** variantId por sizeCode para este producto+color */
  variantBySize: Record<string, string>;
  /** cantidad por sizeCode */
  quantitiesBySize: Record<string, number>;
  /** stock disponible por sizeCode (si viene del API); si no hay variante o no hay stock, no se puede agregar */
  stockBySize?: Record<string, number>;
  price: number;
}

const CreateOrderTemplate: React.FC<CreateOrderTemplateProps> = ({
  products,
  customers,
  onSave,
  onCancel,
  sellerId,
  initialOrder = null,
  role,
  priceLists = [],
  selectedPriceListId = null,
  onPriceListChange
}) => {
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [sizes, setSizes] = useState<Array<{ code: string; name: string }>>([]);
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [addingProduct, setAddingProduct] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [globalDiscountPercent, setGlobalDiscountPercent] = useState<string>('');
  const [addByCodeInput, setAddByCodeInput] = useState('');
  const [addByCodeError, setAddByCodeError] = useState<string | null>(null);
  /** Código del artículo al que se están agregando colores (para mostrar carga en el botón). */
  const [addingColorsForCode, setAddingColorsForCode] = useState<string | null>(null);
  /** Códigos de artículo colapsados (solo se muestra resumen). */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const { showToast } = useNotification();
  const isCustomerLocked = role === Role.CUSTOMER;
  const showPriceListSelector = (role === Role.ADMIN || role === Role.WAREHOUSE) && priceLists.length >= 0;
  const draftRestoredRef = useRef(false);

  const isEditing = !!initialOrder;

  /** Restaurar borrador cuando haya clientes cargados, para que el cliente guardado exista en la lista y se muestre bien. */
  useEffect(() => {
    if (isEditing) return;
    if (customers.length === 0 || draftRestoredRef.current) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { selectedCustomerId?: string; orderDate?: string; rows?: TemplateRow[] };
      if (!draft || (!draft.rows?.length && !draft.selectedCustomerId)) return;
      draftRestoredRef.current = true;
      if (draft.orderDate) setOrderDate(draft.orderDate);
      if (Array.isArray(draft.rows) && draft.rows.length > 0) setRows(draft.rows);
      const validCustomerId = draft.selectedCustomerId && customers.some(c => c.id === draft.selectedCustomerId);
      if (validCustomerId) setSelectedCustomerId(draft.selectedCustomerId!);
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, [customers, isEditing]);

  const filteredCustomers = useMemo(() => {
    const q = clientFilter.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(c => {
      const name = (c.businessName || c.name || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [customers, clientFilter]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) setClientDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  /** Guardar borrador (debounced) cuando hay cliente o filas. */
  const saveDraft = useCallback((customerId: string, date: string, draftRows: TemplateRow[]) => {
    if (!draftRows.length && !customerId) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        selectedCustomerId: customerId || '',
        orderDate: date,
        rows: draftRows
      }));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => saveDraft(selectedCustomerId, orderDate, rows), 600);
    if (isEditing) return () => clearTimeout(t);
    return () => clearTimeout(t);
  }, [selectedCustomerId, orderDate, rows, saveDraft, isEditing]);

  /** Al cerrar/actualizar la página guardar borrador. */
  useEffect(() => {
    if (isEditing) return;
    const onBeforeUnload = () => {
      if (rows.length > 0 || selectedCustomerId) {
        saveDraft(selectedCustomerId, orderDate, rows);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [rows, selectedCustomerId, orderDate, saveDraft, isEditing]);

  /** Modo edición: convertir ítems existentes del pedido en filas de planilla. */
  useEffect(() => {
    if (!initialOrder) return;
    setSelectedCustomerId(initialOrder.customerId);
    setOrderDate(initialOrder.date);

    const productById = new Map(products.map((p) => [p.id, p]));
    const getBaseArticleCode = (skuRaw: string, productIdRaw: string) => {
      const product = productById.get(productIdRaw);
      const fromProduct = String((product as any)?.base_sku || product?.sku || '').trim();
      if (fromProduct) {
        const parts = fromProduct.split('-').filter(Boolean);
        if (parts.length >= 3) return parts.slice(0, -2).join('-');
        const seven = fromProduct.replace(/\D/g, '').slice(0, 7);
        return seven || fromProduct;
      }

      const sku = String(skuRaw || '').trim();
      if (!sku) return '';
      const parts = sku.split('-').filter(Boolean);
      // SKU variante típico: BASE-TALLE-COLOR -> mostrar/usar BASE para agrupar.
      if (parts.length >= 3) return parts.slice(0, -2).join('-');
      // SKU compacto numérico (ej. 0322389140903) -> código artículo = primeros 7 dígitos.
      const digits = sku.replace(/\D/g, '');
      if (digits.length >= 7) return digits.slice(0, 7);
      return sku;
    };

    const rowsByKey = new Map<string, TemplateRow>();
    for (const item of initialOrder.items || []) {
      const sizeCode = String((item as any).sizeCode || '').trim();
      const colorName = String((item as any).colorName || '').trim() || 'Color';
      const rawSku = String((item as any).sku || '').trim();
      const price = Number(item.priceAtMoment || 0);
      const productId = String((item as any).productId || '');
      const variantId = String((item as any).variantId || '').trim();
      if (!sizeCode || !variantId) continue;
      const productCode = getBaseArticleCode(rawSku, productId) || rawSku || productId || `SKU-${variantId.slice(0, 6)}`;
      const colorCode = String((item as any).colorCode || '').trim() || colorName;

      const key = `${productId || productCode}__${colorCode}`;
      if (!rowsByKey.has(key)) {
        rowsByKey.set(key, {
          id: `edit-${key}-${Math.random().toString(36).slice(2, 8)}`,
          productCode,
          productName: String((item as any).productName || productCode),
          productId,
          colorCode,
          colorName,
          variantBySize: {},
          quantitiesBySize: {},
          stockBySize: {},
          price
        });
      }
      const row = rowsByKey.get(key)!;
      row.variantBySize[sizeCode] = variantId;
      row.quantitiesBySize[sizeCode] = (row.quantitiesBySize[sizeCode] || 0) + Number(item.quantity || 0);
      if (!row.price && price) row.price = price;
    }
    const sorted = Array.from(rowsByKey.values()).sort((a, b) => {
      const byCode = a.productCode.localeCompare(b.productCode, undefined, { numeric: true, sensitivity: 'base' });
      if (byCode !== 0) return byCode;
      return a.colorName.localeCompare(b.colorName, undefined, { numeric: true, sensitivity: 'base' });
    });
    setRows(sorted);
  }, [initialOrder, products]);

  useEffect(() => {
    if (customers.length === 1 && !selectedCustomerId) setSelectedCustomerId(customers[0].id);
    if (isCustomerLocked && customers.length === 1) setSelectedCustomerId(customers[0].id);
  }, [customers, selectedCustomerId, isCustomerLocked]);

  useEffect(() => {
    api.getSizes().then(list => {
      const withCode = list.filter(s => {
        const code = String(s?.code ?? '').trim();
        return code !== '' && /^\d{2,3}$/.test(code);
      });
      const sorted = [...withCode].sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
      setSizes(sorted);
    });
  }, []);

  const searchTrimmed = searchTerm.trim().toLowerCase();
  /** Agrupar por artículo (base_sku) para mostrar un ítem por código; totalStock = suma de stock de todas las variantes. */
  const filteredProductGroups = useMemo(() => {
    let list = products;
    if (searchTrimmed) {
      const words = searchTrimmed.split(/\s+/).filter(Boolean);
      list = products.filter(p => {
        const sku = (p.sku || '').toLowerCase();
        const name = (p.name || '').toLowerCase();
        const base = ((p as any).base_sku || '').toLowerCase();
        const text = `${sku} ${name} ${base}`;
        return words.every(w => text.includes(w));
      });
    }
    const byBase = new Map<string, { product: Product; totalStock: number }>();
    for (const p of list) {
      const base = (p as any).base_sku ?? ((p.sku || '').replace(/-[^-]+-[^-]+$/, '').trim() || p.sku || p.id);
      const stock = Math.max(0, Number(p.stock ?? 0));
      if (!byBase.has(base)) {
        byBase.set(base, { product: p, totalStock: stock });
      } else {
        const prev = byBase.get(base)!;
        prev.totalStock += stock;
      }
    }
    return Array.from(byBase.entries()).slice(0, 50).map(([baseSku, { product: p, totalStock }]) => ({ baseSku, product: p, totalStock }));
  }, [products, searchTrimmed]);

  const addProductBySku = async (baseSku: string) => {
    const code = (baseSku || '').trim();
    if (!code) return;
    setAddingProduct(true);
    setAddByCodeError(null);
    try {
      const product = await api.getProductBySku(code);
      if (!product || !product.variants?.length) {
        setAddByCodeError('Código no encontrado o sin variantes.');
        return;
      }
      const variants = product.variants as Array<{ variant_id: string; color_code: string; color_name: string; size_code: string; stock?: number }>;
      const byColor = new Map<string, typeof variants>();
      for (const v of variants) {
        const c = v.color_code ?? '';
        if (!byColor.has(c)) byColor.set(c, []);
        byColor.get(c)!.push(v);
      }
      const newRows: TemplateRow[] = [];
      const defaultQtys: Record<string, number> = {};
      sizes.forEach(s => { defaultQtys[s.code] = 0; });
      const price = getPriceFromList(product.id, product.sku, (product as any).base_price);
      byColor.forEach((vars, colorCode) => {
        const first = vars[0];
        const colorName = first?.color_name ?? colorCode;
        const variantBySize: Record<string, string> = {};
        const stockBySize: Record<string, number> = {};
        vars.forEach(v => {
          variantBySize[v.size_code] = v.variant_id;
          stockBySize[v.size_code] = Math.max(0, Number(v.stock ?? 0));
        });
        newRows.push({
          id: `row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          productCode: product.sku,
          productName: product.name ?? baseSku,
          productId: product.id,
          colorCode,
          colorName,
          variantBySize,
          quantitiesBySize: { ...defaultQtys },
          stockBySize,
          price
        });
      });
      const alreadyInOrder = rows.some(r => r.productCode === product.sku);
      if (alreadyInOrder) {
        showToast('error', 'Este artículo ya está en el pedido.');
        setAddByCodeError('Este artículo ya está en el pedido. No se puede agregar dos veces.');
        setAddingProduct(false);
        return;
      }
      setRows(prev => {
        if (prev.some(r => r.productCode === product.sku)) return prev;
        return [...prev, ...newRows];
      });
      setShowAddModal(false);
      setSearchTerm('');
      setAddByCodeInput('');
      setAddByCodeError(null);
    } catch (e: any) {
      const msg = e?.response?.status === 401
        ? 'Sesión vencida. Cerrá sesión y volvé a iniciar sesión.'
        : (e?.message || 'Error al cargar el artículo.');
      setAddByCodeError(msg);
    } finally {
      setAddingProduct(false);
    }
  };

  const handleSelectProduct = (baseSku: string) => {
    if (baseSku) addProductBySku(baseSku);
  };

  const updateQuantity = (rowId: string, sizeCode: string, value: number) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      let n = Math.max(0, Math.floor(Number(value)) || 0);
      return { ...r, quantitiesBySize: { ...r.quantitiesBySize, [sizeCode]: n } };
    }));
  };

  /** Aplicar la misma cantidad a todos los talles de la fila. */
  const setRowAllQuantities = (rowId: string, value: number) => {
    const num = Math.max(0, Math.floor(Number(value)) || 0);
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const next: Record<string, number> = {};
      for (const sizeCode of Object.keys(r.quantitiesBySize)) {
        next[sizeCode] = num;
      }
      return { ...r, quantitiesBySize: next };
    }));
  };

  const removeRow = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
  };

  /** Actualiza el precio de una fila (edición manual). */
  const updateRowPrice = (rowId: string, value: number) => {
    const n = Math.max(0, Number(value));
    if (isNaN(n)) return;
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, price: n } : r));
  };

  /** Aplica un descuento porcentual sobre el precio actual de todas las filas. */
  const applyGlobalDiscount = () => {
    const parsed = Number(globalDiscountPercent);
    if (!Number.isFinite(parsed)) {
      showToast('error', 'Ingresá un descuento válido.');
      return;
    }
    const discount = Math.min(100, Math.max(0, parsed));
    const factor = 1 - (discount / 100);
    setRows(prev => prev.map(r => ({
      ...r,
      price: Math.round(Math.max(0, r.price * factor) * 100) / 100
    })));
    showToast('success', `Descuento global del ${discount}% aplicado a todos los artículos.`);
  };

  /** Precio del producto según la lista de precios (products ya vienen con precio de la lista seleccionada). */
  const getPriceFromList = (productId: string, productSku: string, fallbackBasePrice?: number): number => {
    const p = products.find((x: any) => x.product_id === productId || x.base_sku === productSku || (x as any).sku === productSku || x.id === productId);
    if (p != null) {
      const listPrice = Number((p as any).price);
      if (!isNaN(listPrice) && listPrice >= 0) return listPrice;
    }
    return Math.max(0, Number(fallbackBasePrice) || 0);
  };

  /** Recalcula precios de filas cuando cambia la lista de precios activa (products se refresca desde App). */
  useEffect(() => {
    if (!rows.length || !products.length) return;
    setRows(prev => {
      let changed = false;
      const next = prev.map(r => {
        const nextPrice = getPriceFromList(r.productId, r.productCode, r.price);
        if (!Number.isFinite(nextPrice) || nextPrice === r.price) return r;
        changed = true;
        return { ...r, price: nextPrice };
      });
      return changed ? next : prev;
    });
  }, [products, selectedPriceListId]);

  /** Vuelve a agregar al pedido los colores de un artículo que ya está cargado (p. ej. si eliminaste una fila de color). */
  const addMissingColorsToArticle = async (productCode: string) => {
    const code = (productCode || '').trim();
    if (!code) return;
    setAddingColorsForCode(code);
    try {
      const product = await api.getProductBySku(code);
      if (!product || !product.variants?.length) {
        showToast('error', 'No se pudo cargar el artículo o no tiene variantes.');
        return;
      }
      const variants = product.variants as Array<{ variant_id: string; color_code: string; color_name: string; size_code: string; stock?: number }>;
      const byColor = new Map<string, typeof variants>();
      for (const v of variants) {
        const c = v.color_code ?? '';
        if (!byColor.has(c)) byColor.set(c, []);
        byColor.get(c)!.push(v);
      }
      const existingColorCodes = new Set(rows.filter(r => r.productCode === product.sku).map(r => r.colorCode));
      const defaultQtys: Record<string, number> = {};
      sizes.forEach(s => { defaultQtys[s.code] = 0; });
      const price = getPriceFromList(product.id, product.sku, (product as any).base_price);
      const newRows: TemplateRow[] = [];
      byColor.forEach((vars, colorCode) => {
        if (existingColorCodes.has(colorCode)) return;
        const first = vars[0];
        const colorName = first?.color_name ?? colorCode;
        const variantBySize: Record<string, string> = {};
        const stockBySize: Record<string, number> = {};
        vars.forEach(v => {
          variantBySize[v.size_code] = v.variant_id;
          // Aceptar stock en snake_case (API) o camelCase
          const st = (v as any).stock ?? (v as any).stock_quantity;
          stockBySize[v.size_code] = Math.max(0, Number(st ?? 0));
        });
        newRows.push({
          id: `row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          productCode: product.sku,
          productName: product.name ?? code,
          productId: product.id,
          colorCode,
          colorName,
          variantBySize,
          quantitiesBySize: { ...defaultQtys },
          stockBySize,
          price
        });
      });
      if (newRows.length === 0) {
        showToast('info', 'Este artículo ya tiene todos sus colores en el pedido.');
        return;
      }
      let insertEnd = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].productCode === product.sku) {
          insertEnd = i + 1;
          break;
        }
      }
      setRows(prev => {
        const next = [...prev];
        next.splice(insertEnd, 0, ...newRows);
        return next;
      });
      showToast('success', `Se agregaron ${newRows.length} color${newRows.length === 1 ? '' : 'es'}.`);
    } catch (e: any) {
      const msg = e?.response?.status === 401
        ? 'Sesión vencida. Cerrá sesión y volvé a iniciar sesión.'
        : (e?.message || 'Error al cargar colores.');
      showToast('error', msg);
    } finally {
      setAddingColorsForCode(null);
    }
  };

  const total = useMemo(() => {
    let sum = 0;
    for (const r of rows) {
      for (const qty of Object.values(r.quantitiesBySize)) {
        if (qty > 0) sum += r.price * qty;
      }
    }
    return sum;
  }, [rows]);

  const buildOrderPayload = (asDraft: boolean): Order | null => {
    if (!selectedCustomerId || rows.length === 0) return null;
    const items: Array<{ variantId: string; quantity: number; priceAtMoment: number; isBackorder: boolean }> = [];
    for (const r of rows) {
      for (const [sizeCode, qty] of Object.entries(r.quantitiesBySize)) {
        if (qty <= 0 || !r.variantBySize[sizeCode]) continue;
        const stock = Number(r.stockBySize?.[sizeCode] ?? 0);
        items.push({
          variantId: r.variantBySize[sizeCode],
          quantity: qty,
          priceAtMoment: r.price,
          isBackorder: qty > stock
        });
      }
    }
    if (items.length === 0) return null;
    return {
      id: initialOrder?.id || `O-${Date.now().toString().slice(-6)}`,
      customerId: selectedCustomerId,
      sellerId: initialOrder?.sellerId ?? sellerId ?? null,
      items: items.map(i => ({ ...i, productId: undefined })),
      total,
      status: asDraft ? OrderStatus.DRAFT : (initialOrder?.status ?? OrderStatus.CONFIRMED),
      date: orderDate
    };
  };

  const handleSave = async () => {
    if (savingOrder) return;
    const order = buildOrderPayload(false);
    if (!order) {
      showToast('error', 'Agregá al menos una cantidad en algún talle.');
      return;
    }
    setSavingOrder(true);
    try {
      await Promise.resolve(onSave(order));
    } finally {
      setSavingOrder(false);
    }
  };

  const handleSaveDraft = async () => {
    if (savingOrder) return;
    const order = buildOrderPayload(true);
    if (!order) {
      showToast('error', 'Agregá al menos una cantidad en algún talle para guardar el borrador.');
      return;
    }
    setSavingOrder(true);
    try {
      await Promise.resolve(onSave(order));
    } finally {
      setSavingOrder(false);
    }
  };

  const totalUnits = useMemo(() => {
    let n = 0;
    for (const r of rows) {
      for (const qty of Object.values(r.quantitiesBySize)) n += qty;
    }
    return n;
  }, [rows]);

  /** True si alguna fila pide más de lo que hay en stock (se carga como pendiente). */
  const hasExceededStock = useMemo(() => {
    return rows.some(r =>
      Object.entries(r.quantitiesBySize).some(([sizeCode, qty]) => {
        const stock = r.stockBySize?.[sizeCode];
        return stock != null && qty > stock;
      })
    );
  }, [rows]);

  const handleSaveRef = useRef<() => void>(() => {});
  handleSaveRef.current = handleSave;
  /** Atajo: Ctrl+Enter confirma el pedido. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (rows.length > 0 && selectedCustomerId && totalUnits > 0) {
          e.preventDefault();
          if (!savingOrder) handleSaveRef.current();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rows, selectedCustomerId, totalUnits, hasExceededStock, savingOrder]);

  /** Agrupar filas por código de artículo (orden de aparición). */
  const groups = useMemo(() => {
    const list: Array<{ productCode: string; productName: string; rows: TemplateRow[] }> = [];
    let current: { productCode: string; productName: string; rows: TemplateRow[] } | null = null;
    for (const row of rows) {
      if (!current || current.productCode !== row.productCode) {
        current = { productCode: row.productCode, productName: row.productName, rows: [row] };
        list.push(current);
      } else {
        current.rows.push(row);
      }
    }
    return list;
  }, [rows]);

  const toggleGroup = (productCode: string) => {
    setCollapsedGroups(prev => ({ ...prev, [productCode]: !prev[productCode] }));
  };

  const removeGroup = (productCode: string) => {
    setRows(prev => prev.filter(r => r.productCode !== productCode));
    setCollapsedGroups(prev => {
      const next = { ...prev };
      delete next[productCode];
      return next;
    });
  };

  const totalUnitsInGroup = (groupRows: TemplateRow[]) => {
    let n = 0;
    for (const r of groupRows) {
      for (const qty of Object.values(r.quantitiesBySize)) n += qty;
    }
    return n;
  };

  const totalPriceInGroup = (groupRows: TemplateRow[]) => {
    let sum = 0;
    for (const r of groupRows) {
      for (const [sizeCode, qty] of Object.entries(r.quantitiesBySize)) {
        if (qty > 0) sum += r.price * qty;
      }
    }
    return sum;
  };

  return (
    <div className="flex flex-col h-full min-h-0 pb-32 md:pb-0 px-3 sm:px-0 max-w-full">
      {/* Header */}
      <header className="shrink-0 mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white transition touch-manipulation"
            aria-label="Volver"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{isEditing ? 'Editar pedido' : 'Nuevo pedido'}</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {new Date(orderDate).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        </div>
      </header>

      {/* Lista de precios: solo ADMIN/WAREHOUSE */}
      {showPriceListSelector && (
        <section className="shrink-0 mb-5">
          <label className="block text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
            <List size={14} /> Lista de precios
          </label>
          <select
            className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl py-3.5 px-4 text-sm text-white min-h-[48px] focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition"
            value={selectedPriceListId ?? ''}
            onChange={(e) => onPriceListChange?.(e.target.value || null)}
          >
            <option value="">Precio base (sin lista)</option>
            {priceLists.map(pl => (
              <option key={pl.id} value={pl.id}>{pl.name}</option>
            ))}
          </select>
          <p className="text-slate-500 text-[10px] mt-1">Los precios dependen de la lista elegida.</p>
        </section>
      )}

      {/* Cliente */}
      <section className="shrink-0 mb-5">
        <label className="block text-xs font-semibold text-slate-400 mb-2">Cliente</label>
        {isCustomerLocked ? (
          <div className="w-full bg-slate-800/80 rounded-xl py-3.5 px-4 text-sm text-white border border-slate-700/80 min-h-[48px] flex items-center">
            {customers.find(c => c.id === selectedCustomerId)?.businessName || customers[0]?.businessName || 'Mi cuenta'}
          </div>
        ) : (
          <div ref={clientDropdownRef} className="relative">
            <input
              type="text"
              className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl py-3.5 px-4 pr-10 text-sm text-white min-h-[48px] focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition"
              value={clientDropdownOpen || clientFilter ? clientFilter : (customers.find(c => c.id === selectedCustomerId)?.businessName || customers.find(c => c.id === selectedCustomerId)?.name || '')}
              onChange={(e) => { setClientFilter(e.target.value); setClientDropdownOpen(true); }}
              onFocus={() => setClientDropdownOpen(true)}
              onBlur={() => setTimeout(() => setClientDropdownOpen(false), 150)}
              placeholder="Escribí para filtrar o seleccionar cliente..."
            />
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
            {clientDropdownOpen && (
              <ul className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-xl border border-slate-700/80 bg-slate-900 shadow-xl py-1">
                {filteredCustomers.length === 0 ? (
                  <li className="px-3 py-2.5 text-slate-500 text-sm">Ningún cliente coincide</li>
                ) : (
                  filteredCustomers.map(c => (
                    <li
                      key={c.id}
                      className="px-3 py-2.5 text-sm text-white hover:bg-slate-700 cursor-pointer truncate"
                      onMouseDown={(e) => { e.preventDefault(); setSelectedCustomerId(c.id); setClientFilter(''); setClientDropdownOpen(false); }}
                    >
                      {c.businessName || c.name || 'Cliente'}
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Detalle + botón agregar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <p className="text-sm text-slate-400">
          <span className="font-semibold text-slate-300">{rows.length}</span> fila{rows.length !== 1 ? 's' : ''}
          <span className="mx-1.5">·</span>
          <span className="font-semibold text-slate-300">{totalUnits}</span> unidades
        </p>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="min-h-[48px] px-5 py-3 flex items-center justify-center gap-2.5 text-white font-semibold text-sm rounded-xl bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/30 active:scale-[0.98] transition touch-manipulation"
        >
          <Plus size={22} strokeWidth={2.5} /> Agregar artículo
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <label className="text-xs font-semibold text-slate-400 whitespace-nowrap">Descuento global (%)</label>
        <input
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={globalDiscountPercent}
          onChange={(e) => setGlobalDiscountPercent(e.target.value)}
          placeholder="Ej: 10"
          className="w-full sm:w-36 h-10 bg-slate-800/80 border border-slate-700/80 rounded-xl px-3 text-sm text-white font-mono tabular-nums focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none"
        />
        <button
          type="button"
          onClick={applyGlobalDiscount}
          disabled={!rows.length}
          className="h-10 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-200 text-sm font-semibold border border-slate-600 transition"
        >
          Aplicar a todos
        </button>
      </div>

      {/* Tabla o estado vacío */}
      <div className="flex-1 min-h-0 overflow-auto rounded-2xl border border-slate-700/80 bg-slate-800/40 shadow-inner">
        {rows.length === 0 ? (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="w-full h-full min-h-[280px] flex flex-col items-center justify-center gap-4 py-12 px-4 rounded-2xl border-2 border-dashed border-slate-600/80 hover:border-blue-500/50 hover:bg-slate-800/60 transition-colors group"
          >
            <span className="w-16 h-16 rounded-2xl bg-slate-700/80 group-hover:bg-blue-500/20 flex items-center justify-center transition-colors">
              <Plus size={32} className="text-slate-400 group-hover:text-blue-400" strokeWidth={2} />
            </span>
            <div className="text-center">
              <p className="text-base font-semibold text-slate-300 group-hover:text-white transition-colors">El pedido está vacío</p>
              <p className="text-sm text-slate-500 mt-1">Tocá aquí o en «Agregar artículo» para cargar productos</p>
            </div>
          </button>
        ) : (
          <div className="overflow-x-auto touch-scroll">
            <table className="w-full min-w-[640px] text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-600/80 bg-slate-800/90">
                  <th className="text-left text-slate-400 font-semibold py-3 px-3 sticky left-0 bg-slate-800/95 z-10 rounded-tl-xl">Código</th>
                  <th className="text-left text-slate-400 font-semibold py-3 px-3">Color</th>
                  <th className="text-center text-slate-400 font-semibold py-3 px-2 min-w-[70px]" title="Misma cantidad en todos los talles">Todas</th>
                  {sizes.map(s => (
                    <th key={s.code} className="text-center text-slate-400 font-semibold py-3 px-2 min-w-[48px]">
                      {labelTalle(s.code) || s.name || s.code}
                    </th>
                  ))}
                  <th className="text-right text-slate-400 font-semibold py-3 px-3">Precio</th>
                  <th className="w-12 py-3 px-2 bg-slate-800/95 rounded-tr-xl"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group, groupIndex) => {
                  const isNewArticle = groupIndex > 0;
                  const collapsed = collapsedGroups[group.productCode];
                  const groupUnits = totalUnitsInGroup(group.rows);
                  const groupTotal = totalPriceInGroup(group.rows);

                  if (collapsed) {
                    return (
                      <tr
                        key={`group-${group.productCode}`}
                        className={`border-b border-slate-700/50 hover:bg-slate-700/30 ${isNewArticle ? 'border-t-2 border-slate-500/70 bg-slate-700/20' : ''}`}
                      >
                        <td className={`py-3 px-3 font-mono text-sm text-blue-300 sticky left-0 z-10 ${isNewArticle ? 'bg-slate-700/40' : 'bg-slate-800/80'}`}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.productCode)}
                            className="flex items-center gap-2 text-left hover:text-blue-200 transition"
                          >
                            <ChevronRight size={18} className="shrink-0" />
                            {group.productCode}
                          </button>
                        </td>
                        <td className="py-3 px-3 text-slate-400 text-sm">
                          {group.rows.length} colores · {groupUnits} un.
                        </td>
                        <td className="py-3 px-2">—</td>
                        {sizes.map(s => (
                          <td key={s.code} className="py-3 px-2 text-center text-slate-500">—</td>
                        ))}
                        <td className="py-3 px-3 text-right font-mono text-sm text-emerald-400">${groupTotal.toLocaleString()}</td>
                        <td className="py-3 px-2">
                          <button
                            type="button"
                            onClick={() => removeGroup(group.productCode)}
                            className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition touch-manipulation"
                            aria-label="Quitar artículo"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <React.Fragment key={`group-${group.productCode}`}>
                      {group.rows.map((row, idx) => {
                        const isFirstRowOfArticle = idx === 0;
                        const isFirstRowAndNewArticle = isFirstRowOfArticle && isNewArticle;
                        return (
                          <tr
                            key={row.id}
                            className={`border-b border-slate-700/40 hover:bg-slate-700/20 ${isFirstRowAndNewArticle ? 'border-t-2 border-slate-500/70 bg-slate-700/20' : ''}`}
                          >
                            <td className={`py-2.5 px-3 font-mono text-sm text-blue-300 sticky left-0 z-10 ${isFirstRowAndNewArticle ? 'bg-slate-700/40' : 'bg-slate-800/80'}`}>
                              {isFirstRowOfArticle ? (
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(group.productCode)}
                                  className="flex items-center gap-2 text-left hover:text-blue-200 transition"
                                >
                                  <ChevronDown size={18} className="shrink-0" />
                                  {row.productCode}
                                </button>
                              ) : null}
                            </td>
                            <td className="py-2.5 px-3 text-slate-200 text-sm">{row.colorName}</td>
                            <td className="py-2 px-2">
                              <div className="flex items-center gap-1.5 justify-center">
                                <input
                                  type="number"
                                  min={0}
                                  placeholder="0"
                                  className="w-11 h-9 bg-slate-700/80 border border-slate-600 rounded-lg px-1.5 py-1 text-center text-white text-xs font-mono tabular-nums focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none"
                                  onBlur={(e) => {
                                    const v = parseInt(e.target.value, 10);
                                    if (!isNaN(v) && v >= 0) setRowAllQuantities(row.id, v);
                                  }}
                                  title="Cantidad para todos los talles"
                                />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    const input = (e.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement;
                                    if (input) {
                                      const v = parseInt(input.value, 10);
                                      if (!isNaN(v) && v >= 0) setRowAllQuantities(row.id, v);
                                    }
                                  }}
                                  className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 text-white touch-manipulation shadow-sm"
                                  title="Aplicar a todos los talles"
                                  aria-label="Aplicar a todos los talles"
                                >
                                  <Check size={18} />
                                </button>
                              </div>
                            </td>
                            {sizes.map(s => {
                              const hasVariant = !!row.variantBySize[s.code];
                              const stock = row.stockBySize?.[s.code];
                              const noStock = stock != null && stock <= 0;
                              const qtyVal = row.quantitiesBySize[s.code] ?? 0;
                              const exceeds = stock != null && qtyVal > stock;
                              const disabled = !hasVariant;
                              return (
                                <td key={s.code} className="py-2 px-1.5">
                                  {disabled ? (
                                    <span className="block w-full max-w-[52px] mx-auto text-center text-slate-600 text-sm py-2 rounded-lg bg-slate-800/50" title={!hasVariant ? 'Sin variante' : 'Sin stock'}>
                                      {noStock ? '0' : '—'}
                                    </span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={row.quantitiesBySize[s.code] ?? ''}
                                      onChange={(e) => updateQuantity(row.id, s.code, e.target.value === '' ? 0 : parseInt(e.target.value, 10))}
                                      className={`w-full max-w-[52px] h-9 mx-auto block border rounded-lg px-1.5 py-1 text-center text-white text-sm font-mono tabular-nums focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none ${
                                        noStock || exceeds
                                          ? 'bg-red-950/30 border-red-700/70'
                                          : 'bg-slate-700/80 border-slate-600'
                                      }`}
                                      title={stock != null ? `Stock: ${stock}. Si cargás más, queda pendiente.` : undefined}
                                    />
                                  )}
                                </td>
                              );
                            })}
                            <td className="py-2.5 px-3 text-right">
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={row.price}
                                onChange={(e) => updateRowPrice(row.id, e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                className="w-20 min-w-[72px] h-9 bg-slate-700/80 border border-slate-600 rounded-lg px-2 py-1 text-right text-emerald-400 font-mono text-sm tabular-nums focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none"
                              />
                            </td>
                            <td className="py-2.5 px-2">
                              <button
                                type="button"
                                onClick={() => removeRow(row.id)}
                                className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition touch-manipulation"
                                aria-label="Quitar fila"
                              >
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-b border-slate-700/30 bg-slate-800/30">
                        <td colSpan={3 + sizes.length + 2} className="py-2 px-3">
                          <button
                            type="button"
                            onClick={() => addMissingColorsToArticle(group.productCode)}
                            disabled={!!addingColorsForCode}
                            className="flex items-center gap-2 text-slate-400 hover:text-blue-400 text-xs font-semibold transition-colors touch-manipulation disabled:opacity-50"
                          >
                            {addingColorsForCode === group.productCode ? (
                              <>Cargando...</>
                            ) : (
                              <>
                                <Palette size={14} />
                                Agregar otro color a este artículo
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pie: subtotal + confirmar */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:relative md:p-0 md:pb-0 z-[60] md:z-auto mt-5 bg-slate-950/95 md:bg-transparent backdrop-blur-md md:backdrop-blur-none">
        <div className="rounded-2xl border border-slate-700/80 bg-slate-800/95 backdrop-blur-sm p-4 shadow-xl shadow-black/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-400">Subtotal</span>
            <span className="text-2xl font-bold text-emerald-400 tabular-nums">${total.toLocaleString()}</span>
          </div>
          {hasExceededStock && (
            <p className="text-xs text-amber-300 mb-3">Hay cantidades mayores al stock: se guardan igual y quedan como pendientes.</p>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              disabled={!selectedCustomerId || rows.length === 0 || totalUnits === 0 || savingOrder}
              onClick={handleSaveDraft}
              className="flex-1 min-h-[52px] py-3.5 rounded-xl font-bold flex items-center justify-center gap-2.5 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-200 border border-slate-600 disabled:opacity-60 transition-all touch-manipulation"
            >
              <FileEdit size={20} /> {savingOrder ? 'Guardando...' : 'Guardar borrador'}
            </button>
            <button
              disabled={!selectedCustomerId || rows.length === 0 || totalUnits === 0 || savingOrder}
              onClick={handleSave}
              className="flex-1 min-h-[52px] py-3.5 rounded-xl font-bold flex items-center justify-center gap-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white shadow-lg shadow-blue-900/30 disabled:shadow-none disabled:opacity-60 transition-all touch-manipulation"
            >
              <Save size={20} /> {savingOrder ? 'Guardando...' : 'Confirmar pedido'}
            </button>
          </div>
        </div>
      </footer>

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-sm z-[100] flex flex-col pt-[env(safe-area-inset-top)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="shrink-0 py-3 flex items-center gap-3">
            <button
              onClick={() => { setShowAddModal(false); setSearchTerm(''); setAddByCodeError(null); setAddByCodeInput(''); }}
              className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition touch-manipulation"
              aria-label="Cerrar"
            >
              <ArrowLeft size={22} />
            </button>
            <h2 className="font-bold text-white text-xl">Agregar artículo</h2>
          </div>

          {products.length === 0 && (
            <div className="mb-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm">
              <p className="font-semibold">No se cargaron los productos</p>
              <p className="mt-1 opacity-90">Si la sesión venció, cerrá sesión y volvé a entrar. Podés agregar por código abajo.</p>
            </div>
          )}

          <div className="shrink-0 mb-4 p-4 rounded-xl bg-slate-800/90 border border-slate-700/80">
            <p className="text-xs font-semibold text-slate-400 mb-2">Por código (SKU)</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ej: 28608"
                className="flex-1 bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-3 text-white font-mono text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                value={addByCodeInput}
                onChange={(e) => { setAddByCodeInput(e.target.value); setAddByCodeError(null); }}
                onKeyDown={(e) => e.key === 'Enter' && addProductBySku(addByCodeInput)}
              />
              <button
                type="button"
                disabled={addingProduct || !addByCodeInput.trim()}
                onClick={() => addProductBySku(addByCodeInput)}
                className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm disabled:opacity-50 whitespace-nowrap min-h-[48px] touch-manipulation"
              >
                {addingProduct ? 'Cargando...' : 'Cargar'}
              </button>
            </div>
            {addByCodeError && (
              <p className="mt-2 text-sm text-red-400">{addByCodeError}</p>
            )}
          </div>

          <p className="text-xs text-slate-500 mb-2">O elegí de la lista</p>
          <div className="relative mb-3">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={20} />
            <input
              type="text"
              placeholder="Buscar por código o nombre..."
              className="w-full bg-slate-800/80 border border-slate-700 rounded-xl py-3.5 pl-12 pr-4 text-white focus:ring-2 focus:ring-blue-500/50 outline-none min-h-[48px]"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
            {filteredProductGroups.map(({ baseSku, product: p, totalStock }) => (
              <button
                key={baseSku}
                type="button"
                onClick={() => handleSelectProduct(baseSku)}
                disabled={addingProduct}
                className="w-full text-left px-4 py-3.5 rounded-xl bg-slate-800/80 border border-slate-700/80 hover:bg-slate-700/80 hover:border-slate-600 transition flex items-center justify-between gap-3 touch-manipulation disabled:opacity-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-white text-sm truncate">{p.name}</div>
                  <div className="text-xs font-mono text-slate-400 truncate">{baseSku}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${totalStock > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600/50 text-slate-400'}`}>
                    {totalStock > 0 ? `Hay stock (${totalStock})` : 'Sin stock'}
                  </span>
                  <Package size={20} className="text-slate-500" />
                </div>
              </button>
            ))}
            {filteredProductGroups.length === 0 && products.length > 0 && (
              <div className="text-center py-14 text-slate-500">
                <Package className="mx-auto mb-3 opacity-40" size={40} />
                <p className="font-semibold">No hay resultados</p>
                <p className="text-sm mt-1">Escribí código o nombre del artículo</p>
              </div>
            )}
          </div>
          <div className="pt-4 border-t border-slate-700 shrink-0">
            <button
              type="button"
              onClick={() => { setShowAddModal(false); setSearchTerm(''); setAddByCodeError(null); setAddByCodeInput(''); }}
              className="w-full min-h-[48px] py-3 rounded-xl bg-slate-700/90 hover:bg-slate-600 text-slate-200 font-semibold border border-slate-600 transition touch-manipulation"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreateOrderTemplate;
