"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const billing_controller_1 = require("../controllers/billing.controller");
const manualComprobantes_controller_1 = require("../controllers/manualComprobantes.controller");
const auth_1 = require("../middleware/auth");
const multer_1 = __importDefault(require("multer"));
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });
const uploadAgipPadronFile = (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (!err)
            return next();
        if ((err === null || err === void 0 ? void 0 : err.code) === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ message: 'El archivo supera el tamaño máximo permitido (80MB).' });
        }
        return res.status(400).json({ message: (err === null || err === void 0 ? void 0 : err.message) || 'Error subiendo archivo de padrón AGIP.' });
    });
};
router.use(auth_1.authMiddleware, auth_1.billingAccessMiddleware);
router.get('/', billing_controller_1.listBilling);
router.post('/manual-comprobantes', manualComprobantes_controller_1.createManualComprobante);
router.post('/manual-comprobantes/upload', manualComprobantes_controller_1.uploadManualComprobantePdfHandler, manualComprobantes_controller_1.createManualComprobanteMultipart);
router.get('/manual-comprobantes/:id/pdf', manualComprobantes_controller_1.getManualComprobantePdf);
router.get('/manual-comprobantes/:id', manualComprobantes_controller_1.getManualComprobante);
router.patch('/manual-comprobantes/:id', manualComprobantes_controller_1.updateManualComprobante);
router.patch('/manual-comprobantes/:id/upload', manualComprobantes_controller_1.uploadManualComprobantePdfHandler, manualComprobantes_controller_1.updateManualComprobanteMultipart);
router.delete('/manual-comprobantes/:id', manualComprobantes_controller_1.deleteManualComprobante);
router.delete('/imported-entries', billing_controller_1.deleteImportedBillingEntry);
router.delete('/local-afip/:id', billing_controller_1.deleteLocalAfipComprobante);
router.get('/export', billing_controller_1.exportBilling);
router.get('/print', billing_controller_1.printBilling);
router.get('/export-retper', billing_controller_1.exportRetPerTxt);
router.get('/export-ventas-jurisdiccion', billing_controller_1.exportVentasJurisdiccionXlsx);
router.post('/export-by-customers-file', uploadAgipPadronFile, billing_controller_1.exportBillingByCustomersFile);
router.post('/agip-padron/import/start', billing_controller_1.importAgipPadronStart);
router.post('/agip-padron/import/chunk', billing_controller_1.importAgipPadronChunk);
router.post('/agip-padron/import', uploadAgipPadronFile, billing_controller_1.importAgipPadron);
exports.default = router;
