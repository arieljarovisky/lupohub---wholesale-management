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
exports.addStockMovementsTable = void 0;
const db_1 = require("./db");
const addStockMovementsTable = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Verificando tabla stock_movements...');
    try {
        yield (0, db_1.execute)(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id VARCHAR(36) PRIMARY KEY,
        variant_id VARCHAR(36) NOT NULL,
        previous_stock INT NOT NULL DEFAULT 0,
        new_stock INT NOT NULL DEFAULT 0,
        quantity_change INT NOT NULL DEFAULT 0,
        movement_type VARCHAR(50) NOT NULL,
        reference VARCHAR(255),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_variant_id (variant_id),
        INDEX idx_movement_type (movement_type),
        INDEX idx_created_at (created_at),
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
      )
    `);
        console.log('✓ Tabla stock_movements creada/verificada');
    }
    catch (error) {
        if (error.code === 'ER_TABLE_EXISTS_ERROR') {
            console.log('✓ Tabla stock_movements ya existe');
        }
        else {
            console.error('Error creando tabla stock_movements:', error.message);
        }
    }
});
exports.addStockMovementsTable = addStockMovementsTable;
