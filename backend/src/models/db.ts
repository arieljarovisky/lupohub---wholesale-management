import { Product, Order, Customer, OrderStatus, Role } from '../types';

// Datos iniciales (Mock)
export const db = {
  products: [
    { id: 'p1', sku: 'LP-1001', name: 'Boxer Microfibra Seamless', category: 'Underwear', base_price: 4500 },
    { id: 'p6', sku: 'LP-5000', name: 'Medias Caña Corta Pack x3', category: 'Socks', base_price: 3000 },
  ] as Product[],

  customers: [
    { id: 'c1', sellerId: 'u2', name: 'Juan Perez', businessName: 'Lenceria Perez SRL', email: 'juan@perez.com', address: 'Av. Corrientes 1234', city: 'CABA' },
    { id: 'c2', sellerId: 'u2', name: 'Maria Gonzalez', businessName: 'Moda Interior SA', email: 'maria@modainterior.com', address: 'San Martin 450', city: 'Cordoba' },
  ] as Customer[],

  orders: [
    { 
      id: 'o101', customerId: 'c1', sellerId: 'u2', date: '2023-10-25', status: OrderStatus.CONFIRMED, total: 45000,
      items: [{ variantId: 'pv1', quantity: 10, picked: 0, priceAtMoment: 4500 }] 
    }
  ] as Order[]
};
