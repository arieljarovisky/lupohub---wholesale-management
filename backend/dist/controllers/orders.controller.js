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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignDespachosToOrderItems = exports.getOrderItemsMissingDespacho = exports.assignRemitoNumber = exports.exportTopWholesaleProductsMetricsXlsx = exports.emitirNotaCredito = exports.getOrderCreditNotes = exports.emitirFactura = exports.getOrderInvoice = exports.deleteOrder = exports.archiveOrder = exports.applyMayoristaStockDeduction = exports.patchOrderPaymentStatus = exports.updateOrder = exports.updateOrderStatus = exports.createOrder = exports.getOrders = void 0;
const db_1 = require("../database/db");
const exceljs_1 = __importDefault(require("exceljs"));
const stock_controller_1 = require("./stock.controller");
const uuid_1 = require("uuid");
function getProductIdForVariant(variantId) {
    return __awaiter(this, void 0, void 0, function* () {
        const row = yield (0, db_1.get)(`SELECT pc.product_id AS product_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     WHERE pv.id = ?
     LIMIT 1`, [variantId]);
        return (row === null || row === void 0 ? void 0 : row.product_id) || null;
    });
}
function allocateOldestDespachosForVariant(variantId, requestedQty) {
    return __awaiter(this, void 0, void 0, function* () {
        const qty = Math.max(0, Math.floor(Number(requestedQty) || 0));
        if (qty <= 0)
            return [];
        const productId = yield getProductIdForVariant(variantId);
        if (!productId)
            return [{ despachoId: null, quantity: qty }];
        const variantRows = yield (0, db_1.query)(`SELECT
       di.despacho_id AS despachoId,
       COALESCE(di.cantidad, 0) AS totalIngresado,
       COALESCE(used.totalAsignado, 0) AS totalAsignado
     FROM despacho_items di
     JOIN despachos d ON d.id = di.despacho_id
     LEFT JOIN (
       SELECT oi.despacho_id, oi.variant_id, SUM(oi.quantity) AS totalAsignado
       FROM order_items oi
       WHERE oi.despacho_id IS NOT NULL
       GROUP BY oi.despacho_id, oi.variant_id
     ) used ON used.despacho_id = di.despacho_id AND used.variant_id = di.variant_id
     WHERE di.variant_id = ?
     ORDER BY d.fecha_despacho ASC, d.created_at ASC, di.created_at ASC`, [variantId]);
        const rows = variantRows.length > 0 ? variantRows : yield (0, db_1.query)(`SELECT
       di.despacho_id AS despachoId,
       COALESCE(di.cantidad, 0) AS totalIngresado,
       COALESCE(used.totalAsignado, 0) AS totalAsignado
     FROM despacho_items di
     JOIN despachos d ON d.id = di.despacho_id
     LEFT JOIN (
       SELECT oi.despacho_id, pc.product_id, SUM(oi.quantity) AS totalAsignado
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       WHERE oi.despacho_id IS NOT NULL
       GROUP BY oi.despacho_id, pc.product_id
     ) used ON used.despacho_id = di.despacho_id AND used.product_id = di.product_id
     WHERE di.product_id = ? AND di.variant_id IS NULL
     ORDER BY d.fecha_despacho ASC, d.created_at ASC, di.created_at ASC`, [productId]);
        const out = [];
        let remaining = qty;
        for (const r of rows) {
            if (remaining <= 0)
                break;
            const available = Math.max(0, Number(r.totalIngresado || 0) - Number(r.totalAsignado || 0));
            if (available <= 0)
                continue;
            const take = Math.min(remaining, available);
            out.push({ despachoId: r.despachoId, quantity: take });
            remaining -= take;
        }
        if (remaining > 0) {
            out.push({ despachoId: null, quantity: remaining });
        }
        return out;
    });
}
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
/**
 * Devuelve una descripción legible de un artículo (nombre + talle + color + SKU) para mostrar
 * en avisos al usuario. Si el item ya trae `sku`/`productName` desde el frontend se usan,
 * y si faltan campos los completa consultando la variante por `variantId`.
 */
