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
exports.createCustomer = exports.getCustomers = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
function toCustomer(row) {
    var _a, _b, _c, _d, _e, _f;
    return {
        id: row.id,
        sellerId: (_a = row.seller_id) !== null && _a !== void 0 ? _a : '',
        name: (_b = row.name) !== null && _b !== void 0 ? _b : '',
        businessName: (_c = row.business_name) !== null && _c !== void 0 ? _c : '',
        email: (_d = row.email) !== null && _d !== void 0 ? _d : '',
        address: (_e = row.address) !== null && _e !== void 0 ? _e : '',
        city: (_f = row.city) !== null && _f !== void 0 ? _f : ''
    };
}
/** Listar todos los clientes (camelCase para el frontend). */
const getCustomers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = yield (0, db_1.query)(`SELECT id, seller_id, name, business_name, email, address, city 
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
    var _a, _b, _c, _d, _e, _f;
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
        yield (0, db_1.execute)(`INSERT INTO customers (id, seller_id, name, business_name, email, address, city) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, sellerId, name || businessName, businessName || name, email, address, city]);
        const created = yield (0, db_1.get)(`SELECT id, seller_id, name, business_name, email, address, city FROM customers WHERE id = ?`, [id]);
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
