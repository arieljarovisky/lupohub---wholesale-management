import { Router } from 'express';
import { getSizes } from '../controllers/sizes.controller';

const router = Router();

router.get('/', getSizes);

export default router;