function getItemLabelForWarning(item, variantId) {
    return __awaiter(this, void 0, void 0, function* () {
        const fromItemName = String((item === null || item === void 0 ? void 0 : item.productName) || '').trim();
        const fromItemSku = String((item === null || item === void 0 ? void 0 : item.sku) || '').trim();
        const fromItemSize = String((item === null || item === void 0 ? void 0 : item.sizeCode) || '').trim();
        const fromItemColor = String((item === null || item === void 0 ? void 0 : item.colorName) || (item === null || item === void 0 ? void 0 : item.colorCode) || '').trim();
        let name = fromItemName;
        let sku = fromItemSku;
        let size = fromItemSize;
        let color = fromItemColor;
        if (!name || !sku || !size || !color) {
            const row = yield (0, db_1.get)(`SELECT p.name AS productName,
              COALESCE(pv.sku, p.sku) AS sku,
              s.size_code AS sizeCode,
              c.name AS colorName
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN sizes s ON s.id = pv.size_id
       LEFT JOIN colors c ON c.id = pc.color_id
       WHERE pv.id = ?
       LIMIT 1`, [variantId]);
            if (row) {
                if (!name)
                    name = String(row.productName || '').trim();
                if (!sku)
                    sku = String(row.sku || '').trim();
                if (!size)
                    size = String(row.sizeCode || '').trim();
                if (!color)
                    color = String(row.colorName || '').trim();
            }
        }
        const base = name || sku;
        if (!base)
            return variantId;
        const extras = [size, color].filter(Boolean).join(' / ');
        const skuSuffix = sku && sku !== base ? ` [${sku}]` : '';
        return extras ? `${base} (${extras})${skuSuffix}` : `${base}${skuSuffix}`;
    });
}
/** Neto gravado = Σ (cantidad × precio unitario) en order_items; alinea factura AFIP con el detalle de líneas. */
function getOrderNetFromLineItems(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield (0, db_1.query)(`SELECT quantity, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id`, [orderId]);
        let sum = 0;
        for (const r of rows) {
            const qty = Number(r.quantity) || 0;
            const price = Number(r.price_at_moment) || 0;
            sum += Math.round(qty * price * 100) / 100;
        }
        return Math.round(sum * 100) / 100;
    });
}
function getAgipRetentionForOrder(args) {
    return __awaiter(this, void 0, void 0, function* () {
        const cuit = String(args.customerCuit || '').replace(/\D/g, '').slice(0, 11);
        if (cuit.length !== 11)
            return null;
        const period = String(args.orderDate || '').slice(0, 7).replace('-', '');
        if (!/^\d{6}$/.test(period))
            return null;
        const row = yield (0, db_1.get)(`SELECT alicuota
     FROM agip_padron_alicuotas
     WHERE period_yyyymm = ? AND cuit = ?
     LIMIT 1`, [period, cuit]);
        const alicuota = Number((row === null || row === void 0 ? void 0 : row.alicuota) || 0);
        if (!(alicuota > 0))
            return null;
        const net = Math.max(0, Number(args.netAmount) || 0);
        const amount = Math.round(net * (alicuota / 100) * 100) / 100;
        return { alicuota, amount };
    });
}
const getOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        const user = req.user;
        const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
        const archivedOnly = req.query.archivedOnly === 'true' || req.query.archivedOnly === '1';
        let whereArchived = ' AND (o.archived = 0 OR o.archived IS NULL)';
        if (archivedOnly)
            whereArchived = ' AND o.archived = 1';
        else if (includeArchived)
            whereArchived = '';
        const whereUserScope = (user === null || user === void 0 ? void 0 : user.role) === 'SELLER' ? ' AND c.seller_id = ?' : '';
        const ordersParams = (user === null || user === void 0 ? void 0 : user.role) === 'SELLER' ? [user.id] : [];
        let ordersRow = yield (0, db_1.query)(`SELECT o.*, c.business_name AS customer_business_name, c.name AS customer_name, c.cuit AS customer_cuit,
              cu.name AS created_by_name, cu.role AS created_by_role,
              su.name AS seller_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users cu ON cu.id = o.created_by
       LEFT JOIN users su ON su.id = o.seller_id
       WHERE 1=1 ${whereArchived}${whereUserScope}
       ORDER BY o.date DESC`, ordersParams);
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
        const invoicesRows = yield (0, db_1.query)(`SELECT order_id, cae, cae_fch_vto, punto_venta, cbte_desde, cbte_hasta, cbte_tipo, created_at, agip_alicuota, agip_ret_per
       FROM invoices
       WHERE order_id IN (${placeholders})`, orderIds);
        const invoiceByOrderId = {};
        for (const inv of invoicesRows) {
            invoiceByOrderId[inv.order_id] = {
                cae: inv.cae,
                caeFchVto: (_j = inv.cae_fch_vto) !== null && _j !== void 0 ? _j : undefined,
                puntoVta: (_k = inv.punto_venta) !== null && _k !== void 0 ? _k : undefined,
                cbteDesde: inv.cbte_desde,
                cbteHasta: inv.cbte_hasta,
                cbteTipo: inv.cbte_tipo,
                createdAt: inv.created_at ? new Date(inv.created_at).toISOString() : undefined,
                agipAlicuota: Number(inv.agip_alicuota || 0),
                agipRetPer: Number(inv.agip_ret_per || 0)
            };
        }
        // Fallback para facturas antiguas sin retención guardada:
        // recalcular con padrón AGIP del período del pedido para no perder la línea en impresión.
        for (const o of ordersRow) {
            const inv = invoiceByOrderId[o.id];
            if (!inv)
                continue;
            const hasStoredAgip = Number(inv.agipAlicuota || 0) > 0 || Number(inv.agipRetPer || 0) > 0;
            if (hasStoredAgip)
                continue;
            const calc = yield getAgipRetentionForOrder({
                orderDate: String(o.date || ''),
                customerCuit: o.customer_cuit,
                netAmount: Number(o.total || 0),
            });
            if (calc) {
                inv.agipAlicuota = Number(calc.alicuota || 0);
                inv.agipRetPer = Number(calc.amount || 0);
            }
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
        let mayoristaStockLoaded = false;
        let mayoristaStockAppliedByOrder = {};
        try {
            if (orderIds.length > 0) {
                const refs = orderIds.map((oid) => `Pedido: ${oid}`);
                const rph = refs.map(() => '?').join(',');
                const mRows = yield (0, db_1.query)(`SELECT DISTINCT reference FROM stock_movements
           WHERE movement_type = 'PEDIDO_MAYORISTA' AND reference IN (${rph})`, refs);
                const appliedRefs = new Set(mRows.map((r) => r.reference));
                for (const oid of orderIds) {
                    mayoristaStockAppliedByOrder[oid] = appliedRefs.has(`Pedido: ${oid}`);
                }
                mayoristaStockLoaded = true;
            }
        }
        catch (_) {
            // stock_movements puede no existir en DB antiguas
        }
        const ordersFull = ordersRow.map((order) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
            return ({
                id: order.id,
                customerId: order.customer_id,
                customerBusinessName: (_b = (_a = order.customer_business_name) !== null && _a !== void 0 ? _a : order.customer_name) !== null && _b !== void 0 ? _b : undefined,
                sellerId: order.seller_id,
                createdBy: (_c = order.created_by) !== null && _c !== void 0 ? _c : undefined,
                createdByName: (_d = order.created_by_name) !== null && _d !== void 0 ? _d : undefined,
                createdByRole: (_e = order.created_by_role) !== null && _e !== void 0 ? _e : undefined,
                sellerName: (_f = order.seller_name) !== null && _f !== void 0 ? _f : undefined,
                date: order.date,
                status: order.status,
                total: Number(order.total),
                pickedBy: (_g = order.picked_by) !== null && _g !== void 0 ? _g : undefined,
                dispatchedAt: order.dispatched_at ? new Date(order.dispatched_at).toISOString() : undefined,
                archived: !!(order.archived),
                remitoNumber: order.remito_number != null ? Number(order.remito_number) : undefined,
                items: itemsByOrderId[order.id] || [],
                invoice: (_h = invoiceByOrderId[order.id]) !== null && _h !== void 0 ? _h : undefined,
                creditNotesCount: (_j = creditNotesCountByOrderId[order.id]) !== null && _j !== void 0 ? _j : 0,
                creditNotesTotalCount: (_k = creditNotesTotalByOrderId[order.id]) !== null && _k !== void 0 ? _k : 0,
                creditNotesItemCount: (_l = creditNotesItemByOrderId[order.id]) !== null && _l !== void 0 ? _l : 0,
                paymentStatus: mapPaymentStatus(order),
                noStockImpact: !!order.no_stock_impact,
                mayoristaStockApplied: mayoristaStockLoaded
                    ? mayoristaStockAppliedByOrder[order.id] === true
                    : undefined
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
    var _a, _b, _c, _d, _e, _f, _g, _h;
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
        const despachoWarnings = [];
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
        const createdBy = (_b = user === null || user === void 0 ? void 0 : user.id) !== null && _b !== void 0 ? _b : null;
        const requestedStatus = String(newOrder.status || 'Borrador');
        const shouldStayPendingAdmin = requestedStatus === 'Confirmado' && ((user === null || user === void 0 ? void 0 : user.role) === 'SELLER' || (user === null || user === void 0 ? void 0 : user.role) === 'CUSTOMER');
        const statusToSave = shouldStayPendingAdmin ? 'Pendiente confirmación admin' : requestedStatus;
        yield (0, db_1.execute)(`INSERT INTO orders (id, customer_id, seller_id, date, status, total, payment_status, no_stock_impact, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [orderId, newOrder.customerId, sellerId, sqlDate, statusToSave, newOrder.total, paymentStatus, noStockImpact, createdBy]);
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
            const explicitDespachoId = yield resolveDespachoIdForItem(item, variantId);
            const allocations = explicitDespachoId
                ? [{ despachoId: explicitDespachoId, quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)) }]
                : yield allocateOldestDespachosForVariant(variantId, item.quantity);
            const unassignedQty = allocations
                .filter((a) => !a.despachoId)
                .reduce((sum, a) => sum + (Number(a.quantity) || 0), 0);
            if (unassignedQty > 0) {
                const itemLabel = yield getItemLabelForWarning(item, variantId);
                despachoWarnings.push(`El artículo ${itemLabel} tiene ${unassignedQty} unidad(es) sin despacho.`);
            }
            for (const alloc of allocations) {
                if (!alloc.quantity || alloc.quantity <= 0)
                    continue;
                yield (0, db_1.execute)(`INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment, sell_as_pack, despacho_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [(0, uuid_1.v4)(), orderId, variantId, alloc.quantity, 0, (_c = item.priceAtMoment) !== null && _c !== void 0 ? _c : 0, sellAsPack, alloc.despachoId]);
            }
        }
        // No descontar al confirmar: ahora se descuenta cuando finaliza picking.
        const created = yield (0, db_1.get)(`SELECT o.id, o.customer_id, o.seller_id, o.date, o.status, o.total, o.picked_by, o.dispatched_at, o.payment_status, o.no_stock_impact,
              o.created_by, cu.name AS created_by_name, cu.role AS created_by_role, su.name AS seller_name
       FROM orders o
       LEFT JOIN users cu ON cu.id = o.created_by
       LEFT JOIN users su ON su.id = o.seller_id
       WHERE o.id = ?`, [orderId]);
        if (!created)
            return res.status(201).json(Object.assign(Object.assign({}, newOrder), { id: orderId, paymentStatus, despachoWarnings }));
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
            createdBy: (_d = created.created_by) !== null && _d !== void 0 ? _d : undefined,
            createdByName: (_e = created.created_by_name) !== null && _e !== void 0 ? _e : undefined,
            createdByRole: (_f = created.created_by_role) !== null && _f !== void 0 ? _f : undefined,
            sellerName: (_g = created.seller_name) !== null && _g !== void 0 ? _g : undefined,
            date: created.date,
            status: created.status,
            total: Number(created.total),
            pickedBy: (_h = created.picked_by) !== null && _h !== void 0 ? _h : undefined,
            dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
            items: itemsMapped,
            paymentStatus: mapPaymentStatus(created),
            noStockImpact: !!created.no_stock_impact,
            despachoWarnings
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
    const user = req.user;
    try {
        // Obtener estado anterior
        const currentOrder = yield (0, db_1.get)("SELECT status, no_stock_impact FROM orders WHERE id = ?", [id]);
        const previousStatus = currentOrder === null || currentOrder === void 0 ? void 0 : currentOrder.status;
        const noStockImpact = !!(currentOrder === null || currentOrder === void 0 ? void 0 : currentOrder.no_stock_impact);
        if (!previousStatus)
            return res.status(404).json({ message: 'Pedido no encontrado' });
        const isAdmin = (user === null || user === void 0 ? void 0 : user.role) === 'ADMIN';
        const requestedStatus = String(status || previousStatus);
        const nextStatus = requestedStatus === 'Confirmado' && !isAdmin
            ? 'Pendiente confirmación admin'
            : requestedStatus;
        // Mientras esté pendiente de admin, solo puede cancelarse o confirmarse por ADMIN.
        if (previousStatus === 'Pendiente confirmación admin' &&
            !['Pendiente confirmación admin', 'Confirmado', 'Cancelado'].includes(nextStatus)) {
            return res.status(400).json({
                message: 'El pedido está pendiente de confirmación de admin.'
            });
        }
        // Descontar stock cuando finaliza picking (Falta controlar / Controlado / Despachado).
        const pickingDoneStatuses = ['Falta controlar', 'Controlado', 'Despachado'];
        const entersPickingDone = !pickingDoneStatuses.includes(previousStatus) &&
            pickingDoneStatuses.includes(nextStatus);
        if (entersPickingDone &&
            !noStockImpact &&
            !(yield (0, stock_controller_1.isMayoristaStockDeductedForWholesale)(id))) {
            const { deductStockForOrder } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
            const result = yield deductStockForOrder(id);
            if (!result.success) {
                console.error('Errores descontando stock:', result.errors);
            }
        }
        // Si se cancela y el stock ya estaba descontado de verdad, restaurar.
        const hadStockDeducted = !noStockImpact && (yield (0, stock_controller_1.isMayoristaStockDeductedForWholesale)(id));
        if (nextStatus === 'Cancelado' && hadStockDeducted) {
            const { restoreStockForOrder } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
            const result = yield restoreStockForOrder(id);
            if (!result.success) {
                console.error('Errores restaurando stock:', result.errors);
            }
        }
        // Documentar quién prepara/despacha y cuándo
        if ((nextStatus === 'Preparando' || nextStatus === 'Preparación') && pickedBy) {
            yield (0, db_1.execute)("UPDATE orders SET status = ?, picked_by = ? WHERE id = ?", [nextStatus, pickedBy, id]);
        }
        else if (nextStatus === 'Despachado') {
            yield (0, db_1.execute)("UPDATE orders SET status = ?, picked_by = COALESCE(?, picked_by), dispatched_at = NOW() WHERE id = ?", [nextStatus, pickedBy || null, id]);
        }
        else {
            yield (0, db_1.execute)("UPDATE orders SET status = ? WHERE id = ?", [nextStatus, id]);
        }
        res.json({ id, status: nextStatus, previousStatus });
    }
    catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ message: "Error updating order status" });
    }
});
exports.updateOrderStatus = updateOrderStatus;
const updateOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    const { id } = req.params;
    const updated = req.body;
    if (!id || !updated || !((_a = updated.items) === null || _a === void 0 ? void 0 : _a.length)) {
        return res.status(400).json({ message: "Datos de pedido inválidos" });
    }
    try {
        const despachoWarnings = [];
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
            const explicitDespachoId = yield resolveDespachoIdForItem(item, variantId);
            const allocations = explicitDespachoId
                ? [{ despachoId: explicitDespachoId, quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)) }]
                : yield allocateOldestDespachosForVariant(variantId, item.quantity);
            const unassignedQty = allocations
                .filter((a) => !a.despachoId)
                .reduce((sum, a) => sum + (Number(a.quantity) || 0), 0);
            if (unassignedQty > 0) {
                const itemLabel = yield getItemLabelForWarning(item, variantId);
                despachoWarnings.push(`El artículo ${itemLabel} tiene ${unassignedQty} unidad(es) sin despacho.`);
            }
            let pickedRemaining = Math.max(0, Math.floor(Number(item.picked) || 0));
            for (const alloc of allocations) {
                if (!alloc.quantity || alloc.quantity <= 0)
                    continue;
                const pickedForLine = Math.min(pickedRemaining, alloc.quantity);
                pickedRemaining -= pickedForLine;
                yield (0, db_1.execute)("INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment, sell_as_pack, despacho_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [(0, uuid_1.v4)(), id, variantId, alloc.quantity, pickedForLine, item.priceAtMoment, sellAsPack, alloc.despachoId]);
            }
        }
        const created = yield (0, db_1.get)(`SELECT o.id, o.customer_id, o.seller_id, o.date, o.status, o.total, o.picked_by, o.dispatched_at, o.payment_status, o.no_stock_impact,
              o.created_by, cu.name AS created_by_name, cu.role AS created_by_role, su.name AS seller_name
       FROM orders o
       LEFT JOIN users cu ON cu.id = o.created_by
       LEFT JOIN users su ON su.id = o.seller_id
       WHERE o.id = ?`, [id]);
        if (!created)
            return res.json(Object.assign(Object.assign({}, updated), { id, despachoWarnings }));
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
            createdBy: (_c = created.created_by) !== null && _c !== void 0 ? _c : undefined,
            createdByName: (_d = created.created_by_name) !== null && _d !== void 0 ? _d : undefined,
            createdByRole: (_e = created.created_by_role) !== null && _e !== void 0 ? _e : undefined,
            sellerName: (_f = created.seller_name) !== null && _f !== void 0 ? _f : undefined,
            date: created.date,
            status: created.status,
            total: Number(created.total),
            pickedBy: (_g = created.picked_by) !== null && _g !== void 0 ? _g : undefined,
            dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
            items: itemsMapped,
            paymentStatus: mapPaymentStatus(created),
            noStockImpact: !!created.no_stock_impact,
            despachoWarnings
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
/**
 * Aplica el descuento de stock del pedido mayorista de una (idempotente).
 * Si el pedido está en Borrador, pasa a Confirmado y luego desconta (mismo criterio que al confirmar).
 */
