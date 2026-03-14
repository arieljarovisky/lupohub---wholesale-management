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
exports.updateColor = exports.createColor = exports.getColors = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
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
