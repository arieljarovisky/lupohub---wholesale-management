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
exports.cleanInvalidSizes = exports.unifySizes = exports.deleteSize = exports.createSize = exports.getSizes = void 0;
const db_1 = require("../database/db");
const talles_tango_1 = require("../talles-tango");
const uuid_1 = require("uuid");
// Mapeo letra → código canónico (numérico) para unificar talles duplicados
const LETTER_TO_CANONICAL_CODE = {};
for (const [code, letter] of Object.entries(talles_tango_1.TALLE_CODIGO_A_NOMBRE)) {
    const key = String(letter).toUpperCase();
    if (!LETTER_TO_CANONICAL_CODE[key] || code === '200')
        LETTER_TO_CANONICAL_CODE[key] = code;
}
// Preferir 200 sobre 240 para XXG
LETTER_TO_CANONICAL_CODE['XXG'] = '200';
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
const createSize = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { code, name } = req.body;
        const rawCode = (code || '').toString().trim();
        if (!rawCode) {
            return res.status(400).json({ message: 'Debe indicar el código del talle' });
        }
        if (!isValidSize(rawCode)) {
            return res.status(400).json({ message: `Código de talle inválido: "${rawCode}"` });
        }
        const displayName = (0, talles_tango_1.nombreTalleDesdeCodigo)(rawCode) || name || rawCode;
        const id = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO sizes (id, size_code, name) VALUES (?, ?, ?)`, [id, rawCode, displayName]);
        res.status(201).json({ id, code: rawCode, name: displayName });
    }
    catch (error) {
        console.error('Error creando talle:', error);
        res.status(500).json({ message: 'Error creando talle', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.createSize = createSize;
/** Eliminar un talle por id. No permite eliminar si hay variantes que lo usan. */
const deleteSize = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const sizeId = req.params.id;
        if (!sizeId)
            return res.status(400).json({ message: 'Falta el id del talle' });
        const tblCheck = yield (0, db_1.query)(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'sizes'
    `);
        const hasSizesTable = Number(((_a = tblCheck === null || tblCheck === void 0 ? void 0 : tblCheck[0]) === null || _a === void 0 ? void 0 : _a.cnt) || 0) > 0;
        if (hasSizesTable) {
            const existing = yield (0, db_1.get)(`SELECT id FROM sizes WHERE id = ?`, [sizeId]);
            if (!existing)
                return res.status(404).json({ message: 'Talle no encontrado' });
            const inUse = yield (0, db_1.get)(`SELECT 1 FROM product_variants WHERE size_id = ? LIMIT 1`, [sizeId]);
            if (inUse) {
                return res.status(409).json({
                    message: 'No se puede eliminar el talle porque hay variantes de productos que lo usan.',
                });
            }
            yield (0, db_1.execute)(`DELETE FROM sizes WHERE id = ?`, [sizeId]);
            return res.status(204).send();
        }
        const existingAttr = yield (0, db_1.get)(`SELECT id FROM attributes WHERE id = ? AND type = 'size'`, [sizeId]);
        if (!existingAttr)
            return res.status(404).json({ message: 'Talle no encontrado' });
        yield (0, db_1.execute)(`DELETE FROM attributes WHERE id = ? AND type = 'size'`, [sizeId]);
        return res.status(204).send();
    }
    catch (error) {
        console.error('Error eliminando talle:', error);
        res.status(500).json({ message: 'Error eliminando talle', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.deleteSize = deleteSize;
/** Unifica talles por letra (G, GG, M, P, etc.) al talle canónico con código numérico (150, 160, 140, 130...). Reasigna variantes y elimina los talles duplicados. */
const unifySizes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const tblCheck = yield (0, db_1.query)(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'sizes'
    `);
        const hasSizesTable = Number(((_a = tblCheck === null || tblCheck === void 0 ? void 0 : tblCheck[0]) === null || _a === void 0 ? void 0 : _a.cnt) || 0) > 0;
        if (!hasSizesTable) {
            return res.status(400).json({ message: 'La unificación de talles solo está disponible con la tabla sizes.' });
        }
        const allSizes = (yield (0, db_1.query)(`SELECT id, size_code AS code FROM sizes`));
        const byCode = new Map();
        for (const s of allSizes || []) {
            const c = String(s.code || '').trim();
            if (c)
                byCode.set(c, s.id);
        }
        let totalUpdated = 0;
        let totalDeleted = 0;
        const mappings = [];
        const skipped = [];
        for (const size of allSizes || []) {
            const code = String(size.code || '').trim();
            const canonicalCode = LETTER_TO_CANONICAL_CODE[code] || LETTER_TO_CANONICAL_CODE[code.toUpperCase()];
            if (!canonicalCode)
                continue;
            if (canonicalCode === code)
                continue;
            const canonicalId = byCode.get(canonicalCode);
            if (!canonicalId) {
                skipped.push({ code, reason: `No existe el talle canónico ${canonicalCode} en la base de datos` });
                continue;
            }
            if (canonicalId === size.id)
                continue;
            const countResult = yield (0, db_1.query)(`SELECT COUNT(*) AS n FROM product_variants WHERE size_id = ?`, [size.id]);
            const variantCount = Number((_c = (_b = countResult === null || countResult === void 0 ? void 0 : countResult[0]) === null || _b === void 0 ? void 0 : _b.n) !== null && _c !== void 0 ? _c : 0);
            if (variantCount > 0) {
                yield (0, db_1.execute)(`UPDATE product_variants SET size_id = ? WHERE size_id = ?`, [canonicalId, size.id]);
                totalUpdated += variantCount;
                mappings.push({ from: code, to: canonicalCode, variantsUpdated: variantCount });
            }
            yield (0, db_1.execute)(`DELETE FROM sizes WHERE id = ?`, [size.id]);
            totalDeleted += 1;
            byCode.delete(code);
        }
        return res.json({
            message: totalDeleted > 0 || totalUpdated > 0
                ? `Unificación completada: ${totalUpdated} variantes actualizadas, ${totalDeleted} talles duplicados eliminados.`
                : skipped.length > 0
                    ? 'No se unificó ningún talle. Revisá que existan talles con código numérico (130, 140, 150, etc.).'
                    : 'No había talles duplicados para unificar.',
            variantsUpdated: totalUpdated,
            sizesDeleted: totalDeleted,
            mappings,
            skipped,
        });
    }
    catch (error) {
        console.error('Error unificando talles:', error);
        res.status(500).json({ message: 'Error unificando talles', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.unifySizes = unifySizes;
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
