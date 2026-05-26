import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, get, execute } from '../database/db';
import { isCompanyFinanceUser, normalizeFinanceEmail } from '../utils/companyFinanceAccess';
import {
  aggregateMercadoLibreInRange,
  aggregateTiendaNubeInRange,
  listPendingInvoices,
  sumDespachosCostInRange,
  sumInvoicedInRange,
  sumReceiptsInRange,
} from '../services/companyFinanceAggregates.service';
import { fetchMercadoPagoMovements } from '../services/mercadopagoFinance.service';
import {
  countCalendarMonthsInRange,
  fixedExpenseMonthsInRange,
  round2,
} from '../utils/companyFinanceFixed';

export const EXPENSE_CATEGORIES = [
  { id: 'sueldo', label: 'Sueldos' },
  { id: 'servicios', label: 'Servicios' },
  { id: 'alquiler', label: 'Alquileres' },
  { id: 'impuestos', label: 'Impuestos' },
  { id: 'marketing', label: 'Marketing / publicidad' },
  { id: 'logistica', label: 'Logística' },
  { id: 'honorarios', label: 'Honorarios profesionales' },
  { id: 'otros_gasto', label: 'Otros gastos' },
] as const;

export const INCOME_CATEGORIES = [
  { id: 'ingreso_manual', label: 'Ingreso manual' },
  { id: 'otros_ingreso', label: 'Otros ingresos' },
] as const;

const ALL_CATEGORIES = new Set<string>([
  ...EXPENSE_CATEGORIES.map((c) => c.id),
  ...INCOME_CATEGORIES.map((c) => c.id),
]);

function assertFinanceAccess(req: Request, res: Response): boolean {
  if (!isCompanyFinanceUser((req as any)?.user?.email)) {
    res.status(403).json({ message: 'Sin permiso para resultados de la empresa' });
    return false;
  }
  return true;
}

function parseDateRange(req: Request): { from: string; to: string } {
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const from = String(req.query.from || defaultFrom).slice(0, 10);
  const to = String(req.query.to || defaultTo).slice(0, 10);
  return { from, to };
}

export const getCompanyFinanceAccess = async (req: Request, res: Response) => {
  const email = normalizeFinanceEmail((req as any)?.user?.email);
  res.json({
    allowed: isCompanyFinanceUser(email),
    email: email || null,
    expenseCategories: EXPENSE_CATEGORIES,
    incomeCategories: INCOME_CATEGORIES,
  });
};

export const listCompanyFinanceEntries = async (req: Request, res: Response) => {
  try {
    if (!assertFinanceAccess(req, res)) return;
    const { from, to } = parseDateRange(req);
    const entryType = String(req.query.type || '').trim();

    const conditions = ['entry_date >= ?', 'entry_date <= ?'];
    const params: unknown[] = [from, to];
    if (entryType === 'expense' || entryType === 'income') {
      conditions.push('entry_type = ?');
      params.push(entryType);
    }

    const rows = await query(
      `SELECT id, entry_type AS entryType, category, amount, description,
              DATE_FORMAT(entry_date, '%Y-%m-%d') AS entryDate,
              created_by_email AS createdByEmail, created_at AS createdAt
       FROM company_finance_entries
       WHERE ${conditions.join(' AND ')}
       ORDER BY entry_date DESC, created_at DESC`,
      params
    );
    res.json({ from, to, entries: rows });
  } catch (error: unknown) {
    console.error('listCompanyFinanceEntries:', error);
    res.status(500).json({ message: 'Error listando movimientos' });
  }
};

