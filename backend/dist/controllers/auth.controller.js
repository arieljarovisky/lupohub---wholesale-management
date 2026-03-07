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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshToken = exports.login = void 0;
const db_1 = require("../database/db");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = () => process.env.JWT_SECRET || 'devsecret';
/** Duración del token: 30 días (no expira cada 2h). */
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';
/** Ventana para refrescar: si el token expiró hace menos de 7 días, se puede renovar. */
const REFRESH_GRACE_DAYS = 7;
const login = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email y contraseña son requeridos' });
    }
    try {
        const user = yield (0, db_1.get)('SELECT id, name, email, role, commission_percentage AS commissionPercentage, password FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(401).json({ message: 'Usuario no encontrado' });
        }
        if (String(user.password) !== String(password)) {
            return res.status(401).json({ message: 'Contraseña incorrecta' });
        }
        const { password: _pwd } = user, safeUser = __rest(user, ["password"]);
        const secret = JWT_SECRET();
        const token = jsonwebtoken_1.default.sign({ id: safeUser.id, email: safeUser.email, role: safeUser.role }, secret, { expiresIn: JWT_EXPIRES_IN });
        return res.json({ user: safeUser, token });
    }
    catch (error) {
        return res.status(500).json({ message: 'Error al autenticar' });
    }
});
exports.login = login;
/** Refresca el token: acepta el token actual (incluso recién expirado) y devuelve uno nuevo. */
const refreshToken = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) {
        return res.status(401).json({ message: 'Token no enviado' });
    }
    try {
        const secret = JWT_SECRET();
        const decoded = jsonwebtoken_1.default.verify(token, secret, { ignoreExpiration: true });
        if (!(decoded === null || decoded === void 0 ? void 0 : decoded.id) || !(decoded === null || decoded === void 0 ? void 0 : decoded.email)) {
            return res.status(401).json({ message: 'Token inválido' });
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const exp = (_a = decoded.exp) !== null && _a !== void 0 ? _a : 0;
        if (exp < nowSec - REFRESH_GRACE_DAYS * 24 * 3600) {
            return res.status(401).json({ message: 'Token vencido hace demasiado tiempo; volvé a iniciar sesión' });
        }
        const user = yield (0, db_1.get)('SELECT id, name, email, role, commission_percentage AS commissionPercentage FROM users WHERE id = ?', [decoded.id]);
        if (!user) {
            return res.status(401).json({ message: 'Usuario no encontrado' });
        }
        const newToken = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, role: user.role }, secret, { expiresIn: JWT_EXPIRES_IN });
        return res.json({ token: newToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, commissionPercentage: user.commissionPercentage } });
    }
    catch (_b) {
        return res.status(401).json({ message: 'Token inválido' });
    }
});
exports.refreshToken = refreshToken;
