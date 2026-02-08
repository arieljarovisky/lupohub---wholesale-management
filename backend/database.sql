-- Script de Creación de Base de Datos para LupoHub
-- Ejecutar en MySQL Workbench, phpMyAdmin o línea de comandos

CREATE DATABASE IF NOT EXISTS lupohub;
USE lupohub;

-- 1. Tabla de Usuarios (Admin, Vendedores, Depósito)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL, -- 'ADMIN', 'SELLER', 'WAREHOUSE'
  commission_percentage DECIMAL(5,2) DEFAULT 0
);

-- 2. Tabla de Clientes
CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(36) PRIMARY KEY,
  seller_id VARCHAR(36),
  name VARCHAR(255) NOT NULL,
  business_name VARCHAR(255),
  email VARCHAR(255),
  address VARCHAR(255),
  city VARCHAR(100),
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 3. Tabla de Productos
CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(36) PRIMARY KEY,
  sku VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  size VARCHAR(50),
  color VARCHAR(50),
  stock INT DEFAULT 0,
  price DECIMAL(10, 2) NOT NULL,
  description TEXT,
  integrations_json TEXT -- JSON almacenado como texto para configuraciones de API
);

-- 4. Tabla de Atributos (Talles y Colores dinámicos)
CREATE TABLE IF NOT EXISTS attributes (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(50) NOT NULL, -- 'size', 'color'
  name VARCHAR(100) NOT NULL,
  value VARCHAR(100) -- Hex code para colores
);

-- 5. Tabla de Pedidos
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(36) PRIMARY KEY,
  customer_id VARCHAR(36) NOT NULL,
  seller_id VARCHAR(36) NOT NULL,
  date DATE NOT NULL,
  status VARCHAR(50) NOT NULL, -- 'Borrador', 'Confirmado', 'Preparación', 'Despachado'
  total DECIMAL(10, 2) NOT NULL,
  picked_by VARCHAR(36),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (seller_id) REFERENCES users(id)
);

-- 6. Items del Pedido (Detalle)
CREATE TABLE IF NOT EXISTS order_items (
  id VARCHAR(36) PRIMARY KEY,
  order_id VARCHAR(36) NOT NULL,
  product_id VARCHAR(36) NOT NULL,
  quantity INT NOT NULL,
  picked INT DEFAULT 0, -- Cantidad ya pickeada por depósito
  price_at_moment DECIMAL(10, 2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- 7. Tabla de Visitas
CREATE TABLE IF NOT EXISTS visits (
  id VARCHAR(36) PRIMARY KEY,
  seller_id VARCHAR(36) NOT NULL,
  customer_id VARCHAR(36) NOT NULL,
  date DATE NOT NULL,
  notes TEXT,
  outcome VARCHAR(50), -- 'Sale', 'No Sale', 'Follow Up'
  FOREIGN KEY (seller_id) REFERENCES users(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- --- DATOS INICIALES (SEED DATA) ---

-- Usuarios (Password '123' para todos)
INSERT INTO users (id, name, email, password, role) VALUES 
('u1', 'Martin Director', 'admin@lupo.ar', '123', 'ADMIN'),
('u2', 'Laura Vendedora', 'laura@lupo.ar', '123', 'SELLER'),
('u3', 'Carlos Deposito', 'carlos@lupo.ar', '123', 'WAREHOUSE');

-- Clientes
INSERT INTO customers (id, seller_id, name, business_name, email, address, city) VALUES 
('c1', 'u2', 'Juan Perez', 'Lenceria Perez SRL', 'juan@perez.com', 'Av. Corrientes 1234', 'CABA');

-- Productos
INSERT INTO products (id, sku, name, category, size, color, stock, price, integrations_json) VALUES 
('p1', 'LP-1001-M-BK', 'Boxer Microfibra Seamless', 'Underwear', 'M', 'Negro', 120, 4500.00, '{"tiendaNube": true}'),
('p2', 'LP-1001-L-BK', 'Boxer Microfibra Seamless', 'Underwear', 'L', 'Negro', 45, 4500.00, '{"tiendaNube": true}');

-- Pedidos
INSERT INTO orders (id, customer_id, seller_id, date, status, total) VALUES 
('o101', 'c1', 'u2', '2023-10-25', 'Confirmado', 45000.00);

-- Items del Pedido (Usamos UUID() nativo de MySQL o un string fijo si prefieres)
INSERT INTO order_items (id, order_id, product_id, quantity, price_at_moment) VALUES 
(UUID(), 'o101', 'p1', 10, 4500.00);
