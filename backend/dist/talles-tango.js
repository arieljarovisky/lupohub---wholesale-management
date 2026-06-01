"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codigoTalleParaSku = exports.TALLE_LETRAS_EQUIVALENTES = exports.nombreTalleDesdeCodigo = exports.TALLE_CODIGO_A_RANGO_ML = exports.TALLE_CODIGO_A_NOMBRE = void 0;
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
    '220': 'XXXG',
    '240': 'XXG',
    '250': 'XXXG',
};
/** Rango numérico en guías ML (ej. "Talle P 38-40" en la tabla de talles). */
exports.TALLE_CODIGO_A_RANGO_ML = {
    '130': '38-40',
    '140': '42-44',
    '150': '46-48',
    '160': '50-52',
    '170': '38-40',
    '180': '46-48',
    '200': '50-52',
    '220': '50-52',
    '240': '50-52',
    '250': '50-52'
};
function nombreTalleDesdeCodigo(codigo) {
    var _a;
    const c = (codigo || '').trim();
    return (_a = exports.TALLE_CODIGO_A_NOMBRE[c]) !== null && _a !== void 0 ? _a : c;
}
exports.nombreTalleDesdeCodigo = nombreTalleDesdeCodigo;
/** Letra o código numérico → código Tango de 3 dígitos (para SKU / sizes). */
const TALLE_NOMBRE_A_CODIGO = {
    P: '130',
    M: '140',
    G: '150',
    GG: '160',
    U: '170',
    XG: '180',
    XXG: '200',
    XXXG: '220',
    S: '130',
    EG: '160',
    UNICO: '170',
    ÚNICO: '170',
    '130': '130',
    '140': '140',
    '150': '150',
    '160': '160',
    '170': '170',
    '180': '180',
    '200': '200',
    '220': '220',
    '240': '240',
    '250': '250',
};
/** Sinónimos de letra para matchear guías ML (ej. 130 → P o S). */
exports.TALLE_LETRAS_EQUIVALENTES = {
    '130': ['P', 'S'],
    '140': ['M'],
    '150': ['G'],
    '160': ['GG', 'EG'],
    '170': ['U', 'UNICO', 'ÚNICO'],
    '180': ['XG'],
    '200': ['XXG'],
    '220': ['XXXG'],
    '250': ['XXXG'],
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
exports.codigoTalleParaSku = codigoTalleParaSku;
