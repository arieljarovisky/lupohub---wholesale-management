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
exports.getColors = void 0;
const db_1 = require("../database/db");
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
            // 2) Detectar si existe la columna 'hex'
            const hexColCheck = yield (0, db_1.query)(`
        SELECT COUNT(*) AS cnt 
        FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'colors' AND column_name = 'hex'
      `);
            const hasHex = Number(((_b = hexColCheck === null || hexColCheck === void 0 ? void 0 : hexColCheck[0]) === null || _b === void 0 ? void 0 : _b.cnt) || 0) > 0;
            if (hasHex) {
                const rows = yield (0, db_1.query)(`
          SELECT id, code, name, hex
          FROM colors
          ORDER BY name ASC
        `);
                return res.json(rows);
            }
            else {
                const rows = yield (0, db_1.query)(`
          SELECT id, code, name, NULL AS hex
          FROM colors
          ORDER BY name ASC
        `);
                return res.json(rows);
            }
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
            code: a.name, // Sin código en legacy, usamos el nombre como código
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
