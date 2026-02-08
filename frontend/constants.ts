import { Product, Customer, Order, OrderStatus, Role, Visit, User, Attribute } from './types';

export const MOCK_USERS: User[] = [
  { id: 'u1', name: 'Martin Director', role: Role.ADMIN, email: 'admin@lupo.ar', password: '123' },
  { id: 'u2', name: 'Laura Vendedora', role: Role.SELLER, email: 'laura@lupo.ar', password: '123' },
  { id: 'u3', name: 'Carlos Deposito', role: Role.WAREHOUSE, email: 'carlos@lupo.ar', password: '123' },
  { id: 'u4', name: 'Pedro Vendedor 2', role: Role.SELLER, email: 'pedro@lupo.ar', password: '123' },
  { id: 'u5', name: 'Roberto Deposito 2', role: Role.WAREHOUSE, email: 'roberto@lupo.ar', password: '123' },
];

export const MOCK_ATTRIBUTES: Attribute[] = [
  { id: 's1', type: 'size', name: 'S' },
  { id: 's2', type: 'size', name: 'M' },
  { id: 's3', type: 'size', name: 'L' },
  { id: 's4', type: 'size', name: 'XL' },
  { id: 's5', type: 'size', name: 'Unico' },
  { id: 'c1', type: 'color', name: 'Negro', value: '#000000' },
  { id: 'c2', type: 'color', name: 'Blanco', value: '#ffffff' },
  { id: 'c3', type: 'color', name: 'Nude', value: '#e3caca' },
  { id: 'c4', type: 'color', name: 'Rojo', value: '#ff0000' },
  { id: 'c5', type: 'color', name: 'Mix', value: 'linear-gradient(45deg, red, blue)' },
];

export const MOCK_PRODUCTS: Product[] = [
  { 
    id: 'p1', sku: 'LP-1001-M-BK', name: 'Boxer Microfibra Seamless', category: 'Underwear', size: 'M', color: 'Negro', stock: 120, price: 4500, description: 'Boxer clásico sin costuras.',
    integrations: { tiendaNube: true, mercadoLibre: true, local: true }
  },
  { 
    id: 'p2', sku: 'LP-1001-L-BK', name: 'Boxer Microfibra Seamless', category: 'Underwear', size: 'L', color: 'Negro', stock: 45, price: 4500, description: 'Boxer clásico sin costuras.',
    integrations: { tiendaNube: true, mercadoLibre: true, local: true }
  },
  { 
    id: 'p3', sku: 'LP-1001-M-WH', name: 'Boxer Microfibra Seamless', category: 'Underwear', size: 'M', color: 'Blanco', stock: 200, price: 4500,
    integrations: { tiendaNube: true, mercadoLibre: false, local: true }
  },
  { 
    id: 'p4', sku: 'LP-2050-S-NU', name: 'Corpiño Deportivo High Impact', category: 'Sport', size: 'S', color: 'Nude', stock: 15, price: 8200,
    integrations: { tiendaNube: true, mercadoLibre: true, local: true }
  },
  { 
    id: 'p5', sku: 'LP-2050-M-NU', name: 'Corpiño Deportivo High Impact', category: 'Sport', size: 'M', color: 'Nude', stock: 8, price: 8200,
    integrations: { tiendaNube: false, mercadoLibre: true, local: true }
  },
  { 
    id: 'p6', sku: 'LP-5000-U-MX', name: 'Medias Caña Corta Pack x3', category: 'Socks', size: 'Unico', color: 'Mix', stock: 500, price: 3000,
    integrations: { tiendaNube: true, mercadoLibre: true, local: true }
  },
];

export const MOCK_CUSTOMERS: Customer[] = [
  { id: 'c1', sellerId: 'u2', name: 'Juan Perez', businessName: 'Lenceria Perez SRL', email: 'juan@perez.com', address: 'Av. Corrientes 1234', city: 'CABA' },
  { id: 'c2', sellerId: 'u2', name: 'Maria Gonzalez', businessName: 'Moda Interior SA', email: 'maria@modainterior.com', address: 'San Martin 450', city: 'Cordoba' },
  { id: 'c3', sellerId: 'u2', name: 'Pedro Lopez', businessName: 'Distribuidora del Norte', email: 'pedro@distrinorte.com', address: 'Belgrano 800', city: 'Rosario' },
  { id: 'c4', sellerId: 'u4', name: 'Ana Garcia', businessName: 'Ana Store', email: 'ana@store.com', address: 'Mitre 200', city: 'Mendoza' },
];

export const MOCK_ORDERS: Order[] = [
  { 
    id: 'o101', 
    customerId: 'c1', 
    sellerId: 'u2', 
    date: '2023-10-25', 
    status: OrderStatus.CONFIRMED, 
    total: 45000,
    items: [{ productId: 'p1', quantity: 10, picked: 0, priceAtMoment: 4500 }] 
  },
  { 
    id: 'o102', 
    customerId: 'c2', 
    sellerId: 'u2', 
    pickedBy: 'u3', // Claimed by Carlos
    date: '2023-10-26', 
    status: OrderStatus.PREPARATION, 
    total: 16400,
    items: [{ productId: 'p4', quantity: 2, picked: 2, priceAtMoment: 8200 }] 
  },
  { 
    id: 'o103', 
    customerId: 'c3', 
    sellerId: 'u2', 
    pickedBy: 'u3', // Completed by Carlos
    date: '2023-10-27', 
    status: OrderStatus.DISPATCHED, 
    total: 150000,
    items: [{ productId: 'p6', quantity: 50, picked: 50, priceAtMoment: 3000 }] 
  },
  { 
    id: 'o104', 
    customerId: 'c1', 
    sellerId: 'u2', 
    date: '2023-10-28', 
    status: OrderStatus.DRAFT, 
    total: 0,
    items: [] 
  },
];

export const MOCK_VISITS: Visit[] = [
  { id: 'v1', sellerId: 'u2', customerId: 'c1', date: '2023-10-20', notes: 'Cliente interesado en nueva linea sport.', outcome: 'Sale' },
  { id: 'v2', sellerId: 'u2', customerId: 'c3', date: '2023-10-22', notes: 'Stock alto, pasará pedido el mes que viene.', outcome: 'No Sale' },
];