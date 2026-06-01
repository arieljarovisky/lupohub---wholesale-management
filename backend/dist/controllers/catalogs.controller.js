"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCatalog = exports.getCatalogFile = exports.createCatalogWithUrl = exports.uploadCatalog = exports.listCatalogs = exports.uploadCatalogMiddleware = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const multer_1 = __importDefault(require("multer"));
/** Raíz de archivos subidos. En Railway/usar volumen: setear UPLOADS_ROOT al path del volumen (ej. /data) para que los archivos persistan entre deploys. */
const UPLOADS_ROOT = process.env.UPLOADS_ROOT || process.cwd();
const UPLOAD_DIR = path.join(UPLOADS_ROOT, 'uploads', 'catalogs');
function ensureUploadDir() {
    const dir = path.join(UPLOADS_ROOT, 'uploads');
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(UPLOAD_DIR))
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
ensureUploadDir();
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        ensureUploadDir();
        cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.pdf';
        cb(null, `${(0, uuid_1.v4)()}${ext}`);
    }
});
const ALLOWED_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
exports.uploadCatalogMiddleware = (0, multer_1.default)({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }
}).single('file');
/** GET /api/catalogs - Listar catálogos. Cualquier usuario autenticado (ADMIN, SELLER, CUSTOMER). */
const listCatalogs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = yield (0, db_1.query)(`
      SELECT id, name, file_name, file_path, mime_type, created_at
      FROM catalogs
      ORDER BY created_at DESC
    `);
        res.json((rows || []).map((r) => {
            const filePath = (r.file_path || '').toString();
            const isUrl = filePath.startsWith('url:');
            const out = {
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
    }
    catch (e) {
        console.error('Error listing catalogs:', e);
        res.status(500).json({ message: 'Error listando catálogos' });
    }
});
exports.listCatalogs = listCatalogs;
/** POST /api/catalogs/upload - Subir archivo (ADMIN). Multipart con campo "file" y opcional "name" */
const uploadCatalog = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if ((user === null || user === void 0 ? void 0 : user.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden subir catálogos' });
        }
        const file = req.file;
        if (!file || !file.path) {
            return res.status(400).json({ message: 'No se recibió ningún archivo. Usá el campo "file".' });
        }
        const mime = (file.mimetype || '').toLowerCase();
        if (!ALLOWED_MIMES.includes(mime)) {
            try {
                fs.unlinkSync(file.path);
            }
            catch (_) { }
            return res.status(400).json({ message: 'Solo se permiten PDF o imágenes (JPEG, PNG, WebP).' });
        }
        const name = (req.body && req.body.name) ? String(req.body.name).trim() : file.originalname || 'Catálogo';
        const id = path.basename(file.path, path.extname(file.path));
        const relativePath = path.relative(UPLOADS_ROOT, file.path).replace(/\\/g, '/');
        yield (0, db_1.execute)(`INSERT INTO catalogs (id, name, file_path, file_name, mime_type) VALUES (?, ?, ?, ?, ?)`, [id, name, relativePath, file.originalname || file.filename || 'catalog', file.mimetype || 'application/pdf']);
        const row = yield (0, db_1.get)('SELECT id, name, file_name, mime_type, created_at FROM catalogs WHERE id = ?', [id]);
        res.status(201).json({
            id: row.id,
            name: row.name,
            fileName: row.file_name,
            mimeType: row.mime_type,
            createdAt: row.created_at
        });
    }
    catch (e) {
        console.error('Error uploading catalog:', e);
        res.status(500).json({ message: e.message || 'Error subiendo catálogo' });
    }
});
exports.uploadCatalog = uploadCatalog;
/** POST /api/catalogs - Crear catálogo con URL (ADMIN). Body: { name, url } */
const createCatalogWithUrl = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if ((user === null || user === void 0 ? void 0 : user.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden subir catálogos' });
        }
        const { name, url } = req.body || {};
        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ message: 'Falta el nombre del catálogo' });
        }
        if (!url || typeof url !== 'string' || !url.trim()) {
            return res.status(400).json({ message: 'Falta la URL del catálogo' });
        }
        const id = (0, uuid_1.v4)();
        const fileName = (name.trim().replace(/[^a-zA-Z0-9-_]/g, '_') || 'catalog') + '.url';
        const filePath = `url:${url.trim()}`;
        yield (0, db_1.execute)(`INSERT INTO catalogs (id, name, file_path, file_name, mime_type) VALUES (?, ?, ?, ?, ?)`, [id, name.trim(), filePath, fileName, 'application/pdf']);
        const row = yield (0, db_1.get)('SELECT id, name, file_name, mime_type, created_at FROM catalogs WHERE id = ?', [id]);
        res.status(201).json({
            id: row.id,
            name: row.name,
            fileName: row.file_name,
            mimeType: row.mime_type,
            createdAt: row.created_at,
            url: url.trim()
        });
    }
    catch (e) {
        console.error('Error creating catalog:', e);
        res.status(500).json({ message: 'Error creando catálogo' });
    }
});
exports.createCatalogWithUrl = createCatalogWithUrl;
/** GET /api/catalogs/:id/file - Ver/descargar archivo (o redirigir si es URL). Cualquier usuario autenticado. */
const getCatalogFile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const row = yield (0, db_1.get)('SELECT id, name, file_path, file_name, mime_type FROM catalogs WHERE id = ?', [id]);
        if (!row)
            return res.status(404).json({ message: 'Catálogo no encontrado' });
        const filePath = row.file_path;
        if (filePath.startsWith('url:')) {
            const url = filePath.slice(4);
            return res.redirect(302, url);
        }
        const fullPath = path.join(UPLOADS_ROOT, filePath);
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({
                message: 'El archivo no está disponible en el servidor. Puede que el catálogo se haya subido en otro entorno o el archivo ya no exista (p. ej. tras un redespliegue).',
                code: 'FILE_NOT_FOUND'
            });
        }
        const mime = row.mime_type || 'application/pdf';
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.file_name || 'catalog')}"`);
        fs.createReadStream(fullPath).pipe(res);
    }
    catch (e) {
        console.error('Error serving catalog file:', e);
        res.status(500).json({ message: 'Error obteniendo archivo' });
    }
});
exports.getCatalogFile = getCatalogFile;
/** DELETE /api/catalogs/:id - Eliminar catálogo (ADMIN) */
const deleteCatalog = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if ((user === null || user === void 0 ? void 0 : user.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden eliminar catálogos' });
        }
        const { id } = req.params;
        const row = yield (0, db_1.get)('SELECT id, file_path FROM catalogs WHERE id = ?', [id]);
        if (!row)
            return res.status(404).json({ message: 'Catálogo no encontrado' });
        const filePath = row.file_path || '';
        if (!filePath.startsWith('url:') && filePath) {
            const fullPath = path.join(UPLOADS_ROOT, filePath);
            if (fs.existsSync(fullPath))
                fs.unlinkSync(fullPath);
        }
        yield (0, db_1.execute)('DELETE FROM catalogs WHERE id = ?', [id]);
        res.json({ id });
    }
    catch (e) {
        console.error('Error deleting catalog:', e);
        res.status(500).json({ message: 'Error eliminando catálogo' });
    }
});
exports.deleteCatalog = deleteCatalog;
