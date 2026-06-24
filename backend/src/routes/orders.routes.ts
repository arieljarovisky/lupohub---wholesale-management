import { Router } from 'express';
import {
  getOrders,
  getLinkableOrdersForPayment,
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
  getOrderDebitNotes,
  emitirNotaDebito,
  patchOrderPaymentStatus,
  patchOrderIncludeInSaldo,
  applyMayoristaStockDeduction,
  restoreMayoristaStockDeduction,
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
router.get('/linkable-for-payment', authMiddleware, getLinkableOrdersForPayment);
router.post('/import-matrix', authMiddleware, importOrdersFromMatrix);
router.post('/', createOrder);
router.patch('/:id/payment-status', authMiddleware, patchOrderPaymentStatus);
router.patch('/:id/include-in-saldo', authMiddleware, patchOrderIncludeInSaldo);
router.post('/:id/apply-mayorista-stock', authMiddleware, applyMayoristaStockDeduction);
router.post('/:id/restore-mayorista-stock', authMiddleware, restoreMayoristaStockDeduction);
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
router.get('/:id/debit-notes', getOrderDebitNotes);
router.post('/:id/emitir-nota-debito', authMiddleware, emitirNotaDebito);
router.get('/:id/items-missing-despacho', getOrderItemsMissingDespacho);
router.put('/:id/assign-despachos', authMiddleware, assignDespachosToOrderItems);
router.post('/:id/remito-number/assign', assignRemitoNumber);
router.get('/metrics/top-products/export', authMiddleware, exportTopWholesaleProductsMetricsXlsx);

export default router;
