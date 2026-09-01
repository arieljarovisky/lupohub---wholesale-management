"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skuToCanonicalString = skuToCanonicalString;
exports.tiendaNubeSkuLooksCorrupted = tiendaNubeSkuLooksCorrupted;
/**
 * SKU siempre como texto legible (sin notación científica 4,16E+12).
 * LupoHub usa formato base-talle-color, ej. 0051003-130-280.
 */
function skuToCanonicalString(raw) {
    if (raw == null || raw === '')
        return '';
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw))
            return '';
        if (Math.abs(raw) >= 1e6 || Number.isInteger(raw)) {
            try {
                return BigInt(Math.trunc(raw)).toString();
            }
            catch (_a) {
                return raw.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
            }
        }
        return String(raw);
    }
    let s = String(raw).trim();
    if (!s)
        return '';
    if (/[eE]/.test(s)) {
        const forParse = s.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
        const n = Number(forParse);
        if (Number.isFinite(n))
            return skuToCanonicalString(n);
    }
    return s;
}
/** true si el SKU en TN parece corrupto (notación científica o solo dígitos enormes sin guiones). */
function tiendaNubeSkuLooksCorrupted(raw) {
    const s = String(raw !== null && raw !== void 0 ? raw : '').trim();
    if (!s)
        return false;
    if (/[eE]/.test(s))
        return true;
    if (/^[\d.,]+$/.test(s) && s.replace(/\D/g, '').length >= 10)
        return true;
    return false;
}
