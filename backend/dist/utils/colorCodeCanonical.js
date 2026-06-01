"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeColorCodeForImportValue = exports.canonicalNumericColorCode = exports.digitsOnlyColorCode = void 0;
/**
 * Códigos de color de catálogo: 3 dígitos (111–999).
 * En Excel/ERP suelen venir 4 dígitos (ej. 2021, 9990) donde los primeros 3 coinciden con el color real (202, 999).
 */
function digitsOnlyColorCode(raw) {
    const s = String(raw !== null && raw !== void 0 ? raw : '').trim();
    if (!s)
        return '';
    return s.replace(/\D/g, '');
}
exports.digitsOnlyColorCode = digitsOnlyColorCode;
/** Canon numérico para `colors.code` e importaciones: si hay más de 3 dígitos, solo los primeros 3. */
function canonicalNumericColorCode(digits) {
    const d = digits.replace(/\D/g, '');
    if (!d)
        return '';
    if (d.length <= 3)
        return d;
    return d.slice(0, 3);
}
exports.canonicalNumericColorCode = canonicalNumericColorCode;
function normalizeColorCodeForImportValue(val) {
    return canonicalNumericColorCode(digitsOnlyColorCode(val));
}
exports.normalizeColorCodeForImportValue = normalizeColorCodeForImportValue;
