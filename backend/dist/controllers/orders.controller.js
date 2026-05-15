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
exports.assignDespachosToOrderItems = exports.getOrderItemsMissingDespacho = exports.assignRemitoNumber = exports.exportTopWholesaleProductsMetricsXlsx = exports.emitirNotaCredito = exports.getOrderCreditNotes = exports.emitirFactura = exports.getOrderInvoice = exports.reemitirFacturaConAgip = exports.recalculateStoredInvoiceAgip = exports.deleteOrder = exports.archiveOrder = exports.applyMayoristaStockDeduction = exports.patchOrderPaymentStatus = exports.updateOrder = exports.updateOrderStatus = exports.importOrdersFromMatrix = exports.createOrder = exports.getOrders = void 0;
const db_1 = require("../database/db");
const types_1 = require("../types");
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
/** ¿La factura vigente del pedido sigue siendo la misma que anuló esta NC total? (snapshot voided_* = invoice actual). */
function totalCreditNoteStillVoidsCurrentInvoice(invoice, cn) {
    var _a, _b;
    if (!(cn === null || cn === void 0 ? void 0 : cn.voided_invoice_cae))
        return true;
    if (!invoice)
        return true;
    const pvInv = Number((_a = invoice.puntoVta) !== null && _a !== void 0 ? _a : 0);
    const pvV = Number((_b = cn.voided_invoice_punto_venta) !== null && _b !== void 0 ? _b : 0);
    return (String(cn.voided_invoice_cae) === String(invoice.cae) &&
        Number(cn.voided_invoice_cbte_desde) === Number(invoice.cbteDesde) &&
        pvInv === pvV &&
        Number(cn.voided_invoice_cbte_tipo) === Number(invoice.cbteTipo));
}
/** NC totales que siguen “anulando” el comprobante actual (sin reemplazo o datos legacy sin snapshot). */
function countActiveTotalCreditNoteVoid(invoice, totalCnList) {
    let n = 0;
    for (const cn of totalCnList) {
        if (Number(cn.superseded_by_reinvoice))
            continue;
        if (!cn.voided_invoice_cae) {
            n++;
            continue;
        }
        if (totalCreditNoteStillVoidsCurrentInvoice(invoice, cn))
            n++;
    }
    return n;
}
function buildLastTotalCreditNoteFiscalPayload(lastCn) {
    if (!lastCn)
        return undefined;
    return {
        voidedInvoice: lastCn.voided_invoice_cae
            ? {
                cae: String(lastCn.voided_invoice_cae),
                puntoVta: lastCn.voided_invoice_punto_venta != null ? Number(lastCn.voided_invoice_punto_venta) : undefined,
                cbteTipo: lastCn.voided_invoice_cbte_tipo != null ? Number(lastCn.voided_invoice_cbte_tipo) : undefined,
                cbteDesde: Number(lastCn.voided_invoice_cbte_desde),
            }
            : undefined,
        creditNote: {
            cae: String(lastCn.cae),
            puntoVta: Number(lastCn.punto_venta),
            cbteTipo: Number(lastCn.cbte_tipo),
            cbteDesde: Number(lastCn.cbte_desde),
        },
        supersededByReinvoice: !!Number(lastCn.superseded_by_reinvoice),
    };
}
/**
 * Percepción IIBB para la NC en AFIP según `invoices.agip_*` (misma lógica que la factura).
 * En NC parcial se prorratea el importe de percepción según neto creditado / neto total del pedido.
 */
