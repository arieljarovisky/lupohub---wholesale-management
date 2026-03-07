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
exports.cleanInvalidSizes = exports.getSizes = void 0;
const db_1 = require("../database/db");
const talles_tango_1 = require("../talles-tango");
// Talles válidos conocidos
const VALID_SIZE_PATTERNS = /^(U|P|M|G|GG|XG|XXG|XXXG|S|L|XL|XXL|XXXL|XS|ÚNICO|\d+)$/i;
const isValidSize = (code) => {
    if (!code)
        return false;
    return VALID_SIZE_PATTERNS.test(code.trim());
};
const getSizes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const tblCheck = yield (0, db_1.query)(`
      SELECT COUNT(*) AS cnt 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() AND table_name = 'sizes'
    `);
        const hasSizesTable = Number(((_a = tblCheck === null || tblCheck === void 0 ? void 0 : tblCheck[0]) === null || _a === void 0 ? void 0 : _a.cnt) || 0) > 0;
        if (hasSizesTable) {
            // Consulta directa - la tabla sizes tiene size_code y name. Mostrar nombre real (P, M, G...) para códigos Tango.
            const rows = yield (0, db_1.query)(`
        SELECT id, size_code AS code, name
        FROM sizes
        ORDER BY size_code ASC
      `);
            const validRows = (rows || []).filter((r) => isValidSize(r.code)).map((r) => ({
                id: r.id,
                code: r.code,
                name: (0, talles_tango_1.nombreTalleDesdeCodigo)(r.code) || r.name || r.code,
            }));
            return res.json(validRows);
        }
        // Fallback: atributos legacy (type='size')
        const attrs = yield (0, db_1.query)(`
      SELECT id, name 
      FROM attributes 
      WHERE type = 'size'
      ORDER BY name ASC
    `);
        const mapped = attrs.map((a) => ({
            id: a.id,
            code: a.name,
            name: a.name
        })).filter((a) => isValidSize(a.code));
        return res.json(mapped);
    }
    catch (error) {
        console.error('Error fetching sizes:', error);
        res.status(500).json({ message: 'Error fetching sizes' });
    }
});
exports.getSizes = getSizes;
// Limpiar talles inválidos de la base de datos
const cleanInvalidSizes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Obtener todos los talles
        const allSizes = yield (0, db_1.query)(`SELECT id, size_code FROM sizes`);
        const invalidIds = [];
        const validIds = [];
        for (const size of allSizes || []) {
            if (isValidSize(size.size_code)) {
                validIds.push(size.id);
            }
            else {
                invalidIds.push(size.id);
            }
        }
        // No eliminar si hay variantes usando esos talles
        // Solo marcar cuáles son inválidos
        res.json({
            total: (allSizes === null || allSizes === void 0 ? void 0 : allSizes.length) || 0,
            valid: validIds.length,
            invalid: invalidIds.length,
            invalidCodes: (allSizes || []).filter((s) => !isValidSize(s.size_code)).map((s) => s.size_code)
        });
    }
    catch (error) {
        console.error('Error cleaning sizes:', error);
        res.status(500).json({ message: 'Error cleaning sizes' });
    }
});
exports.cleanInvalidSizes = cleanInvalidSizes;
