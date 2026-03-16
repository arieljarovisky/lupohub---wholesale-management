"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const afip_service_1 = require("../services/afip.service");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.optionalAuthMiddleware);
/** Indica si AFIP está configurado en el servidor (CUIT + access token). */
router.get('/status', (_req, res) => {
    res.json({ configured: (0, afip_service_1.isAfipConfigured)() });
});
exports.default = router;
