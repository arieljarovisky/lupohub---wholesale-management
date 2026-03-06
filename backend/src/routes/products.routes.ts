import { Router } from 'express';
import { getProducts, createProduct, getProductBySku, patchStock, updateProduct, updateProductExternalIds, updateVariantExternalIds, bulkLinkVariants, deleteAllProducts, importTangoArticles, exportInventory } from '../controllers/products.controller';

const router = Router();

// Rutas específicas primero (evitar que /:sku o /:id capturen)
router.post('/variants/bulk-link', bulkLinkVariants);
router.put('/variants/:variantId/external-ids', updateVariantExternalIds);

router.delete('/all', deleteAllProducts);
router.post('/import-tango', importTangoArticles);
router.get('/export-inventory', exportInventory);
router.get('/', getProducts);
router.get('/:sku', getProductBySku);
router.post('/', createProduct);
router.patch('/stock', patchStock);
router.put('/:id', updateProduct);
router.put('/:id/external-ids', updateProductExternalIds);

export default router;
