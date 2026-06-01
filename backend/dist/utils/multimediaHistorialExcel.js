"use strict";
/**
 * Formato Excel "historial_clientes_multimedias": hoja Resumen + una hoja por cliente.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.excelSheetName = exports.parseCustomerSheetRows = exports.parseSheetName = exports.sqlDateToDisplay = exports.parseArgentineDateDisplay = exports.parseArgentineMoneyDisplay = exports.parseResumenCodeToCliente = exports.normalizeCuitDigits = exports.padLegacyCode = void 0;
/** Igual que en import Multimedias: código numérico corto rellenado a 6. */
function padLegacyCode(code) {
    const t = code.trim();
    if (/^\d+$/.test(t) && t.length < 6)
        return t.padStart(6, '0');
    return t;
}
exports.padLegacyCode = padLegacyCode;
/** Solo dígitos, para matchear CUIT (11 u 8–11). */
function normalizeCuitDigits(v) {
    return String(v !== null && v !== void 0 ? v : '').replace(/\D/g, '');
}
exports.normalizeCuitDigits = normalizeCuitDigits;
/**
 * Hoja "Resumen": primera columna código, segunda cliente (como en historial Multimedias).
 * Devuelve mapa código normalizado → nombre de cliente en el Excel.
 */
function parseResumenCodeToCliente(rows) {
    var _a, _b, _c;
    const map = new Map();
    if (!(rows === null || rows === void 0 ? void 0 : rows.length))
        return map;
    let headerRow = -1;
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
        const a = cellStr((_a = rows[r]) === null || _a === void 0 ? void 0 : _a[0]).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (a === 'codigo' || a === 'código') {
            headerRow = r;
            break;
        }
    }
    if (headerRow < 0)
        return map;
    for (let r = headerRow + 1; r < rows.length; r++) {
        const codeRaw = cellStr((_b = rows[r]) === null || _b === void 0 ? void 0 : _b[0]);
        const cliente = cellStr((_c = rows[r]) === null || _c === void 0 ? void 0 : _c[1]);
        if (!codeRaw && !cliente)
            continue;
        if (codeRaw) {
            const code = padLegacyCode(codeRaw);
            if (cliente)
                map.set(code, cliente);
            else
                map.set(code, '');
        }
    }
    return map;
}
exports.parseResumenCodeToCliente = parseResumenCodeToCliente;
function cellStr(v) {
    if (v == null || v === '')
        return '';
    if (v instanceof Date) {
        const d = v.getDate().toString().padStart(2, '0');
        const m = (v.getMonth() + 1).toString().padStart(2, '0');
        const y = v.getFullYear();
        return `${d}/${m}/${y}`;
    }
    return String(v).trim();
}
/**
 * Montos estilo Argentina en PDF/Excel: miles con punto y decimales con coma (952.536,52, 108.911,30),
 * o US (259,742.24). También 108911,30 sin separador de miles.
 */
function parseArgentineMoneyDisplay(s) {
    const raw = String(s !== null && s !== void 0 ? s : '').trim();
    if (!raw)
        return null;
    let t = raw.replace(/\s/g, '');
    const neg = t.startsWith('-');
    if (neg)
        t = t.slice(1);
    if (!t)
        return null;
    // US: 1,234.56 o 259,742.24 (coma miles, punto decimal)
    if (/^\d{1,3}(,\d{3})*\.\d{2}$/.test(t)) {
        const n = parseFloat(t.replace(/,/g, ''));
        if (!Number.isFinite(n))
            return null;
        const v = Math.round(n * 100) / 100;
        return neg ? -v : v;
    }
    // AR: 952.536,52 — puntos miles, coma decimal
    if (/^\d{1,3}(\.\d{3})*,\d{1,4}$/.test(t)) {
        const lastComma = t.lastIndexOf(',');
        const intPart = t.slice(0, lastComma).replace(/\./g, '');
        const decPart = t.slice(lastComma + 1);
        const n = parseFloat(`${intPart}.${decPart}`);
        if (!Number.isFinite(n))
            return null;
        const v = Math.round(n * 100) / 100;
        return neg ? -v : v;
    }
    // Sin puntos de miles: 108911,30
    if (/^\d+,\d{1,4}$/.test(t)) {
        const lastComma = t.lastIndexOf(',');
        const n = parseFloat(`${t.slice(0, lastComma)}.${t.slice(lastComma + 1)}`);
        if (!Number.isFinite(n))
            return null;
        const v = Math.round(n * 100) / 100;
        return neg ? -v : v;
    }
    const n = parseFloat(t.replace(/,/g, ''));
    if (!Number.isFinite(n))
        return null;
    const v = Math.round(n * 100) / 100;
    return neg ? -v : v;
}
exports.parseArgentineMoneyDisplay = parseArgentineMoneyDisplay;
function cellNum(v) {
    if (v == null || v === '')
        return null;
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    return parseArgentineMoneyDisplay(String(v));
}
/** Parsea fechas tipo 31/12/2014, 13/04/15, 22/08/25 */
function parseArgentineDateDisplay(s) {
    const t = s.trim();
    if (!t)
        return null;
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m)
        return null;
    let d = parseInt(m[1], 10);
    let mo = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (m[3].length === 2)
        y += y >= 70 ? 1900 : 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12)
        return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
        return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