const applyMayoristaStockDeduction = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { id } = req.params;
    const user = req.user;
    if (!user || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(user.role)) {
        return res.status(403).json({ message: 'Sin permiso' });
    }
    if (!id)
        return res.status(400).json({ message: 'ID inválido' });
    try {
        const order = yield (0, db_1.get)('SELECT id, status, no_stock_impact, customer_id FROM orders WHERE id = ?', [id]);
        if (!order)
            return res.status(404).json({ message: 'Pedido no encontrado' });
        if (user.role === 'SELLER') {
            const cust = order.customer_id
                ? yield (0, db_1.get)('SELECT seller_id FROM customers WHERE id = ?', [order.customer_id])
                : null;
            if ((cust === null || cust === void 0 ? void 0 : cust.seller_id) && cust.seller_id !== user.id) {
                return res.status(403).json({ message: 'Solo podés modificar pedidos de tus clientes' });
            }
        }
        if (order.no_stock_impact) {
            return res.status(400).json({ message: 'Este pedido está marcado sin impacto en stock.' });
        }
        if (order.status === 'Cancelado') {
            return res.status(400).json({ message: 'No aplica a pedidos cancelados.' });
        }
        if (yield (0, stock_controller_1.isMayoristaStockDeductedForWholesale)(id)) {
            return res.json({
                id,
                alreadyApplied: true,
                message: 'El stock de este pedido ya estaba descontado.',
            });
        }
        if (order.status === 'Borrador') {
            yield (0, db_1.execute)("UPDATE orders SET status = 'Confirmado' WHERE id = ?", [id]);
        }
        const result = yield (0, stock_controller_1.deductStockForOrder)(id);
        if (!result.success) {
            return res.status(500).json({
                message: 'Error al descontar stock: ' + (((_a = result.errors) === null || _a === void 0 ? void 0 : _a.join(', ')) || 'desconocido'),
                errors: result.errors
            });
        }
        res.json({ id, success: true, message: 'Stock descontado correctamente.' });
    }
    catch (error) {
        console.error('applyMayoristaStockDeduction:', error);
        res.status(500).json({ message: (error === null || error === void 0 ? void 0 : error.message) || 'Error al descontar stock' });
    }
});
exports.applyMayoristaStockDeduction = applyMayoristaStockDeduction;
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
        const hadStockDeducted = !(currentOrder === null || currentOrder === void 0 ? void 0 : currentOrder.no_stock_impact) &&
            (yield (0, stock_controller_1.isMayoristaStockDeductedForWholesale)(id));
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
    var _a, _b, _c;
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ message: 'ID de pedido inválido' });
    try {
        const inv = yield (0, db_1.get)(`SELECT i.id, i.order_id, i.cae, i.cae_fch_vto, i.punto_venta, i.cbte_tipo, i.cbte_desde, i.cbte_hasta, i.created_at,
              i.agip_alicuota, i.agip_ret_per,
              o.total AS order_total, o.date AS order_date, c.cuit AS customer_cuit
       FROM invoices i
       JOIN orders o ON o.id = i.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE i.order_id = ?`, [id]);
        if (!inv)
            return res.status(404).json({ message: 'Este pedido no tiene factura emitida' });
        const hasStoredAgip = Number(inv.agip_alicuota || 0) > 0 || Number(inv.agip_ret_per || 0) > 0;
        let agip = { alicuota: Number(inv.agip_alicuota || 0), amount: Number(inv.agip_ret_per || 0) };
        if (!hasStoredAgip) {
            const netFromItems = yield getOrderNetFromLineItems(id);
            const netAmount = netFromItems > 0 ? netFromItems : Number(inv.order_total || 0);
            const calc = yield getAgipRetentionForOrder({
                orderDate: String(inv.order_date || inv.created_at || ''),
                customerCuit: inv.customer_cuit,
                netAmount
            });
            agip = { alicuota: (_a = calc === null || calc === void 0 ? void 0 : calc.alicuota) !== null && _a !== void 0 ? _a : 0, amount: (_b = calc === null || calc === void 0 ? void 0 : calc.amount) !== null && _b !== void 0 ? _b : 0 };
        }
        res.json({
            id: inv.id,
            orderId: inv.order_id,
            cae: inv.cae,
            caeFchVto: (_c = inv.cae_fch_vto) !== null && _c !== void 0 ? _c : undefined,
            puntoVta: inv.punto_venta,
            cbteTipo: inv.cbte_tipo,
            cbteDesde: inv.cbte_desde,
            cbteHasta: inv.cbte_hasta,
            createdAt: inv.created_at,
            agipAlicuota: agip.alicuota,
            agipRetPer: agip.amount
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
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
        const netFromItems = yield getOrderNetFromLineItems(id);
        const totalForAfip = netFromItems > 0 ? netFromItems : Number(orderRow.total);
        const { emitirFactura: emitirAfip } = yield Promise.resolve().then(() => __importStar(require('../services/afip.service')));
        const result = yield emitirAfip({ id: orderRow.id, date: orderRow.date, total: totalForAfip, customerId: orderRow.customer_id }, {
            id: customerRow.id,
            businessName: (_d = customerRow.business_name) !== null && _d !== void 0 ? _d : '',
            cuit: customerRow.cuit,
            condicionIva: (_e = customerRow.condicion_iva) !== null && _e !== void 0 ? _e : null
        }, forceCbteTipo);
        const { v4: uuidv4 } = yield Promise.resolve().then(() => __importStar(require('uuid')));
        const invoiceId = uuidv4();
        const agip = yield getAgipRetentionForOrder({
            orderDate: String(orderRow.date || ''),
            customerCuit: customerRow.cuit,
            netAmount: totalForAfip
        });
        yield (0, db_1.execute)(`INSERT INTO invoices (id, order_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, agip_alicuota, agip_ret_per)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            invoiceId,
            id,
            result.cae,
            result.caeFchVto || null,
            result.puntoVta,
            result.cbteTipo,
            result.cbteDesde,
            result.cbteHasta,
            (_f = agip === null || agip === void 0 ? void 0 : agip.alicuota) !== null && _f !== void 0 ? _f : 0,
            (_g = agip === null || agip === void 0 ? void 0 : agip.amount) !== null && _g !== void 0 ? _g : 0
        ]);
        res.status(201).json({
            id: invoiceId,
            orderId: id,
            cae: result.cae,
            caeFchVto: result.caeFchVto,
            puntoVta: result.puntoVta,
            cbteTipo: result.cbteTipo,
            cbteDesde: result.cbteDesde,
            cbteHasta: result.cbteHasta,
            agipAlicuota: (_h = agip === null || agip === void 0 ? void 0 : agip.alicuota) !== null && _h !== void 0 ? _h : 0,
            agipRetPer: (_j = agip === null || agip === void 0 ? void 0 : agip.amount) !== null && _j !== void 0 ? _j : 0
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
    var _a, _b, _c;
    const { id } = req.params;
    const user = req.user;
    if (!user || (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE' && user.role !== 'DEPOSITO')) {
        return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden emitir notas de crédito' });
    }
    if (!id)
        return res.status(400).json({ message: 'ID de pedido inválido' });
    const { tipo, itemIndex, quantity, items } = req.body || {};
    if (!tipo || (tipo !== 'total' && tipo !== 'item' && tipo !== 'items')) {
        return res.status(400).json({ message: 'Body debe incluir tipo: "total", "item" o "items"' });
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
        let itemsToCredit = [];
        if (tipo === 'total') {
            const netFromItems = yield getOrderNetFromLineItems(id);
            amountToCredit = netFromItems > 0 ? netFromItems : Number(orderRow.total) || 0;
            if (amountToCredit <= 0)
                return res.status(400).json({ message: 'El total del pedido debe ser mayor a 0.' });
        }
        else if (tipo === 'item') {
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
            itemsToCredit = [{ itemIndex: idx, quantity: qty, amount: amountToCredit }];
        }
        else {
            const itemsRows = yield (0, db_1.query)(`SELECT quantity, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id`, [id]);
            const orderItems = itemsRows;
            if (!orderItems.length)
                return res.status(400).json({ message: 'El pedido no tiene ítems.' });
            const rawItems = Array.isArray(items) ? items : [];
            if (rawItems.length === 0) {
                return res.status(400).json({ message: 'Para tipo "items" debés enviar al menos un artículo con su cantidad.' });
            }
            const byIndex = new Map();
            for (const it of rawItems) {
                const idx = typeof (it === null || it === void 0 ? void 0 : it.itemIndex) === 'number' ? it.itemIndex : parseInt(String(it === null || it === void 0 ? void 0 : it.itemIndex), 10);
                const qty = typeof (it === null || it === void 0 ? void 0 : it.quantity) === 'number' ? it.quantity : parseInt(String(it === null || it === void 0 ? void 0 : it.quantity), 10);
                if (isNaN(idx) || idx < 0 || idx >= orderItems.length) {
                    return res.status(400).json({ message: `itemIndex inválido en selección múltiple: ${String((_a = it === null || it === void 0 ? void 0 : it.itemIndex) !== null && _a !== void 0 ? _a : '')}` });
                }
                if (isNaN(qty) || qty <= 0) {
                    return res.status(400).json({ message: `quantity inválida para itemIndex ${idx}. Debe ser mayor a 0.` });
                }
                byIndex.set(idx, (byIndex.get(idx) || 0) + qty);
            }
            itemsToCredit = [];
            for (const [idx, qty] of byIndex.entries()) {
                const item = orderItems[idx];
                if (qty > item.quantity) {
                    return res.status(400).json({ message: `quantity debe ser entre 1 y ${item.quantity} para itemIndex ${idx}` });
                }
                const price = Number(item.price_at_moment) || 0;
                const lineAmount = Math.round(qty * price * 100) / 100;
                if (lineAmount <= 0) {
                    return res.status(400).json({ message: `El monto a creditar del itemIndex ${idx} es 0.` });
                }
                const itemLineTotal = Math.round(Number(item.quantity) * price * 100) / 100;
                const yaCreditadoItem = existingNCs
                    .filter((r) => (r.scope || '') === 'item' && r.item_index === idx)
                    .reduce((sum, r) => sum + Number(r.amount_credited || 0), 0);
                if (yaCreditadoItem + lineAmount > itemLineTotal + 0.01) {
                    return res.status(400).json({
                        message: `No se puede creditar más de lo facturado para el artículo ${idx + 1}. Ya creditado: $${yaCreditadoItem.toFixed(2)}. Máximo a creditar: $${(itemLineTotal - yaCreditadoItem).toFixed(2)}.`,
                    });
                }
                itemsToCredit.push({ itemIndex: idx, quantity: qty, amount: lineAmount });
            }
            amountToCredit = Math.round(itemsToCredit.reduce((sum, i) => sum + i.amount, 0) * 100) / 100;
            if (amountToCredit <= 0) {
                return res.status(400).json({ message: 'El monto total a creditar debe ser mayor a 0.' });
            }
        }
        const { emitirNotaCredito: emitirNCAfip } = yield Promise.resolve().then(() => __importStar(require('../services/afip.service')));
        const result = yield emitirNCAfip({ puntoVta: invRow.punto_venta, cbteTipo: invRow.cbte_tipo, cbteDesde: invRow.cbte_desde }, { id: customerRow.id, businessName: (_b = customerRow.business_name) !== null && _b !== void 0 ? _b : '', cuit: customerRow.cuit, condicionIva: (_c = customerRow.condicion_iva) !== null && _c !== void 0 ? _c : undefined }, amountToCredit);
        const scope = tipo === 'items' ? 'item' : tipo;
        const itemIndexVal = tipo === 'item' ? (typeof itemIndex === 'number' ? itemIndex : parseInt(String(itemIndex), 10)) : null;
        const firstCreditNoteId = (0, uuid_1.v4)();
        if (tipo === 'items') {
            for (let i = 0; i < itemsToCredit.length; i++) {
                const it = itemsToCredit[i];
                yield (0, db_1.execute)(`INSERT INTO credit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [i === 0 ? firstCreditNoteId : (0, uuid_1.v4)(), id, invRow.id, result.cae, result.caeFchVto || null, result.puntoVta, result.cbteTipo, result.cbteDesde, result.cbteHasta, it.amount, 'item', it.itemIndex]);
            }
        }
        else {
            yield (0, db_1.execute)(`INSERT INTO credit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [firstCreditNoteId, id, invRow.id, result.cae, result.caeFchVto || null, result.puntoVta, result.cbteTipo, result.cbteDesde, result.cbteHasta, amountToCredit, scope, itemIndexVal]);
        }
        if (scope === 'total') {
            const stockResult = yield (0, stock_controller_1.restoreStockForOrder)(id);
            if (!stockResult.success) {
                return res.status(500).json({ message: 'Error actualizando stock después de la nota de crédito total', errors: stockResult.errors });
            }
        }
        else if (tipo === 'item' && typeof itemIndexVal === 'number') {
            const stockResult = yield (0, stock_controller_1.restoreStockForOrderItem)(id, itemIndexVal, creditNoteItemQuantity !== null && creditNoteItemQuantity !== void 0 ? creditNoteItemQuantity : undefined);
            if (!stockResult.success) {
                return res.status(500).json({ message: 'Error actualizando stock después de la nota de crédito parcial', errors: stockResult.errors });
            }
        }
        else if (tipo === 'items') {
            for (const it of itemsToCredit) {
                const stockResult = yield (0, stock_controller_1.restoreStockForOrderItem)(id, it.itemIndex, it.quantity);
                if (!stockResult.success) {
                    return res.status(500).json({ message: 'Error actualizando stock después de la nota de crédito parcial múltiple', errors: stockResult.errors });
                }
            }
        }
        res.status(201).json({
            id: firstCreditNoteId,
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
/** Exporta métricas mayoristas: artículos más pedidos (ranking). */
const exportTopWholesaleProductsMetricsXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const user = req.user;
        if (!user || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(user.role)) {
            return res.status(403).json({ message: 'Sin permiso' });
        }
        const where = [`o.status NOT IN ('Cancelado', 'Borrador')`];
        const params = [];
        const from = (_b = (_a = req.query) === null || _a === void 0 ? void 0 : _a.from) === null || _b === void 0 ? void 0 : _b.trim();
        const to = (_d = (_c = req.query) === null || _c === void 0 ? void 0 : _c.to) === null || _d === void 0 ? void 0 : _d.trim();
        if (from) {
            where.push('o.date >= ?');
            params.push(from);
        }
        if (to) {
            where.push('o.date <= ?');
            params.push(to);
        }
        if (user.role === 'SELLER') {
            where.push('c.seller_id = ?');
            params.push(user.id);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const rows = yield (0, db_1.query)(`
      SELECT
        p.id AS product_id,
        p.sku AS product_code,
        p.name AS product_name,
        SUM(oi.quantity) AS units_ordered,
        COUNT(DISTINCT o.id) AS orders_count,
        COUNT(DISTINCT o.customer_id) AS customers_count,
        ROUND(SUM(oi.quantity * oi.price_at_moment), 2) AS subtotal
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN customers c ON c.id = o.customer_id
      JOIN product_variants pv ON pv.id = oi.variant_id
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      ${whereSql}
      GROUP BY p.id, p.sku, p.name
      ORDER BY units_ordered DESC, orders_count DESC, subtotal DESC
      `, params);
        const wb = new exceljs_1.default.Workbook();
        wb.creator = 'LupoHub';
        wb.created = new Date();
        const ws = wb.addWorksheet('Top pedidos mayorista');
        ws.columns = [
            { header: 'Ranking', key: 'rank', width: 10 },
            { header: 'Código', key: 'code', width: 18 },
            { header: 'Artículo', key: 'name', width: 40 },
            { header: 'Unidades pedidas', key: 'units', width: 18 },
            { header: 'Pedidos', key: 'orders', width: 12 },
            { header: 'Clientes', key: 'customers', width: 12 },
            { header: 'Subtotal', key: 'subtotal', width: 16 }
        ];
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        rows.forEach((r, idx) => {
            var _a, _b;
            ws.addRow({
                rank: idx + 1,
                code: (_a = r.product_code) !== null && _a !== void 0 ? _a : '',
                name: (_b = r.product_name) !== null && _b !== void 0 ? _b : '',
                units: Number(r.units_ordered || 0),
                orders: Number(r.orders_count || 0),
                customers: Number(r.customers_count || 0),
                subtotal: Number(r.subtotal || 0)
            });
        });
        ws.getColumn('D').numFmt = '#,##0';
        ws.getColumn('E').numFmt = '#,##0';
        ws.getColumn('F').numFmt = '#,##0';
        ws.getColumn('G').numFmt = '#,##0.00';
        const out = yield wb.xlsx.writeBuffer();
        const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out));
        const filename = `metricas_mayorista_top_articulos_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buf);
    }
    catch (error) {
        console.error('exportTopWholesaleProductsMetricsXlsx:', error);
        return res.status(500).json({ message: 'Error exportando métricas mayoristas' });
    }
});
exports.exportTopWholesaleProductsMetricsXlsx = exportTopWholesaleProductsMetricsXlsx;
/**
 * Asigna (o devuelve, si ya existía) el N° de remito único para el pedido.
 *
 * - Es **idempotente**: si el pedido ya tiene `remito_number`, devuelve el mismo valor (sin consumir
 *   uno nuevo de la secuencia). Esto garantiza que reimprimir un remito muestre siempre el mismo número.
 * - Es **atómico**: usa el truco de `LAST_INSERT_ID(expr)` para incrementar la secuencia sin necesidad
 *   de transacciones explícitas con conexión dedicada.
 * - **Único**: la columna `orders.remito_number` tiene constraint UNIQUE, por lo que aún en caso de
 *   carrera el segundo proceso obtiene 0 affectedRows y lee el número que efectivamente quedó.
 */
