import { Router } from 'express';
import { getColors } from '../controllers/colors.controller';

const router = Router();

router.get('/', getColors);

export default router;
