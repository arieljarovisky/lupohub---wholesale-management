import { login, refreshToken, getMyCustomer } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/login', login);
router.post('/refresh', refreshToken);
router.get('/me/customer', authMiddleware, getMyCustomer);

export default router;
