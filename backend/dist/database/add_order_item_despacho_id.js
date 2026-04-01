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
exports.addOrderItemDespachoId = void 0;
const db_1 = require("./db");
/** Número de despacho de importación por línea de pedido (misma variante, distintos despachos). */
const addOrderItemDespachoId = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = yield (0, db_1.query)(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'despacho_id'`);
        if (rows === null || rows === void 0 ? void 0 : rows.length) {
            console.log('✓ order_items.despacho_id ya existe');
            return;
        }
        yield (0, db_1.execute)(`ALTER TABLE order_items ADD COLUMN despacho_id VARCHAR(36) NULL`);
        try {
            yield (0, db_1.execute)(`ALTER TABLE order_items ADD CONSTRAINT fk_order_items_despacho FOREIGN KEY (despacho_id) REFERENCES despachos(id) ON DELETE SET NULL`);
        }
        catch (e) {
            if (!String((e === null || e === void 0 ? void 0 : e.message) || '').includes('Duplicate')) {
                console.warn('fk_order_items_despacho:', (e === null || e === void 0 ? void 0 : e.message) || e);
            }
        }
        console.log('✓ Columna order_items.despacho_id agregada');
    }
    catch (error) {
        console.error('addOrderItemDespachoId:', (error === null || error === void 0 ? void 0 : error.message) || error);
    }
});
exports.addOrderItemDespachoId = addOrderItemDespachoId;
