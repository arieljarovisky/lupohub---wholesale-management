"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminOrDepositoMiddleware = exports.optionalAuthMiddleware = exports.authMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const authMiddleware = (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token)
        return res.status(401).json({ message: 'No autorizado' });
    try {
        const secret = process.env.JWT_SECRET || 'devsecret';
        const decoded = jsonwebtoken_1.default.verify(token, secret);
        req.user = decoded;
        next();
    }
    catch (_a) {
        return res.status(401).json({ message: 'Token inválido' });
    }
};
exports.authMiddleware = authMiddleware;
/** No devuelve 401 si no hay token; solo setea req.user cuando el token es válido. */
const optionalAuthMiddleware = (req, _res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token)
        return next();
    try {
        const secret = process.env.JWT_SECRET || 'devsecret';
        const decoded = jsonwebtoken_1.default.verify(token, secret);
        req.user = decoded;
    }
    catch (_a) {
        /* token inválido */
    }
    next();
};
exports.optionalAuthMiddleware = optionalAuthMiddleware;
/** Solo permite usuarios con rol ADMIN o DEPOSITO (en BD el rol se guarda como WAREHOUSE). Requiere authMiddleware antes. */
const adminOrDepositoMiddleware = (req, res, next) => {
    var _a;
    const role = (_a = req.user) === null || _a === void 0 ? void 0 : _a.role;
    if (role === 'ADMIN' || role === 'DEPOSITO' || role === 'WAREHOUSE')
        return next();
    return res.status(403).json({ message: 'Solo para usuarios con rol ADMIN o DEPOSITO' });
};
exports.adminOrDepositoMiddleware = adminOrDepositoMiddleware;
