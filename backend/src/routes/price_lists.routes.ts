import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listPriceLists,
  getPriceList,
  createPriceList,
  updatePriceList,
  deletePriceList,
  getPriceListItems,
  setPriceListItems
} from '../controllers/price_lists.controller';

const router = Router();

router.use(authMiddleware);

router.get('/', listPriceLists);
router.get('/:id', getPriceList);
router.post('/', createPriceList);
router.put('/:id', updatePriceList);
router.delete('/:id', deletePriceList);
router.get('/:id/items', getPriceListItems);
router.put('/:id/items', setPriceListItems);

export default router;