exports.parseArgentineDateDisplay = parseArgentineDateDisplay;
function sqlDateToDisplay(iso) {
    if (!iso)
        return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m)
        return '';
    return `${m[3]}/${m[2]}/${m[1]}`;
}
exports.sqlDateToDisplay = sqlDateToDisplay;
/** Nombre de hoja: "000809 FERNANDEZ HNOS SRL" → código + razón */
function parseSheetName(sheetName) {
    const t = sheetName.trim();
    if (!t || t === 'Resumen')
        return null;
    const sp = t.indexOf(' ');
    if (sp < 0)
        return { code: t, restName: '' };
    return { code: t.slice(0, sp).trim(), restName: t.slice(sp + 1).trim() };
}
exports.parseSheetName = parseSheetName;
/** Lee matriz de celdas de una hoja cliente (formato Multimedias). */
function parseCustomerSheetRows(rows) {
    var _a, _b, _c;
    if (!(rows === null || rows === void 0 ? void 0 : rows.length))
        return null;
    const r0 = ((_a = rows[0]) === null || _a === void 0 ? void 0 : _a.map(cellStr)) || [];
    let businessNameFromTitle = '';
    const title = r0[0] || '';
    const titleM = title.match(/Cliente\s+(\S+)\s*-\s*(.+)/i);
    let code = '';
    if (titleM) {
        code = titleM[1].trim();
        businessNameFromTitle = titleM[2].trim();
    }
    let vendedorHabitual = '';
    let zona = '';
    let cuitFromSheet = '';
    let saldoFinalHeader = null;
    const r1 = rows[1] || [];
    for (let i = 0; i < r1.length; i += 2) {
        const label = cellStr(r1[i]).toLowerCase();
        const val = r1[i + 1];
        if (label.includes('código') || label === 'codigo') {
            const c = cellStr(val);
            if (c)
                code = c;
        }
        else if (label.includes('vendedor'))
            vendedorHabitual = cellStr(val);
        else if (label.includes('zona'))
            zona = cellStr(val);
        else if (label.includes('cuit'))
            cuitFromSheet = normalizeCuitDigits(val);
        else if (label.includes('saldo final'))
            saldoFinalHeader = cellNum(val);
    }
    let headerRowIdx = -1;
    for (let r = 0; r < rows.length; r++) {
        const a = cellStr((_b = rows[r]) === null || _b === void 0 ? void 0 : _b[0]);
        const b = cellStr((_c = rows[r]) === null || _c === void 0 ? void 0 : _c[1]);
        if (a === 'Fecha' && b === 'Tipo') {
            headerRowIdx = r;
            break;
        }
    }
    if (headerRowIdx < 0) {
        return {
            code,
            businessNameFromTitle,
            cuitFromSheet,
            vendedorHabitual,
            zona,
            saldoFinalHeader,
            movements: [],
        };
    }
    const movements = [];
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const fecha = cellStr(row[0]);
        const tipo = cellStr(row[1]);
        if (!fecha && !tipo)
            continue;
        movements.push({
            fecha,
            tipo,
            numero: cellStr(row[2]),
            edc: cellStr(row[3]),
            vto: cellStr(row[4]),
            importe: cellNum(row[5]),
            saldo: cellNum(row[6]),
            detalle: cellStr(row[7]),
            paginaPdf: cellStr(row[8]),
        });
    }
    return {
        code,
        businessNameFromTitle,
        cuitFromSheet,
        vendedorHabitual,
        zona,
        saldoFinalHeader,
        movements,
    };
}
exports.parseCustomerSheetRows = parseCustomerSheetRows;
function excelSheetName(code, businessName, maxLen = 31) {
    const name = (businessName || 'Cliente').trim() || 'Cliente';
    const base = `${code} ${name}`.trim();
    if (base.length <= maxLen)
        return base;
    return base.slice(0, maxLen);
}
exports.excelSheetName = excelSheetName;
