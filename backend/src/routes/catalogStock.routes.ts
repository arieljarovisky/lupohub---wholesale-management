import { Router } from 'express';
import { catalogStockAuth, getCatalogStock } from '../controllers/catalogStock.controller';

const router = Router();

router.get('/', catalogStockAuth, getCatalogStock);

export default router;
