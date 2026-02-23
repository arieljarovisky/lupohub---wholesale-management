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
const db_1 = require("./db");
const runMigration = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield (0, db_1.execute)(`ALTER TABLE product_variants ADD COLUMN sku VARCHAR(100) NULL`);
        process.exit(0);
    }
    catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            try {
                yield (0, db_1.execute)(`ALTER TABLE product_variants MODIFY COLUMN sku VARCHAR(100)`);
            }
            catch (_a) { }
            process.exit(0);
        }
        else {
            process.exit(1);
        }
    }
});
runMigration();
