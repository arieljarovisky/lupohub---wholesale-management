import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ArrowLeft, Plus, Trash2, Search, Save, Package, ChevronDown, ChevronRight, Check, Palette, List, Upload, Bookmark, StickyNote } from 'lucide-react';
import { Order, OrderStatus, Product, Customer, Role } from '../types';
import type { PriceList } from '../types';
import { api } from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { labelTalle, codigoTalleParaSku, ORDER_FORM_SIZE_CODES, sortOrderFormSizeCodes } from '../utils/tallesTango';
import { parseOrderMatrixExcel } from '../utils/orderImportMatrix';
import { articleCodesMatch, articleCodeForOrderRow, resolveDisplayArticleCode, skuLookupCandidates, variantColorKey } from '../utils/articleCodeUtils';

interface CreateOrderTemplateProps {
  products: Product[];
  customers: Customer[];
  onSave: (order: Order) => void | Promise<void>;
  onCancel: () => void;
  sellerId?: string | null;
  initialOrder?: Order | null;
  /** Copia un pedido existente como base de un pedido nuevo (no edita el original). */
  duplicateFromOrder?: Order | null;
  role?: Role;
  priceLists?: PriceList[];
  selectedPriceListId?: string | null;
  onPriceListChange?: (id: string | null) => void;
  /**
   * Cuando es `true`, el editor se abre en modo solo lectura: todos los inputs y botones quedan
   * deshabilitados y se oculta la barra de "Guardar" / "Confirmar". Se usa para abrir pedidos ya
   * facturados sin que el usuario pueda modificarlos.
   */
  readOnly?: boolean;
  /**
   * Tras importar pedidos desde Excel (varios clientes), opcionalmente refrescar lista y volver a pedidos.
   */
  onMatrixImportDone?: () => void | Promise<void>;
  /** Tras guardar la lista de precios en la ficha del cliente (actualizar estado en App). */
  onCustomerUpdated?: (customer: Customer) => void;
  /** Tras crear un cliente ocasional al confirmar el pedido. */
  onCustomerCreated?: (customer: Customer) => void;
}

const CONDICIONES_IVA_OCASIONAL = [
  'Consumidor Final',
  'IVA Responsable Inscripto',
  'Responsable Monotributo',
  'IVA Sujeto Exento',
  'IVA No Alcanzado',
  'Sujeto No Categorizado',
];

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

/** Código de color - nombre en la grilla (ej. `111 - Blanco`). */
function formatColorCell(colorCode: string, colorName: string): string {
  const code = String(colorCode ?? '').trim();
  const name = String(colorName ?? '').trim();
  if (!code && !name) return '—';
  if (code && name && name !== code) return `${code} - ${name}`;
  return name || code;
}

function normalizeSizeCode(value: unknown, skuRaw?: string): string {
  const directRaw = String(value ?? '').trim();
  if (directRaw) {
    const numLead = directRaw.match(/^(\d{1,3})\b/);
    if (numLead) return numLead[1];
    const fromName = codigoTalleParaSku(directRaw);
    if (fromName && /^\d{1,3}$/.test(fromName)) return fromName;
  }
  const sku = String(skuRaw ?? '').trim();
  if (!sku) return '';
  const parts = sku.split('-').filter(Boolean);
  if (parts.length >= 3 && /^\d{1,3}$/.test(parts[1])) return parts[1];
  if (parts.length >= 2) {
    const fromSku = String(parts[parts.length - 2]).trim();
    const norm = codigoTalleParaSku(fromSku) || fromSku;
    if (/^\d{1,3}$/.test(norm)) return norm;
  }
  // Concatenado artículo+talle+color (ej. 4090001140997 → 140).
  if (!sku.includes('-')) {
    const digits = sku.replace(/\D/g, '');
    if (digits.length >= 11 && digits.length <= 17) {
      const talle = digits.slice(-6, -3);
      if (/^\d{1,3}$/.test(talle)) return talle;
    }
  }
  return '';
}

function normalizeColorName(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** SKU canónico base-talle-color (ej. 4080001-130-111). Ignora concatenados tipo 4080001130614. */
function variantSkuLooksCanonical(variantSku: string, parentSku: string): boolean {
  const v = String(variantSku ?? '').trim();
  const parts = v.split('-').filter(Boolean);
  if (parts.length !== 3) return false;
  if (!/^\d{1,3}$/.test(parts[1])) return false;
  const parent = String(parentSku ?? '').trim();
  return !parent || articleCodesMatch(parts[0], parent);
}

function variantMatchesRowColor(
  v: { color_code?: string; color_name?: string },
  row: TemplateRow
): boolean {
  const rowKey = variantColorKey(row.colorCode, row.colorName);
  const vKey = variantColorKey(String(v.color_code ?? ''), String(v.color_name ?? ''));
  if (rowKey === vKey) return true;
  const rn = normalizeColorName(row.colorName);
  const vn = normalizeColorName(String(v.color_name ?? ''));
  return rn.length > 0 && vn.length > 0 && rn === vn;
}

function assignVariantsToMaps(
  vars: Array<{
    variant_id: string;
    size_code?: string;
    stock?: number;
    sku?: string;
    variant_sku?: string;
  }>,
  parentSku: string,
  variantBySize: Record<string, string>,
  stockBySize: Record<string, number>
): void {
  const sorted = [...vars].sort((a, b) => {
    const skuA = String((a as { variant_sku?: string }).variant_sku || a.sku || '');
    const skuB = String((b as { variant_sku?: string }).variant_sku || b.sku || '');
    const ca = variantSkuLooksCanonical(skuA, parentSku) ? 0 : 1;
    const cb = variantSkuLooksCanonical(skuB, parentSku) ? 0 : 1;
    return ca - cb;
  });
  for (const v of sorted) {
    const variantSkuRef = String((v as { variant_sku?: string }).variant_sku || v.sku || '');
    const sizeCode = normalizeSizeCode(v.size_code, variantSkuRef);
    if (!sizeCode || !/^\d{1,3}$/.test(sizeCode)) continue;
    const hasDbSize = Boolean(String(v.size_code ?? '').trim());
    const canonical = variantSkuLooksCanonical(variantSkuRef, parentSku);
    if (!canonical && !hasDbSize) continue;
    if (variantBySize[sizeCode]) continue;
    variantBySize[sizeCode] = v.variant_id;
    stockBySize[sizeCode] = Math.max(0, Number((v as { stock?: number }).stock ?? 0));
  }
}

/** Carga todas las variantes del artículo desde API (no depende de la lista de precios en memoria). */
async function enrichRowsVariantsFromApi(rows: TemplateRow[]): Promise<TemplateRow[]> {
  const samples = new Map<string, TemplateRow>();
  for (const r of rows) {
    const k = `${r.productId || r.productCode}__${variantColorKey(r.colorCode, r.colorName)}`;
    if (!samples.has(k)) samples.set(k, r);
  }
  const patchByKey = new Map<
    string,
    { variantBySize: Record<string, string>; stockBySize: Record<string, number>; productId?: string }
  >();
  for (const [, sample] of samples) {
    const displayCode = resolveDisplayArticleCode(sample.productCode);
    let product: Awaited<ReturnType<typeof api.getProductBySku>> = null;
    let allVars: Array<{
      variant_id: string;
      product_id?: string;
      color_code: string;
      color_name: string;
      size_code: string;
      stock?: number;
      sku?: string;
      variant_sku?: string;
    }> = [];
    for (const candidate of skuLookupCandidates(displayCode)) {
      product = await api.getProductBySku(candidate);
      if (product?.variants?.length) {
        allVars = variantsForPrimaryProduct(product.id, product.variants as typeof allVars);
        break;
      }
    }
    if (!allVars.length) continue;
    const varsForColor = allVars.filter((v) => variantMatchesRowColor(v, sample));
    const vb: Record<string, string> = {};
    const sb: Record<string, number> = {};
    assignVariantsToMaps(varsForColor, displayCode, vb, sb);
    const k = `${sample.productId || sample.productCode}__${variantColorKey(sample.colorCode, sample.colorName)}`;
    patchByKey.set(k, {
      variantBySize: vb,
      stockBySize: sb,
      productId: product?.id,
    });
  }
  return rows.map((r) => {
    const k = `${r.productId || r.productCode}__${variantColorKey(r.colorCode, r.colorName)}`;
    const patch = patchByKey.get(k);
    if (!patch) return r;
    return {
      ...r,
      productId: r.productId || patch.productId || r.productId,
      variantBySize: { ...patch.variantBySize, ...r.variantBySize },
      stockBySize: { ...patch.stockBySize, ...r.stockBySize },
    };
  });
}

const canonicalSizeCode = (value: unknown): string => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return '';
  return codigoTalleParaSku(raw) || raw;
};

