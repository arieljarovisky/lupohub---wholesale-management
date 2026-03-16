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
exports.importCustomers = exports.deleteCustomer = exports.updateCustomer = exports.createCustomer = exports.getCustomers = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
function toCustomer(row, transportes) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    return {
        id: row.id,
        sellerId: (_a = row.seller_id) !== null && _a !== void 0 ? _a : '',
        userId: (_b = row.user_id) !== null && _b !== void 0 ? _b : undefined,
        name: (_c = row.name) !== null && _c !== void 0 ? _c : '',
        businessName: (_d = row.business_name) !== null && _d !== void 0 ? _d : '',
        email: (_e = row.email) !== null && _e !== void 0 ? _e : '',
        address: (_f = row.address) !== null && _f !== void 0 ? _f : '',
        city: (_g = row.city) !== null && _g !== void 0 ? _g : '',
        cuit: (_h = row.cuit) !== null && _h !== void 0 ? _h : undefined,
        phone: (_j = row.phone) !== null && _j !== void 0 ? _j : undefined,
        condicionIva: (_k = row.condicion_iva) !== null && _k !== void 0 ? _k : undefined,
        priceListId: (_l = row.price_list_id) !== null && _l !== void 0 ? _l : undefined,
        transportes: transportes !== null && transportes !== void 0 ? transportes : []
    };
}
/** Listar todos los clientes (camelCase para el frontend) con transportes asignados. */
const getCustomers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const rows = yield (0, db_1.query)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id
       FROM customers ORDER BY business_name ASC, name ASC`);
        const customers = (rows || []).map((r) => toCustomer(r));
        const ids = customers.map((c) => c.id);
        if (ids.length === 0)
            return res.json(customers);
        const placeholders = ids.map(() => '?').join(',');
        const links = yield (0, db_1.query)(`SELECT ct.customer_id AS customerId, t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress
       FROM customer_transportes ct
       JOIN transportes t ON t.id = ct.transporte_id
       WHERE ct.customer_id IN (${placeholders})
       ORDER BY t.name ASC`, ids);
        const transportesByCustomer = {};
        for (const c of customers)
            transportesByCustomer[c.id] = [];
        for (const link of (links || [])) {
            const custId = link.customerId;
            if (transportesByCustomer[custId])
                transportesByCustomer[custId].push({ id: link.transporteId, name: (_a = link.transporteName) !== null && _a !== void 0 ? _a : link.transporteId, address: (_b = link.transporteAddress) !== null && _b !== void 0 ? _b : undefined });
        }
        const result = customers.map((c) => { var _a; return toCustomer(c, (_a = transportesByCustomer[c.id]) !== null && _a !== void 0 ? _a : []); });
        res.json(result);
    }
    catch (error) {
        console.error('getCustomers:', error);
        res.status(500).json({ message: 'Error listando clientes' });
    }
});
exports.getCustomers = getCustomers;
/** Crear cliente. */
const createCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
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
        const cuit = ((_g = body.cuit) !== null && _g !== void 0 ? _g : '').toString().trim() || null;
        const phone = ((_h = body.phone) !== null && _h !== void 0 ? _h : '').toString().trim() || null;
        const condicionIva = ((_j = body.condicionIva) !== null && _j !== void 0 ? _j : '').toString().trim() || null;
        const priceListId = ((_k = body.priceListId) === null || _k === void 0 ? void 0 : _k.trim()) || null;
        yield (0, db_1.execute)(`INSERT INTO customers (id, seller_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, sellerId, name || businessName, businessName || name, email, address, city, cuit, phone, condicionIva, priceListId]);
        const created = yield (0, db_1.get)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id FROM customers WHERE id = ?`, [id]);
        const transporteIds = Array.isArray(body.transporteIds) ? body.transporteIds.filter((x) => x && typeof x === 'string') : [];
        for (const tid of transporteIds) {
            yield (0, db_1.execute)(`INSERT IGNORE INTO customer_transportes (customer_id, transporte_id) VALUES (?, ?)`, [id, tid]);
        }
        const links = yield (0, db_1.query)(`SELECT t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress FROM customer_transportes ct JOIN transportes t ON t.id = ct.transporte_id WHERE ct.customer_id = ? ORDER BY t.name`, [id]);
        const transportes = (links || []).map((l) => { var _a, _b; return ({ id: l.transporteId, name: (_a = l.transporteName) !== null && _a !== void 0 ? _a : l.transporteId, address: (_b = l.transporteAddress) !== null && _b !== void 0 ? _b : undefined }); });
        res.status(201).json(toCustomer(created, transportes));
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
    var _a, _b, _c, _d, _e, _f, _g, _h;
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
        if (body.cuit !== undefined) {
            updates.push('cuit = ?');
            params.push(((_e = body.cuit) === null || _e === void 0 ? void 0 : _e.trim()) || null);
        }
        if (body.phone !== undefined) {
            updates.push('phone = ?');
            params.push(((_f = body.phone) === null || _f === void 0 ? void 0 : _f.trim()) || null);
        }
        if (body.condicionIva !== undefined) {
            updates.push('condicion_iva = ?');
            params.push(((_g = body.condicionIva) === null || _g === void 0 ? void 0 : _g.trim()) || null);
        }
        if (body.sellerId !== undefined) {
            updates.push('seller_id = ?');
            params.push(((_h = body.sellerId) === null || _h === void 0 ? void 0 : _h.trim()) || null);
        }
        if (body.priceListId !== undefined) {
            updates.push('price_list_id = ?');
            params.push(body.priceListId && body.priceListId.trim() ? body.priceListId.trim() : null);
        }
        if (updates.length > 0) {
            params.push(id);
            yield (0, db_1.execute)(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`, params);
        }
        if (body.transporteIds !== undefined) {
            yield (0, db_1.execute)(`DELETE FROM customer_transportes WHERE customer_id = ?`, [id]);
            const transporteIds = Array.isArray(body.transporteIds) ? body.transporteIds.filter((x) => x && typeof x === 'string') : [];
            for (const tid of transporteIds) {
                yield (0, db_1.execute)(`INSERT IGNORE INTO customer_transportes (customer_id, transporte_id) VALUES (?, ?)`, [id, tid]);
            }
        }
        const updated = yield (0, db_1.get)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id FROM customers WHERE id = ?`, [id]);
        const links = yield (0, db_1.query)(`SELECT t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress FROM customer_transportes ct JOIN transportes t ON t.id = ct.transporte_id WHERE ct.customer_id = ? ORDER BY t.name`, [id]);
        const transportes = (links || []).map((l) => { var _a, _b; return ({ id: l.transporteId, name: (_a = l.transporteName) !== null && _a !== void 0 ? _a : l.transporteId, address: (_b = l.transporteAddress) !== null && _b !== void 0 ? _b : undefined }); });
        res.json(toCustomer(updated, transportes));
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
/** Importar clientes en lote. Se exige razón social y CUIT. No duplica por CUIT ni por email. */
const importCustomers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const body = req.body;
        const rows = Array.isArray(body.customers) ? body.customers : [];
        const sellerId = ((_a = body.sellerId) === null || _a === void 0 ? void 0 : _a.trim()) || null;
        let created = 0;
        let skipped = 0;
        const errors = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const name = ((_b = r.name) !== null && _b !== void 0 ? _b : '').toString().trim();
            const businessName = ((_c = r.businessName) !== null && _c !== void 0 ? _c : '').toString().trim();
            let email = ((_d = r.email) !== null && _d !== void 0 ? _d : '').toString().trim();
            const address = ((_e = r.address) !== null && _e !== void 0 ? _e : '').toString().trim() || null;
            const city = ((_f = r.city) !== null && _f !== void 0 ? _f : '').toString().trim() || null;
            const cuit = ((_g = r.cuit) !== null && _g !== void 0 ? _g : '').toString().trim() || null;
            const cuitSolo = (cuit || '').replace(/\D/g, '');
            const phone = ((_h = r.phone) !== null && _h !== void 0 ? _h : '').toString().trim() || null;
            const condicionIva = ((_j = r.condicionIva) !== null && _j !== void 0 ? _j : '').toString().trim() || null;
            const rowNum = i + 1;
            if (!businessName && !name) {
                errors.push({ row: rowNum, message: 'Falta razón social' });
                continue;
            }
            if (!cuit || !cuitSolo) {
                errors.push({ row: rowNum, message: 'Falta CUIT' });
                continue;
            }
            if (!email) {
                email = `importado-${cuitSolo}@sin-email.local`;
            }
            const existingByCuit = cuit ? yield (0, db_1.get)(`SELECT id FROM customers WHERE cuit = ? LIMIT 1`, [cuit]) : null;
            if (existingByCuit) {
                skipped++;
                continue;
            }
            const existingByEmail = yield (0, db_1.get)(`SELECT id FROM customers WHERE email = ? LIMIT 1`, [email]);
            if (existingByEmail) {
                skipped++;
                continue;
            }
            const id = (0, uuid_1.v4)();
            const nameVal = name || businessName;
            const businessNameVal = businessName || name;
            try {
                yield (0, db_1.execute)(`INSERT INTO customers (id, seller_id, name, business_name, email, address, city, cuit, phone, condicion_iva, price_list_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, sellerId, nameVal, businessNameVal, email, address, city, cuit, phone, condicionIva, null]);
                created++;
            }
            catch (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    skipped++;
                }
                else {
                    errors.push({ row: rowNum, email, message: err.message || 'Error al crear' });
                }
            }
        }
        res.json({ created, skipped, errors });
    }
    catch (error) {
        console.error('importCustomers:', error);
        res.status(500).json({ message: 'Error importando clientes' });
    }
});
exports.importCustomers = importCustomers;