function iibbPercepcionForOrderCreditNote(invAgipAlicuota, invAgipRetPer, netAmountCredited, invoiceFullNet) {
    const retFull = Math.round((Number(invAgipRetPer) || 0) * 100) / 100;
    if (!(retFull > 0.005))
        return undefined;
    const full = Math.max(Math.round((Number(invoiceFullNet) || 0) * 100) / 100, 0.01);
    const netCred = Math.round((Number(netAmountCredited) || 0) * 100) / 100;
    const ratio = Math.min(1, Math.max(0, netCred / full));
    const importe = Math.round(retFull * ratio * 100) / 100;
    if (!(importe > 0.005))
        return undefined;
    return {
        baseImp: netCred,
        alicuota: Math.round((Number(invAgipAlicuota) || 0) * 100) / 100,
        importe,
    };
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
/**
 * Período del padrón AGIP (YYYYMM) a partir de la fecha del pedido.
 * MySQL devuelve `DATE` como `Date` en node: `String(date)` no es ISO y rompía el cálculo IIBB al emitir.
 */
function agipPeriodYyyymmFromOrderDate(orderDate) {
    if (orderDate == null || orderDate === '')
        return null;
    if (orderDate instanceof Date && !isNaN(orderDate.getTime())) {
        const y = orderDate.getFullYear();
        const m = orderDate.getMonth() + 1;
        return `${y}${String(m).padStart(2, '0')}`;
    }
    const s = String(orderDate).trim();
    const mIso = s.match(/^(\d{4})-(\d{2})/);
    if (mIso)
        return `${mIso[1]}${mIso[2]}`;
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    return null;
}
function getAgipRetentionForOrder(args) {
    return __awaiter(this, void 0, void 0, function* () {
        const cuit = String(args.customerCuit || '').replace(/\D/g, '').slice(0, 11);
        if (cuit.length !== 11)
            return null;
        const period = agipPeriodYyyymmFromOrderDate(args.orderDate);
        if (!period || !/^\d{6}$/.test(period))
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
        let whereCustomer = '';
        if ((user === null || user === void 0 ? void 0 : user.role) === 'CUSTOMER') {
            const { get } = yield Promise.resolve().then(() => __importStar(require('../database/db')));
            const customer = yield get('SELECT id FROM customers WHERE user_id = ?', [user.id]);
            if (!(customer === null || customer === void 0 ? void 0 : customer.id)) {
                return res.json([]);
            }
            whereCustomer = ' AND o.customer_id = ?';
            ordersParams.push(customer.id);
        }
        const orderId = req.query.orderId;
        if (orderId) {
            ordersParams.push(orderId);
        }
        const whereOrderId = orderId ? ' AND o.id = ?' : '';
        const ordersRow = yield (0, db_1.query)(`SELECT o.*, c.business_name AS customer_business_name, c.name AS customer_name, c.cuit AS customer_cuit,
              cu.name AS created_by_name, cu.role AS created_by_role,
              su.name AS seller_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users cu ON cu.id = o.created_by
       LEFT JOIN users su ON su.id = o.seller_id
       WHERE 1=1 ${whereArchived}${whereUserScope}${whereCustomer}${whereOrderId}
       ORDER BY o.date DESC`, ordersParams);
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
        const agipRecalcInputs = [];
        for (const o of ordersRow) {
            const inv = invoiceByOrderId[o.id];
            if (!inv)
                continue;
            const hasStoredAgip = Number(inv.agipAlicuota || 0) > 0 || Number(inv.agipRetPer || 0) > 0;
            if (hasStoredAgip)
                continue;
            const lines = itemsByOrderId[o.id] || [];
            let netFromItems = 0;
            for (const it of lines) {
                const qty = Number(it.quantity || 0);
                const price = Number(it.priceAtMoment || 0);
                netFromItems += Math.round(qty * price * 100) / 100;
            }
            netFromItems = Math.round(netFromItems * 100) / 100;
            const netAmount = netFromItems > 0 ? netFromItems : Number(o.total || 0);
            agipRecalcInputs.push({
                inv,
                orderDate: o.date,
                customerCuit: o.customer_cuit,
                netAmount,
            });
        }
        const agipResults = yield Promise.all(agipRecalcInputs.map((row) => getAgipRetentionForOrder({
            orderDate: row.orderDate,
            customerCuit: row.customerCuit,
            netAmount: row.netAmount,
        }).then((calc) => ({ inv: row.inv, calc }))));
        for (const { inv, calc } of agipResults) {
            if (calc) {
                inv.agipAlicuota = Number(calc.alicuota || 0);
                inv.agipRetPer = Number(calc.amount || 0);
            }
        }
        let creditNotesCountByOrderId = {};
        let creditNotesTotalByOrderId = {};
        let creditNotesItemByOrderId = {};
        let creditNotesNetoCreditedByOrderId = {};
        try {
            const cnRows = yield (0, db_1.query)(`SELECT order_id,
                COUNT(*) AS cnt,
                SUM(CASE WHEN scope = 'total' THEN 1 ELSE 0 END) AS total_cnt,
                SUM(CASE WHEN scope = 'item' THEN 1 ELSE 0 END) AS item_cnt,
                COALESCE(SUM(amount_credited), 0) AS neto_credited_sum
         FROM credit_notes
         WHERE order_id IN (${placeholders})
         GROUP BY order_id`, orderIds);
            for (const r of cnRows) {
                creditNotesCountByOrderId[r.order_id] = Number(r.cnt) || 0;
                creditNotesTotalByOrderId[r.order_id] = Number(r.total_cnt) || 0;
                creditNotesItemByOrderId[r.order_id] = Number(r.item_cnt) || 0;
                creditNotesNetoCreditedByOrderId[r.order_id] = Math.round(Number(r.neto_credited_sum || 0) * 100) / 100;
            }
        }
        catch (_) {
            // Tabla credit_notes puede no existir en DB antiguas
        }
        let totalCnsByOrderId = {};
        try {
            const cnTotalDetailRows = yield (0, db_1.query)(`SELECT order_id, id, cae, punto_venta, cbte_tipo, cbte_desde, cbte_hasta,
                voided_invoice_cae, voided_invoice_punto_venta, voided_invoice_cbte_tipo, voided_invoice_cbte_desde,
                COALESCE(superseded_by_reinvoice, 0) AS superseded_by_reinvoice,
                created_at
         FROM credit_notes
         WHERE order_id IN (${placeholders}) AND scope = 'total'
         ORDER BY created_at ASC, id ASC`, orderIds);
            for (const r of cnTotalDetailRows) {
                if (!totalCnsByOrderId[r.order_id])
                    totalCnsByOrderId[r.order_id] = [];
                totalCnsByOrderId[r.order_id].push(r);
            }
        }
        catch (_) {
            totalCnsByOrderId = {};
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
            const inv = invoiceByOrderId[order.id];
            const totalCnList = totalCnsByOrderId[order.id] || [];
            const activeTotalVoid = countActiveTotalCreditNoteVoid(inv, totalCnList);
            const lastTotalCn = totalCnList.length ? totalCnList[totalCnList.length - 1] : undefined;
            const totalCnt = (_a = creditNotesTotalByOrderId[order.id]) !== null && _a !== void 0 ? _a : 0;
            return {
                id: order.id,
                customerId: order.customer_id,
                customerBusinessName: (_c = (_b = order.customer_business_name) !== null && _b !== void 0 ? _b : order.customer_name) !== null && _c !== void 0 ? _c : undefined,
                sellerId: order.seller_id,
                createdBy: (_d = order.created_by) !== null && _d !== void 0 ? _d : undefined,
                createdByName: (_e = order.created_by_name) !== null && _e !== void 0 ? _e : undefined,
                createdByRole: (_f = order.created_by_role) !== null && _f !== void 0 ? _f : undefined,
                sellerName: (_g = order.seller_name) !== null && _g !== void 0 ? _g : undefined,
                date: order.date,
                status: order.status,
                total: Number(order.total),
                pickedBy: (_h = order.picked_by) !== null && _h !== void 0 ? _h : undefined,
                dispatchedAt: order.dispatched_at ? new Date(order.dispatched_at).toISOString() : undefined,
                archived: !!(order.archived),
                remitoNumber: order.remito_number != null ? Number(order.remito_number) : undefined,
                matrixImportLabel: order.matrix_import_label ? String(order.matrix_import_label) : undefined,
                items: itemsByOrderId[order.id] || [],
                invoice: inv !== null && inv !== void 0 ? inv : undefined,
                creditNotesCount: (_j = creditNotesCountByOrderId[order.id]) !== null && _j !== void 0 ? _j : 0,
                creditNotesTotalCount: totalCnt,
                creditNotesItemCount: (_k = creditNotesItemByOrderId[order.id]) !== null && _k !== void 0 ? _k : 0,
                /** NC total que sigue anulando el CAE actual del pedido (0 si ya hay factura nueva tras reemisión). */
                creditNotesActiveTotalVoidCount: activeTotalVoid,
                /** Última NC por el total: comprobante anulado + NC (para UI de secuencia fiscal). */
                lastTotalCreditNoteFiscal: totalCnt > 0 ? buildLastTotalCreditNoteFiscalPayload(lastTotalCn) : undefined,
                /** Suma de netos creditados (AFIP amount_credited, sin IVA) — útil p. ej. valor declarado en remito expreso. */
                creditNotesNetoCredited: (_l = creditNotesNetoCreditedByOrderId[order.id]) !== null && _l !== void 0 ? _l : 0,
                paymentStatus: mapPaymentStatus(order),
                noStockImpact: !!order.no_stock_impact,
                mayoristaStockApplied: mayoristaStockLoaded
                    ? mayoristaStockAppliedByOrder[order.id] === true
                    : undefined
            };
        });
        res.json(ordersFull);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error fetching orders" });
    }
});
exports.getOrders = getOrders;
function persistNewWholesaleOrder(newOrder, user, explicitOrderId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        if (!newOrder.customerId || !((_a = newOrder.items) === null || _a === void 0 ? void 0 : _a.length)) {
            const err = new Error('Datos de pedido inválidos');
            err.statusCode = 400;
            throw err;
        }
        let sellerId = (_b = newOrder.sellerId) !== null && _b !== void 0 ? _b : null;
        if ((user === null || user === void 0 ? void 0 : user.role) === 'CUSTOMER') {
            const customer = yield (0, db_1.get)('SELECT id FROM customers WHERE user_id = ?', [user.id]);
            if (!customer || customer.id !== newOrder.customerId) {
                const err = new Error('Como cliente directo solo podés crear pedidos para tu propio perfil');
                err.statusCode = 403;
                throw err;
            }
            sellerId = null;
        }
        const orderId = explicitOrderId || newOrder.id || (0, uuid_1.v4)();
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
        const createdBy = (_c = user === null || user === void 0 ? void 0 : user.id) !== null && _c !== void 0 ? _c : null;
        const requestedStatus = String(newOrder.status || 'Borrador');
        const shouldStayPendingAdmin = requestedStatus === 'Confirmado' && ((user === null || user === void 0 ? void 0 : user.role) === 'SELLER' || (user === null || user === void 0 ? void 0 : user.role) === 'CUSTOMER');
        const statusToSave = shouldStayPendingAdmin ? 'Pendiente confirmación admin' : requestedStatus;
        const matrixImportLabelRaw = (_d = newOrder.matrixImportLabel) !== null && _d !== void 0 ? _d : newOrder.matrix_import_label;
        const matrixImportLabelForSql = matrixImportLabelRaw != null && String(matrixImportLabelRaw).trim()
            ? String(matrixImportLabelRaw).trim().slice(0, 120)
            : null;
        yield (0, db_1.execute)(`INSERT INTO orders (id, customer_id, seller_id, date, status, total, payment_status, no_stock_impact, created_by, matrix_import_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [orderId, newOrder.customerId, sellerId, sqlDate, statusToSave, newOrder.total, paymentStatus, noStockImpact, createdBy, matrixImportLabelForSql]);
        for (const item of newOrder.items) {
            let variantId = item.variantId;
            if (!variantId && item.sku && item.colorCode && item.sizeCode) {
                variantId =
                    (yield (0, stock_controller_1.resolveVariantIdForGridCell)(String(item.sku).trim(), String(item.colorCode).trim(), String(item.sizeCode).trim())) || undefined;
            }
            if (!variantId) {
                const err = new Error(`No se encontró variante para código ${item.sku}, color ${item.colorCode}, talle ${item.sizeCode}. Revisá el catálogo (SKU, código de color y talle deben coincidir con LupoHub).`);
                err.statusCode = 400;
                throw err;
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
                yield (0, db_1.execute)(`INSERT INTO order_items (id, order_id, variant_id, quantity, picked, price_at_moment, sell_as_pack, despacho_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [(0, uuid_1.v4)(), orderId, variantId, alloc.quantity, 0, (_e = item.priceAtMoment) !== null && _e !== void 0 ? _e : 0, sellAsPack, alloc.despachoId]);
            }
        }
        // No descontar al confirmar: ahora se descuenta cuando finaliza picking.
        const created = yield (0, db_1.get)(`SELECT o.id, o.customer_id, o.seller_id, o.date, o.status, o.total, o.picked_by, o.dispatched_at, o.payment_status, o.no_stock_impact,
            o.created_by, o.matrix_import_label, cu.name AS created_by_name, cu.role AS created_by_role, su.name AS seller_name
     FROM orders o
     LEFT JOIN users cu ON cu.id = o.created_by
     LEFT JOIN users su ON su.id = o.seller_id
     WHERE o.id = ?`, [orderId]);
        if (!created) {
            return Object.assign(Object.assign({}, newOrder), { id: orderId, paymentStatus,
                despachoWarnings, items: newOrder.items });
        }
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
                numeroDespacho: (_g = row.numeroDespacho) !== null && _g !== void 0 ? _g : undefined,
            });
        });
        return {
            id: created.id,
            customerId: created.customer_id,
            sellerId: created.seller_id,
            createdBy: (_f = created.created_by) !== null && _f !== void 0 ? _f : undefined,
            createdByName: (_g = created.created_by_name) !== null && _g !== void 0 ? _g : undefined,
            createdByRole: (_h = created.created_by_role) !== null && _h !== void 0 ? _h : undefined,
            sellerName: (_j = created.seller_name) !== null && _j !== void 0 ? _j : undefined,
            date: created.date,
            status: created.status,
            total: Number(created.total),
            pickedBy: (_k = created.picked_by) !== null && _k !== void 0 ? _k : undefined,
            dispatchedAt: created.dispatched_at ? new Date(created.dispatched_at).toISOString() : undefined,
            items: itemsMapped,
            paymentStatus: mapPaymentStatus(created),
            noStockImpact: !!created.no_stock_impact,
            matrixImportLabel: created.matrix_import_label
                ? String(created.matrix_import_label)
                : undefined,
            despachoWarnings,
        };
    });
}
const createOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const newOrder = req.body;
    const user = req.user;
    try {
        const orderResponse = yield persistNewWholesaleOrder(newOrder, user);
        res.status(201).json(orderResponse);
    }
    catch (error) {
        console.error(error);
        const code = error === null || error === void 0 ? void 0 : error.statusCode;
        if (code === 400)
            return res.status(400).json({ message: error.message || 'Solicitud inválida' });
        if (code === 403)
            return res.status(403).json({ message: error.message || 'Prohibido' });
        res.status(500).json({ message: 'Error creating order' });
    }
});
exports.createOrder = createOrder;
/** Crea un borrador por cada cliente distinto a partir de líneas ya aplanadas (código+color+talle+cantidad). */
const importOrdersFromMatrix = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const user = req.user;
    if (!user || !['ADMIN', 'WAREHOUSE', 'DEPOSITO', 'SELLER'].includes(user.role)) {
        return res.status(403).json({ message: 'Sin permiso para importar pedidos' });
    }
    const padSku = (s) => {
        const digits = String(s !== null && s !== void 0 ? s : '').replace(/\D/g, '');
        if (!digits)
            return String(s !== null && s !== void 0 ? s : '').trim();
        return digits.length <= 7 ? digits.padStart(7, '0') : digits;
    };
    const resolvePrice = (skuPad, excelPrice) => __awaiter(void 0, void 0, void 0, function* () {
        const ep = Number(excelPrice);
        if (Number.isFinite(ep) && ep > 0)
            return ep;
        const stripped = skuPad.replace(/^0+/, '') || skuPad;
        const row = yield (0, db_1.get)(`SELECT base_price FROM products WHERE sku = ? OR sku = ? LIMIT 1`, [skuPad, stripped]);
        return Math.max(0, Number(row === null || row === void 0 ? void 0 : row.base_price) || 0);
    });
    const findCustomer = (customerRef) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const ref = String(customerRef !== null && customerRef !== void 0 ? customerRef : '').trim();
        if (!ref)
            return null;
        const lower = ref.toLowerCase();
        const params = [lower, lower];
        let sql = `SELECT id, seller_id FROM customers 
      WHERE LOWER(TRIM(COALESCE(business_name,''))) = ? 
         OR LOWER(TRIM(COALESCE(name,''))) = ?`;
        if (user.role === 'SELLER') {
            sql += ` AND seller_id = ?`;
            params.push(user.id);
        }
        sql += ` LIMIT 1`;
        let c = yield (0, db_1.get)(sql, params);
        if (!c && ref.length >= 2) {
            const safe = ref.replace(/%/g, '').replace(/_/g, '');
            const needle = `%${safe}%`;
            const p2 = [needle, needle];
            let sql2 = `SELECT id, seller_id FROM customers WHERE business_name LIKE ? OR name LIKE ?`;
            if (user.role === 'SELLER') {
                sql2 += ` AND seller_id = ?`;
                p2.push(user.id);
            }
            sql2 += ` LIMIT 1`;
            c = yield (0, db_1.get)(sql2, p2);
        }
        return c ? { id: c.id, seller_id: (_a = c.seller_id) !== null && _a !== void 0 ? _a : null } : null;
    });
    try {
        const body = req.body || {};
        const linesRaw = body.lines;
        const dateStr = typeof body.date === 'string' && body.date.trim() ? body.date.trim() : new Date().toISOString().slice(0, 10);
        if (!Array.isArray(linesRaw) || linesRaw.length === 0) {
            return res.status(400).json({ message: 'Se requiere body.lines: array no vacío' });
        }
        const byCustomer = new Map();
        for (const ln of linesRaw) {
            const ref = String((_a = ln.customerRef) !== null && _a !== void 0 ? _a : '').trim();
            if (!ref)
                continue;
            const ig = ln.importGroup === 'FACTURAR' || ln.importGroup === 'PENDIENTE' ? ln.importGroup : '';
            const key = ig ? `${ref.toLowerCase()}\t${ig}` : ref.toLowerCase();
            if (!byCustomer.has(key))
                byCustomer.set(key, []);
            byCustomer.get(key).push(Object.assign(Object.assign({}, ln), { customerRef: ref }));
        }
        const created = [];
        const errors = [];
        for (const [, groupLines] of byCustomer) {
            const customerRef = ((_b = groupLines[0]) === null || _b === void 0 ? void 0 : _b.customerRef) || '';
            try {
                const customer = yield findCustomer(customerRef);
                if (!customer) {
                    const ig = (_c = groupLines[0]) === null || _c === void 0 ? void 0 : _c.importGroup;
                    errors.push({
                        customerRef: ig === 'FACTURAR' || ig === 'PENDIENTE' ? `${customerRef} [${ig}]` : customerRef,
                        message: 'Cliente no encontrado',
                    });
                    continue;
                }
                const items = [];
                for (const ln of groupLines) {
                    const qty = Math.max(0, Math.floor(Number(ln.quantity) || 0));
                    if (qty <= 0)
                        continue;
                    const codigo = padSku(String((_d = ln.codigo) !== null && _d !== void 0 ? _d : '').trim());
                    const color = String((_e = ln.color) !== null && _e !== void 0 ? _e : '').trim();
                    const sizeCode = String((_f = ln.sizeCode) !== null && _f !== void 0 ? _f : '').trim();
                    if (!codigo || !color || !sizeCode)
                        continue;
                    const priceAtMoment = yield resolvePrice(codigo, ln.unitPrice);
                    items.push({ sku: codigo, colorCode: color, sizeCode, quantity: qty, priceAtMoment });
                }
                if (items.length === 0) {
                    errors.push({ customerRef, message: 'Sin líneas con cantidad > 0' });
                    continue;
                }
                let total = 0;
                for (const it of items)
                    total += it.quantity * it.priceAtMoment;
                const importGroup = (_g = groupLines[0]) === null || _g === void 0 ? void 0 : _g.importGroup;
                const matrixImportLabel = importGroup === 'FACTURAR'
                    ? 'A facturar (Excel)'
                    : importGroup === 'PENDIENTE'
                        ? 'Pendiente facturación (Excel)'
                        : undefined;
                const newOrder = {
                    id: (0, uuid_1.v4)(),
                    customerId: customer.id,
                    sellerId: customer.seller_id,
                    items: items,
                    total,
                    status: types_1.OrderStatus.DRAFT,
                    date: dateStr,
                };
                if (matrixImportLabel)
                    newOrder.matrixImportLabel = matrixImportLabel;
                const saved = yield persistNewWholesaleOrder(newOrder, user, newOrder.id);
                created.push(saved);
            }
            catch (e) {
                console.error(e);
                errors.push({
                    customerRef: ((_h = groupLines[0]) === null || _h === void 0 ? void 0 : _h.importGroup) === 'FACTURAR' || ((_j = groupLines[0]) === null || _j === void 0 ? void 0 : _j.importGroup) === 'PENDIENTE'
                        ? `${customerRef} [${groupLines[0].importGroup}]`
                        : customerRef,
                    message: (e === null || e === void 0 ? void 0 : e.statusCode) === 400 ? e.message : (e === null || e === void 0 ? void 0 : e.message) || 'Error al crear pedido',
                });
            }
        }
        res.status(201).json({
            created,
            errors,
            counts: { created: created.length, errors: errors.length },
        });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error importando pedidos' });
    }
});
exports.importOrdersFromMatrix = importOrdersFromMatrix;
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
/**
 * Recalcula la percepción IIBB (padrón AGIP) y la guarda en `invoices` para un pedido **ya facturado**.
 * Sirve para corregir el PDF interno cuando la factura salió con AGIP en cero (p. ej. bug de fecha).
 *
 * **No modifica el comprobante en AFIP** (el CAE y el total registrado en ARCA no cambian).
 */
