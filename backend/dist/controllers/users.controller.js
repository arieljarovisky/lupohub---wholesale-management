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
exports.updateUser = exports.deleteUser = exports.importSellers = exports.createUser = exports.listUsers = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
/** Listar usuarios (sin password). Solo ADMIN. */
const listUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden listar usuarios' });
        }
        const rows = yield (0, db_1.query)(`SELECT id, name, email, role, commission_percentage AS commissionPercentage,
              CASE WHEN role = 'SELLER' THEN NULL ELSE price_list_id END AS priceListId
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
    var _b;
    try {
        if (((_b = req.user) === null || _b === void 0 ? void 0 : _b.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden crear usuarios' });
        }
        const { name, email, password, role, commissionPercentage } = req.body;
        if (!(name === null || name === void 0 ? void 0 : name.trim()) || !(email === null || email === void 0 ? void 0 : email.trim()) || !password) {
            return res.status(400).json({ message: 'Nombre, email y contraseña son requeridos' });
        }
        const validRoles = ['ADMIN', 'SELLER', 'WAREHOUSE', 'CUSTOMER'];
        const roleVal = (role || 'SELLER').toString().toUpperCase();
        if (!validRoles.includes(roleVal)) {
            return res.status(400).json({ message: 'Rol inválido. Use ADMIN, SELLER, WAREHOUSE o CUSTOMER' });
        }
        const existing = yield (0, db_1.get)('SELECT id FROM users WHERE email = ?', [email.trim()]);
        if (existing) {
            return res.status(409).json({ message: 'Ya existe un usuario con ese email' });
        }
        const id = (0, uuid_1.v4)();
        const commission = commissionPercentage != null ? Number(commissionPercentage) : 0;
        yield (0, db_1.execute)(`INSERT INTO users (id, name, email, password, role, commission_percentage) VALUES (?, ?, ?, ?, ?, ?)`, [id, name.trim(), email.trim(), password, roleVal, commission]);
        if (roleVal === 'CUSTOMER') {
            const customerId = (0, uuid_1.v4)();
            yield (0, db_1.execute)(`INSERT INTO customers (id, user_id, seller_id, name, business_name, email, address, city) VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL)`, [customerId, id, name.trim(), name.trim(), email.trim()]);
        }
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
/** Importar vendedores (rol SELLER) en lote. Solo ADMIN. */
const importSellers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _c, _d, _e, _f, _g;
    try {
        if (((_c = req.user) === null || _c === void 0 ? void 0 : _c.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden importar vendedores' });
        }
        const body = req.body;
        const rows = Array.isArray(body.sellers) ? body.sellers : [];
        const defaultPassword = ((_d = body.defaultPassword) !== null && _d !== void 0 ? _d : '').toString();
        if (rows.length === 0) {
            return res.status(400).json({ message: 'Enviá un array sellers con al menos una fila' });
        }
        if (!defaultPassword || defaultPassword.length < 4) {
            return res.status(400).json({
                message: 'Definí defaultPassword (mínimo 4 caracteres) para las filas sin contraseña propia'
            });
        }
        let created = 0;
        let skipped = 0;
        const errors = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const name = ((_e = r.name) !== null && _e !== void 0 ? _e : '').toString().trim();
            const email = ((_f = r.email) !== null && _f !== void 0 ? _f : '').toString().trim().toLowerCase();
            const rowNum = i + 1;
            if (!name) {
                errors.push({ row: rowNum, message: 'Falta nombre' });
                continue;
            }
            if (!email || !email.includes('@')) {
                errors.push({ row: rowNum, message: 'Email inválido o faltante' });
                continue;
            }
            const password = ((_g = r.password) !== null && _g !== void 0 ? _g : '').toString().trim() || defaultPassword;
            const commission = r.commissionPercentage != null && Number.isFinite(Number(r.commissionPercentage))
                ? Math.min(100, Math.max(0, Number(r.commissionPercentage)))
                : 0;
            const existing = yield (0, db_1.get)('SELECT id FROM users WHERE email = ?', [email]);
            if (existing) {
                skipped++;
                continue;
            }
            const id = (0, uuid_1.v4)();
            try {
                yield (0, db_1.execute)(`INSERT INTO users (id, name, email, password, role, commission_percentage) VALUES (?, ?, ?, ?, 'SELLER', ?)`, [id, name, email, password, commission]);
                created++;
            }
            catch (e) {
                if ((e === null || e === void 0 ? void 0 : e.code) === 'ER_DUP_ENTRY') {
                    skipped++;
                }
                else {
                    errors.push({ row: rowNum, email, message: (e === null || e === void 0 ? void 0 : e.message) || 'Error insertando' });
                }
            }
        }
        res.json({
            message: 'Importación de vendedores finalizada',
            created,
            skipped,
            errors: errors.slice(0, 30),
            errorCount: errors.length
        });
    }
    catch (error) {
        console.error('importSellers:', error);
        res.status(500).json({ message: 'Error importando vendedores', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.importSellers = importSellers;
/** Eliminar usuario. Solo ADMIN. No se puede eliminar a uno mismo. */
const deleteUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _h, _j;
    try {
        if (((_h = req.user) === null || _h === void 0 ? void 0 : _h.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden eliminar usuarios' });
        }
        const { id } = req.params;
        const currentUserId = (_j = req.user) === null || _j === void 0 ? void 0 : _j.id;
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
        yield (0, db_1.execute)('UPDATE customers SET user_id = NULL WHERE user_id = ?', [id]);
        res.json({ message: 'Usuario eliminado', id });
    }
    catch (error) {
        console.error('deleteUser:', error);
        res.status(500).json({ message: 'Error eliminando usuario' });
    }
});
exports.deleteUser = deleteUser;
/** Actualizar usuario (price_list_id solo para roles que no sean SELLER). Solo ADMIN. */
const updateUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _k, _l;
    try {
        if (((_k = req.user) === null || _k === void 0 ? void 0 : _k.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden actualizar usuarios' });
        }
        const { id } = req.params;
        const body = req.body;
        const existing = yield (0, db_1.get)('SELECT id, role FROM users WHERE id = ?', [id]);
        if (!existing)
            return res.status(404).json({ message: 'Usuario no encontrado' });
        const userRole = String((_l = existing.role) !== null && _l !== void 0 ? _l : '');
        let didUpdate = false;
        if (body.priceListId !== undefined) {
            if (userRole === 'SELLER') {
                yield (0, db_1.execute)('UPDATE users SET price_list_id = NULL WHERE id = ?', [id]);
            }
            else {
                const plId = body.priceListId && body.priceListId.trim() ? body.priceListId.trim() : null;
                yield (0, db_1.execute)('UPDATE users SET price_list_id = ? WHERE id = ?', [plId, id]);
            }
            didUpdate = true;
        }
        if (body.commissionPercentage !== undefined) {
            const commission = Number(body.commissionPercentage);
            if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
                return res.status(400).json({ message: 'commissionPercentage debe estar entre 0 y 100' });
            }
            yield (0, db_1.execute)('UPDATE users SET commission_percentage = ? WHERE id = ?', [commission, id]);
            didUpdate = true;
        }
        if (body.email !== undefined) {
            if (userRole !== 'SELLER') {
                return res.status(400).json({ message: 'Solo se puede editar email de vendedores desde esta pantalla' });
            }
            const nextEmail = String(body.email || '').trim().toLowerCase();
            if (!nextEmail || !nextEmail.includes('@')) {
                return res.status(400).json({ message: 'Email inválido' });
            }
            const existingEmail = yield (0, db_1.get)('SELECT id FROM users WHERE email = ? AND id <> ?', [nextEmail, id]);
            if (existingEmail) {
                return res.status(409).json({ message: 'Ya existe un usuario con ese email' });
            }
            yield (0, db_1.execute)('UPDATE users SET email = ? WHERE id = ?', [nextEmail, id]);
            didUpdate = true;
        }
        if (body.password !== undefined) {
            if (userRole !== 'SELLER') {
                return res.status(400).json({ message: 'Solo se puede editar contraseña de vendedores desde esta pantalla' });
            }
            const nextPassword = String(body.password || '');
            if (nextPassword.length < 4) {
                return res.status(400).json({ message: 'La contraseña debe tener al menos 4 caracteres' });
            }
            yield (0, db_1.execute)('UPDATE users SET password = ? WHERE id = ?', [nextPassword, id]);
            didUpdate = true;
        }
        if (didUpdate && userRole === 'SELLER') {
            yield (0, db_1.execute)('UPDATE users SET price_list_id = NULL WHERE id = ?', [id]);
        }
        if (!didUpdate) {
            return res.status(400).json({ message: 'No hay campos para actualizar' });
        }
        const updated = yield (0, db_1.get)(`SELECT id, name, email, role, commission_percentage AS commissionPercentage,
              CASE WHEN role = 'SELLER' THEN NULL ELSE price_list_id END AS priceListId
       FROM users WHERE id = ?`, [id]);
        res.json(updated);
    }
    catch (error) {
        console.error('updateUser:', error);
        res.status(500).json({ message: 'Error actualizando usuario' });
    }
});
exports.updateUser = updateUser;
