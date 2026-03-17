import { execute, query } from './db';

export const addOrderItemSellAsPack = async () => {
  try {
    const col = await query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'sell_as_pack'`
    );
    if (col && col.length > 0) {
      console.log('✓ order_items.sell_as_pack ya existe');
      return;
    }
    await execute(`
      ALTER TABLE order_items ADD COLUMN sell_as_pack TINYINT NOT NULL DEFAULT 0
    `);
    console.log('✓ Columna order_items.sell_as_pack agregada (1 = cantidad en packs, 0 = en unidades)');
  } catch (e: any) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('✓ order_items.sell_as_pack ya existe');
    } else {
      throw e;
    }
  }
};
