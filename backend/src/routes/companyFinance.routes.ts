import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getCompanyFinanceAccess,
  listCompanyFinanceEntries,
  createCompanyFinanceEntry,
  updateCompanyFinanceEntry,
  deleteCompanyFinanceEntry,
  getCompanyFinanceSummary,
} from '../controllers/companyFinance.controller';

const router = Router();

router.use(authMiddleware);

router.get('/access', getCompanyFinanceAccess);
router.get('/summary', getCompanyFinanceSummary);
router.get('/entries', listCompanyFinanceEntries);
router.post('/entries', createCompanyFinanceEntry);
router.put('/entries/:id', updateCompanyFinanceEntry);
router.delete('/entries/:id', deleteCompanyFinanceEntry);

export default router;
