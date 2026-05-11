"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const billing_controller_1 = require("../controllers/billing.controller");
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
router.get('/export', billing_controller_1.exportBilling);
router.get('/export-retper', billing_controller_1.exportRetPerTxt);
router.post('/export-by-customers-file', uploadAgipPadronFile, billing_controller_1.exportBillingByCustomersFile);
router.post('/agip-padron/import/start', billing_controller_1.importAgipPadronStart);
router.post('/agip-padron/import/chunk', billing_controller_1.importAgipPadronChunk);
router.post('/agip-padron/import', uploadAgipPadronFile, billing_controller_1.importAgipPadron);
exports.default = router;
