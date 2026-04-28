import { Router } from 'express';
import { getOrders, createOrder, updateOrderStatus, updateOrder, deleteOrder, archiveOrder, getOrderInvoice, emitirFactura, getOrderCreditNotes, emitirNotaCredito, patchOrderPaymentStatus, applyMayoristaStockDeduction, exportTopWholesaleProductsMetricsXlsx } from '../controllers/orders.controller';
import { optionalAuthMiddleware, authMiddleware } from '../middleware/auth';

const router = Router();
router.use(optionalAuthMiddleware);

router.get('/', getOrders);
router.post('/', createOrder);
router.patch('/:id/payment-status', authMiddleware, patchOrderPaymentStatus);
router.post('/:id/apply-mayorista-stock', authMiddleware, applyMayoristaStockDeduction);
router.patch('/:id/status', updateOrderStatus);
router.put('/:id', updateOrder);
router.patch('/:id/archive', authMiddleware, archiveOrder);
router.delete('/:id', deleteOrder);
router.get('/:id/invoice', getOrderInvoice);
router.get('/:id/credit-notes', getOrderCreditNotes);
router.post('/:id/emitir-factura', authMiddleware, emitirFactura);
router.post('/:id/emitir-nota-credito', authMiddleware, emitirNotaCredito);
router.get('/metrics/top-products/export', authMiddleware, exportTopWholesaleProductsMetricsXlsx);

export default router;
