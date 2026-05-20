import { Router } from 'express';
import {
  createBundle,
  createListingFromSource,
  getBundle,
  listBundles,
  removeBundle,
  syncBundleStock,
  updateBundle
} from '../controllers/publicationStockBundles.controller';
import { authMiddleware, adminOrDepositoMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, listBundles);
router.post(
  '/create-listing-from-source',
  authMiddleware,
  adminOrDepositoMiddleware,
  createListingFromSource
);
router.post('/', authMiddleware, adminOrDepositoMiddleware, createBundle);
router.get('/:id', authMiddleware, getBundle);
router.patch('/:id', authMiddleware, adminOrDepositoMiddleware, updateBundle);
router.delete('/:id', authMiddleware, adminOrDepositoMiddleware, removeBundle);
router.post('/:id/sync-stock', authMiddleware, adminOrDepositoMiddleware, syncBundleStock);

export default router;
