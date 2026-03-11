import { Router } from 'express';
import { getProducts, createProduct, getProductBySku, getProductById, patchStock, updateProduct, updateProductExternalIds, updateVariantExternalIds, getVariantById, updateVariant, bulkLinkVariants, deleteAllProducts, deleteVariant, deleteProduct, importTangoArticles, exportInventory, copyExternalLinksFromSku } from '../controllers/products.controller';

const router = Router();

// Rutas específicas primero (evitar que /:sku o /:id capturen)
router.post('/variants/bulk-link', bulkLinkVariants);
router.post('/copy-external-links', copyExternalLinksFromSku);
router.get('/variants/:variantId', getVariantById);
router.put('/variants/:variantId', updateVariant);
router.put('/variants/:variantId/external-ids', updateVariantExternalIds);
router.delete('/variants/:variantId', deleteVariant);

router.delete('/all', deleteAllProducts);
router.post('/import-tango', importTangoArticles);
router.get('/export-inventory', exportInventory);
router.get('/', getProducts);
router.get('/by-id/:id', getProductById);
router.get('/:sku', getProductBySku);
router.post('/', createProduct);
router.patch('/stock', patchStock);
router.put('/:id', updateProduct);
router.put('/:id/external-ids', updateProductExternalIds);
router.delete('/:id', deleteProduct);

export default router;
