import { Router } from 'express';
import { getSizes, cleanInvalidSizes, createSize } from '../controllers/sizes.controller';
import { authMiddleware, adminOrDepositoMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', getSizes);
router.post('/', authMiddleware, adminOrDepositoMiddleware, createSize);
router.get('/clean-check', cleanInvalidSizes);

export default router;
