"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
        // 2. Get Items for each order with productId (variant -> product_color -> product)
        const ordersFull = yield Promise.all(ordersRow.map((order) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const items = yield (0, db_1.query)(`
        SELECT i.variant_id AS variantId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment,
               pc.product_id AS productId
        FROM order_items i
        JOIN product_variants pv ON pv.id = i.variant_id
        JOIN product_colors pc ON pc.id = pv.product_color_id
        WHERE i.order_id = ?
      `, [order.id]);
            const itemsMapped = items.map((row) => {
                var _a;
                return ({
                    variantId: row.variantId,
                    productId: row.productId,
                    quantity: row.quantity,
                    picked: (_a = row.picked) !== null && _a !== void 0 ? _a : 0,
                    priceAtMoment: Number(row.priceAtMoment)
                });
            });
            return {
                id: order.id,
                customerId: order.customer_id,
                sellerId: order.seller_id,
                date: order.date,
                status: order.status,
                total: Number(order.total),
                pickedBy: (_a = order.picked_by) !== null && _a !== void 0 ? _a : undefined,
                dispatchedAt: order.dispatched_at ? new Date(order.dispatched_at).toISOString() : undefined,
                items: itemsMapped
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
    var _a, _b;
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
            yield (0, db_1.execute)(`INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment) VALUES (?, ?, ?, ?, ?, ?)`, [(0, uuid_1.v4)(), orderId, variantId, item.quantity, 0, (_a = item.priceAtMoment) !== null && _a !== void 0 ? _a : 0]);
        }
        if (newOrder.status === 'Confirmado') {
            const { deductStockForOrder } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
            const result = yield deductStockForOrder(orderId);
            if (!result.success)
                console.error('Errores descontando stock al crear pedido confirmado:', result.errors);
        }
        const created = yield (0, db_1.get)('SELECT id, customer_id, seller_id, date, status, total, picked_by, dispatched_at FROM orders WHERE id = ?', [orderId]);
        if (!created)
            return res.status(201).json(Object.assign(Object.assign({}, newOrder), { id: orderId }));
        const items = yield (0, db_1.query)(`
      SELECT i.variant_id AS variantId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment, pc.product_id AS productId
      FROM order_items i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      WHERE i.order_id = ?
    `, [orderId]);
        const itemsMapped = items.map((row) => {
            var _a;
            return ({
                variantId: row.variantId,
                productId: row.productId,
                quantity: row.quantity,
                picked: (_a = row.picked) !== null && _a !== void 0 ? _a : 0,
                priceAtMoment: Number(row.priceAtMoment)
            });
        });
        const orderResponse = {
            id: created.id,
            customerId: created.customer_id,
            sellerId: created.seller_id,
            date: created.date,
            status: created.status,
            total: Number(created.total),
            pickedBy: (_b = created.picked_by) !== null && _b !== void 0 ? _b : undefined,
            dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
            items: itemsMapped
        };
        res.status(201).json(orderResponse);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error creating order" });
    }
});
exports.createOrder = createOrder;
const updateOrderStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const { status, pickedBy } = req.body;
    try {
        // Obtener estado anterior
        const currentOrder = yield (0, db_1.get)("SELECT status FROM orders WHERE id = ?", [id]);
        const previousStatus = currentOrder === null || currentOrder === void 0 ? void 0 : currentOrder.status;
        // Si pasa de Borrador a Confirmado, descontar stock
        if (previousStatus === 'Borrador' && status === 'Confirmado') {
            const { deductStockForOrder } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
            const result = yield deductStockForOrder(id);
            if (!result.success) {
                console.error('Errores descontando stock:', result.errors);
            }
        }
        // Si se cancela un pedido confirmado, restaurar stock
        if (previousStatus === 'Confirmado' && status === 'Cancelado') {
            const { restoreStockForOrder } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
            const result = yield restoreStockForOrder(id);
            if (!result.success) {
                console.error('Errores restaurando stock:', result.errors);
            }
        }
        // Documentar quién prepara/despacha y cuándo
        if (status === 'Preparación' && pickedBy) {
            yield (0, db_1.execute)("UPDATE orders SET status = ?, picked_by = ? WHERE id = ?", [status, pickedBy, id]);
        }
        else if (status === 'Despachado') {
            yield (0, db_1.execute)("UPDATE orders SET status = ?, picked_by = COALESCE(?, picked_by), dispatched_at = NOW() WHERE id = ?", [status, pickedBy || null, id]);
        }
        else {
            yield (0, db_1.execute)("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
        }
        res.json({ id, status, previousStatus });
    }
    catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ message: "Error updating order status" });
    }
});
exports.updateOrderStatus = updateOrderStatus;
const updateOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
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
        const created = yield (0, db_1.get)('SELECT id, customer_id, seller_id, date, status, total, picked_by, dispatched_at FROM orders WHERE id = ?', [id]);
        if (!created)
            return res.json(Object.assign(Object.assign({}, updated), { id }));
        const itemsRows = yield (0, db_1.query)(`
      SELECT i.variant_id AS variantId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment, pc.product_id AS productId
      FROM order_items i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      WHERE i.order_id = ?
    `, [id]);
        const itemsMapped = itemsRows.map((row) => {
            var _a;
            return ({
                variantId: row.variantId,
                productId: row.productId,
                quantity: row.quantity,
                picked: (_a = row.picked) !== null && _a !== void 0 ? _a : 0,
                priceAtMoment: Number(row.priceAtMoment)
            });
        });
        res.json({
            id: created.id,
            customerId: created.customer_id,
            sellerId: created.seller_id,
            date: created.date,
            status: created.status,
            total: Number(created.total),
            pickedBy: (_b = created.picked_by) !== null && _b !== void 0 ? _b : undefined,
            dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
            items: itemsMapped
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error actualizando pedido" });
    }
});
exports.updateOrder = updateOrder;
const deleteOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ message: "ID inválido" });
    try {
        const currentOrder = yield (0, db_1.get)("SELECT status FROM orders WHERE id = ?", [id]);
        const status = currentOrder === null || currentOrder === void 0 ? void 0 : currentOrder.status;
        if (status === 'Confirmado' || status === 'Preparación') {
            const { restoreStockForOrder } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
            const result = yield restoreStockForOrder(id);
            if (!result.success) {
                console.error('Errores restaurando stock al eliminar pedido:', result.errors);
                return res.status(500).json({ message: 'Error restaurando stock: ' + (((_a = result.errors) === null || _a === void 0 ? void 0 : _a.join(', ')) || 'desconocido') });
            }
        }
        yield (0, db_1.execute)("DELETE FROM orders WHERE id = ?", [id]);
        res.json({ id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error eliminando pedido" });
    }
});
exports.deleteOrder = deleteOrder;
