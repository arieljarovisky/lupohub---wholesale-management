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
exports.importMultimediaHistorial = exports.exportMultimediaHistorial = void 0;
const XLSX = __importStar(require("xlsx"));
const uuid_1 = require("uuid");
const db_1 = require("../database/db");
const multimediaHistorialExcel_1 = require("../utils/multimediaHistorialExcel");
function normalizeNameForMatch(v) {
    return String(v !== null && v !== void 0 ? v : '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}
function canManage(role) {
    return role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';
}
function padLegacyCode(code) {
    const t = code.trim();
    if (/^\d+$/.test(t) && t.length < 6)
        return t.padStart(6, '0');
    return t;
}
function resolveCustomerForSheet(sheetName, parsed, customerByLegacy, customerByNorm) {
    return __awaiter(this, void 0, void 0, function* () {
        const fromName = (0, multimediaHistorialExcel_1.parseSheetName)(sheetName);
        const codeCandidates = new Set();
        if (parsed === null || parsed === void 0 ? void 0 : parsed.code)
            codeCandidates.add(padLegacyCode(parsed.code));
        if (fromName === null || fromName === void 0 ? void 0 : fromName.code)
            codeCandidates.add(padLegacyCode(fromName.code));
        for (const c of codeCandidates) {
            const hit = customerByLegacy.get(c) || customerByLegacy.get(c.replace(/^0+/, '') || '0');
            if (hit)
                return hit;
        }
        const normTitle = normalizeNameForMatch((parsed === null || parsed === void 0 ? void 0 : parsed.businessNameFromTitle) || '');
        if (normTitle && customerByNorm.has(normTitle))
            return customerByNorm.get(normTitle);
        if (fromName === null || fromName === void 0 ? void 0 : fromName.restName) {
            const n = normalizeNameForMatch(fromName.restName);
            if (n && customerByNorm.has(n))
                return customerByNorm.get(n);
        }
        return null;
    });
}
function movementToSqlDates(m) {
    const lineDate = (0, multimediaHistorialExcel_1.parseArgentineDateDisplay)(m.fecha);
    const vtoRaw = m.vto.trim();
    const vto = vtoRaw ? (0, multimediaHistorialExcel_1.parseArgentineDateDisplay)(vtoRaw) : null;
    return { lineDate, vto };
}
/** GET → Excel mismo formato que historial Multimedias */
const exportMultimediaHistorial = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const user = req.user;
        if (!user || !canManage(user.role)) {
            return res.status(403).json({ message: 'Sin permiso' });
        }
        const sellerFilter = user.role === 'SELLER' ? ' WHERE c.seller_id = ?' : '';
        const params = user.role === 'SELLER' ? [user.id] : [];
        const custRows = (yield (0, db_1.query)(`SELECT c.id, c.legacy_code, c.business_name, c.name, c.account_zone, c.account_seller_label,
              c.seller_id, u.name AS seller_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.seller_id
       ${sellerFilter}
       ORDER BY COALESCE(c.legacy_code, c.business_name, c.name) ASC`, params));
        const resumenRows = [
            ['Código', 'Cliente', 'Vendedor habitual', 'Zona', 'Saldo final', 'Movimientos', 'Hoja'],
        ];
        const sheetsOut = [];
        const usedSheetNames = new Set();
        for (const c of custRows) {
            const code = (c.legacy_code && String(c.legacy_code).trim()) ||
                (String(c.id).replace(/-/g, '').slice(0, 6) || '000000');
            const displayName = (c.business_name || c.name || 'Cliente').trim();
            const baseTitle = (0, multimediaHistorialExcel_1.excelSheetName)(code, displayName);
            let sheetNm = baseTitle.slice(0, 31);
            let dup = 1;
            while (usedSheetNames.has(sheetNm)) {
                const extra = ` (${dup++})`;
                sheetNm = (baseTitle.slice(0, Math.max(1, 31 - extra.length)) + extra).slice(0, 31);
            }
            usedSheetNames.add(sheetNm);
            const entries = (yield (0, db_1.query)(`SELECT line_order, line_date, tipo, numero, edc, vto, importe, saldo, detalle, pagina_pdf
         FROM customer_multimedia_entries
         WHERE customer_id = ?
         ORDER BY line_order ASC, line_date ASC`, [c.id]));
            const vendedor = (c.account_seller_label && String(c.account_seller_label).trim()) ||
                (c.seller_id && c.seller_name ? `${String(c.seller_id).slice(0, 8)} - ${c.seller_name}` : '');
            const zona = (c.account_zone && String(c.account_zone).trim()) || '';
            let saldoFinal = 0;
            let movCount = entries.length;
            if (entries.length > 0) {
                const last = entries[entries.length - 1];
                saldoFinal = Number(last.saldo) || 0;
            }
            resumenRows.push([code, displayName, vendedor, zona, saldoFinal, movCount, sheetNm]);
            const grid = [];
            grid.push([`Cliente ${code} - ${displayName}`, '', '', '', '', '', '', '', '']);
            grid.push([
                'Código',
                code,
                'Vendedor habitual',
                vendedor,
                'Zona',
                zona,
                'Saldo final',
                saldoFinal,
                '',
            ]);
            grid.push(['', '', '', '', '', '', '', '', '']);
            grid.push(['Fecha', 'Tipo', 'Número', 'EDC', 'Vto.', 'Importe', 'Saldo', 'Vendedor / detalle', 'Página PDF']);
            if (entries.length === 0) {
                grid.push(['31/12/2014', 'SALDO AL', '', '', '', '', 0, 'Saldo inicial', 1]);
            }
            else {
                for (const e of entries) {
                    grid.push([
                        (0, multimediaHistorialExcel_1.sqlDateToDisplay)(e.line_date),
                        (_a = e.tipo) !== null && _a !== void 0 ? _a : '',
                        (_b = e.numero) !== null && _b !== void 0 ? _b : '',
                        (_c = e.edc) !== null && _c !== void 0 ? _c : '',
                        e.vto ? (0, multimediaHistorialExcel_1.sqlDateToDisplay)(e.vto) : '',
                        e.importe != null ? Number(e.importe) : '',
                        e.saldo != null ? Number(e.saldo) : '',
                        (_d = e.detalle) !== null && _d !== void 0 ? _d : '',
                        e.pagina_pdf != null && e.pagina_pdf !== '' ? Number(e.pagina_pdf) || e.pagina_pdf : '',
                    ]);
                }
            }
            sheetsOut.push({ name: sheetNm.slice(0, 31), data: grid });
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenRows), 'Resumen');
        for (const s of sheetsOut) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.data), s.name);
        }
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="historial_clientes_multimedias.xlsx"');
        res.send(buf);
    }
    catch (e) {
        console.error('exportMultimediaHistorial:', e);
        res.status(500).json({ message: 'Error exportando historial', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.exportMultimediaHistorial = exportMultimediaHistorial;
/** POST multipart file → importa movimientos por cliente */
const importMultimediaHistorial = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    try {
        const user = req.user;
        if (!user || !canManage(user.role)) {
            return res.status(403).json({ message: 'Sin permiso' });
        }
        const file = req.file;
        if (!(file === null || file === void 0 ? void 0 : file.buffer)) {
            return res.status(400).json({ message: 'Subí un archivo .xlsx (campo file)' });
        }
        const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
        const customers = (yield (0, db_1.query)(`SELECT id, business_name, name, seller_id, legacy_code FROM customers`));
        const customerByLegacy = new Map();
        const customerByNorm = new Map();
        for (const c of customers) {
            if (c.legacy_code) {
                const lc = String(c.legacy_code).trim();
                if (lc) {
                    customerByLegacy.set(lc, { id: c.id, seller_id: (_a = c.seller_id) !== null && _a !== void 0 ? _a : null });
                    customerByLegacy.set(padLegacyCode(lc), { id: c.id, seller_id: (_b = c.seller_id) !== null && _b !== void 0 ? _b : null });
                }
            }
            const k1 = normalizeNameForMatch(c.business_name);
            const k2 = normalizeNameForMatch(c.name);
            if (k1 && !customerByNorm.has(k1))
                customerByNorm.set(k1, { id: c.id, seller_id: (_c = c.seller_id) !== null && _c !== void 0 ? _c : null });
            if (k2 && !customerByNorm.has(k2))
                customerByNorm.set(k2, { id: c.id, seller_id: (_d = c.seller_id) !== null && _d !== void 0 ? _d : null });
        }
        let sheetsProcessed = 0;
        let customersUpdated = 0;
        let rowsInserted = 0;
        const notFound = [];
        const skippedSeller = [];
        for (const sheetName of wb.SheetNames) {
            if (sheetName === 'Resumen')
                continue;
            const ws = wb.Sheets[sheetName];
            if (!ws)
                continue;
            const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            const parsed = (0, multimediaHistorialExcel_1.parseCustomerSheetRows)(matrix);
            if (!parsed)
                continue;
            const cust = yield resolveCustomerForSheet(sheetName, parsed, customerByLegacy, customerByNorm);
            if (!cust) {
                notFound.push(sheetName);
                continue;
            }
            if (user.role === 'SELLER' && cust.seller_id !== user.id) {
                skippedSeller.push(sheetName);
                continue;
            }
            sheetsProcessed++;
            const legacy = padLegacyCode(parsed.code || ((_e = (0, multimediaHistorialExcel_1.parseSheetName)(sheetName)) === null || _e === void 0 ? void 0 : _e.code) || '');
            yield (0, db_1.execute)(`UPDATE customers SET legacy_code = ?, account_zone = ?, account_seller_label = ? WHERE id = ?`, [legacy || null, ((_f = parsed.zona) === null || _f === void 0 ? void 0 : _f.trim()) || null, ((_g = parsed.vendedorHabitual) === null || _g === void 0 ? void 0 : _g.trim()) || null, cust.id]);
            customersUpdated++;
            yield (0, db_1.execute)(`DELETE FROM customer_multimedia_entries WHERE customer_id = ?`, [cust.id]);
            let order = 0;
            for (const m of parsed.movements) {
                const { lineDate, vto } = movementToSqlDates(m);
                if (!lineDate)
                    continue;
                const tipo = (m.tipo || '').trim();
                if (!tipo)
                    continue;
                yield (0, db_1.execute)(`INSERT INTO customer_multimedia_entries
           (id, customer_id, line_order, line_date, tipo, numero, edc, vto, importe, saldo, detalle, pagina_pdf)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    (0, uuid_1.v4)(),
                    cust.id,
                    order++,
                    lineDate,
                    tipo,
                    ((_h = m.numero) === null || _h === void 0 ? void 0 : _h.trim()) || null,
                    ((_j = m.edc) === null || _j === void 0 ? void 0 : _j.trim()) || null,
                    vto,
                    m.importe,
                    m.saldo,
                    ((_k = m.detalle) === null || _k === void 0 ? void 0 : _k.trim()) || null,
                    ((_l = m.paginaPdf) === null || _l === void 0 ? void 0 : _l.trim()) || null,
                ]);
                rowsInserted++;
            }
            if (legacy) {
                customerByLegacy.set(legacy, cust);
                customerByLegacy.set(padLegacyCode(legacy), cust);
            }
        }
        res.json({
            message: 'Importación de historial Multimedias finalizada',
            sheetsProcessed,
            customersUpdated,
            rowsInserted,
            notFoundSheets: notFound.slice(0, 50),
            notFoundCount: notFound.length,
            skippedNotYourCustomer: skippedSeller.slice(0, 20),
            skippedCount: skippedSeller.length,
        });
    }
    catch (e) {
        console.error('importMultimediaHistorial:', e);
        res.status(500).json({ message: 'Error importando historial', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.importMultimediaHistorial = importMultimediaHistorial;
