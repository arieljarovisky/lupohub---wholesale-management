import { execute, get } from './db';

export const addStockMovementsTable = async () => {
  console.log('Verificando tabla stock_movements...');
  
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id VARCHAR(36) PRIMARY KEY,
        variant_id VARCHAR(36) NOT NULL,
        previous_stock INT NOT NULL DEFAULT 0,
        new_stock INT NOT NULL DEFAULT 0,
        quantity_change INT NOT NULL DEFAULT 0,
        movement_type VARCHAR(50) NOT NULL,
        reference VARCHAR(255),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_variant_id (variant_id),
        INDEX idx_movement_type (movement_type),
        INDEX idx_created_at (created_at),
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
      )
    `);
    console.log('✓ Tabla stock_movements creada/verificada');
  } catch (error: any) {
    if (error.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log('✓ Tabla stock_movements ya existe');
    } else {
      console.error('Error creando tabla stock_movements:', error.message);
    }
  }
};
