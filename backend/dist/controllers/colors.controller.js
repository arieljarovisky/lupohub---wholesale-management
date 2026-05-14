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
exports.updateColor = exports.mergeFourDigitColorCodes = exports.importStandardColorCatalog = exports.createColor = exports.getColors = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const standardColorCatalog_1 = require("../data/standardColorCatalog");
const getColors = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        // 1) Detectar si existe la tabla "colors"
        const tblCheck = yield (0, db_1.query)(`
      SELECT COUNT(*) AS cnt 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() AND table_name = 'colors'
    `);
        const hasColorsTable = Number(((_a = tblCheck === null || tblCheck === void 0 ? void 0 : tblCheck[0]) === null || _a === void 0 ? void 0 : _a.cnt) || 0) > 0;
        if (hasColorsTable) {
            const hexColCheck = yield (0, db_1.query)(`
        SELECT COUNT(*) AS cnt 
        FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'colors' AND column_name = 'hex'
      `);
            const hasHex = Number(((_b = hexColCheck === null || hexColCheck === void 0 ? void 0 : hexColCheck[0]) === null || _b === void 0 ? void 0 : _b.cnt) || 0) > 0;
            let rows;
            if (hasHex) {
                rows = yield (0, db_1.query)(`
          SELECT id, code, name, hex
          FROM colors
          ORDER BY COALESCE(NULLIF(TRIM(name), ''), code) ASC
        `);
            }
            else {
                rows = yield (0, db_1.query)(`
          SELECT id, code, name, NULL AS hex
          FROM colors
          ORDER BY COALESCE(NULLIF(TRIM(name), ''), code) ASC
        `);
            }
            // Devolver todos los colores (incl. códigos numéricos de Tango). No filtrar por isValidColor.
            return res.json(rows || []);
        }
        // 3) Fallback: atributos legacy (type='color')
        const attrs = yield (0, db_1.query)(`
      SELECT id, name, value 
      FROM attributes 
      WHERE type = 'color'
      ORDER BY name ASC
    `);
        const mapped = attrs.map((a) => ({
            id: a.id,
            code: a.name,
            name: a.name,
            hex: a.value || null
        }));
        return res.json(mapped);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching colors' });
    }
});
exports.getColors = getColors;
const createColor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { code, name, hex } = req.body;
        const colorCode = (code || name || '').toString().trim();
        const colorName = (name || code || '').toString().trim();
        const hexValue = (hex || '').toString().trim() || null;
        if (!colorCode) {
            return res.status(400).json({ message: 'Debe indicar al menos el código o nombre del color' });
        }
        const id = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO colors (id, code, name, hex) VALUES (?, ?, ?, ?)`, [id, colorCode, colorName || colorCode, hexValue]);
        res.status(201).json({ id, code: colorCode, name: colorName || colorCode, hex: hexValue });
    }
    catch (error) {
        console.error('Error creando color:', error);
        res.status(500).json({ message: 'Error creando color', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.createColor = createColor;
/**
 * Inserta en `colors` los códigos del catálogo estándar que aún no existan (mismo `code`).
 * No modifica filas ya cargadas.
 */
const importStandardColorCatalog = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const tblCheck = yield (0, db_1.query)(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'colors'
    `);
        const hasColorsTable = Number(((_a = tblCheck === null || tblCheck === void 0 ? void 0 : tblCheck[0]) === null || _a === void 0 ? void 0 : _a.cnt) || 0) > 0;
        if (!hasColorsTable) {
            return res.status(400).json({ message: 'La tabla colors no existe en esta base de datos.' });
        }
        const hexColCheck = yield (0, db_1.query)(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'colors' AND column_name = 'hex'
    `);
        const hasHex = Number(((_b = hexColCheck === null || hexColCheck === void 0 ? void 0 : hexColCheck[0]) === null || _b === void 0 ? void 0 : _b.cnt) || 0) > 0;
        let inserted = 0;
        let skipped = 0;
        for (const row of standardColorCatalog_1.STANDARD_COLOR_CATALOG) {
            const codeNorm = String(row.code).trim();
            const existing = yield (0, db_1.get)(`SELECT id FROM colors WHERE TRIM(CAST(code AS CHAR)) = ? LIMIT 1`, [codeNorm]);
            if (existing) {
                skipped++;
                continue;
            }
            const id = (0, uuid_1.v4)();
            const hex = hasHex ? (0, standardColorCatalog_1.rgbToHex)(row.rgb[0], row.rgb[1], row.rgb[2]) : null;
            if (hasHex) {
                yield (0, db_1.execute)(`INSERT INTO colors (id, name, code, hex) VALUES (?, ?, ?, ?)`, [
                    id,
                    row.name,
                    codeNorm,
                    hex
                ]);
            }
            else {
                yield (0, db_1.execute)(`INSERT INTO colors (id, name, code) VALUES (?, ?, ?)`, [id, row.name, codeNorm]);
            }
            inserted++;
        }
        res.json({
            message: 'Catálogo procesado: se crearon solo los colores cuyo código no existía.',
            inserted,
            skipped,
            total: standardColorCatalog_1.STANDARD_COLOR_CATALOG.length
        });
    }
    catch (error) {
        console.error('importStandardColorCatalog:', error);
        res.status(500).json({ message: 'Error importando catálogo de colores', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.importStandardColorCatalog = importStandardColorCatalog;
/**
 * Une colores duplicados: `code` solo con dígitos y longitud ≥ 4 se trata como variante ERP del color de 3 dígitos
 * dado por los primeros 3 caracteres (ej. 2021 → 202). Mueve `product_colors` / variantes hacia el color canónico.
 */
const mergeFourDigitColorCodes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const tblCheck = yield (0, db_1.query)(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'colors'
    `);
        if (Number(((_a = tblCheck === null || tblCheck === void 0 ? void 0 : tblCheck[0]) === null || _a === void 0 ? void 0 : _a.cnt) || 0) === 0) {
            return res.status(400).json({ message: 'La tabla colors no existe.' });
        }
        const badRows = (yield (0, db_1.query)(`SELECT id, TRIM(CAST(code AS CHAR)) AS c FROM colors WHERE TRIM(CAST(code AS CHAR)) REGEXP '^[0-9]{4,}$' ORDER BY LENGTH(TRIM(CAST(code AS CHAR))) DESC, id ASC`));
        let merged = 0;
        let renamedInPlace = 0;
        const skipped = [];
        const errors = [];
        for (const row of badRows) {
            const badId = row.id;
            const badCode = String(row.c || '').trim();
            if (!/^\d{4,}$/.test(badCode))
                continue;
            const prefix = badCode.slice(0, 3);
            const good = (yield (0, db_1.get)(`SELECT id FROM colors WHERE TRIM(CAST(code AS CHAR)) = ? AND TRIM(CAST(code AS CHAR)) REGEXP '^[0-9]{1,3}$' AND id <> ? ORDER BY id ASC LIMIT 1`, [prefix, badId]));
            if (!good) {
                try {
                    yield (0, db_1.execute)(`UPDATE colors SET code = ? WHERE id = ?`, [prefix, badId]);
                    renamedInPlace++;
                }
                catch (e) {
                    errors.push(`${badCode} → ${prefix}: ${(e === null || e === void 0 ? void 0 : e.message) || e}`);
                }
                continue;
            }
            const goodId = good.id;
            if (goodId === badId)
                continue;
            try {
                const pcsBad = (yield (0, db_1.query)(`SELECT id, product_id FROM product_colors WHERE color_id = ?`, [
                    badId,
                ]));
                for (const pcb of pcsBad) {
                    const pcGood = (yield (0, db_1.get)(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ? LIMIT 1`, [
                        pcb.product_id,
                        goodId,
                    ]));
                    if (!pcGood) {
                        yield (0, db_1.execute)(`UPDATE product_colors SET color_id = ? WHERE id = ?`, [goodId, pcb.id]);
                        continue;
                    }
                    const vBadList = (yield (0, db_1.query)(`SELECT id, size_id FROM product_variants WHERE product_color_id = ?`, [
                        pcb.id,
                    ]));
                    for (const vb of vBadList) {
                        const vGood = (yield (0, db_1.get)(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ? LIMIT 1`, [pcGood.id, vb.size_id]));
                        const ordBad = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM order_items WHERE variant_id = ?`, [vb.id]);
                        const nBad = Number((ordBad === null || ordBad === void 0 ? void 0 : ordBad.n) || 0);
                        if (!vGood) {
                            if (nBad > 0) {
                                skipped.push(`Variante ${vb.id} (${badCode}) tiene pedidos; no se movió de product_color.`);
                                continue;
                            }
                            yield (0, db_1.execute)(`UPDATE product_variants SET product_color_id = ? WHERE id = ?`, [pcGood.id, vb.id]);
                            continue;
                        }
                        const ordGood = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM order_items WHERE variant_id = ?`, [vGood.id]);
                        const nGood = Number((ordGood === null || ordGood === void 0 ? void 0 : ordGood.n) || 0);
                        if (nBad > 0 || nGood > 0) {
                            skipped.push(`Variante duplicada talle ${vb.size_id}: ambas tienen historial de pedidos; no se fusionó ${vb.id} con ${vGood.id}.`);
                            continue;
                        }
                        const sb = yield (0, db_1.get)(`SELECT stock FROM stocks WHERE variant_id = ?`, [vb.id]);
                        const sg = yield (0, db_1.get)(`SELECT stock FROM stocks WHERE variant_id = ?`, [vGood.id]);
                        const sum = (Number(sb === null || sb === void 0 ? void 0 : sb.stock) || 0) + (Number(sg === null || sg === void 0 ? void 0 : sg.stock) || 0);
                        yield (0, db_1.execute)(`UPDATE stocks SET stock = ? WHERE variant_id = ?`, [sum, vGood.id]);
                        yield (0, db_1.execute)(`DELETE FROM stocks WHERE variant_id = ?`, [vb.id]);
                        yield (0, db_1.execute)(`DELETE FROM product_variants WHERE id = ?`, [vb.id]);
                    }
                    const left = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM product_variants WHERE product_color_id = ?`, [pcb.id]);
                    if (Number((left === null || left === void 0 ? void 0 : left.n) || 0) === 0) {
                        yield (0, db_1.execute)(`DELETE FROM product_colors WHERE id = ?`, [pcb.id]);
                    }
                }
                const restPc = yield (0, db_1.get)(`SELECT COUNT(*) AS n FROM product_colors WHERE color_id = ?`, [badId]);
                if (Number((restPc === null || restPc === void 0 ? void 0 : restPc.n) || 0) === 0) {
                    yield (0, db_1.execute)(`DELETE FROM colors WHERE id = ?`, [badId]);
                    merged++;
                }
                else {
                    errors.push(`Color ${badCode} (${badId}): quedan filas en product_colors; no se eliminó el duplicado.`);
                }
            }
            catch (e) {
                errors.push(`Color ${badCode} (${badId}): ${(e === null || e === void 0 ? void 0 : e.message) || e}`);
            }
        }
        res.json({
            message: 'Fusión aplicada: colores con code de 4+ dígitos se unieron al color de 3 dígitos (primeros 3) cuando existía, o se renombró el code a 3 dígitos si no había duplicado.',
            examined: badRows.length,
            mergedIntoExisting: merged,
            renamedCodeOnly: renamedInPlace,
            skipped: skipped.slice(0, 80),
            errors: errors.slice(0, 40),
        });
    }
    catch (error) {
        console.error('mergeFourDigitColorCodes:', error);
        res.status(500).json({ message: 'Error fusionando colores', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.mergeFourDigitColorCodes = mergeFourDigitColorCodes;
const updateColor = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const colorId = req.params.id;
        if (!colorId)
            return res.status(400).json({ message: 'Falta el id del color' });
        const { code, name, hex } = req.body;
        const updates = [];
        const params = [];
        if (code !== undefined) {
            updates.push('code = ?');
            params.push(String(code).trim() || null);
        }
        if (name !== undefined) {
            updates.push('name = ?');
            params.push(String(name).trim() || null);
        }
        if (hex !== undefined) {
            updates.push('hex = ?');
            params.push((hex && String(hex).trim()) || null);
        }
        if (updates.length === 0) {
            return res.status(400).json({ message: 'Indicá al menos un campo a actualizar (code, name, hex)' });
        }
        const tblCheck = yield (0, db_1.query)(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'colors'
    `);
        const hasColorsTable = Number(((_a = tblCheck === null || tblCheck === void 0 ? void 0 : tblCheck[0]) === null || _a === void 0 ? void 0 : _a.cnt) || 0) > 0;
        if (hasColorsTable) {
            const existing = yield (0, db_1.get)(`SELECT id FROM colors WHERE id = ?`, [colorId]);
            if (!existing)
                return res.status(404).json({ message: 'Color no encontrado' });
            params.push(colorId);
            yield (0, db_1.execute)(`UPDATE colors SET ${updates.join(', ')} WHERE id = ?`, params);
            const updated = yield (0, db_1.get)(`SELECT id, code, name, hex FROM colors WHERE id = ?`, [colorId]);
            return res.json(updated);
        }
        const existingAttr = yield (0, db_1.get)(`SELECT id FROM attributes WHERE id = ? AND type = 'color'`, [colorId]);
        if (!existingAttr)
            return res.status(404).json({ message: 'Color no encontrado' });
        const attrUpdates = [];
        const attrParams = [];
        if (code !== undefined || name !== undefined) {
            attrUpdates.push('name = ?');
            attrParams.push(String((_b = name !== null && name !== void 0 ? name : code) !== null && _b !== void 0 ? _b : '').trim() || String(code !== null && code !== void 0 ? code : '').trim());
        }
        if (hex !== undefined) {
            attrUpdates.push('value = ?');
            attrParams.push((hex && String(hex).trim()) || null);
        }
        if (attrUpdates.length > 0) {
            attrParams.push(colorId);
            yield (0, db_1.execute)(`UPDATE attributes SET ${attrUpdates.join(', ')} WHERE id = ? AND type = 'color'`, attrParams);
        }
        const updated = yield (0, db_1.get)(`SELECT id, name, value FROM attributes WHERE id = ? AND type = 'color'`, [colorId]);
        return res.json({ id: updated.id, code: updated.name, name: updated.name, hex: (_c = updated.value) !== null && _c !== void 0 ? _c : null });
    }
    catch (error) {
        console.error('Error actualizando color:', error);
        res.status(500).json({ message: 'Error actualizando color', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.updateColor = updateColor;
