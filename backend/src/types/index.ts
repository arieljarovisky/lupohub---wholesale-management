export enum Role {
  ADMIN = 'ADMIN',
  SELLER = 'SELLER',
  WAREHOUSE = 'WAREHOUSE',
  CUSTOMER = 'CUSTOMER'
}

export enum OrderStatus {
  DRAFT = 'Borrador',
  CONFIRMED = 'Confirmado',
  PREPARATION = 'Preparación',
  DISPATCHED = 'Despachado'
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  base_price: number;
  description?: string;
}

export interface ProductVariant {
  variantId: string;
  colorCode: string;
  colorName: string;
  sizeCode: string;
  stock: number;
}

export interface Customer {
  id: string;
  sellerId: string;
  name: string;
  businessName: string;
  email: string;
  address: string;
  city: string;
}

export interface OrderItem {
  variantId: string;
  quantity: number;
  picked?: number;
  priceAtMoment: number;
}

export interface Order {
  id: string;
  customerId: string;
  sellerId?: string | null;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  date: string;
}