const recalculateStoredInvoiceAgip = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const user = req.user;
    if (!user || (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE' && user.role !== 'DEPOSITO')) {
        return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden actualizar la percepción IIBB' });
    }
    if (!id)
        return res.status(400).json({ message: 'ID de pedido inválido' });
    try {
        const invRow = yield (0, db_1.get)('SELECT id FROM invoices WHERE order_id = ?', [id]);
        if (!invRow)
            return res.status(404).json({ message: 'Este pedido no tiene factura guardada en el sistema' });
        const orderRow = yield (0, db_1.get)('SELECT id, customer_id, date, total FROM orders WHERE id = ?', [id]);
        if (!orderRow)
            return res.status(404).json({ message: 'Pedido no encontrado' });
        const customerRow = yield (0, db_1.get)('SELECT cuit FROM customers WHERE id = ?', [orderRow.customer_id]);
        const netFromItems = yield getOrderNetFromLineItems(id);
        const netAmount = netFromItems > 0 ? netFromItems : Number(orderRow.total || 0);
        const agip = yield getAgipRetentionForOrder({
            orderDate: orderRow.date,
            customerCuit: customerRow === null || customerRow === void 0 ? void 0 : customerRow.cuit,
            netAmount
        });
        if (!agip || !(agip.amount > 0.005)) {
            return res.status(400).json({
                message: 'No hay percepción IIBB calculable (CUIT del cliente incompleto, sin alícuota en el padrón AGIP del mes del pedido, o importe redondeado a cero).'
            });
        }
        yield (0, db_1.execute)(`UPDATE invoices SET agip_alicuota = ?, agip_ret_per = ? WHERE order_id = ?`, [agip.alicuota, agip.amount, id]);
        res.json({
            orderId: id,
            agipAlicuota: agip.alicuota,
            agipRetPer: agip.amount,
            message: 'Percepción IIBB guardada. Volvé a abrir el PDF de la factura. El CAE en AFIP no se modifica; si necesitás registrar el tributo en ARCA, consultá a tu contador (p. ej. nota de débito u otro esquema).'
        });
    }
    catch (error) {
        console.error('recalculateStoredInvoiceAgip:', error);
        res.status(500).json({ message: 'Error actualizando percepción IIBB', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.recalculateStoredInvoiceAgip = recalculateStoredInvoiceAgip;
/**
 * Anula la factura actual en AFIP con una **NC total** solo con neto + IVA (sin percepción IIBB en la NC; sin tocar stock)
 * y emite una **nueva factura** con percepción IIBB informada en WSFE. Actualiza la fila `invoices` con el nuevo CAE.
 *
 * Requisitos: el pedido tiene factura, **no** tiene notas de crédito previas, y el padrón AGIP
 * devuelve percepción > 0 para el neto del pedido.
 */
const reemitirFacturaConAgip = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const { id } = req.params;
    const user = req.user;
    if (!user || (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE' && user.role !== 'DEPOSITO')) {
        return res.status(403).json({ message: 'Solo ADMIN o Depósito pueden reemitir la factura con IIBB' });
    }
    if (!id)
        return res.status(400).json({ message: 'ID de pedido inválido' });
    try {
        const invRow = yield (0, db_1.get)(`SELECT id, order_id, punto_venta, cbte_tipo, cbte_desde, cae, agip_alicuota, agip_ret_per FROM invoices WHERE order_id = ?`, [id]);
        if (!invRow) {
            return res.status(400).json({ message: 'Este pedido no tiene factura emitida.' });
        }
        const cnCountRow = yield (0, db_1.get)(`SELECT COUNT(*) AS c FROM credit_notes WHERE order_id = ?`, [id]);
        if (Number((cnCountRow === null || cnCountRow === void 0 ? void 0 : cnCountRow.c) || 0) > 0) {
            return res.status(400).json({
                message: 'No se puede reemitir: el pedido ya tiene notas de crédito. Si necesitás corregir la facturación, coordiná con el contador o emití manualmente en AFIP.'
            });
        }
        const orderRow = yield (0, db_1.get)('SELECT id, customer_id, date, total, no_stock_impact FROM orders WHERE id = ?', [id]);
        if (!orderRow)
            return res.status(404).json({ message: 'Pedido no encontrado' });
        const customerRow = yield (0, db_1.get)('SELECT id, business_name, cuit, condicion_iva FROM customers WHERE id = ?', [orderRow.customer_id]);
        if (!customerRow)
            return res.status(400).json({ message: 'Cliente del pedido no encontrado' });
        const netFromItems = yield getOrderNetFromLineItems(id);
        const totalForAfip = netFromItems > 0 ? netFromItems : Number(orderRow.total) || 0;
        if (totalForAfip <= 0) {
            return res.status(400).json({ message: 'El neto del pedido debe ser mayor a 0 para reemitir.' });
        }
        const agip = yield getAgipRetentionForOrder({
            orderDate: orderRow.date,
            customerCuit: customerRow.cuit,
            netAmount: totalForAfip
        });
        if (!agip || !(agip.amount > 0.005)) {
            return res.status(400).json({
                message: 'No hay percepción IIBB calculable para reemitir (padrón AGIP en cero o CUIT incompleto). Si solo querés actualizar el PDF sin nuevo CAE, usá “Guardar IIBB”.'
            });
        }
        const cbteTipoFromBody = (_a = req.body) === null || _a === void 0 ? void 0 : _a.cbteTipo;
        const forceCbteTipo = cbteTipoFromBody === 1 || cbteTipoFromBody === 6 ? cbteTipoFromBody : undefined;
        const { emitirNotaCredito: emitirNCAfip, emitirFactura: emitirAfip } = yield Promise.resolve().then(() => __importStar(require('../services/afip.service')));
        // NC total de reemisión: solo neto + IVA en AFIP (sin percepción IIBB). El IIBB se informa en la factura nueva.
        const ncResult = yield emitirNCAfip({
            puntoVta: invRow.punto_venta,
            cbteTipo: invRow.cbte_tipo,
            cbteDesde: invRow.cbte_desde
        }, {
            id: customerRow.id,
            businessName: (_b = customerRow.business_name) !== null && _b !== void 0 ? _b : '',
            cuit: customerRow.cuit,
            condicionIva: (_c = customerRow.condicion_iva) !== null && _c !== void 0 ? _c : undefined
        }, totalForAfip, undefined);
        const creditNoteId = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO credit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index,
        voided_invoice_cae, voided_invoice_punto_venta, voided_invoice_cbte_tipo, voided_invoice_cbte_desde, superseded_by_reinvoice)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            creditNoteId,
            id,
            invRow.id,
            ncResult.cae,
            ncResult.caeFchVto || null,
            ncResult.puntoVta,
            ncResult.cbteTipo,
            ncResult.cbteDesde,
            ncResult.cbteHasta,
            totalForAfip,
            'total',
            null,
            invRow.cae,
            invRow.punto_venta,
            invRow.cbte_tipo,
            invRow.cbte_desde,
            0,
        ]);
        const iibbPercepcion = {
            baseImp: totalForAfip,
            alicuota: agip.alicuota,
            importe: agip.amount
        };
        try {
            const faResult = yield emitirAfip({
                id: orderRow.id,
                date: orderRow.date,
                total: totalForAfip,
                customerId: orderRow.customer_id,
                iibbPercepcion
            }, {
                id: customerRow.id,
                businessName: (_d = customerRow.business_name) !== null && _d !== void 0 ? _d : '',
                cuit: customerRow.cuit,
                condicionIva: (_e = customerRow.condicion_iva) !== null && _e !== void 0 ? _e : null
            }, forceCbteTipo);
            yield (0, db_1.execute)(`UPDATE invoices SET cae = ?, cae_fch_vto = ?, punto_venta = ?, cbte_tipo = ?, cbte_desde = ?, cbte_hasta = ?, agip_alicuota = ?, agip_ret_per = ?
         WHERE order_id = ?`, [
                faResult.cae,
                faResult.caeFchVto || null,
                faResult.puntoVta,
                faResult.cbteTipo,
                faResult.cbteDesde,
                faResult.cbteHasta,
                agip.alicuota,
                agip.amount,
                id
            ]);
            yield (0, db_1.execute)(`UPDATE credit_notes SET superseded_by_reinvoice = 1 WHERE id = ?`, [creditNoteId]);
            res.status(201).json({
                message: 'Se emitió nota de crédito total (neto + IVA, sin IIBB en la NC) y una nueva factura con percepción IIBB. El stock del pedido no se modificó.',
                creditNote: {
                    id: creditNoteId,
                    orderId: id,
                    cae: ncResult.cae,
                    caeFchVto: ncResult.caeFchVto,
                    puntoVta: ncResult.puntoVta,
                    cbteTipo: ncResult.cbteTipo,
                    cbteDesde: ncResult.cbteDesde,
                    cbteHasta: ncResult.cbteHasta,
                    amountCredited: totalForAfip
                },
                invoice: {
                    id: invRow.id,
                    orderId: id,
                    cae: faResult.cae,
                    caeFchVto: faResult.caeFchVto,
                    puntoVta: faResult.puntoVta,
                    cbteTipo: faResult.cbteTipo,
                    cbteDesde: faResult.cbteDesde,
                    cbteHasta: faResult.cbteHasta,
                    agipAlicuota: agip.alicuota,
                    agipRetPer: agip.amount
                }
            });
        }
        catch (faErr) {
            console.error('reemitirFacturaConAgip: nueva factura falló tras NC:', faErr);
            res.status(500).json({
                message: 'Se emitió la nota de crédito en AFIP pero falló la nueva factura. Completá la factura en AFIP con percepción IIBB y actualizá manualmente la fila en `invoices`, o contactá soporte con el CAE de la NC.',
                creditNoteEmitted: true,
                creditNote: {
                    id: creditNoteId,
                    cae: ncResult.cae,
                    puntoVta: ncResult.puntoVta,
                    cbteTipo: ncResult.cbteTipo,
                    cbteDesde: ncResult.cbteDesde,
                    cbteHasta: ncResult.cbteHasta
                },
                detail: (faErr === null || faErr === void 0 ? void 0 : faErr.message) || String(faErr)
            });
        }
    }
    catch (error) {
        console.error('reemitirFacturaConAgip:', error);
        const msg = (error === null || error === void 0 ? void 0 : error.message) || 'Error reemitiendo factura con IIBB';
        const status = msg.includes('no configurado') ? 503 : 500;
        res.status(status).json({ message: msg });
    }
});
exports.reemitirFacturaConAgip = reemitirFacturaConAgip;
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
                orderDate: inv.order_date || inv.created_at || '',
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
        const agip = yield getAgipRetentionForOrder({
            orderDate: orderRow.date,
            customerCuit: customerRow.cuit,
            netAmount: totalForAfip
        });
        const iibbPercepcion = agip && agip.amount > 0.005
            ? { baseImp: totalForAfip, alicuota: agip.alicuota, importe: agip.amount }
            : undefined;
        const { emitirFactura: emitirAfip } = yield Promise.resolve().then(() => __importStar(require('../services/afip.service')));
        const result = yield emitirAfip({
            id: orderRow.id,
            date: orderRow.date,
            total: totalForAfip,
            customerId: orderRow.customer_id,
            iibbPercepcion: iibbPercepcion !== null && iibbPercepcion !== void 0 ? iibbPercepcion : null
        }, {
            id: customerRow.id,
            businessName: (_d = customerRow.business_name) !== null && _d !== void 0 ? _d : '',
            cuit: customerRow.cuit,
            condicionIva: (_e = customerRow.condicion_iva) !== null && _e !== void 0 ? _e : null
        }, forceCbteTipo);
        const { v4: uuidv4 } = yield Promise.resolve().then(() => __importStar(require('uuid')));
        const invoiceId = uuidv4();
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
/** Lista las notas de crédito emitidas para un pedido.
 *  Una misma NC AFIP puede haberse guardado como N filas (una por ítem creditado),
 *  todas con el mismo (cae, punto_venta, cbte_tipo, cbte_desde, cbte_hasta).
 *  Devolvemos UNA entrada por comprobante, consolidando el detalle por ítem
 *  para que el PDF muestre todos los renglones (no solo el primero).
 */