export const createCompanyFinanceEntry = async (req: Request, res: Response) => {
  try {
    if (!assertFinanceAccess(req, res)) return;
    const entryType = String(req.body?.entryType || '').trim();
    const category = String(req.body?.category || '').trim();
    const amount = Number(req.body?.amount);
    const description = String(req.body?.description || '').trim() || null;
    const entryDate = String(req.body?.entryDate || '').slice(0, 10);

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

    const id = uuidv4();
    const user = (req as any).user || {};
    await execute(
      `INSERT INTO company_finance_entries
       (id, entry_type, category, amount, description, entry_date, created_by_user_id, created_by_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entryType,
        category,
        Math.round(amount * 100) / 100,
        description,
        entryDate,
        user.id || null,
        normalizeFinanceEmail(user.email),
      ]
    );

    const created = await get(
      `SELECT id, entry_type AS entryType, category, amount, description,
              DATE_FORMAT(entry_date, '%Y-%m-%d') AS entryDate,
              created_by_email AS createdByEmail, created_at AS createdAt
       FROM company_finance_entries WHERE id = ?`,
      [id]
    );
    res.status(201).json(created);
  } catch (error: unknown) {
    console.error('createCompanyFinanceEntry:', error);
    res.status(500).json({ message: 'Error creando movimiento' });
  }
};

export const updateCompanyFinanceEntry = async (req: Request, res: Response) => {
  try {
    if (!assertFinanceAccess(req, res)) return;
    const id = String(req.params.id || '').trim();
    const existing = await get(`SELECT id FROM company_finance_entries WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Movimiento no encontrado' });

    const entryType = String(req.body?.entryType || '').trim();
    const category = String(req.body?.category || '').trim();
    const amount = Number(req.body?.amount);
    const description =
      req.body?.description != null ? String(req.body.description).trim() || null : undefined;
    const entryDate =
      req.body?.entryDate != null ? String(req.body.entryDate).slice(0, 10) : undefined;

    if (entryType && entryType !== 'expense' && entryType !== 'income') {
      return res.status(400).json({ message: 'entryType inválido' });
    }
    if (category && !ALL_CATEGORIES.has(category)) {
      return res.status(400).json({ message: 'Categoría inválida' });
    }
    if (req.body?.amount != null && (!Number.isFinite(amount) || amount <= 0)) {
      return res.status(400).json({ message: 'Importe inválido' });
    }
    if (entryDate && !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      return res.status(400).json({ message: 'Fecha inválida' });
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    if (entryType) {
      fields.push('entry_type = ?');
      params.push(entryType);
    }
    if (category) {
      fields.push('category = ?');
      params.push(category);
    }
    if (req.body?.amount != null) {
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
    if (fields.length === 0) return res.status(400).json({ message: 'Nada para actualizar' });

    params.push(id);
    await execute(`UPDATE company_finance_entries SET ${fields.join(', ')} WHERE id = ?`, params);

    const updated = await get(
      `SELECT id, entry_type AS entryType, category, amount, description,
              DATE_FORMAT(entry_date, '%Y-%m-%d') AS entryDate,
              created_by_email AS createdByEmail, created_at AS createdAt
       FROM company_finance_entries WHERE id = ?`,
      [id]
    );
    res.json(updated);
  } catch (error: unknown) {
    console.error('updateCompanyFinanceEntry:', error);
    res.status(500).json({ message: 'Error actualizando movimiento' });
  }
};

export const deleteCompanyFinanceEntry = async (req: Request, res: Response) => {
  try {
    if (!assertFinanceAccess(req, res)) return;
    const id = String(req.params.id || '').trim();
    const result = await execute(`DELETE FROM company_finance_entries WHERE id = ?`, [id]);
    if ((result as { affectedRows?: number })?.affectedRows === 0) {
      return res.status(404).json({ message: 'Movimiento no encontrado' });
    }
    res.json({ id });
  } catch (error: unknown) {
    console.error('deleteCompanyFinanceEntry:', error);
    res.status(500).json({ message: 'Error eliminando movimiento' });
  }
};

type FixedExpenseRow = {
  id: string;
  category: string;
  amount: string | number;
  description: string | null;
  active: number | boolean;
  startsFrom: string | null;
  endsAt: string | null;
};

function mapFixedExpenseRow(r: FixedExpenseRow) {
  return {
    id: r.id,
    category: r.category,
    amount: round2(Number(r.amount)),
    description: r.description,
    active: !!r.active,
    startsFrom: r.startsFrom,
    endsAt: r.endsAt,
  };
}

async function computeFixedExpensesForPeriod(from: string, to: string) {
  const rows = (await query(
    `SELECT id, category, amount, description, active,
            DATE_FORMAT(starts_from, '%Y-%m-%d') AS startsFrom,
            DATE_FORMAT(ends_at, '%Y-%m-%d') AS endsAt
     FROM company_finance_fixed_expenses
     WHERE active = 1
     ORDER BY amount DESC`
  )) as FixedExpenseRow[];

  const monthsInPeriod = countCalendarMonthsInRange(from, to);
  let total = 0;
  let monthlySubtotal = 0;
  const items: Array<{
    id: string;
    category: string;
    description: string | null;
    monthlyAmount: number;
    monthsApplied: number;
    periodTotal: number;
  }> = [];

  for (const r of rows) {
    const monthsApplied = fixedExpenseMonthsInRange(from, to, r.startsFrom, r.endsAt);
    if (monthsApplied <= 0) continue;
    const monthlyAmount = round2(Number(r.amount));
    monthlySubtotal += monthlyAmount;
    const periodTotal = round2(monthlyAmount * monthsApplied);
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
    fixedMonthlyExpenses: round2(total),
    fixedMonthlySubtotal: round2(monthlySubtotal),
    monthsInPeriod,
    fixedExpenseItems: items,
  };
}

export const listCompanyFinanceFixedExpenses = async (req: Request, res: Response) => {
  try {
    if (!assertFinanceAccess(req, res)) return;
    const rows = (await query(
      `SELECT id, category, amount, description, active,
              DATE_FORMAT(starts_from, '%Y-%m-%d') AS startsFrom,
              DATE_FORMAT(ends_at, '%Y-%m-%d') AS endsAt,
              created_by_email AS createdByEmail, created_at AS createdAt
       FROM company_finance_fixed_expenses
       ORDER BY active DESC, amount DESC`
    )) as FixedExpenseRow[];

    const categoryLabels: Record<string, string> = {};
    for (const c of EXPENSE_CATEGORIES) categoryLabels[c.id] = c.label;

    res.json({
      items: rows.map((r) => ({
        ...mapFixedExpenseRow(r),
        categoryLabel: categoryLabels[r.category] || r.category,
        createdByEmail: (r as { createdByEmail?: string }).createdByEmail,
        createdAt: (r as { createdAt?: string }).createdAt,
      })),
    });
  } catch (error: unknown) {
    console.error('listCompanyFinanceFixedExpenses:', error);
    res.status(500).json({ message: 'Error listando gastos fijos' });
  }
};

export const createCompanyFinanceFixedExpense = async (req: Request, res: Response) => {
  try {
    if (!assertFinanceAccess(req, res)) return;
    const category = String(req.body?.category || '').trim();
    const amount = Number(req.body?.amount);
    const description = String(req.body?.description || '').trim() || null;
    const active = req.body?.active !== false;
    const startsFrom = req.body?.startsFrom ? String(req.body.startsFrom).slice(0, 10) : null;
    const endsAt = req.body?.endsAt ? String(req.body.endsAt).slice(0, 10) : null;

    if (!EXPENSE_CATEGORIES.some((c) => c.id === category)) {
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

    const id = uuidv4();
    const user = (req as any).user || {};
    await execute(
      `INSERT INTO company_finance_fixed_expenses
       (id, category, amount, description, active, starts_from, ends_at, created_by_user_id, created_by_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        category,
        round2(amount),
        description,
        active ? 1 : 0,
        startsFrom,
        endsAt,
        user.id || null,
        normalizeFinanceEmail(user.email),
      ]
    );

    const created = await get(
      `SELECT id, category, amount, description, active,
              DATE_FORMAT(starts_from, '%Y-%m-%d') AS startsFrom,
              DATE_FORMAT(ends_at, '%Y-%m-%d') AS endsAt
       FROM company_finance_fixed_expenses WHERE id = ?`,
      [id]
    );
    res.status(201).json(mapFixedExpenseRow(created as FixedExpenseRow));
  } catch (error: unknown) {
    console.error('createCompanyFinanceFixedExpense:', error);
    res.status(500).json({ message: 'Error creando gasto fijo' });
  }
};

export const updateCompanyFinanceFixedExpense = async (req: Request, res: Response) => {
  try {
    if (!assertFinanceAccess(req, res)) return;
    const id = String(req.params.id || '').trim();
    const existing = await get(`SELECT id FROM company_finance_fixed_expenses WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ message: 'Gasto fijo no encontrado' });

    const fields: string[] = [];
    const params: unknown[] = [];

    if (req.body?.category != null) {
      const category = String(req.body.category).trim();
      if (!EXPENSE_CATEGORIES.some((c) => c.id === category)) {
        return res.status(400).json({ message: 'Categoría inválida' });
      }
      fields.push('category = ?');
      params.push(category);
    }
    if (req.body?.amount != null) {
      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ message: 'Importe inválido' });
      }
      fields.push('amount = ?');
      params.push(round2(amount));
    }
    if (req.body?.description !== undefined) {
      fields.push('description = ?');
      params.push(String(req.body.description || '').trim() || null);
    }
    if (req.body?.active !== undefined) {
      fields.push('active = ?');
      params.push(req.body.active ? 1 : 0);
    }
    if (req.body?.startsFrom !== undefined) {
      const startsFrom = req.body.startsFrom ? String(req.body.startsFrom).slice(0, 10) : null;
      if (startsFrom && !/^\d{4}-\d{2}-\d{2}$/.test(startsFrom)) {
        return res.status(400).json({ message: 'startsFrom inválida' });
      }
      fields.push('starts_from = ?');
      params.push(startsFrom);
    }
    if (req.body?.endsAt !== undefined) {
      const endsAt = req.body.endsAt ? String(req.body.endsAt).slice(0, 10) : null;
      if (endsAt && !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
        return res.status(400).json({ message: 'endsAt inválida' });
      }
      fields.push('ends_at = ?');
      params.push(endsAt);
    }

    if (fields.length === 0) return res.status(400).json({ message: 'Nada para actualizar' });
    params.push(id);
    await execute(`UPDATE company_finance_fixed_expenses SET ${fields.join(', ')} WHERE id = ?`, params);

    const updated = await get(
      `SELECT id, category, amount, description, active,
              DATE_FORMAT(starts_from, '%Y-%m-%d') AS startsFrom,
              DATE_FORMAT(ends_at, '%Y-%m-%d') AS endsAt
       FROM company_finance_fixed_expenses WHERE id = ?`,
      [id]
    );
    res.json(mapFixedExpenseRow(updated as FixedExpenseRow));
  } catch (error: unknown) {
    console.error('updateCompanyFinanceFixedExpense:', error);
    res.status(500).json({ message: 'Error actualizando gasto fijo' });
  }
};

