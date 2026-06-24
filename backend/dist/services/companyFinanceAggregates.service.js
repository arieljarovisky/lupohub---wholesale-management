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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sumInvoicedInRange = sumInvoicedInRange;
exports.sumReceiptsInRange = sumReceiptsInRange;
exports.sumDespachosCostInRange = sumDespachosCostInRange;
exports.aggregateTiendaNubeInRange = aggregateTiendaNubeInRange;
exports.aggregateMercadoLibreInRange = aggregateMercadoLibreInRange;
exports.listPendingInvoices = listPendingInvoices;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const integrations_controller_1 = require("../controllers/integrations.controller");
const channelMarginUtils_1 = require("../utils/channelMarginUtils");
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
function round2(n) {
    return Math.round(n * 100) / 100;
}
function orderDateInRange(isoDate, from, to) {
    if (!isoDate)
        return false;
    const ymd = isoDate.slice(0, 10);
    return ymd >= from && ymd <= to;
}
function isTnOrderPaid(order) {
    var _a;
    const rawPaymentStatus = String((_a = order.payment_status) !== null && _a !== void 0 ? _a : '').trim().toLowerCase();
    const paymentDetails = Array.isArray(order.payment_details) ? order.payment_details : [];
    const detailStates = paymentDetails
        .map((d) => { var _a, _b; return String((_b = (_a = d === null || d === void 0 ? void 0 : d.status) !== null && _a !== void 0 ? _a : d === null || d === void 0 ? void 0 : d.state) !== null && _b !== void 0 ? _b : '').trim().toLowerCase(); })
        .filter(Boolean);
    const looksRefunded = rawPaymentStatus === 'refunded' || detailStates.some((s) => s === 'refunded');
    const looksPartiallyRefunded = rawPaymentStatus === 'partially_refunded' || detailStates.some((s) => s === 'partially_refunded');
    const looksVoided = rawPaymentStatus === 'voided' ||
        rawPaymentStatus === 'cancelled' ||
        detailStates.some((s) => s.includes('void') || s === 'cancelled' || s === 'canceled');
    if (looksRefunded || looksVoided)
        return false;
    return (rawPaymentStatus === 'paid' ||
        rawPaymentStatus === 'partially_paid' ||
        looksPartiallyRefunded ||
        !!order.paid_at ||
        detailStates.some((s) => s === 'paid' || s === 'approved' || s === 'accredited' || s === 'captured'));
}
/**
 * Suma facturas AFIP emitidas en el rango (por `invoices.created_at`).
 * - `net`: suma de `orders.total - notas_credito` (neto sin IVA).
 * - `iva`: 21% sobre el neto.
 * - `total`: net + iva (importe del comprobante con IVA).
 * Misma fórmula que `listPendingInvoices` para consistencia.
 */
