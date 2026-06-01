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
exports.getCompanyFinanceSummary = exports.getCompanyFinancePendingInvoices = exports.getCompanyFinanceMercadoPagoMovements = exports.deleteCompanyFinanceFixedExpense = exports.updateCompanyFinanceFixedExpense = exports.createCompanyFinanceFixedExpense = exports.listCompanyFinanceFixedExpenses = exports.deleteCompanyFinanceEntry = exports.updateCompanyFinanceEntry = exports.createCompanyFinanceEntry = exports.listCompanyFinanceEntries = exports.getCompanyFinanceAccess = exports.INCOME_CATEGORIES = exports.EXPENSE_CATEGORIES = void 0;
const uuid_1 = require("uuid");
const db_1 = require("../database/db");
const companyFinanceAccess_1 = require("../utils/companyFinanceAccess");
const companyFinanceAggregates_service_1 = require("../services/companyFinanceAggregates.service");
const mercadopagoFinance_service_1 = require("../services/mercadopagoFinance.service");
const companyFinanceFixed_1 = require("../utils/companyFinanceFixed");
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
    var _b, _c, _d, _e, _f;
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const entryType = String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.entryType) || '').trim();
        const category = String(((_c = req.body) === null || _c === void 0 ? void 0 : _c.category) || '').trim();
        const amount = Number((_d = req.body) === null || _d === void 0 ? void 0 : _d.amount);
        const description = String(((_e = req.body) === null || _e === void 0 ? void 0 : _e.description) || '').trim() || null;
        const entryDate = String(((_f = req.body) === null || _f === void 0 ? void 0 : _f.entryDate) || '').slice(0, 10);
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
    var _g, _h, _j, _k, _l, _m, _o;
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const id = String(req.params.id || '').trim();
        const existing = yield (0, db_1.get)(`SELECT id FROM company_finance_entries WHERE id = ?`, [id]);
        if (!existing)
            return res.status(404).json({ message: 'Movimiento no encontrado' });
        const entryType = String(((_g = req.body) === null || _g === void 0 ? void 0 : _g.entryType) || '').trim();
        const category = String(((_h = req.body) === null || _h === void 0 ? void 0 : _h.category) || '').trim();
        const amount = Number((_j = req.body) === null || _j === void 0 ? void 0 : _j.amount);
        const description = ((_k = req.body) === null || _k === void 0 ? void 0 : _k.description) != null ? String(req.body.description).trim() || null : undefined;
        const entryDate = ((_l = req.body) === null || _l === void 0 ? void 0 : _l.entryDate) != null ? String(req.body.entryDate).slice(0, 10) : undefined;
        if (entryType && entryType !== 'expense' && entryType !== 'income') {
            return res.status(400).json({ message: 'entryType inválido' });
        }
        if (category && !ALL_CATEGORIES.has(category)) {
            return res.status(400).json({ message: 'Categoría inválida' });
        }
        if (((_m = req.body) === null || _m === void 0 ? void 0 : _m.amount) != null && (!Number.isFinite(amount) || amount <= 0)) {
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
        if (((_o = req.body) === null || _o === void 0 ? void 0 : _o.amount) != null) {
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
function mapFixedExpenseRow(r) {
    return {
        id: r.id,
        category: r.category,
        amount: (0, companyFinanceFixed_1.round2)(Number(r.amount)),
        description: r.description,
        active: !!r.active,
        startsFrom: r.startsFrom,
        endsAt: r.endsAt,
    };
}
function computeFixedExpensesForPeriod(from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = (yield (0, db_1.query)(`SELECT id, category, amount, description, active,
            DATE_FORMAT(starts_from, '%Y-%m-%d') AS startsFrom,
            DATE_FORMAT(ends_at, '%Y-%m-%d') AS endsAt
     FROM company_finance_fixed_expenses
     WHERE active = 1
     ORDER BY amount DESC`));
        const monthsInPeriod = (0, companyFinanceFixed_1.countCalendarMonthsInRange)(from, to);
        let total = 0;
        let monthlySubtotal = 0;
        const items = [];
        for (const r of rows) {
            const monthsApplied = (0, companyFinanceFixed_1.fixedExpenseMonthsInRange)(from, to, r.startsFrom, r.endsAt);
            if (monthsApplied <= 0)
                continue;
            const monthlyAmount = (0, companyFinanceFixed_1.round2)(Number(r.amount));
            monthlySubtotal += monthlyAmount;
            const periodTotal = (0, companyFinanceFixed_1.round2)(monthlyAmount * monthsApplied);
            total += periodTotal;
            items.push({
                id: r.id,
                category: r.category,
                description: r.description,
                monthlyAmount,
                monthsApplied,
                periodTotal,
            });
        }
        return {
            fixedMonthlyExpenses: (0, companyFinanceFixed_1.round2)(total),
            fixedMonthlySubtotal: (0, companyFinanceFixed_1.round2)(monthlySubtotal),
            monthsInPeriod,
            fixedExpenseItems: items,
        };
    });
}
const listCompanyFinanceFixedExpenses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const rows = (yield (0, db_1.query)(`SELECT id, category, amount, description, active,
              DATE_FORMAT(starts_from, '%Y-%m-%d') AS startsFrom,
              DATE_FORMAT(ends_at, '%Y-%m-%d') AS endsAt,
              created_by_email AS createdByEmail, created_at AS createdAt
       FROM company_finance_fixed_expenses
       ORDER BY active DESC, amount DESC`));
        const categoryLabels = {};
        for (const c of exports.EXPENSE_CATEGORIES)
            categoryLabels[c.id] = c.label;
        res.json({
            items: rows.map((r) => (Object.assign(Object.assign({}, mapFixedExpenseRow(r)), { categoryLabel: categoryLabels[r.category] || r.category, createdByEmail: r.createdByEmail, createdAt: r.createdAt }))),
        });
    }
    catch (error) {
        console.error('listCompanyFinanceFixedExpenses:', error);
        res.status(500).json({ message: 'Error listando gastos fijos' });
    }
});
exports.listCompanyFinanceFixedExpenses = listCompanyFinanceFixedExpenses;
const createCompanyFinanceFixedExpense = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _p, _q, _r, _s, _t, _u;
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const category = String(((_p = req.body) === null || _p === void 0 ? void 0 : _p.category) || '').trim();
        const amount = Number((_q = req.body) === null || _q === void 0 ? void 0 : _q.amount);
        const description = String(((_r = req.body) === null || _r === void 0 ? void 0 : _r.description) || '').trim() || null;
        const active = ((_s = req.body) === null || _s === void 0 ? void 0 : _s.active) !== false;
        const startsFrom = ((_t = req.body) === null || _t === void 0 ? void 0 : _t.startsFrom) ? String(req.body.startsFrom).slice(0, 10) : null;
        const endsAt = ((_u = req.body) === null || _u === void 0 ? void 0 : _u.endsAt) ? String(req.body.endsAt).slice(0, 10) : null;
        if (!exports.EXPENSE_CATEGORIES.some((c) => c.id === category)) {
            return res.status(400).json({ message: 'Categoría inválida' });
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: 'El importe mensual debe ser mayor a 0' });
        }
        if (startsFrom && !/^\d{4}-\d{2}-\d{2}$/.test(startsFrom)) {
            return res.status(400).json({ message: 'startsFrom inválida' });
        }
        if (endsAt && !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
            return res.status(400).json({ message: 'endsAt inválida' });
        }
        if (startsFrom && endsAt && startsFrom > endsAt) {
            return res.status(400).json({ message: 'La vigencia desde no puede ser posterior al hasta' });
        }
        const id = (0, uuid_1.v4)();
        const user = req.user || {};
        yield (0, db_1.execute)(`INSERT INTO company_finance_fixed_expenses
       (id, category, amount, description, active, starts_from, ends_at, created_by_user_id, created_by_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            id,
            category,
            (0, companyFinanceFixed_1.round2)(amount),
            description,
            active ? 1 : 0,
            startsFrom,
            endsAt,
            user.id || null,
            (0, companyFinanceAccess_1.normalizeFinanceEmail)(user.email),
        ]);
        const created = yield (0, db_1.get)(`SELECT id, category, amount, description, active,
              DATE_FORMAT(starts_from, '%Y-%m-%d') AS startsFrom,
              DATE_FORMAT(ends_at, '%Y-%m-%d') AS endsAt
       FROM company_finance_fixed_expenses WHERE id = ?`, [id]);
        res.status(201).json(mapFixedExpenseRow(created));
    }
    catch (error) {
        console.error('createCompanyFinanceFixedExpense:', error);
        res.status(500).json({ message: 'Error creando gasto fijo' });
    }
});
exports.createCompanyFinanceFixedExpense = createCompanyFinanceFixedExpense;
const updateCompanyFinanceFixedExpense = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _v, _w, _x, _y, _z, _0;
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const id = String(req.params.id || '').trim();
        const existing = yield (0, db_1.get)(`SELECT id FROM company_finance_fixed_expenses WHERE id = ?`, [id]);
        if (!existing)
            return res.status(404).json({ message: 'Gasto fijo no encontrado' });
        const fields = [];
        const params = [];
        if (((_v = req.body) === null || _v === void 0 ? void 0 : _v.category) != null) {
            const category = String(req.body.category).trim();
            if (!exports.EXPENSE_CATEGORIES.some((c) => c.id === category)) {
                return res.status(400).json({ message: 'Categoría inválida' });
            }
            fields.push('category = ?');
            params.push(category);
        }
        if (((_w = req.body) === null || _w === void 0 ? void 0 : _w.amount) != null) {
            const amount = Number(req.body.amount);
            if (!Number.isFinite(amount) || amount <= 0) {
                return res.status(400).json({ message: 'Importe inválido' });
            }
            fields.push('amount = ?');
            params.push((0, companyFinanceFixed_1.round2)(amount));
        }
        if (((_x = req.body) === null || _x === void 0 ? void 0 : _x.description) !== undefined) {
            fields.push('description = ?');
            params.push(String(req.body.description || '').trim() || null);
        }
        if (((_y = req.body) === null || _y === void 0 ? void 0 : _y.active) !== undefined) {
            fields.push('active = ?');
            params.push(req.body.active ? 1 : 0);
        }
        if (((_z = req.body) === null || _z === void 0 ? void 0 : _z.startsFrom) !== undefined) {
            const startsFrom = req.body.startsFrom ? String(req.body.startsFrom).slice(0, 10) : null;
            if (startsFrom && !/^\d{4}-\d{2}-\d{2}$/.test(startsFrom)) {
                return res.status(400).json({ message: 'startsFrom inválida' });
            }
            fields.push('starts_from = ?');
            params.push(startsFrom);
        }
        if (((_0 = req.body) === null || _0 === void 0 ? void 0 : _0.endsAt) !== undefined) {
            const endsAt = req.body.endsAt ? String(req.body.endsAt).slice(0, 10) : null;
            if (endsAt && !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
                return res.status(400).json({ message: 'endsAt inválida' });
            }
            fields.push('ends_at = ?');
            params.push(endsAt);
        }
        if (fields.length === 0)
            return res.status(400).json({ message: 'Nada para actualizar' });
        params.push(id);
        yield (0, db_1.execute)(`UPDATE company_finance_fixed_expenses SET ${fields.join(', ')} WHERE id = ?`, params);
        const updated = yield (0, db_1.get)(`SELECT id, category, amount, description, active,
              DATE_FORMAT(starts_from, '%Y-%m-%d') AS startsFrom,
              DATE_FORMAT(ends_at, '%Y-%m-%d') AS endsAt
       FROM company_finance_fixed_expenses WHERE id = ?`, [id]);
        res.json(mapFixedExpenseRow(updated));
    }
    catch (error) {
        console.error('updateCompanyFinanceFixedExpense:', error);
        res.status(500).json({ message: 'Error actualizando gasto fijo' });
    }
});
exports.updateCompanyFinanceFixedExpense = updateCompanyFinanceFixedExpense;
const deleteCompanyFinanceFixedExpense = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const id = String(req.params.id || '').trim();
        const result = yield (0, db_1.execute)(`DELETE FROM company_finance_fixed_expenses WHERE id = ?`, [id]);
        if ((result === null || result === void 0 ? void 0 : result.affectedRows) === 0) {
            return res.status(404).json({ message: 'Gasto fijo no encontrado' });
        }
        res.json({ id });
    }
    catch (error) {
        console.error('deleteCompanyFinanceFixedExpense:', error);
        res.status(500).json({ message: 'Error eliminando gasto fijo' });
    }
});
exports.deleteCompanyFinanceFixedExpense = deleteCompanyFinanceFixedExpense;
function wholesaleOrdersRevenue(from, to) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const row = (yield (0, db_1.get)(`SELECT COALESCE(SUM(o.total), 0) AS total
     FROM orders o
     WHERE o.date >= ? AND o.date <= ?
       AND o.status IN ('Confirmado', 'Preparando', 'Falta controlar', 'Controlado', 'Despachado')
       AND (o.archived IS NULL OR o.archived = 0)`, [from, to]));
        return Math.round(Number((_a = row === null || row === void 0 ? void 0 : row.total) !== null && _a !== void 0 ? _a : 0) * 100) / 100;
    });
}
const getCompanyFinanceMercadoPagoMovements = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const { from, to } = parseDateRange(req);
        const data = yield (0, mercadopagoFinance_service_1.fetchMercadoPagoMovements)(from, to);
        res.json(Object.assign({ from, to }, data));
    }
    catch (error) {
        console.error('getCompanyFinanceMercadoPagoMovements:', error);
        res.status(500).json({ message: 'Error obteniendo movimientos de Mercado Pago' });
    }
});
exports.getCompanyFinanceMercadoPagoMovements = getCompanyFinanceMercadoPagoMovements;
const getCompanyFinancePendingInvoices = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '200'), 10) || 200));
        const data = yield (0, companyFinanceAggregates_service_1.listPendingInvoices)(limit);
        res.json(data);
    }
    catch (error) {
        console.error('getCompanyFinancePendingInvoices:', error);
        res.status(500).json({ message: 'Error listando facturas pendientes' });
    }
});
exports.getCompanyFinancePendingInvoices = getCompanyFinancePendingInvoices;
const getCompanyFinanceSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _1, _2, _3, _4;
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const { from, to } = parseDateRange(req);
        const includeOrders = req.query.includeOrders === '1' || req.query.includeOrders === 'true';
        const includeChannels = req.query.includeChannels !== '0' && req.query.includeChannels !== 'false';
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
        const [receipts, despachos, pendingInvoices, fixedAgg, channelAgg, invoiced] = yield Promise.all([
            (0, companyFinanceAggregates_service_1.sumReceiptsInRange)(from, to),
            (0, companyFinanceAggregates_service_1.sumDespachosCostInRange)(from, to),
            (0, companyFinanceAggregates_service_1.listPendingInvoices)(200),
            computeFixedExpensesForPeriod(from, to),
            includeChannels
                ? Promise.all([
                    (0, companyFinanceAggregates_service_1.aggregateMercadoLibreInRange)(from, to),
                    (0, companyFinanceAggregates_service_1.aggregateTiendaNubeInRange)(from, to),
                ])
                : Promise.resolve([
                    { sales: 0, fees: 0, orderCount: 0, connected: false, note: undefined },
                    { sales: 0, fees: 0, orderCount: 0, connected: false, note: undefined },
                ]),
            (0, companyFinanceAggregates_service_1.sumInvoicedInRange)(from, to),
        ]);
        const [mlAgg, tnAgg] = channelAgg;
        const ordersRevenue = includeOrders ? yield wholesaleOrdersRevenue(from, to) : 0;
        const manualIncome = Math.round(Number((_1 = totals === null || totals === void 0 ? void 0 : totals.manualIncome) !== null && _1 !== void 0 ? _1 : 0) * 100) / 100;
        const manualExpenses = Math.round(Number((_2 = totals === null || totals === void 0 ? void 0 : totals.totalExpenses) !== null && _2 !== void 0 ? _2 : 0) * 100) / 100;
        const receiptsTotal = receipts.total;
        const mlSales = mlAgg.sales;
        const tnSales = tnAgg.sales;
        const channelFees = Math.round((mlAgg.fees + tnAgg.fees) * 100) / 100;
        const despachosCost = despachos.total;
        const totalIncome = Math.round((receiptsTotal + mlSales + tnSales + manualIncome + ordersRevenue) * 100) / 100;
        const fixedMonthlyExpenses = fixedAgg.fixedMonthlyExpenses;
        const totalExpenses = Math.round((manualExpenses + despachosCost + channelFees + fixedMonthlyExpenses) * 100) / 100;
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
            receiptsTotal,
            receiptsCount: receipts.count,
            mlSales,
            mlFees: mlAgg.fees,
            mlOrderCount: mlAgg.orderCount,
            mlConnected: mlAgg.connected,
            mlNote: mlAgg.note,
            tnSales,
            tnFees: tnAgg.fees,
            tnOrderCount: tnAgg.orderCount,
            tnConnected: tnAgg.connected,
            tnNote: tnAgg.note,
            channelFees,
            despachosCost,
            despachosCount: despachos.count,
            manualExpenses,
            fixedMonthlyExpenses,
            fixedMonthlySubtotal: fixedAgg.fixedMonthlySubtotal,
            monthsInPeriod: fixedAgg.monthsInPeriod,
            fixedExpenseItems: fixedAgg.fixedExpenseItems.map((item) => (Object.assign(Object.assign({}, item), { categoryLabel: categoryLabels[item.category] || item.category }))),
            totalIncome,
            totalExpenses,
            netResult,
            profitOrLoss: netResult >= 0 ? 'profit' : 'loss',
            expenseCount: Number((_3 = totals === null || totals === void 0 ? void 0 : totals.expenseCount) !== null && _3 !== void 0 ? _3 : 0),
            incomeCount: Number((_4 = totals === null || totals === void 0 ? void 0 : totals.incomeCount) !== null && _4 !== void 0 ? _4 : 0),
            invoicedTotal: invoiced.total,
            invoicedNet: invoiced.net,
            invoicedIva: invoiced.iva,
            invoicedCount: invoiced.count,
            pendingInvoicesTotal: pendingInvoices.totalPending,
            pendingInvoicesCount: pendingInvoices.items.length,
            pendingInvoices: pendingInvoices.items,
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
