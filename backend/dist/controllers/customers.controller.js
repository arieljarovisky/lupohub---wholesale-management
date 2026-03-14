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
exports.deleteCustomer = exports.updateCustomer = exports.createCustomer = exports.getCustomers = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
function toCustomer(row) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    return {
        id: row.id,
        sellerId: (_a = row.seller_id) !== null && _a !== void 0 ? _a : '',
        userId: (_b = row.user_id) !== null && _b !== void 0 ? _b : undefined,
        name: (_c = row.name) !== null && _c !== void 0 ? _c : '',
        businessName: (_d = row.business_name) !== null && _d !== void 0 ? _d : '',
        email: (_e = row.email) !== null && _e !== void 0 ? _e : '',
        address: (_f = row.address) !== null && _f !== void 0 ? _f : '',
        city: (_g = row.city) !== null && _g !== void 0 ? _g : '',
        priceListId: (_h = row.price_list_id) !== null && _h !== void 0 ? _h : undefined
    };
}
/** Listar todos los clientes (camelCase para el frontend). */
const getCustomers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = yield (0, db_1.query)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, price_list_id
       FROM customers ORDER BY business_name ASC, name ASC`);
        const customers = (rows || []).map(toCustomer);
        res.json(customers);
    }
    catch (error) {
        console.error('getCustomers:', error);
        res.status(500).json({ message: 'Error listando clientes' });
    }
});
exports.getCustomers = getCustomers;
/** Crear cliente. */
const createCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const body = req.body;
        const name = ((_a = body.name) !== null && _a !== void 0 ? _a : '').toString().trim();
        const businessName = ((_b = body.businessName) !== null && _b !== void 0 ? _b : '').toString().trim();
        const email = ((_c = body.email) !== null && _c !== void 0 ? _c : '').toString().trim();
        if (!businessName && !name) {
            return res.status(400).json({ message: 'Razón social o nombre de contacto es requerido' });
        }
        if (!email) {
            return res.status(400).json({ message: 'El email es requerido' });
        }
        const id = body.id && body.id.trim() ? body.id.trim() : (0, uuid_1.v4)();
        const sellerId = ((_d = body.sellerId) === null || _d === void 0 ? void 0 : _d.trim()) || null;
        const address = ((_e = body.address) !== null && _e !== void 0 ? _e : '').toString().trim() || null;
        const city = ((_f = body.city) !== null && _f !== void 0 ? _f : '').toString().trim() || null;
        const priceListId = ((_g = body.priceListId) === null || _g === void 0 ? void 0 : _g.trim()) || null;
        yield (0, db_1.execute)(`INSERT INTO customers (id, seller_id, name, business_name, email, address, city, price_list_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, sellerId, name || businessName, businessName || name, email, address, city, priceListId]);
        const created = yield (0, db_1.get)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, price_list_id FROM customers WHERE id = ?`, [id]);
        res.status(201).json(toCustomer(created));
    }
    catch (error) {
        console.error('createCustomer:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Ya existe un cliente con ese ID' });
        }
        res.status(500).json({ message: 'Error creando cliente' });
    }
});
exports.createCustomer = createCustomer;
/** Actualizar cliente (ej. price_list_id para clientes con acceso). */
const updateCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const { id } = req.params;
        const body = req.body;
        const existing = yield (0, db_1.get)('SELECT id FROM customers WHERE id = ?', [id]);
        if (!existing)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        const updates = [];
        const params = [];
        if (body.name !== undefined) {
            updates.push('name = ?');
            params.push(body.name.trim());
        }
        if (body.businessName !== undefined) {
            updates.push('business_name = ?');
            params.push(((_a = body.businessName) === null || _a === void 0 ? void 0 : _a.trim()) || null);
        }
        if (body.email !== undefined) {
            updates.push('email = ?');
            params.push(((_b = body.email) === null || _b === void 0 ? void 0 : _b.trim()) || null);
        }
        if (body.address !== undefined) {
            updates.push('address = ?');
            params.push(((_c = body.address) === null || _c === void 0 ? void 0 : _c.trim()) || null);
        }
        if (body.city !== undefined) {
            updates.push('city = ?');
            params.push(((_d = body.city) === null || _d === void 0 ? void 0 : _d.trim()) || null);
        }
        if (body.sellerId !== undefined) {
            updates.push('seller_id = ?');
            params.push(((_e = body.sellerId) === null || _e === void 0 ? void 0 : _e.trim()) || null);
        }
        if (body.priceListId !== undefined) {
            updates.push('price_list_id = ?');
            params.push(body.priceListId && body.priceListId.trim() ? body.priceListId.trim() : null);
        }
        if (updates.length > 0) {
            params.push(id);
            yield (0, db_1.execute)(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`, params);
        }
        const updated = yield (0, db_1.get)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, price_list_id FROM customers WHERE id = ?`, [id]);
        res.json(toCustomer(updated));
    }
    catch (error) {
        console.error('updateCustomer:', error);
        res.status(500).json({ message: 'Error actualizando cliente' });
    }
});
exports.updateCustomer = updateCustomer;
/** Eliminar cliente. No se permite si tiene pedidos asociados. */
const deleteCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const existing = yield (0, db_1.get)('SELECT id FROM customers WHERE id = ?', [id]);
        if (!existing)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        const orderRow = yield (0, db_1.get)('SELECT 1 FROM orders WHERE customer_id = ? LIMIT 1', [id]);
        if (orderRow) {
            return res.status(400).json({
                message: 'No se puede eliminar el cliente porque tiene pedidos asociados. Eliminá o reassigná los pedidos primero.'
            });
        }
        yield (0, db_1.execute)('DELETE FROM customers WHERE id = ?', [id]);
        res.status(204).send();
    }
    catch (error) {
        console.error('deleteCustomer:', error);
        res.status(500).json({ message: 'Error eliminando cliente' });
    }
});
exports.deleteCustomer = deleteCustomer;
