import { Product, Order, OrderStatus, User, Customer } from '../types';
import { MOCK_PRODUCTS, MOCK_ORDERS, MOCK_USERS } from '../constants';
import httpClient, { request, requestFormData, getBlob } from './httpClient';

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
  updateUser: async (id: string, data: { priceListId?: string | null }): Promise<User> => {
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
  fillPriceListFromBase: async (id: string, multiplier?: number): Promise<{ items: { productId: string; price: number }[]; count: number }> => {
    return request<any>(`/price-lists/${id}/fill-from-base`, 'POST', multiplier != null ? { multiplier } : {});
  },
  setPriceListItemsBySku: async (id: string, items: { sku: string; price: number }[]): Promise<{ items: { productId: string; price: number }[]; imported: number; notFound?: string[] }> => {
    return request<any>(`/price-lists/${id}/items/by-sku`, 'PUT', { items });
  },

  // --- PRODUCTS ---
  getProducts: async (options?: { priceListId?: string | null; perPage?: number }): Promise<Product[]> => {
    return handleRequest(async () => {
      const perPage = options?.perPage ?? 5000;
      const params = new URLSearchParams({ per_page: String(perPage) });
      if (options?.priceListId) params.set('price_list_id', options.priceListId);
      const res = await request<any>(`/products?${params.toString()}`, 'GET');
      const rows = Array.isArray(res) ? res : res.items;
      return rows.map((r: any) => {
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
    }, MOCK_PRODUCTS, 'getProducts');
  },

  /** Igual que getProducts pero sin fallback: lanza si falla. Usar al refrescar después de crear para no pisar con MOCK. */
  getProductsStrict: async (options?: { priceListId?: string | null; perPage?: number }): Promise<Product[]> => {
    const perPage = options?.perPage ?? 5000;
    const params = new URLSearchParams({ per_page: String(perPage) });
    if (options?.priceListId) params.set('price_list_id', options.priceListId);
    const res = await request<any>(`/products?${params.toString()}`, 'GET');
    const rows = Array.isArray(res) ? res : (res && res.items) || [];
    return rows.map((r: any) => {
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
  },

  getProductsPaged: async (page: number, perPage: number, q?: string, sort?: 'sku' | 'name' | 'stock', dir?: 'asc' | 'desc', syncFilter?: 'ALL' | 'ML' | 'TN' | 'BOTH' | 'NONE', options?: { skipTotal?: boolean }): Promise<{ items: Product[]; page: number; per_page: number; total: number }> => {
    return handleRequest(async () => {
      const syncMl = syncFilter === 'ML' || syncFilter === 'BOTH';
      const syncTn = syncFilter === 'TN' || syncFilter === 'BOTH';
      const syncNone = syncFilter === 'NONE';
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

  getProductBySku: async (sku: string): Promise<{ id: string; sku: string; name: string; category?: string; base_price?: number; mercado_libre_pack_size?: number; tienda_nube_pack_size?: number; externalIds?: any; variants?: any[] } | null> => {
    try {
      const res = await request<any>(`/products/${encodeURIComponent(sku)}`, 'GET');
      return res ? { ...res, mercado_libre_pack_size: res.mercado_libre_pack_size ?? 1, tienda_nube_pack_size: res.tienda_nube_pack_size ?? 1 } : null;
    } catch {
      return null;
    }
  },

  getProductById: async (id: string): Promise<{ id: string; sku: string; name: string; category?: string; base_price?: number; description?: string; mercado_libre_pack_size?: number; tienda_nube_pack_size?: number } | null> => {
    try {
      const res = await request<any>(`/products/by-id/${encodeURIComponent(id)}`, 'GET');
      return res ? { ...res, mercado_libre_pack_size: res.mercado_libre_pack_size ?? 1, tienda_nube_pack_size: res.tienda_nube_pack_size ?? 1 } : null;
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
  
  getColors: async (): Promise<Array<{ code: string; name: string; hex?: string }>> => {
    return handleRequest(async () => {
      const rows = await request<any[]>('/colors', 'GET');
      return rows.map(r => ({
        code: r.code != null ? String(r.code).trim() : '',
        name: r.name != null ? String(r.name).trim() : '',
        hex: r.hex
      }));
    }, [], 'getColors');
  },

  getSizes: async (): Promise<Array<{ code: string; name: string }>> => {
    return handleRequest(async () => {
      const rows = await request<any[]>('/sizes', 'GET');
      return rows.map(r => ({ code: r.code, name: r.name }));
    }, [], 'getSizes');
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
  
  updateProduct: async (product: Product & { mercadoLibrePackSize?: number; tiendaNubePackSize?: number }): Promise<Product> => {
    const payload: any = {
      name: product.name,
      category: product.category,
      base_price: product.price,
      description: product.description
    };
    if (product.mercadoLibrePackSize != null) payload.mercadoLibrePackSize = product.mercadoLibrePackSize;
    if (product.tiendaNubePackSize != null) payload.tiendaNubePackSize = product.tiendaNubePackSize;
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

  updateVariantExternalIds: async (variantId: string, ids: { tiendaNubeVariantId?: string; mercadoLibreVariantId?: string; mercadoLibreItemId?: string; externalSku?: string }): Promise<{ stockFromML?: number }> => {
    return handleRequest(async () => {
      return await request<{ stockFromML?: number }>(`/products/variants/${variantId}/external-ids`, 'PUT', ids);
    }, {}, 'updateVariantExternalIds');
  },

  bulkLinkVariants: async (payload: {
    productId?: string;
    mercadoLibreItemId?: string;
    tiendaNubeProductId?: string;
    links: Array<{ variantId: string; mercadoLibreVariantId?: string | number; mercadoLibreItemId?: string; tiendaNubeVariantId?: string | number; externalSku?: string }>;
  }): Promise<{ updated: number; synced?: number; productId?: string }> => {
    return request<{ updated: number; synced?: number; productId?: string }>('/products/variants/bulk-link', 'POST', payload);
  },

  // --- ORDERS ---
  getOrders: async (): Promise<Order[]> => {
    return handleRequest(async () => {
      return await request<Order[]>('/orders', 'GET');
    }, MOCK_ORDERS, 'getOrders');
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
        priceListId: r.priceListId ?? r.price_list_id ?? undefined
      })) as Customer[];
    }, [], 'getCustomers');
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
        priceListId: r.priceListId ?? undefined
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
        priceListId: customer.priceListId
      });
      return {
        id: created.id,
        sellerId: created.sellerId ?? created.seller_id ?? '',
        name: created.name ?? '',
        businessName: created.businessName ?? created.business_name ?? '',
        email: created.email ?? '',
        address: created.address ?? '',
        city: created.city ?? '',
        priceListId: created.priceListId ?? created.price_list_id ?? undefined
      } as Customer;
    }, customer, 'createCustomer');
  },

  updateCustomer: async (id: string, data: { name?: string; businessName?: string; email?: string; address?: string; city?: string; sellerId?: string; priceListId?: string | null }): Promise<Customer> => {
    const updated = await request<any>(`/customers/${id}`, 'PATCH', data);
    return {
      id: updated.id,
      sellerId: updated.sellerId ?? updated.seller_id ?? '',
      name: updated.name ?? '',
      businessName: updated.businessName ?? updated.business_name ?? '',
      email: updated.email ?? '',
      address: updated.address ?? '',
      city: updated.city ?? '',
      priceListId: updated.priceListId ?? updated.price_list_id ?? undefined
    } as Customer;
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
  getVariantExternalStocks: async (variantIds: string[]): Promise<{ stocks: Record<string, { stockML?: number; stockTN?: number }> }> => {
    return handleRequest(async () => {
      return await request<{ stocks: Record<string, { stockML?: number; stockTN?: number }> }>('/integrations/variant-external-stocks', 'POST', { variantIds }, undefined, 30000);
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

  // Historial de movimientos de stock
  getStockMovements: async (params?: { 
    variantId?: string; 
    type?: string; 
    from?: string; 
    to?: string; 
    limit?: number;
    offset?: number;
  }): Promise<any[]> => {
    return handleRequest(async () => {
      const queryParams = new URLSearchParams();
      if (params?.variantId) queryParams.append('variantId', params.variantId);
      if (params?.type) queryParams.append('type', params.type);
      if (params?.from) queryParams.append('from', params.from);
      if (params?.to) queryParams.append('to', params.to);
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.offset) queryParams.append('offset', params.offset.toString());
      const queryString = queryParams.toString();
      return await request<any[]>(`/stock/movements${queryString ? '?' + queryString : ''}`, 'GET');
    }, [], 'getStockMovements');
  },

  // Revertir un movimiento de stock (último de la variante)
  revertStockMovement: async (movementId: string): Promise<{ message: string; movementId: string; variantId: string; restoredStock: number }> => {
    return handleRequest(async () => {
      return await request<{ message: string; movementId: string; variantId: string; restoredStock: number }>(`/stock/movements/${encodeURIComponent(movementId)}/revert`, 'POST');
    }, { message: 'Error revirtiendo movimiento', movementId, variantId: '', restoredStock: 0 }, 'revertStockMovement');
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
