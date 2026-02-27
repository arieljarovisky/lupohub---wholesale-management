import { Router } from 'express';
import { getSizes, cleanInvalidSizes } from '../controllers/sizes.controller';

const router = Router();

router.get('/', getSizes);
router.get('/clean-check', cleanInvalidSizes);

export default router;
