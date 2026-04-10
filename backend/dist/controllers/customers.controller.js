"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.clearDispatchedPendingsForCustomer = exports.assignCustomerSellersFromResumen = exports.exportSaldosPendientesMultimediasXlsx = exports.exportSaldosPendientesCsv = exports.getSaldosPendientes = exports.bulkUpdateCuit = exports.importCustomers = exports.deleteCustomer = exports.attachUserToCustomer = exports.updateCustomer = exports.createCustomer = exports.getCustomers = void 0;
const XLSX = __importStar(require("xlsx"));
const exceljs_1 = __importDefault(require("exceljs"));
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const multimediaHistorialExcel_1 = require("../utils/multimediaHistorialExcel");
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
/**
 * Excel una sola hoja "Resumen" estilizada: Código, Cliente, Vendedor habitual, Zona, Saldo final, Movimientos.
 * Saldo final = (LupoHub: pedidos pendientes IVA incl. − pagos) + (último saldo cuenta importada Excel).
 * Movimientos = líneas en historial importado + cantidad de pedidos pendientes (misma idea que cartera unificada).
 * Incluye clientes con saldo solo en cuenta importada aunque no tengan pedidos pendientes en LupoHub.
 */
const exportSaldosPendientesMultimediasXlsx = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
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
      t.legacy_code,
      t.account_zone,
      t.account_seller_label,
      t.seller_id,
      t.businessName,
      t.contactName,
      t.cuit,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes,
      u.name AS seller_name
    FROM (
      SELECT
        c.id AS customerId,
        c.legacy_code,
        c.account_zone,
        c.account_seller_label,
        c.seller_id,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
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
      GROUP BY c.id, c.legacy_code, c.account_zone, c.account_seller_label, c.seller_id, c.business_name, c.name, c.cuit
    ) t
    LEFT JOIN users u ON u.id = t.seller_id
    ${paymentsJoin}
    ORDER BY t.businessName ASC, t.contactName ASC
  `;
    const sqlSimple = `
    SELECT
      t.customerId,
      t.legacy_code,
      t.account_zone,
      t.account_seller_label,
      t.seller_id,
      t.businessName,
      t.contactName,
      t.cuit,
      ROUND(GREATEST(0, t.cargosPendientes - COALESCE(pay.total_pagos, 0)), 2) AS saldoPendiente,
      ROUND(t.cargosPendientes, 2) AS totalCargosPendiente,
      ROUND(COALESCE(pay.total_pagos, 0), 2) AS totalPagos,
      t.pedidosPendientes,
      u.name AS seller_name
    FROM (
      SELECT
        c.id AS customerId,
        c.legacy_code,
        c.account_zone,
        c.account_seller_label,
        c.seller_id,
        c.business_name AS businessName,
        c.name AS contactName,
        c.cuit,
        SUM(ROUND(o.total * 1.21, 2)) AS cargosPendientes,
        COUNT(DISTINCT o.id) AS pedidosPendientes
      FROM customers c
      INNER JOIN orders o ON o.customer_id = c.id
      WHERE o.payment_status = 'pendiente'
        AND o.status NOT IN ('Cancelado', 'Borrador')
        AND (o.archived = 0 OR o.archived IS NULL)
        ${sellerFilter}
      GROUP BY c.id, c.legacy_code, c.account_zone, c.account_seller_label, c.seller_id, c.business_name, c.name, c.cuit
    ) t
    LEFT JOIN users u ON u.id = t.seller_id
    ${paymentsJoin}
    ORDER BY t.businessName ASC, t.contactName ASC
  `;
    let rows;
    try {
        rows = (yield (0, db_1.query)(sqlWithNc, paramsWithNc));
    }
    catch (_g) {
        rows = (yield (0, db_1.query)(sqlSimple, paramsSimple));
    }
    const sqlMultimediaSaldos = `
    SELECT
      c.id AS customerId,
      c.legacy_code,
      c.account_zone,
      c.account_seller_label,
      c.seller_id,
      c.business_name AS businessName,
      c.name AS contactName,
      c.cuit,
      CAST(COALESCE((
        SELECT CAST(e2.saldo AS DECIMAL(16,2))
        FROM customer_multimedia_entries e2
        WHERE e2.customer_id = agg.customer_id AND e2.saldo IS NOT NULL
        ORDER BY e2.line_order DESC
        LIMIT 1
      ), 0) AS DECIMAL(16,2)) AS lastSaldo,
      agg.cnt AS movementCount,
      u.name AS seller_name
    FROM (
      SELECT customer_id, COUNT(*) AS cnt
      FROM customer_multimedia_entries
      GROUP BY customer_id
    ) agg
    INNER JOIN customers c ON c.id = agg.customer_id
    LEFT JOIN users u ON u.id = c.seller_id
    WHERE 1=1 ${sellerFilter}
  `;
    let mmRows = [];
    try {
        mmRows = (yield (0, db_1.query)(sqlMultimediaSaldos, baseParams));
    }
    catch (_h) {
        mmRows = [];
    }
    const byId = new Map();
    for (const r of rows) {
        const id = String(r.customerId);
        byId.set(id, {
            customerId: id,
            legacy_code: r.legacy_code,
            account_zone: r.account_zone,
            account_seller_label: r.account_seller_label,
            seller_id: r.seller_id,
            businessName: String((_a = r.businessName) !== null && _a !== void 0 ? _a : ''),
            contactName: String((_b = r.contactName) !== null && _b !== void 0 ? _b : ''),
            cuit: String((_c = r.cuit) !== null && _c !== void 0 ? _c : ''),
            saldoPendiente: Number(r.saldoPendiente) || 0,
            pedidosPendientes: Number(r.pedidosPendientes) || 0,
            seller_name: r.seller_name,
            movementCountExcel: 0
        });
    }
    for (const m of mmRows) {
        const id = String(m.customerId);
        const excelSaldo = Number(m.lastSaldo) || 0;
        const mmCnt = Number(m.movementCount) || 0;
        const existing = byId.get(id);
        if (existing) {
            existing.saldoPendiente = Math.round((existing.saldoPendiente + excelSaldo) * 100) / 100;
            existing.movementCountExcel = mmCnt;
        }
        else {
            byId.set(id, {
                customerId: id,
                legacy_code: m.legacy_code,
                account_zone: m.account_zone,
                account_seller_label: m.account_seller_label,
                seller_id: m.seller_id,
                businessName: String((_d = m.businessName) !== null && _d !== void 0 ? _d : ''),
                contactName: String((_e = m.contactName) !== null && _e !== void 0 ? _e : ''),
                cuit: String((_f = m.cuit) !== null && _f !== void 0 ? _f : ''),
                saldoPendiente: Math.round(excelSaldo * 100) / 100,
                pedidosPendientes: 0,
                seller_name: m.seller_name,
                movementCountExcel: mmCnt
            });
        }
    }
    const mergedList = [...byId.values()]
        .filter((r) => r.saldoPendiente > 0.01)
        .sort((a, b) => (a.businessName || '').localeCompare(b.businessName || '', 'es') ||
        (a.contactName || '').localeCompare(b.contactName || '', 'es'));
    const borderThin = {
        style: 'thin',
        color: { argb: 'FF94A3B8' }
    };
    const workbook = new exceljs_1.default.Workbook();
    workbook.creator = 'LupoHub';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('Resumen', {
        views: [{ state: 'frozen', ySplit: 1 }],
        properties: { defaultRowHeight: 19 }
    });
    ws.columns = [
        { key: 'codigo', width: 14 },
        { key: 'cliente', width: 44 },
        { key: 'vendedor', width: 24 },
        { key: 'zona', width: 18 },
        { key: 'saldo', width: 16 },
        { key: 'movs', width: 13 }
    ];
    const headerTitles = ['Código', 'Cliente', 'Vendedor habitual', 'Zona', 'Saldo final', 'Movimientos'];
    const headerRow = ws.addRow(headerTitles);
    headerRow.height = 26;
    headerRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1E40AF' }
        };
        cell.alignment = {
            vertical: 'middle',
            horizontal: colNumber >= 5 ? 'right' : 'left',
            wrapText: true
        };
        cell.border = {
            top: borderThin,
            left: borderThin,
            bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } },
            right: borderThin
        };
    });
    let rowNum = 2;
    for (const r of mergedList) {
        const displayName = String(r.businessName || r.contactName || 'Cliente').trim();
        const legacyTrim = r.legacy_code != null ? String(r.legacy_code).trim() : '';
        const code = legacyTrim ||
            (0, multimediaHistorialExcel_1.padLegacyCode)(String(r.customerId || '').replace(/-/g, '').slice(0, 6) || '0');
        const vendedor = (r.account_seller_label != null && String(r.account_seller_label).trim() !== ''
            ? String(r.account_seller_label).trim()
            : '') ||
            (r.seller_id && r.seller_name ? `${String(r.seller_id).slice(0, 8)} - ${r.seller_name}` : '');
        const zona = r.account_zone != null ? String(r.account_zone).trim() : '';
        const saldoFinal = Number(r.saldoPendiente) || 0;
        const movs = (Number(r.movementCountExcel) || 0) + (Number(r.pedidosPendientes) || 0);
        const dataRow = ws.addRow([code, displayName, vendedor, zona, saldoFinal, movs]);
        const zebra = rowNum % 2 === 0;
        dataRow.eachCell((cell, colNumber) => {
            cell.font = { size: 11, name: 'Calibri', color: { argb: 'FF0F172A' } };
            if (zebra) {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF1F5F9' }
                };
            }
            cell.border = {
                top: borderThin,
                left: borderThin,
                bottom: borderThin,
                right: borderThin
            };
            cell.alignment = {
                vertical: 'middle',
                horizontal: colNumber >= 5 ? 'right' : 'left',
                wrapText: colNumber === 2 || colNumber === 3
            };
            if (colNumber === 5) {
                cell.numFmt = '#,##0.00';
            }
            if (colNumber === 6) {
                cell.numFmt = '0';
            }
        });
        rowNum++;
    }
    if (mergedList.length > 0) {
        ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: mergedList.length + 1, column: 6 }
        };
    }
    const out = yield workbook.xlsx.writeBuffer();
    const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="saldos_pendientes_resumen_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
});
exports.exportSaldosPendientesMultimediasXlsx = exportSaldosPendientesMultimediasXlsx;
function normResumenHeader(s) {
    return String(s !== null && s !== void 0 ? s : '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}
function normalizeNameForCustomerMatch(v) {
    return String(v !== null && v !== void 0 ? v : '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}
function cellStrResumenCell(v) {
    if (v == null || v === '')
        return '';
    if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v))
        return String(Math.trunc(v));
    return String(v).trim();
}
/**
 * POST multipart file — hoja Resumen Multimedias: asigna customers.seller_id según "Vendedor habitual"
 * (código numérico) vinculado al usuario vendedor.{codigo}@importado.lupohub.local.
 * Cliente: por legacy_code (columna Código) o por nombre (columna Cliente).
 */
const assignCustomerSellersFromResumen = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const authUser = req.user;
        if (!authUser || authUser.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden asignar vendedores en lote' });
        }
        const file = req.file;
        if (!(file === null || file === void 0 ? void 0 : file.buffer)) {
            return res.status(400).json({ message: 'Subí un archivo .xlsx (campo file)' });
        }
        const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws)
            return res.status(400).json({ message: 'El archivo no tiene hojas' });
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        let headerRow = -1;
        let codigoCol = -1;
        let vendCol = -1;
        let clienteCol = -1;
        for (let r = 0; r < Math.min(15, matrix.length); r++) {
            const h = matrix[r].map((c) => normResumenHeader(String(c !== null && c !== void 0 ? c : '')));
            const ci = h.findIndex((x) => x === 'codigo');
            const vi = h.findIndex((x) => x.includes('vendedor') && x.includes('habitual'));
            const cl = h.findIndex((x) => x.includes('cliente') && !x.includes('vendedor'));
            if (ci >= 0 && vi >= 0) {
                headerRow = r;
                codigoCol = ci;
                vendCol = vi;
                clienteCol = cl >= 0 ? cl : 1;
                break;
            }
        }
        if (headerRow < 0) {
            return res.status(400).json({
                message: 'No se encontró formato Resumen (columnas Código y Vendedor habitual). Usá el Excel historial Multimedias.',
            });
        }
        const custRows = (yield (0, db_1.query)(`SELECT id, legacy_code, business_name, name FROM customers`));
        const legacyToId = new Map();
        const normToId = new Map();
        for (const c of custRows) {
            const lc = (c.legacy_code && String(c.legacy_code).trim()) || '';
            if (lc) {
                legacyToId.set(lc, c.id);
                legacyToId.set((0, multimediaHistorialExcel_1.padLegacyCode)(lc), c.id);
                const strip = lc.replace(/^0+/, '') || '0';
                legacyToId.set(strip, c.id);
                const digits = lc.replace(/\D/g, '');
                if (digits && /^\d+$/.test(digits)) {
                    legacyToId.set(digits, c.id);
                    legacyToId.set((0, multimediaHistorialExcel_1.padLegacyCode)(digits), c.id);
                }
            }
            const bn = normalizeNameForCustomerMatch(c.business_name);
            if (bn)
                normToId.set(bn, c.id);
            const nm = normalizeNameForCustomerMatch(c.name);
            if (nm)
                normToId.set(nm, c.id);
        }
        let rowsProcessed = 0;
        let customersUpdated = 0;
        let skippedNoSeller = 0;
        let skippedNoCustomer = 0;
        let skippedNoVendedorCell = 0;
        for (let i = headerRow + 1; i < matrix.length; i++) {
            const row = matrix[i];
            const codigoRaw = cellStrResumenCell(row[codigoCol]);
            const vendRaw = cellStrResumenCell(row[vendCol]);
            const clienteRaw = clienteCol >= 0 ? cellStrResumenCell(row[clienteCol]) : '';
            if (!codigoRaw && !clienteRaw)
                continue;
            rowsProcessed++;
            if (!vendRaw) {
                skippedNoVendedorCell++;
                continue;
            }
            const vm = vendRaw.match(/^(\d+)\s*[-–—]\s*(.+)$/u);
            const vendCode = vm ? vm[1].trim().replace(/^0+/, '') || vm[1].trim() || '0' : null;
            if (!vendCode) {
                skippedNoSeller++;
                continue;
            }
            const sellerEmail = `vendedor.${vendCode}@importado.lupohub.local`;
            const sellerRow = yield (0, db_1.get)(`SELECT id FROM users WHERE email = ? AND role = 'SELLER'`, [sellerEmail]);
            if (!(sellerRow === null || sellerRow === void 0 ? void 0 : sellerRow.id)) {
                skippedNoSeller++;
                continue;
            }
            let customerId;
            if (codigoRaw) {
                const t = codigoRaw.trim();
                const tryKeys = new Set([t]);
                const digits = t.replace(/\D/g, '');
                if (digits) {
                    tryKeys.add(digits);
                    tryKeys.add((0, multimediaHistorialExcel_1.padLegacyCode)(digits));
                    tryKeys.add(digits.replace(/^0+/, '') || '0');
                }
                for (const k of tryKeys) {
                    const hit = legacyToId.get(k);
                    if (hit) {
                        customerId = hit;
                        break;
                    }
                }
            }
            if (!customerId && clienteRaw) {
                customerId = normToId.get(normalizeNameForCustomerMatch(clienteRaw));
            }
            if (!customerId) {
                skippedNoCustomer++;
                continue;
            }
            yield (0, db_1.execute)(`UPDATE customers SET seller_id = ? WHERE id = ?`, [sellerRow.id, customerId]);
            customersUpdated++;
        }
        res.json({
            message: 'Asignación de vendedores desde Resumen finalizada',
            rowsProcessed,
            customersUpdated,
            skippedNoSeller,
            skippedNoCustomer,
            skippedNoVendedorCell,
        });
    }
    catch (e) {
        console.error('assignCustomerSellersFromResumen:', e);
        res.status(500).json({ message: 'Error asignando vendedores', detail: e === null || e === void 0 ? void 0 : e.message });
    }
});
exports.assignCustomerSellersFromResumen = assignCustomerSellersFromResumen;
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
