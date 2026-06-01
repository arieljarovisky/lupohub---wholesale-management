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
exports.addVariantLuposhopStockTable = void 0;
const db_1 = require("./db");
/** Snapshot del último stock enviado con éxito a la tienda online (webhook Lupo Shop). */
function addVariantLuposhopStockTable() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[DB] Verificando tabla variant_luposhop_stock...');
        try {
            const row = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'variant_luposhop_stock'`);
            const exists = Number((row === null || row === void 0 ? void 0 : row.cnt) || 0) > 0;
            if (!exists) {
                yield (0, db_1.execute)(`
        CREATE TABLE variant_luposhop_stock (
          variant_id VARCHAR(36) PRIMARY KEY,
          stock INT NOT NULL DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_luposhop_updated (updated_at)
        )
      `);
                console.log('[DB] Tabla variant_luposhop_stock creada');
            }
            else {
                console.log('[DB] Tabla variant_luposhop_stock ya existe');
            }
        }
        catch (e) {
            console.error('[DB] Error verificando tabla variant_luposhop_stock:', e === null || e === void 0 ? void 0 : e.message);
        }
    });
}
exports.addVariantLuposhopStockTable = addVariantLuposhopStockTable;