export const deleteCompanyFinanceFixedExpense = async (req: Request, res: Response) => {
  try {
    if (!assertFinanceAccess(req, res)) return;
    const id = String(req.params.id || '').trim();
    const result = await execute(`DELETE FROM company_finance_fixed_expenses WHERE id = ?`, [id]);
    if ((result as { affectedRows?: number })?.affectedRows === 0) {
      return res.status(404).json({ message: 'Gasto fijo no encontrado' });
    }
    res.json({ id });
  } catch (error: unknown) {
    console.error('deleteCompanyFinanceFixedExpense:', error);
    res.status(500).json({ message: 'Error eliminando gasto fijo' });
  }
};

async function wholesaleOrdersRevenue(from: string, to: string): Promise<number> {
  const row = (await get(
    `SELECT COALESCE(SUM(o.total), 0) AS total
     FROM orders o
     WHERE o.date >= ? AND o.date <= ?
       AND o.status IN ('Confirmado', 'Preparando', 'Falta controlar', 'Controlado', 'Despachado')
       AND (o.archived IS NULL OR o.archived = 0)`,
    [from, to]
  )) as { total: string | number } | undefined;
  return Math.round(Number(row?.total ?? 0) * 100) / 100;
}

export const getCompanyFinanceMercadoPagoMovements = async (req: Request, res: Response) => {
  try {
    if (!assertFinanceAccess(req, res)) return;
    const { from, to } = parseDateRange(req);
    const data = await fetchMercadoPagoMovements(from, to);
    res.json({ from, to, ...data });
  } catch (error: unknown) {
    console.error('getCompanyFinanceMercadoPagoMovements:', error);
    res.status(500).json({ message: 'Error obteniendo movimientos de Mercado Pago' });
  }
};

