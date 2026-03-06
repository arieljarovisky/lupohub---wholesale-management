export enum Role {
  ADMIN = 'ADMIN',
  SELLER = 'SELLER',
  WAREHOUSE = 'WAREHOUSE'
}

export enum OrderStatus {
  DRAFT = 'Borrador',
  CONFIRMED = 'Confirmado',
  PREPARATION = 'Preparación',
  DISPATCHED = 'Despachado',
  CANCELLED = 'Cancelado'
}

export interface Attribute {
  id: string;
  type: 'color' | 'size';
  name: string;
  value?: string; // Hex code for colors
}

export interface ProductIntegrations {
  tiendaNube: boolean;
  mercadoLibre: boolean;
  local: boolean;
}

export interface ExternalIds {
  tiendaNube?: string; // ID del producto en TN
  tiendaNubeVariant?: string; // ID de la variante en TN
  mercadoLibre?: string; // ID del item en ML (ej: MLA...)
}

export interface Product {
  id: string;
  sku: string;
  /** SKU del artículo padre (desde backend); usado para agrupar variantes */
  base_sku?: string;
  /** ID del producto padre en products (desde backend) */
  product_id?: string;
  name: string;
  category: string;
  size: string;
  color: string;
  stock: number;
  price: number;
  description?: string;
  integrations?: ProductIntegrations;
  externalIds?: ExternalIds; // Link to external platforms
}

export interface ApiConfig {
  tiendaNube: {
    accessToken: string;
    storeId: string;
    userAgent: string; // Required by TN (Email)
  };
  mercadoLibre: {
    accessToken: string;
    userId: string;
  };
}

export interface Customer {
  id: string;
  sellerId: string; // Linked to specific seller
  name: string;
  businessName: string; // Razón Social
  email: string;
  address: string;
  city: string;
}

export interface OrderItem {
  productId?: string;   // id del producto (para mostrar en picking)
  variantId?: string;   // id de la variante (guardado en BD)
  quantity: number;
  picked?: number;      // Quantity prepared by warehouse
  priceAtMoment: number;
  isBackorder?: boolean;
}

export interface Order {
  id: string;
  customerId: string;
  sellerId: string; // User ID
  pickedBy?: string; // Usuario de depósito que preparó/despachó
  dispatchedAt?: string; // Fecha/hora en que se despachó
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  date: string;
}

export interface Visit {
  id: string;
  sellerId: string;
  customerId: string;
  date: string;
  notes: string;
  outcome: 'Sale' | 'No Sale' | 'Follow Up';
}

export interface User {
  id: string;
  name: string;
  role: Role;
  email: string;
  password?: string; // New field for authentication
  commissionPercentage?: number; // Admin configurable
}