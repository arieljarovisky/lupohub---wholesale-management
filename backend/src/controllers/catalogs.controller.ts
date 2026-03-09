import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'catalogs');

function ensureUploadDir() {
  const dir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

ensureUploadDir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDir();
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `${uuidv4()}${ext}`);
  }
});
const ALLOWED_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const uploadCatalogMiddleware = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
}).single('file');

/** GET /api/catalogs - Listar catálogos (ADMIN, SELLER, CUSTOMER) */
export const listCatalogs = async (req: Request, res: Response) => {
  try {
    const rows = await query(`
      SELECT id, name, file_name, file_path, mime_type, created_at
      FROM catalogs
      ORDER BY created_at DESC
    `);
    res.json((rows || []).map((r: any) => {
      const filePath = (r.file_path || '').toString();
      const isUrl = filePath.startsWith('url:');
      const out: any = {
        id: r.id,
        name: r.name,
        fileName: r.file_name,
        mimeType: r.mime_type || 'application/pdf',
        createdAt: r.created_at
      };
      if (isUrl) {
        out.isUrl = true;
        out.url = filePath.slice(4);
      }
      return out;
    }));
  } catch (e: any) {
    console.error('Error listing catalogs:', e);
    res.status(500).json({ message: 'Error listando catálogos' });
  }
};

/** POST /api/catalogs/upload - Subir archivo (ADMIN). Multipart con campo "file" y opcional "name" */
export const uploadCatalog = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden subir catálogos' });
    }
    const file = (req as any).file;
    if (!file || !file.path) {
      return res.status(400).json({ message: 'No se recibió ningún archivo. Usá el campo "file".' });
    }
    const mime = (file.mimetype || '').toLowerCase();
    if (!ALLOWED_MIMES.includes(mime)) {
      try { fs.unlinkSync(file.path); } catch (_) {}
      return res.status(400).json({ message: 'Solo se permiten PDF o imágenes (JPEG, PNG, WebP).' });
    }
    const name = (req.body && (req as any).body.name) ? String((req as any).body.name).trim() : file.originalname || 'Catálogo';
    const id = path.basename(file.path, path.extname(file.path));
    const relativePath = path.relative(process.cwd(), file.path).replace(/\\/g, '/');
    await execute(
      `INSERT INTO catalogs (id, name, file_path, file_name, mime_type) VALUES (?, ?, ?, ?, ?)`,
      [id, name, relativePath, file.originalname || file.filename || 'catalog', file.mimetype || 'application/pdf']
    );
    const row = await get('SELECT id, name, file_name, mime_type, created_at FROM catalogs WHERE id = ?', [id]);
    res.status(201).json({
      id: row.id,
      name: row.name,
      fileName: row.file_name,
      mimeType: row.mime_type,
      createdAt: row.created_at
    });
  } catch (e: any) {
    console.error('Error uploading catalog:', e);
    res.status(500).json({ message: e.message || 'Error subiendo catálogo' });
  }
};

/** POST /api/catalogs - Crear catálogo con URL (ADMIN). Body: { name, url } */
export const createCatalogWithUrl = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden subir catálogos' });
    }
    const { name, url } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Falta el nombre del catálogo' });
    }
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ message: 'Falta la URL del catálogo' });
    }
    const id = uuidv4();
    const fileName = (name.trim().replace(/[^a-zA-Z0-9-_]/g, '_') || 'catalog') + '.url';
    const filePath = `url:${url.trim()}`;
    await execute(
      `INSERT INTO catalogs (id, name, file_path, file_name, mime_type) VALUES (?, ?, ?, ?, ?)`,
      [id, name.trim(), filePath, fileName, 'application/pdf']
    );
    const row = await get('SELECT id, name, file_name, mime_type, created_at FROM catalogs WHERE id = ?', [id]);
    res.status(201).json({
      id: row.id,
      name: row.name,
      fileName: row.file_name,
      mimeType: row.mime_type,
      createdAt: row.created_at,
      url: url.trim()
    });
  } catch (e: any) {
    console.error('Error creating catalog:', e);
    res.status(500).json({ message: 'Error creando catálogo' });
  }
};

/** GET /api/catalogs/:id/file - Ver/descargar archivo (o redirigir si es URL) */
export const getCatalogFile = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const row = await get('SELECT id, name, file_path, file_name, mime_type FROM catalogs WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ message: 'Catálogo no encontrado' });
    const filePath = row.file_path as string;
    if (filePath.startsWith('url:')) {
      const url = filePath.slice(4);
      return res.redirect(302, url);
    }
    const fullPath = path.join(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ message: 'Archivo no encontrado' });
    const mime = row.mime_type || 'application/pdf';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.file_name || 'catalog')}"`);
    fs.createReadStream(fullPath).pipe(res);
  } catch (e: any) {
    console.error('Error serving catalog file:', e);
    res.status(500).json({ message: 'Error obteniendo archivo' });
  }
};

/** DELETE /api/catalogs/:id - Eliminar catálogo (ADMIN) */
export const deleteCatalog = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden eliminar catálogos' });
    }
    const { id } = req.params;
    const row = await get('SELECT id, file_path FROM catalogs WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ message: 'Catálogo no encontrado' });
    const filePath = (row.file_path as string) || '';
    if (!filePath.startsWith('url:') && filePath) {
      const fullPath = path.join(process.cwd(), filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    await execute('DELETE FROM catalogs WHERE id = ?', [id]);
    res.json({ id });
  } catch (e: any) {
    console.error('Error deleting catalog:', e);
    res.status(500).json({ message: 'Error eliminando catálogo' });
  }
};
