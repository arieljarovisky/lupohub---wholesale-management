import { Router } from 'express';
import { getCustomers, createCustomer, updateCustomer, deleteCustomer } from '../controllers/customers.controller';

const router = Router();

router.get('/', getCustomers);
router.post('/', createCustomer);
router.patch('/:id', updateCustomer);
router.delete('/:id', deleteCustomer);

export default router;
