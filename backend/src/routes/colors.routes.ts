import { Router } from 'express';
import { getColors, createColor, updateColor, importStandardColorCatalog } from '../controllers/colors.controller';
import { authMiddleware, adminOrDepositoMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', getColors);
router.post(
  '/import-standard-catalog',
  authMiddleware,
  adminOrDepositoMiddleware,
  importStandardColorCatalog
);
router.post('/', authMiddleware, adminOrDepositoMiddleware, createColor);
router.put('/:id', authMiddleware, adminOrDepositoMiddleware, updateColor);

export default router;
