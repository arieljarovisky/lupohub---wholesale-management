import { Router } from 'express';
import { listBilling, exportBilling } from '../controllers/billing.controller';
import { authMiddleware, adminOrDepositoMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware, adminOrDepositoMiddleware);

router.get('/', listBilling);
router.get('/export', exportBilling);

export default router;

