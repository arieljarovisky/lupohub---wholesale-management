import { Router } from 'express';
import { getCustomers, createCustomer, updateCustomer } from '../controllers/customers.controller';

const router = Router();

router.get('/', getCustomers);
router.post('/', createCustomer);
router.patch('/:id', updateCustomer);

export default router;
