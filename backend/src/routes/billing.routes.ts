import { Router } from 'express';
import { listBilling, exportBilling } from '../controllers/billing.controller';
import { authMiddleware, billingAccessMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware, billingAccessMiddleware);

router.get('/', listBilling);
router.get('/export', exportBilling);

export default router;