const assignRemitoNumber = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ message: 'ID de pedido inválido' });
    try {
        const order = yield (0, db_1.get)('SELECT id, remito_number FROM orders WHERE id = ?', [id]);
        if (!order)
            return res.status(404).json({ message: 'Pedido no encontrado' });
        if (order.remito_number != null) {
            return res.json({
                orderId: id,
                remitoNumber: Number(order.remito_number),
                assigned: false
            });
        }
        // Inicialización defensiva (idempotente) por si la migración no llegó a correr aún.
        yield (0, db_1.execute)(`INSERT IGNORE INTO remito_sequence (id, next_value) VALUES (1, 31457)`);
        // Atómico: setea LAST_INSERT_ID al valor actual y deja next_value+1 para el próximo.
        const inc = yield (0, db_1.execute)(`UPDATE remito_sequence SET next_value = LAST_INSERT_ID(next_value) + 1 WHERE id = 1`);
        const candidate = Number((inc === null || inc === void 0 ? void 0 : inc.insertId) || 0);
        if (!candidate) {
            return res.status(500).json({ message: 'No se pudo obtener el próximo N° de remito (secuencia vacía).' });
        }
        const upd = yield (0, db_1.execute)(`UPDATE orders SET remito_number = ? WHERE id = ? AND remito_number IS NULL`, [candidate, id]);
        const affected = Number((upd === null || upd === void 0 ? void 0 : upd.affectedRows) || 0);
        if (affected === 1) {
            return res.json({ orderId: id, remitoNumber: candidate, assigned: true });
        }
        // Race condition: otro request asignó antes. Devolver el valor que quedó persistido.
        const reread = yield (0, db_1.get)('SELECT remito_number FROM orders WHERE id = ?', [id]);
        return res.json({
            orderId: id,
            remitoNumber: Number((reread === null || reread === void 0 ? void 0 : reread.remito_number) || 0),
            assigned: false
        });
    }
    catch (error) {
        console.error('assignRemitoNumber:', error);
        return res.status(500).json({ message: 'Error asignando N° de remito' });
    }
});
exports.assignRemitoNumber = assignRemitoNumber;
/**
 * Lista los ítems de un pedido que no tienen número de despacho asignado.
 * Devuelve además detalle de producto/variante para mostrar en el modal de corrección.
 */
