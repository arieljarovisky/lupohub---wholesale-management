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
exports.deleteUser = exports.createUser = exports.listUsers = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
/** Listar usuarios (sin password). Solo ADMIN. */
const listUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden listar usuarios' });
        }
        const rows = yield (0, db_1.query)(`SELECT id, name, email, role, commission_percentage AS commissionPercentage 
       FROM users ORDER BY name`);
        res.json(rows);
    }
    catch (error) {
        console.error('listUsers:', error);
        res.status(500).json({ message: 'Error listando usuarios' });
    }
});
exports.listUsers = listUsers;
/** Crear usuario. Solo ADMIN. */
const createUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden crear usuarios' });
        }
        const { name, email, password, role, commissionPercentage } = req.body;
        if (!(name === null || name === void 0 ? void 0 : name.trim()) || !(email === null || email === void 0 ? void 0 : email.trim()) || !password) {
            return res.status(400).json({ message: 'Nombre, email y contraseña son requeridos' });
        }
        const validRoles = ['ADMIN', 'SELLER', 'WAREHOUSE'];
        const roleVal = (role || 'SELLER').toString().toUpperCase();
        if (!validRoles.includes(roleVal)) {
            return res.status(400).json({ message: 'Rol inválido. Use ADMIN, SELLER o WAREHOUSE' });
        }
        const existing = yield (0, db_1.get)('SELECT id FROM users WHERE email = ?', [email.trim()]);
        if (existing) {
            return res.status(409).json({ message: 'Ya existe un usuario con ese email' });
        }
        const id = (0, uuid_1.v4)();
        const commission = commissionPercentage != null ? Number(commissionPercentage) : 0;
        yield (0, db_1.execute)(`INSERT INTO users (id, name, email, password, role, commission_percentage) VALUES (?, ?, ?, ?, ?, ?)`, [id, name.trim(), email.trim(), password, roleVal, commission]);
        const created = yield (0, db_1.get)(`SELECT id, name, email, role, commission_percentage AS commissionPercentage FROM users WHERE id = ?`, [id]);
        res.status(201).json(created);
    }
    catch (error) {
        console.error('createUser:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Ya existe un usuario con ese email' });
        }
        res.status(500).json({ message: 'Error creando usuario' });
    }
});
exports.createUser = createUser;
/** Eliminar usuario. Solo ADMIN. No se puede eliminar a uno mismo. */
const deleteUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden eliminar usuarios' });
        }
        const { id } = req.params;
        const currentUserId = (_b = req.user) === null || _b === void 0 ? void 0 : _b.id;
        if (currentUserId && currentUserId === id) {
            return res.status(400).json({ message: 'No podés eliminarte a vos mismo' });
        }
        if (!id)
            return res.status(400).json({ message: 'ID de usuario requerido' });
        const existing = yield (0, db_1.get)('SELECT id FROM users WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }
        yield (0, db_1.execute)('DELETE FROM users WHERE id = ?', [id]);
        res.json({ message: 'Usuario eliminado', id });
    }
    catch (error) {
        console.error('deleteUser:', error);
        res.status(500).json({ message: 'Error eliminando usuario' });
    }
});
exports.deleteUser = deleteUser;
