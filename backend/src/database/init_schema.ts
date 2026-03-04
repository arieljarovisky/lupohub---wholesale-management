/**
 * Crea todas las tablas base necesarias para la app (DB vacía, ej. Railway).
 * Se ejecuta al arranque antes de las migraciones add_*.
 */
import { execute } from './db';

export async function initSchema(): Promise<void> {
  console.log('[DB] Verificando/creando esquema base...');

  // 1. users
  await execute(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL,
      commission_percentage DECIMAL(5,2) DEFAULT 0
    )
  `);

  // 2. customers
  await execute(`
    CREATE TABLE IF NOT EXISTS customers (
      id VARCHAR(36) PRIMARY KEY,
      seller_id VARCHAR(36),
      name VARCHAR(255) NOT NULL,
      business_name VARCHAR(255),
      email VARCHAR(255),
      address VARCHAR(255),
      city VARCHAR(100),
      FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // 3. colors
  await execute(`
    CREATE TABLE IF NOT EXISTS colors (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255),
      code VARCHAR(100),
      hex VARCHAR(20) DEFAULT '#000000'
    )
  `);

  // 4. sizes
  await execute(`
    CREATE TABLE IF NOT EXISTS sizes (
      id VARCHAR(36) PRIMARY KEY,
      size_code VARCHAR(100) NOT NULL,
      name VARCHAR(100) NULL
    )
  `);

  // 5. products (esquema actual: base_price, sin size/color en la fila)
  await execute(`
    CREATE TABLE IF NOT EXISTS products (
      id VARCHAR(36) PRIMARY KEY,
      sku VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100),
      base_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
      description TEXT,
      tienda_nube_id VARCHAR(100) NULL,
      mercado_libre_id VARCHAR(100) NULL
    )
  `);

  // 6. product_colors
  await execute(`
    CREATE TABLE IF NOT EXISTS product_colors (
      id VARCHAR(36) PRIMARY KEY,
      product_id VARCHAR(36) NOT NULL,
      color_id VARCHAR(36) NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (color_id) REFERENCES colors(id) ON DELETE CASCADE
    )
  `);

  // 7. product_variants
  await execute(`
    CREATE TABLE IF NOT EXISTS product_variants (
      id VARCHAR(36) PRIMARY KEY,
      product_color_id VARCHAR(36) NOT NULL,
      size_id VARCHAR(36) NOT NULL,
      tienda_nube_variant_id VARCHAR(100) NULL,
      mercado_libre_variant_id VARCHAR(100) NULL,
      sku VARCHAR(100) NULL,
      FOREIGN KEY (product_color_id) REFERENCES product_colors(id) ON DELETE CASCADE,
      FOREIGN KEY (size_id) REFERENCES sizes(id) ON DELETE CASCADE
    )
  `);

  // 8. stocks
  await execute(`
    CREATE TABLE IF NOT EXISTS stocks (
      variant_id VARCHAR(36) PRIMARY KEY,
      stock INT NOT NULL DEFAULT 0,
      FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
    )
  `);

  // 9. orders
  await execute(`
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(36) PRIMARY KEY,
      customer_id VARCHAR(36) NOT NULL,
      seller_id VARCHAR(36) NOT NULL,
      date DATE NOT NULL,
      status VARCHAR(50) NOT NULL,
      total DECIMAL(10, 2) NOT NULL,
      picked_by VARCHAR(36) NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (seller_id) REFERENCES users(id)
    )
  `);

  // 10. order_items (por variant_id, no product_id)
  await execute(`
    CREATE TABLE IF NOT EXISTS order_items (
      id VARCHAR(36) PRIMARY KEY,
      order_id VARCHAR(36) NOT NULL,
      variant_id VARCHAR(36) NOT NULL,
      quantity INT NOT NULL,
      picked INT DEFAULT 0,
      price_at_moment DECIMAL(10, 2) NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
    )
  `);

  // 11. integrations (con store_id desde el inicio)
  await execute(`
    CREATE TABLE IF NOT EXISTS integrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      platform VARCHAR(50) NOT NULL UNIQUE,
      access_token TEXT,
      refresh_token TEXT,
      expires_at TIMESTAMP NULL,
      user_id VARCHAR(100) NULL,
      store_id VARCHAR(100) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // 12. visits (opcional)
  await execute(`
    CREATE TABLE IF NOT EXISTS visits (
      id VARCHAR(36) PRIMARY KEY,
      seller_id VARCHAR(36) NOT NULL,
      customer_id VARCHAR(36) NOT NULL,
      date DATE NOT NULL,
      notes TEXT,
      outcome VARCHAR(50),
      FOREIGN KEY (seller_id) REFERENCES users(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);

  console.log('[DB] Esquema base listo');
}
