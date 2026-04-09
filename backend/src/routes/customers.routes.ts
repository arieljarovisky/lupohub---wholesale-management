import { Router } from 'express';
import multer from 'multer';
import { getCustomers, createCustomer, updateCustomer, deleteCustomer, importCustomers, bulkUpdateCuit, attachUserToCustomer, getSaldosPendientes, exportSaldosPendientesCsv, clearDispatchedPendingsForCustomer } from '../controllers/customers.controller';
import { exportMultimediaHistorial, importMultimediaHistorial } from '../controllers/multimediaHistorial.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/saldos-pendientes/export', authMiddleware as any, exportSaldosPendientesCsv as any);
router.get('/saldos-pendientes', authMiddleware as any, getSaldosPendientes as any);
router.get('/multimedia-historial/export', authMiddleware as any, exportMultimediaHistorial as any);
router.post('/multimedia-historial/import', authMiddleware as any, upload.single('file'), importMultimediaHistorial as any);
router.get('/', authMiddleware as any, getCustomers as any);
router.post('/', authMiddleware as any, createCustomer as any);
router.post('/import', authMiddleware as any, importCustomers as any);
router.post('/bulk-update-cuit', authMiddleware as any, bulkUpdateCuit as any);
router.post('/:id/attach-user', authMiddleware as any, attachUserToCustomer as any);
router.post('/:id/clear-dispatched-pendings', authMiddleware as any, clearDispatchedPendingsForCustomer as any);
router.patch('/:id', authMiddleware as any, updateCustomer as any);
router.delete('/:id', authMiddleware as any, deleteCustomer as any);

export default router;
