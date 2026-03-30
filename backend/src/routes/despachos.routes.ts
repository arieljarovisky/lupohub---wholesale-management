import { Router } from 'express';
import {
  getDespachos,
  getDespachoById,
  createDespacho,
  updateDespacho,
  deleteDespacho,
  addDespachoItem,
  removeDespachoItem,
  getProductosSinDespacho,
  getDespachoStats,
  asignarDespachoATodos,
  asignarDespachoAProducto
} from '../controllers/despachos.controller';

const router = Router();

// Estadísticas
router.get('/stats', getDespachoStats);

// Productos sin despacho
router.get('/productos-sin-despacho', getProductosSinDespacho);

// Asignar un número de despacho a todos los productos que no tienen despacho (debe ir antes de /:id)
router.post('/asignar-todos', asignarDespachoATodos);
// Asignar un despacho existente a un solo producto por código (SKU base o variante)
router.post('/asignar-a-producto', asignarDespachoAProducto);

// CRUD de despachos
router.get('/', getDespachos);
router.get('/:id', getDespachoById);
router.post('/', createDespacho);
router.put('/:id', updateDespacho);
router.delete('/:id', deleteDespacho);

// Items de despacho
router.post('/:id/items', addDespachoItem);
router.delete('/:id/items/:itemId', removeDespachoItem);

export default router;
