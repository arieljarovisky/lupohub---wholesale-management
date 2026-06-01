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
exports.testConnection = exports.get = exports.execute = exports.query = exports.pool = void 0;
const promise_1 = __importDefault(require("mysql2/promise"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// En producción, cargar primero .env.production (conexión a base de producción)
if (process.env.NODE_ENV === 'production') {
    dotenv_1.default.config({ path: path_1.default.join(process.cwd(), '.env.production') });
}
dotenv_1.default.config();
function getPoolConfig() {
    const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
    if (url) {
        try {
            const parsed = new URL(url);
            console.log('[DB] Using MYSQL_URL/DATABASE_URL (host:', parsed.hostname + ')');
            return {
                host: parsed.hostname,
                user: parsed.username,
                password: parsed.password,
                database: parsed.pathname.replace(/^\//, '') || 'lupohub',
                port: parsed.port ? Number(parsed.port) : 3306,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            };
        }
        catch (e) {
            console.warn('[DB] Invalid MYSQL_URL/DATABASE_URL, using individual vars:', e.message);
        }
    }
    console.log('[DB] Using DB_HOST (host:', process.env.DB_HOST || 'localhost', ')');
    return {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'lupohub',
        port: Number(process.env.DB_PORT) || 3306,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    };
}
exports.pool = promise_1.default.createPool(getPoolConfig());
// Wrapper para consultas que retornan filas (SELECT)
const query = (sql, params = []) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [rows] = yield exports.pool.query(sql, params);
        return rows;
    }
    catch (error) {
        console.error(`Error executing query: ${sql}`, error);
        throw error;
    }
});
exports.query = query;
// Wrapper para ejecuciones que modifican datos (INSERT, UPDATE, DELETE)
// Retorna el ResultSetHeader (affectedRows, insertId, etc.) para poder comprobar filas afectadas
const execute = (sql, params = []) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [rows] = yield exports.pool.execute(sql, params);
        return rows;
    }
    catch (error) {
        console.error(`Error executing command: ${sql}`, error);
        throw error;
    }
});
exports.execute = execute;
// Wrapper para obtener un solo registro
const get = (sql, params = []) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [rows] = yield exports.pool.query(sql, params);
        const result = rows;
        return result.length > 0 ? result[0] : null;
    }
    catch (error) {
        console.error(`Error executing get: ${sql}`, error);
        throw error;
    }
});
exports.get = get;
/** Prueba la conexión; lanza si falla (ej. ECONNREFUSED). */
const testConnection = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const [rows] = yield exports.pool.query('SELECT 1 AS ok');
    if (!rows || ((_a = rows[0]) === null || _a === void 0 ? void 0 : _a.ok) !== 1)
        throw new Error('DB check failed');
});
exports.testConnection = testConnection;
/** Misma instancia exportada como default; sirve para transacciones (`pool.getConnection()`). */
exports.default = exports.pool;
