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
exports.emitirNotaCredito = exports.getOrderCreditNotes = exports.emitirFactura = exports.getOrderInvoice = exports.deleteOrder = exports.archiveOrder = exports.patchOrderPaymentStatus = exports.updateOrder = exports.updateOrderStatus = exports.createOrder = exports.getOrders = void 0;
const db_1 = require("../database/db");
const stock_controller_1 = require("./stock.controller");
const uuid_1 = require("uuid");
function resolveDespachoIdForItem(item, variantId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const raw = (_a = item === null || item === void 0 ? void 0 : item.despachoId) !== null && _a !== void 0 ? _a : item === null || item === void 0 ? void 0 : item.despacho_id;
        if (raw != null && raw !== '') {
            const id = String(raw).trim();
            if (id) {
                const row = yield (0, db_1.get)('SELECT id FROM despachos WHERE id = ?', [id]);
                if (row === null || row === void 0 ? void 0 : row.id)
                    return row.id;
            }
        }
        // Fallback automático: si no viene despacho explícito, usar el último despacho del producto de la variante.
        if (!variantId)
            return null;
        const fallback = yield (0, db_1.get)(`SELECT p.ultimo_despacho_id AS despacho_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     WHERE pv.id = ?
     LIMIT 1`, [variantId]);
        const fallbackId = fallback === null || fallback === void 0 ? void 0 : fallback.despacho_id;
        if (!fallbackId)
            return null;
        const exists = yield (0, db_1.get)('SELECT id FROM despachos WHERE id = ?', [fallbackId]);
        return (_b = exists === null || exists === void 0 ? void 0 : exists.id) !== null && _b !== void 0 ? _b : null;
    });
}
function mapPaymentStatus(row) {
    return (row === null || row === void 0 ? void 0 : row.payment_status) === 'pendiente' ? 'pendiente' : 'pagado';
}
const getOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
        const archivedOnly = req.query.archivedOnly === 'true' || req.query.archivedOnly === '1';
        let whereArchived = ' AND (o.archived = 0 OR o.archived IS NULL)';
        if (archivedOnly)
            whereArchived = ' AND o.archived = 1';
        else if (includeArchived)
            whereArchived = '';
        let ordersRow = yield (0, db_1.query)(`
      SELECT o.*, c.business_name AS customer_business_name, c.name AS customer_name
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE 1=1 ${whereArchived}
      ORDER BY o.date DESC
    `);
        const user = req.user;
        if ((user === null || user === void 0 ? void 0 : user.role) === 'CUSTOMER') {
            const { get } = yield Promise.resolve().then(() => __importStar(require('../database/db')));
            const customer = yield get('SELECT id FROM customers WHERE user_id = ?', [user.id]);
            if (customer === null || customer === void 0 ? void 0 : customer.id) {
                ordersRow = ordersRow.filter((o) => o.customer_id === customer.id);
            }
            else {
                ordersRow = [];
            }
        }
        const orderId = req.query.orderId;
        if (orderId) {
            ordersRow = ordersRow.filter((o) => o.id === orderId);
        }
        if (ordersRow.length === 0) {
            return res.json([]);
        }
        const orderIds = ordersRow.map((o) => o.id);
        const placeholders = orderIds.map(() => '?').join(',');
        const itemsRows = yield (0, db_1.query)(`
      SELECT i.order_id, i.variant_id AS variantId, i.despacho_id AS despachoId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment,
             COALESCE(i.sell_as_pack, 0) AS sellAsPack,
             COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayoristaPackSize,
             pc.product_id AS productId,
             COALESCE(pv.sku, p.sku) AS sku,
             p.name AS productName,
             s.size_code AS sizeCode,
             c.name AS colorName,
             COALESCE(d_item.numero_despacho, d_prod.numero_despacho) AS numeroDespacho
      FROM order_items i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN despachos d_item ON d_item.id = i.despacho_id
      LEFT JOIN despachos d_prod ON d_prod.id = p.ultimo_despacho_id
      WHERE i.order_id IN (${placeholders})
    `, orderIds);
        const itemsByOrderId = {};
        for (const o of ordersRow) {
            itemsByOrderId[o.id] = [];
        }
        for (const row of itemsRows) {
            const items = itemsByOrderId[row.order_id];
            if (items) {
                items.push({
                    variantId: row.variantId,
                    productId: row.productId,
                    despachoId: (_a = row.despachoId) !== null && _a !== void 0 ? _a : undefined,
                    quantity: row.quantity,
                    picked: (_b = row.picked) !== null && _b !== void 0 ? _b : 0,
                    priceAtMoment: Number(row.priceAtMoment),
                    sellAsPack: !!(row.sellAsPack),
                    mayoristaPackSize: row.mayoristaPackSize != null ? Number(row.mayoristaPackSize) : 1,
                    sku: (_c = row.sku) !== null && _c !== void 0 ? _c : undefined,
                    productName: (_d = row.productName) !== null && _d !== void 0 ? _d : undefined,
                    sizeCode: (_e = row.sizeCode) !== null && _e !== void 0 ? _e : undefined,
                    colorName: (_f = row.colorName) !== null && _f !== void 0 ? _f : undefined,
                    numeroDespacho: (_h = (_g = row.numeroDespacho) !== null && _g !== void 0 ? _g : row.numero_despacho) !== null && _h !== void 0 ? _h : undefined
                });
            }
        }
        const invoicesRows = yield (0, db_1.query)(`SELECT order_id, cae, cae_fch_vto, punto_venta, cbte_desde, cbte_hasta, cbte_tipo, created_at FROM invoices WHERE order_id IN (${placeholders})`, orderIds);
        const invoiceByOrderId = {};
        for (const inv of invoicesRows) {
            invoiceByOrderId[inv.order_id] = {
                cae: inv.cae,
                caeFchVto: (_j = inv.cae_fch_vto) !== null && _j !== void 0 ? _j : undefined,
                puntoVta: (_k = inv.punto_venta) !== null && _k !== void 0 ? _k : undefined,
                cbteDesde: inv.cbte_desde,
                cbteHasta: inv.cbte_hasta,
                cbteTipo: inv.cbte_tipo,
                createdAt: inv.created_at ? new Date(inv.created_at).toISOString() : undefined
            };
        }
        let creditNotesCountByOrderId = {};
        let creditNotesTotalByOrderId = {};
        let creditNotesItemByOrderId = {};
        try {
            const cnRows = yield (0, db_1.query)(`SELECT order_id,
                COUNT(*) AS cnt,
                SUM(CASE WHEN scope = 'total' THEN 1 ELSE 0 END) AS total_cnt,
                SUM(CASE WHEN scope = 'item' THEN 1 ELSE 0 END) AS item_cnt
         FROM credit_notes
         WHERE order_id IN (${placeholders})
         GROUP BY order_id`, orderIds);
            for (const r of cnRows) {
                creditNotesCountByOrderId[r.order_id] = Number(r.cnt) || 0;
                creditNotesTotalByOrderId[r.order_id] = Number(r.total_cnt) || 0;
                creditNotesItemByOrderId[r.order_id] = Number(r.item_cnt) || 0;
            }
        }
        catch (_) {
            // Tabla credit_notes puede no existir en DB antiguas
        }
        const ordersFull = ordersRow.map((order) => {
            var _a, _b, _c, _d, _e, _f, _g;
            return ({
                id: order.id,
                customerId: order.customer_id,
                customerBusinessName: (_b = (_a = order.customer_business_name) !== null && _a !== void 0 ? _a : order.customer_name) !== null && _b !== void 0 ? _b : undefined,
                sellerId: order.seller_id,
                date: order.date,
                status: order.status,
                total: Number(order.total),
                pickedBy: (_c = order.picked_by) !== null && _c !== void 0 ? _c : undefined,
                dispatchedAt: order.dispatched_at ? new Date(order.dispatched_at).toISOString() : undefined,
                archived: !!(order.archived),
                items: itemsByOrderId[order.id] || [],
                invoice: (_d = invoiceByOrderId[order.id]) !== null && _d !== void 0 ? _d : undefined,
                creditNotesCount: (_e = creditNotesCountByOrderId[order.id]) !== null && _e !== void 0 ? _e : 0,
                creditNotesTotalCount: (_f = creditNotesTotalByOrderId[order.id]) !== null && _f !== void 0 ? _f : 0,
                creditNotesItemCount: (_g = creditNotesItemByOrderId[order.id]) !== null && _g !== void 0 ? _g : 0,
                paymentStatus: mapPaymentStatus(order),
                noStockImpact: !!order.no_stock_impact
            });
        });
        res.json(ordersFull);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error fetching orders" });
    }
});
exports.getOrders = getOrders;
const createOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const newOrder = req.body;
    if (!newOrder.customerId || !newOrder.items.length) {
        return res.status(400).json({ message: "Datos de pedido inválidos" });
    }
    const user = req.user;
    let sellerId = (_a = newOrder.sellerId) !== null && _a !== void 0 ? _a : null;
    if ((user === null || user === void 0 ? void 0 : user.role) === 'CUSTOMER') {
        const { get } = yield Promise.resolve().then(() => __importStar(require('../database/db')));
        const customer = yield get('SELECT id FROM customers WHERE user_id = ?', [user.id]);
        if (!customer || customer.id !== newOrder.customerId) {
            return res.status(403).json({ message: 'Como cliente directo solo podés crear pedidos para tu propio perfil' });
        }
        sellerId = null;
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
        const paymentStatus = newOrder.paymentStatus === 'pagado' || newOrder.paymentStatus === 'PAGADO' ? 'pagado' : 'pendiente';
        const noStockImpact = newOrder.noStockImpact === true || newOrder.no_stock_impact === 1 ? 1 : 0;
        yield (0, db_1.execute)(`INSERT INTO orders (id, customer_id, seller_id, date, status, total, payment_status, no_stock_impact) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [orderId, newOrder.customerId, sellerId, sqlDate, newOrder.status, newOrder.total, paymentStatus, noStockImpact]);
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
            const sellAsPack = item.sellAsPack === true || item.sellAsPack === 1 ? 1 : 0;
            const despachoId = yield resolveDespachoIdForItem(item, variantId);
            yield (0, db_1.execute)(`INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment, sell_as_pack, despacho_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [(0, uuid_1.v4)(), orderId, variantId, item.quantity, 0, (_b = item.priceAtMoment) !== null && _b !== void 0 ? _b : 0, sellAsPack, despachoId]);
        }
        if (newOrder.status === 'Confirmado' && !noStockImpact) {
            const { deductStockForOrder } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
            const result = yield deductStockForOrder(orderId);
            if (!result.success)
                console.error('Errores descontando stock al crear pedido confirmado:', result.errors);
        }
        const created = yield (0, db_1.get)('SELECT id, customer_id, seller_id, date, status, total, picked_by, dispatched_at, payment_status, no_stock_impact FROM orders WHERE id = ?', [orderId]);
        if (!created)
            return res.status(201).json(Object.assign(Object.assign({}, newOrder), { id: orderId, paymentStatus }));
        const items = yield (0, db_1.query)(`
      SELECT i.variant_id AS variantId, i.despacho_id AS despachoId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment,
             COALESCE(i.sell_as_pack, 0) AS sellAsPack, COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayoristaPackSize,
             pc.product_id AS productId,
             COALESCE(pv.sku, p.sku) AS sku, p.name AS productName, s.size_code AS sizeCode, c.name AS colorName,
             COALESCE(d_item.numero_despacho, d_prod.numero_despacho) AS numeroDespacho
      FROM order_items i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN despachos d_item ON d_item.id = i.despacho_id
      LEFT JOIN despachos d_prod ON d_prod.id = p.ultimo_despacho_id
      WHERE i.order_id = ?
    `, [orderId]);
        const itemsMapped = items.map((row) => {
            var _a, _b, _c, _d, _e, _f, _g;
            return ({
                variantId: row.variantId,
                productId: row.productId,
                despachoId: (_a = row.despachoId) !== null && _a !== void 0 ? _a : undefined,
                quantity: row.quantity,
                picked: (_b = row.picked) !== null && _b !== void 0 ? _b : 0,
                priceAtMoment: Number(row.priceAtMoment),
                sellAsPack: !!(row.sellAsPack),
                mayoristaPackSize: row.mayoristaPackSize != null ? Number(row.mayoristaPackSize) : 1,
                sku: (_c = row.sku) !== null && _c !== void 0 ? _c : undefined,
                productName: (_d = row.productName) !== null && _d !== void 0 ? _d : undefined,
                sizeCode: (_e = row.sizeCode) !== null && _e !== void 0 ? _e : undefined,
                colorName: (_f = row.colorName) !== null && _f !== void 0 ? _f : undefined,
                numeroDespacho: (_g = row.numeroDespacho) !== null && _g !== void 0 ? _g : undefined
            });
        });
        const orderResponse = {
            id: created.id,
            customerId: created.customer_id,
            sellerId: created.seller_id,
            date: created.date,
            status: created.status,
            total: Number(created.total),
            pickedBy: (_c = created.picked_by) !== null && _c !== void 0 ? _c : undefined,
            dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
            items: itemsMapped,
            paymentStatus: mapPaymentStatus(created),
            noStockImpact: !!created.no_stock_impact
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
        const currentOrder = yield (0, db_1.get)("SELECT status, no_stock_impact FROM orders WHERE id = ?", [id]);
        const previousStatus = currentOrder === null || currentOrder === void 0 ? void 0 : currentOrder.status;
        const noStockImpact = !!(currentOrder === null || currentOrder === void 0 ? void 0 : currentOrder.no_stock_impact);
        // Si pasa de Borrador a Confirmado, descontar stock
        if (previousStatus === 'Borrador' && status === 'Confirmado' && !noStockImpact) {
            const { deductStockForOrder } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
            const result = yield deductStockForOrder(id);
            if (!result.success) {
                console.error('Errores descontando stock:', result.errors);
            }
        }
        // Si se cancela un pedido que ya tenía stock descontado, restaurar stock (todos los estados salvo Borrador y Despachado)
        const hadStockDeducted = !noStockImpact && ['Confirmado', 'Preparando', 'Preparación', 'Falta controlar', 'Controlado'].includes(previousStatus);
        if (status === 'Cancelado' && hadStockDeducted) {
            const { restoreStockForOrder } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
            const result = yield restoreStockForOrder(id);
            if (!result.success) {
                console.error('Errores restaurando stock:', result.errors);
            }
        }
        // Documentar quién prepara/despacha y cuándo
        if ((status === 'Preparando' || status === 'Preparación') && pickedBy) {
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
    var _a, _b, _c;
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
        const sellerId = (_b = updated.sellerId) !== null && _b !== void 0 ? _b : null;
        const paymentStatus = updated.paymentStatus === 'pagado' || updated.paymentStatus === 'PAGADO' ? 'pagado' : 'pendiente';
        const noStockImpact = updated.noStockImpact === true || updated.no_stock_impact === 1 ? 1 : 0;
        yield (0, db_1.execute)('UPDATE orders SET customer_id = ?, seller_id = ?, date = ?, status = ?, total = ?, payment_status = ?, no_stock_impact = ? WHERE id = ?', [updated.customerId, sellerId, sqlDate, updated.status, updated.total, paymentStatus, noStockImpact, id]);
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
            const sellAsPack = item.sellAsPack === true || item.sellAsPack === 1 ? 1 : 0;
            const despachoId = yield resolveDespachoIdForItem(item, variantId);
            yield (0, db_1.execute)("INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment, sell_as_pack, despacho_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [(0, uuid_1.v4)(), id, variantId, item.quantity, item.picked || 0, item.priceAtMoment, sellAsPack, despachoId]);
        }
        const created = yield (0, db_1.get)('SELECT id, customer_id, seller_id, date, status, total, picked_by, dispatched_at, payment_status, no_stock_impact FROM orders WHERE id = ?', [id]);
        if (!created)
            return res.json(Object.assign(Object.assign({}, updated), { id }));
        const itemsRows = yield (0, db_1.query)(`
      SELECT i.variant_id AS variantId, i.despacho_id AS despachoId, i.quantity, i.picked, i.price_at_moment AS priceAtMoment,
             COALESCE(i.sell_as_pack, 0) AS sellAsPack, COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayoristaPackSize,
             pc.product_id AS productId,
             COALESCE(pv.sku, p.sku) AS sku, p.name AS productName, s.size_code AS sizeCode, c.name AS colorName,
             COALESCE(d_item.numero_despacho, d_prod.numero_despacho) AS numeroDespacho
      FROM order_items i
      JOIN product_variants pv ON pv.id = i.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN despachos d_item ON d_item.id = i.despacho_id
      LEFT JOIN despachos d_prod ON d_prod.id = p.ultimo_despacho_id
      WHERE i.order_id = ?
    `, [id]);
        const itemsMapped = itemsRows.map((row) => {
            var _a, _b, _c, _d, _e, _f, _g;
            return ({
                variantId: row.variantId,
                productId: row.productId,
                despachoId: (_a = row.despachoId) !== null && _a !== void 0 ? _a : undefined,
                quantity: row.quantity,
                picked: (_b = row.picked) !== null && _b !== void 0 ? _b : 0,
                priceAtMoment: Number(row.priceAtMoment),
                sellAsPack: !!(row.sellAsPack),
                mayoristaPackSize: row.mayoristaPackSize != null ? Number(row.mayoristaPackSize) : 1,
                sku: (_c = row.sku) !== null && _c !== void 0 ? _c : undefined,
                productName: (_d = row.productName) !== null && _d !== void 0 ? _d : undefined,
                sizeCode: (_e = row.sizeCode) !== null && _e !== void 0 ? _e : undefined,
                colorName: (_f = row.colorName) !== null && _f !== void 0 ? _f : undefined,
                numeroDespacho: (_g = row.numeroDespacho) !== null && _g !== void 0 ? _g : undefined
            });
        });
        res.json({
            id: created.id,
            customerId: created.customer_id,
            sellerId: created.seller_id,
            date: created.date,
            status: created.status,
            total: Number(created.total),
            pickedBy: (_c = created.picked_by) !== null && _c !== void 0 ? _c : undefined,
            dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
            items: itemsMapped,
            paymentStatus: mapPaymentStatus(created),
            noStockImpact: !!created.no_stock_impact
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error actualizando pedido" });
    }
});
exports.updateOrder = updateOrder;
/** Marca cobro del pedido (pendiente / pagado) sin reenviar ítems. */
const patchOrderPaymentStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const { id } = req.params;
    const user = req.user;
    if (!user || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(user.role)) {
        return res.status(403).json({ message: 'Sin permiso para modificar cobranza' });
    }
    const raw = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.paymentStatus) !== null && _b !== void 0 ? _b : (_c = req.body) === null || _c === void 0 ? void 0 : _c.payment_status;
    const paymentStatus = raw === 'pagado' || raw === 'PAGADO' ? 'pagado' : 'pendiente';
    if (!id)
        return res.status(400).json({ message: 'ID inválido' });
    try {
        const row = yield (0, db_1.get)('SELECT id FROM orders WHERE id = ?', [id]);
        if (!row)
            return res.status(404).json({ message: 'Pedido no encontrado' });
        if (user.role === 'SELLER') {
            const ord = yield (0, db_1.get)('SELECT customer_id FROM orders WHERE id = ?', [id]);
            const cust = (ord === null || ord === void 0 ? void 0 : ord.customer_id)
                ? yield (0, db_1.get)('SELECT seller_id FROM customers WHERE id = ?', [ord.customer_id])
                : null;
            if ((cust === null || cust === void 0 ? void 0 : cust.seller_id) && cust.seller_id !== user.id) {
                return res.status(403).json({ message: 'Solo podés modificar pedidos de tus clientes' });
            }
        }
        yield (0, db_1.execute)('UPDATE orders SET payment_status = ? WHERE id = ?', [paymentStatus, id]);
        res.json({ id, paymentStatus });
    }
    catch (error) {
        console.error('patchOrderPaymentStatus:', error);
        res.status(500).json({ message: 'Error actualizando estado de cobro' });
    }
});
exports.patchOrderPaymentStatus = patchOrderPaymentStatus;
/** Archiva o desarchiva un pedido (ocultar/mostrar en lista). */
const archiveOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const { id } = req.params;
    const archived = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.archived) === true || ((_b = req.body) === null || _b === void 0 ? void 0 : _b.archived) === 1;
    if (!id)
        return res.status(400).json({ message: "ID de pedido inválido" });
    try {
        const row = yield (0, db_1.get)("SELECT id FROM orders WHERE id = ?", [id]);
        if (!row)
            return res.status(404).json({ message: "Pedido no encontrado" });
        yield (0, db_1.execute)("UPDATE orders SET archived = ? WHERE id = ?", [archived ? 1 : 0, id]);
        res.json({ id, archived });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error actualizando archivado del pedido" });
    }
});
exports.archiveOrder = archiveOrder;
const deleteOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ message: "ID inválido" });
    try {
        const hasInvoice = yield (0, db_1.get)("SELECT id FROM invoices WHERE order_id = ?", [id]);
        if (hasInvoice) {
            return res.status(400).json({
                message: "No se puede eliminar un pedido que tiene factura emitida. La factura sigue vigente en AFIP. Para anular el efecto fiscal emití una nota de crédito."
            });
        }
        const currentOrder = yield (0, db_1.get)("SELECT status, no_stock_impact FROM orders WHERE id = ?", [id]);
        const status = currentOrder === null || currentOrder === void 0 ? void 0 : currentOrder.status;
        const hadStockDeducted = !(currentOrder === null || currentOrder === void 0 ? void 0 : currentOrder.no_stock_impact) &&
            ['Confirmado', 'Preparando', 'Preparación', 'Falta controlar', 'Controlado'].includes(status);
        if (hadStockDeducted) {
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
/** Obtiene la factura AFIP asociada a un pedido (si existe). */
const getOrderInvoice = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ message: 'ID de pedido inválido' });
    try {
        const inv = yield (0, db_1.get)('SELECT id, order_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, created_at FROM invoices WHERE order_id = ?', [id]);
        if (!inv)
            return res.status(404).json({ message: 'Este pedido no tiene factura emitida' });
        res.json({
            id: inv.id,
            orderId: inv.order_id,
            cae: inv.cae,
            caeFchVto: (_a = inv.cae_fch_vto) !== null && _a !== void 0 ? _a : undefined,
            puntoVta: inv.punto_venta,
            cbteTipo: inv.cbte_tipo,
            cbteDesde: inv.cbte_desde,
            cbteHasta: inv.cbte_hasta,
            createdAt: inv.created_at
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error obteniendo factura' });
    }
});
exports.getOrderInvoice = getOrderInvoice;
/** Emite factura electrónica AFIP para un pedido. Solo ADMIN o WAREHOUSE. */
const emitirFactura = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const { id } = req.params;
    const user = req.user;
    if (!user || (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE' && user.role !== 'DEPOSITO')) {
        return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir facturas' });
    }
    if (!id)
        return res.status(400).json({ message: 'ID de pedido inválido' });
    try {
        const orderRow = yield (0, db_1.get)('SELECT id, customer_id, date, total, no_stock_impact FROM orders WHERE id = ?', [id]);
        if (!orderRow)
            return res.status(404).json({ message: 'Pedido no encontrado' });
        const noStockImpact = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.noStockImpact) === true || ((_b = req.body) === null || _b === void 0 ? void 0 : _b.no_stock_impact) === 1;
        if (noStockImpact && !orderRow.no_stock_impact) {
            yield (0, db_1.execute)('UPDATE orders SET no_stock_impact = 1 WHERE id = ?', [id]);
        }
        const existingInv = yield (0, db_1.get)('SELECT id FROM invoices WHERE order_id = ?', [id]);
        if (existingInv)
            return res.status(409).json({ message: 'Este pedido ya tiene una factura emitida', invoiceId: existingInv.id });
        const customerRow = yield (0, db_1.get)('SELECT id, business_name, cuit, condicion_iva FROM customers WHERE id = ?', [orderRow.customer_id]);
        if (!customerRow)
            return res.status(400).json({ message: 'Cliente del pedido no encontrado' });
        const cbteTipoFromBody = (_c = req.body) === null || _c === void 0 ? void 0 : _c.cbteTipo;
        const forceCbteTipo = (cbteTipoFromBody === 1 || cbteTipoFromBody === 6) ? cbteTipoFromBody : undefined;
        const { emitirFactura: emitirAfip } = yield Promise.resolve().then(() => __importStar(require('../services/afip.service')));
        const result = yield emitirAfip({ id: orderRow.id, date: orderRow.date, total: Number(orderRow.total), customerId: orderRow.customer_id }, {
            id: customerRow.id,
            businessName: (_d = customerRow.business_name) !== null && _d !== void 0 ? _d : '',
            cuit: customerRow.cuit,
            condicionIva: (_e = customerRow.condicion_iva) !== null && _e !== void 0 ? _e : null
        }, forceCbteTipo);
        const { v4: uuidv4 } = yield Promise.resolve().then(() => __importStar(require('uuid')));
        const invoiceId = uuidv4();
        yield (0, db_1.execute)(`INSERT INTO invoices (id, order_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [invoiceId, id, result.cae, result.caeFchVto || null, result.puntoVta, result.cbteTipo, result.cbteDesde, result.cbteHasta]);
        res.status(201).json({
            id: invoiceId,
            orderId: id,
            cae: result.cae,
            caeFchVto: result.caeFchVto,
            puntoVta: result.puntoVta,
            cbteTipo: result.cbteTipo,
            cbteDesde: result.cbteDesde,
            cbteHasta: result.cbteHasta
        });
    }
    catch (error) {
        console.error('emitirFactura:', error);
        const msg = (error === null || error === void 0 ? void 0 : error.message) || 'Error emitiendo factura AFIP';
        const status = msg.includes('no configurado') ? 503 : msg.includes('ya tiene') ? 409 : 500;
        res.status(status).json({ message: msg });
    }
});
exports.emitirFactura = emitirFactura;
/** Lista las notas de crédito emitidas para un pedido. */
const getOrderCreditNotes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ message: 'ID de pedido inválido' });
    try {
        const rows = yield (0, db_1.query)(`SELECT id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index, created_at
       FROM credit_notes WHERE order_id = ? ORDER BY created_at DESC`, [id]);
        res.json(rows.map((r) => {
            var _a, _b, _c;
            return ({
                id: r.id,
                orderId: r.order_id,
                invoiceId: r.invoice_id,
                cae: r.cae,
                caeFchVto: (_a = r.cae_fch_vto) !== null && _a !== void 0 ? _a : undefined,
                puntoVta: r.punto_venta,
                cbteTipo: r.cbte_tipo,
                cbteDesde: r.cbte_desde,
                cbteHasta: r.cbte_hasta,
                amountCredited: Number(r.amount_credited),
                scope: (_b = r.scope) !== null && _b !== void 0 ? _b : 'total',
                itemIndex: (_c = r.item_index) !== null && _c !== void 0 ? _c : undefined,
                createdAt: r.created_at
            });
        }));
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error listando notas de crédito' });
    }
});
exports.getOrderCreditNotes = getOrderCreditNotes;
/** Emite una Nota de Crédito AFIP: todo el pedido o un ítem. Solo ADMIN/WAREHOUSE/DEPOSITO. */
const emitirNotaCredito = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const { id } = req.params;
    const user = req.user;
    if (!user || (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE' && user.role !== 'DEPOSITO')) {
        return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir notas de crédito' });
    }
    if (!id)
        return res.status(400).json({ message: 'ID de pedido inválido' });
    const { tipo, itemIndex, quantity } = req.body || {};
    if (!tipo || (tipo !== 'total' && tipo !== 'item')) {
        return res.status(400).json({ message: 'Body debe incluir tipo: "total" o "item"' });
    }
    try {
        const orderRow = yield (0, db_1.get)('SELECT id, customer_id, total FROM orders WHERE id = ?', [id]);
        if (!orderRow)
            return res.status(404).json({ message: 'Pedido no encontrado' });
        const invRow = yield (0, db_1.get)('SELECT id, punto_venta, cbte_tipo, cbte_desde FROM invoices WHERE order_id = ?', [id]);
        if (!invRow)
            return res.status(400).json({ message: 'Este pedido no tiene factura; primero emití la factura.' });
        const customerRow = yield (0, db_1.get)('SELECT id, business_name, cuit, condicion_iva FROM customers WHERE id = ?', [orderRow.customer_id]);
        if (!customerRow)
            return res.status(400).json({ message: 'Cliente del pedido no encontrado' });
        // Validar: si ya existe NC por el total, no se permite ninguna NC más (ni total ni por ítem)
        const existingNCs = yield (0, db_1.query)(`SELECT scope, item_index, amount_credited FROM credit_notes WHERE order_id = ?`, [id]);
        const yaExisteNCTotal = existingNCs.some((r) => (r.scope || 'total') === 'total');
        if (yaExisteNCTotal) {
            return res.status(400).json({
                message: 'Ya existe una nota de crédito por el total de este pedido. No se pueden emitir más notas de crédito.',
            });
        }
        let amountToCredit;
        let creditNoteItemQuantity = null;
        if (tipo === 'total') {
            amountToCredit = Number(orderRow.total) || 0;
            if (amountToCredit <= 0)
                return res.status(400).json({ message: 'El total del pedido debe ser mayor a 0.' });
        }
        else {
            const itemsRows = yield (0, db_1.query)(`SELECT quantity, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id`, [id]);
            const items = itemsRows;
            if (!items.length)
                return res.status(400).json({ message: 'El pedido no tiene ítems.' });
            const idx = typeof itemIndex === 'number' ? itemIndex : parseInt(String(itemIndex), 10);
            if (isNaN(idx) || idx < 0 || idx >= items.length) {
                return res.status(400).json({ message: `itemIndex debe ser entre 0 y ${items.length - 1}` });
            }
            const item = items[idx];
            const qty = quantity != null ? (typeof quantity === 'number' ? quantity : parseInt(String(quantity), 10)) : item.quantity;
            if (isNaN(qty) || qty <= 0 || qty > item.quantity) {
                return res.status(400).json({ message: `quantity debe ser entre 1 y ${item.quantity} para este ítem` });
            }
            creditNoteItemQuantity = qty;
            const price = Number(item.price_at_moment) || 0;
            amountToCredit = Math.round(qty * price * 100) / 100;
            if (amountToCredit <= 0)
                return res.status(400).json({ message: 'El monto a creditar del ítem es 0.' });
            const itemLineTotal = Math.round(Number(item.quantity) * price * 100) / 100;
            const yaCreditadoItem = existingNCs
                .filter((r) => (r.scope || '') === 'item' && r.item_index === idx)
                .reduce((sum, r) => sum + Number(r.amount_credited || 0), 0);
            if (yaCreditadoItem + amountToCredit > itemLineTotal + 0.01) {
                return res.status(400).json({
                    message: `No se puede creditar más de lo facturado para este artículo. Ya creditado: $${yaCreditadoItem.toFixed(2)}. Máximo a creditar para este ítem: $${(itemLineTotal - yaCreditadoItem).toFixed(2)}.`,
                });
            }
        }
        const { emitirNotaCredito: emitirNCAfip } = yield Promise.resolve().then(() => __importStar(require('../services/afip.service')));
        const result = yield emitirNCAfip({ puntoVta: invRow.punto_venta, cbteTipo: invRow.cbte_tipo, cbteDesde: invRow.cbte_desde }, { id: customerRow.id, businessName: (_a = customerRow.business_name) !== null && _a !== void 0 ? _a : '', cuit: customerRow.cuit, condicionIva: (_b = customerRow.condicion_iva) !== null && _b !== void 0 ? _b : undefined }, amountToCredit);
        const creditNoteId = (0, uuid_1.v4)();
        const scope = tipo;
        const itemIndexVal = tipo === 'item' ? (typeof itemIndex === 'number' ? itemIndex : parseInt(String(itemIndex), 10)) : null;
        yield (0, db_1.execute)(`INSERT INTO credit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [creditNoteId, id, invRow.id, result.cae, result.caeFchVto || null, result.puntoVta, result.cbteTipo, result.cbteDesde, result.cbteHasta, amountToCredit, scope, itemIndexVal]);
        if (scope === 'total') {
            const stockResult = yield (0, stock_controller_1.restoreStockForOrder)(id);
            if (!stockResult.success) {
                return res.status(500).json({ message: 'Error actualizando stock después de la nota de crédito total', errors: stockResult.errors });
            }
        }
        else if (scope === 'item' && typeof itemIndexVal === 'number') {
            const stockResult = yield (0, stock_controller_1.restoreStockForOrderItem)(id, itemIndexVal, creditNoteItemQuantity !== null && creditNoteItemQuantity !== void 0 ? creditNoteItemQuantity : undefined);
            if (!stockResult.success) {
                return res.status(500).json({ message: 'Error actualizando stock después de la nota de crédito parcial', errors: stockResult.errors });
            }
        }
        res.status(201).json({
            id: creditNoteId,
            orderId: id,
            invoiceId: invRow.id,
            cae: result.cae,
            caeFchVto: result.caeFchVto,
            puntoVta: result.puntoVta,
            cbteTipo: result.cbteTipo,
            cbteDesde: result.cbteDesde,
            cbteHasta: result.cbteHasta,
            amountCredited: amountToCredit
        });
    }
    catch (error) {
        console.error('emitirNotaCredito:', error);
        const msg = (error === null || error === void 0 ? void 0 : error.message) || 'Error emitiendo nota de crédito AFIP';
        const status = msg.includes('no configurado') ? 503 : 500;
        res.status(status).json({ message: msg });
    }
});
exports.emitirNotaCredito = emitirNotaCredito;
