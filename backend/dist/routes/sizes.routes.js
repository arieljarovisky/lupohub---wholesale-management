"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const sizes_controller_1 = require("../controllers/sizes.controller");
const router = (0, express_1.Router)();
router.get('/', sizes_controller_1.getSizes);
exports.default = router;