/**
 * Une filas del mismo artículo+color. Si hay dos registros de producto distintos (duplicados SKU),
 * no fusionar: una fila por product_id para no mezclar variant_id al guardar.
 */
function findHydrationRowKey(
  rowsByKey: Map<string, TemplateRow>,
  productCode: string,
  colorKey: string,
  parentProductId?: string
): string {
  const normalizedCode = resolveDisplayArticleCode(productCode);
  const pid = String(parentProductId ?? '').trim();
  for (const [key, row] of rowsByKey) {
    const rowColorKey = variantColorKey(row.colorCode, row.colorName);
    if (rowColorKey !== colorKey) continue;
    if (!articleCodesMatch(row.productCode, normalizedCode)) continue;
    const rowPid = String(row.productId ?? '').trim();
    if (pid && rowPid && pid !== rowPid) continue;
    return key;
  }
  return `${normalizedCode}__${colorKey}${pid ? `__${pid}` : ''}`;
}

/** Variantes del producto padre resuelto (evita mezclar duplicados al cargar talles en el pedido). */
function variantsForPrimaryProduct(
  primaryProductId: string,
  variants: Array<{ variant_id: string; product_id?: string }>
): typeof variants {
  const pid = String(primaryProductId || '').trim();
  if (!pid) return variants;
  const own = variants.filter((v) => String(v.product_id ?? pid) === pid);
  return own.length ? own : variants;
}

/** La rueda del mouse no debe modificar cantidades/precios al hacer scroll en la tabla. */
const blockWheelOnNumberInput = (e: React.WheelEvent<HTMLInputElement>) => {
  e.preventDefault();
  e.stopPropagation();
};

const numberInputNoSpinClass =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]';

