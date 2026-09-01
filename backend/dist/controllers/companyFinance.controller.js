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
const companyFinancePnl_service_1 = require("../services/companyFinancePnl.service");
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
    var _a, _b, _c, _d, _e, _f;
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const category = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.category) || '').trim();
        const amount = Number((_b = req.body) === null || _b === void 0 ? void 0 : _b.amount);
        const description = String(((_c = req.body) === null || _c === void 0 ? void 0 : _c.description) || '').trim() || null;
        const active = ((_d = req.body) === null || _d === void 0 ? void 0 : _d.active) !== false;
        const startsFrom = ((_e = req.body) === null || _e === void 0 ? void 0 : _e.startsFrom) ? String(req.body.startsFrom).slice(0, 10) : null;
        const endsAt = ((_f = req.body) === null || _f === void 0 ? void 0 : _f.endsAt) ? String(req.body.endsAt).slice(0, 10) : null;
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
    var _a, _b, _c, _d, _e, _f;
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const id = String(req.params.id || '').trim();
        const existing = yield (0, db_1.get)(`SELECT id FROM company_finance_fixed_expenses WHERE id = ?`, [id]);
        if (!existing)
            return res.status(404).json({ message: 'Gasto fijo no encontrado' });
        const fields = [];
        const params = [];
        if (((_a = req.body) === null || _a === void 0 ? void 0 : _a.category) != null) {
            const category = String(req.body.category).trim();
            if (!exports.EXPENSE_CATEGORIES.some((c) => c.id === category)) {
                return res.status(400).json({ message: 'Categoría inválida' });
            }
            fields.push('category = ?');
            params.push(category);
        }
        if (((_b = req.body) === null || _b === void 0 ? void 0 : _b.amount) != null) {
            const amount = Number(req.body.amount);
            if (!Number.isFinite(amount) || amount <= 0) {
                return res.status(400).json({ message: 'Importe inválido' });
            }
            fields.push('amount = ?');
            params.push((0, companyFinanceFixed_1.round2)(amount));
        }
        if (((_c = req.body) === null || _c === void 0 ? void 0 : _c.description) !== undefined) {
            fields.push('description = ?');
            params.push(String(req.body.description || '').trim() || null);
        }
        if (((_d = req.body) === null || _d === void 0 ? void 0 : _d.active) !== undefined) {
            fields.push('active = ?');
            params.push(req.body.active ? 1 : 0);
        }
        if (((_e = req.body) === null || _e === void 0 ? void 0 : _e.startsFrom) !== undefined) {
            const startsFrom = req.body.startsFrom ? String(req.body.startsFrom).slice(0, 10) : null;
            if (startsFrom && !/^\d{4}-\d{2}-\d{2}$/.test(startsFrom)) {
                return res.status(400).json({ message: 'startsFrom inválida' });
            }
            fields.push('starts_from = ?');
            params.push(startsFrom);
        }
        if (((_f = req.body) === null || _f === void 0 ? void 0 : _f.endsAt) !== undefined) {
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
    var _a, _b, _c, _d;
    try {
        if (!assertFinanceAccess(req, res))
            return;
        const { from, to } = parseDateRange(req);
        const includeChannels = req.query.includeChannels !== '0' && req.query.includeChannels !== 'false';
        const includeOrders = req.query.includeOrders === '1' || req.query.includeOrders === 'true';
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
        const [fobInfo, mlIndex, tnIndex] = yield Promise.all([
            (0, companyFinancePnl_service_1.loadCompanyFobList)(),
            includeChannels ? (0, companyFinancePnl_service_1.loadMlItemProductIndex)() : Promise.resolve(undefined),
            includeChannels ? (0, companyFinancePnl_service_1.loadTnVariantProductIndex)() : Promise.resolve(undefined),
        ]);
        const [receipts, despachos, pendingInvoices, fixedAgg, channelAgg, invoiced, wholesale, commissions, inventory, wholesaleOrdersBreakdown] = yield Promise.all([
            (0, companyFinanceAggregates_service_1.sumReceiptsInRange)(from, to),
            (0, companyFinanceAggregates_service_1.sumDespachosCostInRange)(from, to),
            (0, companyFinanceAggregates_service_1.listPendingInvoices)(200),
            computeFixedExpensesForPeriod(from, to),
            includeChannels
                ? Promise.all([
                    (0, companyFinanceAggregates_service_1.aggregateMercadoLibreInRange)(from, to, fobInfo, mlIndex),
                    (0, companyFinanceAggregates_service_1.aggregateTiendaNubeInRange)(from, to, fobInfo, tnIndex),
                ])
                : Promise.resolve([
                    {
                        sales: 0,
                        fees: 0,
                        orderCount: 0,
                        connected: false,
                        note: undefined,
                        cogs: 0,
                        units: 0,
                        unitsWithFob: 0,
                    },
                    {
                        sales: 0,
                        fees: 0,
                        orderCount: 0,
                        connected: false,
                        note: undefined,
                        cogs: 0,
                        units: 0,
                        unitsWithFob: 0,
                    },
                ]),
            (0, companyFinanceAggregates_service_1.sumInvoicedInRange)(from, to),
            (0, companyFinancePnl_service_1.sumWholesaleSalesAndCogs)(from, to, fobInfo),
            (0, companyFinancePnl_service_1.sumSellerCommissionsInRange)(from, to),
            (0, companyFinancePnl_service_1.sumInventoryAtFob)(fobInfo),
            (0, companyFinanceAggregates_service_1.sumWholesaleOrdersInvoiceBreakdown)(from, to),
        ]);
        const periodWholesaleOrders = includeOrders
            ? yield (0, companyFinanceAggregates_service_1.listWholesaleOrdersInPeriod)(from, to, 500)
            : undefined;
        const [mlAgg, tnAgg] = channelAgg;
        const manualIncome = (0, companyFinanceFixed_1.round2)(Number((_a = totals === null || totals === void 0 ? void 0 : totals.manualIncome) !== null && _a !== void 0 ? _a : 0));
        const manualExpenses = (0, companyFinanceFixed_1.round2)(Number((_b = totals === null || totals === void 0 ? void 0 : totals.totalExpenses) !== null && _b !== void 0 ? _b : 0));
        const wholesaleEco = wholesale.economics;
        const mlEco = (0, companyFinancePnl_service_1.finishChannelEconomics)({
            revenue: mlAgg.sales,
            cogs: mlAgg.cogs,
            fees: mlAgg.fees,
            units: mlAgg.units,
            unitsWithFob: mlAgg.unitsWithFob,
            orderCount: mlAgg.orderCount,
        });
        const tnEco = (0, companyFinancePnl_service_1.finishChannelEconomics)({
            revenue: tnAgg.sales,
            cogs: tnAgg.cogs,
            fees: tnAgg.fees,
            units: tnAgg.units,
            unitsWithFob: tnAgg.unitsWithFob,
            orderCount: tnAgg.orderCount,
        });
        const retailEco = (0, companyFinancePnl_service_1.finishChannelEconomics)({
            revenue: mlEco.revenue + tnEco.revenue,
            cogs: mlEco.cogs + tnEco.cogs,
            fees: mlEco.fees + tnEco.fees,
            units: mlEco.units + tnEco.units,
            unitsWithFob: mlEco.unitsWithFob + tnEco.unitsWithFob,
            orderCount: mlEco.orderCount + tnEco.orderCount,
        });
        const receiptsTotal = receipts.total;
        const mlSales = mlAgg.sales;
        const tnSales = tnAgg.sales;
        const channelFees = (0, companyFinanceFixed_1.round2)(mlAgg.fees + tnAgg.fees);
        const despachosCost = despachos.total;
        const sellerCommissions = commissions.total;
        const ordersRevenue = wholesaleEco.revenue;
        const fixedMonthlyExpenses = fixedAgg.fixedMonthlyExpenses;
        const totalSales = (0, companyFinanceFixed_1.round2)(wholesaleEco.revenue + mlSales + tnSales + manualIncome);
        const totalCogs = (0, companyFinanceFixed_1.round2)(wholesaleEco.cogs + mlEco.cogs + tnEco.cogs);
        const grossProfit = (0, companyFinanceFixed_1.round2)(totalSales - totalCogs);
        const commercialCosts = (0, companyFinanceFixed_1.round2)(channelFees + sellerCommissions);
        const contributionMargin = (0, companyFinanceFixed_1.round2)(grossProfit - commercialCosts);
        const operatingExpenses = (0, companyFinanceFixed_1.round2)(manualExpenses + fixedMonthlyExpenses);
        const netResult = (0, companyFinanceFixed_1.round2)(contributionMargin - operatingExpenses);
        const totalIncome = totalSales;
        const totalExpenses = (0, companyFinanceFixed_1.round2)(totalCogs + commercialCosts + operatingExpenses);
        const opexByCategory = new Map();
        for (const item of fixedAgg.fixedExpenseItems) {
            opexByCategory.set(item.category, (0, companyFinanceFixed_1.round2)((opexByCategory.get(item.category) || 0) + item.periodTotal));
        }
        for (const row of byCategory) {
            if (row.entryType !== 'expense')
                continue;
            opexByCategory.set(row.category, (0, companyFinanceFixed_1.round2)((opexByCategory.get(row.category) || 0) + Number(row.total)));
        }
        const categoryLabels = {};
        for (const c of [...exports.EXPENSE_CATEGORIES, ...exports.INCOME_CATEGORIES]) {
            categoryLabels[c.id] = c.label;
        }
        res.json(Object.assign(Object.assign({ from,
            to, methodology: {
                wholesale: 'Pedidos mayoristas confirmados o posteriores, neto de notas de crédito. Sin IVA.',
                retail: 'Órdenes pagadas de Mercado Libre y Tienda Nube (importe de la API, IVA incluido).',
                cogs: `Costo de mercadería vendida según lista FOB${fobInfo.name ? ` «${fobInfo.name}»` : ''}. Los despachos del período son compras de stock, no gasto del resultado.`,
                commissions: 'Comisiones de vendedores sobre recibos cobrados (neto de IVA). Comisiones ML/TN estimadas.',
            }, fobListId: fobInfo.id, fobListName: fobInfo.name || null, manualIncome,
            ordersRevenue, wholesaleRevenueNet: wholesale.revenueNet, wholesaleRevenueWithIva: wholesale.revenueWithIva, wholesaleCreditNotes: wholesale.creditNotes, receiptsTotal, receiptsCount: receipts.count, mlSales, mlFees: mlAgg.fees, mlCogs: mlEco.cogs, mlUnits: mlEco.units, mlUnitsWithFob: mlEco.unitsWithFob, mlOrderCount: mlAgg.orderCount, mlConnected: mlAgg.connected, mlNote: mlAgg.note, tnSales, tnFees: tnAgg.fees, tnCogs: tnEco.cogs, tnUnits: tnEco.units, tnUnitsWithFob: tnEco.unitsWithFob, tnOrderCount: tnAgg.orderCount, tnConnected: tnAgg.connected, tnNote: tnAgg.note, channelFees,
            sellerCommissions, sellerCommissionReceipts: commissions.receiptCount, despachosCost, despachosCount: despachos.count, manualExpenses,
            fixedMonthlyExpenses, fixedMonthlySubtotal: fixedAgg.fixedMonthlySubtotal, monthsInPeriod: fixedAgg.monthsInPeriod, fixedExpenseItems: fixedAgg.fixedExpenseItems.map((item) => (Object.assign(Object.assign({}, item), { categoryLabel: categoryLabels[item.category] || item.category }))), totalSales,
            totalCogs,
            grossProfit, grossMarginPct: totalSales > 0 ? (0, companyFinanceFixed_1.round2)((grossProfit / totalSales) * 100) : null, commercialCosts,
            contributionMargin, contributionMarginPct: totalSales > 0 ? (0, companyFinanceFixed_1.round2)((contributionMargin / totalSales) * 100) : null, operatingExpenses,
            totalIncome,
            totalExpenses,
            netResult, netMarginPct: totalSales > 0 ? (0, companyFinanceFixed_1.round2)((netResult / totalSales) * 100) : null, profitOrLoss: netResult >= 0 ? 'profit' : 'loss', expenseCount: Number((_c = totals === null || totals === void 0 ? void 0 : totals.expenseCount) !== null && _c !== void 0 ? _c : 0), incomeCount: Number((_d = totals === null || totals === void 0 ? void 0 : totals.incomeCount) !== null && _d !== void 0 ? _d : 0), channels: {
                wholesale: wholesaleEco,
                mercadoLibre: mlEco,
                tiendaNube: tnEco,
                retail: retailEco,
                otherIncome: (0, companyFinancePnl_service_1.finishChannelEconomics)({ revenue: manualIncome, cogs: 0 }),
                consolidated: (0, companyFinancePnl_service_1.finishChannelEconomics)({
                    revenue: totalSales,
                    cogs: totalCogs,
                    fees: commercialCosts,
                    units: wholesaleEco.units + retailEco.units,
                    unitsWithFob: wholesaleEco.unitsWithFob + retailEco.unitsWithFob,
                    orderCount: wholesaleEco.orderCount + retailEco.orderCount,
                }),
            }, opexByCategory: [...opexByCategory.entries()]
                .map(([category, total]) => ({
                category,
                categoryLabel: categoryLabels[category] || category,
                total,
            }))
                .sort((a, b) => b.total - a.total), inventory: Object.assign(Object.assign({}, inventory), { coveragePct: (0, companyFinancePnl_service_1.coveragePct)(inventory.unitsWithFob, inventory.units), fobListName: fobInfo.name || null }), cogsCoverage: {
                wholesalePct: (0, companyFinancePnl_service_1.coveragePct)(wholesaleEco.unitsWithFob, wholesaleEco.units),
                mlPct: (0, companyFinancePnl_service_1.coveragePct)(mlEco.unitsWithFob, mlEco.units),
                tnPct: (0, companyFinancePnl_service_1.coveragePct)(tnEco.unitsWithFob, tnEco.units),
            }, invoicedTotal: invoiced.total, invoicedNet: invoiced.net, invoicedIva: invoiced.iva, invoicedCount: invoiced.count, invoicedWholesaleTotal: invoiced.wholesale.total, invoicedWholesaleNet: invoiced.wholesale.net, invoicedWholesaleCount: invoiced.wholesale.count, invoicedMlTotal: invoiced.mercadoLibre.total, invoicedMlNet: invoiced.mercadoLibre.net, invoicedMlCount: invoiced.mercadoLibre.count, invoicedTnTotal: invoiced.tiendaNube.total, invoicedTnNet: invoiced.tiendaNube.net, invoicedTnCount: invoiced.tiendaNube.count, pendingInvoicesTotal: pendingInvoices.totalPending, pendingInvoicesCount: pendingInvoices.items.length, pendingInvoices: pendingInvoices.items, wholesaleOrdersInvoicedCount: wholesaleOrdersBreakdown.invoicedCount, wholesaleOrdersInvoicedNet: wholesaleOrdersBreakdown.invoicedNet, wholesaleOrdersUninvoicedCount: wholesaleOrdersBreakdown.uninvoicedCount, wholesaleOrdersUninvoicedNet: wholesaleOrdersBreakdown.uninvoicedNet, wholesaleOrdersTotalCount: wholesaleOrdersBreakdown.totalCount, wholesaleOrdersTotalNet: wholesaleOrdersBreakdown.totalNet }, (periodWholesaleOrders ? { periodWholesaleOrders } : {})), { byCategory: (byCategory || []).map((r) => (Object.assign(Object.assign({}, r), { total: (0, companyFinanceFixed_1.round2)(Number(r.total)), categoryLabel: categoryLabels[r.category] || r.category }))), byMonth: (byMonth || []).map((r) => (Object.assign(Object.assign({}, r), { total: (0, companyFinanceFixed_1.round2)(Number(r.total)) }))) }));
    }
    catch (error) {
        console.error('getCompanyFinanceSummary:', error);
        res.status(500).json({ message: 'Error calculando resumen' });
    }
});
exports.getCompanyFinanceSummary = getCompanyFinanceSummary;
