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
exports.EXPRESS_TRACKING_STATUS_LABELS = exports.EXPRESS_TRACKING_STATUSES = void 0;
exports.isExpressTrackingStatus = isExpressTrackingStatus;
exports.expressTrackingStatusLabel = expressTrackingStatusLabel;
exports.publicStatusFromManualStatus = publicStatusFromManualStatus;
exports.startExpressTripByTrackingCode = startExpressTripByTrackingCode;
exports.confirmExpressDeliveryByTrackingCode = confirmExpressDeliveryByTrackingCode;
exports.buildManualTrackingEvents = buildManualTrackingEvents;
exports.EXPRESS_TRACKING_STATUSES = [
    'pending',
    'preparing',
    'shipped',
    'delivered',
    'cancelled',
];
exports.EXPRESS_TRACKING_STATUS_LABELS = {
    pending: 'Pendiente',
    preparing: 'En preparación',
    shipped: 'En camino',
    delivered: 'Entregado',
    cancelled: 'Cancelado',
};
const STATUS_RANK = {
    pending: 0,
    preparing: 1,
    shipped: 2,
    delivered: 3,
    cancelled: -1,
};
function isExpressTrackingStatus(value) {
    return typeof value === 'string' && exports.EXPRESS_TRACKING_STATUSES.includes(value);
}
function expressTrackingStatusLabel(status) {
    return exports.EXPRESS_TRACKING_STATUS_LABELS[status] || status;
}
function publicStatusFromManualStatus(status) {
    return { status, statusLabel: expressTrackingStatusLabel(status) };
}
const TRACKING_CODE_RE = /^LHE\d{8}$/i;
function normalizeTrackingCode(trackingCodeRaw) {
    return String(trackingCodeRaw !== null && trackingCodeRaw !== void 0 ? trackingCodeRaw : '').trim().toUpperCase();
}
function parseManualStatus(raw) {
    const key = String(raw || '').toLowerCase();
    return isExpressTrackingStatus(key) ? key : null;
}
/** Marca un envío express como en camino (repartidor escanea QR al salir). */
function startExpressTripByTrackingCode(trackingCodeRaw, deps) {
    return __awaiter(this, void 0, void 0, function* () {
        const trackingCode = normalizeTrackingCode(trackingCodeRaw);
        if (!TRACKING_CODE_RE.test(trackingCode)) {
            return { ok: false, reason: 'invalid_code' };
        }
        const row = yield deps.getRow(trackingCode);
        if (!(row === null || row === void 0 ? void 0 : row.tracking_code)) {
            return { ok: false, reason: 'not_found' };
        }
        const currentStatus = parseManualStatus(row.manual_status);
        if (currentStatus === 'cancelled') {
            return { ok: false, reason: 'cancelled' };
        }
        if (currentStatus === 'delivered') {
            return { ok: false, reason: 'already_delivered' };
        }
        if (currentStatus === 'shipped') {
            return {
                ok: true,
                alreadyStarted: true,
                trackingCode: String(row.tracking_code).toUpperCase(),
                orderNumber: row.order_number || null,
            };
        }
        yield deps.updateShipped(trackingCode);
        return {
            ok: true,
            alreadyStarted: false,
            trackingCode: String(row.tracking_code).toUpperCase(),
            orderNumber: row.order_number || null,
            startedAt: new Date().toISOString(),
        };
    });
}
/** Marca un envío express como entregado por código LHE (repartidor escanea QR al entregar). */
function confirmExpressDeliveryByTrackingCode(trackingCodeRaw, deps) {
    return __awaiter(this, void 0, void 0, function* () {
        const trackingCode = normalizeTrackingCode(trackingCodeRaw);
        if (!TRACKING_CODE_RE.test(trackingCode)) {
            return { ok: false, reason: 'invalid_code' };
        }
        const row = yield deps.getRow(trackingCode);
        if (!(row === null || row === void 0 ? void 0 : row.tracking_code)) {
            return { ok: false, reason: 'not_found' };
        }
        const currentStatus = parseManualStatus(row.manual_status);
        if (currentStatus === 'cancelled') {
            return { ok: false, reason: 'cancelled' };
        }
        if (currentStatus === 'delivered') {
            return {
                ok: true,
                alreadyDelivered: true,
                trackingCode: String(row.tracking_code).toUpperCase(),
                orderNumber: row.order_number || null,
            };
        }
        if (currentStatus !== 'shipped') {
            return { ok: false, reason: 'not_ready' };
        }
        yield deps.updateDelivered(trackingCode);
        return {
            ok: true,
            alreadyDelivered: false,
            trackingCode: String(row.tracking_code).toUpperCase(),
            orderNumber: row.order_number || null,
            deliveredAt: new Date().toISOString(),
        };
    });
}
function buildManualTrackingEvents(manualStatus, opts) {
    const rank = STATUS_RANK[manualStatus];
    const isCancelled = manualStatus === 'cancelled';
    const updatedAt = opts.manualStatusUpdatedAt || null;
    const push = (events, key, label, at, done) => {
        events.push({ key, label, at, done });
    };
    const events = [];
    push(events, 'created', 'Pedido registrado', opts.orderCreatedAt || null, true);
    push(events, 'tracking', 'Código de seguimiento generado', opts.trackingAssignedAt, !!opts.trackingAssignedAt);
    push(events, 'paid', 'Pago confirmado', opts.orderPaidAt || opts.trackingAssignedAt || null, !isCancelled && rank >= STATUS_RANK.preparing);
    push(events, 'preparing', 'En preparación', rank >= STATUS_RANK.preparing ? updatedAt || opts.trackingAssignedAt : null, !isCancelled && rank >= STATUS_RANK.preparing);
    push(events, 'shipped', 'Despachado', rank >= STATUS_RANK.shipped ? updatedAt : null, !isCancelled && rank >= STATUS_RANK.shipped);
    push(events, 'delivered', 'Entregado', rank >= STATUS_RANK.delivered ? updatedAt : null, !isCancelled && rank >= STATUS_RANK.delivered);
    if (isCancelled) {
        push(events, 'cancelled', 'Pedido cancelado', updatedAt, true);
    }
    return events;
}
