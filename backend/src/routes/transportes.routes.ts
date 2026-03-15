import { Router } from 'express';
import { getTransportes, createTransporte, updateTransporte, deleteTransporte } from '../controllers/transportes.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', getTransportes);
router.post('/', authMiddleware, createTransporte);
router.patch('/:id', authMiddleware, updateTransporte);
router.delete('/:id', authMiddleware, deleteTransporte);

export default router;
