"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TALLE_CODIGO_A_NOMBRE = void 0;
exports.nombreTalleDesdeCodigo = nombreTalleDesdeCodigo;
exports.codigoTalleParaSku = codigoTalleParaSku;
/**
 * Mapeo código de talle Tango (3 dígitos) → nombre real del talle.
 * Usado en importación Tango y al listar talles para mostrar el talle verdadero.
 */
exports.TALLE_CODIGO_A_NOMBRE = {
    '130': 'P',
    '140': 'M',
    '150': 'G',
    '160': 'GG',
    '170': 'U',
    '180': 'XG',
    '200': 'XXG',
    '240': 'XXG',
    '250': 'XXXG',
};
function nombreTalleDesdeCodigo(codigo) {
    var _a;
    const c = (codigo || '').trim();
    return (_a = exports.TALLE_CODIGO_A_NOMBRE[c]) !== null && _a !== void 0 ? _a : c;
}
/** Letra o código numérico → código Tango de 3 dígitos (para SKU / sizes). */
const TALLE_NOMBRE_A_CODIGO = {
    P: '130',
    M: '140',
    G: '150',
    GG: '160',
    U: '170',
    XG: '180',
    XXG: '200',
    XXXG: '250',
    '130': '130',
    '140': '140',
    '150': '150',
    '160': '160',
    '170': '170',
    '180': '180',
    '200': '200',
    '240': '240',
    '250': '250',
};
function codigoTalleParaSku(nameOrCode) {
    var _a;
    if (nameOrCode == null)
        return '';
    const s = String(nameOrCode).trim().toUpperCase();
    if (/^\d{1,3}$/.test(s))
        return s;
    return (_a = TALLE_NOMBRE_A_CODIGO[s]) !== null && _a !== void 0 ? _a : s;
}