export const getCompanyFinancePendingInvoices = async (req: Request, res: Response) => {
  try {
    if (!assertFinanceAccess(req, res)) return;
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '200'), 10) || 200));
    const data = await listPendingInvoices(limit);
    res.json(data);
  } catch (error: unknown) {
    console.error('getCompanyFinancePendingInvoices:', error);
    res.status(500).json({ message: 'Error listando facturas pendientes' });
  }
};

export const getCompanyFinanceSummary = async (req: Request, res: Response) => {
  try {
    if (!assertFinanceAccess(req, res)) return;
    const { from, to } = parseDateRange(req);
    const includeOrders = req.query.includeOrders === '1' || req.query.includeOrders === 'true';
    const includeChannels =
      req.query.includeChannels !== '0' && req.query.includeChannels !== 'false';

    const totals = (await get(
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'income' THEN amount ELSE 0 END), 0) AS manualIncome,
         COALESCE(SUM(CASE WHEN entry_type = 'expense' THEN amount ELSE 0 END), 0) AS totalExpenses,
         COALESCE(SUM(CASE WHEN entry_type = 'expense' THEN 1 ELSE 0 END), 0) AS expenseCount,
         COALESCE(SUM(CASE WHEN entry_type = 'income' THEN 1 ELSE 0 END), 0) AS incomeCount
       FROM company_finance_entries
       WHERE entry_date >= ? AND entry_date <= ?`,
      [from, to]
    )) as {
      manualIncome: string | number;
      totalExpenses: string | number;
      expenseCount: number;
      incomeCount: number;
    };

    const byCategory = (await query(
      `SELECT entry_type AS entryType, category,
              COALESCE(SUM(amount), 0) AS total,
              COUNT(*) AS count
       FROM company_finance_entries
       WHERE entry_date >= ? AND entry_date <= ?
       GROUP BY entry_type, category
       ORDER BY total DESC`,
      [from, to]
    )) as Array<{ entryType: string; category: string; total: number; count: number }>;

    const byMonth = (await query(
      `SELECT DATE_FORMAT(entry_date, '%Y-%m') AS month,
              entry_type AS entryType,
              COALESCE(SUM(amount), 0) AS total
       FROM company_finance_entries
       WHERE entry_date >= ? AND entry_date <= ?
       GROUP BY DATE_FORMAT(entry_date, '%Y-%m'), entry_type
       ORDER BY month ASC`,
      [from, to]
    )) as Array<{ month: string; entryType: string; total: number }>;

    const [receipts, despachos, pendingInvoices, fixedAgg, channelAgg, invoiced] = await Promise.all([
      sumReceiptsInRange(from, to),
      sumDespachosCostInRange(from, to),
      listPendingInvoices(200),
      computeFixedExpensesForPeriod(from, to),
      includeChannels
        ? Promise.all([
            aggregateMercadoLibreInRange(from, to),
            aggregateTiendaNubeInRange(from, to),
          ])
        : Promise.resolve([
            { sales: 0, fees: 0, orderCount: 0, connected: false, note: undefined as string | undefined },
            { sales: 0, fees: 0, orderCount: 0, connected: false, note: undefined as string | undefined },
          ]),
      sumInvoicedInRange(from, to),
    ]);

    const [mlAgg, tnAgg] = channelAgg;
    const ordersRevenue = includeOrders ? await wholesaleOrdersRevenue(from, to) : 0;
    const manualIncome = Math.round(Number(totals?.manualIncome ?? 0) * 100) / 100;
    const manualExpenses = Math.round(Number(totals?.totalExpenses ?? 0) * 100) / 100;

    const receiptsTotal = receipts.total;
    const mlSales = mlAgg.sales;
    const tnSales = tnAgg.sales;
    const channelFees = Math.round((mlAgg.fees + tnAgg.fees) * 100) / 100;
    const despachosCost = despachos.total;

    const totalIncome = Math.round(
      (receiptsTotal + mlSales + tnSales + manualIncome + ordersRevenue) * 100
    ) / 100;
    const fixedMonthlyExpenses = fixedAgg.fixedMonthlyExpenses;
    const totalExpenses = Math.round(
      (manualExpenses + despachosCost + channelFees + fixedMonthlyExpenses) * 100
    ) / 100;
    const netResult = Math.round((totalIncome - totalExpenses) * 100) / 100;

    const categoryLabels: Record<string, string> = {};
    for (const c of [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]) {
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
      fixedExpenseItems: fixedAgg.fixedExpenseItems.map((item) => ({
        ...item,
        categoryLabel: categoryLabels[item.category] || item.category,
      })),
      totalIncome,
      totalExpenses,
      netResult,
      profitOrLoss: netResult >= 0 ? 'profit' : 'loss',
      expenseCount: Number(totals?.expenseCount ?? 0),
      incomeCount: Number(totals?.incomeCount ?? 0),
      invoicedTotal: invoiced.total,
      invoicedNet: invoiced.net,
      invoicedIva: invoiced.iva,
      invoicedCount: invoiced.count,
      invoicedPaidTotal: invoiced.paid.total,
      invoicedPaidNet: invoiced.paid.net,
      invoicedPaidCount: invoiced.paid.count,
      invoicedUnpaidTotal: invoiced.unpaid.total,
      invoicedUnpaidNet: invoiced.unpaid.net,
      invoicedUnpaidCount: invoiced.unpaid.count,
      pendingInvoicesTotal: pendingInvoices.totalPending,
      pendingInvoicesCount: pendingInvoices.items.length,
      pendingInvoices: pendingInvoices.items,
      byCategory: (byCategory || []).map((r) => ({
        ...r,
        total: Math.round(Number(r.total) * 100) / 100,
        categoryLabel: categoryLabels[r.category] || r.category,
      })),
      byMonth: (byMonth || []).map((r) => ({
        ...r,
        total: Math.round(Number(r.total) * 100) / 100,
      })),
    });
  } catch (error: unknown) {
    console.error('getCompanyFinanceSummary:', error);
    res.status(500).json({ message: 'Error calculando resumen' });
  }
};
