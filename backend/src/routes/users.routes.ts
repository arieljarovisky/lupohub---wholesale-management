import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { listUsers, createUser, deleteUser } from '../controllers/users.controller';

const router = Router();

router.use(authMiddleware);

router.get('/', listUsers);
router.post('/', createUser);
router.delete('/:id', deleteUser);

export default router;
