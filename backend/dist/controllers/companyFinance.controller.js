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
exports.getCompanyFinanceSummary = exports.deleteCompanyFinanceEntry = exports.updateCompanyFinanceEntry = exports.createCompanyFinanceEntry = exports.listCompanyFinanceEntries = exports.getCompanyFinanceAccess = exports.INCOME_CATEGORIES = exports.EXPENSE_CATEGORIES = void 0;
const uuid_1 = require("uuid");
const db_1 = require("../database/db");
const companyFinanceAccess_1 = require("../utils/companyFinanceAccess");
exports.EXPENSE_CATEGORIES = [
    { id: 'sueldo', label: 'Sueldos' },
    { id: 'servicios', label: 'Servicios' },
    { id: 'alquiler', label: 'Alquileres' },
    { id: 'impuestos', label: 'Impuestos' },
    { id: 'marketing', label: 'Marketing / publicidad' },
    { id: 'logistica', label: 'Logística' },
    { id: 'honorarios', label: 'Honorarios profesionales' },
    { id: 'otros_gasto', label: 'Otros gastos' },
];
exports.INCOME_CATEGORIES = [
    { id: 'ingreso_manual', label: 'Ingreso manual' },
    { id: 'otros_ingreso', label: 'Otros ingresos' },
];
const ALL_CATEGORIES = new Set([
    ...exports.EXPENSE_CATEGORIES.map((c) => c.id),
    ...exports.INCOME_CATEGORIES.map((c) => c.id),
]);
function assertFinanceAccess(req, res) {
    var _a;
    if (!(0, companyFinanceAccess_1.isCompanyFinanceUser)((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.email)) {
        res.status(403).json({ message: 'Sin permiso para resultados de la empresa' });
        return false;
    }
    return true;
}
function parseDateRange(req) {
    const now = new Date();
    const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const from = String(req.query.from || defaultFrom).slice(0, 10);
    const to = String(req.query.to || defaultTo).slice(0, 10);
    return { from, to };
}
const getCompanyFinanceAccess = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const email = (0, companyFinanceAccess_1.normalizeFinanceEmail)((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.email);
    res.json({
        allowed: (0, companyFinanceAccess_1.isCompanyFinanceUser)(email),
        email: email || null,
        expenseCategories: exports.EXPENSE_CATEGORIES,
        incomeCategories: exports.INCOME_CATEGORIES,
    });
});
exports.getCompanyFinanceAccess = getCompanyFinanceAccess;
const listCompanyFinanceEntries = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const { from, to } = parseDateRange(req);
        const entryType = String(req.query.type || '').trim();
        const conditions = ['entry_date >= ?', 'entry_date <= ?'];
        const params = [from, to];
        if (entryType === 'expense' || entryType === 'income') {
            conditions.push('entry_type = ?');
            params.push(entryType);
        }
        const rows = yield (0, db_1.query)(`SELECT id, entry_type AS entryType, category, amount, description,
              DATE_FORMAT(entry_date, '%Y-%m-%d') AS entryDate,
              created_by_email AS createdByEmail, created_at AS createdAt
       FROM company_finance_entries
       WHERE ${conditions.join(' AND ')}
       ORDER BY entry_date DESC, created_at DESC`, params);
        res.json({ from, to, entries: rows });
    }
    catch (error) {
        console.error('listCompanyFinanceEntries:', error);
        res.status(500).json({ message: 'Error listando movimientos' });
    }
});
exports.listCompanyFinanceEntries = listCompanyFinanceEntries;
const createCompanyFinanceEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const entryType = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.entryType) || '').trim();
        const category = String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.category) || '').trim();
        const amount = Number((_c = req.body) === null || _c === void 0 ? void 0 : _c.amount);
        const description = String(((_d = req.body) === null || _d === void 0 ? void 0 : _d.description) || '').trim() || null;
        const entryDate = String(((_e = req.body) === null || _e === void 0 ? void 0 : _e.entryDate) || '').slice(0, 10);
        if (entryType !== 'expense' && entryType !== 'income') {
            return res.status(400).json({ message: 'entryType debe ser expense o income' });
        }
        if (!ALL_CATEGORIES.has(category)) {
            return res.status(400).json({ message: 'Categoría inválida' });
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: 'El importe debe ser mayor a 0' });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
            return res.status(400).json({ message: 'entryDate inválida (YYYY-MM-DD)' });
        }
        const id = (0, uuid_1.v4)();
        const user = req.user || {};
        yield (0, db_1.execute)(`INSERT INTO company_finance_entries
       (id, entry_type, category, amount, description, entry_date, created_by_user_id, created_by_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
            id,
            entryType,
            category,
            Math.round(amount * 100) / 100,
            description,
            entryDate,
            user.id || null,
            (0, companyFinanceAccess_1.normalizeFinanceEmail)(user.email),
        ]);
        const created = yield (0, db_1.get)(`SELECT id, entry_type AS entryType, category, amount, description,
              DATE_FORMAT(entry_date, '%Y-%m-%d') AS entryDate,
              created_by_email AS createdByEmail, created_at AS createdAt
       FROM company_finance_entries WHERE id = ?`, [id]);
        res.status(201).json(created);
    }
    catch (error) {
        console.error('createCompanyFinanceEntry:', error);
        res.status(500).json({ message: 'Error creando movimiento' });
    }
});
exports.createCompanyFinanceEntry = createCompanyFinanceEntry;
const updateCompanyFinanceEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const id = String(req.params.id || '').trim();
        const existing = yield (0, db_1.get)(`SELECT id FROM company_finance_entries WHERE id = ?`, [id]);
        if (!existing)
            return res.status(404).json({ message: 'Movimiento no encontrado' });
        const entryType = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.entryType) || '').trim();
        const category = String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.category) || '').trim();
        const amount = Number((_c = req.body) === null || _c === void 0 ? void 0 : _c.amount);
        const description = ((_d = req.body) === null || _d === void 0 ? void 0 : _d.description) != null ? String(req.body.description).trim() || null : undefined;
        const entryDate = ((_e = req.body) === null || _e === void 0 ? void 0 : _e.entryDate) != null ? String(req.body.entryDate).slice(0, 10) : undefined;
        if (entryType && entryType !== 'expense' && entryType !== 'income') {
            return res.status(400).json({ message: 'entryType inválido' });
        }
        if (category && !ALL_CATEGORIES.has(category)) {
            return res.status(400).json({ message: 'Categoría inválida' });
        }
        if (((_f = req.body) === null || _f === void 0 ? void 0 : _f.amount) != null && (!Number.isFinite(amount) || amount <= 0)) {
            return res.status(400).json({ message: 'Importe inválido' });
        }
        if (entryDate && !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
            return res.status(400).json({ message: 'Fecha inválida' });
        }
        const fields = [];
        const params = [];
        if (entryType) {
            fields.push('entry_type = ?');
            params.push(entryType);
        }
        if (category) {
            fields.push('category = ?');
            params.push(category);
        }
        if (((_g = req.body) === null || _g === void 0 ? void 0 : _g.amount) != null) {
            fields.push('amount = ?');
            params.push(Math.round(amount * 100) / 100);
        }
        if (description !== undefined) {
            fields.push('description = ?');
            params.push(description);
        }
        if (entryDate) {
            fields.push('entry_date = ?');
            params.push(entryDate);
        }
        if (fields.length === 0)
            return res.status(400).json({ message: 'Nada para actualizar' });
        params.push(id);
        yield (0, db_1.execute)(`UPDATE company_finance_entries SET ${fields.join(', ')} WHERE id = ?`, params);
        const updated = yield (0, db_1.get)(`SELECT id, entry_type AS entryType, category, amount, description,
              DATE_FORMAT(entry_date, '%Y-%m-%d') AS entryDate,
              created_by_email AS createdByEmail, created_at AS createdAt
       FROM company_finance_entries WHERE id = ?`, [id]);
        res.json(updated);
    }
    catch (error) {
        console.error('updateCompanyFinanceEntry:', error);
        res.status(500).json({ message: 'Error actualizando movimiento' });
    }
});
exports.updateCompanyFinanceEntry = updateCompanyFinanceEntry;
const deleteCompanyFinanceEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const id = String(req.params.id || '').trim();
        const result = yield (0, db_1.execute)(`DELETE FROM company_finance_entries WHERE id = ?`, [id]);
        if ((result === null || result === void 0 ? void 0 : result.affectedRows) === 0) {
            return res.status(404).json({ message: 'Movimiento no encontrado' });
        }
        res.json({ id });
    }
    catch (error) {
        console.error('deleteCompanyFinanceEntry:', error);
        res.status(500).json({ message: 'Error eliminando movimiento' });
    }
});
exports.deleteCompanyFinanceEntry = deleteCompanyFinanceEntry;
function wholesaleOrdersRevenue(from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const row = (yield (0, db_1.get)(`SELECT COALESCE(SUM(o.total), 0) AS total
     FROM orders o
     WHERE o.date >= ? AND o.date <= ?
       AND o.status IN ('Confirmado', 'Preparación', 'Falta controlar', 'Controlado', 'Despachado')
       AND (o.archived IS NULL OR o.archived = 0)`, [from, to]));
        return Math.round(Number((_a = row === null || row === void 0 ? void 0 : row.total) !== null && _a !== void 0 ? _a : 0) * 100) / 100;
    });
}
const getCompanyFinanceSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const { from, to } = parseDateRange(req);
        const includeOrders = req.query.includeOrders !== '0';
        const totals = (yield (0, db_1.get)(`SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'income' THEN amount ELSE 0 END), 0) AS manualIncome,
         COALESCE(SUM(CASE WHEN entry_type = 'expense' THEN amount ELSE 0 END), 0) AS totalExpenses,
         COALESCE(SUM(CASE WHEN entry_type = 'expense' THEN 1 ELSE 0 END), 0) AS expenseCount,
         COALESCE(SUM(CASE WHEN entry_type = 'income' THEN 1 ELSE 0 END), 0) AS incomeCount
       FROM company_finance_entries
       WHERE entry_date >= ? AND entry_date <= ?`, [from, to]));
        const byCategory = (yield (0, db_1.query)(`SELECT entry_type AS entryType, category,
              COALESCE(SUM(amount), 0) AS total,
              COUNT(*) AS count
       FROM company_finance_entries
       WHERE entry_date >= ? AND entry_date <= ?
       GROUP BY entry_type, category
       ORDER BY total DESC`, [from, to]));
        const byMonth = (yield (0, db_1.query)(`SELECT DATE_FORMAT(entry_date, '%Y-%m') AS month,
              entry_type AS entryType,
              COALESCE(SUM(amount), 0) AS total
       FROM company_finance_entries
       WHERE entry_date >= ? AND entry_date <= ?
       GROUP BY DATE_FORMAT(entry_date, '%Y-%m'), entry_type
       ORDER BY month ASC`, [from, to]));
        const ordersRevenue = includeOrders ? yield wholesaleOrdersRevenue(from, to) : 0;
        const manualIncome = Math.round(Number((_a = totals === null || totals === void 0 ? void 0 : totals.manualIncome) !== null && _a !== void 0 ? _a : 0) * 100) / 100;
        const totalExpenses = Math.round(Number((_b = totals === null || totals === void 0 ? void 0 : totals.totalExpenses) !== null && _b !== void 0 ? _b : 0) * 100) / 100;
        const totalIncome = Math.round((manualIncome + ordersRevenue) * 100) / 100;
        const netResult = Math.round((totalIncome - totalExpenses) * 100) / 100;
        const categoryLabels = {};
        for (const c of [...exports.EXPENSE_CATEGORIES, ...exports.INCOME_CATEGORIES]) {
            categoryLabels[c.id] = c.label;
        }
        res.json({
            from,
            to,
            manualIncome,
            ordersRevenue,
            totalIncome,
            totalExpenses,
            netResult,
            profitOrLoss: netResult >= 0 ? 'profit' : 'loss',
            expenseCount: Number((_c = totals === null || totals === void 0 ? void 0 : totals.expenseCount) !== null && _c !== void 0 ? _c : 0),
            incomeCount: Number((_d = totals === null || totals === void 0 ? void 0 : totals.incomeCount) !== null && _d !== void 0 ? _d : 0),
            byCategory: (byCategory || []).map((r) => (Object.assign(Object.assign({}, r), { total: Math.round(Number(r.total) * 100) / 100, categoryLabel: categoryLabels[r.category] || r.category }))),
            byMonth: (byMonth || []).map((r) => (Object.assign(Object.assign({}, r), { total: Math.round(Number(r.total) * 100) / 100 }))),
        });
    }
    catch (error) {
        console.error('getCompanyFinanceSummary:', error);
        res.status(500).json({ message: 'Error calculando resumen' });
    }
});
exports.getCompanyFinanceSummary = getCompanyFinanceSummary;
