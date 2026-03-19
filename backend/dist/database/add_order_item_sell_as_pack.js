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
exports.addOrderItemSellAsPack = void 0;
const db_1 = require("./db");
const addOrderItemSellAsPack = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const col = yield (0, db_1.query)(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'sell_as_pack'`);
        if (col && col.length > 0) {
            console.log('✓ order_items.sell_as_pack ya existe');
            return;
        }
        yield (0, db_1.execute)(`
      ALTER TABLE order_items ADD COLUMN sell_as_pack TINYINT NOT NULL DEFAULT 0
    `);
        console.log('✓ Columna order_items.sell_as_pack agregada (1 = cantidad en packs, 0 = en unidades)');
    }
    catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('✓ order_items.sell_as_pack ya existe');
        }
        else {
            throw e;
        }
    }
});
exports.addOrderItemSellAsPack = addOrderItemSellAsPack;
