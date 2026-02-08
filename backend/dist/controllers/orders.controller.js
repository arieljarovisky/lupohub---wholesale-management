"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteOrder = exports.updateOrder = exports.updateOrderStatus = exports.createOrder = exports.getOrders = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const getOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Get Orders
        const ordersRow = yield (0, db_1.query)("SELECT * FROM orders ORDER BY date DESC");
        // 2. Get Items for each order (N+1 query simplified for demo, in prod use JOIN or specialized fetch)
        const ordersFull = yield Promise.all(ordersRow.map((order) => __awaiter(void 0, void 0, void 0, function* () {
            const items = yield (0, db_1.query)(`
        SELECT i.variant_id as variantId, i.quantity, i.picked, i.price_at_moment as priceAtMoment
        FROM order_items i
        WHERE i.order_id = ?
      `, [order.id]);
            return {
                id: order.id,
                customerId: order.customer_id,
                sellerId: order.seller_id,
                date: order.date,
                status: order.status,
                total: order.total,
                pickedBy: order.picked_by,
                items: items
            };
        })));
        res.json(ordersFull);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error fetching orders" });
    }
});
exports.getOrders = getOrders;
const createOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const newOrder = req.body;
    if (!newOrder.customerId || !newOrder.items.length) {
        return res.status(400).json({ message: "Datos de pedido inválidos" });
    }
    const orderId = newOrder.id || (0, uuid_1.v4)();
    try {
        const toSqlDate = (d) => {
            try {
                const dt = new Date(d);
                if (isNaN(dt.getTime()))
                    return new Date().toISOString().slice(0, 10);
                return dt.toISOString().slice(0, 10);
            }
            catch (_a) {
                return new Date().toISOString().slice(0, 10);
            }
        };
        const sqlDate = toSqlDate(newOrder.date);
        yield (0, db_1.execute)(`INSERT INTO orders (id, customer_id, seller_id, date, status, total) VALUES (?, ?, ?, ?, ?, ?)`, [orderId, newOrder.customerId, newOrder.sellerId, sqlDate, newOrder.status, newOrder.total]);
        for (const item of newOrder.items) {
            let variantId = item.variantId;
            if (!variantId && item.sku && item.colorCode && item.sizeCode) {
                const row = yield (0, db_1.get)(`SELECT pv.id AS variant_id 
           FROM products p 
           JOIN product_colors pc ON pc.product_id = p.id 
           JOIN colors c ON c.id = pc.color_id 
           JOIN product_variants pv ON pv.product_color_id = pc.id 
           JOIN sizes s ON s.id = pv.size_id 
           WHERE p.sku = ? AND c.code = ? AND s.size_code = ?`, [item.sku, item.colorCode, item.sizeCode]);
                variantId = row === null || row === void 0 ? void 0 : row.variant_id;
            }
            if (!variantId) {
                return res.status(400).json({ message: "Falta variantId o sku+colorCode+sizeCode en item" });
            }
            yield (0, db_1.execute)(`INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment) VALUES (?, ?, ?, ?, ?, ?)`, [(0, uuid_1.v4)(), orderId, variantId, item.quantity, 0, item.priceAtMoment]);
        }
        res.status(201).json(Object.assign(Object.assign({}, newOrder), { id: orderId }));
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error creating order" });
    }
});
exports.createOrder = createOrder;
const updateOrderStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const { status } = req.body;
    try {
        yield (0, db_1.execute)("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
        res.json({ id, status });
    }
    catch (error) {
        res.status(500).json({ message: "Error updating order status" });
    }
});
exports.updateOrderStatus = updateOrderStatus;
const updateOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { id } = req.params;
    const updated = req.body;
    if (!id || !updated || !((_a = updated.items) === null || _a === void 0 ? void 0 : _a.length)) {
        return res.status(400).json({ message: "Datos de pedido inválidos" });
    }
    try {
        const toSqlDate = (d) => {
            try {
                const dt = new Date(d);
                if (isNaN(dt.getTime()))
                    return new Date().toISOString().slice(0, 10);
                return dt.toISOString().slice(0, 10);
            }
            catch (_a) {
                return new Date().toISOString().slice(0, 10);
            }
        };
        const sqlDate = toSqlDate(updated.date);
        yield (0, db_1.execute)("UPDATE orders SET customer_id = ?, seller_id = ?, date = ?, status = ?, total = ? WHERE id = ?", [updated.customerId, updated.sellerId, sqlDate, updated.status, updated.total, id]);
        yield (0, db_1.execute)("DELETE FROM order_items WHERE order_id = ?", [id]);
        for (const item of updated.items) {
            let variantId = item.variantId;
            if (!variantId && item.sku && item.colorCode && item.sizeCode) {
                const row = yield (0, db_1.get)(`SELECT pv.id AS variant_id 
           FROM products p 
           JOIN product_colors pc ON pc.product_id = p.id 
           JOIN colors c ON c.id = pc.color_id 
           JOIN product_variants pv ON pv.product_color_id = pc.id 
           JOIN sizes s ON s.id = pv.size_id 
           WHERE p.sku = ? AND c.code = ? AND s.size_code = ?`, [item.sku, item.colorCode, item.sizeCode]);
                variantId = row === null || row === void 0 ? void 0 : row.variant_id;
            }
            if (!variantId) {
                return res.status(400).json({ message: "Falta variantId o sku+colorCode+sizeCode en item" });
            }
            yield (0, db_1.execute)("INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment) VALUES (?, ?, ?, ?, ?, ?)", [(0, uuid_1.v4)(), id, variantId, item.quantity, item.picked || 0, item.priceAtMoment]);
        }
        res.json(Object.assign(Object.assign({}, updated), { id }));
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error actualizando pedido" });
    }
});
exports.updateOrder = updateOrder;
const deleteOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ message: "ID inválido" });
    try {
        yield (0, db_1.execute)("DELETE FROM orders WHERE id = ?", [id]);
        res.json({ id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error eliminando pedido" });
    }
});
exports.deleteOrder = deleteOrder;
