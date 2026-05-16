"use strict";
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
exports.downloadTiendaNubeCategoryImagesZip = exports.listTiendaNubeCategoryMatches = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const archiver_1 = __importDefault(require("archiver"));
const tiendanubeCategoryImages_service_1 = require("../services/tiendanubeCategoryImages.service");
/** GET ?category=ropa%20deportiva — lista categorías que coinciden (sin descargar). */
const listTiendaNubeCategoryMatches = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const query = String(req.query.category || 'ropa deportiva').trim();
        const { accessToken, storeId } = yield (0, tiendanubeCategoryImages_service_1.getTiendaNubeIntegration)();
        const all = yield (0, tiendanubeCategoryImages_service_1.fetchAllTnCategories)(storeId, accessToken);
        const { ids, names } = (0, tiendanubeCategoryImages_service_1.resolveCategoryIds)(all, query);
        const matches = all
            .filter((c) => ids.includes(c.id))
            .map((c) => ({
            id: c.id,
            name: c.name && typeof c.name === 'object'
                ? c.name.es || c.name.en || Object.values(c.name)[0]
                : c.name,
            parent: c.parent,
        }));
        res.json({ query, categoryIds: ids, categoryNames: names, matches });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.status(500).json({ message: msg });
    }
});
exports.listTiendaNubeCategoryMatches = listTiendaNubeCategoryMatches;
/** GET ?category=ropa%20deportiva — descarga imágenes y devuelve ZIP. */
const downloadTiendaNubeCategoryImagesZip = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const tmpDir = path_1.default.join(os_1.default.tmpdir(), `lupohub-tn-images-${Date.now()}`);
    try {
        const categoryQuery = String(req.query.category || 'ropa deportiva').trim();
        const categoryIdRaw = req.query.categoryId || req.query.category_id;
        const categoryId = categoryIdRaw ? parseInt(String(categoryIdRaw), 10) : undefined;
        const result = yield (0, tiendanubeCategoryImages_service_1.downloadCategoryImages)({
            categoryQuery,
            categoryId: Number.isFinite(categoryId) ? categoryId : undefined,
            outputDir: tmpDir,
            includeSubcategories: true,
        });
        if (result.imageCount === 0) {
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
            return res.status(404).json(Object.assign({ message: 'No hay imágenes en los productos de esa categoría' }, result));
        }
        const slug = categoryQuery
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 60);
        const filename = `tiendanube-${slug || 'categoria'}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Download-Stats', JSON.stringify({
            products: result.productCount,
            images: result.imageCount,
            downloaded: result.downloaded,
        }));
        const archive = (0, archiver_1.default)('zip', { zlib: { level: 6 } });
        archive.on('error', (err) => {
            throw err;
        });
        archive.pipe(res);
        archive.directory(tmpDir, false);
        yield archive.finalize();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[downloadTiendaNubeCategoryImagesZip]', msg);
        if (!res.headersSent) {
            res.status(500).json({ message: msg });
        }
    }
    finally {
        try {
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch (_a) {
            /* ignore */
        }
    }
});
exports.downloadTiendaNubeCategoryImagesZip = downloadTiendaNubeCategoryImagesZip;
