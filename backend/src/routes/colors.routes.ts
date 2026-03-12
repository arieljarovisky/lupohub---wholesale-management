import { Router } from 'express';
import { getColors, createColor } from '../controllers/colors.controller';
import { authMiddleware, adminOrDepositoMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', getColors);
router.post('/', authMiddleware, adminOrDepositoMiddleware, createColor);

export default router;
