import { Router } from 'express';
import {
  createBundle,
  createListingFromSource,
  getBundle,
  getBundlesByProduct,
  getListingVariations,
  getSourcePreview,
  listBundles,
  removeBundle,
  saveBundleGroup,
  syncBundleStock,
  syncListingBundlesStock,
  updateBundle
} from '../controllers/publicationStockBundles.controller';
import { authMiddleware, adminOrDepositoMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, listBundles);
router.get('/source-preview', authMiddleware, getSourcePreview);
router.get('/listing-variations', authMiddleware, getListingVariations);
router.get('/by-product', authMiddleware, getBundlesByProduct);
router.post(
  '/create-listing-from-source',
  authMiddleware,
  adminOrDepositoMiddleware,
  createListingFromSource
);
router.post('/group', authMiddleware, adminOrDepositoMiddleware, saveBundleGroup);
router.post('/sync-listing-stock', authMiddleware, adminOrDepositoMiddleware, syncListingBundlesStock);
router.post('/', authMiddleware, adminOrDepositoMiddleware, createBundle);
router.get('/:id', authMiddleware, getBundle);
router.patch('/:id', authMiddleware, adminOrDepositoMiddleware, updateBundle);
router.delete('/:id', authMiddleware, adminOrDepositoMiddleware, removeBundle);
router.post('/:id/sync-stock', authMiddleware, adminOrDepositoMiddleware, syncBundleStock);

export default router;
