import { Product, Order, OrderStatus, User } from '../types';
import { MOCK_PRODUCTS, MOCK_ORDERS, MOCK_USERS } from '../constants';
import httpClient, { request } from './httpClient';

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
  // --- PRODUCTS ---
  getProducts: async (): Promise<Product[]> => {
    return handleRequest(async () => {
      const res = await request<any>('/products', 'GET');
      const rows = Array.isArray(res) ? res : res.items;
      return rows.map((r: any) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        size: '',
        color: '',
        stock: Number((r as any).stock_total ?? (r as any).stock ?? 0),
        price: Number((r as any).base_price ?? (r as any).price ?? 0),
        description: '',
        externalIds: r.externalIds
      })) as Product[];
    }, MOCK_PRODUCTS, 'getProducts');
  },

  getProductsPaged: async (page: number, perPage: number, q?: string, sort?: 'sku' | 'name' | 'stock', dir?: 'asc' | 'desc'): Promise<{ items: Product[]; page: number; per_page: number; total: number }> => {
    return handleRequest(async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        ...(q ? { q } : {}),
        ...(sort ? { sort } : {}),
        ...(dir ? { dir } : {})
      });
      const res = await request<any>(`/products?${params.toString()}`, 'GET');
      const items = (res.items || []).map((r: any) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        size: '',
        color: '',
        stock: Number((r as any).stock_total ?? (r as any).stock ?? 0),
        price: Number((r as any).base_price ?? (r as any).price ?? 0),
        description: '',
        externalIds: r.externalIds
      })) as Product[];
      return { items, page: res.page, per_page: res.per_page, total: res.total };
    }, { items: MOCK_PRODUCTS.slice(0, perPage), page, per_page: perPage, total: MOCK_PRODUCTS.length }, 'getProductsPaged');
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
  
  getColors: async (): Promise<Array<{ code: string; name: string; hex?: string }>> => {
    return handleRequest(async () => {
      const rows = await request<any[]>('/colors', 'GET');
      return rows.map(r => ({ code: r.code, name: r.name, hex: r.hex }));
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
  
  updateProduct: async (product: Product): Promise<Product> => {
    const payload: any = {
      name: product.name,
      category: product.category,
      base_price: product.price,
      description: product.description
    };
    return handleRequest(async () => {
      return await request<Product>(`/products/${product.id}`, 'PUT', payload);
    }, product, 'updateProduct');
  },

  deleteAllProducts: async (): Promise<void> => {
    return handleRequest(async () => {
      await request<void>('/products/all', 'DELETE');
    }, undefined, 'deleteAllProducts');
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

  updateVariantExternalIds: async (variantId: string, ids: { tiendaNubeVariantId?: string; mercadoLibreVariantId?: string }): Promise<void> => {
    return handleRequest(async () => {
      await request<void>(`/products/variants/${variantId}/external-ids`, 'PUT', ids);
    }, undefined, 'updateVariantExternalIds');
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


  updateOrderStatus: async (id: string, status: OrderStatus): Promise<void> => {
    return handleRequest(async () => {
      await request<void>(`/orders/${id}/status`, 'PATCH', { status });
    }, undefined, 'updateOrderStatus');
  },

  // --- INTEGRATIONS ---
  getIntegrationStatus: async (): Promise<{ mercadolibre: boolean; tiendanube: boolean }> => {
    return handleRequest(async () => {
      return await request<{ mercadolibre: boolean; tiendanube: boolean }>('/integrations/status', 'GET');
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
  
  syncProductsFromMercadoLibre: async (): Promise<{ message: string; linkedVariants: number; logs: string[] }> => {
    return handleRequest(async () => {
      return await request<{ message: string; linkedVariants: number; logs: string[] }>('/integrations/mercadolibre/sync', 'POST');
    }, { message: 'Offline', linkedVariants: 0, logs: [] }, 'syncProductsFromMercadoLibre');
  },

  disconnectIntegration: async (platform: 'mercadolibre' | 'tiendanube'): Promise<{ message: string; platform: string }> => {
    return handleRequest(async () => {
      return await request<{ message: string; platform: string }>(`/integrations/${platform}/disconnect`, 'DELETE');
    }, { message: 'Offline', platform }, 'disconnectIntegration');
  }
};
