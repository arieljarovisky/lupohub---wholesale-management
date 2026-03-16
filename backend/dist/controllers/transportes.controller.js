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
exports.deleteTransporte = exports.updateTransporte = exports.createTransporte = exports.getTransportes = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
/** Listar todos los transportes (express). */
const getTransportes = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = yield (0, db_1.query)(`SELECT id, name, address FROM transportes ORDER BY name ASC`);
        res.json((rows || []).map((r) => { var _a; return ({ id: r.id, name: r.name, address: (_a = r.address) !== null && _a !== void 0 ? _a : undefined }); }));
    }
    catch (error) {
        console.error('getTransportes:', error);
        res.status(500).json({ message: 'Error listando transportes' });
    }
});
exports.getTransportes = getTransportes;
/** Crear transporte. */
const createTransporte = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { name, address } = req.body;
        const trimmed = (name !== null && name !== void 0 ? name : '').toString().trim();
        if (!trimmed) {
            return res.status(400).json({ message: 'El nombre del transporte es requerido' });
        }
        const addressVal = (address !== null && address !== void 0 ? address : '').toString().trim() || null;
        const id = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO transportes (id, name, address) VALUES (?, ?, ?)`, [id, trimmed, addressVal]);
        const created = yield (0, db_1.get)(`SELECT id, name, address FROM transportes WHERE id = ?`, [id]);
        res.status(201).json({ id: created.id, name: created.name, address: (_a = created.address) !== null && _a !== void 0 ? _a : undefined });
    }
    catch (error) {
        console.error('createTransporte:', error);
        res.status(500).json({ message: 'Error creando transporte' });
    }
});
exports.createTransporte = createTransporte;
/** Actualizar transporte. */
const updateTransporte = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const { name, address } = req.body;
        const trimmed = (name !== null && name !== void 0 ? name : '').toString().trim();
        if (!trimmed) {
            return res.status(400).json({ message: 'El nombre del transporte es requerido' });
        }
        const existing = yield (0, db_1.get)(`SELECT id FROM transportes WHERE id = ?`, [id]);
        if (!existing)
            return res.status(404).json({ message: 'Transporte no encontrado' });
        const addressVal = (address !== null && address !== void 0 ? address : '').toString().trim() || null;
        yield (0, db_1.execute)(`UPDATE transportes SET name = ?, address = ? WHERE id = ?`, [trimmed, addressVal, id]);
        const updated = yield (0, db_1.get)(`SELECT id, name, address FROM transportes WHERE id = ?`, [id]);
        res.json({ id: updated.id, name: updated.name, address: (_a = updated.address) !== null && _a !== void 0 ? _a : undefined });
    }
    catch (error) {
        console.error('updateTransporte:', error);
        res.status(500).json({ message: 'Error actualizando transporte' });
    }
});
exports.updateTransporte = updateTransporte;
/** Eliminar transporte. */
const deleteTransporte = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const existing = yield (0, db_1.get)(`SELECT id FROM transportes WHERE id = ?`, [id]);
        if (!existing)
            return res.status(404).json({ message: 'Transporte no encontrado' });
        yield (0, db_1.execute)(`DELETE FROM customer_transportes WHERE transporte_id = ?`, [id]);
        yield (0, db_1.execute)(`DELETE FROM transportes WHERE id = ?`, [id]);
        res.status(204).send();
    }
    catch (error) {
        console.error('deleteTransporte:', error);
        res.status(500).json({ message: 'Error eliminando transporte' });
    }
});
exports.deleteTransporte = deleteTransporte;
