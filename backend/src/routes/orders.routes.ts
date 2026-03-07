import { Router } from 'express';
import { getOrders, createOrder, updateOrderStatus, updateOrder, deleteOrder } from '../controllers/orders.controller';
import { optionalAuthMiddleware } from '../middleware/auth';

const router = Router();
router.use(optionalAuthMiddleware);

router.get('/', getOrders);
router.post('/', createOrder);
router.patch('/:id/status', updateOrderStatus);
router.put('/:id', updateOrder);
router.delete('/:id', deleteOrder);

export default router;
