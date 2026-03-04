import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

function getPoolConfig(): mysql.PoolOptions {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      console.log('[DB] Using MYSQL_URL/DATABASE_URL (host:', parsed.hostname + ')');
      return {
        host: parsed.hostname,
        user: parsed.username,
        password: parsed.password,
        database: parsed.pathname.replace(/^\//, '') || 'lupohub',
        port: parsed.port ? Number(parsed.port) : 3306,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      };
    } catch (e) {
      console.warn('[DB] Invalid MYSQL_URL/DATABASE_URL, using individual vars:', (e as Error).message);
    }
  }
  console.log('[DB] Using DB_HOST (host:', process.env.DB_HOST || 'localhost', ')');
  return {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'lupohub',
    port: Number(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
}

const pool = mysql.createPool(getPoolConfig());

// Wrapper para consultas que retornan filas (SELECT)
export const query = async (sql: string, params: any[] = []): Promise<any[]> => {
  try {
    const [rows] = await pool.query(sql, params);
    return rows as any[];
  } catch (error) {
    console.error(`Error executing query: ${sql}`, error);
    throw error;
  }
};

// Wrapper para ejecuciones que modifican datos (INSERT, UPDATE, DELETE)
export const execute = async (sql: string, params: any[] = []): Promise<void> => {
  try {
    await pool.execute(sql, params);
  } catch (error) {
    console.error(`Error executing command: ${sql}`, error);
    throw error;
  }
};

// Wrapper para obtener un solo registro
export const get = async (sql: string, params: any[] = []): Promise<any> => {
  try {
    const [rows] = await pool.query(sql, params);
    const result = rows as any[];
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error(`Error executing get: ${sql}`, error);
    throw error;
  }
};

/** Prueba la conexión; lanza si falla (ej. ECONNREFUSED). */
export const testConnection = async (): Promise<void> => {
  const [rows] = await pool.query('SELECT 1 AS ok');
  if (!rows || (rows as any[])[0]?.ok !== 1) throw new Error('DB check failed');
};

export default pool;