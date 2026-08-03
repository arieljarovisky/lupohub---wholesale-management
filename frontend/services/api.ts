import { Product, Order, OrderStatus, User, Customer, CustomerDeliveryAddress, Transporte, UserTask } from '../types';
import { MOCK_PRODUCTS, MOCK_ORDERS, MOCK_USERS } from '../constants';
import httpClient, { request, requestFormData, getBlob, getBlobResponse, getBaseUrl, postBlob, postFormDataBlob } from './httpClient';

/** GET /products con muchas variantes puede tardar >15s (COUNT + JOIN en Railway). */
const PRODUCTS_LIST_TIMEOUT_MS = 120000;
/** Emisión AFIP: ARCA puede tardar 20–90s; el default 15s cortaba antes de ver el error real. */
const AFIP_EMIT_TIMEOUT_MS = 120000;

// Helper to handle offline/demo mode gracefully
const handleRequest = async <T>(requestFn: () => Promise<T>, fallback: T, errorMessage: string): Promise<T> => {
  try {
    return await requestFn();
  } catch (error) {
    console.warn(`API Connection Failed (${errorMessage}). Switching to offline/demo mode.`, error);
    return fallback;
  }
};

/** Poll del job async Hub→ML/TN (el POST responde 202 enseguida; el proxy corta ~60s si se espera el resultado). */
async function pollStockSyncJob(
  platform: 'ml' | 'tn',
  maxWaitMs = 15 * 60 * 1000
): Promise<{ message: string; updated: number; errors: number; logs: string[]; total?: number; failuresCount?: number }> {
  const statusPath =
    platform === 'ml'
      ? '/integrations/mercadolibre/sync-stock/status'
      : '/integrations/tiendanube/sync-stock/status';
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await request<{
      status: string;
      message: string;
      updated: number;
      errors: number;
      logs: string[];
      total?: number;
      failuresCount?: number;
    }>(statusPath, 'GET', undefined, undefined, 30000);
    if (st.status === 'done') {
      return {
        message: st.message || 'Sincronización completada',
        updated: st.updated || 0,
        errors: st.errors || 0,
        logs: st.logs || [],
        total: st.total,
        failuresCount: st.failuresCount ?? st.errors ?? 0,
      };
    }
    if (st.status === 'error') {
      throw new Error(st.message || 'Error en sincronización de stock');
    }
  }
  throw new Error(
    'El sync sigue en el servidor pero tardó demasiado en el navegador. Revisá logs de Railway o el stock en ML/TN.'
  );
}

