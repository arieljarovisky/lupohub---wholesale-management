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
        console.log("Creating integrations table...");
        yield (0, db_1.execute)(`
      CREATE TABLE IF NOT EXISTS integrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        platform VARCHAR(50) NOT NULL UNIQUE,
        access_token TEXT,
        refresh_token TEXT,
        expires_at TIMESTAMP NULL,
        user_id VARCHAR(100) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
        console.log("Created integrations table");
        process.exit(0);
    }
    catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
});
runMigration();
