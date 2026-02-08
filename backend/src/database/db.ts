import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'lupohub',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

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

export default pool;