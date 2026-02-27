import { execute, get } from './db';

export const fixIntegrationsTable = async () => {
  console.log('Verificando columna store_id en integrations...');
  
  try {
    // Verificar si la columna existe
    const column = await get(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'integrations' 
        AND COLUMN_NAME = 'store_id'
    `);
    
    if (!column) {
      console.log('Agregando columna store_id...');
      await execute(`ALTER TABLE integrations ADD COLUMN store_id VARCHAR(100) NULL`);
      console.log('✓ Columna store_id agregada');
    } else {
      console.log('✓ Columna store_id ya existe');
    }
  } catch (error: any) {
    console.error('Error verificando/agregando store_id:', error.message);
  }
};
