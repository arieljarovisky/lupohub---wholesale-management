import { execute, query } from './db';

export const addDespachosTable = async () => {
  console.log('Creando tablas de despachos de importación...');
  
  try {
    // Tabla principal de despachos
    await execute(`
      CREATE TABLE IF NOT EXISTS despachos (
        id VARCHAR(36) PRIMARY KEY,
        numero_despacho VARCHAR(100) NOT NULL UNIQUE,
        fecha_despacho DATE NOT NULL,
        pais_origen VARCHAR(100) NOT NULL DEFAULT 'Brasil',
        proveedor VARCHAR(255),
        descripcion TEXT,
        valor_fob DECIMAL(12, 2),
        valor_cif DECIMAL(12, 2),
        moneda VARCHAR(10) DEFAULT 'USD',
        estado ENUM('en_transito', 'en_aduana', 'despachado', 'entregado') DEFAULT 'despachado',
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_numero_despacho (numero_despacho),
        INDEX idx_fecha_despacho (fecha_despacho),
        INDEX idx_estado (estado)
      )
    `);
    console.log('✓ Tabla despachos creada');

    // Tabla de relación despacho-productos (qué productos vinieron en cada despacho)
    await execute(`
      CREATE TABLE IF NOT EXISTS despacho_items (
        id VARCHAR(36) PRIMARY KEY,
        despacho_id VARCHAR(36) NOT NULL,
        product_id VARCHAR(36),
        variant_id VARCHAR(36),
        cantidad INT NOT NULL DEFAULT 0,
        costo_unitario DECIMAL(10, 2),
        descripcion_item VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (despacho_id) REFERENCES despachos(id) ON DELETE CASCADE,
        INDEX idx_despacho_id (despacho_id),
        INDEX idx_product_id (product_id),
        INDEX idx_variant_id (variant_id)
      )
    `);
    console.log('✓ Tabla despacho_items creada');

    // Agregar campo despacho_id a la tabla de productos (opcional, para referencia rápida al último despacho)
    const colUltimo = await query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'ultimo_despacho_id'`
    );
    if (colUltimo.length === 0) {
      await execute(`ALTER TABLE products ADD COLUMN ultimo_despacho_id VARCHAR(36)`);
      console.log('✓ Campo ultimo_despacho_id agregado a products');
    } else {
      console.log('✓ Campo ultimo_despacho_id ya existe en products');
    }

    // Agregar campo pais_origen a productos
    const colPais = await query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'pais_origen'`
    );
    if (colPais.length === 0) {
      await execute(`ALTER TABLE products ADD COLUMN pais_origen VARCHAR(100) DEFAULT 'Brasil'`);
      console.log('✓ Campo pais_origen agregado a products');
    } else {
      console.log('✓ Campo pais_origen ya existe en products');
    }

    console.log('✓ Tablas de despachos configuradas correctamente');
  } catch (error: any) {
    console.error('Error creando tablas de despachos:', error.message);
    throw error;
  }
};
