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
exports.addDispatchedAtToOrders = void 0;
const db_1 = require("./db");
const addDispatchedAtToOrders = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Verificando columna dispatched_at en orders...');
    try {
        const row = yield (0, db_1.get)(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'dispatched_at'`);
        if (row) {
            console.log('✓ Columna dispatched_at ya existe en orders');
            return;
        }
        yield (0, db_1.execute)(`ALTER TABLE orders ADD COLUMN dispatched_at DATETIME NULL AFTER picked_by`);
        console.log('✓ Columna dispatched_at agregada a orders');
    }
    catch (error) {
        console.error('Error agregando dispatched_at:', error.message);
    }
});
exports.addDispatchedAtToOrders = addDispatchedAtToOrders;
