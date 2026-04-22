import { Router } from 'express';
import { listBilling, exportBilling, exportFacturasIibbCapital } from '../controllers/billing.controller';
import { authMiddleware, billingAccessMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware, billingAccessMiddleware);

router.get('/', listBilling);
router.get('/export', exportBilling);
router.get('/export-facturas-iibb-capital', exportFacturasIibbCapital);

export default router;

