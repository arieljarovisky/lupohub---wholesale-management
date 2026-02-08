"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const colors_controller_1 = require("../controllers/colors.controller");
const router = (0, express_1.Router)();
router.get('/', colors_controller_1.getColors);
exports.default = router;