const getOrderItemsMissingDespacho = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ message: 'ID de pedido inválido' });
    try {
        const order = yield (0, db_1.get)('SELECT id FROM orders WHERE id = ?', [id]);
        if (!order)
            return res.status(404).json({ message: 'Pedido no encontrado' });
        const rows = yield (0, db_1.query)(`SELECT
         i.id AS orderItemId,
         i.variant_id AS variantId,
         i.quantity,
         pc.product_id AS productId,
         COALESCE(pv.sku, p.sku) AS sku,
         p.name AS productName,
         s.size_code AS sizeCode,
         c.name AS colorName,
         p.ultimo_despacho_id AS productLastDespachoId,
         d_last.numero_despacho AS productLastDespachoNumero
       FROM order_items i
       JOIN product_variants pv ON pv.id = i.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN sizes s ON s.id = pv.size_id
       LEFT JOIN colors c ON c.id = pc.color_id
       LEFT JOIN despachos d_last ON d_last.id = p.ultimo_despacho_id
       WHERE i.order_id = ? AND i.despacho_id IS NULL
       ORDER BY p.name ASC, i.id ASC`, [id]);
        res.json(rows.map((r) => {
            var _a, _b, _c, _d, _e, _f;
            return ({
                orderItemId: r.orderItemId,
                variantId: r.variantId,
                productId: r.productId,
                sku: (_a = r.sku) !== null && _a !== void 0 ? _a : '',
                productName: (_b = r.productName) !== null && _b !== void 0 ? _b : '',
                sizeCode: (_c = r.sizeCode) !== null && _c !== void 0 ? _c : '',
                colorName: (_d = r.colorName) !== null && _d !== void 0 ? _d : '',
                quantity: Number(r.quantity) || 0,
                productLastDespachoId: (_e = r.productLastDespachoId) !== null && _e !== void 0 ? _e : null,
                productLastDespachoNumero: (_f = r.productLastDespachoNumero) !== null && _f !== void 0 ? _f : null
            });
        }));
    }
    catch (error) {
        console.error('getOrderItemsMissingDespacho:', error);
        res.status(500).json({ message: 'Error obteniendo ítems sin despacho del pedido' });
    }
});
exports.getOrderItemsMissingDespacho = getOrderItemsMissingDespacho;
/**
 * Asigna despachos (existentes o nuevos por número) a una lista de order_items de un pedido.
 * Body: { assignments: [{ orderItemId, despachoId?, numeroDespacho?, paisOrigen?, fechaDespacho? }] }
 * Si viene `numeroDespacho` y no existe, crea el despacho; si existe lo reutiliza.
 * Solo afecta a items del pedido indicado y, por seguridad, solo si actualmente tienen despacho_id NULL.
 */
const assignDespachosToOrderItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const { id } = req.params;
    const assignmentsRaw = Array.isArray((_a = req.body) === null || _a === void 0 ? void 0 : _a.assignments) ? req.body.assignments : [];
    if (!id)
        return res.status(400).json({ message: 'ID de pedido inválido' });
    if (assignmentsRaw.length === 0) {
        return res.status(400).json({ message: 'No hay asignaciones para aplicar' });
    }
    try {
        const order = yield (0, db_1.get)('SELECT id FROM orders WHERE id = ?', [id]);
        if (!order)
            return res.status(404).json({ message: 'Pedido no encontrado' });
        const orderItemIds = assignmentsRaw
            .map((a) => String((a === null || a === void 0 ? void 0 : a.orderItemId) || '').trim())
            .filter(Boolean);
        if (orderItemIds.length === 0) {
            return res.status(400).json({ message: 'Las asignaciones no traen orderItemId válido' });
        }
        const placeholders = orderItemIds.map(() => '?').join(',');
        const itemsRows = yield (0, db_1.query)(`SELECT i.id, i.variant_id, i.despacho_id, pc.product_id, p.ultimo_despacho_id AS productLastDespachoId
       FROM order_items i
       JOIN product_variants pv ON pv.id = i.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE i.order_id = ? AND i.id IN (${placeholders})`, [id, ...orderItemIds]);
        if (itemsRows.length === 0) {
            return res.status(404).json({ message: 'Ningún ítem coincide con el pedido' });
        }
        const itemsById = new Map(itemsRows.map((r) => [String(r.id), r]));
        const resolved = [];
        const errors = [];
        for (const a of assignmentsRaw) {
            const orderItemId = String((a === null || a === void 0 ? void 0 : a.orderItemId) || '').trim();
            const itemRow = itemsById.get(orderItemId);
            if (!orderItemId || !itemRow) {
                errors.push(`Ítem ${orderItemId || '(sin id)'} no pertenece al pedido o no existe`);
                continue;
            }
            if (itemRow.despacho_id) {
                errors.push(`El ítem ${orderItemId} ya tiene un despacho asignado; usá la edición del pedido para cambiarlo`);
                continue;
            }
            let despachoId = String((a === null || a === void 0 ? void 0 : a.despachoId) || '').trim() || null;
            let numeroDespacho = String((a === null || a === void 0 ? void 0 : a.numeroDespacho) || '').trim();
            const paisOrigen = String((a === null || a === void 0 ? void 0 : a.paisOrigen) || '').trim() || null;
            const fechaDespachoRaw = String((a === null || a === void 0 ? void 0 : a.fechaDespacho) || '').trim();
            if (!despachoId && !numeroDespacho) {
                errors.push(`El ítem ${orderItemId} no trae despachoId ni numeroDespacho`);
                continue;
            }
            let created = false;
            let resolvedNumero = '';
            let resolvedPais = paisOrigen;
            if (despachoId) {
                const row = yield (0, db_1.get)('SELECT id, numero_despacho, pais_origen FROM despachos WHERE id = ?', [despachoId]);
                if (!row) {
                    errors.push(`Despacho ${despachoId} no encontrado`);
                    continue;
                }
                resolvedNumero = String(row.numero_despacho || '');
                resolvedPais = paisOrigen || row.pais_origen || null;
            }
            else {
                const existing = yield (0, db_1.get)('SELECT id, numero_despacho, pais_origen FROM despachos WHERE numero_despacho = ?', [numeroDespacho]);
                if (existing === null || existing === void 0 ? void 0 : existing.id) {
                    despachoId = String(existing.id);
                    resolvedNumero = String(existing.numero_despacho || numeroDespacho);
                    resolvedPais = paisOrigen || existing.pais_origen || null;
                }
                else {
                    const newId = (0, uuid_1.v4)();
                    const fecha = fechaDespachoRaw || new Date().toISOString().slice(0, 10);
                    const pais = paisOrigen || 'Brasil';
                    yield (0, db_1.execute)(`INSERT INTO despachos (id, numero_despacho, fecha_despacho, pais_origen, estado, notas)
             VALUES (?, ?, ?, ?, 'despachado', ?)`, [newId, numeroDespacho, fecha, pais, 'Creado al asignar a items de pedido']);
                    despachoId = newId;
                    resolvedNumero = numeroDespacho;
                    resolvedPais = pais;
                    created = true;
                }
            }
            resolved.push({
                orderItemId,
                productId: (_b = itemRow.product_id) !== null && _b !== void 0 ? _b : null,
                despachoId: despachoId,
                numeroDespacho: resolvedNumero,
                paisOrigen: resolvedPais,
                created
            });
        }
        if (resolved.length === 0) {
            return res.status(400).json({
                message: 'No se pudo aplicar ninguna asignación',
                errors
            });
        }
        for (const r of resolved) {
            yield (0, db_1.execute)('UPDATE order_items SET despacho_id = ? WHERE id = ? AND order_id = ? AND despacho_id IS NULL', [r.despachoId, r.orderItemId, id]);
            if (r.productId) {
                yield (0, db_1.execute)(`UPDATE products
             SET ultimo_despacho_id = ?,
                 pais_origen = COALESCE(?, pais_origen)
           WHERE id = ?`, [r.despachoId, r.paisOrigen, r.productId]);
            }
        }
        res.json({
            orderId: id,
            applied: resolved.map((r) => ({
                orderItemId: r.orderItemId,
                despachoId: r.despachoId,
                numeroDespacho: r.numeroDespacho,
                created: r.created
            })),
            errors
        });
    }
    catch (error) {
        console.error('assignDespachosToOrderItems:', error);
        res.status(500).json({ message: 'Error asignando despachos a los ítems del pedido' });
    }
});
exports.assignDespachosToOrderItems = assignDespachosToOrderItems;
