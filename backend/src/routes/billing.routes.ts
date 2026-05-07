import { Router } from 'express';
import { listBilling, exportBilling, exportRetPerTxt, importAgipPadron } from '../controllers/billing.controller';
import { authMiddleware, billingAccessMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware, billingAccessMiddleware);

router.get('/', listBilling);
router.get('/export', exportBilling);
router.get('/export-retper', exportRetPerTxt);
router.post('/agip-padron/import', importAgipPadron);

export default router;

