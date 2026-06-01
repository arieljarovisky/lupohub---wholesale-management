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
exports.getMercadoPagoAccessToken = getMercadoPagoAccessToken;
exports.fetchMercadoPagoMovements = fetchMercadoPagoMovements;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const MP_API = 'https://api.mercadopago.com';
const MAX_PAGES = 80;
const PAGE_SIZE = 100;
function round2(n) {
    return Math.round(n * 100) / 100;
}
function dateInRange(iso, from, to) {
    const ymd = iso.slice(0, 10);
    return ymd >= from && ymd <= to;
}
function getMercadoPagoAccessToken() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const env = (_a = process.env.MERCADOPAGO_ACCESS_TOKEN) === null || _a === void 0 ? void 0 : _a.trim();
        if (env)
            return env;
        try {
            const row = (yield (0, db_1.get)(`SELECT access_token FROM integrations WHERE platform = 'mercadopago' LIMIT 1`));
            const token = (_b = row === null || row === void 0 ? void 0 : row.access_token) === null || _b === void 0 ? void 0 : _b.trim();
            return token || null;
        }
        catch (_c) {
            return null;
        }
    });
}
function sumPaymentFees(payment) {
    const fees = Array.isArray(payment.fee_details) ? payment.fee_details : [];
    return fees.reduce((sum, f) => {
        return sum + Math.abs(Number(f.amount) || 0);
    }, 0);
}
function mapPaymentToMovement(payment) {
    var _a, _b;
    const status = String(payment.status || '').toLowerCase();
    const dateTime = String(payment.date_approved || payment.date_created || '').trim();
    if (!dateTime)
        return null;
    if (status === 'cancelled' || status === 'rejected')
        return null;
    const gross = round2(Math.abs(Number(payment.transaction_amount) || 0));
    if (gross <= 0)
        return null;
    const feeAmount = round2(sumPaymentFees(payment));
    const netFromApi = Number((_a = payment.transaction_details) === null || _a === void 0 ? void 0 : _a.net_received_amount);
    const netReceived = Number.isFinite(netFromApi) ? round2(Math.abs(netFromApi)) : round2(Math.max(0, gross - feeAmount));
    const isRefund = status === 'refunded' || status === 'charged_back';
    const isApproved = status === 'approved' || status === 'accredited';
    let movementType = 'otro';
    let direction = 'in';
    let netAmount = netReceived;
    if (isRefund) {
        movementType = 'reembolso';
        direction = 'out';
        netAmount = -gross;
    }
    else if (isApproved) {
        movementType = 'cobro';
        direction = 'in';
        netAmount = netReceived;
    }
    else if (status === 'pending' || status === 'in_process' || status === 'in_mediation') {
        movementType = 'pendiente';
        direction = 'in';
        netAmount = gross;
    }
    else {
        movementType = 'otro';
        direction = 'in';
        netAmount = netReceived;
    }
    const payer = payment.payer;
    const descParts = [
        payment.description,
        payer === null || payer === void 0 ? void 0 : payer.email,
        payment.external_reference,
    ]
        .map((x) => (x != null ? String(x).trim() : ''))
        .filter(Boolean);
    return {
        id: String((_b = payment.id) !== null && _b !== void 0 ? _b : ''),
        date: dateTime.slice(0, 10),
        dateTime,
        movementType,
        direction,
        description: descParts.join(' · ') || `Pago MP #${payment.id}`,
        grossAmount: gross,
        feeAmount,
        netAmount,
        status,
        paymentMethod: String(payment.payment_method_id || payment.payment_type_id || ''),
        externalReference: String(payment.external_reference || ''),
    };
}
function fetchMercadoPagoMovements(from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const token = yield getMercadoPagoAccessToken();
        if (!token) {
            return {
                connected: false,
                note: 'Configurá MERCADOPAGO_ACCESS_TOKEN en el backend (token de producción desde developers.mercadopago.com).',
                summary: { count: 0, grossIn: 0, fees: 0, refunds: 0, netIn: 0 },
                movements: [],
            };
        }
        const beginDate = `${from}T00:00:00.000-03:00`;
        const endDate = `${to}T23:59:59.999-03:00`;
        const rawPayments = [];
        let offset = 0;
        let truncated = false;
        while (offset / PAGE_SIZE < MAX_PAGES) {
            const res = yield axios_1.default.get(`${MP_API}/v1/payments/search`, {
                headers: { Authorization: `Bearer ${token}` },
                params: {
                    sort: 'date_created',
                    criteria: 'desc',
                    range: 'date_created',
                    begin_date: beginDate,
                    end_date: endDate,
                    offset,
                    limit: PAGE_SIZE,
                },
                validateStatus: () => true,
                timeout: 45000,
            });
            if (res.status === 401 || res.status === 403) {
                return {
                    connected: false,
                    note: 'Token de Mercado Pago inválido o sin permisos. Revisá MERCADOPAGO_ACCESS_TOKEN.',
                    summary: { count: 0, grossIn: 0, fees: 0, refunds: 0, netIn: 0 },
                    movements: [],
                };
            }
            if (res.status !== 200) {
                const msg = ((_a = res.data) === null || _a === void 0 ? void 0 : _a.message) ||
                    ((_b = res.data) === null || _b === void 0 ? void 0 : _b.error) ||
                    `Error ${res.status} consultando Mercado Pago`;
                return {
                    connected: true,
                    note: msg,
                    summary: { count: 0, grossIn: 0, fees: 0, refunds: 0, netIn: 0 },
                    movements: [],
                };
            }
            const batch = Array.isArray((_c = res.data) === null || _c === void 0 ? void 0 : _c.results) ? res.data.results : [];
            if (batch.length === 0)
                break;
            rawPayments.push(...batch);
            const total = Number((_f = (_e = (_d = res.data) === null || _d === void 0 ? void 0 : _d.paging) === null || _e === void 0 ? void 0 : _e.total) !== null && _f !== void 0 ? _f : 0);
            offset += batch.length;
            if (batch.length < PAGE_SIZE || (total > 0 && offset >= total))
                break;
            if (offset >= MAX_PAGES * PAGE_SIZE) {
                truncated = true;
                break;
            }
        }
        const movements = [];
        for (const payment of rawPayments) {
            const row = mapPaymentToMovement(payment);
            if (!row)
                continue;
            if (!dateInRange(row.dateTime, from, to))
                continue;
            movements.push(row);
        }
        movements.sort((a, b) => b.dateTime.localeCompare(a.dateTime));
        let grossIn = 0;
        let fees = 0;
        let refunds = 0;
        let netIn = 0;
        for (const m of movements) {
            netIn += m.netAmount;
            if (m.direction === 'out') {
                refunds += Math.abs(m.netAmount);
            }
            else if (m.movementType === 'cobro') {
                grossIn += m.grossAmount;
                fees += m.feeAmount;
            }
        }
        return {
            connected: true,
            note: truncated
                ? `Se listaron los primeros ${MAX_PAGES * PAGE_SIZE} pagos del período. Acotá el rango de fechas si falta información.`
                : 'Cobros y reembolsos desde la API de Mercado Pago (pagos del período).',
            summary: {
                count: movements.length,
                grossIn: round2(grossIn),
                fees: round2(fees),
                refunds: round2(refunds),
                netIn: round2(netIn),
            },
            movements,
        };
    });
}
