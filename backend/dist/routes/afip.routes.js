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
const express_1 = require("express");
const afip_service_1 = require("../services/afip.service");
const remitente_controller_1 = require("../controllers/remitente.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.optionalAuthMiddleware);
/** Indica si AFIP está configurado y si es ambiente producción (para que las facturas lleguen a AFIP real). */
router.get('/status', (_req, res) => {
    res.json({
        configured: (0, afip_service_1.isAfipConfigured)(),
        production: (0, afip_service_1.isAfipProduction)()
    });
});
/** Datos del emisor para la factura (CUIT, razón social, domicilio desde env). Usar en la vista de factura si no hay remitente en localStorage. */
router.get('/issuer', (_req, res) => {
    var _a, _b, _c;
    const data = (0, afip_service_1.getAfipIssuerData)();
    if (!data)
        return res.json({ cuit: '', businessName: '', address: '', city: '' });
    res.json({
        cuit: data.cuit,
        businessName: (_a = data.businessName) !== null && _a !== void 0 ? _a : '',
        address: (_b = data.address) !== null && _b !== void 0 ? _b : '',
        city: (_c = data.city) !== null && _c !== void 0 ? _c : ''
    });
});
router.get('/remitente', auth_1.authMiddleware, remitente_controller_1.getRemitente);
router.put('/remitente', auth_1.authMiddleware, remitente_controller_1.saveRemitente);
/** Condición IVA (y opcional razón social, domicilio) de un CUIT vía Padrón AFIP. Requiere login. */
router.get('/condicion-iva', auth_1.authMiddleware, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const cuit = (_a = req.query.cuit) === null || _a === void 0 ? void 0 : _a.trim();
    if (!cuit) {
        return res.status(400).json({ error: 'Falta el parámetro cuit.' });
    }
    if (!(0, afip_service_1.isAfipConfigured)()) {
        return res.status(400).json({ error: 'AFIP no está configurado. La condición IVA se puede cargar manualmente en el campo correspondiente.' });
    }
    try {
        const result = yield (0, afip_service_1.getCondicionIvaByCuit)(cuit);
        return res.json(result);
    }
    catch (err) {
        const message = (err === null || err === void 0 ? void 0 : err.message) || String(err) || 'Error al consultar AFIP.';
        if (!res.headersSent)
            return res.status(400).json({ error: message });
    }
}));
/** Consulta en AFIP si un comprobante existe (FECompConsultar). Confirmación 100% de que AFIP lo tiene. */
router.get('/consultar-comprobante', auth_1.authMiddleware, (req, res) => {
    const ptoVta = parseInt(req.query.puntoVta, 10);
    const cbteTipo = parseInt(req.query.cbteTipo, 10);
    const cbteNro = parseInt(req.query.cbteNro, 10);
    if (isNaN(ptoVta) || isNaN(cbteTipo) || isNaN(cbteNro)) {
        return res.status(400).json({
            error: 'Faltan o son inválidos: puntoVta, cbteTipo, cbteNro (números). Ej: ?puntoVta=20&cbteTipo=6&cbteNro=1'
        });
    }
    (0, afip_service_1.consultarComprobanteAfip)(ptoVta, cbteTipo, cbteNro)
        .then((r) => res.json(r))
        .catch((err) => {
        const message = (err === null || err === void 0 ? void 0 : err.message) || String(err) || 'Error al consultar comprobante.';
        if (!res.headersSent)
            res.status(400).json({ error: message });
    });
});
exports.default = router;
