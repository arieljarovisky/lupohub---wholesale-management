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
exports.addUserTasksTable = void 0;
const db_1 = require("./db");
function addUserTasksTable() {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, db_1.execute)(`
    CREATE TABLE IF NOT EXISTS user_tasks (
      id VARCHAR(36) PRIMARY KEY,
      message TEXT NOT NULL,
      assigned_to_email VARCHAR(255) NOT NULL,
      created_by_user_id VARCHAR(36) NULL,
      created_by_email VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_tasks_assigned_expires (assigned_to_email, expires_at),
      INDEX idx_user_tasks_created_at (created_at),
      CONSTRAINT fk_user_tasks_created_by
        FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);
    });
}
exports.addUserTasksTable = addUserTasksTable;
