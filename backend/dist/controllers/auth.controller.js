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
exports.login = void 0;
const db_1 = require("../database/db");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
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
        const secret = process.env.JWT_SECRET || 'devsecret';
        const token = jsonwebtoken_1.default.sign({ id: safeUser.id, email: safeUser.email, role: safeUser.role }, secret, { expiresIn: '2h' });
        return res.json({ user: safeUser, token });
    }
    catch (error) {
        return res.status(500).json({ message: 'Error al autenticar' });
    }
});
exports.login = login;
