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
exports.clearDispatchedPendingsForCustomer = exports.exportSaldosPendientesCsv = exports.getSaldosPendientes = exports.bulkUpdateCuit = exports.importCustomers = exports.deleteCustomer = exports.attachUserToCustomer = exports.updateCustomer = exports.createCustomer = exports.getCustomers = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
function toCustomer(row, transportes) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
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
        transportNumber: (_k = row.transport_number) !== null && _k !== void 0 ? _k : undefined,
        remitoNumber: (_l = row.remito_number) !== null && _l !== void 0 ? _l : undefined,
        saleCondition: (_m = row.sale_condition) !== null && _m !== void 0 ? _m : undefined,
        condicionIva: (_o = row.condicion_iva) !== null && _o !== void 0 ? _o : undefined,
        priceListId: (_p = row.price_list_id) !== null && _p !== void 0 ? _p : undefined,
        legacyCode: (_q = row.legacy_code) !== null && _q !== void 0 ? _q : undefined,
        accountZone: (_r = row.account_zone) !== null && _r !== void 0 ? _r : undefined,
        accountSellerLabel: (_s = row.account_seller_label) !== null && _s !== void 0 ? _s : undefined,
        transportes: transportes !== null && transportes !== void 0 ? transportes : []
    };
}
/** Listar todos los clientes (camelCase para el frontend) con transportes asignados. */
const getCustomers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const rows = yield (0, db_1.query)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id,
              legacy_code, account_zone, account_seller_label
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
        const result = customers.map((c) => { var _a; return (Object.assign(Object.assign({}, c), { transportes: (_a = transportesByCustomer[c.id]) !== null && _a !== void 0 ? _a : [] })); });
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
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
        const transportNumber = ((_j = body.transportNumber) !== null && _j !== void 0 ? _j : '').toString().trim() || null;
        const remitoNumber = ((_k = body.remitoNumber) !== null && _k !== void 0 ? _k : '').toString().trim() || null;
        const saleCondition = ((_l = body.saleCondition) !== null && _l !== void 0 ? _l : '').toString().trim() || null;
        const condicionIva = ((_m = body.condicionIva) !== null && _m !== void 0 ? _m : '').toString().trim() || null;
        const priceListId = ((_o = body.priceListId) === null || _o === void 0 ? void 0 : _o.trim()) || null;
        const legacyCode = ((_p = body.legacyCode) !== null && _p !== void 0 ? _p : '').toString().trim() || null;
        const accountZone = ((_q = body.accountZone) !== null && _q !== void 0 ? _q : '').toString().trim() || null;
        const accountSellerLabel = ((_r = body.accountSellerLabel) !== null && _r !== void 0 ? _r : '').toString().trim() || null;
        // Guardar nombre de contacto y razón social en columnas separadas:
        // - Si solo se carga razón social, "name" queda NULL y "business_name" tiene el valor.
        // - Si solo se carga nombre de contacto, "business_name" toma ese valor.
        const sqlName = name || null;
        const sqlBusinessName = businessName || name || null;
        yield (0, db_1.execute)(`INSERT INTO customers (id, seller_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, sellerId, sqlName, sqlBusinessName, email, address, city, cuit, phone, transportNumber, remitoNumber, saleCondition, condicionIva, priceListId, legacyCode, accountZone, accountSellerLabel]);
        const created = yield (0, db_1.get)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label FROM customers WHERE id = ?`, [id]);
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
/** Actualizar cliente (ej. vendedor, razón social, price_list_id, etc.). */
const updateCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
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
        if (body.transportNumber !== undefined) {
            updates.push('transport_number = ?');
            params.push(((_g = body.transportNumber) === null || _g === void 0 ? void 0 : _g.trim()) || null);
        }
        if (body.remitoNumber !== undefined) {
            updates.push('remito_number = ?');
            params.push(((_h = body.remitoNumber) === null || _h === void 0 ? void 0 : _h.trim()) || null);
        }
        if (body.saleCondition !== undefined) {
            updates.push('sale_condition = ?');
            params.push(((_j = body.saleCondition) === null || _j === void 0 ? void 0 : _j.trim()) || null);
        }
        if (body.condicionIva !== undefined) {
            updates.push('condicion_iva = ?');
            params.push(((_k = body.condicionIva) === null || _k === void 0 ? void 0 : _k.trim()) || null);
        }
        if (body.sellerId !== undefined) {
            updates.push('seller_id = ?');
            params.push(((_l = body.sellerId) === null || _l === void 0 ? void 0 : _l.trim()) || null);
        }
        if (body.priceListId !== undefined) {
            updates.push('price_list_id = ?');
            params.push(body.priceListId && body.priceListId.trim() ? body.priceListId.trim() : null);
        }
        if (body.legacyCode !== undefined) {
            updates.push('legacy_code = ?');
            params.push(((_m = body.legacyCode) === null || _m === void 0 ? void 0 : _m.trim()) || null);
        }
        if (body.accountZone !== undefined) {
            updates.push('account_zone = ?');
            params.push(((_o = body.accountZone) === null || _o === void 0 ? void 0 : _o.trim()) || null);
        }
        if (body.accountSellerLabel !== undefined) {
            updates.push('account_seller_label = ?');
            params.push(((_p = body.accountSellerLabel) === null || _p === void 0 ? void 0 : _p.trim()) || null);
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
        const updated = yield (0, db_1.get)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label FROM customers WHERE id = ?`, [id]);
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
/** Crear o vincular usuario de acceso directo a un cliente (rol CUSTOMER). Solo ADMIN. */
const attachUserToCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const authUser = req.user;
        if (!authUser || authUser.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden asignar usuarios a clientes' });
        }
        const { id } = req.params;
        if (!id)
            return res.status(400).json({ message: 'ID de cliente requerido' });
        const body = req.body;
        const name = ((_a = body.name) !== null && _a !== void 0 ? _a : '').toString().trim();
        const email = ((_b = body.email) !== null && _b !== void 0 ? _b : '').toString().trim();
        const password = ((_c = body.password) !== null && _c !== void 0 ? _c : '').toString();
        if (!email || !password) {
            return res.status(400).json({ message: 'Email y contraseña son requeridos para crear el usuario del cliente' });
        }
        const existingCustomer = yield (0, db_1.get)('SELECT id, user_id, business_name, name, email FROM customers WHERE id = ?', [id]);
        if (!existingCustomer) {
            return res.status(404).json({ message: 'Cliente no encontrado' });
        }
        // Si ya tiene user_id asociado, no creamos otro usuario
        if (existingCustomer.user_id) {
            return res.status(400).json({ message: 'Este cliente ya tiene un usuario asignado' });
        }
        // ¿Ya existe un usuario con ese email?
        const existingUser = yield (0, db_1.get)('SELECT id, name, email, role FROM users WHERE email = ?', [email]);
        let userId;
        if (existingUser) {
            // Solo permitimos vincular usuarios de rol CUSTOMER
            if (existingUser.role !== 'CUSTOMER') {
                return res.status(400).json({ message: 'Ya existe un usuario con ese email y no es de tipo CLIENTE' });
            }
            userId = existingUser.id;
        }
        else {
            // Crear usuario nuevo con rol CUSTOMER
            userId = (0, uuid_1.v4)();
            const displayName = name ||
                existingCustomer.business_name ||
                existingCustomer.name ||
                email;
            yield (0, db_1.execute)('INSERT INTO users (id, name, email, password, role, commission_percentage) VALUES (?, ?, ?, ?, ?, ?)', [userId, displayName, email, password, 'CUSTOMER', 0]);
        }
        // Vincular usuario al cliente
        yield (0, db_1.execute)('UPDATE customers SET user_id = ? WHERE id = ?', [userId, id]);
        const updated = yield (0, db_1.get)(`SELECT id, seller_id, user_id, name, business_name, email, address, city, cuit, phone, transport_number, remito_number, sale_condition, condicion_iva, price_list_id, legacy_code, account_zone, account_seller_label FROM customers WHERE id = ?`, [id]);
        const links = yield (0, db_1.query)(`SELECT t.id AS transporteId, t.name AS transporteName, t.address AS transporteAddress FROM customer_transportes ct JOIN transportes t ON t.id = ct.transporte_id WHERE ct.customer_id = ? ORDER BY t.name`, [id]);
        const transportes = (links || []).map((l) => {
            var _a, _b;
            return ({
                id: l.transporteId,
                name: (_a = l.transporteName) !== null && _a !== void 0 ? _a : l.transporteId,
                address: (_b = l.transporteAddress) !== null && _b !== void 0 ? _b : undefined
            });
        });
        return res.status(200).json(toCustomer(updated, transportes));
    }
    catch (error) {
        console.error('attachUserToCustomer:', error);
        res.status(500).json({ message: 'Error asignando usuario al cliente', detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.attachUserToCustomer = attachUserToCustomer;
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
/** Actualizar CUIT en lote. Recibe lista con identificador (email o razón social) + CUIT; actualiza solo el campo cuit. */
const bulkUpdateCuit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const body = req.body;
        const updates = Array.isArray(body.updates) ? body.updates : [];
        let updated = 0;
        let notFound = 0;
        const errors = [];
        for (let i = 0; i < updates.length; i++) {
            const u = updates[i];
            const cuit = ((_a = u.cuit) !== null && _a !== void 0 ? _a : '').toString().trim().replace(/\D/g, '').slice(0, 11);
            const email = ((_b = u.email) !== null && _b !== void 0 ? _b : '').toString().trim() || null;
            const businessName = ((_c = u.businessName) !== null && _c !== void 0 ? _c : '').toString().trim() || null;
            const newBusinessName = ((_d = u.newBusinessName) !== null && _d !== void 0 ? _d : '').toString().trim() || null;
            const condicionIva = ((_e = u.condicionIva) !== null && _e !== void 0 ? _e : '').toString().trim() || null;
            if (!cuit) {
                errors.push({ row: i + 1, message: 'CUIT vacío' });
                continue;
            }
            if (!email && !businessName) {
                errors.push({ row: i + 1, message: 'Falta email o razón social' });
                continue;
            }
            let customer = null;
            if (email) {
                customer = yield (0, db_1.get)('SELECT id FROM customers WHERE LOWER(TRIM(email)) = LOWER(?) LIMIT 1', [email]);
            }
            if (!customer && businessName) {
                customer = yield (0, db_1.get)('SELECT id, business_name, condicion_iva FROM customers WHERE TRIM(business_name) = ? LIMIT 1', [businessName]);
            }
            if (!customer) {
                notFound++;
                continue;
            }
            const setClauses = ['cuit = ?'];
            const params = [cuit];
            if (newBusinessName) {
                setClauses.push('business_name = ?');
                params.push(newBusinessName);
            }
            if (condicionIva) {
                setClauses.push('condicion_iva = ?');
                params.push(condicionIva);
            }
            params.push(customer.id);
            yield (0, db_1.execute)(`UPDATE customers SET ${setClauses.join(', ')} WHERE id = ?`, params);
            updated++;
        }
        res.json({ updated, notFound, errors });
    }
    catch (error) {
        console.error('bulkUpdateCuit:', error);
        res.status(500).json({ message: 'Error actualizando CUIT en lote' });
    }
});
exports.bulkUpdateCuit = bulkUpdateCuit;
function roleCanViewSaldos(role) {
    return role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';
}
/** Saldos: pedidos con cobro pendiente (IVA 21% sobre neto, neto de NC) menos pagos/recibos en `payments`. */
const getSaldosPendientes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const user = req.user;
    if (!user || !roleCanViewSaldos(user.role)) {
        return res.status(403).json({ message: 'Sin permiso para ver saldos' });
    }
    const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
    const baseParams = user.role === 'SELLER' ? [user.id] : [];
    const paymentsJoin = user.role === 'SELLER'
        ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay ON pay.customer_id = t.customerId`
        : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay ON pay.customer_id = t.customerId`;
    const payParams = user.role === 'SELLER' ? [user.id, user.id] : [];
    const paramsWithNc = [...baseParams, ...payParams];
    const paramsSimple = [...baseParams, ...payParams];
    const mapRows = (rows) => rows.map((r) => {
        var _a, _b, _c, _d, _e;
        return ({
            customerId: r.customerId,
            businessName: (_a = r.businessName) !== null && _a !== void 0 ? _a : '',
            contactName: (_b = r.contactName) !== null && _b !== void 0 ? _b : '',
            cuit: (_c = r.cuit) !== null && _c !== void 0 ? _c : '',
            city: (_d = r.city) !== null && _d !== void 0 ? _d : '',
            email: (_e = r.email) !== null && _e !== void 0 ? _e : '',
            saldoPendiente: Number(r.saldoPendiente) || 0,
            totalCargosPendiente: Number(r.totalCargosPendiente) || 0,
            totalPagos: Number(r.totalPagos) || 0,
            pedidosPendientes: Number(r.pedidosPendientes) || 0
        });
    });
    const sqlWithNc = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;
    const sqlSimple = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(o.total * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;
    try {
        const rows = yield (0, db_1.query)(sqlWithNc, paramsWithNc);
        return res.json(mapRows(rows));
    }
    catch (e) {
        console.warn('[saldos] consulta con NC falló, reintentando sin NC:', e === null || e === void 0 ? void 0 : e.message);
        try {
            const rows = yield (0, db_1.query)(sqlSimple, paramsSimple);
            return res.json(mapRows(rows));
        }
        catch (e2) {
            console.error('getSaldosPendientes:', e2);
            return res.status(500).json({ message: 'Error listando saldos pendientes' });
        }
    }
});
exports.getSaldosPendientes = getSaldosPendientes;
/** Exporta saldos pendientes en CSV (UTF-8 con BOM para Excel). */
const exportSaldosPendientesCsv = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const user = req.user;
    if (!user || !roleCanViewSaldos(user.role)) {
        return res.status(403).json({ message: 'Sin permiso para exportar saldos' });
    }
    const sellerFilter = user.role === 'SELLER' ? ' AND c.seller_id = ?' : '';
    const baseParams = user.role === 'SELLER' ? [user.id] : [];
    const paymentsJoin = user.role === 'SELLER'
        ? `LEFT JOIN (
      SELECT p.customer_id, SUM(p.amount) AS total_pagos
      FROM payments p
      INNER JOIN customers c2 ON c2.id = p.customer_id
      WHERE (p.seller_id = ? OR c2.seller_id = ?)
      GROUP BY p.customer_id
    ) pay ON pay.customer_id = t.customerId`
        : `LEFT JOIN (
      SELECT customer_id, SUM(amount) AS total_pagos
      FROM payments
      GROUP BY customer_id
    ) pay ON pay.customer_id = t.customerId`;
    const payParams = user.role === 'SELLER' ? [user.id, user.id] : [];
    const paramsWithNc = [...baseParams, ...payParams];
    const paramsSimple = [...baseParams, ...payParams];
    const sqlWithNc = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(GREATEST(0, o.total - COALESCE(cn.cn_total, 0)) * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT order_id, SUM(amount_credited) AS cn_total
        FROM credit_notes
        GROUP BY order_id
      ) cn ON cn.order_id = o.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;
    const sqlSimple = `
    SELECT
      t.customerId,
      t.businessName,
      t.contactName,
      t.cuit,
      t.city,
      t.email,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes
    FROM (
      SELECT
        c.id AS customerId,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        c.city,
        c.email,
        SUM(ROUND(o.total * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.business_name, c.name, c.cuit, c.city, c.email
    ) t
    ${paymentsJoin}
    WHERE ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) > 0.01
    ORDER BY t.businessName ASC, t.contactName ASC
  `;
    let rows;
    try {
        rows = (yield (0, db_1.query)(sqlWithNc, paramsWithNc));
    }
    catch (_f) {
        rows = (yield (0, db_1.query)(sqlSimple, paramsSimple));
    }
    const header = [
        'id_cliente',
        'razon_social',
        'contacto',
        'cuit',
        'ciudad',
        'email',
        'pedidos_impagos',
        'total_cargos_iva',
        'pagos_registrados',
        'saldo_pendiente'
    ];
    const lines = [header.join(';')];
    for (const r of rows) {
        const esc = (s) => `"${String(s !== null && s !== void 0 ? s : '').replace(/"/g, '""')}"`;
        lines.push([
            r.customerId,
            esc((_a = r.businessName) !== null && _a !== void 0 ? _a : ''),
            esc((_b = r.contactName) !== null && _b !== void 0 ? _b : ''),
            (_c = r.cuit) !== null && _c !== void 0 ? _c : '',
            esc((_d = r.city) !== null && _d !== void 0 ? _d : ''),
            esc((_e = r.email) !== null && _e !== void 0 ? _e : ''),
            Number(r.pedidosPendientes) || 0,
            (Number(r.totalCargosPendiente) || 0).toFixed(2).replace('.', ','),
            (Number(r.totalPagos) || 0).toFixed(2).replace('.', ','),
            (Number(r.saldoPendiente) || 0).toFixed(2).replace('.', ',')
        ].join(';'));
    }
    const csv = lines.join('\r\n');
    const filename = `saldos_pendientes_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
});
exports.exportSaldosPendientesCsv = exportSaldosPendientesCsv;
/** Quita pendientes de pedidos ya despachados para un cliente:
 *  - Si quantity > picked, deja quantity = picked (solo lo enviado)
 *  - Elimina renglones con quantity <= 0
 *  - Recalcula total del pedido
 */
const clearDispatchedPendingsForCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const authUser = req.user;
        if (!authUser || !['ADMIN', 'SELLER', 'WAREHOUSE', 'DEPOSITO'].includes(authUser.role)) {
            return res.status(403).json({ message: 'Sin permisos para quitar pendientes' });
        }
        const { id: customerId } = req.params;
        if (!customerId)
            return res.status(400).json({ message: 'ID de cliente requerido' });
        const customer = yield (0, db_1.get)('SELECT id, seller_id FROM customers WHERE id = ?', [customerId]);
        if (!customer)
            return res.status(404).json({ message: 'Cliente no encontrado' });
        if (authUser.role === 'SELLER' && customer.seller_id && customer.seller_id !== authUser.id) {
            return res.status(403).json({ message: 'Solo podés operar sobre tus clientes' });
        }
        const dispatchedOrders = yield (0, db_1.query)(`SELECT id FROM orders
       WHERE customer_id = ?
         AND status IN ('Despachado', 'DISPATCHED')`, [customerId]);
        const orderIds = (dispatchedOrders || []).map((o) => o.id).filter(Boolean);
        if (orderIds.length === 0) {
            return res.json({ message: 'No hay pedidos despachados para ajustar', ordersUpdated: 0, itemsAdjusted: 0, itemsRemoved: 0 });
        }
        let itemsAdjusted = 0;
        let itemsRemoved = 0;
        let ordersUpdated = 0;
        for (const orderId of orderIds) {
            const beforeAdjust = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt
         FROM order_items
         WHERE order_id = ? AND quantity > COALESCE(picked, 0)`, [orderId]);
            const toAdjust = Number((beforeAdjust === null || beforeAdjust === void 0 ? void 0 : beforeAdjust.cnt) || 0);
            if (toAdjust > 0) {
                yield (0, db_1.execute)(`UPDATE order_items
           SET quantity = COALESCE(picked, 0)
           WHERE order_id = ? AND quantity > COALESCE(picked, 0)`, [orderId]);
                itemsAdjusted += toAdjust;
            }
            const beforeDelete = yield (0, db_1.get)(`SELECT COUNT(*) AS cnt FROM order_items WHERE order_id = ? AND quantity <= 0`, [orderId]);
            const toDelete = Number((beforeDelete === null || beforeDelete === void 0 ? void 0 : beforeDelete.cnt) || 0);
            if (toDelete > 0) {
                yield (0, db_1.execute)(`DELETE FROM order_items WHERE order_id = ? AND quantity <= 0`, [orderId]);
                itemsRemoved += toDelete;
            }
            const totalRow = yield (0, db_1.get)(`SELECT COALESCE(SUM(quantity * price_at_moment), 0) AS total
         FROM order_items
         WHERE order_id = ?`, [orderId]);
            yield (0, db_1.execute)(`UPDATE orders SET total = ? WHERE id = ?`, [Number((totalRow === null || totalRow === void 0 ? void 0 : totalRow.total) || 0), orderId]);
            if (toAdjust > 0 || toDelete > 0)
                ordersUpdated++;
        }
        return res.json({
            message: 'Pendientes de pedidos despachados ajustados',
            ordersUpdated,
            itemsAdjusted,
            itemsRemoved
        });
    }
    catch (error) {
        console.error('clearDispatchedPendingsForCustomer:', error);
        res.status(500).json({ message: 'Error quitando pendientes de pedidos despachados' });
    }
});
exports.clearDispatchedPendingsForCustomer = clearDispatchedPendingsForCustomer;
