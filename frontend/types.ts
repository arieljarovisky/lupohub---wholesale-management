export enum Role {
  ADMIN = 'ADMIN',
  SELLER = 'SELLER',
  WAREHOUSE = 'WAREHOUSE',
  DEPOSITO = 'DEPOSITO',
  CUSTOMER = 'CUSTOMER'
}

export enum OrderStatus {
  DRAFT = 'Borrador',
  PENDING_ADMIN_CONFIRMATION = 'Pendiente confirmación admin',
  CONFIRMED = 'Confirmado',
  PREPARING = 'Preparando',
  PENDING_CONTROL = 'Falta controlar',
  CONTROLLED = 'Controlado',
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
  /** Unidades por pack en venta mayorista (default 1 = solo por unidad) */
  mayorista_pack_size?: number;
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
  ingresosBrutos?: string;
  inicioActividad?: string;
  email?: string;
  phone?: string;
  /** URL del logo de la empresa (para factura/remito) */
  logoUrl?: string;
  /** C.A.I. para remitos (Código de Autorización de Impresión, como en Tango) */
  caiRemito?: string;
  /** Fecha de vencimiento del C.A.I. (YYYY-MM-DD) */
  caiRemitoVencimiento?: string;
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
  /** Número de transporte para facturación */
  transportNumber?: string;
  /** Número de remito por cliente */
  remitoNumber?: string;
  /** Condición de venta (ej. cuenta corriente, contado) */
  saleCondition?: string;
  /** Condición de IVA (ej. Responsable Inscripto, Monotributo, Consumidor Final) */
  condicionIva?: string;
  /** Transportes (express) asignados para despachar pedidos a este cliente */
  transportes?: Transporte[];
  priceListId?: string;
  /** Código de cliente en sistema legacy (ej. Multimedias: 000809) */
  legacyCode?: string;
  /** Zona de cuenta corriente (ej. "01 - Caba") */
  accountZone?: string;
  /** Vendedor habitual en historial (ej. "27 - Colombo") */
  accountSellerLabel?: string;
}

export interface OrderItem {
  productId?: string;   // id del producto (para mostrar en picking)
  variantId?: string;   // id de la variante (guardado en BD)
  quantity: number;
  picked?: number;      // Quantity prepared by warehouse
  priceAtMoment: number;
  isBackorder?: boolean;
  /** Si true, quantity está en packs (se descontarán quantity × mayoristaPackSize unidades del stock) */
  sellAsPack?: boolean;
  /** Unidades por pack en mayorista (desde backend o producto); solo relevante si sellAsPack es true */
  mayoristaPackSize?: number;
  /** Datos de display desde el backend (getOrders) */
  sku?: string;
  productName?: string;
  sizeCode?: string;
  colorName?: string;
  /** Despacho de importación elegido para esta línea (varias líneas mismo SKU con distinto despacho) */
  despachoId?: string;
  /** Número de despacho (línea o, si no hay, el último del producto) */
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
  /** Fecha de emisión del comprobante (ISO); se usa para mostrar en la factura. */
  createdAt?: string;
}

export interface Order {
  id: string;
  customerId: string;
  /** Nombre del cliente (viene del backend para no depender de la lista visible) */
  customerBusinessName?: string;
  sellerId?: string | null; // null = pedido directo (cliente directo)
  /** Usuario que creó el pedido (sesión al guardar) */
  createdBy?: string;
  createdByName?: string;
  createdByRole?: string;
  /** Nombre del vendedor asignado al pedido (join server) */
  sellerName?: string;
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
  /** Nota de crédito emitida sobre el total del pedido */
  creditNotesTotalCount?: number;
  /** Nota de crédito emitida sobre ítems (parcial) */
  creditNotesItemCount?: number;
  /** Si está archivado (oculto de la lista por defecto) */
  archived?: boolean;
  /** Cobro del pedido mayorista (cuenta corriente / saldos pendientes) */
  paymentStatus?: 'pendiente' | 'pagado';
  /** Si true, este pedido no debe impactar stock (facturación administrativa). */
  noStockImpact?: boolean;
  /** Si el backend lo envía: hubo movimiento PEDIDO_MAYORISTA en historial (stock ya descontado de verdad). */
  mayoristaStockApplied?: boolean;
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
  /** 'total' = NC por todo el pedido; 'item' = NC por un ítem */
  scope?: 'total' | 'item';
  /** Índice del ítem cuando scope === 'item' */
  itemIndex?: number;
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

/** Pago / recibo cargado para un cliente (cuenta corriente). */
export interface Payment {
  id: string;
  source?: 'system' | 'imported';
  importedLineOrder?: number;
  customerId: string;
  customerBusinessName?: string;
  sellerId?: string;
  sellerName?: string;
  orderId?: string;
  invoiceId?: string;
  invoiceIds?: string[];
  receiptNumber: string;
  date: string; // YYYY-MM-DD
  amount: number;
  notes?: string;
  createdAt?: string;
  invoice?: { puntoVta?: number; cbteTipo?: number; cbteDesde?: number };
}