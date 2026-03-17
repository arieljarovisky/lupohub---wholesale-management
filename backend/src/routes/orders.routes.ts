import { Router } from 'express';
import { getOrders, createOrder, updateOrderStatus, updateOrder, deleteOrder, archiveOrder, getOrderInvoice, emitirFactura, getOrderCreditNotes, emitirNotaCredito } from '../controllers/orders.controller';
import { optionalAuthMiddleware, authMiddleware } from '../middleware/auth';

const router = Router();
router.use(optionalAuthMiddleware);

router.get('/', getOrders);
router.post('/', createOrder);
router.patch('/:id/status', updateOrderStatus);
router.put('/:id', updateOrder);
router.patch('/:id/archive', authMiddleware, archiveOrder);
router.delete('/:id', deleteOrder);
router.get('/:id/invoice', getOrderInvoice);
router.get('/:id/credit-notes', getOrderCreditNotes);
router.post('/:id/emitir-factura', authMiddleware, emitirFactura);
router.post('/:id/emitir-nota-credito', authMiddleware, emitirNotaCredito);

export default router;
