import { Router } from 'express';
import { getProducts, createProduct, getProductBySku, getProductById, patchStock, updateProduct, updateProductExternalIds, updateVariantExternalIds, getVariantById, updateVariant, bulkLinkVariants, deleteAllProducts, deleteVariant, deleteProduct, importTangoArticles, exportInventory, getVariantPublications, addVariantPublication, deleteVariantPublication, unlinkProductPlatforms, getDuplicateProducts } from '../controllers/products.controller';
import { authMiddleware, adminOrDepositoMiddleware } from '../middleware/auth';

const router = Router();

// Rutas específicas primero (evitar que /:sku o /:id capturen)
router.post('/variants/bulk-link', authMiddleware, adminOrDepositoMiddleware, bulkLinkVariants);
router.get('/variants/:variantId', authMiddleware, getVariantById);
// Modificar SKU / externalSku de una variante: solo ADMIN o DEPOSITO
router.put('/variants/:variantId', authMiddleware, adminOrDepositoMiddleware, updateVariant);
router.put('/variants/:variantId/external-ids', authMiddleware, adminOrDepositoMiddleware, updateVariantExternalIds);
router.get('/variants/:variantId/publications', authMiddleware, getVariantPublications);
router.post('/variants/:variantId/publications', authMiddleware, adminOrDepositoMiddleware, addVariantPublication);
router.delete('/variants/:variantId/publications/:publicationId', authMiddleware, adminOrDepositoMiddleware, deleteVariantPublication);
router.delete('/variants/:variantId', authMiddleware, adminOrDepositoMiddleware, deleteVariant);

router.delete('/all', authMiddleware, adminOrDepositoMiddleware, deleteAllProducts);
router.post('/import-tango', authMiddleware, adminOrDepositoMiddleware, importTangoArticles);
router.get('/duplicates', authMiddleware, adminOrDepositoMiddleware, getDuplicateProducts);
router.get('/export-inventory', authMiddleware, exportInventory);
router.get('/', authMiddleware, getProducts);
router.get('/by-id/:id', authMiddleware, getProductById);
router.get('/:sku', authMiddleware, getProductBySku);
router.post('/', authMiddleware, adminOrDepositoMiddleware, createProduct);
router.patch('/stock', authMiddleware, patchStock);
router.put('/:id', authMiddleware, adminOrDepositoMiddleware, updateProduct);
router.put('/:id/external-ids', authMiddleware, adminOrDepositoMiddleware, updateProductExternalIds);
router.post('/:id/unlink', authMiddleware, adminOrDepositoMiddleware, unlinkProductPlatforms);
router.delete('/:id', authMiddleware, adminOrDepositoMiddleware, deleteProduct);

export default router;
