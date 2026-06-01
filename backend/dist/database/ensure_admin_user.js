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
exports.ensureAdminUser = ensureAdminUser;
/**
 * Asegura que exista un usuario admin (para producción y desarrollo).
 * En producción usa ADMIN_EMAIL y ADMIN_PASSWORD; en desarrollo usa valores por defecto si no están definidos.
 */
const uuid_1 = require("uuid");
const db_1 = require("./db");
const DEFAULT_ADMIN_EMAIL = 'admin@lupohub.com';
const DEFAULT_ADMIN_PASSWORD = 'admin123';
const ADMIN_ROLE = 'ADMIN';
function ensureAdminUser() {
    return __awaiter(this, void 0, void 0, function* () {
        const isProd = process.env.NODE_ENV === 'production';
        const email = process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
        const password = process.env.ADMIN_PASSWORD || (isProd ? '' : DEFAULT_ADMIN_PASSWORD);
        if (isProd && !process.env.ADMIN_PASSWORD) {
            console.log('[DB] ADMIN_PASSWORD no definido en producción; no se crea usuario admin. Definí ADMIN_EMAIL y ADMIN_PASSWORD en Railway.');
            return;
        }
        try {
            const existing = yield (0, db_1.get)('SELECT id FROM users WHERE email = ?', [email]);
            if (existing) {
                console.log('[DB] Usuario admin ya existe:', email);
                return;
            }
            const id = (0, uuid_1.v4)();
            yield (0, db_1.execute)(`INSERT INTO users (id, name, email, password, role, commission_percentage) VALUES (?, ?, ?, ?, ?, ?)`, [id, 'Administrador', email, password, ADMIN_ROLE, 0]);
            console.log('[DB] Usuario admin creado:', email, isProd ? '(producción)' : '(desarrollo)');
        }
        catch (err) {
            console.error('[DB] Error creando usuario admin:', err === null || err === void 0 ? void 0 : err.message);
        }
    });
}
