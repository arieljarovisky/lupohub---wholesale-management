"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TALLE_CODIGO_A_NOMBRE = void 0;
exports.nombreTalleDesdeCodigo = nombreTalleDesdeCodigo;
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
