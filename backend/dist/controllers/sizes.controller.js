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
exports.getSizes = void 0;
const db_1 = require("../database/db");
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
            // Detectar columnas disponibles
            const cols = yield (0, db_1.query)(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'sizes'
      `);
            const names = (cols || []).map((c) => String(c.column_name).toLowerCase());
            const hasSizeCode = names.includes('size_code');
            const hasCode = names.includes('code');
            const hasName = names.includes('name');
            const codeExpr = hasSizeCode ? 'size_code' : hasCode ? 'code' : hasName ? 'name' : 'NULL';
            const nameExpr = hasName ? 'name' : hasSizeCode ? 'size_code' : hasCode ? 'code' : 'NULL';
            const orderExpr = hasName ? 'name' : hasSizeCode ? 'size_code' : hasCode ? 'code' : 'id';
            const rows = yield (0, db_1.query)(`
        SELECT id, ${codeExpr} AS code, ${nameExpr} AS name
        FROM sizes
        ORDER BY ${orderExpr} ASC
      `);
            return res.json(rows);
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
        }));
        return res.json(mapped);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching sizes' });
    }
});
exports.getSizes = getSizes;
