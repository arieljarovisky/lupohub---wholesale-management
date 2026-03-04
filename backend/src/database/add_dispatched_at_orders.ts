import { execute, get } from './db';

export const addDispatchedAtToOrders = async () => {
  console.log('Verificando columna dispatched_at en orders...');
  try {
    const row = await get(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'dispatched_at'`
    );
    if (row) {
      console.log('✓ Columna dispatched_at ya existe en orders');
      return;
    }
    await execute(`ALTER TABLE orders ADD COLUMN dispatched_at DATETIME NULL AFTER picked_by`);
    console.log('✓ Columna dispatched_at agregada a orders');
  } catch (error: any) {
    console.error('Error agregando dispatched_at:', error.message);
  }
};
