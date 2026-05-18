import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getCompanyFinanceAccess,
  listCompanyFinanceEntries,
  createCompanyFinanceEntry,
  updateCompanyFinanceEntry,
  deleteCompanyFinanceEntry,
  getCompanyFinanceSummary,
  getCompanyFinanceMercadoPagoMovements,
  getCompanyFinancePendingInvoices,
  listCompanyFinanceFixedExpenses,
  createCompanyFinanceFixedExpense,
  updateCompanyFinanceFixedExpense,
  deleteCompanyFinanceFixedExpense,
} from '../controllers/companyFinance.controller';

const router = Router();

router.use(authMiddleware);

router.get('/access', getCompanyFinanceAccess);
router.get('/summary', getCompanyFinanceSummary);
router.get('/mercadopago-movements', getCompanyFinanceMercadoPagoMovements);
router.get('/pending-invoices', getCompanyFinancePendingInvoices);
router.get('/entries', listCompanyFinanceEntries);
router.get('/fixed-expenses', listCompanyFinanceFixedExpenses);
router.post('/fixed-expenses', createCompanyFinanceFixedExpense);
router.put('/fixed-expenses/:id', updateCompanyFinanceFixedExpense);
router.delete('/fixed-expenses/:id', deleteCompanyFinanceFixedExpense);
router.post('/entries', createCompanyFinanceEntry);
router.put('/entries/:id', updateCompanyFinanceEntry);
router.delete('/entries/:id', deleteCompanyFinanceEntry);

export default router;
