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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.get = exports.execute = exports.query = void 0;
const promise_1 = __importDefault(require("mysql2/promise"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const pool = promise_1.default.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'lupohub',
    port: Number(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
// Wrapper para consultas que retornan filas (SELECT)
const query = (sql_1, ...args_1) => __awaiter(void 0, [sql_1, ...args_1], void 0, function* (sql, params = []) {
    try {
        const [rows] = yield pool.query(sql, params);
        return rows;
    }
    catch (error) {
        console.error(`Error executing query: ${sql}`, error);
        throw error;
    }
});
exports.query = query;
// Wrapper para ejecuciones que modifican datos (INSERT, UPDATE, DELETE)
const execute = (sql_1, ...args_1) => __awaiter(void 0, [sql_1, ...args_1], void 0, function* (sql, params = []) {
    try {
        yield pool.execute(sql, params);
    }
    catch (error) {
        console.error(`Error executing command: ${sql}`, error);
        throw error;
    }
});
exports.execute = execute;
// Wrapper para obtener un solo registro
const get = (sql_1, ...args_1) => __awaiter(void 0, [sql_1, ...args_1], void 0, function* (sql, params = []) {
    try {
        const [rows] = yield pool.query(sql, params);
        const result = rows;
        return result.length > 0 ? result[0] : null;
    }
    catch (error) {
        console.error(`Error executing get: ${sql}`, error);
        throw error;
    }
});
exports.get = get;
exports.default = pool;
