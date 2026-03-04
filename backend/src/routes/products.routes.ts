import { Router } from 'express';
import { getProducts, createProduct, getProductBySku, patchStock, updateProduct, updateProductExternalIds, updateVariantExternalIds, deleteAllProducts, importTangoArticles } from '../controllers/products.controller';

const router = Router();

router.delete('/all', deleteAllProducts);
router.post('/import-tango', importTangoArticles);
router.get('/', getProducts);
router.get('/:sku', getProductBySku);
router.post('/', createProduct);
router.patch('/stock', patchStock);
router.put('/:id', updateProduct);
router.put('/:id/external-ids', updateProductExternalIds);
router.put('/variants/:variantId/external-ids', updateVariantExternalIds);

export default router;
