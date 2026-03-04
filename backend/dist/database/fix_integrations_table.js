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
exports.fixIntegrationsTable = void 0;
const db_1 = require("./db");
const fixIntegrationsTable = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Verificando columna store_id en integrations...');
    try {
        // Verificar si la columna existe
        const column = yield (0, db_1.get)(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'integrations' 
        AND COLUMN_NAME = 'store_id'
    `);
        if (!column) {
            console.log('Agregando columna store_id...');
            yield (0, db_1.execute)(`ALTER TABLE integrations ADD COLUMN store_id VARCHAR(100) NULL`);
            console.log('✓ Columna store_id agregada');
        }
        else {
            console.log('✓ Columna store_id ya existe');
        }
    }
    catch (error) {
        console.error('Error verificando/agregando store_id:', error.message);
    }
});
exports.fixIntegrationsTable = fixIntegrationsTable;
