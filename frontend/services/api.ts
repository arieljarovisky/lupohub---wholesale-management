import { Product, Order, OrderStatus, User, Customer, Transporte, UserTask } from '../types';
import { MOCK_PRODUCTS, MOCK_ORDERS, MOCK_USERS } from '../constants';
import httpClient, { request, requestFormData, getBlob, getBaseUrl, postBlob } from './httpClient';

// Helper to handle offline/demo mode gracefully
const handleRequest = async <T>(requestFn: () => Promise<T>, fallback: T, errorMessage: string): Promise<T> => {
  try {
    return await requestFn();
  } catch (error) {
    console.warn(`API Connection Failed (${errorMessage}). Switching to offline/demo mode.`, error);
    return fallback;
  }
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
  createPriceList: async (data: { name: string; description?: string }): Promise<import('../types').PriceList> => {
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
  duplicatePriceList: async (id: string, newName: string): Promise<import('../types').PriceList> => {
    return request<any>(`/price-lists/${id}/duplicate`, 'POST', { name: newName });
  },
  fillPriceListFromBase: async (id: string, multiplier?: number): Promise<{ items: { productId: string; price: number }[]; count: number; skippedWithoutBase?: number }> => {
    return request<any>(`/price-lists/${id}/fill-from-base`, 'POST', multiplier != null ? { multiplier } : {});
  },
  setPriceListItemsBySku: async (id: string, items: { sku: string; price: number }[]): Promise<{ items: { productId: string; price: number }[]; imported: number; notFound?: string[] }> => {
    return request<any>(`/price-lists/${id}/items/by-sku`, 'PUT', { items });
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
      mayorista_pack_size: Math.max(1, Number((r as any).mayorista_pack_size) || 1)
    } as Product;
  },

  getProducts: async (options?: { priceListId?: string | null; perPage?: number }): Promise<Product[]> => {
    return handleRequest(async () => {
      const perPage = options?.perPage ?? 5000;
      const params = new URLSearchParams({ per_page: String(perPage) });
      if (options?.priceListId) params.set('price_list_id', options.priceListId);
      const res = await request<any>(`/products?${params.toString()}`, 'GET');
      const rows = Array.isArray(res) ? res : res.items;
      return rows.map((r: any) => api.mapProductRow(r));
    }, MOCK_PRODUCTS, 'getProducts');
  },

  /** Trae todos los productos sin límite: pide página por página hasta completar. */
  getProductsAll: async (options?: { priceListId?: string | null }): Promise<Product[]> => {
    const PER_PAGE = 1000;
    const params = new URLSearchParams({ per_page: String(PER_PAGE), page: '1' });
    if (options?.priceListId) params.set('price_list_id', options.priceListId);
    const res = await request<any>(`/products?${params.toString()}`, 'GET');
    const items = Array.isArray(res) ? res : (res?.items ?? []);
    const total = typeof res?.total === 'number' ? res.total : items.length;
    const all: Product[] = items.map((r: any) => api.mapProductRow(r));
    const totalPages = Math.ceil(total / PER_PAGE) || 1;
    for (let page = 2; page <= totalPages; page++) {
      const nextParams = new URLSearchParams({ per_page: String(PER_PAGE), page: String(page) });
      if (options?.priceListId) nextParams.set('price_list_id', options.priceListId);
      const nextRes = await request<any>(`/products?${nextParams.toString()}`, 'GET');
      const nextItems = Array.isArray(nextRes) ? nextRes : (nextRes?.items ?? []);
      all.push(...nextItems.map((r: any) => api.mapProductRow(r)));
    }
    return all;
  },

  /** Igual que getProducts pero sin fallback: lanza si falla. Usar al refrescar después de crear para no pisar con MOCK. */
  getProductsStrict: async (options?: { priceListId?: string | null; perPage?: number }): Promise<Product[]> => {
    const perPage = options?.perPage ?? 5000;
    const params = new URLSearchParams({ per_page: String(perPage) });
    if (options?.priceListId) params.set('price_list_id', options.priceListId);
    const res = await request<any>(`/products?${params.toString()}`, 'GET');
    const rows = Array.isArray(res) ? res : (res && res.items) || [];
    return rows.map((r: any) => api.mapProductRow(r));
  },

  getProductsPaged: async (page: number, perPage: number, q?: string, sort?: 'sku' | 'name' | 'stock', dir?: 'asc' | 'desc', syncFilter?: 'ALL' | 'ML' | 'TN' | 'BOTH' | 'NONE' | 'MISMATCH', options?: { skipTotal?: boolean }): Promise<{ items: Product[]; page: number; per_page: number; total: number }> => {
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
      const res = await request<any>(`/products?${params.toString()}`, 'GET');
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
          externalIds: r.externalIds
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
  }>> => {
    const res = await request<{ rows: any[] }>('/products/export-inventory', 'GET');
    return res?.rows ?? [];
  },

  getProductBySku: async (sku: string): Promise<{ id: string; sku: string; name: string; category?: string; base_price?: number; mercado_libre_pack_size?: number; tienda_nube_pack_size?: number; mayorista_pack_size?: number; externalIds?: any; variants?: any[] } | null> => {
    try {
      const res = await request<any>(`/products/${encodeURIComponent(sku)}`, 'GET');
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

  getVariantsBySku: async (sku: string): Promise<Array<{ variantId: string; colorCode: string; colorName: string; sizeCode: string; stock: number; externalIds?: any }>> => {
    return handleRequest(async () => {
      const res = await request<any>(`/products/${sku}`, 'GET');
      const parentExternalIds = res.externalIds || {};
      const variants = (res?.variants || []).map((v: any) => ({
        variantId: v.variant_id,
        colorCode: v.color_code,
        colorName: v.color_name,
        sizeCode: v.size_code,
        stock: Number(v.stock ?? 0),
        externalIds: {
          tiendaNube: parentExternalIds.tiendaNube,
          mercadoLibre: parentExternalIds.mercadoLibre,
          tiendaNubeVariant: v.tienda_nube_variant_id,
          mercadoLibreVariant: v.mercado_libre_variant_id
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

  updateVariant: async (variantId: string, data: { sku?: string; externalSku?: string }): Promise<{ id: string; sku: string | null; external_sku: string | null }> => {
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

  /** Importar artículos desde Excel de Tango (columna Código = 7+3+3, opcional Descripción). */
  importTangoArticles: async (
    rows: Record<string, unknown>[],
    onlyComplete = true
  ): Promise<{ productsCreated: number; variantsCreated: number; variantsUpdated: number; totalProcessed: number; errors: string[] }> => {
    const res = await request<any>('/products/import-tango', 'POST', { rows, onlyComplete });
    return {
      productsCreated: res.productsCreated ?? 0,
      variantsCreated: res.variantsCreated ?? 0,
      variantsUpdated: res.variantsUpdated ?? 0,
      totalProcessed: res.totalProcessed ?? 0,
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
    links: Array<{ variantId: string; mercadoLibreVariantId?: string | number; mercadoLibreItemId?: string; tiendaNubeVariantId?: string | number; externalSku?: string }>;
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

  archiveOrder: async (orderId: string, archived: boolean): Promise<{ id: string; archived: boolean }> => {
    return await request<{ id: string; archived: boolean }>(`/orders/${orderId}/archive`, 'PATCH', { archived });
  },

  createOrder: async (order: Order): Promise<Order> => {
    return handleRequest(async () => {
      return await request<Order>('/orders', 'POST', order);
    }, order, 'createOrder');
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

  patchOrderPaymentStatus: async (orderId: string, paymentStatus: 'pendiente' | 'pagado'): Promise<{ id: string; paymentStatus: string }> => {
    return await request<{ id: string; paymentStatus: string }>(`/orders/${orderId}/payment-status`, 'PATCH', { paymentStatus });
  },

  /** Desconta stock del pedido mayorista ahora (idempotente; si es borrador pasa a confirmado). */
  applyMayoristaStock: async (
    orderId: string
  ): Promise<{ id: string; success?: boolean; alreadyApplied?: boolean; message?: string; errors?: string[] }> => {
    return await request(`/orders/${orderId}/apply-mayorista-stock`, 'POST', {});
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

  /** Emite factura electrónica AFIP para un pedido. `noStockImpact` evita descontar stock en el flujo del pedido. */
  emitirFactura: async (orderId: string, body?: { cbteTipo?: 1 | 6; noStockImpact?: boolean }): Promise<{ id: string; orderId: string; cae: string; caeFchVto?: string; cbteDesde: number; cbteHasta: number; cbteTipo: number }> => {
    return await request<any>(`/orders/${orderId}/emitir-factura`, 'POST', body ?? {});
  },

  /** Obtiene los datos de la factura AFIP asociada a un pedido (si existe). */
  getOrderInvoice: async (orderId: string): Promise<{ id: string; orderId: string; cae: string; caeFchVto?: string; puntoVta?: number; cbteTipo: number; cbteDesde: number; cbteHasta: number; createdAt?: string } | null> => {
    try {
      return await request<any>(`/orders/${orderId}/invoice`, 'GET');
    } catch {
      return null;
    }
  },

  /** Lista las notas de crédito de un pedido. */
  getOrderCreditNotes: async (orderId: string): Promise<import('../types').CreditNote[]> => {
    const rows = await request<any[]>(`/orders/${orderId}/credit-notes`, 'GET');
    return (Array.isArray(rows) ? rows : []).map((r: any) => ({
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
      createdAt: r.createdAt
    }));
  },

  /** Emite una Nota de Crédito AFIP: todo el pedido (tipo: 'total') o un ítem (tipo: 'item', itemIndex, quantity opcional). */
  emitirNotaCredito: async (
    orderId: string,
    data: { tipo: 'total' | 'item' | 'items'; itemIndex?: number; quantity?: number; items?: Array<{ itemIndex: number; quantity: number }> }
  ): Promise<{ id: string; orderId: string; cae: string; caeFchVto?: string; puntoVta: number; cbteTipo: number; cbteDesde: number; cbteHasta: number; amountCredited: number }> => {
    return await request<any>(`/orders/${orderId}/emitir-nota-credito`, 'POST', data);
  },

  // --- CUSTOMERS ---
  getCustomers: async (): Promise<Customer[]> => {
    return handleRequest(async () => {
      const rows = await request<any[]>('/customers', 'GET');
      return (Array.isArray(rows) ? rows : []).map((r: any) => ({
        id: r.id,
        sellerId: r.sellerId ?? r.seller_id ?? '',
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
        priceListId: r.priceListId ?? r.price_list_id ?? undefined,
        legacyCode: r.legacyCode ?? r.legacy_code ?? undefined,
        accountZone: r.accountZone ?? r.account_zone ?? undefined,
        accountSellerLabel: r.accountSellerLabel ?? r.account_seller_label ?? undefined
      })) as Customer[];
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
   * Cartera unificada: max(0, pedidos pendientes IVA + saldo cuenta importada − recibos en Facturación).
   * Solo clientes con algún cargo, saldo importado o pago registrado.
   */
  getCarteraTotals: async (): Promise<
    Array<{
      customerId: string;
      orderCargosPendientes: number;
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
      tipo: 'FACTURA' | 'NC' | 'RECIBO';
      comprobante: string;
      orderId: string | null;
      debe: number;
      haber: number;
      detalle: string;
    }>;
  }> => {
    return await request(`/customers/${encodeURIComponent(customerId)}/financial-summary`, 'GET');
  },

  exportCustomerFinancialSummary: async (customerId: string): Promise<void> => {
    const blob = await getBlob(`/customers/${encodeURIComponent(customerId)}/financial-summary/export`, 120000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saldo_facturas_recibos_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Perfil del cliente directo (solo cuando el usuario tiene rol CUSTOMER). */
  getMyCustomer: async (): Promise<Customer | null> => {
    try {
      const r = await request<any>('/auth/me/customer', 'GET');
      return {
        id: r.id,
        sellerId: r.sellerId ?? undefined,
        name: r.name ?? '',
        businessName: r.businessName ?? '',
        email: r.email ?? '',
        address: r.address ?? '',
        city: r.city ?? '',
        cuit: r.cuit ?? undefined,
        phone: r.phone ?? undefined,
        transportNumber: r.transportNumber ?? r.transport_number ?? undefined,
        remitoNumber: r.remitoNumber ?? r.remito_number ?? undefined,
        saleCondition: r.saleCondition ?? r.sale_condition ?? undefined,
        condicionIva: r.condicionIva ?? r.condicion_iva ?? undefined,
        priceListId: r.priceListId ?? undefined,
        legacyCode: r.legacyCode ?? r.legacy_code ?? undefined,
        accountZone: r.accountZone ?? r.account_zone ?? undefined,
        accountSellerLabel: r.accountSellerLabel ?? r.account_seller_label ?? undefined
      } as Customer;
    } catch {
      return null;
    }
  },

  createCustomer: async (customer: Customer): Promise<Customer> => {
    return handleRequest(async () => {
      const created = await request<any>('/customers', 'POST', {
        id: customer.id,
        sellerId: customer.sellerId,
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
        accountSellerLabel: customer.accountSellerLabel
      });
      return {
        id: created.id,
        sellerId: created.sellerId ?? created.seller_id ?? '',
        name: created.name ?? '',
        businessName: created.businessName ?? created.business_name ?? '',
        email: created.email ?? '',
        address: created.address ?? '',
        city: created.city ?? '',
        cuit: created.cuit ?? undefined,
        phone: created.phone ?? undefined,
        transportNumber: created.transportNumber ?? created.transport_number ?? undefined,
        remitoNumber: created.remitoNumber ?? created.remito_number ?? undefined,
        saleCondition: created.saleCondition ?? created.sale_condition ?? undefined,
        condicionIva: created.condicionIva ?? created.condicion_iva ?? undefined,
        transportes: created.transportes ?? [],
        priceListId: created.priceListId ?? created.price_list_id ?? undefined,
        legacyCode: created.legacyCode ?? created.legacy_code ?? undefined,
        accountZone: created.accountZone ?? created.account_zone ?? undefined,
        accountSellerLabel: created.accountSellerLabel ?? created.account_seller_label ?? undefined
      } as Customer;
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

  updateCustomer: async (id: string, data: { name?: string; businessName?: string; email?: string; address?: string; city?: string; cuit?: string; phone?: string; transportNumber?: string; remitoNumber?: string; saleCondition?: string; condicionIva?: string; transporteIds?: string[]; sellerId?: string; priceListId?: string | null; legacyCode?: string; accountZone?: string; accountSellerLabel?: string }): Promise<Customer> => {
    const updated = await request<any>(`/customers/${id}`, 'PATCH', data);
    return {
      id: updated.id,
      sellerId: updated.sellerId ?? updated.seller_id ?? '',
      name: updated.name ?? '',
      businessName: updated.businessName ?? updated.business_name ?? '',
      email: updated.email ?? '',
      address: updated.address ?? '',
      city: updated.city ?? '',
      cuit: updated.cuit ?? undefined,
      phone: updated.phone ?? undefined,
      transportNumber: updated.transportNumber ?? updated.transport_number ?? undefined,
      remitoNumber: updated.remitoNumber ?? updated.remito_number ?? undefined,
      saleCondition: updated.saleCondition ?? updated.sale_condition ?? undefined,
      condicionIva: updated.condicionIva ?? updated.condicion_iva ?? undefined,
      transportes: updated.transportes ?? [],
      priceListId: updated.priceListId ?? updated.price_list_id ?? undefined,
      legacyCode: updated.legacyCode ?? updated.legacy_code ?? undefined,
      accountZone: updated.accountZone ?? updated.account_zone ?? undefined,
      accountSellerLabel: updated.accountSellerLabel ?? updated.account_seller_label ?? undefined
    } as Customer;
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

  getIntegrationStatus: async (): Promise<{ mercadolibre: boolean; tiendanube: boolean; tiendanubeStoreId?: string | null }> => {
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

  /** Normaliza talles en Tienda Nube a P, M, G, GG, XG, XXG, XXXG (masivo vía API) */
  normalizeSizesInTiendaNube: async (): Promise<{ message: string; updatedVariants: number; skippedProducts: number; logs: string[] }> => {
    return handleRequest(async () => {
      return await request<{ message: string; updatedVariants: number; skippedProducts: number; logs: string[] }>('/integrations/tiendanube/normalize-sizes', 'POST');
    }, { message: 'Offline', updatedVariants: 0, skippedProducts: 0, logs: [] }, 'normalizeSizesInTiendaNube');
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

  // Sincronizar stock a plataformas externas
  syncStockToTiendaNube: async (): Promise<{ message: string; updated: number; errors: number; logs: string[] }> => {
    return handleRequest(async () => {
      return await request<{ message: string; updated: number; errors: number; logs: string[] }>('/integrations/tiendanube/sync-stock', 'POST', undefined, undefined, 180000);
    }, { message: 'Offline', updated: 0, errors: 0, logs: [] }, 'syncStockToTiendaNube');
  },

  syncStockToMercadoLibre: async (): Promise<{ message: string; updated: number; errors: number; logs: string[] }> => {
    return handleRequest(async () => {
      return await request<{ message: string; updated: number; errors: number; logs: string[] }>('/integrations/mercadolibre/sync-stock', 'POST', undefined, undefined, 180000);
    }, { message: 'Offline', updated: 0, errors: 0, logs: [] }, 'syncStockToMercadoLibre');
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

  getMercadoLibreItemVariations: async (itemId: string): Promise<{ variations: { variationId: number | string; sku: string; color: string; size: string; stock: number }[]; singleProduct?: boolean; itemId: string }> => {
    return request<{ variations: { variationId: number | string; sku: string; color: string; size: string; stock: number }[]; singleProduct?: boolean; itemId: string }>(`/integrations/mercadolibre/items/${encodeURIComponent(itemId)}/variations`, 'GET');
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

  getTiendaNubeProductVariants: async (productId: string): Promise<{ variants: { variantId: number | string; sku: string; color: string; size: string; stock: number }[]; productId: number | string }> => {
    return request<{ variants: { variantId: number | string; sku: string; color: string; size: string; stock: number }[]; productId: number | string }>(`/integrations/tiendanube/products/${encodeURIComponent(productId)}/variants`, 'GET');
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
    extraSystemPrompt: string;
    openAiConfigured: boolean;
    llmProvider: 'gemini' | 'groq' | 'openai' | null;
    llmLabel: string;
  }> => {
    return await request('/integrations/mercadolibre/questions-ai', 'GET');
  },
  saveMLQuestionsAiConfig: async (config: { enabled: boolean; extraSystemPrompt: string }): Promise<{ success: boolean; message?: string }> => {
    return await request('/integrations/mercadolibre/questions-ai', 'POST', config);
  },
  processMLQuestionsAi: async (limit?: number): Promise<{
    processed: number;
    results: Array<{ questionId: string; status: string; reason?: string; preview?: string; message?: string }>;
  }> => {
    return await request('/integrations/mercadolibre/questions-ai/process', 'POST', { limit: limit ?? 10 });
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

  addDespachoItem: async (despachoId: string, item: any): Promise<{ message: string; id: string }> => {
    return handleRequest(async () => {
      return await request<{ message: string; id: string }>(`/despachos/${despachoId}/items`, 'POST', item);
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

  getBilling: async (params?: { desde?: string; hasta?: string; customerId?: string; tipo?: 'FACTURA' | 'NC' }): Promise<any[]> => {
    const queryParams = new URLSearchParams();
    if (params?.desde) queryParams.append('desde', params.desde);
    if (params?.hasta) queryParams.append('hasta', params.hasta);
    if (params?.customerId) queryParams.append('customerId', params.customerId);
    if (params?.tipo) queryParams.append('tipo', params.tipo);
    const qs = queryParams.toString();
    return handleRequest(async () => {
      return await request<any[]>(`/billing${qs ? '?' + qs : ''}`, 'GET');
    }, [], 'getBilling');
  },

  exportBilling: async (params?: { desde?: string; hasta?: string; customerId?: string; tipo?: 'FACTURA' | 'NC' }): Promise<void> => {
    const queryParams = new URLSearchParams();
    if (params?.desde) queryParams.append('desde', params.desde);
    if (params?.hasta) queryParams.append('hasta', params.hasta);
    if (params?.customerId) queryParams.append('customerId', params.customerId);
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

  // ============ PAGOS (recibos) ============

  getPayments: async (params?: { customerId?: string; invoiceId?: string; orderId?: string; desde?: string; hasta?: string }): Promise<import('../types').Payment[]> => {
    const queryParams = new URLSearchParams();
    if (params?.customerId) queryParams.append('customerId', params.customerId);
    if (params?.invoiceId) queryParams.append('invoiceId', params.invoiceId);
    if (params?.orderId) queryParams.append('orderId', params.orderId);
    if (params?.desde) queryParams.append('desde', params.desde);
    if (params?.hasta) queryParams.append('hasta', params.hasta);
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
    invoiceId?: string | null;
    invoiceIds?: string[];
    receiptNumber: string;
    date: string;
    amount: number;
    notes?: string;
  }): Promise<import('../types').Payment> => {
    return await request<any>(`/payments`, 'POST', payload) as any;
  },
  updatePaymentDate: async (paymentId: string, date: string): Promise<import('../types').Payment> => {
    return await request<any>(`/payments/${encodeURIComponent(paymentId)}/date`, 'PATCH', { date }) as any;
  },
  updateImportedPaymentDate: async (payload: { customerId: string; importedLineOrder: number; date: string }): Promise<{ ok: boolean; customerId: string; importedLineOrder: number; date: string }> => {
    return await request<any>(`/payments/imported/date`, 'PATCH', payload) as any;
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
  }
};
