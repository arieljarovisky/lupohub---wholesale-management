import { Router } from 'express';
import { getStockMovements, forceSyncStock, createStockSnapshot, importSalesHistory } from '../controllers/stock.controller';

const router = Router();

// Historial de movimientos de stock
router.get('/movements', getStockMovements);

// Forzar sincronización de una variante a TN y ML
router.post('/sync/:variantId', forceSyncStock);

// Crear snapshot inicial del stock actual
router.post('/snapshot', createStockSnapshot);

// Importar historial de ventas de TN y ML
router.post('/import-history', importSalesHistory);

export default router;