const getOrderCreditNotes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ message: 'ID de pedido inválido' });
    try {
        const rows = (yield (0, db_1.query)(`SELECT id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index, created_at,
              voided_invoice_cae, voided_invoice_punto_venta, voided_invoice_cbte_tipo, voided_invoice_cbte_desde,
              COALESCE(superseded_by_reinvoice, 0) AS superseded_by_reinvoice
       FROM credit_notes WHERE order_id = ? ORDER BY created_at DESC, id ASC`, [id]));
        // Necesitamos los precios de los ítems para inferir cantidades por línea.
        const itemRows = (yield (0, db_1.query)(`SELECT quantity, price_at_moment FROM order_items WHERE order_id = ? ORDER BY id ASC`, [id]));
        const itemPriceByIndex = new Map();
        itemRows.forEach((it, idx) => itemPriceByIndex.set(idx, Number(it.price_at_moment) || 0));
        const groups = new Map();
        for (const r of rows) {
            const key = `${(_a = r.cae) !== null && _a !== void 0 ? _a : ''}|${(_b = r.punto_venta) !== null && _b !== void 0 ? _b : ''}|${(_c = r.cbte_tipo) !== null && _c !== void 0 ? _c : ''}|${(_d = r.cbte_desde) !== null && _d !== void 0 ? _d : ''}|${(_e = r.cbte_hasta) !== null && _e !== void 0 ? _e : ''}`;
            let g = groups.get(key);
            if (!g) {
                g = {
                    id: r.id,
                    orderId: r.order_id,
                    invoiceId: (_f = r.invoice_id) !== null && _f !== void 0 ? _f : null,
                    cae: r.cae,
                    caeFchVto: (_g = r.cae_fch_vto) !== null && _g !== void 0 ? _g : undefined,
                    puntoVta: r.punto_venta,
                    cbteTipo: r.cbte_tipo,
                    cbteDesde: r.cbte_desde,
                    cbteHasta: r.cbte_hasta,
                    amountCredited: 0,
                    scope: ((_h = r.scope) !== null && _h !== void 0 ? _h : 'total'),
                    itemIndex: (_j = r.item_index) !== null && _j !== void 0 ? _j : undefined,
                    itemIndexes: [],
                    amountByItemIndex: {},
                    quantityByItemIndex: {},
                    createdAt: (_k = r.created_at) !== null && _k !== void 0 ? _k : null,
                    voidedInvoice: r.voided_invoice_cae
                        ? {
                            cae: String(r.voided_invoice_cae),
                            puntoVta: r.voided_invoice_punto_venta != null ? Number(r.voided_invoice_punto_venta) : undefined,
                            cbteTipo: r.voided_invoice_cbte_tipo != null ? Number(r.voided_invoice_cbte_tipo) : undefined,
                            cbteDesde: Number(r.voided_invoice_cbte_desde),
                        }
                        : undefined,
                    supersededByReinvoice: !!Number(r.superseded_by_reinvoice),
                };
                groups.set(key, g);
            }
            const amount = Number(r.amount_credited || 0);
            g.amountCredited = Math.round((g.amountCredited + amount) * 100) / 100;
            // Si al menos una fila es 'item' o tiene item_index, considerar el grupo como 'item'.
            if (((_l = r.scope) !== null && _l !== void 0 ? _l : 'total') === 'item' || r.item_index != null) {
                g.scope = 'item';
                const idx = Number(r.item_index);
                if (Number.isInteger(idx) && idx >= 0) {
                    if (!g.itemIndexes.includes(idx))
                        g.itemIndexes.push(idx);
                    g.amountByItemIndex[idx] = Math.round(((g.amountByItemIndex[idx] || 0) + amount) * 100) / 100;
                    const price = itemPriceByIndex.get(idx) || 0;
                    if (price > 0) {
                        const q = amount / price;
                        g.quantityByItemIndex[idx] = Math.round(((g.quantityByItemIndex[idx] || 0) + q) * 1000) / 1000;
                    }
                }
            }
        }
        // Ordenar grupos por fecha desc (los más recientes primero).
        const out = Array.from(groups.values()).sort((a, b) => {
            const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return db - da;
        });
        res.json(out);
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
        const invRow = yield (0, db_1.get)('SELECT id, punto_venta, cbte_tipo, cbte_desde, cae, agip_alicuota, agip_ret_per FROM invoices WHERE order_id = ?', [id]);
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
        const netFromOrder = yield getOrderNetFromLineItems(id);
        const netOrderTotal = netFromOrder > 0 ? netFromOrder : Number(orderRow.total) || 0;
        const iibbNc = iibbPercepcionForOrderCreditNote(Number(invRow.agip_alicuota || 0), Number(invRow.agip_ret_per || 0), amountToCredit, netOrderTotal);
        const { emitirNotaCredito: emitirNCAfip } = yield Promise.resolve().then(() => __importStar(require('../services/afip.service')));
        const result = yield emitirNCAfip({ puntoVta: invRow.punto_venta, cbteTipo: invRow.cbte_tipo, cbteDesde: invRow.cbte_desde }, { id: customerRow.id, businessName: (_b = customerRow.business_name) !== null && _b !== void 0 ? _b : '', cuit: customerRow.cuit, condicionIva: (_c = customerRow.condicion_iva) !== null && _c !== void 0 ? _c : undefined }, amountToCredit, iibbNc);
        const scope = tipo === 'items' ? 'item' : tipo;
        const itemIndexVal = tipo === 'item' ? (typeof itemIndex === 'number' ? itemIndex : parseInt(String(itemIndex), 10)) : null;
        const firstCreditNoteId = (0, uuid_1.v4)();
        if (tipo === 'items') {
            for (let i = 0; i < itemsToCredit.length; i++) {
                const it = itemsToCredit[i];
                yield (0, db_1.execute)(`INSERT INTO credit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index,
            voided_invoice_cae, voided_invoice_punto_venta, voided_invoice_cbte_tipo, voided_invoice_cbte_desde, superseded_by_reinvoice)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0)`, [
                    i === 0 ? firstCreditNoteId : (0, uuid_1.v4)(),
                    id,
                    invRow.id,
                    result.cae,
                    result.caeFchVto || null,
                    result.puntoVta,
                    result.cbteTipo,
                    result.cbteDesde,
                    result.cbteHasta,
                    it.amount,
                    'item',
                    it.itemIndex,
                ]);
            }
        }
        else {
            if (tipo === 'total') {
                yield (0, db_1.execute)(`INSERT INTO credit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index,
            voided_invoice_cae, voided_invoice_punto_venta, voided_invoice_cbte_tipo, voided_invoice_cbte_desde, superseded_by_reinvoice)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    firstCreditNoteId,
                    id,
                    invRow.id,
                    result.cae,
                    result.caeFchVto || null,
                    result.puntoVta,
                    result.cbteTipo,
                    result.cbteDesde,
                    result.cbteHasta,
                    amountToCredit,
                    scope,
                    itemIndexVal,
                    invRow.cae,
                    invRow.punto_venta,
                    invRow.cbte_tipo,
                    invRow.cbte_desde,
                    0,
                ]);
            }
            else {
                yield (0, db_1.execute)(`INSERT INTO credit_notes (id, order_id, invoice_id, cae, cae_fch_vto, punto_venta, cbte_tipo, cbte_desde, cbte_hasta, amount_credited, scope, item_index,
            voided_invoice_cae, voided_invoice_punto_venta, voided_invoice_cbte_tipo, voided_invoice_cbte_desde, superseded_by_reinvoice)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0)`, [
                    firstCreditNoteId,
                    id,
                    invRow.id,
                    result.cae,
                    result.caeFchVto || null,
                    result.puntoVta,
                    result.cbteTipo,
                    result.cbteDesde,
                    result.cbteHasta,
                    amountToCredit,
                    scope,
                    itemIndexVal,
                ]);
            }
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
