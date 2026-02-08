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
      const rows = await request<any[]>('/products', 'GET');
      return rows.map(r => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        size: '', // normalizado: tamaño por variante
        color: '', // normalizado: color por variante
        stock: Number(r.stock_total ?? 0),
        price: Number(r.base_price ?? 0),
        description: ''
      })) as Product[];
    }, MOCK_PRODUCTS, 'getProducts');
  },

  getVariantsBySku: async (sku: string): Promise<Array<{ variantId: string; colorCode: string; colorName: string; sizeCode: string; stock: number }>> => {
    return handleRequest(async () => {
      const res = await request<any>(`/products/${sku}`, 'GET');
      const variants = (res?.variants || []).map((v: any) => ({
        variantId: v.variant_id,
        colorCode: v.color_code,
        colorName: v.color_name,
        sizeCode: v.size_code,
        stock: Number(v.stock ?? 0),
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

  patchStock: async (args: { variantId?: string; sku?: string; colorCode?: string; sizeCode?: string; stock: number }): Promise<{ variantId: string; stock: number }> => {
    return handleRequest(async () => {
      return await request<{ variantId: string; stock: number }>(`/products/stock`, 'PATCH', args);
    }, { variantId: args.variantId || '', stock: args.stock }, 'patchStock');
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
  }
};
