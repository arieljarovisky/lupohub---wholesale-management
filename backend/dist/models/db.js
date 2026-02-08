"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const types_1 = require("../types");
// Datos iniciales (Mock)
exports.db = {
    products: [
        { id: 'p1', sku: 'LP-1001', name: 'Boxer Microfibra Seamless', category: 'Underwear', base_price: 4500 },
        { id: 'p6', sku: 'LP-5000', name: 'Medias Caña Corta Pack x3', category: 'Socks', base_price: 3000 },
    ],
    customers: [
        { id: 'c1', sellerId: 'u2', name: 'Juan Perez', businessName: 'Lenceria Perez SRL', email: 'juan@perez.com', address: 'Av. Corrientes 1234', city: 'CABA' },
        { id: 'c2', sellerId: 'u2', name: 'Maria Gonzalez', businessName: 'Moda Interior SA', email: 'maria@modainterior.com', address: 'San Martin 450', city: 'Cordoba' },
    ],
    orders: [
        {
            id: 'o101', customerId: 'c1', sellerId: 'u2', date: '2023-10-25', status: types_1.OrderStatus.CONFIRMED, total: 45000,
            items: [{ variantId: 'pv1', quantity: 10, picked: 0, priceAtMoment: 4500 }]
        }
    ]
};
