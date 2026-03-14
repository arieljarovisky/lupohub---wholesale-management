import { Router } from 'express';
import { getSizes, cleanInvalidSizes, createSize, deleteSize, unifySizes } from '../controllers/sizes.controller';
import { authMiddleware, adminOrDepositoMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', getSizes);
router.post('/', authMiddleware, adminOrDepositoMiddleware, createSize);
router.post('/unify', authMiddleware, adminOrDepositoMiddleware, unifySizes);
router.delete('/:id', authMiddleware, adminOrDepositoMiddleware, deleteSize);
router.get('/clean-check', cleanInvalidSizes);

export default router;
