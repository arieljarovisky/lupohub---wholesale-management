"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const auth_1 = require("../middleware/auth");
const payments_controller_1 = require("../controllers/payments.controller");
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
router.get('/', payments_controller_1.listPayments);
router.post('/', payments_controller_1.createPayment);
router.patch('/imported/date', payments_controller_1.updateImportedPaymentDate);
router.patch('/:id/date', payments_controller_1.updatePaymentDate);
router.post('/import-excel', upload.array('files', 10), payments_controller_1.importPaymentsFromExcel);
exports.default = router;
