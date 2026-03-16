export enum Role {
  ADMIN = 'ADMIN',
  SELLER = 'SELLER',
  WAREHOUSE = 'WAREHOUSE',
  DEPOSITO = 'DEPOSITO',
  CUSTOMER = 'CUSTOMER'
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

/** Express / transporte por donde se despachan pedidos al cliente */
export interface Transporte {
  id: string;
  name: string;
  /** Dirección donde hay que despachar el paquete (sucursal o domicilio del transporte) */
  address?: string;
}

/** Datos del remitente para remitos y factura (guardado en localStorage) */
export interface RemitenteConfig {
  businessName: string;
  address?: string;
  city?: string;
  cuit?: string;
  /** URL del logo de la empresa (para factura/remito) */
  logoUrl?: string;
}

export interface Customer {
  id: string;
  sellerId?: string;
  userId?: string;
  name: string;
  businessName: string; // Razón Social
  email: string;
  address: string;
  city: string;
  /** CUIT/CUIL del cliente (para facturación electrónica Argentina) */
  cuit?: string;
  /** Teléfono (empresa o contacto) */
  phone?: string;
  /** Condición de IVA (ej. Responsable Inscripto, Monotributo, Consumidor Final) */
  condicionIva?: string;
  /** Transportes (express) asignados para despachar pedidos a este cliente */
  transportes?: Transporte[];
  priceListId?: string;
}

export interface OrderItem {
  productId?: string;   // id del producto (para mostrar en picking)
  variantId?: string;   // id de la variante (guardado en BD)
  quantity: number;
  picked?: number;      // Quantity prepared by warehouse
  priceAtMoment: number;
  isBackorder?: boolean;
  /** Datos de display desde el backend (getOrders) */
  sku?: string;
  productName?: string;
  sizeCode?: string;
  colorName?: string;
  /** Número de despacho de importación del producto (desde backend) */
  numeroDespacho?: string;
}

/** Factura AFIP asociada a un pedido (viene en getOrders). */
export interface OrderInvoice {
  cae: string;
  caeFchVto?: string;
  puntoVta?: number;
  cbteDesde: number;
  cbteHasta: number;
  cbteTipo: number;
}

export interface Order {
  id: string;
  customerId: string;
  /** Nombre del cliente (viene del backend para no depender de la lista visible) */
  customerBusinessName?: string;
  sellerId?: string | null; // null = pedido directo (cliente directo)
  pickedBy?: string; // Usuario de depósito que preparó/despachó
  dispatchedAt?: string; // Fecha/hora en que se despachó
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  date: string;
  /** Factura electrónica AFIP emitida para este pedido */
  invoice?: OrderInvoice;
  /** Cantidad de notas de crédito emitidas para este pedido (desde backend) */
  creditNotesCount?: number;
}

/** Nota de crédito AFIP asociada a un pedido (lista desde API). */
export interface CreditNote {
  id: string;
  orderId: string;
  invoiceId: string;
  cae: string;
  caeFchVto?: string;
  puntoVta: number;
  cbteTipo: number;
  cbteDesde: number;
  cbteHasta: number;
  amountCredited: number;
  createdAt?: string;
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
  priceListId?: string;
}

export interface PriceList {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}