async function downloadStockSyncFailuresBlob(platform: 'ml' | 'tn' | 'both'): Promise<void> {
  const blob = await getBlob(`/integrations/stock-sync/failures-export?platform=${platform}`, 60000);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `stock_no_actualizados_${platform}_${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type TnNormalizeBatchResponse = {
  message: string;
  updatedVariants: number;
  skippedProducts: number;
  skippedDuplicates?: number;
  mergedVariants?: number;
  logs: string[];
  hasMore?: boolean;
  nextPage?: number;
  resume?: { page: number; productIndex: number; variantIndex: number };
};

const TN_NORMALIZE_BATCH_TIMEOUT_MS = 300000;

async function runTiendaNubeNormalizeBatches(
  path: string,
  onProgress?: (state: { batch: number; updatedVariants: number; logs: string[] }) => void
): Promise<{
  message: string;
  updatedVariants: number;
  skippedProducts: number;
  skippedDuplicates: number;
  mergedVariants: number;
  logs: string[];
}> {
  let batch = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalDuplicates = 0;
  let totalMerged = 0;
  const allLogs: string[] = [];
  let hasMore = true;
  let resume: TnNormalizeBatchResponse['resume'];
  let startPage = 1;

  while (hasMore) {
    batch++;
    const body: Record<string, unknown> = { startPage, maxPages: 2, maxUpdates: 25 };
    if (resume) body.resume = resume;

    const res = await request<TnNormalizeBatchResponse>(
      path,
      'POST',
      body,
      undefined,
      TN_NORMALIZE_BATCH_TIMEOUT_MS
    );

    totalUpdated += res.updatedVariants ?? 0;
    totalSkipped += res.skippedProducts ?? 0;
    totalDuplicates += res.skippedDuplicates ?? 0;
    totalMerged += res.mergedVariants ?? 0;
    if (res.logs?.length) allLogs.push(...res.logs);
    onProgress?.({ batch, updatedVariants: totalUpdated, logs: allLogs });

    hasMore = !!res.hasMore;
    resume = res.resume;
    if (hasMore) {
      if (resume) {
        startPage = resume.page;
      } else if (res.nextPage) {
        startPage = res.nextPage;
        resume = undefined;
      } else {
        hasMore = false;
      }
    }
    if (batch > 500) break;
  }

  return {
    message: hasMore ? 'Proceso interrumpido (demasiados lotes)' : 'Normalización completada',
    updatedVariants: totalUpdated,
    skippedProducts: totalSkipped,
    skippedDuplicates: totalDuplicates,
    mergedVariants: totalMerged,
    logs: allLogs,
  };
}

const getFilenameFromContentDisposition = (headerValue?: string): string => {
  const raw = String(headerValue || '').trim();
  if (!raw) return '';
  const utf8Match = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).trim();
    } catch {
      return utf8Match[1].trim();
    }
  }
  const plainMatch = raw.match(/filename\s*=\s*"([^"]+)"/i) || raw.match(/filename\s*=\s*([^;]+)/i);
  return plainMatch?.[1]?.trim() || '';
};

export type PublicationBundleItemDto = {
  id: string;
  variantId: string;
  unitsPerSale: number;
  sortOrder: number;
  sku?: string;
  productName?: string;
  colorName?: string;
  sizeCode?: string;
  stock?: number;
};

export type PublicationBundleDto = {
  id: string;
  platform: 'mercadolibre' | 'tiendanube';
  externalProductId: string;
  externalVariantId: string;
  label: string | null;
  items: PublicationBundleItemDto[];
  availableStock?: number;
};

export type PublicationBundleGroupDto = {
  platform: 'mercadolibre' | 'tiendanube';
  externalProductId: string;
  listingLabel: string | null;
  variants: PublicationBundleDto[];
};

function mapPublicationBundle(r: any): PublicationBundleDto {
  return {
    id: r.id,
    platform: r.platform,
    externalProductId: r.externalProductId ?? r.external_product_id ?? '',
    externalVariantId: r.externalVariantId ?? r.external_variant_id ?? '',
    label: r.label ?? null,
    availableStock: r.availableStock != null ? Number(r.availableStock) : undefined,
    items: Array.isArray(r.items)
      ? r.items.map((it: any) => ({
          id: it.id,
          variantId: it.variantId ?? it.variant_id,
          unitsPerSale: Number(it.unitsPerSale ?? it.units_per_sale) || 1,
          sortOrder: Number(it.sortOrder ?? it.sort_order) || 0,
          sku: it.sku,
          productName: it.productName ?? it.product_name,
          colorName: it.colorName ?? it.color_name,
          sizeCode: it.sizeCode ?? it.size_code,
          stock: it.stock != null ? Number(it.stock) : undefined
        }))
      : []
  };
}

function parseDeliveryAddressesFromApi(raw: unknown): CustomerDeliveryAddress[] | undefined {
  if (raw == null || raw === '') return undefined;
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw as string) : raw;
    if (!Array.isArray(arr)) return undefined;
    const out: CustomerDeliveryAddress[] = [];
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      const address = String((it as { address?: string }).address ?? '').trim();
      if (!address) continue;
      out.push({
        id: String((it as { id?: string }).id ?? '').trim() || `da-${Date.now()}-${out.length}`,
        label: (String((it as { label?: string }).label ?? 'Sucursal').trim() || 'Sucursal') as string,
        address,
        city: String((it as { city?: string }).city ?? '').trim(),
      });
    }
    return out.length ? out : undefined;
  } catch {
    return undefined;
  }
}

function mapCustomerFromApi(r: any): Customer {
  return {
    id: r.id,
    sellerId: r.sellerId ?? r.seller_id ?? '',
    sellerCommissionPercentage:
      r.sellerCommissionPercentage != null
        ? Number(r.sellerCommissionPercentage)
        : r.seller_commission_percentage != null
          ? Number(r.seller_commission_percentage)
          : undefined,
    userId: r.userId ?? r.user_id ?? undefined,
    name: r.name ?? '',
    businessName: r.businessName ?? r.business_name ?? '',
    email: r.email ?? '',
    address: r.address ?? '',
    city: r.city ?? '',
    cuit: r.cuit ?? undefined,
    phone: r.phone ?? undefined,
    transportNumber: r.transportNumber ?? r.transport_number ?? undefined,
    remitoNumber: r.remitoNumber ?? r.remito_number ?? undefined,
    saleCondition: r.saleCondition ?? r.sale_condition ?? undefined,
    condicionIva: r.condicionIva ?? r.condicion_iva ?? undefined,
    transportes: r.transportes ?? [],
    deliveryAddresses: parseDeliveryAddressesFromApi(r.deliveryAddresses ?? r.delivery_addresses),
    priceListId: r.priceListId ?? r.price_list_id ?? undefined,
    legacyCode: r.legacyCode ?? r.legacy_code ?? undefined,
    accountZone: r.accountZone ?? r.account_zone ?? undefined,
    accountSellerLabel: r.accountSellerLabel ?? r.account_seller_label ?? undefined,
    openingBalance:
      r.openingBalance != null && r.openingBalance !== ''
        ? Number(r.openingBalance)
        : r.opening_balance != null && r.opening_balance !== ''
          ? Number(r.opening_balance)
          : undefined,
    openingBalanceDate: (() => {
      const raw = r.openingBalanceDate ?? r.opening_balance_date;
      if (raw == null || raw === '') return undefined;
      if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        return raw.toISOString().slice(0, 10);
      }
      const s = String(raw).trim();
      const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      return undefined;
    })(),
    shouldRetainIibb: Boolean(r.shouldRetainIibb ?? r.should_retain_iibb),
    agipPadronPeriod: r.agipPadronPeriod ?? r.agip_padron_period ?? undefined,
    iibbAlicuota: r.iibbAlicuota != null ? Number(r.iibbAlicuota) : (r.iibb_alicuota != null ? Number(r.iibb_alicuota) : undefined),
  };
}

export type MetaAdsMetricsRow = {
  id: string;
  name: string;
  status: string;
  objective?: string;
  dailyBudget: number | null;
  impressions: number;
  clicks: number;
  spend: number;
  cpc: number;
  ctr: number;
  reach: number;
  frequency: number;
  conversions: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
};

export type MarketingLead = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: 'FACEBOOK_ADS' | 'GOOGLE_ADS' | 'INSTAGRAM' | 'WHATSAPP' | 'REFERRAL';
  stage: 'LEAD_ENTERED' | 'CONTACTED' | 'QUOTED' | 'SALE_CLOSED';
  campaignId: string | null;
  campaignName: string | null;
  revenue: number | null;
  notes: string | null;
  enteredAt: string;
  contactedAt: string | null;
  quotedAt: string | null;
  closedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MarketingLeadMetrics = {
  funnel: Record<'LEAD_ENTERED' | 'CONTACTED' | 'QUOTED' | 'SALE_CLOSED', number>;
  bySource: Array<{
    source: MarketingLead['source'];
    leads: number;
    contacted: number;
    quoted: number;
    sales: number;
    revenue: number;
    conversionRate: number;
  }>;
  byCampaign: Array<{
    key: string;
    source: MarketingLead['source'];
    campaignId: string | null;
    campaignName: string | null;
    leads: number;
    sales: number;
    revenue: number;
    spend: number;
    conversionRate: number;
    cpa: number;
    roas: number;
  }>;
  totals: {
    leads: number;
    sales: number;
    revenue: number;
    spend: number;
    conversionRate: number;
    cpa: number;
    roas: number;
  };
};

export const api = {
  login: async (email: string, password: string): Promise<{ user: User; token: string | null }> => {
    return await request<{ user: User; token: string | null }>(`/auth/login`, 'POST', { email, password });
  },

  /** Refresca el token y devuelve el usuario actualizado (incl. priceListId). Usar al cargar la app con sesión guardada. */
  refreshUser: async (): Promise<{ user: User; token: string | null }> => {
    const res = await request<{ user: any; token: string | null }>(`/auth/refresh`, 'POST', {});
    const u = res?.user;
    return {
      user: u ? {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        commissionPercentage: u.commissionPercentage != null ? Number(u.commissionPercentage) : undefined,
        priceListId: u.priceListId ?? undefined
      } : (res as any).user,
      token: res?.token ?? null
    };
  },

  // --- USERS (solo ADMIN, requiere token) ---
  getUsers: async (): Promise<User[]> => {
    const rows = await request<any[]>('/users', 'GET');
    return (Array.isArray(rows) ? rows : []).map((r: any) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      commissionPercentage: r.commissionPercentage != null ? Number(r.commissionPercentage) : undefined,
      priceListId: r.priceListId ?? undefined
    })) as User[];
  },
  createUser: async (data: { name: string; email: string; password: string; role: string; commissionPercentage?: number; priceListId?: string }): Promise<User> => {
    const created = await request<any>('/users', 'POST', data);
    return {
      id: created.id,
      name: created.name,
      email: created.email,
      role: created.role,
      commissionPercentage: created.commissionPercentage != null ? Number(created.commissionPercentage) : undefined,
      priceListId: created.priceListId ?? undefined
    } as User;
  },
  updateUser: async (id: string, data: { priceListId?: string | null; commissionPercentage?: number; email?: string; password?: string }): Promise<User> => {
    const updated = await request<any>(`/users/${id}`, 'PATCH', data);
    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      commissionPercentage: updated.commissionPercentage != null ? Number(updated.commissionPercentage) : undefined,
      priceListId: updated.priceListId ?? undefined
    } as User;
  },
  deleteUser: async (id: string): Promise<void> => {
    await request<void>(`/users/${id}`, 'DELETE');
  },

  getAssignedUserTasks: async (): Promise<UserTask[]> => {
    return await request<UserTask[]>('/user-tasks', 'GET');
  },
  getMyUserTasks: async (): Promise<UserTask[]> => {
    return await request<UserTask[]>('/user-tasks/mine', 'GET');
  },
  createAssignedUserTask: async (payload: { message: string; assignedToEmail: string; expiresAt: string }): Promise<UserTask> => {
    return await request<UserTask>('/user-tasks', 'POST', payload);
  },
  deleteAssignedUserTask: async (id: string): Promise<{ id: string }> => {
    return await request<{ id: string }>(`/user-tasks/${encodeURIComponent(id)}`, 'DELETE');
  },

  getCompanyFinanceAccess: async (): Promise<{
    allowed: boolean;
    email: string | null;
    expenseCategories: Array<{ id: string; label: string }>;
    incomeCategories: Array<{ id: string; label: string }>;
  }> => {
    return await request('/company-finance/access', 'GET');
  },

  getCompanyFinanceSummary: async (params: {
    from?: string;
    to?: string;
    includeOrders?: boolean;
    includeChannels?: boolean;
  }): Promise<{
    from: string;
    to: string;
    manualIncome: number;
    ordersRevenue: number;
    receiptsTotal: number;
    receiptsCount: number;
    mlSales: number;
    mlFees: number;
    mlOrderCount: number;
    mlConnected: boolean;
    mlNote?: string;
    tnSales: number;
    tnFees: number;
    tnOrderCount: number;
    tnConnected: boolean;
    tnNote?: string;
    channelFees: number;
    despachosCost: number;
    despachosCount: number;
    manualExpenses: number;
    fixedMonthlyExpenses: number;
    fixedMonthlySubtotal: number;
    monthsInPeriod: number;
    fixedExpenseItems: Array<{
      id: string;
      category: string;
      categoryLabel: string;
      description: string | null;
      monthlyAmount: number;
      monthsApplied: number;
      periodTotal: number;
    }>;
    totalIncome: number;
    totalExpenses: number;
    netResult: number;
    profitOrLoss: 'profit' | 'loss';
    expenseCount: number;
    incomeCount: number;
    invoicedTotal: number;
    invoicedNet: number;
    invoicedIva: number;
    invoicedCount: number;
    invoicedWholesaleTotal: number;
    invoicedWholesaleNet: number;
    invoicedWholesaleCount: number;
    invoicedMlTotal: number;
    invoicedMlNet: number;
    invoicedMlCount: number;
    invoicedTnTotal: number;
    invoicedTnNet: number;
    invoicedTnCount: number;
    pendingInvoicesTotal: number;
    pendingInvoicesCount: number;
    pendingInvoices: Array<{
      orderId: string;
      orderDate: string;
      customerName: string;
      invoiceLabel: string;
      amountWithIva: number;
      orderStatus: string;
    }>;
    byCategory: Array<{ entryType: string; category: string; categoryLabel: string; total: number; count: number }>;
    byMonth: Array<{ month: string; entryType: string; total: number }>;
  }> => {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.includeOrders) q.set('includeOrders', '1');
    if (params.includeChannels === false) q.set('includeChannels', '0');
    return await request(`/company-finance/summary?${q.toString()}`, 'GET');
  },

  getCompanyFinanceMercadoPagoMovements: async (params: {
    from?: string;
    to?: string;
  }): Promise<{
    from: string;
    to: string;
    connected: boolean;
    note?: string;
    summary: {
      count: number;
      grossIn: number;
      fees: number;
      refunds: number;
      netIn: number;
    };
    movements: Array<{
      id: string;
      date: string;
      dateTime: string;
      movementType: 'cobro' | 'reembolso' | 'pendiente' | 'otro';
      direction: 'in' | 'out';
      description: string;
      grossAmount: number;
      feeAmount: number;
      netAmount: number;
      status: string;
      paymentMethod: string;
      externalReference: string;
    }>;
  }> => {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    return await request(`/company-finance/mercadopago-movements?${q.toString()}`, 'GET', undefined, undefined, 120000);
  },

  getCompanyFinancePendingInvoices: async (limit?: number): Promise<{
    items: Array<{
      orderId: string;
      orderDate: string;
      customerName: string;
      invoiceLabel: string;
      amountWithIva: number;
      orderStatus: string;
    }>;
    totalPending: number;
  }> => {
    const q = limit != null ? `?limit=${limit}` : '';
    return await request(`/company-finance/pending-invoices${q}`, 'GET');
  },

  getCompanyFinanceEntries: async (params?: {
    from?: string;
    to?: string;
    type?: 'expense' | 'income';
  }): Promise<{ from: string; to: string; entries: Array<Record<string, unknown>> }> => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.type) q.set('type', params.type);
    return await request(`/company-finance/entries?${q.toString()}`, 'GET');
  },

  createCompanyFinanceEntry: async (payload: {
    entryType: 'expense' | 'income';
    category: string;
    amount: number;
    description?: string;
    entryDate: string;
  }) => {
    return await request('/company-finance/entries', 'POST', payload);
  },

  updateCompanyFinanceEntry: async (
    id: string,
    payload: Partial<{
      entryType: 'expense' | 'income';
      category: string;
      amount: number;
      description: string | null;
      entryDate: string;
    }>
  ) => {
    return await request(`/company-finance/entries/${encodeURIComponent(id)}`, 'PUT', payload);
  },

  deleteCompanyFinanceEntry: async (id: string): Promise<{ id: string }> => {
    return await request<{ id: string }>(`/company-finance/entries/${encodeURIComponent(id)}`, 'DELETE');
  },

  getCompanyFinanceFixedExpenses: async (): Promise<{
    items: Array<{
      id: string;
      category: string;
      categoryLabel: string;
      amount: number;
      description: string | null;
      active: boolean;
      startsFrom: string | null;
      endsAt: string | null;
    }>;
  }> => {
    return await request('/company-finance/fixed-expenses', 'GET');
  },

  createCompanyFinanceFixedExpense: async (payload: {
    category: string;
    amount: number;
    description?: string;
    active?: boolean;
    startsFrom?: string;
    endsAt?: string;
  }) => {
    return await request('/company-finance/fixed-expenses', 'POST', payload);
  },

  updateCompanyFinanceFixedExpense: async (
    id: string,
    payload: Partial<{
      category: string;
      amount: number;
      description: string | null;
      active: boolean;
      startsFrom: string | null;
      endsAt: string | null;
    }>
  ) => {
    return await request(`/company-finance/fixed-expenses/${encodeURIComponent(id)}`, 'PUT', payload);
  },

  deleteCompanyFinanceFixedExpense: async (id: string): Promise<{ id: string }> => {
    return await request<{ id: string }>(
      `/company-finance/fixed-expenses/${encodeURIComponent(id)}`,
      'DELETE'
    );
  },

  importSellers: async (payload: {
    sellers: Array<{ name: string; email: string; password?: string; commissionPercentage?: number }>;
    defaultPassword: string;
  }): Promise<{
    message: string;
    created: number;
    skipped: number;
    errors: Array<{ row: number; email?: string; message: string }>;
    errorCount: number;
  }> => {
    return await request('/users/import', 'POST', payload);
  },

  // --- PRICE LISTS (solo ADMIN) ---
  getPriceLists: async (): Promise<import('../types').PriceList[]> => {
    const rows = await request<any[]>('/price-lists', 'GET');
    return (Array.isArray(rows) ? rows : []).map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));
  },
  getPriceList: async (id: string): Promise<import('../types').PriceList & { items: { productId: string; price: number }[] }> => {
    return request<any>(`/price-lists/${id}`, 'GET');
  },
  createPriceList: async (data: {
    name: string;
    description?: string;
    sourceListId?: string;
    percentAdjust?: number;
  }): Promise<import('../types').PriceList & { itemsCopied?: number }> => {
    return request<any>('/price-lists', 'POST', data);
  },
  updatePriceList: async (id: string, data: { name?: string; description?: string }): Promise<import('../types').PriceList> => {
    return request<any>(`/price-lists/${id}`, 'PUT', data);
  },
  deletePriceList: async (id: string): Promise<void> => {
    await request<void>(`/price-lists/${id}`, 'DELETE');
  },
  getPriceListItems: async (id: string): Promise<{ id: string; productId: string; price: number; sku?: string; name?: string }[]> => {
    return request<any[]>(`/price-lists/${id}/items`, 'GET');
  },
  setPriceListItems: async (id: string, items: { productId: string; price: number }[]): Promise<{ items: { productId: string; price: number }[] }> => {
    return request<any>(`/price-lists/${id}/items`, 'PUT', items);
  },
  createPriceListsBulk: async (names: string[]): Promise<{ created: import('../types').PriceList[]; count: number }> => {
    return request<any>('/price-lists/bulk', 'POST', { names });
  },
  duplicatePriceList: async (
    id: string,
    newName: string,
    percentAdjust?: number
  ): Promise<import('../types').PriceList & { itemsCopied?: number }> => {
    return request<any>(`/price-lists/${id}/duplicate`, 'POST', {
      name: newName,
      ...(percentAdjust != null && Number.isFinite(percentAdjust) ? { percentAdjust } : {}),
    });
  },
  fillPriceListFromBase: async (id: string, multiplier?: number): Promise<{ items: { productId: string; price: number }[]; count: number; skippedWithoutBase?: number }> => {
    return request<any>(`/price-lists/${id}/fill-from-base`, 'POST', multiplier != null ? { multiplier } : {});
  },
  setPriceListItemsBySku: async (id: string, items: { sku: string; price: number }[]): Promise<{ items: { productId: string; price: number }[]; imported: number; notFound?: string[] }> => {
    return request<any>(`/price-lists/${id}/items/by-sku`, 'PUT', { items });
  },

  /** Obtener todos los vendedores con sus listas de precios asignadas. Solo ADMIN. */
  getSellersWithPriceLists: async (): Promise<Array<{ id: string; name: string; email: string; priceLists: { id: string; name: string }[] }>> => {
    return request<any>('/price-lists/sellers', 'GET');
  },

  /** Obtener listas de precios asignadas a un vendedor. Solo ADMIN. */
  getSellerPriceLists: async (sellerId: string): Promise<import('../types').PriceList[]> => {
    const rows = await request<any[]>(`/price-lists/sellers/${sellerId}`, 'GET');
    return (Array.isArray(rows) ? rows : []).map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));
  },

  /** Asignar listas de precios a un vendedor. Solo ADMIN. */
  setSellerPriceLists: async (sellerId: string, priceListIds: string[]): Promise<{ sellerId: string; priceLists: { id: string; name: string }[] }> => {
    return request<any>(`/price-lists/sellers/${sellerId}`, 'PUT', { priceListIds });
  },

  // --- PRODUCTS ---
  /** Convierte una fila de la API a Product (uso interno). */
  mapProductRow: (r: any): Product => {
    const parts = (r.sku || '').toString().split('-');
    const sizeDerived = parts.length >= 2 ? parts[parts.length - 2] : '';
    const colorDerived = parts.length >= 1 ? parts[parts.length - 1] : '';
    return {
      id: r.id,
      sku: r.sku,
      base_sku: r.base_sku,
      product_id: r.product_id,
      name: r.name,
      category: r.category,
      size: r.size_name ?? r.size_code ?? sizeDerived,
      color: r.color_name ?? colorDerived,
      stock: Number((r as any).stock_total ?? (r as any).stock ?? 0),
      price: Number((r as any).base_price ?? (r as any).price ?? 0),
      description: r.description ?? '',
      externalIds: r.externalIds,
      mayorista_pack_size: Math.max(1, Number((r as any).mayorista_pack_size) || 1),
      product_created_at: r.product_created_at ?? null,
      product_updated_at: r.product_updated_at ?? null
    } as Product;
  },

  getProducts: async (options?: { priceListId?: string | null; perPage?: number }): Promise<Product[]> => {
    return handleRequest(async () => {
      const perPage = options?.perPage ?? 5000;
      const params = new URLSearchParams({ per_page: String(perPage) });
      if (options?.priceListId) params.set('price_list_id', options.priceListId);
      const res = await request<any>(`/products?${params.toString()}`, 'GET', undefined, undefined, PRODUCTS_LIST_TIMEOUT_MS);
      const rows = Array.isArray(res) ? res : res.items;
      return rows.map((r: any) => api.mapProductRow(r));
    }, MOCK_PRODUCTS, 'getProducts');
  },

  /** Trae todas las variantes: usa páginas grandes y descarga en paralelo para reducir tiempo total. */
  getProductsAll: async (options?: { priceListId?: string | null }): Promise<Product[]> => {
    const PER_PAGE = 5000;
    const buildParams = (page: number) => {
      const p = new URLSearchParams({ per_page: String(PER_PAGE), page: String(page) });
      if (options?.priceListId) p.set('price_list_id', options.priceListId);
      return p;
    };
    const res = await request<any>(`/products?${buildParams(1).toString()}`, 'GET', undefined, undefined, PRODUCTS_LIST_TIMEOUT_MS);
    const items = Array.isArray(res) ? res : (res?.items ?? []);
    const total = typeof res?.total === 'number' ? res.total : items.length;
    const all: Product[] = items.map((r: any) => api.mapProductRow(r));
    const totalPages = Math.ceil(total / PER_PAGE) || 1;
    if (totalPages <= 1) return all;

    const CONCURRENCY = 6;
    for (let start = 2; start <= totalPages; start += CONCURRENCY) {
      const end = Math.min(start + CONCURRENCY - 1, totalPages);
      const pageNums: number[] = [];
      for (let p = start; p <= end; p++) pageNums.push(p);
      const chunks = await Promise.all(
        pageNums.map((page) =>
          request<any>(`/products?${buildParams(page).toString()}`, 'GET', undefined, undefined, PRODUCTS_LIST_TIMEOUT_MS).then((nextRes: any) => {
            const nextItems = Array.isArray(nextRes) ? nextRes : (nextRes?.items ?? []);
            return nextItems.map((r: any) => api.mapProductRow(r));
          })
        )
      );
      for (const chunk of chunks) all.push(...chunk);
    }
    return all;
  },

  /** Igual que getProducts pero sin fallback: lanza si falla. Usar al refrescar después de crear para no pisar con MOCK. */
  getProductsStrict: async (options?: { priceListId?: string | null; perPage?: number }): Promise<Product[]> => {
    const perPage = options?.perPage ?? 5000;
    const params = new URLSearchParams({ per_page: String(perPage) });
    if (options?.priceListId) params.set('price_list_id', options.priceListId);
    const res = await request<any>(`/products?${params.toString()}`, 'GET', undefined, undefined, PRODUCTS_LIST_TIMEOUT_MS);
    const rows = Array.isArray(res) ? res : (res && res.items) || [];
    return rows.map((r: any) => api.mapProductRow(r));
  },

  getProductsPaged: async (page: number, perPage: number, q?: string, sort?: 'sku' | 'name' | 'stock' | 'created_at' | 'updated_at', dir?: 'asc' | 'desc', syncFilter?: 'ALL' | 'ML' | 'TN' | 'BOTH' | 'NONE' | 'MISMATCH', options?: { skipTotal?: boolean }): Promise<{ items: Product[]; page: number; per_page: number; total: number }> => {
    return handleRequest(async () => {
      const syncMl = syncFilter === 'ML' || syncFilter === 'BOTH';
      const syncTn = syncFilter === 'TN' || syncFilter === 'BOTH';
      const syncNone = syncFilter === 'NONE';
      // MISMATCH se resuelve en frontend con stocks externos; no enviamos filtro de sync al backend
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        ...(q ? { q } : {}),
        ...(sort ? { sort } : {}),
        ...(dir ? { dir } : {}),
        ...(syncMl ? { sync_ml: '1' } : {}),
        ...(syncTn ? { sync_tn: '1' } : {}),
        ...(syncNone ? { sync_none: '1' } : {}),
        ...(options?.skipTotal ? { skip_total: '1' } : {})
      });
      const res = await request<any>(`/products?${params.toString()}`, 'GET', undefined, undefined, PRODUCTS_LIST_TIMEOUT_MS);
      const items = (res.items || []).map((r: any) => {
        const parts = (r.sku || '').toString().split('-');
        const sizeDerived = parts.length >= 2 ? parts[parts.length - 2] : '';
        const colorDerived = parts.length >= 1 ? parts[parts.length - 1] : '';
        return {
          id: r.id,
          sku: r.sku,
          base_sku: r.base_sku,
          product_id: r.product_id,
          name: r.name,
          category: r.category,
          size: r.size_name ?? r.size_code ?? sizeDerived,
          color: r.color_name ?? colorDerived,
          stock: Number((r as any).stock_total ?? (r as any).stock ?? 0),
          price: Number((r as any).base_price ?? (r as any).price ?? 0),
          description: r.description ?? '',
          externalIds: r.externalIds,
          product_created_at: r.product_created_at ?? null,
          product_updated_at: r.product_updated_at ?? null
        };
      }) as Product[];
      return { items, page: res.page, per_page: res.per_page, total: res.total };
    }, { items: MOCK_PRODUCTS.slice(0, perPage), page, per_page: perPage, total: MOCK_PRODUCTS.length }, 'getProductsPaged');
  },

  /** Inventario completo para exportar Excel: todas las variantes con stock. */
  exportInventory: async (): Promise<Array<{
    product_sku: string;
    product_name: string;
    category: string;
    base_price: number;
    variant_sku: string;
    size_code: string;
    size_name: string;
    color_code: string;
    color_name: string;
    stock: number;
    talle_display?: string;
    tienda_nube_id?: string | number | null;
    mercado_libre_id?: string | null;
    tienda_nube_variant_id?: string | number | null;
    mercado_libre_variant_id?: string | null;
    mercado_libre_item_id?: string | null;
  }>> => {
    const res = await request<{ rows: any[] }>('/products/export-inventory', 'GET', undefined, undefined, PRODUCTS_LIST_TIMEOUT_MS);
    return res?.rows ?? [];
  },

  getProductBySku: async (
    sku: string,
    opts?: { includeRelated?: boolean }
  ): Promise<{ id: string; sku: string; name: string; category?: string; base_price?: number; mercado_libre_pack_size?: number; tienda_nube_pack_size?: number; mayorista_pack_size?: number; externalIds?: any; variants?: any[] } | null> => {
    try {
      const qs =
        opts?.includeRelated === false ? '?includeRelated=0' : '';
      const res = await request<any>(`/products/${encodeURIComponent(sku)}${qs}`, 'GET');
      return res ? { ...res, mercado_libre_pack_size: res.mercado_libre_pack_size ?? 1, tienda_nube_pack_size: res.tienda_nube_pack_size ?? 1, mayorista_pack_size: res.mayorista_pack_size ?? 1 } : null;
    } catch {
      return null;
    }
  },

  getProductById: async (id: string): Promise<{ id: string; sku: string; name: string; category?: string; base_price?: number; description?: string; mercado_libre_pack_size?: number; tienda_nube_pack_size?: number; mayorista_pack_size?: number } | null> => {
    try {
      const res = await request<any>(`/products/by-id/${encodeURIComponent(id)}`, 'GET');
      return res ? { ...res, mercado_libre_pack_size: res.mercado_libre_pack_size ?? 1, tienda_nube_pack_size: res.tienda_nube_pack_size ?? 1, mayorista_pack_size: res.mayorista_pack_size ?? 1 } : null;
    } catch {
      return null;
    }
  },

  getVariantsBySku: async (
    sku: string,
    opts?: { includeRelated?: boolean }
  ): Promise<
    Array<{
      variantId: string;
      variantSku: string;
      productSku: string;
      colorCode: string;
      colorName: string;
      sizeCode: string;
      stock: number;
      inventoryHidden?: boolean;
      externalIds?: any;
    }>
  > => {
    return handleRequest(async () => {
      const qs =
        opts?.includeRelated === false ? '?includeRelated=0' : '';
      const res = await request<any>(`/products/${encodeURIComponent(sku)}${qs}`, 'GET');
      const parentExternalIds = res.externalIds || {};
      const parentSku = String(res?.sku || sku);
      const variants = (res?.variants || []).map((v: any) => ({
        variantId: v.variant_id,
        variantSku: String(v.variant_sku || v.sku || '').trim(),
        productSku: String(v.sku || parentSku).trim(),
        colorCode: v.color_code,
        colorName: v.color_name,
        sizeCode: v.size_code,
        stock: Number(v.stock ?? 0),
        inventoryHidden: v.inventory_hidden === true || Number(v.inventory_hidden) === 1,
        externalIds: {
          tiendaNube: parentExternalIds.tiendaNube,
          mercadoLibre: parentExternalIds.mercadoLibre,
          tiendaNubeVariant: v.externalIds?.tiendaNubeVariant ?? v.tienda_nube_variant_id ?? null,
          mercadoLibreVariant: v.externalIds?.mercadoLibreVariant ?? v.mercado_libre_variant_id ?? null,
          mercadoLibreItemId: v.externalIds?.mercadoLibreItemId ?? v.mercado_libre_item_id ?? null
        }
      }));
      return variants;
    }, [], 'getVariantsBySku');
  },

  getVariantById: async (variantId: string): Promise<{ id: string; sku: string | null; external_sku: string | null; product_name: string; base_sku: string; size_code: string; color_code: string; color_name: string; stock: number } | null> => {
    try {
      const res = await request<any>(`/products/variants/${encodeURIComponent(variantId)}`, 'GET');
      return res;
    } catch {
      return null;
    }
  },

  updateVariant: async (
    variantId: string,
    data: { sku?: string; externalSku?: string; inventoryHidden?: boolean }
  ): Promise<{ id: string; sku: string | null; external_sku: string | null; inventory_hidden?: boolean }> => {
    return handleRequest(async () => {
      return await request<any>(`/products/variants/${encodeURIComponent(variantId)}`, 'PUT', data);
    }, data, 'updateVariant');
  },

  getVariantPublications: async (variantId: string): Promise<Array<{ id: string; platform: string; external_product_id: string; external_variant_id: string; pack_size: number; created_at?: string }>> => {
    const res = await request<any[]>(`/products/variants/${encodeURIComponent(variantId)}/publications`, 'GET');
    return Array.isArray(res) ? res : [];
  },

  addVariantPublication: async (variantId: string, data: { platform: 'mercadolibre' | 'tiendanube'; externalProductId: string; externalVariantId?: string; packSize?: number }): Promise<any> => {
    return request<any>(`/products/variants/${encodeURIComponent(variantId)}/publications`, 'POST', data);
  },

  deleteVariantPublication: async (variantId: string, publicationId: string): Promise<void> => {
    await request<void>(`/products/variants/${encodeURIComponent(variantId)}/publications/${encodeURIComponent(publicationId)}`, 'DELETE');
  },

  /** Packs multicolor: una publicación ML/TN descuenta varias variantes (ej. pack 3 boxer: 1 negro + 1 gris + 1 blanco). */
  getPublicationBundles: async (): Promise<PublicationBundleDto[]> => {
    const res = await request<any[]>('/publication-bundles', 'GET');
    return Array.isArray(res) ? res.map(mapPublicationBundle) : [];
  },

  getPublicationBundleListingVariations: async (
    platform: 'mercadolibre' | 'tiendanube',
    listingId: string
  ): Promise<{
    platform: 'mercadolibre' | 'tiendanube';
    resolvedId: string;
    title: string;
    variations: Array<{
      variationId: string;
      itemId?: string;
      colorValueName: string;
      sizeValueName: string;
      parsedColors: string[];
      isAssorted: boolean;
      sku?: string;
      availableQuantity?: number;
      pictureIds?: string[];
    }>;
  }> => {
    const q = new URLSearchParams({ platform, listingId });
    const res = await request<any>(`/publication-bundles/listing-variations?${q.toString()}`, 'GET');
    return {
      platform: res?.platform,
      resolvedId: String(res?.resolvedId ?? ''),
      title: String(res?.title ?? ''),
      variations: Array.isArray(res?.variations)
        ? res.variations.map((v: any) => ({
            variationId: String(v?.variationId ?? ''),
            itemId: v?.itemId ? String(v.itemId) : undefined,
            colorValueName: String(v?.colorValueName ?? ''),
            sizeValueName: String(v?.sizeValueName ?? ''),
            parsedColors: Array.isArray(v?.parsedColors)
              ? v.parsedColors.map((s: any) => String(s))
              : [],
            isAssorted: Boolean(v?.isAssorted),
            sku: v?.sku ? String(v.sku) : undefined,
            availableQuantity:
              v?.availableQuantity != null ? Number(v.availableQuantity) : undefined,
            pictureIds: Array.isArray(v?.pictureIds)
              ? v.pictureIds.map((p: any) => String(p))
              : undefined
          }))
        : []
    };
  },

  getPublicationBundleSourcePreview: async (
    platform: 'mercadolibre' | 'tiendanube',
    sourceId: string
  ): Promise<{
    platform: 'mercadolibre' | 'tiendanube';
    resolvedId: string;
    title: string;
    description: string;
    images: Array<{ url: string; pictureId?: string } | string>;
    price?: number;
    fashionGrid?: {
      sizeGridId: string;
      familyName?: string;
      sourceSellerId?: string;
      integrationSellerId?: string;
      sellerMatchesIntegration: boolean;
      sellerWarning?: string;
      rows: Array<{
        variationId?: string;
        sizeDisplay: string;
        sizeGridRowId: string;
        sizeAttribute: string;
      }>;
    };
  }> => {
    const q = new URLSearchParams({ platform, sourceId });
    const res = await request<any>(`/publication-bundles/source-preview?${q.toString()}`, 'GET');
    const images = Array.isArray(res.images)
      ? res.images.map((im: any) =>
          typeof im === 'string' ? { url: im } : { url: im.url ?? '', pictureId: im.pictureId }
        )
      : [];
    return { ...res, images };
  },

  getPublicationBundleGroups: async (): Promise<PublicationBundleGroupDto[]> => {
    const res = await request<any[]>('/publication-bundles?grouped=1', 'GET');
    if (!Array.isArray(res)) return [];
    return res.map((g) => ({
      platform: g.platform,
      externalProductId: g.externalProductId ?? g.external_product_id ?? '',
      listingLabel: g.listingLabel ?? g.listing_label ?? null,
      variants: Array.isArray(g.variants) ? g.variants.map(mapPublicationBundle) : []
    }));
  },

  savePublicationBundleGroup: async (data: {
    platform: 'mercadolibre' | 'tiendanube';
    externalProductId: string;
    listingLabel?: string | null;
    variants: Array<{
      id?: string;
      label?: string | null;
      externalVariantId?: string;
      items: Array<{ variantId: string; unitsPerSale?: number }>;
    }>;
  }): Promise<PublicationBundleGroupDto> => {
    const res = await request<any>('/publication-bundles/group', 'POST', data);
    return {
      platform: res.platform,
      externalProductId: res.externalProductId ?? res.external_product_id ?? '',
      listingLabel: res.listingLabel ?? res.listing_label ?? null,
      variants: Array.isArray(res.variants) ? res.variants.map(mapPublicationBundle) : []
    };
  },

  syncPublicationBundleListingStock: async (
    platform: 'mercadolibre' | 'tiendanube',
    externalProductId: string
  ): Promise<PublicationBundleGroupDto> => {
    const res = await request<any>('/publication-bundles/sync-listing-stock', 'POST', {
      platform,
      externalProductId
    });
    return {
      platform: res.platform,
      externalProductId: res.externalProductId ?? res.external_product_id ?? '',
      listingLabel: null,
      variants: Array.isArray(res.variants) ? res.variants.map(mapPublicationBundle) : []
    };
  },

  createPublicationBundle: async (data: {
    platform: 'mercadolibre' | 'tiendanube';
    externalProductId: string;
    externalVariantId?: string;
    label?: string;
    items: Array<{ variantId: string; unitsPerSale?: number }>;
  }): Promise<PublicationBundleDto> => {
    const created = await request<any>('/publication-bundles', 'POST', data);
    return mapPublicationBundle(created);
  },

  /** Crea publicación pack en ML/TN copiando fotos de una publicación individual y registra el pack. */
  createPublicationBundleListingFromSource: async (data: {
    platform: 'mercadolibre' | 'tiendanube';
    sourceExternalProductId: string;
    titleSuffix?: string;
    skuSuffix?: string;
    label?: string;
    published?: boolean;
    items?: Array<{ variantId: string; unitsPerSale?: number }>;
    variants?: Array<{
      label?: string;
      items: Array<{ variantId: string; unitsPerSale?: number }>;
    }>;
    publicationContent?: {
      title?: string;
      description?: string;
      price?: number;
      pictures?: Array<{ url?: string; pictureId?: string; selected?: boolean }>;
    };
  }): Promise<{
    group: PublicationBundleGroupDto;
    newExternalProductId: string;
    sourceExternalProductId: string;
    message: string;
  }> => {
    const res = await request<any>('/publication-bundles/create-listing-from-source', 'POST', data, undefined, 180000);
    const g = res.group || res;
    return {
      ...res,
      group: {
        platform: g.platform,
        externalProductId: g.externalProductId ?? g.external_product_id ?? res.newExternalProductId ?? '',
        listingLabel: g.listingLabel ?? g.listing_label ?? null,
        variants: Array.isArray(g.variants) ? g.variants.map(mapPublicationBundle) : []
      }
    };
  },

  updatePublicationBundle: async (
    id: string,
    data: {
      label?: string | null;
      externalProductId?: string;
      externalVariantId?: string;
      items?: Array<{ variantId: string; unitsPerSale?: number }>;
    }
  ): Promise<PublicationBundleDto> => {
    const updated = await request<any>(`/publication-bundles/${encodeURIComponent(id)}`, 'PATCH', data);
    return mapPublicationBundle(updated);
  },

  deletePublicationBundle: async (id: string): Promise<void> => {
    await request<void>(`/publication-bundles/${encodeURIComponent(id)}`, 'DELETE');
  },

  syncPublicationBundleStock: async (id: string): Promise<PublicationBundleDto> => {
    const res = await request<any>(`/publication-bundles/${encodeURIComponent(id)}/sync-stock`, 'POST', {});
    return mapPublicationBundle(res);
  },

  getColors: async (): Promise<Array<{ id: string; code: string; name: string; hex?: string | null }>> => {
    return handleRequest(async () => {
      const rows = await request<any[]>('/colors', 'GET');
      return rows.map(r => ({
        id: r.id,
        code: r.code != null ? String(r.code).trim() : '',
        name: r.name != null ? String(r.name).trim() : '',
        hex: r.hex ?? null
      }));
    }, [], 'getColors');
  },

  getSizes: async (): Promise<Array<{ id: string; code: string; name: string }>> => {
    return handleRequest(async () => {
      const rows = await request<any[]>('/sizes', 'GET');
      return rows.map(r => ({ id: r.id, code: r.code, name: r.name }));
    }, [], 'getSizes');
  },

  createSize: async (payload: { code: string; name?: string }): Promise<{ id: string; code: string; name: string }> => {
    return request<any>('/sizes', 'POST', payload);
  },

  deleteSize: async (id: string): Promise<void> => {
    await request<void>(`/sizes/${encodeURIComponent(id)}`, 'DELETE');
  },

  unifySizes: async (): Promise<{ message: string; variantsUpdated: number; sizesDeleted: number; mappings: { from: string; to: string; variantsUpdated: number }[]; skipped: { code: string; reason: string }[] }> => {
    return request<any>('/sizes/unify', 'POST');
  },

  createColor: async (payload: { code: string; name?: string; hex?: string | null }): Promise<{ id: string; code: string; name: string; hex?: string | null }> => {
    return request<any>('/colors', 'POST', payload);
  },

  /** Crea en BD los colores del catálogo estándar (códigos 111–999) que aún no existan por `code`. */
  importStandardColorCatalog: async (): Promise<{ message: string; inserted: number; skipped: number; total: number }> => {
    return request<any>('/colors/import-standard-catalog', 'POST');
  },

  /** Une colores con code 4+ dígitos al color de 3 dígitos (primeros 3) o renombra code a 3 dígitos. */
  mergeFourDigitColorCodes: async (): Promise<{
    message: string;
    examined: number;
    mergedIntoExisting: number;
    renamedCodeOnly: number;
    skipped: string[];
    errors: string[];
  }> => {
    return request<any>('/colors/merge-four-digit-codes', 'POST');
  },

  updateColor: async (id: string, payload: { code?: string; name?: string; hex?: string | null }): Promise<{ id: string; code: string; name: string; hex?: string | null }> => {
    return request<any>(`/colors/${encodeURIComponent(id)}`, 'PUT', payload);
  },

  createProduct: async (product: Product): Promise<Product> => {
    return handleRequest(async () => {
      return await request<Product>('/products', 'POST', product);
    }, product, 'createProduct');
  },

  /** Crea producto sin fallback: lanza en 409 (SKU duplicado). Usar en lote para distinguir creados vs duplicados. */
  createProductStrict: async (product: Product): Promise<Product> => {
    return request<Product>('/products', 'POST', product);
  },

  /** Importar artículos desde Excel. `keepStockOnExistingVariants` default true: no pisa stock al reimportar filas ya cargadas. */
  importTangoArticles: async (
    rows: Record<string, unknown>[],
    onlyComplete = true,
    opts?: { keepStockOnExistingVariants?: boolean; despachoId?: string }
  ): Promise<{
    productsCreated: number;
    variantsCreated: number;
    variantsUpdated: number;
    totalProcessed: number;
    keepStockOnExistingVariants?: boolean;
    stockUpdatesSkipped?: number;
    despachoId?: string;
    despachoItemsInserted?: number;
    despachoItemsUpdated?: number;
    despachoProductsTagged?: number;
    errors: string[];
  }> => {
    const res = await request<any>('/products/import-tango', 'POST', {
      rows,
      onlyComplete,
      keepStockOnExistingVariants: opts?.keepStockOnExistingVariants,
      despachoId: opts?.despachoId,
    });
    return {
      productsCreated: res.productsCreated ?? 0,
      variantsCreated: res.variantsCreated ?? 0,
      variantsUpdated: res.variantsUpdated ?? 0,
      totalProcessed: res.totalProcessed ?? 0,
      keepStockOnExistingVariants: res.keepStockOnExistingVariants,
      stockUpdatesSkipped: res.stockUpdatesSkipped,
      despachoId: res.despachoId,
      despachoItemsInserted: res.despachoItemsInserted,
      despachoItemsUpdated: res.despachoItemsUpdated,
      despachoProductsTagged: res.despachoProductsTagged,
      errors: Array.isArray(res.errors) ? res.errors : [],
    };
  },
  
  updateProduct: async (product: Product & { mercadoLibrePackSize?: number; tiendaNubePackSize?: number; mayoristaPackSize?: number }): Promise<Product> => {
    const payload: any = {
      sku: product.sku,
      name: product.name,
      category: product.category,
      base_price: product.price,
      description: product.description
    };
    if (product.mercadoLibrePackSize != null) payload.mercadoLibrePackSize = product.mercadoLibrePackSize;
    if (product.tiendaNubePackSize != null) payload.tiendaNubePackSize = product.tiendaNubePackSize;
    if (product.mayoristaPackSize != null) payload.mayoristaPackSize = product.mayoristaPackSize;
    return handleRequest(async () => {
      return await request<Product>(`/products/${product.id}`, 'PUT', payload);
    }, product, 'updateProduct');
  },

  deleteAllProducts: async (): Promise<void> => {
    return handleRequest(async () => {
      await request<void>('/products/all', 'DELETE');
    }, undefined, 'deleteAllProducts');
  },

  /** Elimina una variante (y su stock). Falla si la variante está en pedidos. */
  deleteVariant: async (variantId: string): Promise<void> => {
    await request<void>(`/products/variants/${encodeURIComponent(variantId)}`, 'DELETE');
  },

  /** Elimina un producto (artículo) y todas sus variantes. Falla si alguna variante está en pedidos. */
  deleteProduct: async (productId: string): Promise<void> => {
    await request<void>(`/products/${encodeURIComponent(productId)}`, 'DELETE');
  },

  /** Grupos de artículos duplicados (mismo nombre, SKU parecido, etc.) para revisar antes de fusionar. */
  getDuplicateProducts: async (params?: { q?: string; limit?: number }): Promise<{
    filter: string | null;
    totalProducts: number;
    duplicateByName: Array<{
      kind: string;
      key: string;
      productCount: number;
      products: Array<{ id: string; sku: string; name: string; colorCount: number; variantCount: number; stockTotal: number }>;
    }>;
    duplicateBySkuCore: Array<{
      kind: string;
      key: string;
      productCount: number;
      products: Array<{ id: string; sku: string; name: string; colorCount: number; variantCount: number; stockTotal: number }>;
    }>;
    duplicateBySkuDigitPrefix: Array<{
      kind: string;
      key: string;
      productCount: number;
      products: Array<{ id: string; sku: string; name: string; colorCount: number; variantCount: number; stockTotal: number }>;
    }>;
  }> => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.limit != null) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return request(`/products/duplicates${qs ? `?${qs}` : ''}`, 'GET');
  },

  /** Fusiona varios artículos (padre) en uno principal: suma stock, mueve variantes y borra duplicados. Solo admin/deposito. */
  mergeManualProducts: async (payload: {
    keeperProductId: string;
    duplicateProductIds: string[];
    dryRun?: boolean;
  }): Promise<{
    dryRun: boolean;
    keeperProductId: string;
    variantsMerged: number;
    productsRemoved: number;
    errors: string[];
    message?: string;
  }> => {
    return request('/products/merge-manual', 'POST', payload, undefined, 120000);
  },

  /** Une dos variantes del mismo artículo (stock y vínculos ML/TN en la que queda). */
  mergeManualVariantsPair: async (payload: {
    keeperVariantId: string;
    absorbVariantId: string;
    allowDifferentSize?: boolean;
  }): Promise<{ ok: boolean }> => {
    return request<{ ok: boolean }>('/products/variants/merge-manual', 'POST', payload, undefined, 120000);
  },

  // --- CUSTOMERS ACCESS / USERS ---

  /** Asigna o crea un usuario (rol CUSTOMER) para un cliente existente. Solo ADMIN. */
  attachUserToCustomer: async (
    customerId: string,
    payload: { name?: string; email: string; password: string }
  ): Promise<Customer> => {
    return await request<Customer>(`/customers/${encodeURIComponent(customerId)}/attach-user`, 'POST', payload);
  },

  patchStock: async (args: { variantId?: string; sku?: string; colorCode?: string; sizeCode?: string; stock: number }): Promise<{ variantId: string; stock: number }> => {
    return handleRequest(async () => {
      return await request<{ variantId: string; stock: number }>(`/products/stock`, 'PATCH', args);
    }, { variantId: args.variantId || '', stock: args.stock }, 'patchStock');
  },

  updateProductExternalIds: async (id: string, ids: { tiendaNubeId?: string; mercadoLibreId?: string }): Promise<void> => {
    return handleRequest(async () => {
      await request<void>(`/products/${id}/external-ids`, 'PUT', ids);
    }, undefined, 'updateProductExternalIds');
  },

  updateVariantExternalIds: async (variantId: string, ids: { tiendaNubeVariantId?: string; tiendaNubeProductId?: string; mercadoLibreVariantId?: string; mercadoLibreItemId?: string; externalSku?: string }): Promise<{ stockFromML?: number }> => {
    return handleRequest(async () => {
      return await request<{ stockFromML?: number }>(`/products/variants/${variantId}/external-ids`, 'PUT', ids);
    }, {}, 'updateVariantExternalIds');
  },

  unlinkProductPlatforms: async (id: string, opts?: { tiendaNube?: boolean; mercadoLibre?: boolean; variants?: boolean }): Promise<{ ok: boolean } | null> => {
    return handleRequest(async () => {
      return await request<{ ok: boolean }>(`/products/${encodeURIComponent(id)}/unlink`, 'POST', opts || {});
    }, null, 'unlinkProductPlatforms');
  },

  bulkLinkVariants: async (payload: {
    productId?: string;
    mercadoLibreItemId?: string;
    tiendaNubeProductId?: string;
    links: Array<{ variantId: string; mercadoLibreVariantId?: string | number; mercadoLibreItemId?: string; tiendaNubeVariantId?: string | number; tiendaNubeProductId?: string | number; externalSku?: string }>;
  }): Promise<{ updated: number; synced?: number; productId?: string }> => {
    // Sincroniza stock con ML/TN por cada variante; 15s por defecto suele ser insuficiente.
    return request<{ updated: number; synced?: number; productId?: string }>('/products/variants/bulk-link', 'POST', payload, undefined, 120000);
  },

  // --- ORDERS ---
  getOrders: async (opts?: { includeArchived?: boolean; archivedOnly?: boolean; orderId?: string }): Promise<Order[]> => {
    return handleRequest(async () => {
      const params = new URLSearchParams();
      if (opts?.includeArchived) params.set('includeArchived', 'true');
      if (opts?.archivedOnly) params.set('archivedOnly', 'true');
      if (opts?.orderId) params.set('orderId', opts.orderId);
      const q = params.toString();
      return await request<Order[]>(`/orders${q ? '?' + q : ''}`, 'GET');
    }, MOCK_ORDERS, 'getOrders');
  },

  /** Pedidos sin factura imputables a un recibo (en saldo del cliente). */
  getLinkableOrdersForPayment: async (
    customerId: string
  ): Promise<
    Array<{
      orderId: string;
      customerId: string;
      date: string;
      total: number;
      remitoNumber?: number;
      paymentStatus: 'pendiente' | 'pagado';
      includeInSaldo: boolean;
      outstanding: number;
    }>
  > => {
    const q = encodeURIComponent(customerId);
    const rows = await request<any[]>(`/orders/linkable-for-payment?customerId=${q}`, 'GET');
    return Array.isArray(rows) ? rows : [];
  },

  archiveOrder: async (orderId: string, archived: boolean): Promise<{ id: string; archived: boolean }> => {
    return await request<{ id: string; archived: boolean }>(`/orders/${orderId}/archive`, 'PATCH', { archived });
  },

  createOrder: async (order: Order): Promise<Order> => {
    return handleRequest(async () => {
      return await request<Order>('/orders', 'POST', order);
    }, order, 'createOrder');
  },

  importOrdersFromMatrix: async (payload: {
    date?: string;
    /** Lista de precios (id). Si no se envía, el servidor usa la del cliente. */
    priceListId?: string | null;
    lines: Array<{
      customerRef: string;
      codigo: string;
      color: string;
      sizeCode: string;
      quantity: number;
      unitPrice?: number | null;
    }>;
  }): Promise<{
    created: Order[];
    errors: { customerRef: string; message: string }[];
    counts: { created: number; errors: number };
  }> => {
    return await request('/orders/import-matrix', 'POST', payload);
  },
  
  updateOrder: async (order: Order): Promise<Order> => {
    return handleRequest(async () => {
      return await request<Order>(`/orders/${order.id}`, 'PUT', order);
    }, order, 'updateOrder');
  },
  
  deleteOrder: async (orderId: string): Promise<{ id: string }> => {
    return handleRequest(async () => {
      return await request<{ id: string }>(`/orders/${orderId}`, 'DELETE');
    }, { id: orderId }, 'deleteOrder');
  },


  updateOrderStatus: async (id: string, status: OrderStatus, pickedBy?: string): Promise<void> => {
    return handleRequest(async () => {
      await request<void>(`/orders/${id}/status`, 'PATCH', { status, pickedBy });
    }, undefined, 'updateOrderStatus');
  },

  patchOrderPaymentStatus: async (
    orderId: string,
    paymentStatus: 'pendiente' | 'pagado'
  ): Promise<{ id: string; paymentStatus: string; includeInSaldo?: boolean }> => {
    return await request(`/orders/${orderId}/payment-status`, 'PATCH', { paymentStatus });
  },

  patchOrderIncludeInSaldo: async (
    orderId: string,
    includeInSaldo: boolean
  ): Promise<{ id: string; includeInSaldo: boolean; paymentStatus: string }> => {
    return await request(`/orders/${orderId}/include-in-saldo`, 'PATCH', { includeInSaldo });
  },

  /** Desconta stock del pedido mayorista ahora (idempotente; si es borrador pasa a confirmado). */
  applyMayoristaStock: async (
    orderId: string
  ): Promise<{ id: string; success?: boolean; alreadyApplied?: boolean; message?: string; errors?: string[] }> => {
    return await request(`/orders/${orderId}/apply-mayorista-stock`, 'POST', {});
  },

  /** Devuelve al inventario el stock descontado por el pedido, sin cancelarlo. */
  restoreMayoristaStock: async (
    orderId: string
  ): Promise<{ id: string; success?: boolean; alreadyRestored?: boolean; message?: string; errors?: string[] }> => {
    return await request(`/orders/${orderId}/restore-mayorista-stock`, 'POST', {});
  },

  /** Indica si AFIP está configurado en el servidor (para mostrar botón Emitir factura). */
  getAfipStatus: async (): Promise<{ configured: boolean; production?: boolean }> => {
    const res = await request<{ configured: boolean; production?: boolean }>('/afip/status', 'GET');
    return res ?? { configured: false };
  },

  /** Datos del emisor desde el servidor (CUIT, razón social, etc.) para mostrar en la factura. */
  getAfipIssuer: async (): Promise<{ cuit: string; businessName: string; address: string; city: string }> => {
    try {
      const res = await request<any>('/afip/issuer', 'GET');
      return { cuit: res?.cuit ?? '', businessName: res?.businessName ?? '', address: res?.address ?? '', city: res?.city ?? '' };
    } catch {
      return { cuit: '', businessName: '', address: '', city: '' };
    }
  },

  /**
   * Datos completos del remitente (incluye `caiRemito` y `caiRemitoVencimiento`) leídos de la base de datos.
   * Se usa al imprimir remitos/facturas porque `getRemitente()` de `apiIntegration.ts` solo lee localStorage
   * (que puede no tener el CAI si el usuario lo configuró desde otro navegador/dispositivo).
   */
  getRemitenteServer: async (): Promise<{
    businessName: string;
    address: string;
    city: string;
    cuit: string;
    email: string;
    phone: string;
    logoUrl: string;
    caiRemito: string;
    caiRemitoVencimiento: string;
  }> => {
    try {
      const res = await request<any>('/afip/remitente', 'GET');
      return {
        businessName: res?.businessName ?? '',
        address: res?.address ?? '',
        city: res?.city ?? '',
        cuit: res?.cuit ?? '',
        email: res?.email ?? '',
        phone: res?.phone ?? '',
        logoUrl: res?.logoUrl ?? '',
        caiRemito: res?.caiRemito ?? '',
        caiRemitoVencimiento: res?.caiRemitoVencimiento ?? ''
      };
    } catch {
      return { businessName: '', address: '', city: '', cuit: '', email: '', phone: '', logoUrl: '', caiRemito: '', caiRemitoVencimiento: '' };
    }
  },

  /** Condición IVA (y opcional razón social, domicilio) de un CUIT vía Padrón AFIP. Requiere login. */
  getCondicionIvaByCuit: async (cuit: string): Promise<{ condicionIva: string; businessName?: string; address?: string; city?: string }> => {
    const cuitClean = String(cuit).replace(/\D/g, '');
    const res = await request<{ condicionIva: string; businessName?: string; address?: string; city?: string }>(
      `/afip/condicion-iva?cuit=${encodeURIComponent(cuitClean)}`,
      'GET'
    );
    return res ?? { condicionIva: '' };
  },

  /** Consulta en AFIP si un comprobante existe (FECompConsultar). Confirmación 100% de que AFIP lo tiene. */
  consultarComprobanteAfip: async (puntoVta: number, cbteTipo: number, cbteNro: number): Promise<{ existe: boolean; resultado?: any; error?: string }> => {
    const params = new URLSearchParams({
      puntoVta: String(puntoVta),
      cbteTipo: String(cbteTipo),
      cbteNro: String(cbteNro)
    });
    return await request<{ existe: boolean; resultado?: any; error?: string }>(`/afip/consultar-comprobante?${params}`, 'GET');
  },

  /** Emite factura electrónica AFIP para un pedido (requiere picking y estado control/despacho). */
  emitirFactura: async (orderId: string, body?: { cbteTipo?: 1 | 6 }): Promise<{ id: string; orderId: string; cae: string; caeFchVto?: string; cbteDesde: number; cbteHasta: number; cbteTipo: number; puntoVta?: number; agipAlicuota?: number; agipRetPer?: number }> => {
    return await request<any>(`/orders/${orderId}/emitir-factura`, 'POST', body ?? {}, undefined, AFIP_EMIT_TIMEOUT_MS);
  },

  /** Obtiene los datos de la factura AFIP asociada a un pedido (si existe). */
  getOrderInvoice: async (
    orderId: string
  ): Promise<{
    id: string;
    orderId: string;
    cae: string;
    caeFchVto?: string;
    puntoVta?: number;
    cbteTipo: number;
    cbteDesde: number;
    cbteHasta: number;
    createdAt?: string;
    agipAlicuota?: number;
    agipRetPer?: number;
  } | null> => {
    try {
      return await request<any>(`/orders/${orderId}/invoice`, 'GET');
    } catch {
      return null;
    }
  },

  /**
   * Recalcula IIBB (AGIP) y la persiste en `invoices` para un pedido ya facturado.
   * Actualiza el PDF interno al refrescar; no modifica el CAE en AFIP.
   */
  recalculateStoredInvoiceAgip: async (
    orderId: string
  ): Promise<{ orderId: string; agipAlicuota: number; agipRetPer: number; message?: string }> => {
    return await request(`/orders/${encodeURIComponent(orderId)}/invoice/recalculate-agip`, 'POST', {});
  },

  /**
   * NC total en AFIP (sin restaurar stock) + nueva factura con percepción IIBB en WSFE.
   * Solo si el pedido no tiene NC previas y AGIP devuelve importe > 0.
   */
  reemitirFacturaConAgip: async (
    orderId: string,
    body?: { cbteTipo?: 1 | 6 }
  ): Promise<{
    message?: string;
    creditNote?: Record<string, unknown>;
    invoice?: Record<string, unknown>;
    creditNoteEmitted?: boolean;
    detail?: string;
  }> => {
    return await request(`/orders/${encodeURIComponent(orderId)}/invoice/reemitir-con-agip`, 'POST', body ?? {}, undefined, AFIP_EMIT_TIMEOUT_MS);
  },

  /** Lista las notas de crédito de un pedido.
   *  Cada entrada representa un comprobante AFIP único (CAE) ya consolidado en
   *  backend. Cuando la NC fue emitida sobre varios ítems, el backend devuelve
   *  `itemIndexes`, `amountByItemIndex` y `quantityByItemIndex` para que el PDF
   *  pueda renderizar un renglón por ítem (no agruparlo en uno solo). */
  getOrderCreditNotes: async (orderId: string): Promise<import('../types').CreditNote[]> => {
    const rows = await request<any[]>(`/orders/${orderId}/credit-notes`, 'GET');
    return (Array.isArray(rows) ? rows : []).map((r: any) => {
      const itemIndexesRaw = Array.isArray(r.itemIndexes) ? r.itemIndexes : [];
      const itemIndexes = itemIndexesRaw
        .map((x: any) => Number(x))
        .filter((x: number) => Number.isInteger(x) && x >= 0);
      const sanitizeNumMap = (obj: any): Record<number, number> => {
        if (!obj || typeof obj !== 'object') return {};
        const out: Record<number, number> = {};
        for (const k of Object.keys(obj)) {
          const idx = Number(k);
          const val = Number((obj as any)[k]);
          if (Number.isInteger(idx) && idx >= 0 && Number.isFinite(val)) out[idx] = val;
        }
        return out;
      };
      return {
        id: r.id,
        orderId: r.orderId,
        invoiceId: r.invoiceId,
        cae: r.cae,
        caeFchVto: r.caeFchVto,
        puntoVta: r.puntoVta,
        cbteTipo: r.cbteTipo,
        cbteDesde: r.cbteDesde,
        cbteHasta: r.cbteHasta,
        amountCredited: Number(r.amountCredited),
        scope: r.scope === 'item' ? 'item' : 'total',
        itemIndex: r.itemIndex,
        itemIndexes,
        amountByItemIndex: sanitizeNumMap(r.amountByItemIndex),
        quantityByItemIndex: sanitizeNumMap(r.quantityByItemIndex),
        createdAt: r.createdAt,
        voidedInvoice: r.voidedInvoice
          ? {
              cae: String((r.voidedInvoice as any).cae ?? ''),
              puntoVta:
                (r.voidedInvoice as any).puntoVta != null ? Number((r.voidedInvoice as any).puntoVta) : undefined,
              cbteTipo:
                (r.voidedInvoice as any).cbteTipo != null ? Number((r.voidedInvoice as any).cbteTipo) : undefined,
              cbteDesde: Number((r.voidedInvoice as any).cbteDesde),
            }
          : undefined,
        supersededByReinvoice: !!r.supersededByReinvoice,
      } as import('../types').CreditNote;
    });
  },

  /** Emite una Nota de Crédito AFIP: todo el pedido (tipo: 'total') o un ítem (tipo: 'item', itemIndex, quantity opcional). */
  emitirNotaCredito: async (
    orderId: string,
    data: {
      tipo: 'total' | 'item' | 'items';
      itemIndex?: number;
      quantity?: number;
      items?: Array<{ itemIndex: number; quantity: number }>;
      /** Si es false, no devuelve unidades al inventario (solo anulación fiscal). Por defecto true. */
      restoreStock?: boolean;
    }
  ): Promise<{ id: string; orderId: string; cae: string; caeFchVto?: string; puntoVta: number; cbteTipo: number; cbteDesde: number; cbteHasta: number; amountCredited: number; stockRestored?: boolean }> => {
    return await request<any>(`/orders/${orderId}/emitir-nota-credito`, 'POST', data, undefined, AFIP_EMIT_TIMEOUT_MS);
  },

  getOrderDebitNotes: async (orderId: string): Promise<import('../types').DebitNote[]> => {
    const rows = await request<any[]>(`/orders/${orderId}/debit-notes`, 'GET');
    return (rows || []).map((r) => ({
      id: String(r.id),
      orderId: String(r.orderId ?? r.order_id ?? orderId),
      invoiceId: String(r.invoiceId ?? r.invoice_id ?? ''),
      cae: String(r.cae ?? ''),
      caeFchVto: r.caeFchVto ?? r.cae_fch_vto ?? undefined,
      puntoVta: Number(r.puntoVta ?? r.punto_venta ?? 0),
      cbteTipo: Number(r.cbteTipo ?? r.cbte_tipo ?? 0),
      cbteDesde: Number(r.cbteDesde ?? r.cbte_desde ?? 0),
      cbteHasta: Number(r.cbteHasta ?? r.cbte_hasta ?? r.cbteDesde ?? r.cbte_desde ?? 0),
      amountDebited: Number(r.amountDebited ?? r.amount_debited ?? 0),
      agipAlicuota: r.agipAlicuota != null ? Number(r.agipAlicuota) : r.agip_alicuota != null ? Number(r.agip_alicuota) : undefined,
      agipRetPer: r.agipRetPer != null ? Number(r.agipRetPer) : r.agip_ret_per != null ? Number(r.agip_ret_per) : undefined,
      scope: r.scope ?? undefined,
      itemIndex: r.itemIndex ?? r.item_index ?? undefined,
      itemIndexes: Array.isArray(r.itemIndexes) ? r.itemIndexes : undefined,
      amountByItemIndex: r.amountByItemIndex ?? undefined,
      quantityByItemIndex: r.quantityByItemIndex ?? undefined,
      description: r.description ?? undefined,
      createdAt: r.createdAt ?? r.created_at ?? undefined,
    })) as import('../types').DebitNote[];
  },

  emitirNotaDebito: async (
    orderId: string,
    data: {
      tipo: 'iibb' | 'monto' | 'total' | 'item' | 'items';
      netAmount?: number;
      description?: string;
      itemIndex?: number;
      quantity?: number;
      items?: Array<{ itemIndex: number; quantity: number }>;
    }
  ): Promise<{
    id: string;
    orderId: string;
    cae: string;
    caeFchVto?: string;
    puntoVta: number;
    cbteTipo: number;
    cbteDesde: number;
    cbteHasta: number;
    amountDebited: number;
    agipRetPer?: number;
    scope?: string;
  }> => {
    return await request<any>(`/orders/${orderId}/emitir-nota-debito`, 'POST', data, undefined, AFIP_EMIT_TIMEOUT_MS);
  },

  /** Lista los ítems del pedido que quedaron sin número de despacho asignado. */
  getOrderItemsMissingDespacho: async (orderId: string): Promise<Array<{
    orderItemId: string;
    variantId: string;
    productId: string;
    sku: string;
    productName: string;
    sizeCode: string;
    colorName: string;
    quantity: number;
    productLastDespachoId: string | null;
    productLastDespachoNumero: string | null;
  }>> => {
    return await request<any[]>(`/orders/${orderId}/items-missing-despacho`, 'GET');
  },

  /**
   * Asigna (o devuelve si ya existía) el N° de remito único e incremental del pedido.
   * Idempotente: si el pedido ya tiene número asignado, devuelve el mismo.
   */
  assignRemitoNumber: async (orderId: string): Promise<{
    orderId: string;
    remitoNumber: number;
    assigned: boolean;
  }> => {
    return await request<any>(`/orders/${orderId}/remito-number/assign`, 'POST', {});
  },

  /**
   * Asigna despachos (existentes por id, existentes por número o nuevos) a ítems concretos de un pedido.
   * Cada asignación debe traer `orderItemId` y o `despachoId` o `numeroDespacho`.
   */
  assignDespachosToOrderItems: async (
    orderId: string,
    assignments: Array<{
      orderItemId: string;
      despachoId?: string;
      numeroDespacho?: string;
      paisOrigen?: string;
      fechaDespacho?: string;
    }>
  ): Promise<{
    orderId: string;
    applied: Array<{ orderItemId: string; despachoId: string; numeroDespacho: string; created: boolean }>;
    errors: string[];
  }> => {
    return await request<any>(`/orders/${orderId}/assign-despachos`, 'PUT', { assignments });
  },

  // --- CUSTOMERS ---
  getCustomers: async (): Promise<Customer[]> => {
    return handleRequest(async () => {
      const rows = await request<any[]>('/customers', 'GET');
      return (Array.isArray(rows) ? rows : []).map((r: any) => mapCustomerFromApi(r));
    }, [], 'getCustomers');
  },

  /** Exporta clientes individuales (1 fila por cliente). */
  exportCustomersIndividuals: async (): Promise<void> => {
    const blob = await getBlob('/customers/export-individuales');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes_individuales_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Exporta plantilla para actualización masiva (IVA, lista de precios, saldo inicio). */
  exportCustomersBulkUpdate: async (): Promise<void> => {
    const blob = await getBlob('/customers/export-actualizacion-masiva');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes_actualizacion_masiva_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Exporta un Excel con una hoja por cliente (opcionalmente solo IDs seleccionados). */
  exportCustomersBySheets: async (customerIds?: string[]): Promise<void> => {
    const blob = await postBlob('/customers/export-por-hojas', {
      customerIds: Array.isArray(customerIds) ? customerIds : []
    }, 120000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes_por_hoja_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Métricas mayorista: ranking de artículos más pedidos (Excel). */
  exportWholesaleTopProductsMetrics: async (params?: { from?: string; to?: string }): Promise<void> => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    const blob = await getBlob(`/orders/metrics/top-products/export${q.toString() ? `?${q.toString()}` : ''}`, 120000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metricas_mayorista_top_articulos_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /**
   * Cartera unificada: saldo importado + facturas/pedidos pendientes (IVA) − NC (IVA) − recibos (Facturación).
   * orderCargosPendientes = suma brutos pedidos × 1,21; totalNotasCredito = NC aplicadas × 1,21 (tope por pedido).
   */
  getCarteraTotals: async (): Promise<
    Array<{
      customerId: string;
      /** Suma de totales de pedidos pendientes × 1,21 (antes de restar NC). */
      orderCargosPendientes: number;
      /** Notas de crédito sobre esos pedidos × 1,21 (sin exceder el total de cada pedido). */
      totalNotasCredito: number;
      multimediaSaldo: number;
      totalPagos: number;
      saldoPendienteUnificado: number;
    }>
  > => {
    return await request('/customers/cartera-totals', 'GET');
  },

  /** Saldos: pedidos impagos (IVA incl.) menos pagos/recibos cargados en Facturación. */
  getSaldosPendientes: async (): Promise<Array<{
    customerId: string;
    businessName: string;
    contactName: string;
    cuit: string;
    city: string;
    email: string;
    saldoPendiente: number;
    /** Suma pedidos con cobro pendiente (IVA 21%), antes de restar pagos */
    totalCargosPendiente: number;
    /** Suma de recibos en `payments` para el cliente */
    totalPagos: number;
    pedidosPendientes: number;
  }>> => {
    return await request('/customers/saldos-pendientes', 'GET');
  },

  exportSaldosPendientes: async (): Promise<void> => {
    const blob = await getBlob('/customers/saldos-pendientes/export');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saldos_pendientes_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Excel con saldos pendientes por cliente/vendedor + detalle de facturas, NC y recibos. */
  exportSaldosPendientesDetalle: async (): Promise<void> => {
    const blob = await getBlob('/customers/saldos-pendientes/export-detalle', 120000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saldos_pendientes_detalle_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Excel solo con lo cargado en LupoHub: facturas AFIP, NC y recibos (sin import Multimedia ni externos). */
  exportSaldosMovimientosSistema: async (): Promise<void> => {
    const blob = await getBlob('/customers/saldos-pendientes/export-sistema', 120000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `movimientos_sistema_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Excel de saldos pendientes: resumen + detalle por cliente. Rango opcional: solo lista movimientos
   *  dentro del período; el saldo corrido y el total usan el mismo criterio que el historial unificado
   *  incluyendo arrastre de movimientos anteriores a "desde" (no se listan, sí impactan en el saldo). */
  exportSaldosPendientesPorCliente: async (params?: {
    sellerId?: string;
    from?: string;
    to?: string;
    sellerName?: string;
    /** Si true, lista solo movimientos desde la última vez que el saldo del cliente quedó en cero. */
    sinceZero?: boolean;
    /**
     * historial: facturas/NC/recibos del sistema + import Tango/Multimedia + externos por CUIT.
     * sistema: solo tablas LupoHub (facturas AFIP, NC y recibos). Default si no se pasa source.
     * tango: solo importados Multimedia (Tango), sin dedupe contra payments.
     */
    source?: 'historial' | 'sistema' | 'tango';
  }): Promise<void> => {
    const q = new URLSearchParams();
    if (params?.sellerId) q.set('sellerId', params.sellerId);
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.sinceZero) q.set('sinceZero', '1');
    if (params?.source === 'sistema' || params?.source === 'tango' || params?.source === 'historial') {
      q.set('source', params.source);
    }
    const qs = q.toString() ? `?${q.toString()}` : '';
    const { blob, headers } = await getBlobResponse(`/customers/saldos-pendientes/export-por-cliente${qs}`, 120000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const sellerLabelSafe = String(params?.sellerName || '')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const serverFilename =
      getFilenameFromContentDisposition(headers['content-disposition']) ||
      `saldos pendientes - ${sellerLabelSafe || 'todos'} - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.download = serverFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Hoja única "Resumen" estilizada (sin columna Hoja): código, cliente, vendedor, zona, saldo final, movimientos. */
  exportSaldosPendientesMultimedias: async (): Promise<void> => {
    const blob = await getBlob('/customers/saldos-pendientes/export-multimedias', 90000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saldos_pendientes_resumen_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Movimientos de cuenta importados del Excel (Tango/Multimedias) para la ficha del cliente. */
  getCustomerMultimediaLedger: async (
    customerId: string
  ): Promise<{
    customerId: string;
    legacyCode: string | null;
    accountZone: string | null;
    accountSellerLabel: string | null;
    movementCount: number;
    lastSaldo: number;
    entries: Array<{
      lineOrder: number;
      lineDate: string;
      tipo: string;
      numero: string | null;
      edc: string | null;
      vto: string | null;
      importe: number | null;
      saldo: number | null;
      detalle: string | null;
      paginaPdf: string | null;
      /** Factura anulada por NC de reemisión: visible pero no modifica saldo corrido. */
      excluirDeSaldo?: boolean;
      voidedForReinvoice?: boolean;
      /** NC de reemisión IIBB: visible pero no modifica saldo corrido. */
      supersededByReinvoice?: boolean;
      /** Recibo del cargo anterior a reemisión IIBB: visible pero no modifica saldo corrido. */
      supersededReinvoicePayment?: boolean;
      orderId?: string | null;
      invoiceId?: string | null;
      facLinks?: {
        orderId: string | null;
        invoiceId: string | null;
        invoiceNumero?: string | null;
        voidedInvoiceNumero?: string | null;
        agipRetPer?: number | null;
        importeConIibb?: number | null;
        voidedForReinvoice?: boolean;
      };
      /** NC LupoHub: factura anulada y/o emitida tras la NC. */
      ncLinks?: {
        voidedInvoiceNumero: string | null;
        issuedInvoiceNumero: string | null;
        issuedInvoiceIibb: number | null;
        issuedInvoiceImporte: number | null;
        reissueWithIibb: boolean;
        orderId: string | null;
      };
      /** Comprobante manual (factura o NC cargada a mano). */
      manualComprobanteId?: string;
    }>;
  }> => {
    return await request(`/customers/${encodeURIComponent(customerId)}/multimedia-ledger`, 'GET');
  },

  /** Último saldo de cuenta importada (Excel) por cliente — para cards de cartera. */
  getMultimediaSaldosSummary: async (): Promise<
    Array<{ customerId: string; lastSaldo: number; movementCount: number }>
  > => {
    return await request('/customers/multimedia-saldos-summary', 'GET');
  },

  /** Excel estilo Multimedias: hoja Resumen + una hoja por cliente con historial de cuenta. */
  exportMultimediaHistorial: async (): Promise<void> => {
    const blob = await getBlob('/customers/multimedia-historial/export', 120000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historial_clientes_multimedias_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  importMultimediaHistorial: async (
    file: File
  ): Promise<{
    message: string;
    sheetsProcessed: number;
    customersUpdated: number;
    rowsInserted: number;
    notFoundSheets: string[];
    notFoundCount: number;
    skippedNotYourCustomer: string[];
    skippedCount: number;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    return requestFormData('/customers/multimedia-historial/import', formData, 180000);
  },

  /** Resumen Multimedias: asigna seller_id según columna "Vendedor habitual" (usuarios vendedor.{n}@importado.lupohub.local). Solo ADMIN. */
  assignCustomerSellersFromResumen: async (
    file: File
  ): Promise<{
    message: string;
    rowsProcessed: number;
    customersUpdated: number;
    skippedNoSeller: number;
    skippedNoCustomer: number;
    skippedNoVendedorCell: number;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    return requestFormData('/customers/assign-sellers-resumen', formData, 120000);
  },

  /** Quita pendientes de pedidos ya despachados para un cliente (ajusta quantity a picked). */
  clearCustomerDispatchedPendings: async (customerId: string): Promise<{ message: string; ordersUpdated: number; itemsAdjusted: number; itemsRemoved: number }> => {
    return await request(`/customers/${encodeURIComponent(customerId)}/clear-dispatched-pendings`, 'POST');
  },

  adjustCustomerSaldo: async (
    customerId: string,
    targetSaldo: number
  ): Promise<{
    ok: boolean;
    customerId: string;
    targetSaldo: number;
    previousSaldo: number;
    newSaldo: number;
    newOpeningBalance: number;
  }> => {
    return await request(`/customers/${encodeURIComponent(customerId)}/adjust-saldo`, 'POST', {
      targetSaldo
    });
  },

  restoreCustomerAfipInvoices: async (
    customerId: string,
    params?: { maxScan?: number }
  ): Promise<{
    ok: boolean;
    customerId: string;
    customerName?: string;
    restored: number;
    pendingOrders: number;
    stillPending: number;
    scanned: number;
    details: Array<{
      orderId: string;
      cbteTipo: number;
      cbteDesde: number;
      puntoVenta: number;
      cae: string;
      source: string;
    }>;
    message?: string;
  }> => {
    return await request(
      `/customers/${encodeURIComponent(customerId)}/restore-lupohub-invoices`,
      'POST',
      params ?? {},
      undefined,
      180000
    );
  },

  restoreAllLupohubInvoices: async (params?: { maxScan?: number }): Promise<{
    ok: boolean;
    customersProcessed: number;
    totalRestored: number;
    results: Array<{
      customerId: string;
      customerName: string;
      restored: number;
      pendingOrders: number;
      stillPending: number;
      scanned: number;
    }>;
  }> => {
    return await request('/customers/restore-lupohub-invoices', 'POST', params ?? {}, undefined, 600000);
  },

  exportCustomerDetail: async (customerId: string, params?: { from?: string; to?: string }): Promise<void> => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    let blob: Blob;
    let filename: string | null = null;
    const parseFilename = (contentDisposition: string | null | undefined): string | null => {
      if (!contentDisposition) return null;
      const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
      const plainMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i) || contentDisposition.match(/filename\s*=\s*([^;]+)/i);
      const raw = utf8Match?.[1] || plainMatch?.[1];
      if (!raw) return null;
      try {
        return decodeURIComponent(raw.trim().replace(/^["']|["']$/g, ''));
      } catch {
        return raw.trim().replace(/^["']|["']$/g, '');
      }
    };
    try {
      const headers: Record<string, string> = {};
      const token = localStorage.getItem('lupo_api_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(
        `${getBaseUrl()}/customers/${encodeURIComponent(customerId)}/export-detalle${q.toString() ? `?${q.toString()}` : ''}`,
        { method: 'GET', headers }
      );
      if (!response.ok) throw new Error('Error exportando detalle');
      blob = await response.blob();
      filename = parseFilename(response.headers.get('content-disposition'));
    } catch {
      // Fallback para entornos con ruta alternativa (cache/restart parcial del backend).
      blob = await getBlob(
        `/customers/export-detalle/${encodeURIComponent(customerId)}${q.toString() ? `?${q.toString()}` : ''}`,
        120000
      );
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `cliente_detalle_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  getCustomerFinancialSummary: async (customerId: string): Promise<{
    customerId: string;
    customerName: string;
    sellerName: string | null;
    totalFacturas: number;
    totalNc: number;
    totalRecibos: number;
    saldoPendiente: number;
    movements: Array<{
      fecha: string | null;
      tipo: string;
      comprobante: string;
      orderId: string | null;
      debe: number;
      haber: number;
      detalle: string;
    }>;
  }> => {
    return await request(`/customers/${encodeURIComponent(customerId)}/financial-summary`, 'GET');
  },

  exportCustomerFinancialSummary: async (
    customerId: string,
    opts?: { includeTango?: boolean }
  ): Promise<void> => {
    const q = opts?.includeTango ? '?includeTango=1' : '';
    const blob = await getBlob(
      `/customers/${encodeURIComponent(customerId)}/financial-summary/export${q}`,
      120000
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saldo_facturas_recibos_${opts?.includeTango ? 'con_tango_' : ''}${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Perfil del cliente directo (solo cuando el usuario tiene rol CUSTOMER). */
  getMyCustomer: async (): Promise<Customer | null> => {
    try {
      const r = await request<any>('/auth/me/customer', 'GET');
      return mapCustomerFromApi(r);
    } catch {
      return null;
    }
  },

  createCustomer: async (customer: Customer): Promise<Customer> => {
    return handleRequest(async () => {
      const created = await request<any>('/customers', 'POST', {
        id: customer.id,
        sellerId: customer.sellerId,
        sellerCommissionPercentage: customer.sellerCommissionPercentage,
        name: customer.name,
        businessName: customer.businessName,
        email: customer.email,
        address: customer.address,
        city: customer.city,
        cuit: customer.cuit,
        phone: customer.phone,
        transportNumber: customer.transportNumber,
        remitoNumber: customer.remitoNumber,
        saleCondition: customer.saleCondition,
        condicionIva: customer.condicionIva,
        transporteIds: customer.transportes?.map(t => t.id) ?? [],
        priceListId: customer.priceListId,
        legacyCode: customer.legacyCode,
        accountZone: customer.accountZone,
        accountSellerLabel: customer.accountSellerLabel,
        deliveryAddresses: customer.deliveryAddresses
      });
      return mapCustomerFromApi(created);
    }, customer, 'createCustomer');
  },

  /** Importar clientes en lote (desde Excel). Se exige razón social y CUIT. No duplica por CUIT ni email. */
  importCustomers: async (customers: Array<{ name?: string; businessName?: string; email?: string; address?: string; city?: string; cuit?: string; phone?: string; condicionIva?: string }>, sellerId?: string): Promise<{ created: number; skipped?: number; errors: { row: number; email?: string; message: string }[] }> => {
    return request<any>('/customers/import', 'POST', { customers, sellerId: sellerId || undefined });
  },

  /** Actualizar solo el CUIT de clientes existentes (identificados por razón social o email). */
  bulkUpdateCuit: async (updates: Array<{ businessName?: string; email?: string; cuit: string }>): Promise<{ updated: number; notFound: number; errors: { row: number; message: string }[] }> => {
    return request<any>('/customers/bulk-update-cuit', 'POST', { updates });
  },

  /** Actualizar condición IVA, lista de precios y saldo inicial en lote. */
  bulkUpdateCustomerFields: async (
    updates: Array<{
      businessName?: string;
      email?: string;
      cuit?: string;
      legacyCode?: string;
      condicionIva?: string;
      priceList?: string;
      openingBalance?: number | string | null;
      openingBalanceDate?: string | null;
    }>
  ): Promise<{ updated: number; notFound: number; skipped: number; errors: { row: number; message: string }[] }> => {
    return request<any>('/customers/bulk-update-fields', 'POST', { updates });
  },

  updateCustomer: async (id: string, data: Partial<Customer> & { transporteIds?: string[] }): Promise<Customer> => {
    const updated = await request<any>(`/customers/${id}`, 'PATCH', data);
    return mapCustomerFromApi(updated);
  },

  getTransportes: async (): Promise<Transporte[]> => {
    const rows = await request<any[]>('/transportes', 'GET');
    return Array.isArray(rows) ? rows : [];
  },
  createTransporte: async (name: string, address?: string): Promise<Transporte> => {
    return request<Transporte>('/transportes', 'POST', { name: name.trim(), address: address?.trim() || undefined });
  },
  updateTransporte: async (id: string, name: string, address?: string): Promise<Transporte> => {
    return request<Transporte>(`/transportes/${id}`, 'PATCH', { name: name.trim(), address: address?.trim() || undefined });
  },
  deleteTransporte: async (id: string): Promise<void> => {
    await request<void>(`/transportes/${id}`, 'DELETE');
  },

  deleteCustomer: async (id: string): Promise<void> => {
    await request<void>(`/customers/${id}`, 'DELETE');
  },
  updateVariantStock: async (variantId: string, stock: number): Promise<void> => {
    return handleRequest(async () => {
      await request<void>(`/stock/variant/${variantId}`, 'PUT', { stock });
    }, undefined, 'updateVariantStock');
  },

  /** Importar stock desde Excel (filas con codigo, color, y columnas P, M, G, GG, XG, XXG, XXXG). */
  importStockFromExcel: async (rows: Array<Record<string, unknown>>): Promise<{ message: string; updated: number; notFound?: string[]; notFoundCount?: number; errors?: string[] }> => {
    return request<any>('/stock/import-excel', 'POST', { rows });
  },

  /**
   * Planilla CODIGO + COLOR + columnas de talles (como inventario / articulos normalizados):
   * actualiza stock del depósito y carga ítems en el despacho indicado.
   */
  importStockGridToDespacho: async (
    despachoId: string,
    rows: Array<Record<string, unknown>>,
    opts?: { updateDepotStock?: boolean }
  ): Promise<{
    message: string;
    updatedStock: number;
    despachoItemsInserted: number;
    despachoItemsUpdated: number;
    productsTagged: number;
    notFoundCount?: number;
    notFound?: string[];
    errors?: string[];
  }> => {
    return request<any>('/stock/import-grid-to-despacho', 'POST', {
      despachoId,
      rows,
      updateDepotStock: opts?.updateDepotStock,
    });
  },

  // --- INTEGRATIONS ---
  getLupoWebhookConfig: async (): Promise<{
    enabled: boolean;
    webhookUrl: string;
    hasApiKey: boolean;
    hasWebhookSecret: boolean;
    apiKeyMasked: string;
    webhookSecretMasked: string;
    timeoutMs: number;
    maxRetries: number;
    backoffBaseMs: number;
    source: 'db' | 'env';
  }> => {
    return handleRequest(async () => {
      return await request<any>('/integrations/luposhop/webhook-config', 'GET');
    }, {
      enabled: false,
      webhookUrl: '',
      hasApiKey: false,
      hasWebhookSecret: false,
      apiKeyMasked: '',
      webhookSecretMasked: '',
      timeoutMs: 10000,
      maxRetries: 4,
      backoffBaseMs: 1000,
      source: 'env'
    }, 'getLupoWebhookConfig');
  },

  saveLupoWebhookConfig: async (payload: {
    enabled: boolean;
    webhookUrl: string;
    apiKey: string;
    webhookSecret?: string;
    keepExistingApiKey: boolean;
    keepExistingSecret: boolean;
    timeoutMs: number;
    maxRetries: number;
    backoffBaseMs: number;
  }): Promise<{ ok: boolean; config: any }> => {
    return handleRequest(async () => {
      return await request<{ ok: boolean; config: any }>('/integrations/luposhop/webhook-config', 'POST', payload);
    }, { ok: false, config: null }, 'saveLupoWebhookConfig');
  },

  testLupoWebhook: async (payload?: { webhookId?: string; updates?: any[] }): Promise<any> => {
    return handleRequest(async () => {
      return await request<any>('/integrations/luposhop/webhook-test', 'POST', payload || {}, undefined, 30000);
    }, { ok: false }, 'testLupoWebhook');
  },

  /** Stock LupoHub de variantes vinculadas a ML → tienda online (webhook), en lotes. */
  syncLupoShopMlStockBulk: async (): Promise<{
    ok: boolean;
    message?: string;
    variantCount: number;
    batchesTotal: number;
    batchesOk: number;
    batchesFailed: number;
    errors: { batchIndex: number; status?: number; error?: string }[];
  }> => {
    return handleRequest(async () => {
      return await request<{
        ok: boolean;
        message?: string;
        variantCount: number;
        batchesTotal: number;
        batchesOk: number;
        batchesFailed: number;
        errors: { batchIndex: number; status?: number; error?: string }[];
      }>('/integrations/luposhop/sync-ml-stock-to-shop', 'POST', {}, undefined, 600000);
    }, { ok: false, variantCount: 0, batchesTotal: 0, batchesOk: 0, batchesFailed: 0, errors: [] }, 'syncLupoShopMlStockBulk');
  },

  getIntegrationStatus: async (): Promise<{
    mercadolibre: boolean;
    tiendanube: boolean;
    tiendanubeStoreId?: string | null;
    metaAds?: boolean;
    googleAds?: boolean;
  }> => {
    return handleRequest(async () => {
      return await request<{ mercadolibre: boolean; tiendanube: boolean; tiendanubeStoreId?: string | null }>('/integrations/status', 'GET');
    }, { mercadolibre: false, tiendanube: false }, 'getIntegrationStatus');
  },

  getAuthUrl: async (platform: 'mercadolibre' | 'tiendanube'): Promise<{ url: string }> => {
    return handleRequest(async () => {
      return await request<{ url: string }>(`/integrations/${platform}/auth`, 'GET');
    }, { url: '' }, 'getAuthUrl');
  },

  syncProductsFromTiendaNube: async (): Promise<{ message: string; imported: number; updated: number; logs: string[] }> => {
    return handleRequest(async () => {
      return await request<{ message: string; imported: number; updated: number; logs: string[] }>('/integrations/tiendanube/sync', 'POST');
    }, { message: 'Offline', imported: 0, updated: 0, logs: [] }, 'syncProductsFromTiendaNube');
  },

  /** Normaliza talles en Tienda Nube (lotes; evita timeout en catálogos grandes). */
  normalizeSizesInTiendaNube: async (
    onProgress?: (state: { batch: number; updatedVariants: number; logs: string[] }) => void
  ): Promise<{
    message: string;
    updatedVariants: number;
    skippedProducts: number;
    skippedDuplicates: number;
    mergedVariants: number;
    logs: string[];
  }> => {
    return handleRequest(async () => {
      return runTiendaNubeNormalizeBatches('/integrations/tiendanube/normalize-sizes', onProgress);
    }, { message: 'Offline', updatedVariants: 0, skippedProducts: 0, skippedDuplicates: 0, mergedVariants: 0, logs: [] }, 'normalizeSizesInTiendaNube');
  },

  /** Normaliza nombres de color en Tienda Nube (lotes). */
  syncSkusToTiendaNube: async (): Promise<{
    message: string;
    total: number;
    updated: number;
    errors: number;
    skipped: number;
    logs: string[];
  }> => {
    return handleRequest(async () => {
      return await request<{
        message: string;
        total: number;
        updated: number;
        errors: number;
        skipped: number;
        logs: string[];
      }>('/integrations/tiendanube/sync-skus', 'POST', undefined, undefined, 600000);
    }, { message: 'Offline', total: 0, updated: 0, errors: 0, skipped: 0, logs: [] }, 'syncSkusToTiendaNube');
  },

  normalizeColorsInTiendaNube: async (
    onProgress?: (state: { batch: number; updatedVariants: number; logs: string[] }) => void
  ): Promise<{
    message: string;
    updatedVariants: number;
    skippedProducts: number;
    skippedDuplicates: number;
    mergedVariants: number;
    logs: string[];
  }> => {
    return handleRequest(async () => {
      return runTiendaNubeNormalizeBatches('/integrations/tiendanube/normalize-colors', onProgress);
    }, { message: 'Offline', updatedVariants: 0, skippedProducts: 0, skippedDuplicates: 0, mergedVariants: 0, logs: [] }, 'normalizeColorsInTiendaNube');
  },
  
  syncProductsFromMercadoLibre: async (): Promise<{ message: string; linkedVariants: number; logs: string[] }> => {
    return handleRequest(async () => {
      // Timeout largo para sincronización (3 minutos)
      return await request<{ message: string; linkedVariants: number; logs: string[] }>('/integrations/mercadolibre/sync', 'POST', undefined, undefined, 180000);
    }, { message: 'Offline', linkedVariants: 0, logs: [] }, 'syncProductsFromMercadoLibre');
  },

  testMercadoLibreConnection: async (): Promise<{ success: boolean; message: string; details: any }> => {
    return handleRequest(async () => {
      return await request<{ success: boolean; message: string; details: any }>('/integrations/mercadolibre/test', 'GET');
    }, { success: false, message: 'Offline', details: null }, 'testMercadoLibreConnection');
  },

  disconnectIntegration: async (platform: 'mercadolibre' | 'tiendanube'): Promise<{ message: string; platform: string }> => {
    return handleRequest(async () => {
      return await request<{ message: string; platform: string }>(`/integrations/${platform}/disconnect`, 'DELETE');
    }, { message: 'Offline', platform }, 'disconnectIntegration');
  },

  // Sincronizar stock a plataformas externas (catálogo completo = job async + poll; evita timeout proxy ~60s)
  syncStockToTiendaNube: async (opts?: { downloadFailures?: boolean }): Promise<{ message: string; updated: number; errors: number; logs: string[]; failuresCount?: number }> => {
    return handleRequest(async () => {
      const start = await request<{
        async?: boolean;
        status?: string;
        message: string;
        updated: number;
        errors: number;
        logs: string[];
        total?: number;
        failuresCount?: number;
      }>('/integrations/tiendanube/sync-stock', 'POST', undefined, undefined, 60000);
      if (start?.async && start.status === 'running') {
        const result = await pollStockSyncJob('tn');
        if (opts?.downloadFailures !== false && (result.failuresCount ?? result.errors) > 0) {
          try { await downloadStockSyncFailuresBlob('tn'); } catch (e) { console.warn('No se pudo descargar Excel de fallos TN', e); }
        }
        return result;
      }
      return start;
    }, { message: 'Offline', updated: 0, errors: 0, logs: [] }, 'syncStockToTiendaNube');
  },

  /** Hub → ML: catálogo completo en background + poll. */
  syncStockToMercadoLibre: async (opts?: { downloadFailures?: boolean }): Promise<{ message: string; updated: number; errors: number; logs: string[]; total?: number; failuresCount?: number }> => {
    const start = await request<{
      async?: boolean;
      status?: string;
      message: string;
      updated: number;
      errors: number;
      logs: string[];
      total?: number;
      failuresCount?: number;
    }>('/integrations/mercadolibre/sync-stock', 'POST', undefined, undefined, 60000);
    if (start?.async && start.status === 'running') {
      const result = await pollStockSyncJob('ml');
      if (opts?.downloadFailures !== false && (result.failuresCount ?? result.errors) > 0) {
        try { await downloadStockSyncFailuresBlob('ml'); } catch (e) { console.warn('No se pudo descargar Excel de fallos ML', e); }
      }
      return result;
    }
    return start;
  },

  /** Excel del último sync: artículos que no se actualizaron. platform: ml | tn | both */
  downloadStockSyncFailuresReport: async (platform: 'ml' | 'tn' | 'both' = 'both'): Promise<void> => {
    await downloadStockSyncFailuresBlob(platform);
  },

  /** Excel: reporte completo de Mercado Libre por período (requiere sesión). */
  exportMercadolibrePublications: async (params?: { from?: string; to?: string }): Promise<void> => {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const blob = await getBlob(`/integrations/mercadolibre/publications-export${query.toString() ? '?' + query.toString() : ''}`, 180000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fromTag = params?.from ? params.from.replace(/-/g, '') : 'auto';
    const toTag = params?.to ? params.to.replace(/-/g, '') : 'auto';
    a.download = `reporte_ml_completo_${fromTag}_${toTag}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** ZIP con imágenes de todos los productos de una categoría TN (ej. ropa deportiva). */
  downloadTiendaNubeCategoryImages: async (params?: {
    category?: string;
    categoryId?: number;
  }): Promise<void> => {
    const query = new URLSearchParams();
    query.set('category', (params?.category || 'ropa deportiva').trim());
    if (params?.categoryId != null) query.set('categoryId', String(params.categoryId));
    const blob = await getBlob(
      `/integrations/tiendanube/category-images/download?${query.toString()}`,
      600000
    );
    const slug = (params?.category || 'ropa-deportiva')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tiendanube-${slug || 'categoria'}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Vista previa de categorías TN que coinciden con el texto. */
  previewTiendaNubeCategoryMatches: async (category?: string): Promise<{
    query: string;
    categoryIds: number[];
    categoryNames: string[];
    matches: Array<{ id: number; name?: string; parent?: number | null }>;
  }> => {
    const q = new URLSearchParams();
    q.set('category', (category || 'ropa deportiva').trim());
    return handleRequest(
      async () =>
        request<{
          query: string;
          categoryIds: number[];
          categoryNames: string[];
          matches: Array<{ id: number; name?: string; parent?: number | null }>;
        }>(`/integrations/tiendanube/category-images/preview?${q.toString()}`, 'GET'),
      { query: category || '', categoryIds: [], categoryNames: [], matches: [] },
      'previewTiendaNubeCategoryMatches'
    );
  },

  /** Reporte de ventas Mercado Libre por período (Excel), agrupado por artículo. */
  exportMercadoLibreSalesReport: async (params: { from: string; to: string; articles?: string[] }): Promise<void> => {
    const query = new URLSearchParams();
    query.set('from', params.from);
    query.set('to', params.to);
    if (params.articles && params.articles.length > 0) {
      query.set('articles', params.articles.join(','));
    }
    const blob = await getBlob(`/integrations/mercadolibre/sales-report-export?${query.toString()}`, 180000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ventas_mercadolibre_${params.from}_a_${params.to}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Reporte de ventas Tienda Nube por período (Excel), opcionalmente filtrado por productos. */
  exportTiendaNubeSalesReport: async (params: { from: string; to: string; products?: string[] }): Promise<void> => {
    const query = new URLSearchParams();
    query.set('from', params.from);
    query.set('to', params.to);
    if (params.products && params.products.length > 0) {
      query.set('products', params.products.join(','));
    }
    const blob = await getBlob(`/integrations/tiendanube/sales-report-export?${query.toString()}`, 180000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ventas_tiendanube_${params.from}_a_${params.to}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Enviar stock solo de variantes seleccionadas a Tienda Nube */
  syncSelectedStockToTiendaNube: async (variantIds: string[]): Promise<{ message: string; updated: number; errors: number; total: number; logs: string[] }> => {
    return handleRequest(async () => {
      return await request<{ message: string; updated: number; errors: number; total: number; logs: string[] }>('/integrations/tiendanube/sync-stock-selected', 'POST', { variantIds }, undefined, 120000);
    }, { message: 'Offline', updated: 0, errors: 0, total: 0, logs: [] }, 'syncSelectedStockToTiendaNube');
  },

  /** Enviar stock solo de variantes seleccionadas a Mercado Libre */
  syncSelectedStockToMercadoLibre: async (variantIds: string[]): Promise<{ message: string; updated: number; errors: number; total: number; logs: string[] }> => {
    return handleRequest(async () => {
      return await request<{ message: string; updated: number; errors: number; total: number; logs: string[] }>('/integrations/mercadolibre/sync-stock-selected', 'POST', { variantIds }, undefined, 120000);
    }, { message: 'Offline', updated: 0, errors: 0, total: 0, logs: [] }, 'syncSelectedStockToMercadoLibre');
  },

  /** Stock en ML y TN por variante (para mostrar en inventario). */
  getVariantExternalStocks: async (variantIds: string[]): Promise<{ stocks: Record<string, { stockML?: number; stockTN?: number; stockLupoShop?: number }> }> => {
    return handleRequest(async () => {
      return await request<{ stocks: Record<string, { stockML?: number; stockTN?: number; stockLupoShop?: number }> }>('/integrations/variant-external-stocks', 'POST', { variantIds }, undefined, 30000);
    }, { stocks: {} }, 'getVariantExternalStocks');
  },

  /** Precios local / ML / TN por variante (consulta APIs externas). */
  getVariantChannelPrices: async (
    variantIds: string[]
  ): Promise<{
    prices: Record<
      string,
      { priceLocal?: number; priceML?: number; priceTN?: number; hasML?: boolean; hasTN?: boolean }
    >;
  }> => {
    return handleRequest(async () => {
      return await request<{
        prices: Record<
          string,
          { priceLocal?: number; priceML?: number; priceTN?: number; hasML?: boolean; hasTN?: boolean }
        >;
      }>('/integrations/variant-channel-prices', 'POST', { variantIds }, undefined, 60000);
    }, { prices: {} }, 'getVariantChannelPrices');
  },

  getChannelMargins: async (params?: {
    search?: string;
    page?: number;
    limit?: number;
    channel?: 'all' | 'ml' | 'tn';
    tnFeePreset?: string;
  }): Promise<{
    config: {
      fobListId: string | null;
      fobListName: string | null;
      ivaPercent: number;
      tnFeePresetId: string;
      tnFeePresetLabel: string;
      tnFeePresets: Array<{ id: string; label: string; ratePercent: number; cptPercent: number; appliesIva: boolean }>;
      mlListingFeeSource: string;
      mlPaymentCptPercent: number;
      mlPaymentCptSource: string;
    };
    total: number;
    page: number;
    limit: number;
    rows: Array<{
      productId: string;
      productName: string;
      baseSku: string;
      variantCount: number;
      variantIds: string[];
      fob: number | null;
      ml: {
        price: number;
        fee: number;
        feeListing?: number;
        feePayment?: number;
        margin: number | null;
        marginPercent: number | null;
        linked: boolean;
      } | null;
      tn: {
        price: number;
        fee: number;
        feeRate?: number;
        feeCpt?: number;
        margin: number | null;
        marginPercent: number | null;
        linked: boolean;
      } | null;
    }>;
  }> => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.channel) q.set('channel', params.channel);
    if (params?.tnFeePreset) q.set('tnFeePreset', params.tnFeePreset);
    const qs = q.toString();
    return handleRequest(async () => {
      return await request(
        `/integrations/channel-margins${qs ? `?${qs}` : ''}`,
        'GET',
        undefined,
        undefined,
        120000
      );
    }, {
      config: {
        fobListId: null,
        fobListName: null,
        ivaPercent: 21,
        tnFeePresetId: 'tn_mp_instant',
        tnFeePresetLabel: '',
        tnFeePresets: [],
        mlListingFeeSource: '',
        mlPaymentCptPercent: 1,
        mlPaymentCptSource: '',
      },
      total: 0,
      page: 1,
      limit: 50,
      rows: [],
    }, 'getChannelMargins');
  },

  exportChannelMarginsExcel: async (params?: {
    search?: string;
    channel?: 'all' | 'ml' | 'tn';
    tnFeePreset?: string;
  }): Promise<void> => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.channel) q.set('channel', params.channel);
    if (params?.tnFeePreset) q.set('tnFeePreset', params.tnFeePreset);
    const qs = q.toString();
    const blob = await getBlob(
      `/integrations/channel-margins/export${qs ? `?${qs}` : ''}`,
      300000
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `margenes_precios_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  bulkUpdateChannelPrices: async (body: {
    updates: Array<{ variantId: string; priceLocal?: number; priceML?: number; priceTN?: number }>;
    applyLocal?: boolean;
    applyML?: boolean;
    applyTN?: boolean;
  }): Promise<{ message: string; updatedLocal: number; updatedML: number; updatedTN: number; errors: string[] }> => {
    return handleRequest(async () => {
      return await request<{
        message: string;
        updatedLocal: number;
        updatedML: number;
        updatedTN: number;
        errors: string[];
      }>('/integrations/variant-channel-prices/bulk', 'POST', body, undefined, 120000);
    }, { message: 'Offline', updatedLocal: 0, updatedML: 0, updatedTN: 0, errors: [] }, 'bulkUpdateChannelPrices');
  },

  /** Opcional: ML como fuente — importa stock desde ML a LupoHub y envía a TN. Para flujo normal usar syncAllStockToMercadoLibre (LupoHub → ML). */
  syncAllStockFromMercadoLibre: async (): Promise<{
    message: string;
    importedFromML: number;
    errorsFromML: number;
    sentToTN: number;
    errorsToTN: number;
    logs: string[];
  }> => {
    return handleRequest(async () => {
      return await request<{
        message: string;
        importedFromML: number;
        errorsFromML: number;
        sentToTN: number;
        errorsToTN: number;
        logs: string[];
      }>('/integrations/mercadolibre/sync-from-ml', 'POST', undefined, undefined, 180000);
    }, { message: 'Offline', importedFromML: 0, errorsFromML: 0, sentToTN: 0, errorsToTN: 0, logs: [] }, 'syncAllStockFromMercadoLibre');
  },

  /** Sincronización solo ML → TN (automática en backend cada ~30 min; este endpoint para ejecutar ahora). */
  syncMLtoTN: async (): Promise<{ message: string; updated: number; errors: number }> => {
    return handleRequest(async () => {
      return await request<{ message: string; updated: number; errors: number }>('/integrations/mercadolibre/sync-ml-to-tn', 'POST', undefined, undefined, 60000);
    }, { message: 'Offline', updated: 0, errors: 0 }, 'syncMLtoTN');
  },

  /** Diagnóstico ML→TN: artículos con vínculos incompletos o errores de sincronización. */
  getMlTnSyncIssues: async (): Promise<Array<{
    variant_id: string;
    variant_sku: string;
    product_sku: string;
    product_name: string;
    color_name: string;
    size_code: string;
    stock_lupohub: number;
    sync_mode: string;
    ml_id: string;
    ml_variant_id: string;
    ml_item_id: string;
    tn_product_id: string;
    tn_variant_id: string;
    issue_type: string;
    issue_message: string;
  }>> => {
    const res = await request<{ rows: any[]; count: number }>(
      '/integrations/mercadolibre/sync-issues',
      'GET',
      undefined,
      undefined,
      300000
    );
    return res?.rows ?? [];
  },

  importStockFromMercadoLibre: async (): Promise<{ message: string; updated: number; errors: number; sentToTN?: number; errorsToTN?: number; logs: string[] }> => {
    return handleRequest(async () => {
      return await request<{ message: string; updated: number; errors: number; sentToTN?: number; errorsToTN?: number; logs: string[] }>('/integrations/mercadolibre/import-stock', 'POST', undefined, undefined, 180000);
    }, { message: 'Offline', updated: 0, errors: 0, logs: [] }, 'importStockFromMercadoLibre');
  },

  /** Crear producto en inventario local desde una publicación de Mercado Libre (itemId) o varias publicaciones agrupadas (itemIds). */
  importProductFromMercadoLibre: async (payload: { itemId?: string; itemIds?: string[] }): Promise<{ productId: string; baseSku: string; name: string; variantsCreated: number }> => {
    return handleRequest(async () => {
      return await request<{ productId: string; baseSku: string; name: string; variantsCreated: number }>('/integrations/mercadolibre/import-product', 'POST', payload, undefined, 120000);
    }, { productId: '', baseSku: '', name: '', variantsCreated: 0 }, 'importProductFromMercadoLibre');
  },

  /** Crea publicación en Tienda Nube a partir de una o varias publicaciones ML (mismo producto agrupado). */
  exportMercadoLibreToTiendaNube: async (payload: {
    itemId?: string;
    itemIds?: string[];
    /** Si true (default) y solo hay itemId, agrupa publicaciones hermanas ML en un solo producto TN. */
    includeSiblings?: boolean;
    published?: boolean;
    linkLocal?: boolean;
  }): Promise<{
    message: string;
    tiendaNubeProductId?: number;
    tiendaNubeVariantCount?: number;
    variantsLinkedLocal?: number;
    mlItemsUsed?: string[];
    missing?: string[];
  }> => {
    return await request(
      '/integrations/mercadolibre/export-to-tiendanube',
      'POST',
      payload,
      undefined,
      180000
    );
  },

  /** Crear producto en inventario local desde un producto de Tienda Nube */
  importProductFromTiendaNube: async (productId: string | number): Promise<{ productId: string; baseSku: string; name: string; variantsCreated: number }> => {
    return handleRequest(async () => {
      return await request<{ productId: string; baseSku: string; name: string; variantsCreated: number }>('/integrations/tiendanube/import-product', 'POST', { productId: String(productId) }, undefined, 60000);
    }, { productId: '', baseSku: '', name: '', variantsCreated: 0 }, 'importProductFromTiendaNube');
  },

  /**
   * Crea un producto en Tienda Nube (cuerpo igual a POST /products de la API oficial: name, variants, etc.).
   */
  createTiendaNubeProduct: async (productPayload: Record<string, unknown>): Promise<{ id?: number; product?: unknown; message?: string }> => {
    return await request<{ id?: number; product?: unknown; message?: string }>(
      '/integrations/tiendanube/products',
      'POST',
      productPayload,
      undefined,
      120000
    );
  },

  /**
   * Duplica una publicación en Tienda Nube (nuevo producto con sufijos en nombre y SKU).
   */
  duplicateTiendaNubeProduct: async (
    productId: string | number,
    opts?: { titleSuffix?: string; skuSuffix?: string; published?: boolean }
  ): Promise<{ sourceProductId?: string; newProductId?: number; product?: unknown; message?: string }> => {
    return await request<{ sourceProductId?: string; newProductId?: number; product?: unknown; message?: string }>(
      `/integrations/tiendanube/products/${encodeURIComponent(String(productId))}/duplicate`,
      'POST',
      {
        titleSuffix: opts?.titleSuffix,
        skuSuffix: opts?.skuSuffix,
        published: opts?.published
      },
      undefined,
      120000
    );
  },

  // Órdenes de Tienda Nube
  getTiendaNubeOrders: async (params?: { page?: number; per_page?: number; status?: string; created_at_min?: string; created_at_max?: string; only_paid_pending_shipment?: boolean }): Promise<{ orders: any[]; total: number }> => {
    return handleRequest(async () => {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.per_page) queryParams.append('per_page', params.per_page.toString());
      if (params?.status) queryParams.append('status', params.status);
      if (params?.created_at_min) queryParams.append('created_at_min', params.created_at_min);
      if (params?.created_at_max) queryParams.append('created_at_max', params.created_at_max);
      if (params?.only_paid_pending_shipment) queryParams.append('only_paid_pending_shipment', '1');
      const queryString = queryParams.toString();
      return await request<{ orders: any[]; total: number }>(`/integrations/tiendanube/orders${queryString ? '?' + queryString : ''}`, 'GET');
    }, { orders: [], total: 0 }, 'getTiendaNubeOrders');
  },

  invoiceTiendaNubeOrdersBulk: async (payload: { orderIds: Array<string | number>; cbteTipo?: 1 | 6 }): Promise<{
    message: string;
    summary: { total: number; invoiced: number; alreadyInvoiced: number; skippedUnpaid: number; errors: number };
    results: Array<{ orderId: string; status: string; message?: string; cae?: string; cbteTipo?: number; cbteDesde?: number; cbteHasta?: number }>;
  }> => {
    return handleRequest(async () => {
      return await request('/integrations/tiendanube/invoice-bulk', 'POST', payload, undefined, 180000);
    }, {
      message: 'Offline',
      summary: { total: 0, invoiced: 0, alreadyInvoiced: 0, skippedUnpaid: 0, errors: 0 },
      results: []
    }, 'invoiceTiendaNubeOrdersBulk');
  },

  /** Asigna o devuelve el código de seguimiento express de una orden TN (idempotente). */
  assignTiendaNubeExpressTracking: async (
    orderId: string | number,
    orderNumber?: string | number
  ): Promise<{
    orderId: string;
    orderNumber?: string | null;
    trackingCode: string;
    trackingStatus?: string | null;
    trackingStatusUpdatedAt?: string | null;
    assigned: boolean;
    createdAt?: string;
  }> => {
    return await request(
      `/integrations/tiendanube/orders/${encodeURIComponent(String(orderId))}/express-tracking/assign`,
      'POST',
      { orderNumber: orderNumber != null ? String(orderNumber) : undefined }
    );
  },

  updateTiendaNubeExpressTrackingStatus: async (
    orderId: string | number,
    status: 'pending' | 'preparing' | 'shipped' | 'delivered' | 'cancelled'
  ): Promise<{
    orderId: string;
    orderNumber?: string | null;
    trackingCode: string;
    trackingStatus: string;
    trackingStatusLabel: string;
    trackingStatusUpdatedAt?: string | null;
  }> => {
    return await request(
      `/integrations/tiendanube/orders/${encodeURIComponent(String(orderId))}/express-tracking/status`,
      'PATCH',
      { status }
    );
  },

  getTiendaNubeExpressTrackingPageConfig: async (): Promise<{
    config: {
      enabled: boolean;
      pageId?: number | null;
      pageHandle?: string;
      pageUrl?: string | null;
      lastSyncedAt?: string | null;
      lastError?: string | null;
    };
  }> => {
    return handleRequest(
      async () =>
        request<{ config: Record<string, unknown> }>(
          '/integrations/tiendanube/express-tracking-page/config',
          'GET'
        ),
      { config: { enabled: false } },
      'getTiendaNubeExpressTrackingPageConfig'
    );
  },

  saveTiendaNubeExpressTrackingPageConfig: async (enabled: boolean): Promise<{
    ok: boolean;
    config: {
      enabled: boolean;
      pageId?: number | null;
      pageHandle?: string;
      pageUrl?: string | null;
      lastSyncedAt?: string | null;
      lastError?: string | null;
    };
  }> => {
    return request('/integrations/tiendanube/express-tracking-page/config', 'PUT', { enabled });
  },

  /** Consulta pública del estado de un envío express por código LHE########. */
  getPublicTracking: async (trackingCode: string): Promise<{
    trackingCode: string;
    orderNumber: string;
    source: string;
    status: string;
    statusLabel: string;
    statusSource?: 'manual' | 'tiendanube';
    shippingStatus: string | null;
    shippingStatusLabel: string | null;
    orderStatus: string | null;
    orderStatusLabel: string | null;
    shippingMethod: string;
    destinationCity: string | null;
    createdAt: string | null;
    paidAt: string | null;
    shippedAt: string | null;
    updatedAt: string | null;
    trackingAssignedAt: string | null;
    trackingStatusUpdatedAt?: string | null;
    events: Array<{ key: string; label: string; at: string | null; done: boolean }>;
  }> => {
    const code = encodeURIComponent(String(trackingCode || '').trim().toUpperCase());
    return await request(`/public/tracking/${code}`, 'GET');
  },

  // Órdenes de Mercado Libre
  getMercadoLibreOrders: async (params?: { offset?: number; limit?: number; status?: string; date_from?: string; date_to?: string; only_pending_shipment_and_cancelled?: boolean }): Promise<{ orders: any[]; total: number }> => {
    return handleRequest(async () => {
      const queryParams = new URLSearchParams();
      if (params?.offset !== undefined) queryParams.append('offset', params.offset.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.status) queryParams.append('status', params.status);
      if (params?.date_from) queryParams.append('date_from', params.date_from);
      if (params?.date_to) queryParams.append('date_to', params.date_to);
      if (params?.only_pending_shipment_and_cancelled) queryParams.append('only_pending_shipment_and_cancelled', '1');
      const queryString = queryParams.toString();
      return await request<{ orders: any[]; total: number }>(`/integrations/mercadolibre/orders${queryString ? '?' + queryString : ''}`, 'GET');
    }, { orders: [], total: 0 }, 'getMercadoLibreOrders');
  },

  /** Preguntas del vendedor en ML (texto de la pregunta y de la respuesta, vía API oficial). */
  getMercadoLibreQuestions: async (params?: {
    offset?: number;
    limit?: number;
    status?: '' | 'ANSWERED' | 'UNANSWERED' | 'BANNED' | 'CLOSED_UNANSWERED' | 'UNDER_REVIEW';
    /** YYYY-MM-DD: filtro desde (inclusive), horario Argentina */
    date_from?: string;
    /** YYYY-MM-DD: filtro hasta (inclusive), horario Argentina */
    date_to?: string;
  }): Promise<{
    questions: Array<{
      id: string | number;
      text: string;
      status: string;
      itemId: string | null;
      itemTitle: string | null;
      dateCreated: string | null;
      buyerNickname: string | null;
      answerText: string | null;
      answerDate: string | null;
      aiSuggestion?: {
        text: string;
        status: string;
        provider?: string | null;
        updatedAt?: string | null;
      } | null;
    }>;
    total: number;
    offset: number;
    limit: number;
  }> => {
    return handleRequest(async () => {
      const queryParams = new URLSearchParams();
      if (params?.offset !== undefined) queryParams.append('offset', String(params.offset));
      if (params?.limit !== undefined) queryParams.append('limit', String(params.limit));
      if (params?.status) queryParams.append('status', params.status);
      if (params?.date_from) queryParams.append('date_from', params.date_from);
      if (params?.date_to) queryParams.append('date_to', params.date_to);
      const queryString = queryParams.toString();
      return await request(`/integrations/mercadolibre/questions${queryString ? '?' + queryString : ''}`, 'GET');
    }, { questions: [], total: 0, offset: 0, limit: 20 }, 'getMercadoLibreQuestions');
  },

  invoiceMercadoLibreOrdersBulk: async (payload: { orderIds: Array<string | number>; cbteTipo?: 1 | 6 }): Promise<{
    message: string;
    summary: { total: number; invoiced: number; alreadyInvoiced: number; skippedUnpaid: number; errors: number };
    results: Array<{ orderId: string; status: string; message?: string; cae?: string; cbteTipo?: number; cbteDesde?: number; cbteHasta?: number }>;
  }> => {
    return handleRequest(async () => {
      return await request('/integrations/mercadolibre/invoice-bulk', 'POST', payload, undefined, 180000);
    }, {
      message: 'Offline',
      summary: { total: 0, invoiced: 0, alreadyInvoiced: 0, skippedUnpaid: 0, errors: 0 },
      results: []
    }, 'invoiceMercadoLibreOrdersBulk');
  },

  getExternalInvoicesHistory: async (params?: { source?: 'TIENDANUBE' | 'MERCADOLIBRE'; limit?: number; offset?: number }): Promise<{
    total: number;
    offset: number;
    limit: number;
    totals?: { all: number; tn: number; ml: number };
    invoices: Array<{
      id: string;
      source: string;
      externalOrderId: string;
      orderNumber?: string;
      customerName?: string;
      total: number;
      cae: string;
      caeFchVto?: string;
      puntoVta: number;
      cbteTipo: number;
      cbteDesde: number;
      cbteHasta: number;
      createdAt?: string;
      hasCreditNote?: boolean;
      creditNote?: { id: string; cae: string; cbteTipo: number; cbteDesde: number };
    }>
  }> => {
    return handleRequest(async () => {
      const queryParams = new URLSearchParams();
      if (params?.source) queryParams.append('source', params.source);
      if (params?.limit) queryParams.append('limit', String(params.limit));
      if (params?.offset != null) queryParams.append('offset', String(params.offset));
      const queryString = queryParams.toString();
      return await request(`/integrations/invoices/external${queryString ? '?' + queryString : ''}`, 'GET');
    }, { total: 0, offset: 0, limit: params?.limit || 50, totals: { all: 0, tn: 0, ml: 0 }, invoices: [] }, 'getExternalInvoicesHistory');
  },

  getExternalInvoicePrintData: async (externalInvoiceId: string): Promise<{
    invoice: {
      id: string;
      source: string;
      externalOrderId: string;
      orderNumber?: string;
      customerName?: string;
      customerCuit?: string;
      customerCondicionIva?: string;
      customerAddress?: string;
      customerCity?: string;
      total: number;
      cae: string;
      caeFchVto?: string;
      puntoVta: number;
      cbteTipo: number;
      cbteDesde: number;
      cbteHasta?: number;
      createdAt?: string;
    };
    products: Array<{ name: string; sku?: string; quantity: number; unitPrice: number }>;
  }> => {
    return await request(`/integrations/invoices/external/${encodeURIComponent(externalInvoiceId)}/print-data`, 'GET');
  },

  emitirNotaCreditoExternalInvoice: async (externalInvoiceId: string): Promise<{
    id: string;
    externalInvoiceId: string;
    source: string;
    externalOrderId: string;
    cae: string;
    cbteTipo: number;
    cbteDesde: number;
    cbteHasta: number;
  }> => {
    return handleRequest(async () => {
      return await request(`/integrations/invoices/external/${encodeURIComponent(externalInvoiceId)}/credit-note`, 'POST');
    }, { id: '', externalInvoiceId, source: '', externalOrderId: '', cae: '', cbteTipo: 0, cbteDesde: 0, cbteHasta: 0 }, 'emitirNotaCreditoExternalInvoice');
  },

  // Stock de Tienda Nube (publicaciones con stock)
  getTiendaNubeStock: async (params?: { offset?: number; limit?: number }): Promise<{ items: any[]; total: number }> => {
    return handleRequest(async () => {
      const queryParams = new URLSearchParams();
      if (params?.offset !== undefined) queryParams.append('offset', params.offset.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      const queryString = queryParams.toString();
      return await request<{ items: any[]; total: number }>(`/integrations/tiendanube/stock${queryString ? '?' + queryString : ''}`, 'GET');
    }, { items: [], total: 0 }, 'getTiendaNubeStock');
  },

  getTiendaNubeStockTotals: async (): Promise<{ totalProducts: number; totalStock: number; lowStockCount: number; noStockCount: number }> => {
    return handleRequest(async () => {
      return await request<{ totalProducts: number; totalStock: number; lowStockCount: number; noStockCount: number }>('/integrations/tiendanube/stock/totals', 'GET');
    }, { totalProducts: 0, totalStock: 0, lowStockCount: 0, noStockCount: 0 }, 'getTiendaNubeStockTotals');
  },

  // Stock de Mercado Libre
  getMercadoLibreStock: async (params?: { offset?: number; limit?: number; status?: string }): Promise<{ items: any[]; total: number }> => {
    return handleRequest(async () => {
      const queryParams = new URLSearchParams();
      if (params?.offset !== undefined) queryParams.append('offset', params.offset.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.status) queryParams.append('status', params.status || 'active');
      const queryString = queryParams.toString();
      return await request<{ items: any[]; total: number }>(`/integrations/mercadolibre/stock${queryString ? '?' + queryString : ''}`, 'GET');
    }, { items: [], total: 0 }, 'getMercadoLibreStock');
  },

  getMercadoLibreStockTotals: async (): Promise<{ totalProducts: number; totalStock: number; lowStockCount: number; noStockCount: number }> => {
    return handleRequest(async () => {
      return await request<{ totalProducts: number; totalStock: number; lowStockCount: number; noStockCount: number }>('/integrations/mercadolibre/stock/totals', 'GET');
    }, { totalProducts: 0, totalStock: 0, lowStockCount: 0, noStockCount: 0 }, 'getMercadoLibreStockTotals');
  },

  getMercadoLibreItemVariations: async (itemId: string): Promise<{ variations: { variationId: number | string; itemId?: string; sku: string; color: string; size: string; stock: number }[]; singleProduct?: boolean; itemId: string; resolvedItemId?: string }> => {
    return request<{ variations: { variationId: number | string; itemId?: string; sku: string; color: string; size: string; stock: number }[]; singleProduct?: boolean; itemId: string; resolvedItemId?: string }>(
      `/integrations/mercadolibre/items/${encodeURIComponent(itemId)}/variations?_=${Date.now()}`,
      'GET',
      undefined,
      undefined,
      120000
    );
  },

  /** Mercado Ads — Product Ads: anunciantes, campañas y métricas por publicación (API oficial). */
  getMercadoLibreProductAdsAdvertisers: async (): Promise<{
    advertisers: Array<{ advertiser_id: number; site_id: string; advertiser_name: string; account_name: string }>;
  }> => {
    return await request('/integrations/mercadolibre/product-ads/advertisers', 'GET');
  },
  getMercadoLibreProductAdsCampaigns: async (params: {
    site_id: string;
    advertiser_id: string | number;
    date_from: string;
    date_to: string;
    limit?: number;
    offset?: number;
    metrics_summary?: boolean;
    aggregation_type?: string;
  }): Promise<{ paging?: { offset: number; total: number; limit: number }; results: any[]; metrics_summary?: Record<string, number> }> => {
    const q = new URLSearchParams();
    q.set('site_id', params.site_id);
    q.set('advertiser_id', String(params.advertiser_id));
    q.set('date_from', params.date_from);
    q.set('date_to', params.date_to);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    if (params.metrics_summary) q.set('metrics_summary', 'true');
    if (params.aggregation_type) q.set('aggregation_type', params.aggregation_type);
    return await request(`/integrations/mercadolibre/product-ads/campaigns?${q.toString()}`, 'GET');
  },
  getMercadoLibreProductAdsAds: async (params: {
    site_id: string;
    advertiser_id: string | number;
    date_from: string;
    date_to: string;
    limit?: number;
    offset?: number;
    metrics_summary?: boolean;
    channel?: string;
    /** Filtra anuncios/publicaciones de una campaña concreta (Product Ads API). */
    campaign_id?: string | number;
  }): Promise<{ paging?: { offset: number; total: number; limit: number }; results: any[]; metrics_summary?: Record<string, number> }> => {
    const q = new URLSearchParams();
    q.set('site_id', params.site_id);
    q.set('advertiser_id', String(params.advertiser_id));
    q.set('date_from', params.date_from);
    q.set('date_to', params.date_to);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    if (params.metrics_summary) q.set('metrics_summary', 'true');
    q.set('channel', params.channel ?? 'marketplace');
    if (params.campaign_id != null && params.campaign_id !== '') q.set('campaign_id', String(params.campaign_id));
    return await request(`/integrations/mercadolibre/product-ads/ads?${q.toString()}`, 'GET');
  },

  /** Mercado Ads — Brand Ads (BADS): anunciantes y campañas con métricas. */
  getMercadoLibreBrandAdsAdvertisers: async (): Promise<{
    advertisers: Array<{ advertiser_id: number; site_id: string; advertiser_name: string; account_name: string }>;
  }> => {
    return await request('/integrations/mercadolibre/brand-ads/advertisers', 'GET');
  },
  getMercadoLibreBrandAdsCampaigns: async (params: {
    advertiser_id: string | number;
    date_from: string;
    date_to: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    paging?: { offset: number; total: number; limit: number };
    results: any[];
    metrics_summary?: Record<string, number>;
  }> => {
    const q = new URLSearchParams();
    q.set('advertiser_id', String(params.advertiser_id));
    q.set('date_from', params.date_from);
    q.set('date_to', params.date_to);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    return await request(`/integrations/mercadolibre/brand-ads/campaigns?${q.toString()}`, 'GET');
  },

  /** Mercado Ads — Display: anunciantes y campañas con métricas. */
  getMercadoLibreDisplayAdsAdvertisers: async (): Promise<{
    advertisers: Array<{ advertiser_id: number; site_id: string; advertiser_name: string; account_name: string }>;
  }> => {
    return await request('/integrations/mercadolibre/display-ads/advertisers', 'GET');
  },
  getMercadoLibreDisplayAdsCampaigns: async (params: {
    advertiser_id: string | number;
    date_from: string;
    date_to: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    paging?: { offset: number; total: number; limit: number };
    results: any[];
    metrics_summary?: Record<string, number>;
    summary_partial?: boolean;
  }> => {
    const q = new URLSearchParams();
    q.set('advertiser_id', String(params.advertiser_id));
    q.set('date_from', params.date_from);
    q.set('date_to', params.date_to);
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    return await request(`/integrations/mercadolibre/display-ads/campaigns?${q.toString()}`, 'GET');
  },

  /** Meta Ads — configuración (admin) y campañas (admin + marketing). */
  getAdsIntegrationsStatus: async (): Promise<{
    meta: { configured: boolean; accountId: string; hasToken: boolean; source: 'db' | 'env' | null };
    google: {
      configured: boolean;
      customerId: string;
      loginCustomerId: string;
      hasRefreshToken: boolean;
      hasDeveloperToken: boolean;
      hasClientCredentials: boolean;
      source: 'db' | 'env' | null;
    };
  }> => {
    return await request('/integrations/ads/status', 'GET');
  },
  getMetaAdsConfig: async (): Promise<{
    configured: boolean;
    accountId: string;
    hasToken: boolean;
    source: 'db' | 'env' | null;
  }> => {
    return await request('/integrations/meta-ads/config', 'GET');
  },
  saveMetaAdsConfig: async (data: {
    accountId: string;
    accessToken?: string;
    keepExistingToken?: boolean;
  }): Promise<{ ok: boolean; config: any }> => {
    return await request('/integrations/meta-ads/config', 'PUT', data);
  },
  disconnectMetaAds: async (): Promise<{ ok: boolean }> => {
    return await request('/integrations/meta-ads/config', 'DELETE');
  },
  getMetaAdsCampaigns: async (params: {
    date_from: string;
    date_to: string;
  }): Promise<{
    accountId: string;
    campaigns: MetaAdsMetricsRow[];
    summary: Record<string, number>;
  }> => {
    const q = new URLSearchParams();
    q.set('date_from', params.date_from);
    q.set('date_to', params.date_to);
    return await request(`/integrations/meta-ads/campaigns?${q.toString()}`, 'GET');
  },
  getMetaAdSets: async (
    campaignId: string,
    params: { date_from: string; date_to: string }
  ): Promise<{ adsets: MetaAdsMetricsRow[]; summary: Record<string, number> }> => {
    const q = new URLSearchParams();
    q.set('date_from', params.date_from);
    q.set('date_to', params.date_to);
    return await request(
      `/integrations/meta-ads/campaigns/${encodeURIComponent(campaignId)}/adsets?${q.toString()}`,
      'GET'
    );
  },
  getMetaAdsForAdSet: async (
    adsetId: string,
    params: { date_from: string; date_to: string }
  ): Promise<{ ads: MetaAdsMetricsRow[]; summary: Record<string, number> }> => {
    const q = new URLSearchParams();
    q.set('date_from', params.date_from);
    q.set('date_to', params.date_to);
    return await request(
      `/integrations/meta-ads/adsets/${encodeURIComponent(adsetId)}/ads?${q.toString()}`,
      'GET'
    );
  },

  /** Google Ads — configuración (admin) y campañas (admin + marketing). */
  getGoogleAdsConfig: async (): Promise<{
    configured: boolean;
    customerId: string;
    loginCustomerId: string;
    hasRefreshToken: boolean;
    hasDeveloperToken: boolean;
    hasClientCredentials: boolean;
    source: 'db' | 'env' | null;
  }> => {
    return await request('/integrations/google-ads/config', 'GET');
  },
  saveGoogleAdsConfig: async (data: {
    customerId: string;
    loginCustomerId?: string;
    developerToken?: string;
    refreshToken?: string;
    keepExistingDeveloperToken?: boolean;
    keepExistingRefreshToken?: boolean;
  }): Promise<{ ok: boolean; config: any }> => {
    return await request('/integrations/google-ads/config', 'PUT', data);
  },
  disconnectGoogleAds: async (): Promise<{ ok: boolean }> => {
    return await request('/integrations/google-ads/config', 'DELETE');
  },
  getGoogleAdsCampaigns: async (params: {
    date_from: string;
    date_to: string;
  }): Promise<{
    campaigns: Array<{
      id: string;
      name: string;
      status: string;
      channelType: string;
      impressions: number;
      clicks: number;
      cost: number;
      ctr: number;
      cpc: number;
      conversions: number;
    }>;
    summary: Record<string, number>;
  }> => {
    const q = new URLSearchParams();
    q.set('date_from', params.date_from);
    q.set('date_to', params.date_to);
    return await request(`/integrations/google-ads/campaigns?${q.toString()}`, 'GET');
  },

  getMarketingLeads: async (params?: {
    date_from?: string;
    date_to?: string;
    source?: string;
    stage?: string;
    campaign_id?: string;
  }): Promise<{ leads: MarketingLead[] }> => {
    const q = new URLSearchParams();
    if (params?.date_from) q.set('date_from', params.date_from);
    if (params?.date_to) q.set('date_to', params.date_to);
    if (params?.source) q.set('source', params.source);
    if (params?.stage) q.set('stage', params.stage);
    if (params?.campaign_id) q.set('campaign_id', params.campaign_id);
    const qs = q.toString();
    return await request(`/marketing/leads${qs ? `?${qs}` : ''}`, 'GET');
  },

  getMarketingLeadMetrics: async (params: {
    date_from: string;
    date_to: string;
  }): Promise<MarketingLeadMetrics> => {
    const q = new URLSearchParams();
    q.set('date_from', params.date_from);
    q.set('date_to', params.date_to);
    return await request(`/marketing/leads/metrics?${q.toString()}`, 'GET');
  },

  createMarketingLead: async (data: {
    name: string;
    phone?: string;
    email?: string;
    source: string;
    campaignId?: string;
    campaignName?: string;
    notes?: string;
  }): Promise<{ lead: MarketingLead }> => {
    return await request('/marketing/leads', 'POST', data);
  },

  updateMarketingLead: async (
    id: string,
    data: {
      name?: string;
      phone?: string | null;
      email?: string | null;
      source?: string;
      stage?: string;
      campaignId?: string | null;
      campaignName?: string | null;
      revenue?: number | null;
      notes?: string | null;
    }
  ): Promise<{ lead: MarketingLead }> => {
    return await request(`/marketing/leads/${encodeURIComponent(id)}`, 'PATCH', data);
  },

  deleteMarketingLead: async (id: string): Promise<{ ok: boolean }> => {
    return await request(`/marketing/leads/${encodeURIComponent(id)}`, 'DELETE');
  },

  getMarketingLeadsWebhookConfig: async (): Promise<{
    enabled: boolean;
    webhookSecret?: string;
    hasWebhookSecret: boolean;
    webhookSecretMasked: string;
    metaVerifyToken: string;
    hasMetaAppSecret: boolean;
    metaAppSecretMasked: string;
    metaLeadsEnabled: boolean;
    whatsappEnabled: boolean;
    inboundUrl: string;
    metaWebhookUrl: string;
    whatsappWebhookUrl: string;
  }> => {
    return await request('/marketing/leads/webhook/config', 'GET');
  },

  saveMarketingLeadsWebhookConfig: async (data: {
    enabled?: boolean;
    webhookSecret?: string;
    regenerateWebhookSecret?: boolean;
    metaVerifyToken?: string;
    metaAppSecret?: string;
    keepExistingMetaAppSecret?: boolean;
    clearMetaAppSecret?: boolean;
    metaLeadsEnabled?: boolean;
    whatsappEnabled?: boolean;
  }): Promise<{ ok: boolean; config: any }> => {
    return await request('/marketing/leads/webhook/config', 'PUT', data);
  },

  getTiendaNubeProductVariants: async (productId: string): Promise<{ variants: { variantId: number | string; sku: string; color: string; size: string; stock: number }[]; productId: number | string }> => {
    return request<{ variants: { variantId: number | string; sku: string; color: string; size: string; stock: number }[]; productId: number | string }>(
      `/integrations/tiendanube/products/${encodeURIComponent(productId)}/variants?_=${Date.now()}`,
      'GET'
    );
  },

  // Configuración de mensaje automático de ML
  getMLAutoMessageConfig: async (): Promise<{ enabled: boolean; messageTemplate: string }> => {
    return handleRequest(async () => {
      return await request<{ enabled: boolean; messageTemplate: string }>('/integrations/mercadolibre/auto-message', 'GET');
    }, { enabled: true, messageTemplate: '' }, 'getMLAutoMessageConfig');
  },

  saveMLAutoMessageConfig: async (config: { enabled: boolean; messageTemplate: string }): Promise<{ success: boolean }> => {
    return handleRequest(async () => {
      return await request<{ success: boolean }>('/integrations/mercadolibre/auto-message', 'POST', config);
    }, { success: false }, 'saveMLAutoMessageConfig');
  },

  /** Respuestas automáticas a preguntas de ML (Gemini / Groq / OpenAI según .env). */
  getMLQuestionsAiConfig: async (): Promise<{
    enabled: boolean;
    mode: 'off' | 'suggest' | 'auto';
    extraSystemPrompt: string;
    openAiConfigured: boolean;
    llmProvider: 'gemini' | 'groq' | 'openai' | 'ollama' | null;
    llmLabel: string;
  }> => {
    return await request('/integrations/mercadolibre/questions-ai', 'GET');
  },
  saveMLQuestionsAiConfig: async (config: {
    enabled?: boolean;
    mode?: 'off' | 'suggest' | 'auto';
    extraSystemPrompt: string;
  }): Promise<{ success: boolean; message?: string }> => {
    return await request('/integrations/mercadolibre/questions-ai', 'POST', config);
  },
  processMLQuestionsAi: async (limit?: number): Promise<{
    processed: number;
    mode?: string;
    results: Array<{ questionId: string; status: string; reason?: string; preview?: string; message?: string }>;
  }> => {
    return await request('/integrations/mercadolibre/questions-ai/process', 'POST', { limit: limit ?? 10 });
  },
  suggestMLQuestionAi: async (questionId: string, forceRegenerate?: boolean): Promise<{
    result: { questionId: string; status: string; preview?: string; reason?: string; message?: string };
    suggestion: { questionId: string; suggestionText: string; status: string; llmProvider?: string | null } | null;
  }> => {
    return await request('/integrations/mercadolibre/questions-ai/suggest', 'POST', { questionId, forceRegenerate: !!forceRegenerate });
  },
  answerMLQuestion: async (questionId: string, text?: string): Promise<{ success: boolean; result?: { preview?: string } }> => {
    return await request('/integrations/mercadolibre/questions-ai/answer', 'POST', { questionId, text });
  },
  rejectMLQuestionSuggestion: async (questionId: string): Promise<{ success: boolean }> => {
    return await request('/integrations/mercadolibre/questions-ai/reject', 'POST', { questionId });
  },
  getMLQuestionsAiMetrics: async (): Promise<{
    totalGenerated: number;
    pending: number;
    sentUnchanged: number;
    sentEdited: number;
    rejected: number;
    autoSent: number;
    reviewSentTotal: number;
    unchangedRate: number | null;
    minReviewSendsForReady: number;
    readyRateThreshold: number;
    readyForAuto: boolean;
    recommendation: string;
  }> => {
    return await request('/integrations/mercadolibre/questions-ai/metrics', 'GET');
  },

  // Historial de movimientos de stock
  getStockMovements: async (params?: { 
    variantId?: string; 
    variantIds?: string[];
    productId?: string;
    type?: string; 
    from?: string; 
    to?: string; 
    limit?: number;
    offset?: number;
  }): Promise<any[]> => {
    return handleRequest(async () => {
      const queryParams = new URLSearchParams();
      if (params?.variantId) queryParams.append('variantId', params.variantId);
      if (params?.variantIds?.length) queryParams.append('variantIds', params.variantIds.join(','));
      if (params?.productId) queryParams.append('productId', params.productId);
      if (params?.type) queryParams.append('type', params.type);
      if (params?.from) queryParams.append('from', params.from);
      if (params?.to) queryParams.append('to', params.to);
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.offset) queryParams.append('offset', params.offset.toString());
      const queryString = queryParams.toString();
      return await request<any[]>(`/stock/movements${queryString ? '?' + queryString : ''}`, 'GET');
    }, [], 'getStockMovements');
  },

  // Crear snapshot inicial del stock
  createStockSnapshot: async (): Promise<{ message: string; variantsProcessed?: number }> => {
    return handleRequest(async () => {
      return await request<{ message: string; variantsProcessed?: number }>('/stock/snapshot', 'POST');
    }, { message: 'Error' }, 'createStockSnapshot');
  },

  // Eliminar snapshot inicial para poder crear uno nuevo
  deleteStockSnapshot: async (): Promise<{ message: string; deleted: number }> => {
    return handleRequest(async () => {
      return await request<{ message: string; deleted: number }>('/stock/snapshot', 'DELETE');
    }, { message: 'Error', deleted: 0 }, 'deleteStockSnapshot');
  },

  // Importar historial de ventas
  importSalesHistory: async (days: number = 60): Promise<{ message: string; totalImported: number; logs: string[] }> => {
    return handleRequest(async () => {
      return await request<{ message: string; totalImported: number; logs: string[] }>('/stock/import-history', 'POST', { days });
    }, { message: 'Error', totalImported: 0, logs: [] }, 'importSalesHistory');
  },

  // Reprocesar ventas pagadas desde fecha (descuenta stock local de forma idempotente)
  syncTiendaNubeOrdersFromDate: async (fromDate: string): Promise<{ message: string; fromDate: string; totalOrders: number }> => {
    return handleRequest(async () => {
      return await request<{ message: string; fromDate: string; totalOrders: number }>(
        '/integrations/tiendanube/sync-orders-from-date',
        'POST',
        { fromDate },
        undefined,
        180000
      );
    }, { message: 'Error', fromDate, totalOrders: 0 }, 'syncTiendaNubeOrdersFromDate');
  },

  syncMercadoLibreOrdersFromDate: async (fromDate: string): Promise<{ message: string; fromDate: string; totalOrders: number }> => {
    return handleRequest(async () => {
      return await request<{ message: string; fromDate: string; totalOrders: number }>(
        '/integrations/mercadolibre/sync-orders-from-date',
        'POST',
        { fromDate },
        undefined,
        180000
      );
    }, { message: 'Error', fromDate, totalOrders: 0 }, 'syncMercadoLibreOrdersFromDate');
  },

  // ============ DESPACHOS DE IMPORTACIÓN ============

  getDespachos: async (params?: { estado?: string; desde?: string; hasta?: string; limit?: number; offset?: number }): Promise<{ despachos: any[]; total: number }> => {
    return handleRequest(async () => {
      const queryParams = new URLSearchParams();
      if (params?.estado) queryParams.append('estado', params.estado);
      if (params?.desde) queryParams.append('desde', params.desde);
      if (params?.hasta) queryParams.append('hasta', params.hasta);
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.offset) queryParams.append('offset', params.offset.toString());
      const queryString = queryParams.toString();
      return await request<{ despachos: any[]; total: number }>(`/despachos${queryString ? '?' + queryString : ''}`, 'GET');
    }, { despachos: [], total: 0 }, 'getDespachos');
  },

  getDespachoById: async (id: string): Promise<any> => {
    return handleRequest(async () => {
      return await request<any>(`/despachos/${id}`, 'GET');
    }, null, 'getDespachoById');
  },

  createDespacho: async (data: any): Promise<{ message: string; id: string }> => {
    return handleRequest(async () => {
      return await request<{ message: string; id: string }>('/despachos', 'POST', data);
    }, { message: 'Error', id: '' }, 'createDespacho');
  },

  updateDespacho: async (id: string, data: any): Promise<{ message: string }> => {
    return handleRequest(async () => {
      return await request<{ message: string }>(`/despachos/${id}`, 'PUT', data);
    }, { message: 'Error' }, 'updateDespacho');
  },

  deleteDespacho: async (id: string): Promise<{ message: string }> => {
    return handleRequest(async () => {
      return await request<{ message: string }>(`/despachos/${id}`, 'DELETE');
    }, { message: 'Error' }, 'deleteDespacho');
  },

  addDespachoItem: async (
    despachoId: string,
    item: any & { incrementStock?: boolean }
  ): Promise<{ message: string; id: string; stockIncremented?: boolean }> => {
    return handleRequest(async () => {
      return await request<{ message: string; id: string; stockIncremented?: boolean }>(
        `/despachos/${despachoId}/items`,
        'POST',
        item
      );
    }, { message: 'Error', id: '' }, 'addDespachoItem');
  },

  removeDespachoItem: async (despachoId: string, itemId: string): Promise<{ message: string }> => {
    return handleRequest(async () => {
      return await request<{ message: string }>(`/despachos/${despachoId}/items/${itemId}`, 'DELETE');
    }, { message: 'Error' }, 'removeDespachoItem');
  },

  getDespachoStats: async (): Promise<any> => {
    return handleRequest(async () => {
      return await request<any>('/despachos/stats', 'GET');
    }, {}, 'getDespachoStats');
  },

  getProductosSinDespacho: async (): Promise<any[]> => {
    return handleRequest(async () => {
      return await request<any[]>('/despachos/productos-sin-despacho', 'GET');
    }, [], 'getProductosSinDespacho');
  },

  asignarDespachoATodos: async (data: { numero_despacho: string; fecha_despacho?: string; pais_origen?: string; proveedor?: string; descripcion?: string; notas?: string }): Promise<{ message: string; id: string; numero_despacho: string; total_asignados: number }> => {
    return handleRequest(async () => {
      return await request<{ message: string; id: string; numero_despacho: string; total_asignados: number }>('/despachos/asignar-todos', 'POST', data);
    }, { message: 'Error', id: '', numero_despacho: '', total_asignados: 0 }, 'asignarDespachoATodos');
  },

  asignarDespachoAProducto: async (data: { numero_despacho: string; sku: string }): Promise<{ message: string; despachoId: string; numero_despacho: string; productId: string; sku: string }> => {
    return handleRequest(async () => {
      return await request<{ message: string; despachoId: string; numero_despacho: string; productId: string; sku: string }>('/despachos/asignar-a-producto', 'POST', data);
    }, { message: 'Error', despachoId: '', numero_despacho: '', productId: '', sku: '' }, 'asignarDespachoAProducto');
  },

  // ============ FACTURACIÓN (Facturas + Notas de crédito) ============

  getBilling: async (params?: { desde?: string; hasta?: string; customerId?: string; province?: string; tipo?: 'FACTURA' | 'NC' | 'ND' }): Promise<any[]> => {
    const queryParams = new URLSearchParams();
    if (params?.desde) queryParams.append('desde', params.desde);
    if (params?.hasta) queryParams.append('hasta', params.hasta);
    if (params?.customerId) queryParams.append('customerId', params.customerId);
    if (params?.province) queryParams.append('province', params.province);
    if (params?.tipo) queryParams.append('tipo', params.tipo);
    const qs = queryParams.toString();
    return handleRequest(async () => {
      return await request<any[]>(`/billing${qs ? '?' + qs : ''}`, 'GET');
    }, [], 'getBilling');
  },

  getManualComprobanteRefs: async (
    customerId: string
  ): Promise<
    Array<{
      invoiceId?: string;
      manualComprobanteId?: string;
      orderId?: string;
      label: string;
      fecha: string;
      importeNeto: number;
      importeConIva: number;
    }>
  > => {
    return await request(
      `/customers/${encodeURIComponent(customerId)}/manual-comprobante-refs`,
      'GET'
    );
  },

  createManualComprobante: async (payload: {
    customerId: string;
    tipo: 'FACTURA' | 'NC';
    fecha: string;
    puntoVenta?: number;
    cbteTipo?: number;
    cbteDesde?: number;
    cbteHasta?: number;
    letra?: 'A' | 'B';
    sinDetalle?: boolean;
    cae?: string;
    caeFchVto?: string;
    importeBruto: number;
    importeNeto?: number;
    agipRetPer?: number;
    notes?: string;
    refInvoiceId?: string;
    refManualComprobanteId?: string;
    pdf?: File | null;
  }): Promise<{
    id: string;
    comprobante: string;
    importeTotal: number;
    importeConIva?: number;
    sinDetalle?: boolean;
    hasPdf?: boolean;
    allocationNote?: string;
  }> => {
    const { pdf, importeNeto, ...fields } = payload;
    const body = {
      ...fields,
      importeBruto: fields.importeBruto ?? importeNeto
    };
    if (pdf) {
      const form = new FormData();
      Object.entries(body).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        form.append(k, typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));
      });
      form.append('pdf', pdf);
      return await requestFormData('/billing/manual-comprobantes/upload', form, 120000);
    }
    return await request('/billing/manual-comprobantes', 'POST', body);
  },

  getManualComprobante: async (id: string): Promise<{
    id: string;
    customerId: string;
    tipo: 'FACTURA' | 'NC';
    fecha: string;
    puntoVenta: number;
    cbteTipo: number;
    cbteDesde: number;
    cbteHasta: number;
    letra: 'A' | 'B';
    importeBruto: number;
    agipRetPer: number;
    importeTotal: number;
    sinDetalle: boolean;
    hasPdf: boolean;
    cae?: string;
    notes?: string;
    refInvoiceId?: string;
    refManualComprobanteId?: string;
    comprobante: string;
  }> => {
    return await request(`/billing/manual-comprobantes/${encodeURIComponent(id)}`, 'GET');
  },

  updateManualComprobante: async (
    id: string,
    payload: {
      customerId: string;
      tipo: 'FACTURA' | 'NC';
      fecha: string;
      puntoVenta?: number;
      cbteTipo?: number;
      cbteDesde?: number;
      cbteHasta?: number;
      letra?: 'A' | 'B';
      sinDetalle?: boolean;
      cae?: string;
      importeBruto: number;
      agipRetPer?: number;
      notes?: string;
      refInvoiceId?: string;
      refManualComprobanteId?: string;
      pdf?: File | null;
    }
  ) => {
    const { pdf, ...fields } = payload;
    if (pdf) {
      const form = new FormData();
      Object.entries(fields).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        form.append(k, typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));
      });
      form.append('pdf', pdf);
      return await requestFormData(
        `/billing/manual-comprobantes/${encodeURIComponent(id)}/upload`,
        form,
        120000
      );
    }
    return await request(`/billing/manual-comprobantes/${encodeURIComponent(id)}`, 'PATCH', fields);
  },

  openManualComprobantePdf: async (id: string): Promise<void> => {
    const blob = await getBlob(`/billing/manual-comprobantes/${encodeURIComponent(id)}/pdf`);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  },

  deleteManualComprobante: async (id: string): Promise<{ ok: boolean; id: string; tipo: string }> => {
    return await request(`/billing/manual-comprobantes/${encodeURIComponent(id)}`, 'DELETE');
  },

  deleteImportedBillingEntry: async (payload: {
    customerId: string;
    importedLineOrder: number;
  }): Promise<{ ok: boolean; customerId: string; importedLineOrder: number }> => {
    return await request('/billing/imported-entries', 'DELETE', payload);
  },

  deleteLocalAfipComprobante: async (
    id: string,
    tipo: 'FACTURA' | 'NC'
  ): Promise<{ ok: boolean; id: string; tipo: string; orderId?: string }> => {
    return await request(
      `/billing/local-afip/${encodeURIComponent(id)}?tipo=${encodeURIComponent(tipo)}`,
      'DELETE'
    );
  },

  exportBilling: async (params?: { desde?: string; hasta?: string; customerId?: string; province?: string; tipo?: 'FACTURA' | 'NC' | 'ND' }): Promise<void> => {
    const queryParams = new URLSearchParams();
    if (params?.desde) queryParams.append('desde', params.desde);
    if (params?.hasta) queryParams.append('hasta', params.hasta);
    if (params?.customerId) queryParams.append('customerId', params.customerId);
    if (params?.province) queryParams.append('province', params.province);
    if (params?.tipo) queryParams.append('tipo', params.tipo);
    const qs = queryParams.toString();
    const blob = await getBlob(`/billing/export${qs ? '?' + qs : ''}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facturacion_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /**
   * Abre en pestaña nueva el listado HTML imprimible de facturación (con fechas en español).
   * El HTML dispara `window.print()` al cargar.
   */
  openBillingPrint: async (params?: {
    desde?: string;
    hasta?: string;
    customerId?: string;
    province?: string;
    tipo?: 'FACTURA' | 'NC' | 'ND';
  }): Promise<void> => {
    const queryParams = new URLSearchParams();
    if (params?.desde) queryParams.append('desde', params.desde);
    if (params?.hasta) queryParams.append('hasta', params.hasta);
    if (params?.customerId) queryParams.append('customerId', params.customerId);
    if (params?.province) queryParams.append('province', params.province);
    if (params?.tipo) queryParams.append('tipo', params.tipo);
    const qs = queryParams.toString();
    const blob = await getBlob(`/billing/print${qs ? '?' + qs : ''}`);
    const htmlBlob = blob.type.includes('html') ? blob : new Blob([blob], { type: 'text/html' });
    const url = URL.createObjectURL(htmlBlob);
    const win = window.open(url, '_blank');
    if (!win) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },

  /** Exporta Excel "Ventas por Jurisdicción" (mayorista + TN/ML LupoHub + Facturador ML AFIP PV 22). */
  exportVentasJurisdiccion: async (params: { desde: string; hasta: string }): Promise<{ incompleteAfipSync?: boolean }> => {
    const qs = new URLSearchParams({ desde: params.desde, hasta: params.hasta }).toString();
    // Primera sync de PV ML puede demorar (consultas AFIP); timeout alto.
    const { blob, headers } = await getBlobResponse(`/billing/export-ventas-jurisdiccion?${qs}`, 180000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const yyyymm = (params.desde || '').slice(0, 7).replace('-', '');
    a.download = `VENTAS_JURISDICCION_${yyyymm || 'rango'}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    const incomplete =
      String(headers['x-afip-sync-incomplete'] || headers['X-Afip-Sync-Incomplete'] || '') === '1';
    return { incompleteAfipSync: incomplete };
  },

  exportRetPerTxt: async (params?: { desde?: string; hasta?: string; month?: string; customerId?: string; province?: string }): Promise<void> => {
    const queryParams = new URLSearchParams();
    if (params?.desde) queryParams.append('desde', params.desde);
    if (params?.hasta) queryParams.append('hasta', params.hasta);
    if (params?.month) queryParams.append('month', params.month);
    if (params?.customerId) queryParams.append('customerId', params.customerId);
    if (params?.province) queryParams.append('province', params.province);
    const qs = queryParams.toString();
    const blob = await getBlob(`/billing/export-retper${qs ? '?' + qs : ''}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const monthTag = (params?.month || params?.hasta || params?.desde || new Date().toISOString().slice(0, 10)).replace(/-/g, '').slice(0, 7).replace('-', '');
    a.download = `RetPer_${monthTag}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Exporta facturas + NC del mes para clientes en Excel y/o lista pegada de CUIT (`cuitsList`). */
  exportBillingByCustomersFile: async (params: {
    month: string;
    file?: File | null;
    cuitsList?: string;
  }): Promise<void> => {
    const form = new FormData();
    form.append('month', params.month);
    if (params.file) form.append('file', params.file);
    const list = String(params.cuitsList ?? '').trim();
    if (list) form.append('cuitsList', list);
    const blob = await postFormDataBlob('/billing/export-by-customers-file', form, 180000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comprobantes_${params.month.replace('-', '')}_clientes.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  importAgipPadron: async (payload: { file: File; period?: string }): Promise<{ message: string; period: string; imported: number }> => {
    const formData = new FormData();
    formData.append('file', payload.file);
    if (payload.period) formData.append('period', payload.period);
    return await requestFormData('/billing/agip-padron/import', formData, 180000);
  },
  importAgipPadronStart: async (period: string): Promise<{ message: string; period: string }> => {
    return await request('/billing/agip-padron/import/start', 'POST', { period }, undefined, 60000);
  },
  importAgipPadronChunk: async (
    payload: { period: string; rows: Array<{ cuit: string; alicuota: number }> }
  ): Promise<{ message: string; period: string; imported: number }> => {
    return await request('/billing/agip-padron/import/chunk', 'POST', payload, undefined, 120000);
  },

  // ============ PAGOS (recibos) ============

  getPayments: async (params?: { customerId?: string; invoiceId?: string; orderId?: string; desde?: string; hasta?: string; province?: string }): Promise<import('../types').Payment[]> => {
    const queryParams = new URLSearchParams();
    if (params?.customerId) queryParams.append('customerId', params.customerId);
    if (params?.invoiceId) queryParams.append('invoiceId', params.invoiceId);
    if (params?.orderId) queryParams.append('orderId', params.orderId);
    if (params?.desde) queryParams.append('desde', params.desde);
    if (params?.hasta) queryParams.append('hasta', params.hasta);
    if (params?.province) queryParams.append('province', params.province);
    const qs = queryParams.toString();
    return await request<any[]>(`/payments${qs ? '?' + qs : ''}`, 'GET') as any;
  },
  importPaymentsExcel: async (files: File[]): Promise<{ message: string; files: number; candidates: number; imported: number; duplicated: number; notFound: { customerName: string; count: number }[] }> => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    return requestFormData('/payments/import-excel', formData, 120000);
  },

  createPayment: async (payload: {
    customerId: string;
    sellerId?: string | null;
    orderId?: string | null;
    orderIds?: string[];
    invoiceId?: string | null;
    invoiceIds?: string[];
    receiptNumber: string;
    date: string;
    amount: number;
    notes?: string;
  }): Promise<
    import('../types').Payment & {
      allocationNote?: string;
      invoiceAllocations?: Array<{
        invoiceId: string;
        applied: number;
        outstandingBefore: number;
        outstandingAfter: number;
      }>;
      orderAllocations?: Array<{
        orderId: string;
        applied: number;
        outstandingBefore: number;
        outstandingAfter: number;
      }>;
    }
  > => {
    return await request<any>(`/payments`, 'POST', payload) as any;
  },

  getInvoicesOutstanding: async (
    invoiceIds: string[],
    excludePaymentId?: string
  ): Promise<Array<{ invoiceId: string; outstanding: number }>> => {
    if (!invoiceIds.length) return [];
    const q = encodeURIComponent(invoiceIds.join(','));
    const excl = excludePaymentId ? `&excludePaymentId=${encodeURIComponent(excludePaymentId)}` : '';
    return await request(`/payments/invoice-outstanding?invoiceIds=${q}${excl}`, 'GET');
  },

  getOrdersOutstanding: async (
    orderIds: string[],
    excludePaymentId?: string
  ): Promise<Array<{ orderId: string; outstanding: number }>> => {
    if (!orderIds.length) return [];
    const q = encodeURIComponent(orderIds.join(','));
    const excl = excludePaymentId ? `&excludePaymentId=${encodeURIComponent(excludePaymentId)}` : '';
    return await request(`/payments/order-outstanding?orderIds=${q}${excl}`, 'GET');
  },

  previewPaymentAllocation: async (
    amount: number,
    invoiceIds: string[],
    orderIds: string[] = [],
    excludePaymentId?: string
  ): Promise<{
    appliedTotal: number;
    remainingUnallocated: number;
    invoiceAllocations: Array<{
      invoiceId: string;
      applied: number;
      outstandingBefore: number;
      outstandingAfter: number;
    }>;
    orderAllocations: Array<{
      orderId: string;
      applied: number;
      outstandingBefore: number;
      outstandingAfter: number;
    }>;
  }> => {
    return await request('/payments/allocate-preview', 'POST', {
      amount,
      invoiceIds,
      orderIds,
      excludePaymentId
    });
  },

  /** Recibo importado Tango: imputaciones ya guardadas (si existe pago en sistema) y datos del movimiento. */
  getImportedReceiptLinkInfo: async (
    customerId: string,
    importedLineOrder: number
  ): Promise<{
    customerId: string;
    importedLineOrder: number;
    paymentId?: string;
    receiptNumber: string;
    date: string;
    amount: number;
    invoiceIds: string[];
    orderIds: string[];
  }> => {
    const qs = new URLSearchParams({
      customerId,
      importedLineOrder: String(importedLineOrder),
    });
    return await request(`/payments/imported/link-info?${qs.toString()}`, 'GET');
  },

  /** Asocia facturas y/o pedidos sin factura a un recibo ya cargado. */
  patchPaymentInvoices: async (
    paymentId: string,
    invoiceIds: string[],
    orderIds: string[] = [],
    importedMeta?: { customerId: string; importedLineOrder: number }
  ): Promise<{
    id: string;
    invoiceIds: string[];
    orderIds?: string[];
    allocationNote?: string;
    invoiceAllocations?: Array<{
      invoiceId: string;
      applied: number;
      outstandingBefore: number;
      outstandingAfter: number;
    }>;
    orderAllocations?: Array<{
      orderId: string;
      applied: number;
      outstandingBefore: number;
      outstandingAfter: number;
    }>;
  }> => {
    return await request(`/payments/${encodeURIComponent(paymentId)}/invoices`, 'PATCH', {
      invoiceIds,
      orderIds,
      ...(importedMeta
        ? {
            customerId: importedMeta.customerId,
            importedLineOrder: importedMeta.importedLineOrder,
          }
        : {}),
    });
  },
  updatePaymentDate: async (paymentId: string, date: string): Promise<import('../types').Payment> => {
    return await request<any>(`/payments/${encodeURIComponent(paymentId)}/date`, 'PATCH', { date }) as any;
  },
  updateImportedPaymentDate: async (payload: { customerId: string; importedLineOrder: number; date: string }): Promise<{ ok: boolean; customerId: string; importedLineOrder: number; date: string }> => {
    return await request<any>(`/payments/imported/date`, 'PATCH', payload) as any;
  },
  deletePayment: async (
    paymentId: string,
    meta?: { customerId: string; importedLineOrder: number }
  ): Promise<{ ok: boolean; id?: string; customerId?: string; importedLineOrder?: number }> => {
    return await request(`/payments/${encodeURIComponent(paymentId)}`, 'DELETE', meta || {});
  },

  // --- CATÁLOGOS (Admin sube; vendedores y clientes ven) ---
  getCatalogs: async (): Promise<Array<{ id: string; name: string; fileName: string; mimeType: string; createdAt: string; isUrl?: boolean; url?: string }>> => {
    const rows = await request<any[]>('/catalogs', 'GET');
    return Array.isArray(rows) ? rows : [];
  },
  uploadCatalog: async (file: File, name?: string): Promise<{ id: string; name: string; fileName: string; mimeType: string; createdAt: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (name && name.trim()) formData.append('name', name.trim());
    return requestFormData('/catalogs/upload', formData);
  },
  createCatalogUrl: async (name: string, url: string): Promise<{ id: string; name: string; fileName: string; mimeType: string; createdAt: string }> => {
    return request<any>('/catalogs', 'POST', { name: name.trim(), url: url.trim() });
  },
  deleteCatalog: async (id: string): Promise<void> => {
    await request<void>(`/catalogs/${id}`, 'DELETE');
  },
  getCatalogFileBlob: async (id: string): Promise<Blob> => {
    return getBlob(`/catalogs/${id}/file`);
  },

  // --- CATÁLOGO TIENDA NUBE (generado en vivo desde la tienda) ---
  getTiendaNubeCatalog: async (options?: { categoryIds?: number[]; priceListId?: string }): Promise<TiendaNubeCatalog> => {
    const params = new URLSearchParams();
    if (options?.categoryIds?.length) params.set('categoryIds', options.categoryIds.join(','));
    if (options?.priceListId) params.set('priceListId', options.priceListId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<TiendaNubeCatalog>(
      `/integrations/tiendanube/catalog${qs}`,
      'GET',
      undefined,
      undefined,
      300000
    );
  },
  getTiendaNubeCatalogConfig: async (): Promise<{ config: any | null; updatedAt: string | null }> => {
    return request<{ config: any | null; updatedAt: string | null }>(
      '/integrations/tiendanube/catalog/config',
      'GET'
    );
  },
  saveTiendaNubeCatalogConfig: async (config: any): Promise<{ ok: boolean }> => {
    return request<{ ok: boolean }>(
      '/integrations/tiendanube/catalog/config',
      'PUT',
      { config }
    );
  },
  /** Sube una imagen propia para el catálogo y devuelve su URL absoluta. */
  uploadCatalogImage: async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await requestFormData<{ file: string; path: string }>('/catalog-images', formData);
    const base = getBaseUrl().replace(/\/$/, '');
    return res.path.startsWith('http') ? res.path : `${base}${res.path}`;
  }
};

export interface TiendaNubeCatalogColorVariant {
  name: string;
  sourceImage: string | null;
  stock?: number;
}

export interface TiendaNubeCatalogProduct {
  id: number;
  name: string;
  description: string;
  images: string[];
  sizes: string[];
  colors: string[];
  colorVariants: TiendaNubeCatalogColorVariant[];
  price: number | null;
  promotionalPrice: number | null;
  permalink: string | null;
  totalStock: number;
  categoryIds: number[];
  articleCode: string;
  composition: string;
}

export interface TiendaNubeCatalogSection {
  id: number;
  name: string;
  parent: number | null;
  productCount: number;
  products: TiendaNubeCatalogProduct[];
}

export interface TiendaNubeCatalog {
  storeId: string;
  generatedAt: string;
  productCount: number;
  sections: TiendaNubeCatalogSection[];
  priceListId?: string;
  priceListName?: string;
}
