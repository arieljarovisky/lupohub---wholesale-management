import { Router } from 'express';
import { getStockMovements, forceSyncStock } from '../controllers/stock.controller';

const router = Router();

// Historial de movimientos de stock
router.get('/movements', getStockMovements);

// Forzar sincronización de una variante a TN y ML
router.post('/sync/:variantId', forceSyncStock);

export default router;
