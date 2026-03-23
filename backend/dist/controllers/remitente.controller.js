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
exports.saveRemitente = exports.getRemitente = void 0;
const db_1 = require("../database/db");
const afip_service_1 = require("../services/afip.service");
const getRemitente = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const row = yield (0, db_1.get)(`SELECT * FROM remitente_config ORDER BY id DESC LIMIT 1`);
        if (row) {
            return res.json({
                businessName: (_a = row.business_name) !== null && _a !== void 0 ? _a : '',
                address: (_b = row.address) !== null && _b !== void 0 ? _b : '',
                city: (_c = row.city) !== null && _c !== void 0 ? _c : '',
                cuit: (_d = row.cuit) !== null && _d !== void 0 ? _d : '',
                email: (_e = row.email) !== null && _e !== void 0 ? _e : '',
                phone: (_f = row.phone) !== null && _f !== void 0 ? _f : '',
                logoUrl: (_g = row.logo_url) !== null && _g !== void 0 ? _g : '',
                caiRemito: (_h = row.cai_remito) !== null && _h !== void 0 ? _h : '',
                caiRemitoVencimiento: row.cai_remito_vencimiento ? row.cai_remito_vencimiento.toISOString().slice(0, 10) : ''
            });
        }
        const envData = (0, afip_service_1.getAfipIssuerData)();
        if (envData) {
            return res.json({
                businessName: envData.businessName || '',
                address: envData.address || '',
                city: envData.city || '',
                cuit: envData.cuit || '',
                email: '',
                phone: '',
                logoUrl: '',
                caiRemito: '',
                caiRemitoVencimiento: ''
            });
        }
        return res.json({
            businessName: '',
            address: '',
            city: '',
            cuit: '',
            email: '',
            phone: '',
            logoUrl: '',
            caiRemito: '',
            caiRemitoVencimiento: ''
        });
    }
    catch (err) {
        console.error('getRemitente error:', err);
        return res.status(500).json({ message: 'Error obteniendo remitente' });
    }
});
exports.getRemitente = getRemitente;
const saveRemitente = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { businessName, address, city, cuit, email, phone, logoUrl, caiRemito, caiRemitoVencimiento } = req.body;
        const existing = yield (0, db_1.get)(`SELECT id FROM remitente_config ORDER BY id DESC LIMIT 1`);
        if (existing) {
            yield (0, db_1.execute)(`UPDATE remitente_config SET business_name=?, address=?, city=?, cuit=?, email=?, phone=?, logo_url=?, cai_remito=?, cai_remito_vencimiento=? WHERE id = ?`, [businessName !== null && businessName !== void 0 ? businessName : null, address !== null && address !== void 0 ? address : null, city !== null && city !== void 0 ? city : null, cuit !== null && cuit !== void 0 ? cuit : null, email !== null && email !== void 0 ? email : null, phone !== null && phone !== void 0 ? phone : null, logoUrl !== null && logoUrl !== void 0 ? logoUrl : null, caiRemito !== null && caiRemito !== void 0 ? caiRemito : null, caiRemitoVencimiento !== null && caiRemitoVencimiento !== void 0 ? caiRemitoVencimiento : null, existing.id]);
        }
        else {
            yield (0, db_1.execute)(`INSERT INTO remitente_config (business_name, address, city, cuit, email, phone, logo_url, cai_remito, cai_remito_vencimiento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [businessName !== null && businessName !== void 0 ? businessName : null, address !== null && address !== void 0 ? address : null, city !== null && city !== void 0 ? city : null, cuit !== null && cuit !== void 0 ? cuit : null, email !== null && email !== void 0 ? email : null, phone !== null && phone !== void 0 ? phone : null, logoUrl !== null && logoUrl !== void 0 ? logoUrl : null, caiRemito !== null && caiRemito !== void 0 ? caiRemito : null, caiRemitoVencimiento !== null && caiRemitoVencimiento !== void 0 ? caiRemitoVencimiento : null]);
        }
        return res.json({ success: true });
    }
    catch (err) {
        console.error('saveRemitente error:', err);
        return res.status(500).json({ message: 'Error guardando remitente' });
    }
});
exports.saveRemitente = saveRemitente;
