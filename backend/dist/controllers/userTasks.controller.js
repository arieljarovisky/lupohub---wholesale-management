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
exports.deleteAssignedUserTask = exports.createAssignedUserTask = exports.listAssignedUserTasks = exports.getMyUserTasks = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const TASKS_OWNER_EMAIL = 'ariel@lupo.ar';
function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}
function isTasksOwner(req) {
    var _a;
    const email = normalizeEmail((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.email);
    return email === TASKS_OWNER_EMAIL;
}
const getMyUserTasks = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const rawEmail = (_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.email;
        const email = normalizeEmail(rawEmail);
        if (!email)
            return res.status(401).json({ message: 'Sesión inválida' });
        // Usar UTC_TIMESTAMP para comparación consistente (expires_at se guarda en UTC)
        const rows = yield (0, db_1.query)(`SELECT id, message, assigned_to_email AS assignedToEmail, created_by_email AS createdByEmail, expires_at AS expiresAt, created_at AS createdAt
       FROM user_tasks
       WHERE LOWER(assigned_to_email) = LOWER(?) AND expires_at > UTC_TIMESTAMP()
       ORDER BY expires_at ASC, created_at DESC`, [email]);
        res.json(rows);
    }
    catch (error) {
        console.error('getMyUserTasks:', error);
        res.status(500).json({ message: 'Error obteniendo tareas' });
    }
});
exports.getMyUserTasks = getMyUserTasks;
const listAssignedUserTasks = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!isTasksOwner(req))
            return res.status(403).json({ message: 'Sin permiso' });
        const rows = yield (0, db_1.query)(`SELECT id, message, assigned_to_email AS assignedToEmail, created_by_email AS createdByEmail, expires_at AS expiresAt, created_at AS createdAt
       FROM user_tasks
       ORDER BY created_at DESC`);
        res.json(rows);
    }
    catch (error) {
        console.error('listAssignedUserTasks:', error);
        res.status(500).json({ message: 'Error listando tareas' });
    }
});
exports.listAssignedUserTasks = listAssignedUserTasks;
const createAssignedUserTask = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        if (!isTasksOwner(req))
            return res.status(403).json({ message: 'Sin permiso' });
        const message = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.message) || '').trim();
        const assignedToEmail = normalizeEmail((_b = req.body) === null || _b === void 0 ? void 0 : _b.assignedToEmail);
        const expiresAt = String(((_c = req.body) === null || _c === void 0 ? void 0 : _c.expiresAt) || '').trim();
        if (!message)
            return res.status(400).json({ message: 'La tarea no puede estar vacía' });
        if (!assignedToEmail || !assignedToEmail.includes('@')) {
            return res.status(400).json({ message: 'assignedToEmail inválido' });
        }
        if (!expiresAt)
            return res.status(400).json({ message: 'expiresAt es obligatorio' });
        // El input datetime-local envía formato YYYY-MM-DDTHH:mm sin timezone
        // El usuario está en Argentina (UTC-3), así que interpretamos la fecha en esa zona
        const expiresDateStr = expiresAt.includes('T') ? expiresAt : `${expiresAt}T00:00`;
        const expiresDate = new Date(expiresDateStr + ':00-03:00');
        if (isNaN(expiresDate.getTime()))
            return res.status(400).json({ message: 'expiresAt inválido' });
        if (expiresDate.getTime() <= Date.now())
            return res.status(400).json({ message: 'La fecha de fin debe ser futura' });
        // Convertir a formato MySQL DATETIME en UTC para evitar problemas de timezone
        const expiresDateUtc = expiresDate.toISOString().slice(0, 19).replace('T', ' ');
        const id = (0, uuid_1.v4)();
        const creator = (req === null || req === void 0 ? void 0 : req.user) || {};
        const createdByEmail = normalizeEmail(creator.email);
        const createdByUserId = creator.id || null;
        yield (0, db_1.execute)(`INSERT INTO user_tasks (id, message, assigned_to_email, created_by_user_id, created_by_email, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [id, message, assignedToEmail, createdByUserId, createdByEmail, expiresDateUtc]);
        const created = yield (0, db_1.get)(`SELECT id, message, assigned_to_email AS assignedToEmail, created_by_email AS createdByEmail, expires_at AS expiresAt, created_at AS createdAt
       FROM user_tasks WHERE id = ?`, [id]);
        res.status(201).json(created);
    }
    catch (error) {
        console.error('createAssignedUserTask:', error);
        res.status(500).json({ message: 'Error creando tarea' });
    }
});
exports.createAssignedUserTask = createAssignedUserTask;
const deleteAssignedUserTask = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!isTasksOwner(req))
            return res.status(403).json({ message: 'Sin permiso' });
        const { id } = req.params;
        if (!id)
            return res.status(400).json({ message: 'ID inválido' });
        yield (0, db_1.execute)('DELETE FROM user_tasks WHERE id = ?', [id]);
        res.json({ id });
    }
    catch (error) {
        console.error('deleteAssignedUserTask:', error);
        res.status(500).json({ message: 'Error eliminando tarea' });
    }
});
exports.deleteAssignedUserTask = deleteAssignedUserTask;
