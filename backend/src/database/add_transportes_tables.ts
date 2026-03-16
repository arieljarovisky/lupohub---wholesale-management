import { execute, get } from './db';

/** Crea tablas de transportes (express) y asignación a clientes. */
export async function addTransportesTables(): Promise<void> {
  console.log('[DB] Verificando tablas transportes...');
  try {
    const t = await get(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transportes'`
    );
    if (!t) {
      await execute(`
        CREATE TABLE transportes (
          id VARCHAR(36) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          address VARCHAR(500) NULL
        )
      `);
      console.log('[DB] Tabla transportes creada');
    } else {
      const col = await get(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transportes' AND COLUMN_NAME = 'address'`
      );
      if (!col) {
        await execute(`ALTER TABLE transportes ADD COLUMN address VARCHAR(500) NULL AFTER name`);
        console.log('[DB] Columna transportes.address agregada');
      }
    }

    const ct = await get(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_transportes'`
    );
    if (!ct) {
      await execute(`
        CREATE TABLE customer_transportes (
          customer_id VARCHAR(36) NOT NULL,
          transporte_id VARCHAR(36) NOT NULL,
          PRIMARY KEY (customer_id, transporte_id),
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
          FOREIGN KEY (transporte_id) REFERENCES transportes(id) ON DELETE CASCADE
        )
      `);
      console.log('[DB] Tabla customer_transportes creada');
    } else {
      console.log('[DB] Tabla customer_transportes ya existe');
    }
  } catch (e: any) {
    console.error('[DB] Error creando tablas transportes:', e?.message);
  }
}
