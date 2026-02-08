import { Router } from 'express';
import { getProducts, createProduct, getProductBySku, patchStock, updateProduct } from '../controllers/products.controller';

const router = Router();

router.get('/', getProducts);
router.get('/:sku', getProductBySku);
router.post('/', createProduct);
router.patch('/stock', patchStock);
router.put('/:id', updateProduct);

export default router;
