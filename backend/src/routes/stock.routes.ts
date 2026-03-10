import { Router } from 'express';
import { getStockMovements, forceSyncStock, createStockSnapshot, deleteStockSnapshot, importSalesHistory, updateVariantStockEndpoint, importStockFromExcel } from '../controllers/stock.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Historial de movimientos de stock
router.get('/movements', getStockMovements);

// Ajuste manual de stock (Admin o Depósito) — requiere auth
router.put('/variant/:variantId', authMiddleware, updateVariantStockEndpoint);

// Forzar sincronización de una variante a TN y ML
router.post('/sync/:variantId', forceSyncStock);

// Crear snapshot inicial del stock actual
router.post('/snapshot', createStockSnapshot);
// Eliminar snapshot inicial para poder crear uno nuevo
router.delete('/snapshot', deleteStockSnapshot);

// Importar historial de ventas de TN y ML
router.post('/import-history', importSalesHistory);

// Importar stock desde Excel (CODIGO, COLOR, columnas P, M, G, GG, XG, XXG, XXXG)
router.post('/import-excel', authMiddleware, importStockFromExcel);

export default router;
