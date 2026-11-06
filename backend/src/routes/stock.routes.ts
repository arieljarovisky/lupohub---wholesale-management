import { Router } from 'express';
import { getStockMovements, forceSyncStock, createStockSnapshot, deleteStockSnapshot, importSalesHistory, updateVariantStockEndpoint, importStockFromExcel, importStockGridToDespacho } from '../controllers/stock.controller';
import { compareDailySnapshots, createDailySnapshot, exportDailySnapshotCompare, listDailySnapshots } from '../controllers/stockDailySnapshot.controller';
import { getBrazilOrderSuggestion, exportBrazilOrderSuggestion } from '../controllers/brazilOrderSuggestion.controller';
import { authMiddleware, adminOrDepositoMiddleware } from '../middleware/auth';

const router = Router();

router.get('/brazil-order-suggestion/export', authMiddleware, adminOrDepositoMiddleware, exportBrazilOrderSuggestion);
router.get('/brazil-order-suggestion', authMiddleware, adminOrDepositoMiddleware, getBrazilOrderSuggestion);

// Historial de movimientos de stock
router.get('/movements', getStockMovements);

// Ajuste manual de stock (Admin o Depósito) — requiere auth
router.put('/variant/:variantId', authMiddleware, updateVariantStockEndpoint);

// Forzar sincronización de una variante a TN y ML
router.post('/sync/:variantId', forceSyncStock);

// Fotos diarias del stock, para comparar cómo se descuenta día a día
router.get('/daily-snapshots', authMiddleware, adminOrDepositoMiddleware, listDailySnapshots);
router.post('/daily-snapshot', authMiddleware, adminOrDepositoMiddleware, createDailySnapshot);
router.get('/daily-snapshot/compare.xlsx', authMiddleware, adminOrDepositoMiddleware, exportDailySnapshotCompare);
router.get('/daily-snapshot/compare', authMiddleware, adminOrDepositoMiddleware, compareDailySnapshots);

// Crear snapshot inicial del stock actual
router.post('/snapshot', createStockSnapshot);
// Eliminar snapshot inicial para poder crear uno nuevo
router.delete('/snapshot', deleteStockSnapshot);

// Importar historial de ventas de TN y ML
router.post('/import-history', importSalesHistory);

// Importar stock desde Excel (CODIGO, COLOR, columnas P, M, G, GG, XG, XXG, XXXG)
router.post('/import-excel', authMiddleware, importStockFromExcel);

// Planilla CODIGO + COLOR + talles dinámicos → stock + ítems del despacho
router.post('/import-grid-to-despacho', authMiddleware, importStockGridToDespacho);

export default router;