const CreateOrderTemplate: React.FC<CreateOrderTemplateProps> = ({
  products,
  customers,
  onSave,
  onCancel,
  sellerId,
  initialOrder = null,
  duplicateFromOrder = null,
  role,
  priceLists = [],
  selectedPriceListId = null,
  onPriceListChange,
  readOnly = false,
  onMatrixImportDone,
  onCustomerUpdated,
  onCustomerCreated,
}) => {
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [occasionalMode, setOccasionalMode] = useState(false);
  const [occasionalName, setOccasionalName] = useState('');
  const [occasionalCuit, setOccasionalCuit] = useState('');
  const [occasionalCondicionIva, setOccasionalCondicionIva] = useState('Consumidor Final');
  const [occasionalEmail, setOccasionalEmail] = useState('');
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const matrixFileRef = useRef<HTMLInputElement>(null);
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  /** Referencia interna: sucursal, depósito, etc. */
  const [orderNotes, setOrderNotes] = useState('');
  const [sizes, setSizes] = useState<Array<{ code: string; name: string }>>([]);
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [addingProduct, setAddingProduct] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [globalDiscountPercent, setGlobalDiscountPercent] = useState<string>('');
  /** Modal para elegir qué color agregar a un artículo ya cargado. */
  const [colorPicker, setColorPicker] = useState<{
    productCode: string;
    productName: string;
    product: NonNullable<Awaited<ReturnType<typeof api.getProductBySku>>>;
    options: Array<{ colorKey: string; colorCode: string; colorName: string }>;
    loading: boolean;
  } | null>(null);
  /** Códigos de artículo colapsados (solo se muestra resumen). */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [matrixImporting, setMatrixImporting] = useState(false);
  const [savingCustomerPriceList, setSavingCustomerPriceList] = useState(false);
  /** false = solo la primera hoja del Excel con filas válidas (evita pedidos duplicados por muchas hojas). */
  const [matrixImportAllSheets, setMatrixImportAllSheets] = useState(false);

  const { showToast } = useNotification();
  const isCustomerLocked = role === Role.CUSTOMER;
  const canMatrixImport = useMemo(() => {
    if (readOnly || initialOrder || duplicateFromOrder) return false;
    if (!role || role === Role.CUSTOMER) return false;
    return (
      role === Role.ADMIN ||
      role === Role.WAREHOUSE ||
      role === Role.DEPOSITO ||
      role === Role.SELLER
    );
  }, [readOnly, initialOrder, role]);
  const showPriceListSelector = (role === Role.ADMIN || role === Role.WAREHOUSE) && priceLists.length > 0;
  /** Evita re-hidratar el pedido (y resetear la lista de precios) cada vez que se recargan productos. */
  const editHydratedOrderIdRef = useRef<string | null>(null);
  /** El usuario eligió otra lista en el selector; no pisar con la del cliente. */
  const priceListUserOverrideRef = useRef(false);
  /** Invalida respuestas async del modal de colores si el usuario cerró o abrió otro. */
  const colorPickerRequestRef = useRef(0);
  /** En edición: evita pisar priceAtMoment al abrir; permite recalcular si cambia la lista. */
  const appliedPriceListForRowsRef = useRef<string | null | undefined>(undefined);
  const priceListRecalcPendingRef = useRef(false);
  /** Productos vigentes al cambiar la lista; recalcular solo cuando el array se actualiza. */
  const productsAtPriceListChangeRef = useRef<Product[] | null>(null);
  /** ID estable para pedidos nuevos: evita dos POST con distinto O-xxxxxx al confirmar dos veces. */
  const pendingNewOrderIdRef = useRef<string | null>(null);
  const savingOrderLockRef = useRef(false);

  /** Limpia borradores viejos guardados en el navegador (funcionalidad eliminada). */
  useEffect(() => {
    try {
      localStorage.removeItem('lupo_order_template_draft');
    } catch {
      /* ignore */
    }
  }, []);
  const applyCustomerPriceList = useCallback((customerId: string) => {
    if (priceListUserOverrideRef.current) return;
    const customer = customers.find((c) => c.id === customerId);
    onPriceListChange?.(customer?.priceListId ?? null);
  }, [customers, onPriceListChange]);

  const handlePriceListSelectChange = useCallback(
    (value: string) => {
      priceListUserOverrideRef.current = true;
      onPriceListChange?.(value || null);
    },
    [onPriceListChange]
  );

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId),
    [customers, selectedCustomerId]
  );

  const selectedPriceListLabel = useMemo(() => {
    if (!selectedPriceListId) return 'Precio base';
    return priceLists.find((pl) => pl.id === selectedPriceListId)?.name ?? 'Lista seleccionada';
  }, [selectedPriceListId, priceLists]);

  const customerPriceListAlreadySaved = useMemo(() => {
    const saved = selectedCustomer?.priceListId ?? null;
    const current = selectedPriceListId ?? null;
    return saved === current;
  }, [selectedCustomer?.priceListId, selectedPriceListId]);

  const saveCustomerPriceListPermanent = useCallback(async () => {
    if (!selectedCustomerId || readOnly || savingCustomerPriceList) return;
    setSavingCustomerPriceList(true);
    try {
      const updated = await api.updateCustomer(selectedCustomerId, {
        priceListId: selectedPriceListId ?? null,
      });
      onCustomerUpdated?.(updated);
      const name = updated.businessName || updated.name || 'el cliente';
      showToast(
        'success',
        `Lista «${selectedPriceListLabel}» guardada para ${name}. Los próximos pedidos la usarán por defecto.`
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo guardar la lista del cliente';
      showToast('error', msg);
    } finally {
      setSavingCustomerPriceList(false);
    }
  }, [
    selectedCustomerId,
    readOnly,
    savingCustomerPriceList,
    selectedPriceListId,
    onCustomerUpdated,
    selectedPriceListLabel,
    showToast,
  ]);

  const onMatrixImportExcel = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || matrixImporting) return;
      setMatrixImporting(true);
      try {
        const lines = await parseOrderMatrixExcel(file, {
          importAllSheets: matrixImportAllSheets,
        });
        if (!lines.length) {
          showToast(
            'error',
            'No se encontraron filas válidas. Revisá columnas Cliente (o nombre de hoja), Código, Color y talles. El pedido completo se importa; lo que se factura y despacha se define en picking.'
          );
          return;
        }
        const res = await api.importOrdersFromMatrix({
          date: orderDate,
          priceListId: selectedPriceListId ?? undefined,
          lines,
        });
        const { errors, counts } = res;
        if (counts.created > 0) {
          const labels = [
            ...new Set(
              (res.created || [])
                .map((o: { matrixImportLabel?: string }) => o.matrixImportLabel)
                .filter(Boolean) as string[]
            ),
          ];
          const detail = labels.length ? ` (${labels.join(' · ')})` : '';
          showToast('success', `Se crearon ${counts.created} pedido(s) en borrador${detail}.`);
          const omitted = (res.created || []).flatMap((o: { despachoWarnings?: string[] }) => o.despachoWarnings || []);
          const omitMsgs = omitted.filter((w: string) => /omitido|Sin variante en catálogo/i.test(w));
          if (omitMsgs.length > 0) {
            const short = omitMsgs.slice(0, 4).join(' · ');
            showToast(
              'warning',
              omitMsgs.length > 4 ? `${short} … (+${omitMsgs.length - 4} más)` : short,
              'Líneas sin variante'
            );
          }
        }
        if (errors.length > 0) {
          const sample = errors
            .slice(0, 5)
            .map((x) => `${x.customerRef}: ${x.message}`)
            .join(' · ');
          showToast(
            'error',
            errors.length <= 5
              ? sample
              : `${errors.length} grupos con error. Ej.: ${sample}`
          );
        }
        if (counts.created > 0 && onMatrixImportDone) {
          await Promise.resolve(onMatrixImportDone());
        }
      } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message || 'Error al importar';
        showToast('error', msg);
      } finally {
        setMatrixImporting(false);
      }
    },
    [
      matrixImporting,
      matrixImportAllSheets,
      orderDate,
      selectedPriceListId,
      onMatrixImportDone,
      showToast,
    ]
  );

  const isEditing = !!initialOrder;
  const isDuplicating = !!duplicateFromOrder && !initialOrder;
  const hydrateSourceOrder = initialOrder || duplicateFromOrder;

  const sizeColumns = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();
    for (const code of ORDER_FORM_SIZE_CODES) {
      const fromApi = sizes.find((s) => String(s.code).trim() === code);
      map.set(code, { code, name: fromApi?.name || labelTalle(code) || code });
    }
    for (const s of sizes) {
      const code = String(s.code || '').trim();
      if (!code || !/^\d{1,3}$/.test(code)) continue;
      if (!map.has(code)) map.set(code, { code, name: s.name || labelTalle(code) || code });
    }
    for (const r of rows) {
      for (const code of Object.keys(r.variantBySize || {})) {
        const c = String(code || '').trim();
        if (!c || map.has(c)) continue;
        map.set(c, { code: c, name: labelTalle(c) || c });
      }
      for (const code of Object.keys(r.quantitiesBySize || {})) {
        const c = String(code || '').trim();
        if (!c || map.has(c)) continue;
        map.set(c, { code: c, name: labelTalle(c) || c });
      }
    }
    return Array.from(map.values()).sort((a, b) => sortOrderFormSizeCodes(a.code, b.code));
  }, [sizes, rows]);

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

  /** Edición o duplicado: convertir ítems del pedido en filas de planilla (una sola vez por pedido origen). */
  useEffect(() => {
    if (!hydrateSourceOrder) {
      editHydratedOrderIdRef.current = null;
      setOrderNotes('');
      return;
    }
    if (!products.length) return;
    const hydrateKey = isDuplicating ? `dup-${hydrateSourceOrder.id}` : hydrateSourceOrder.id;
    if (editHydratedOrderIdRef.current === hydrateKey) return;
    editHydratedOrderIdRef.current = hydrateKey;

    setSelectedCustomerId(hydrateSourceOrder.customerId);
    if (!priceListUserOverrideRef.current) {
      applyCustomerPriceList(hydrateSourceOrder.customerId);
    }
    setOrderNotes(isDuplicating ? '' : String(hydrateSourceOrder.notes ?? '').trim());
    setOrderDate(isDuplicating ? new Date().toISOString().slice(0, 10) : hydrateSourceOrder.date);

    const rowsByKey = new Map<string, TemplateRow>();
    for (const item of hydrateSourceOrder.items || []) {
      const sizeCode = normalizeSizeCode((item as any).sizeCode, String((item as any).sku || ''));
      const colorName = String((item as any).colorName || '').trim() || 'Color';
      const rawSku = String((item as any).sku || '').trim();
      const price = Number(item.priceAtMoment || 0);
      const variantId = String((item as any).variantId || '').trim();
      if (!variantId) continue;

      const variantInCatalog = products.find((p) => p.id === variantId);
      const parentProductId = String(
        (item as any).productId ||
          (variantInCatalog as any)?.product_id ||
          ''
      ).trim();

      let baseSku = String((variantInCatalog as any)?.base_sku || '').trim();
      if (!baseSku && variantInCatalog?.sku) {
        baseSku =
          articleCodeForOrderRow(undefined, variantInCatalog.sku) ||
          resolveDisplayArticleCode(variantInCatalog.sku);
      }
      if (!baseSku && parentProductId) {
        const sibling = products.find((p) => String((p as any).product_id || '') === parentProductId);
        baseSku = String((sibling as any)?.base_sku || '').trim();
        if (!baseSku && sibling?.sku) {
          baseSku =
            articleCodeForOrderRow(undefined, sibling.sku) ||
            resolveDisplayArticleCode(sibling.sku);
        }
      }

      const productCode = resolveDisplayArticleCode(
        baseSku || articleCodeForOrderRow(undefined, rawSku) || rawSku || parentProductId
      );
      let colorCode = String((item as any).colorCode || '').trim();
      if (!colorCode && rawSku) {
        const parts = rawSku.split('-').filter(Boolean);
        if (parts.length >= 3) colorCode = parts[parts.length - 1].replace(/\D/g, '') || parts[parts.length - 1];
        else {
          const digits = rawSku.replace(/\D/g, '');
          if (!rawSku.includes('-') && digits.length >= 11 && digits.length <= 17) {
            colorCode = digits.slice(-3);
          }
        }
      }
      if (!colorCode) colorCode = colorName;
      const colorKey = variantColorKey(colorCode, colorName);
      const key = findHydrationRowKey(rowsByKey, productCode, colorKey, parentProductId);

      if (!rowsByKey.has(key)) {
        rowsByKey.set(key, {
          id: `edit-${key}-${Math.random().toString(36).slice(2, 8)}`,
          productCode,
          productName: String((item as any).productName || productCode),
          productId: parentProductId,
          colorCode,
          colorName,
          variantBySize: {},
          quantitiesBySize: {},
          stockBySize: {},
          price
        });
      }
      const row = rowsByKey.get(key)!;
      if (sizeCode && /^\d{1,3}$/.test(sizeCode) && !row.variantBySize[sizeCode]) {
        row.variantBySize[sizeCode] = variantId;
      }
      row.quantitiesBySize[sizeCode] = (row.quantitiesBySize[sizeCode] || 0) + Number(item.quantity || 0);
      if (!row.price && price) row.price = price;
      if (!row.productId && parentProductId) row.productId = parentProductId;
    }
    const sorted = Array.from(rowsByKey.values())
      .filter((row) => Object.values(row.quantitiesBySize).some((q) => Number(q) > 0))
      .sort((a, b) => {
      const byCode = a.productCode.localeCompare(b.productCode, undefined, { numeric: true, sensitivity: 'base' });
      if (byCode !== 0) return byCode;
      return a.colorName.localeCompare(b.colorName, undefined, { numeric: true, sensitivity: 'base' });
    });
    setRows(sorted);
    void enrichRowsVariantsFromApi(sorted).then((enriched) => {
      setRows((prev) => {
        if (prev.length !== enriched.length) return prev;
        const prevIds = prev.map((r) => r.id).join('|');
        const nextIds = enriched.map((r) => r.id).join('|');
        return prevIds === nextIds ? enriched : prev;
      });
    });
    appliedPriceListForRowsRef.current = undefined;
    if (isDuplicating) pendingNewOrderIdRef.current = null;
  }, [hydrateSourceOrder, products, isDuplicating, applyCustomerPriceList]);

  useEffect(() => {
    appliedPriceListForRowsRef.current = undefined;
    priceListRecalcPendingRef.current = false;
    productsAtPriceListChangeRef.current = null;
    priceListUserOverrideRef.current = false;
    if (!hydrateSourceOrder) pendingNewOrderIdRef.current = null;
  }, [hydrateSourceOrder?.id, isDuplicating]);

  /** Al cambiar el selector: marcar recálculo cuando llegue el catálogo de esa lista. */
  useEffect(() => {
    const listId = selectedPriceListId ?? null;
    if (appliedPriceListForRowsRef.current === undefined) return;
    if (appliedPriceListForRowsRef.current !== listId) {
      priceListRecalcPendingRef.current = true;
      productsAtPriceListChangeRef.current = products;
      appliedPriceListForRowsRef.current = listId;
    }
  }, [selectedPriceListId, products]);

  useEffect(() => {
    if (occasionalMode) return;
    if (customers.length === 1 && !selectedCustomerId) {
      setSelectedCustomerId(customers[0].id);
      applyCustomerPriceList(customers[0].id);
      return;
    }
    if (isCustomerLocked && customers.length === 1) {
      setSelectedCustomerId(customers[0].id);
      applyCustomerPriceList(customers[0].id);
    }
  }, [customers, selectedCustomerId, isCustomerLocked, applyCustomerPriceList, occasionalMode]);

  useEffect(() => {
    api.getSizes().then(list => {
      const withCode = list.filter(s => {
        const code = String(s?.code ?? '').trim();
        return code !== '' && /^\d{1,3}$/.test(code);
      });
      const sorted = [...withCode].sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
      setSizes(sorted);
    });
  }, []);

  /** Prefijo de artículo (solo código padre, ej. 0127501) para mostrar y agrupar filas. */
  const rowArticlePrefix = useCallback(
    (row: TemplateRow): string => {
      const byProductId = products.find(
        (p) => String((p as any).product_id || '') === row.productId || p.id === row.productId
      );
      const fromCatalog = String((byProductId as any)?.base_sku || byProductId?.sku || '').trim();
      if (fromCatalog) return resolveDisplayArticleCode(fromCatalog);
      return resolveDisplayArticleCode(row.productCode);
    },
    [products]
  );

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
    const displayCode = resolveDisplayArticleCode(code);
    setAddingProduct(true);
    try {
      let product: Awaited<ReturnType<typeof api.getProductBySku>> = null;
      let variants: Array<{ variant_id: string; product_id?: string; color_code: string; color_name: string; size_code: string; stock?: number }> = [];
      for (const candidate of skuLookupCandidates(code)) {
        product = await api.getProductBySku(candidate);
        variants = variantsForPrimaryProduct(product?.id ?? '', (product?.variants ?? []) as typeof variants);
        if (product && variants.length) break;
        product = null;
        variants = [];
      }
      if (!product || !variants.length) {
        showToast('error', 'Código no encontrado o sin variantes. Probá buscarlo en la lista o verificá que exista en inventario.');
        return;
      }
      const byColor = new Map<string, typeof variants>();
      for (const v of variants) {
        const c = variantColorKey(v.color_code ?? '', v.color_name ?? '');
        if (!byColor.has(c)) byColor.set(c, []);
        byColor.get(c)!.push(v);
      }
      const newRows: TemplateRow[] = [];
      const defaultQtys: Record<string, number> = {};
      sizes.forEach(s => { defaultQtys[s.code] = 0; });
      const price = getPriceFromList(product.id, product.sku, (product as any).base_price);
      byColor.forEach((vars) => {
        const first = vars[0];
        const colorCode = String(first?.color_code ?? '').trim();
        const colorName = first?.color_name ?? colorCode;
        const variantBySize: Record<string, string> = {};
        const stockBySize: Record<string, number> = {};
        assignVariantsToMaps(vars, displayCode, variantBySize, stockBySize);
        for (const code of Object.keys(variantBySize)) {
          if (defaultQtys[code] == null) defaultQtys[code] = 0;
        }
        newRows.push({
          id: `row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          productCode: displayCode,
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
      const alreadyInOrder = rows.some(r => articleCodesMatch(rowArticlePrefix(r), displayCode));
      if (alreadyInOrder) {
        showToast('error', 'Este artículo ya está en el pedido.');
        setAddingProduct(false);
        return;
      }
      setRows(prev => {
        if (prev.some(r => articleCodesMatch(rowArticlePrefix(r), displayCode))) return prev;
        return [...prev, ...newRows];
      });
      setShowAddModal(false);
      setSearchTerm('');
    } catch (e: any) {
      const msg = e?.response?.status === 401
        ? 'Sesión vencida. Cerrá sesión y volvé a iniciar sesión.'
        : (e?.message || 'Error al cargar el artículo.');
      showToast('error', msg);
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

  /** Compatibilidad con borradores viejos: talla guardada como letra/nombre en vez de código numérico. */
  const getVariantIdBySizeCompat = (row: TemplateRow, sizeCode: string): string | undefined => {
    const direct = row.variantBySize?.[sizeCode];
    if (direct) return direct;
    const target = canonicalSizeCode(sizeCode);
    for (const [key, variantId] of Object.entries(row.variantBySize || {})) {
      const k = canonicalSizeCode(key);
      if (!k || !variantId) continue;
      if (k === target) return variantId;
    }
    return undefined;
  };

  const getStockBySizeCompat = (row: TemplateRow, sizeCode: string): number | undefined => {
    const direct = row.stockBySize?.[sizeCode];
    if (direct != null) return Number(direct);
    const target = canonicalSizeCode(sizeCode);
    for (const [key, stock] of Object.entries(row.stockBySize || {})) {
      const k = canonicalSizeCode(key);
      if (!k) continue;
      if (k === target) return Number(stock);
    }
    return undefined;
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

  /** Mapa producto padre / SKU → precio de la lista activa (products ya vienen filtrados por lista). */
  const catalogPriceByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) {
      const price = Number(p.price);
      if (!Number.isFinite(price) || price < 0) continue;
      const pid = String((p as any).product_id || '').trim();
      if (pid) m.set(`id:${pid}`, price);
      const base = String((p as any).base_sku || '').trim();
      if (base) {
        m.set(`sku:${base.toLowerCase()}`, price);
        m.set(`sku:${resolveDisplayArticleCode(base).toLowerCase()}`, price);
      }
    }
    return m;
  }, [products]);

  const getPriceFromList = useCallback(
    (productId: string, productSku: string, fallbackBasePrice?: number): number => {
      const pid = String(productId || '').trim();
      if (pid) {
        const byId = catalogPriceByKey.get(`id:${pid}`);
        if (byId != null) return byId;
      }
      const sku = String(productSku || '').trim();
      if (sku) {
        const bySku =
          catalogPriceByKey.get(`sku:${sku.toLowerCase()}`) ??
          catalogPriceByKey.get(`sku:${resolveDisplayArticleCode(sku).toLowerCase()}`);
        if (bySku != null) return bySku;
      }
      for (const p of products) {
        if (pid && String((p as any).product_id) === pid) {
          const listPrice = Number(p.price);
          if (Number.isFinite(listPrice) && listPrice >= 0) return listPrice;
        }
        const base = String((p as any).base_sku || '').trim();
        if (base && articleCodesMatch(base, sku)) {
          const listPrice = Number(p.price);
          if (Number.isFinite(listPrice) && listPrice >= 0) return listPrice;
        }
      }
      return Math.max(0, Number(fallbackBasePrice) || 0);
    },
    [catalogPriceByKey, products]
  );

  /**
   * Recalcula precios cuando cambia la lista activa o se recargan productos.
   * En edición: al abrir se conservan priceAtMoment; si el usuario cambia la lista, se actualizan
   * cuando llegan los productos de esa lista (evita precios viejos durante la carga).
   */
  useEffect(() => {
    if (!rows.length || !products.length) return;

    const listId = selectedPriceListId ?? null;
    if (isEditing) {
      if (appliedPriceListForRowsRef.current === undefined) {
        appliedPriceListForRowsRef.current = listId;
        return;
      }
      if (!priceListRecalcPendingRef.current) return;
      if (products === productsAtPriceListChangeRef.current) return;
    }

    setRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const code = rowArticlePrefix(r);
        const nextPrice = getPriceFromList(r.productId, code || r.productCode, r.price);
        if (!Number.isFinite(nextPrice) || nextPrice === r.price) return r;
        changed = true;
        return { ...r, price: nextPrice };
      });
      return changed ? next : prev;
    });
    priceListRecalcPendingRef.current = false;
    productsAtPriceListChangeRef.current = null;
    appliedPriceListForRowsRef.current = listId;
  }, [products, selectedPriceListId, isEditing, rows.length, getPriceFromList, rowArticlePrefix]);

  const buildRowForColor = (
    product: NonNullable<Awaited<ReturnType<typeof api.getProductBySku>>>,
    displayCode: string,
    colorCode: string,
    vars: Array<{ variant_id: string; color_code: string; color_name: string; size_code: string; stock?: number; sku?: string; variant_sku?: string }>
  ): TemplateRow => {
    const first = vars[0];
    const colorName = first?.color_name ?? colorCode;
    const defaultQtys: Record<string, number> = {};
    sizes.forEach(s => { defaultQtys[s.code] = 0; });
    const price = getPriceFromList(product.id, product.sku, (product as any).base_price);
    const variantBySize: Record<string, string> = {};
    const stockBySize: Record<string, number> = {};
    assignVariantsToMaps(vars, displayCode, variantBySize, stockBySize);
    return {
      id: `row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      productCode: displayCode,
      productName: product.name ?? displayCode,
      productId: product.id,
      colorCode,
      colorName,
      variantBySize,
      quantitiesBySize: { ...defaultQtys },
      stockBySize,
      price
    };
  };

  const closeColorPicker = useCallback(() => {
    colorPickerRequestRef.current += 1;
    setColorPicker(null);
  }, []);

  const isColorAlreadyInOrder = useCallback(
    (displayCode: string, colorKey: string) =>
      rows.some(
        (r) =>
          articleCodesMatch(rowArticlePrefix(r), displayCode) &&
          variantColorKey(r.colorCode, r.colorName) === colorKey
      ),
    [rows, rowArticlePrefix]
  );

  /** Opciones del modal: `alreadyInOrder` se recalcula al borrar filas (no queda cacheado). */
  const colorPickerOptions = useMemo(() => {
    if (!colorPicker || colorPicker.loading) return [];
    const displayCode = colorPicker.productCode;
    return colorPicker.options.map((opt) => ({
      ...opt,
      alreadyInOrder: rows.some(
        (r) =>
          articleCodesMatch(rowArticlePrefix(r), displayCode) &&
          variantColorKey(r.colorCode, r.colorName) === opt.colorKey
      )
    }));
  }, [colorPicker, rows, rowArticlePrefix]);

  /** Abre modal con todos los colores del artículo en catálogo. */
  const openColorPickerForArticle = async (productCode: string, productId?: string) => {
    const code = (productCode || '').trim();
    if (!code) return;
    const requestId = ++colorPickerRequestRef.current;
    let lookupSku = code;
    let displayCode = resolveDisplayArticleCode(code);
    if (productId) {
      const byId = products.find(
        (p) => p.id === productId || String((p as any).product_id || '') === productId
      );
      const catalogSku = String((byId as any)?.base_sku || byId?.sku || '').trim();
      if (catalogSku) {
        lookupSku = catalogSku;
        displayCode = resolveDisplayArticleCode(catalogSku);
      }
    }
    setColorPicker({
      productCode: displayCode,
      productName: '',
      product: null as unknown as NonNullable<Awaited<ReturnType<typeof api.getProductBySku>>>,
      options: [],
      loading: true
    });
    try {
      let product: Awaited<ReturnType<typeof api.getProductBySku>> = null;
      let variants: Array<{ variant_id: string; product_id?: string; color_code: string; color_name: string; size_code: string; stock?: number }> = [];
      for (const candidate of skuLookupCandidates(lookupSku)) {
        product = await api.getProductBySku(candidate);
        variants = variantsForPrimaryProduct(product?.id ?? '', (product?.variants ?? []) as typeof variants);
        if (product && variants.length) break;
        product = null;
        variants = [];
      }
      if (requestId !== colorPickerRequestRef.current) return;
      if (!product || !variants.length) {
        showToast('error', 'No se pudo cargar el artículo o no tiene variantes.');
        setColorPicker(null);
        return;
      }
      const byColor = new Map<string, typeof variants>();
      for (const v of variants) {
        const key = variantColorKey(v.color_code ?? '', v.color_name ?? '');
        if (!byColor.has(key)) byColor.set(key, []);
        byColor.get(key)!.push(v);
      }
      const options: Array<{ colorKey: string; colorCode: string; colorName: string }> = [];
      byColor.forEach((vars, colorKey) => {
        const colorCode = String(vars[0]?.color_code ?? '').trim();
        const colorName = vars[0]?.color_name ?? colorCode;
        options.push({ colorKey, colorCode, colorName });
      });
      options.sort((a, b) => a.colorName.localeCompare(b.colorName, 'es', { sensitivity: 'base' }));
      if (options.length === 0) {
        showToast('error', 'El artículo no tiene colores en el catálogo.');
        setColorPicker(null);
        return;
      }
      setColorPicker({
        productCode: displayCode,
        productName: product.name ?? displayCode,
        product,
        options,
        loading: false
      });
    } catch (e: any) {
      if (requestId !== colorPickerRequestRef.current) return;
      const msg = e?.response?.status === 401
        ? 'Sesión vencida. Cerrá sesión y volvé a iniciar sesión.'
        : (e?.message || 'Error al cargar colores.');
      showToast('error', msg);
      setColorPicker(null);
    }
  };

  const addSelectedColorToArticle = (colorKey: string) => {
    if (!colorPicker?.product) return;
    const opt = colorPicker.options.find((o) => o.colorKey === colorKey);
    if (isColorAlreadyInOrder(colorPicker.productCode, colorKey)) return;
    const { product, productCode: displayCode } = colorPicker;
    const variants = (product.variants || []) as Array<{ variant_id: string; color_code: string; color_name: string; size_code: string; stock?: number }>;
    const vars = variants.filter(
      (v) => variantColorKey(v.color_code ?? '', v.color_name ?? '') === colorKey
    );
    if (!vars.length) {
      showToast('error', 'Color no encontrado en el catálogo.');
      return;
    }
    const colorCode = String(vars[0]?.color_code ?? opt?.colorCode ?? '').trim();
    const newRow = buildRowForColor(product, displayCode, colorCode, vars);
    let insertEnd = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (articleCodesMatch(rowArticlePrefix(rows[i]), displayCode)) {
        insertEnd = i + 1;
        break;
      }
    }
    setRows(prev => {
      const next = [...prev];
      next.splice(insertEnd, 0, newRow);
      return next;
    });
    closeColorPicker();
    showToast('success', `Color ${formatColorCell(colorCode, newRow.colorName)} agregado.`);
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

  const buildOrderPayload = (customerId: string): Order | null => {
    if (!customerId || rows.length === 0) return null;
    const items: Array<{ variantId: string; quantity: number; priceAtMoment: number; isBackorder: boolean }> = [];
    for (const r of rows) {
      for (const [sizeCode, qty] of Object.entries(r.quantitiesBySize)) {
        const variantId = getVariantIdBySizeCompat(r, sizeCode);
        if (qty <= 0 || !variantId) continue;
        const stock = Number(getStockBySizeCompat(r, sizeCode) ?? 0);
        items.push({
          variantId,
          quantity: qty,
          priceAtMoment: r.price,
          isBackorder: qty > stock
        });
      }
    }
    if (items.length === 0) return null;
    const orderId =
      initialOrder?.id ||
      pendingNewOrderIdRef.current ||
      (() => {
        const id = `O-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
        pendingNewOrderIdRef.current = id;
        return id;
      })();
    return {
      id: orderId,
      customerId,
      sellerId: initialOrder?.sellerId ?? duplicateFromOrder?.sellerId ?? sellerId ?? null,
      items: items.map(i => ({ ...i, productId: undefined })),
      total,
      // Solo ADMIN/Depósito pueden dejarlo confirmado directo.
      status:
        (role === Role.ADMIN || role === Role.WAREHOUSE || role === Role.DEPOSITO)
          ? OrderStatus.CONFIRMED
          : OrderStatus.PENDING_ADMIN_CONFIRMATION,
      date: orderDate,
      notes: orderNotes.trim() || undefined,
    };
  };

  const handleSave = async () => {
    if (savingOrderLockRef.current || savingOrder) return;
    if (readOnly || initialOrder) {
      // En edición no se permite cambiar a ocasional; usa el cliente del pedido.
      if (!selectedCustomerId) {
        showToast('error', 'Seleccioná un cliente.');
        return;
      }
    }

    let customerId = selectedCustomerId;

    if (occasionalMode && !initialOrder) {
      const name = occasionalName.trim();
      if (!name) {
        showToast('error', 'Indicá el nombre o razón social del comprador.');
        return;
      }
      const cuitDigits = occasionalCuit.replace(/\D/g, '');
      if (occasionalCondicionIva === 'IVA Responsable Inscripto' && cuitDigits.length < 10) {
        showToast('error', 'Para Responsable Inscripto (Factura A) el CUIT es obligatorio.');
        return;
      }
      savingOrderLockRef.current = true;
      setSavingOrder(true);
      try {
        const created = await api.createCustomerStrict({
          id: `C-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          businessName: name,
          email: occasionalEmail.trim() || undefined,
          address: '',
          city: '',
          cuit: cuitDigits || undefined,
          condicionIva: occasionalCondicionIva || 'Consumidor Final',
          sellerId: role === Role.SELLER ? (sellerId || undefined) : undefined,
          priceListId: selectedPriceListId || undefined,
        });
        onCustomerCreated?.(created);
        customerId = created.id;
        setSelectedCustomerId(created.id);
        setOccasionalMode(false);
      } catch (err: any) {
        savingOrderLockRef.current = false;
        setSavingOrder(false);
        showToast('error', err?.message || 'No se pudo crear el comprador ocasional.');
        return;
      }
    }

    const order = buildOrderPayload(customerId);
    if (!order) {
      savingOrderLockRef.current = false;
      setSavingOrder(false);
      showToast('error', 'Agregá al menos una cantidad en algún talle.');
      return;
    }
    savingOrderLockRef.current = true;
    setSavingOrder(true);
    try {
      await Promise.resolve(onSave(order));
    } finally {
      savingOrderLockRef.current = false;
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

  const canConfirmOrder =
    (occasionalMode ? !!occasionalName.trim() : !!selectedCustomerId) &&
    rows.length > 0 &&
    totalUnits > 0 &&
    !savingOrder;

  /** True si alguna fila pide más de lo que hay en stock (se carga como pendiente). */
  const hasExceededStock = useMemo(() => {
    return rows.some(r =>
      Object.entries(r.quantitiesBySize).some(([sizeCode, qty]) => {
        const stock = getStockBySizeCompat(r, sizeCode);
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
        const hasBuyer = occasionalMode ? !!occasionalName.trim() : !!selectedCustomerId;
        if (rows.length > 0 && hasBuyer && totalUnits > 0) {
          e.preventDefault();
          if (!savingOrder && !savingOrderLockRef.current) handleSaveRef.current();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rows, selectedCustomerId, occasionalMode, occasionalName, totalUnits, hasExceededStock, savingOrder]);

  /** Agrupar filas por prefijo de artículo (orden de aparición). */
  const groups = useMemo(() => {
    const list: Array<{ productCode: string; productName: string; productId?: string; rows: TemplateRow[] }> = [];
    let current: { productCode: string; productName: string; productId?: string; rows: TemplateRow[] } | null = null;
    for (const row of rows) {
      const prefix = rowArticlePrefix(row);
      if (!current || !articleCodesMatch(current.productCode, prefix)) {
        current = { productCode: prefix, productName: row.productName, productId: row.productId, rows: [row] };
        list.push(current);
      } else {
        current.rows.push(row);
      }
    }
    return list;
  }, [rows, rowArticlePrefix]);

  const toggleGroup = (productCode: string) => {
    setCollapsedGroups(prev => ({ ...prev, [productCode]: !prev[productCode] }));
  };

  const removeGroup = (productCode: string) => {
    setRows(prev => prev.filter(r => !articleCodesMatch(r.productCode, productCode)));
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

  const stickyHeadBg = 'bg-slate-900';
  const stickyCellBg = (highlight: boolean) => (highlight ? 'bg-slate-800' : 'bg-slate-900');

  const orderFieldClass =
    'w-full h-9 bg-slate-800/90 border border-slate-700/80 rounded-lg px-3 text-sm text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none';

  return (
    <div className="grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-1.5 overflow-hidden">
      {/* Barra superior compacta (una sola fila del grid) */}
      <div className="min-w-0 space-y-1.5">
      <header className="flex items-center gap-2 md:gap-3 min-w-0">
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 w-10 h-10 flex items-center justify-center rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white transition touch-manipulation"
          aria-label="Volver"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg md:text-xl font-bold text-white tracking-tight truncate">
            {readOnly ? 'Ver pedido' : (isEditing ? 'Editar pedido' : isDuplicating ? 'Duplicar pedido' : 'Nuevo pedido')}
          </h1>
          <p className="text-xs text-slate-500 truncate hidden sm:block">
            {orderNotes.trim()
              ? orderNotes.trim()
              : isDuplicating && duplicateFromOrder
                ? `Pedido #${duplicateFromOrder.id} · ${new Date(orderDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}`
                : new Date(orderDate).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}
          </p>
        </div>
        <p className="shrink-0 text-xs text-slate-400 tabular-nums hidden md:block">
          <span className="font-semibold text-slate-300">{rows.length}</span> filas ·{' '}
          <span className="font-semibold text-slate-300">{totalUnits}</span> u.
        </p>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          disabled={readOnly}
          className="shrink-0 h-9 px-3 md:px-4 flex items-center justify-center gap-1.5 text-white font-semibold text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 shadow-md shadow-blue-900/25 transition touch-manipulation"
        >
          <Plus size={18} strokeWidth={2.5} />
          <span className="hidden sm:inline">Agregar</span>
        </button>
      </header>

      {readOnly && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 -mt-1">
          <span className="font-semibold">Pedido facturado.</span>{' '}
          <span className="text-amber-200/80">Solo lectura.</span>
        </div>
      )}

      {/* Barra compacta: lista, cliente, descuento, import (no compite con la matriz en altura) */}
      <div
        inert={readOnly || undefined}
        aria-disabled={readOnly || undefined}
        className={`grid grid-cols-2 md:grid-cols-4 xl:grid-cols-12 gap-2 items-end min-w-0 ${
          readOnly ? '[&_input]:cursor-not-allowed [&_select]:cursor-not-allowed [&_button]:cursor-not-allowed' : ''
        }`}
      >
        {showPriceListSelector && (
          <div className="col-span-2 md:col-span-2 xl:col-span-3 min-w-0">
            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5 flex items-center gap-1">
              <List size={12} /> Lista
            </label>
            <div className="flex gap-1.5 items-stretch min-w-0">
              <select
                className={`${orderFieldClass} flex-1 min-w-0`}
                value={selectedPriceListId ?? ''}
                onChange={(e) => handlePriceListSelectChange(e.target.value)}
              >
                <option value="">Precio base</option>
                {priceLists.map(pl => (
                  <option key={pl.id} value={pl.id}>{pl.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={saveCustomerPriceListPermanent}
                disabled={!selectedCustomerId || savingCustomerPriceList || customerPriceListAlreadySaved}
                title={
                  !selectedCustomerId
                    ? 'Elegí un cliente primero'
                    : customerPriceListAlreadySaved
                      ? 'Esta lista ya es la predeterminada del cliente'
                      : `Guardar «${selectedPriceListLabel}» como lista del cliente`
                }
                className="shrink-0 h-9 px-2.5 flex items-center justify-center gap-1 rounded-lg border border-slate-600 bg-slate-700/90 hover:bg-slate-600 disabled:opacity-45 disabled:hover:bg-slate-700/90 text-slate-200 text-xs font-semibold transition touch-manipulation"
              >
                <Bookmark size={14} className={customerPriceListAlreadySaved ? 'text-emerald-400' : ''} />
                <span className="hidden lg:inline max-w-[5.5rem] truncate">
                  {savingCustomerPriceList ? '…' : customerPriceListAlreadySaved ? 'Fijada' : 'Fijar'}
                </span>
              </button>
            </div>
          </div>
        )}

        <div className={`min-w-0 ${showPriceListSelector ? 'col-span-2 md:col-span-2 xl:col-span-4' : 'col-span-2 md:col-span-2 xl:col-span-5'}`}>
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <label className="block text-[10px] font-semibold text-slate-500">Cliente</label>
            {!isCustomerLocked && !initialOrder && !readOnly && (
              <button
                type="button"
                onClick={() => {
                  const next = !occasionalMode;
                  setOccasionalMode(next);
                  if (next) {
                    setSelectedCustomerId('');
                    setClientFilter('');
                    setClientDropdownOpen(false);
                  } else {
                    setOccasionalName('');
                    setOccasionalCuit('');
                    setOccasionalCondicionIva('Consumidor Final');
                    setOccasionalEmail('');
                  }
                }}
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border transition touch-manipulation ${
                  occasionalMode
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-200'
                    : 'border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500'
                }`}
              >
                {occasionalMode ? 'Elegir de la lista' : 'Sin ficha / ocasional'}
              </button>
            )}
          </div>
          {isCustomerLocked ? (
            <div className={`${orderFieldClass} flex items-center truncate`}>
              {customers.find(c => c.id === selectedCustomerId)?.businessName || customers[0]?.businessName || 'Mi cuenta'}
            </div>
          ) : occasionalMode ? (
            <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-slate-900/80 p-2">
              <input
                type="text"
                className={orderFieldClass}
                value={occasionalName}
                onChange={(e) => setOccasionalName(e.target.value)}
                placeholder="Nombre o razón social *"
                aria-label="Nombre o razón social del comprador"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <input
                  type="text"
                  className={orderFieldClass}
                  value={occasionalCuit}
                  onChange={(e) => setOccasionalCuit(e.target.value)}
                  placeholder="CUIT (opcional; obligatorio para Factura A)"
                  aria-label="CUIT"
                />
                <select
                  className={orderFieldClass}
                  value={occasionalCondicionIva}
                  onChange={(e) => setOccasionalCondicionIva(e.target.value)}
                  aria-label="Condición IVA"
                >
                  {CONDICIONES_IVA_OCASIONAL.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <input
                type="email"
                className={orderFieldClass}
                value={occasionalEmail}
                onChange={(e) => setOccasionalEmail(e.target.value)}
                placeholder="Email (opcional)"
                aria-label="Email del comprador"
              />
              <p className="text-[10px] text-slate-500 leading-snug">
                Se crea una ficha mínima al confirmar. Sin CUIT se factura como Consumidor Final (B).
              </p>
            </div>
          ) : (
            <div ref={clientDropdownRef} className="relative">
              <input
                type="text"
                className={`${orderFieldClass} pr-8`}
                value={clientDropdownOpen || clientFilter ? clientFilter : (customers.find(c => c.id === selectedCustomerId)?.businessName || customers.find(c => c.id === selectedCustomerId)?.name || '')}
                onChange={(e) => { setClientFilter(e.target.value); setClientDropdownOpen(true); }}
                onFocus={() => setClientDropdownOpen(true)}
                onBlur={() => setTimeout(() => setClientDropdownOpen(false), 150)}
                placeholder="Cliente..."
              />
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              {clientDropdownOpen && (
                <ul className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-auto rounded-lg border border-slate-700/80 bg-slate-900 shadow-xl py-1">
                  {filteredCustomers.length === 0 ? (
                    <li className="px-3 py-2 text-slate-500 text-sm">Sin coincidencias</li>
                  ) : (
                    filteredCustomers.map(c => (
                      <li
                        key={c.id}
                        className="px-3 py-2 text-sm text-white hover:bg-slate-700 cursor-pointer truncate"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          priceListUserOverrideRef.current = false;
                          setOccasionalMode(false);
                          setSelectedCustomerId(c.id);
                          applyCustomerPriceList(c.id);
                          setClientFilter('');
                          setClientDropdownOpen(false);
                        }}
                      >
                        {c.businessName || c.name || 'Cliente'}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="col-span-2 md:col-span-4 xl:col-span-12 min-w-0">
          <label className="block text-[10px] font-semibold text-slate-500 mb-0.5 flex items-center gap-1">
            <StickyNote size={12} /> Nota del pedido
          </label>
          <input
            type="text"
            maxLength={200}
            value={orderNotes}
            onChange={(e) => setOrderNotes(e.target.value)}
            placeholder="Ej: Sucursal Palermo, depósito norte, entrega viernes…"
            className={orderFieldClass}
          />
        </div>

        <div className="col-span-2 md:col-span-2 xl:col-span-3 flex items-end gap-1.5 min-w-0">
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Dto. global %</label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={globalDiscountPercent}
              onChange={(e) => setGlobalDiscountPercent(e.target.value)}
              onWheel={blockWheelOnNumberInput}
              placeholder="Ej: 10"
              className={`${orderFieldClass} font-mono tabular-nums ${numberInputNoSpinClass}`}
            />
          </div>
          <button
            type="button"
            onClick={applyGlobalDiscount}
            disabled={!rows.length}
            className="shrink-0 h-9 px-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-200 text-xs font-semibold border border-slate-600 transition"
            title="Aplicar descuento a todos"
          >
            Aplicar
          </button>
        </div>

        <div className={`col-span-2 flex flex-wrap items-center gap-2 justify-between md:justify-end min-w-0 ${
          showPriceListSelector ? 'md:col-span-4 xl:col-span-2' : 'md:col-span-4 xl:col-span-4'
        }`}>
          <p className="text-xs text-slate-400 tabular-nums md:hidden">
            <span className="font-semibold text-slate-300">{rows.length}</span> filas ·{' '}
            <span className="font-semibold text-slate-300">{totalUnits}</span> u.
          </p>
          {canMatrixImport && (
            <div className="flex items-center gap-1.5">
              <input
                ref={matrixFileRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="hidden"
                onChange={onMatrixImportExcel}
              />
              <label className="hidden lg:flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer select-none" title="Importar todas las hojas del Excel">
                <input
                  type="checkbox"
                  className="rounded border-slate-600 bg-slate-800 text-emerald-600 shrink-0"
                  checked={matrixImportAllSheets}
                  onChange={(e) => setMatrixImportAllSheets(e.target.checked)}
                  disabled={matrixImporting || savingOrder}
                />
                Todas las hojas
              </label>
              <button
                type="button"
                onClick={() => matrixFileRef.current?.click()}
                disabled={matrixImporting || savingOrder}
                className="h-9 px-2.5 flex items-center justify-center gap-1.5 text-white font-semibold text-xs rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 transition touch-manipulation"
                title="Importar matriz Excel"
              >
                <Upload size={16} />
                <span className="hidden sm:inline">{matrixImporting ? '…' : 'Excel'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Matriz: fila flexible del grid — ocupa todo el alto restante.
          No usar `inert` aquí: bloquea el hit-testing del overflow-auto y el scroll deja de funcionar en solo lectura. */}
      <div
        aria-disabled={readOnly || undefined}
        className={`min-h-0 h-full flex flex-col w-full border border-slate-700/70 bg-slate-800/25 overflow-hidden ${
          readOnly ? '[&_input]:cursor-not-allowed [&_button]:cursor-not-allowed' : ''
        }`}
      >
        {rows.length === 0 ? (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            disabled={readOnly}
            className="w-full h-full min-h-[12rem] flex flex-col items-center justify-center gap-4 py-12 px-4 border-2 border-dashed border-slate-600/80 hover:border-blue-500/50 hover:bg-slate-800/60 transition-colors group disabled:pointer-events-none disabled:opacity-60"
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
            <div className="flex-1 min-h-0 h-full w-full overflow-auto touch-scroll overscroll-contain scroll-area-ios">
              <table className="w-full min-w-max text-sm border-separate border-spacing-0">
                <thead className="sticky top-0 z-30">
                  <tr className={`border-b border-slate-600/90 shadow-[0_2px_8px_rgba(15,23,42,0.85)] ${stickyHeadBg}`}>
                    <th className={`text-left text-[10px] uppercase tracking-wide text-slate-400 font-bold py-2 px-2.5 sticky left-0 z-50 ${stickyHeadBg} shadow-[2px_0_6px_rgba(15,23,42,0.6)]`}>Código</th>
                    <th className={`text-left text-[10px] uppercase tracking-wide text-slate-400 font-bold py-2 px-2.5 sticky left-[7.25rem] z-40 ${stickyHeadBg} shadow-[2px_0_6px_rgba(15,23,42,0.4)] min-w-[6.5rem]`}>Color</th>
                    <th className={`text-center text-[10px] uppercase tracking-wide text-slate-400 font-bold py-2 px-1.5 w-[4.5rem] ${stickyHeadBg}`} title="Misma cantidad en todos los talles">Todas</th>
                    {sizeColumns.map(s => (
                      <th key={s.code} className={`text-center text-[10px] uppercase tracking-wide text-slate-400 font-bold py-2 px-1 min-w-[2.75rem] whitespace-nowrap ${stickyHeadBg}`}>
                        {labelTalle(s.code) || s.name || s.code}
                      </th>
                    ))}
                    <th className={`text-right text-[10px] uppercase tracking-wide text-slate-400 font-bold py-2 px-2.5 min-w-[5rem] ${stickyHeadBg}`}>Precio</th>
                    <th className={`w-10 py-2 px-1 ${stickyHeadBg}`} />
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
                        <td className={`py-2 px-2.5 font-mono text-xs text-blue-300 sticky left-0 z-20 shadow-[2px_0_6px_rgba(15,23,42,0.35)] ${stickyCellBg(isNewArticle)}`}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.productCode)}
                            className="flex items-center gap-2 text-left hover:text-blue-200 transition"
                          >
                            <ChevronRight size={18} className="shrink-0" />
                            {group.productCode}
                          </button>
                        </td>
                        <td className={`py-2 px-2.5 text-slate-400 text-xs sticky left-[7.25rem] z-10 ${stickyCellBg(isNewArticle)}`}>
                          {group.rows.length} colores · {groupUnits} un.
                        </td>
                        <td className="py-2 px-1.5">—</td>
                        {sizeColumns.map(s => (
                          <td key={s.code} className="py-2 px-1 text-center text-slate-500 text-xs">—</td>
                        ))}
                        <td className="py-2 px-2.5 text-right font-mono text-xs text-emerald-400">${groupTotal.toLocaleString()}</td>
                        <td className="py-2 px-1">
                          <button
                            type="button"
                            onClick={() => removeGroup(group.productCode)}
                            disabled={readOnly}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition touch-manipulation disabled:opacity-40 disabled:pointer-events-none"
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
                            className={`border-b border-slate-700/35 hover:bg-slate-700/15 ${isFirstRowAndNewArticle ? 'border-t border-slate-500/50' : ''}`}
                          >
                            <td className={`py-1.5 px-2.5 font-mono text-xs text-blue-300 sticky left-0 z-20 shadow-[2px_0_6px_rgba(15,23,42,0.35)] ${stickyCellBg(isFirstRowAndNewArticle)}`}>
                              {isFirstRowOfArticle ? (
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(group.productCode)}
                                  className="flex items-center gap-2 text-left hover:text-blue-200 transition"
                                >
                                  <ChevronDown size={18} className="shrink-0" />
                                  {rowArticlePrefix(row)}
                                </button>
                              ) : null}
                            </td>
                            <td className={`py-1.5 px-2.5 text-slate-200 text-xs sticky left-[7.25rem] z-10 max-w-[8.5rem] truncate ${stickyCellBg(isFirstRowAndNewArticle)}`} title={formatColorCell(row.colorCode, row.colorName)}>{formatColorCell(row.colorCode, row.colorName)}</td>
                            <td className="py-1 px-1.5">
                              <div className="flex items-center gap-1 justify-center">
                                <input
                                  type="number"
                                  min={0}
                                  placeholder="0"
                                  disabled={readOnly}
                                  onWheel={blockWheelOnNumberInput}
                                  className={`w-9 h-8 bg-slate-700/80 border border-slate-600 rounded-md px-1 py-0.5 text-center text-white text-xs font-mono tabular-nums focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none disabled:opacity-70 ${numberInputNoSpinClass}`}
                                  onBlur={(e) => {
                                    const v = parseInt(e.target.value, 10);
                                    if (!isNaN(v) && v >= 0) setRowAllQuantities(row.id, v);
                                  }}
                                  title="Cantidad para todos los talles"
                                />
                                <button
                                  type="button"
                                  disabled={readOnly}
                                  onClick={(e) => {
                                    const input = (e.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement;
                                    if (input) {
                                      const v = parseInt(input.value, 10);
                                      if (!isNaN(v) && v >= 0) setRowAllQuantities(row.id, v);
                                    }
                                  }}
                                  className="shrink-0 w-7 h-8 flex items-center justify-center rounded-md bg-blue-600 hover:bg-blue-500 text-white touch-manipulation disabled:opacity-40 disabled:pointer-events-none"
                                  title="Aplicar a todos los talles"
                                  aria-label="Aplicar a todos los talles"
                                >
                                  <Check size={14} />
                                </button>
                              </div>
                            </td>
                            {sizeColumns.map(s => {
                              const hasVariant = !!getVariantIdBySizeCompat(row, s.code);
                              const stock = getStockBySizeCompat(row, s.code);
                              const noStock = stock != null && stock <= 0;
                              const qtyVal = row.quantitiesBySize[s.code] ?? 0;
                              const exceeds = stock != null && qtyVal > stock;
                              const disabled = !hasVariant;
                              return (
                                <td key={s.code} className="py-1 px-1">
                                  {disabled ? (
                                    <span className="block w-10 mx-auto text-center text-slate-600 text-xs py-1.5 rounded-md bg-slate-800/50" title={!hasVariant ? 'Sin variante' : 'Sin stock'}>
                                      {noStock ? '0' : '—'}
                                    </span>
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      value={qtyVal === 0 ? '' : qtyVal}
                                      disabled={readOnly}
                                      onWheel={blockWheelOnNumberInput}
                                      onChange={(e) => updateQuantity(row.id, s.code, e.target.value === '' ? 0 : parseInt(e.target.value, 10))}
                                      className={`w-10 h-8 mx-auto block border rounded-md px-1 py-0.5 text-center text-white text-xs font-mono tabular-nums focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none disabled:opacity-70 ${numberInputNoSpinClass} ${
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
                            <td className="py-1.5 px-2 text-right">
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={row.price}
                                disabled={readOnly}
                                onWheel={blockWheelOnNumberInput}
                                onChange={(e) => updateRowPrice(row.id, e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                className={`w-[4.5rem] h-8 bg-slate-700/80 border border-slate-600 rounded-md px-1.5 py-0.5 text-right text-emerald-400 font-mono text-xs tabular-nums focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none disabled:opacity-70 ${numberInputNoSpinClass}`}
                              />
                            </td>
                            <td className="py-1.5 px-1">
                              <button
                                type="button"
                                onClick={() => removeRow(row.id)}
                                disabled={readOnly}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition touch-manipulation disabled:opacity-40 disabled:pointer-events-none"
                                aria-label="Quitar fila"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-b border-slate-700/25 bg-slate-800/20">
                        <td colSpan={3 + sizeColumns.length + 2} className="py-1.5 px-2.5">
                          <button
                            type="button"
                            onClick={() => openColorPickerForArticle(group.productCode, group.productId)}
                            disabled={readOnly || !!colorPicker?.loading}
                            className="flex items-center gap-2 text-slate-400 hover:text-blue-400 text-xs font-semibold transition-colors touch-manipulation disabled:opacity-50"
                          >
                            <Palette size={14} />
                            Agregar otro color a este artículo
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

      {/* Pie compacto: subtotal + confirmar */}
      {!readOnly && (
        <footer className="min-w-0 border-t border-slate-700/80 bg-slate-950 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1.5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div className="flex-1 min-w-0 flex items-baseline justify-between sm:justify-start sm:gap-3">
              <span className="text-xs font-semibold text-slate-400">Subtotal</span>
              <span className="text-lg md:text-xl font-bold text-emerald-400 tabular-nums">${total.toLocaleString()}</span>
            </div>
            {hasExceededStock && (
              <p className="text-[10px] text-amber-300 sm:max-w-[14rem] sm:leading-tight order-last sm:order-none w-full sm:w-auto">
                Cantidades &gt; stock: quedan pendientes.
              </p>
            )}
            <button
              type="button"
              disabled={!canConfirmOrder}
              onClick={handleSave}
              className="w-full sm:w-auto sm:min-w-[200px] shrink-0 h-10 px-5 rounded-lg font-bold flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm shadow-md shadow-blue-900/30 disabled:opacity-60 transition touch-manipulation"
            >
              <Save size={18} /> {savingOrder ? 'Guardando...' : 'Confirmar pedido'}
            </button>
          </div>
        </footer>
      )}

      {readOnly && (
        <div className="flex items-center justify-between border-t border-slate-700/80 pt-1.5 px-1">
          <span className="text-xs font-semibold text-slate-400">Subtotal</span>
          <span className="text-lg font-bold text-emerald-400 tabular-nums">${total.toLocaleString()}</span>
        </div>
      )}

      {colorPicker && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-sm z-[110] flex flex-col pt-[env(safe-area-inset-top)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="shrink-0 py-3 flex items-center gap-3">
            <button
              type="button"
              onClick={closeColorPicker}
              className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition touch-manipulation"
              aria-label="Cerrar"
            >
              <ArrowLeft size={22} />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-white text-xl">Agregar color</h2>
              <p className="text-sm text-slate-400 truncate">
                <span className="font-mono">{colorPicker.productCode}</span>
                {colorPicker.productName ? ` · ${colorPicker.productName}` : ''}
              </p>
            </div>
          </div>

          {colorPicker.loading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">Cargando colores...</div>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-2">Elegí el color a agregar al pedido</p>
              <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
                {colorPickerOptions.map((opt) => (
                  <button
                    key={opt.colorKey}
                    type="button"
                    disabled={opt.alreadyInOrder}
                    onClick={() => addSelectedColorToArticle(opt.colorKey)}
                    className={`w-full text-left px-4 py-3.5 rounded-xl border transition flex items-center justify-between gap-3 touch-manipulation ${
                      opt.alreadyInOrder
                        ? 'bg-slate-800/40 border-slate-700/50 opacity-60 cursor-not-allowed'
                        : 'bg-slate-800/80 border-slate-700/80 hover:bg-slate-700/80 hover:border-blue-500/50'
                    }`}
                  >
                    <span className="font-mono text-white text-sm">{formatColorCell(opt.colorCode, opt.colorName)}</span>
                    {opt.alreadyInOrder ? (
                      <span className="text-xs text-slate-500 shrink-0">Ya en el pedido</span>
                    ) : (
                      <Plus size={20} className="text-blue-400 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="pt-4 border-t border-slate-700 shrink-0">
            <button
              type="button"
              onClick={closeColorPicker}
              className="w-full min-h-[48px] py-3 rounded-xl bg-slate-700/90 hover:bg-slate-600 text-slate-200 font-semibold border border-slate-600 transition touch-manipulation"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-sm z-[100] flex flex-col pt-[env(safe-area-inset-top)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="shrink-0 py-3 flex items-center gap-3">
            <button
              onClick={() => { setShowAddModal(false); setSearchTerm(''); }}
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

          <p className="text-xs text-slate-500 mb-2">Elegí de la lista</p>
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
              onClick={() => { setShowAddModal(false); setSearchTerm(''); }}
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
