import { execute, query } from './db';

/** Número de despacho de importación por línea de pedido (misma variante, distintos despachos). */
export const addOrderItemDespachoId = async () => {
  try {
    const rows = await query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'despacho_id'`
    );
    if ((rows as any[])?.length) {
      console.log('✓ order_items.despacho_id ya existe');
      return;
    }
    await execute(`ALTER TABLE order_items ADD COLUMN despacho_id VARCHAR(36) NULL`);
    try {
      await execute(
        `ALTER TABLE order_items ADD CONSTRAINT fk_order_items_despacho FOREIGN KEY (despacho_id) REFERENCES despachos(id) ON DELETE SET NULL`
      );
    } catch (e: any) {
      if (!String(e?.message || '').includes('Duplicate')) {
        console.warn('fk_order_items_despacho:', e?.message || e);
      }
    }
    console.log('✓ Columna order_items.despacho_id agregada');
  } catch (error: any) {
    console.error('addOrderItemDespachoId:', error?.message || error);
  }
};
