import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';

/** Raíz de archivos subidos (igual que catálogos). Usar UPLOADS_ROOT en producción para persistir. */
const UPLOADS_ROOT = process.env.UPLOADS_ROOT || process.cwd();
const IMAGES_DIR = path.join(UPLOADS_ROOT, 'uploads', 'catalog-images');

function ensureDir() {
  const base = path.join(UPLOADS_ROOT, 'uploads');
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
}
ensureDir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDir();
    cb(null, IMAGES_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

export const uploadCatalogImageMiddleware = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
}).single('file');

/** POST /api/catalog-images — sube una imagen (solo ADMIN). Devuelve { path } público. */
export const uploadCatalogImage = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden subir imágenes' });
    }
    const file = (req as any).file;
    if (!file || !file.path) {
      return res.status(400).json({ message: 'No se recibió ninguna imagen. Usá el campo "file".' });
    }
    const mime = (file.mimetype || '').toLowerCase();
    if (!ALLOWED_MIMES.includes(mime)) {
      try { fs.unlinkSync(file.path); } catch (_) {}
      return res.status(400).json({ message: 'Solo se permiten imágenes (JPG, PNG, WebP, GIF, AVIF).' });
    }
    const fileName = path.basename(file.path);
    res.status(201).json({ file: fileName, path: `/catalog-images/${fileName}` });
  } catch (e: any) {
    console.error('[uploadCatalogImage]', e?.message || e);
    res.status(500).json({ message: e?.message || 'Error subiendo la imagen' });
  }
};

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

/** GET /api/catalog-images/:file — sirve la imagen (público, sin auth, para usar en <img>). */
export const serveCatalogImage = async (req: Request, res: Response) => {
  try {
    const name = path.basename(String(req.params.file || ''));
    if (!name || name.includes('..')) {
      return res.status(400).json({ message: 'Nombre inválido' });
    }
    const full = path.join(IMAGES_DIR, name);
    if (!fs.existsSync(full)) {
      return res.status(404).json({ message: 'Imagen no encontrada' });
    }
    const ext = path.extname(name).toLowerCase();
    res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    fs.createReadStream(full).pipe(res);
  } catch (e: any) {
    console.error('[serveCatalogImage]', e?.message || e);
    res.status(500).json({ message: 'Error sirviendo la imagen' });
  }
};