function sumInvoicedInRange(from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const row = (yield (0, db_1.get)(`SELECT
       COALESCE(SUM(GREATEST(0, o.total - COALESCE(cn.cn_total, 0))), 0) AS net,
       COUNT(*) AS cnt
     FROM invoices i
     INNER JOIN orders o ON o.id = i.order_id
     LEFT JOIN (
       SELECT order_id, SUM(amount_credited) AS cn_total
       FROM credit_notes
       GROUP BY order_id
     ) cn ON cn.order_id = o.id
     WHERE DATE(i.created_at) >= ? AND DATE(i.created_at) <= ?`, [from, to]));
        const net = round2(Number((_a = row === null || row === void 0 ? void 0 : row.net) !== null && _a !== void 0 ? _a : 0));
        const total = round2(net * 1.21);
        const iva = round2(total - net);
        return { total, net, iva, count: Number((_b = row === null || row === void 0 ? void 0 : row.cnt) !== null && _b !== void 0 ? _b : 0) };
    });
}
function sumReceiptsInRange(from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const row = (yield (0, db_1.get)(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
     FROM payments WHERE date >= ? AND date <= ?`, [from, to]));
        return { total: round2(Number((_a = row === null || row === void 0 ? void 0 : row.total) !== null && _a !== void 0 ? _a : 0)), count: Number((_b = row === null || row === void 0 ? void 0 : row.cnt) !== null && _b !== void 0 ? _b : 0) };
    });
}
function sumDespachosCostInRange(from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const rows = (yield (0, db_1.query)(`SELECT d.id, d.valor_cif, d.valor_fob
     FROM despachos d
     WHERE d.fecha_despacho >= ? AND d.fecha_despacho <= ?`, [from, to]));
        let total = 0;
        for (const d of rows) {
            const cif = Number(d.valor_cif);
            const fob = Number(d.valor_fob);
            if (Number.isFinite(cif) && cif > 0) {
                total += cif;
                continue;
            }
            if (Number.isFinite(fob) && fob > 0) {
                total += fob;
                continue;
            }
            const itemsRow = (yield (0, db_1.get)(`SELECT COALESCE(SUM(cantidad * COALESCE(costo_unitario, 0)), 0) AS sub
       FROM despacho_items WHERE despacho_id = ?`, [d.id]));
            total += Number((_a = itemsRow === null || itemsRow === void 0 ? void 0 : itemsRow.sub) !== null && _a !== void 0 ? _a : 0);
        }
        return { total: round2(total), count: rows.length };
    });
}
function fetchTnOrdersInRange(from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token))
            return [];
        const storeId = integration.store_id || integration.user_id;
        if (!storeId)
            return [];
        const minIso = `${from}T00:00:00-03:00`;
        const maxIso = `${to}T23:59:59-03:00`;
        const perPage = 200;
        let page = 1;
        const rawOrders = [];
        while (page <= 400) {
            const response = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/orders`, {
                headers: {
                    Authentication: `bearer ${integration.access_token}`,
                    'User-Agent': TN_USER_AGENT,
                },
                params: { page, per_page: perPage, created_at_min: minIso, created_at_max: maxIso },
                validateStatus: () => true,
            });
            if (response.status !== 200)
                break;
            const batch = Array.isArray(response.data) ? response.data : [];
            if (batch.length === 0)
                break;
            rawOrders.push(...batch);
            if (batch.length < perPage)
                break;
            page += 1;
        }
        return rawOrders;
    });
}
function aggregateTiendaNubeInRange(from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const orders = yield fetchTnOrdersInRange(from, to);
        if (orders.length === 0) {
            const integration = yield (0, db_1.get)(`SELECT id FROM integrations WHERE platform = 'tiendanube' LIMIT 1`);
            return { sales: 0, fees: 0, orderCount: 0, connected: !!integration };
        }
        const preset = (0, channelMarginUtils_1.resolveTnFeePreset)();
        let sales = 0;
        let fees = 0;
        let orderCount = 0;
        for (const order of orders) {
            if (!isTnOrderPaid(order))
                continue;
            const created = String((_b = (_a = order.created_at) !== null && _a !== void 0 ? _a : order.paid_at) !== null && _b !== void 0 ? _b : '');
            if (!orderDateInRange(created, from, to))
                continue;
            const total = Math.max(0, Number(order.total) || 0);
            if (total <= 0)
                continue;
            sales += total;
            fees += (0, channelMarginUtils_1.calcTnSaleFeeFromPreset)(total, preset).total;
            orderCount += 1;
        }
        return {
            sales: round2(sales),
            fees: round2(fees),
            orderCount,
            connected: true,
            note: `Comisiones TN estimadas (${preset.label})`,
        };
    });
}
function multigetMlItems(accessToken, itemIds) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const map = new Map();
        const unique = [...new Set(itemIds.filter(Boolean))];
        for (let i = 0; i < unique.length; i += 20) {
            const chunk = unique.slice(i, i + 20);
            try {
                const res = yield axios_1.default.get('https://api.mercadolibre.com/items', {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    params: { ids: chunk.join(',') },
                    validateStatus: () => true,
                });
                if (res.status !== 200 || !Array.isArray(res.data))
                    continue;
                for (const entry of res.data) {
                    const body = entry === null || entry === void 0 ? void 0 : entry.body;
                    const id = String((_a = body === null || body === void 0 ? void 0 : body.id) !== null && _a !== void 0 ? _a : '');
                    if (id && body)
                        map.set(id, body);
                }
            }
            catch (_b) {
                /* omitir lote */
            }
        }
        return map;
    });
}
function aggregateMercadoLibreInRange(from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const mlToken = yield (0, integrations_controller_1.getValidMLToken)();
        if (!(mlToken === null || mlToken === void 0 ? void 0 : mlToken.access_token) || !(mlToken === null || mlToken === void 0 ? void 0 : mlToken.user_id)) {
            return { sales: 0, fees: 0, orderCount: 0, connected: false };
        }
        const cptPercent = (0, channelMarginUtils_1.getMlPaymentCptPercent)();
        const feeCache = new Map();
        const itemIds = [];
        const lines = [];
        let offset = 0;
        const limit = 50;
        let orderCount = 0;
        while (offset < 5000) {
            const searchRes = yield axios_1.default.get('https://api.mercadolibre.com/orders/search', {
                headers: { Authorization: `Bearer ${mlToken.access_token}` },
                params: {
                    seller: mlToken.user_id,
                    'order.status': 'paid',
                    'order.date_created.from': `${from}T00:00:00.000-03:00`,
                    'order.date_created.to': `${to}T23:59:59.999-03:00`,
                    offset,
                    limit,
                    sort: 'date_desc',
                },
                validateStatus: () => true,
            });
            if (searchRes.status !== 200)
                break;
            const results = Array.isArray((_a = searchRes.data) === null || _a === void 0 ? void 0 : _a.results) ? searchRes.data.results : [];
            if (results.length === 0)
                break;
            for (const order of results) {
                const created = String((_c = (_b = order === null || order === void 0 ? void 0 : order.date_created) !== null && _b !== void 0 ? _b : order === null || order === void 0 ? void 0 : order.date_closed) !== null && _c !== void 0 ? _c : '');
                if (!orderDateInRange(created, from, to))
                    continue;
                orderCount += 1;
                const items = Array.isArray(order === null || order === void 0 ? void 0 : order.order_items) ? order.order_items : [];
                for (const oi of items) {
                    const itemId = String((_e = (_d = oi === null || oi === void 0 ? void 0 : oi.item) === null || _d === void 0 ? void 0 : _d.id) !== null && _e !== void 0 ? _e : '');
                    const qty = Math.max(0, Number(oi === null || oi === void 0 ? void 0 : oi.quantity) || 0);
                    const unitPrice = Math.max(0, Number(oi === null || oi === void 0 ? void 0 : oi.unit_price) || 0);
                    if (!itemId || qty <= 0 || unitPrice <= 0)
                        continue;
                    itemIds.push(itemId);
                    lines.push({ itemId, unitPrice, qty });
                }
            }
            if (results.length < limit)
                break;
            offset += limit;
        }
        const itemsMap = yield multigetMlItems(mlToken.access_token, itemIds);
        let sales = 0;
        let fees = 0;
        for (const line of lines) {
            const subtotal = line.unitPrice * line.qty;
            sales += subtotal;
            const item = itemsMap.get(line.itemId);
            if (item) {
                const listingFee = yield (0, channelMarginUtils_1.fetchListingSaleFeeAmount)(mlToken.access_token, item, line.unitPrice, feeCache);
                fees += listingFee * line.qty;
            }
            fees += (0, channelMarginUtils_1.calcMlPaymentCpt)(subtotal, cptPercent);
        }
        return {
            sales: round2(sales),
            fees: round2(fees),
            orderCount,
            connected: true,
            note: `Comisiones ML estimadas (listing_prices + CPT ${cptPercent}%)`,
        };
    });
}
function listPendingInvoices() {
    return __awaiter(this, arguments, void 0, function* (limit = 200) {
        const rows = (yield (0, db_1.query)(`SELECT
       o.id AS orderId,
       DATE_FORMAT(o.date, '%Y-%m-%d') AS orderDate,
       COALESCE(c.business_name, c.name, '') AS customerName,
       i.punto_venta AS puntoVenta,
       i.cbte_tipo AS cbteTipo,
       i.cbte_desde AS cbteDesde,
       o.status AS orderStatus,
       ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2) AS amountWithIva
     FROM orders o
     INNER JOIN customers c ON c.id = o.customer_id
     INNER JOIN invoices i ON i.order_id = o.id
     LEFT JOIN (
       SELECT order_id, SUM(amount_credited) AS cn_total
       FROM credit_notes
       GROUP BY order_id
     ) cn ON cn.order_id = o.id
     WHERE o.payment_status = 'pendiente'
       AND o.status NOT IN ('Cancelado', 'Borrador')
       AND (o.archived = 0 OR o.archived IS NULL)
     ORDER BY o.date ASC
     LIMIT ?`, [Math.min(500, Math.max(1, limit))]));
        const items = rows.map((r) => ({
            orderId: r.orderId,
            orderDate: r.orderDate,
            customerName: r.customerName,
            invoiceLabel: `${r.puntoVenta}-${String(r.cbteTipo).padStart(2, '0')}-${r.cbteDesde}`,
            amountWithIva: round2(Number(r.amountWithIva)),
            orderStatus: r.orderStatus,
        }));
        const totalPending = round2(items.reduce((acc, r) => acc + r.amountWithIva, 0));
        return { items, totalPending };
    });
}
