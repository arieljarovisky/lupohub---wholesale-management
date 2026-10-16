import { NextFunction, Request, Response, Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  checkOrdersNow,
  cleanupStaleLinks,
  dismissAlert,
  dismissAllAlerts,
  dismissLine,
  fixLink,
  getLinks,
  removeLink,
  getOverview,
  reprocessOrder,
  resolveLine,
  resyncAll,
  retryAll,
  retryOne,
  searchVariants,
} from '../stockEngine/controller';

const router = Router();

const stockRoles = (req: Request, res: Response, next: NextFunction) => {
  const role = (req as any).user?.role;
  if (!['ADMIN', 'WAREHOUSE', 'DEPOSITO'].includes(role)) {
    return res.status(403).json({ message: 'No tenés permiso para esta pantalla.' });
  }
  next();
};

router.use(authMiddleware, stockRoles);

router.get('/overview', getOverview);
router.get('/variants', searchVariants);
router.post('/resync-all', resyncAll);
router.post('/retry-all', retryAll);
router.post('/retry/:variantId', retryOne);
router.post('/links/cleanup-stale', cleanupStaleLinks);
router.get('/links/:variantId', getLinks);
router.post('/links/:variantId/fix', fixLink);
router.post('/links/:variantId/remove', removeLink);
router.post('/unmatched/:lineId/resolve', resolveLine);
router.post('/unmatched/:lineId/dismiss', dismissLine);
router.post('/alerts/dismiss-all', dismissAllAlerts);
router.post('/alerts/:id/dismiss', dismissAlert);
router.post('/check-orders', checkOrdersNow);
router.post('/reprocess-order', reprocessOrder);

export default router;
