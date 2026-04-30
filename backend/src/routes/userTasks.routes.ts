import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  createAssignedUserTask,
  deleteAssignedUserTask,
  getMyUserTasks,
  listAssignedUserTasks,
} from '../controllers/userTasks.controller';

const router = Router();

router.use(authMiddleware);

router.get('/mine', getMyUserTasks);
router.get('/', listAssignedUserTasks);
router.post('/', createAssignedUserTask);
router.delete('/:id', deleteAssignedUserTask);

export default router;
