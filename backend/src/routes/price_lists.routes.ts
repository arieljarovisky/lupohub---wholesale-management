import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listPriceLists,
  getPriceList,
  createPriceList,
  createPriceListsBulk,
  updatePriceList,
  deletePriceList,
  getPriceListItems,
  setPriceListItems,
  duplicatePriceList,
  fillPriceListFromBase,
  setPriceListItemsBySku,
  getSellerPriceLists,
  setSellerPriceLists,
  getAllSellersWithPriceLists
} from '../controllers/price_lists.controller';

const router = Router();

router.use(authMiddleware);

router.get('/', listPriceLists);
router.get('/sellers', getAllSellersWithPriceLists);
router.get('/sellers/:sellerId', getSellerPriceLists);
router.put('/sellers/:sellerId', setSellerPriceLists);
router.post('/', createPriceList);
router.post('/bulk', createPriceListsBulk);
router.get('/:id', getPriceList);
router.put('/:id', updatePriceList);
router.delete('/:id', deletePriceList);
router.post('/:id/duplicate', duplicatePriceList);
router.post('/:id/fill-from-base', fillPriceListFromBase);
router.get('/:id/items', getPriceListItems);
router.put('/:id/items', setPriceListItems);
router.put('/:id/items/by-sku', setPriceListItemsBySku);

export default router;
