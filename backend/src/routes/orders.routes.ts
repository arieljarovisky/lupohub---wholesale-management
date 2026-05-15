import { Router } from 'express';
import {
  getOrders,
  createOrder,
  updateOrderStatus,
  updateOrder,
  deleteOrder,
  archiveOrder,
  getOrderInvoice,
  recalculateStoredInvoiceAgip,
  reemitirFacturaConAgip,
  emitirFactura,
  getOrderCreditNotes,
  emitirNotaCredito,
  patchOrderPaymentStatus,
  applyMayoristaStockDeduction,
  exportTopWholesaleProductsMetricsXlsx,
  getOrderItemsMissingDespacho,
  assignDespachosToOrderItems,
  assignRemitoNumber,
  importOrdersFromMatrix,
} from '../controllers/orders.controller';
import { optionalAuthMiddleware, authMiddleware } from '../middleware/auth';

const router = Router();
router.use(optionalAuthMiddleware);

router.get('/', getOrders);
router.post('/import-matrix', authMiddleware, importOrdersFromMatrix);
router.post('/', createOrder);
router.patch('/:id/payment-status', authMiddleware, patchOrderPaymentStatus);
router.post('/:id/apply-mayorista-stock', authMiddleware, applyMayoristaStockDeduction);
router.patch('/:id/status', authMiddleware, updateOrderStatus);
router.put('/:id', updateOrder);
router.patch('/:id/archive', authMiddleware, archiveOrder);
router.delete('/:id', authMiddleware, deleteOrder);
router.get('/:id/invoice', getOrderInvoice);
router.post('/:id/invoice/recalculate-agip', authMiddleware, recalculateStoredInvoiceAgip);
router.post('/:id/invoice/reemitir-con-agip', authMiddleware, reemitirFacturaConAgip);
router.get('/:id/credit-notes', getOrderCreditNotes);
router.post('/:id/emitir-factura', authMiddleware, emitirFactura);
router.post('/:id/emitir-nota-credito', authMiddleware, emitirNotaCredito);
router.get('/:id/items-missing-despacho', getOrderItemsMissingDespacho);
router.put('/:id/assign-despachos', authMiddleware, assignDespachosToOrderItems);
router.post('/:id/remito-number/assign', assignRemitoNumber);
router.get('/metrics/top-products/export', authMiddleware, exportTopWholesaleProductsMetricsXlsx);

export default router;
