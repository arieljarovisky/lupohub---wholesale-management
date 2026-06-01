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
exports.getTiendaNubeIntegration = getTiendaNubeIntegration;
exports.fetchAllTnCategories = fetchAllTnCategories;
exports.resolveCategoryIds = resolveCategoryIds;
exports.fetchProductsForCategories = fetchProductsForCategories;
exports.downloadCategoryImages = downloadCategoryImages;
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const fs_2 = require("fs");
const promises_1 = require("stream/promises");
const db_1 = require("../database/db");
const channelMarginFetch_1 = require("../utils/channelMarginFetch");
const channelMarginFetch_2 = require("../utils/channelMarginFetch");
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const TN_BASE = 'https://api.tiendanube.com/v1';
function logFn(opts) {
    return (msg) => {
        var _a;
        (_a = opts.onLog) === null || _a === void 0 ? void 0 : _a.call(opts, msg);
        console.log(msg);
    };
}
function normalize(s) {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}
function categoryLabel(c) {
    if (c.name && typeof c.name === 'object') {
        return String(c.name.es || c.name.en || c.name.pt || Object.values(c.name)[0] || c.id);
    }
    return String(c.name || c.id);
}
function productLabel(p) {
    if (p.name && typeof p.name === 'object') {
        return String(p.name.es || p.name.en || p.name.pt || Object.values(p.name)[0] || p.id);
    }
    return String(p.name || p.id);
}
function productSlug(p) {
    const h = p.handle;
    const handle = h && typeof h === 'object' ? String(h.es || h.en || h.pt || Object.values(h)[0] || '') : '';
    const base = handle || productLabel(p);
    return base
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || `producto-${p.id}`;
}
/** Carpeta por artículo dentro del ZIP (nombre legible + ID TN único). */
function productFolderName(p) {
    const label = productLabel(p);
    const slug = productSlug(p);
    const safeLabel = label
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
    const base = safeLabel || slug || `producto-${p.id}`;
    return `${base}__${p.id}`.slice(0, 120);
}
function extFromUrl(url) {
    try {
        const p = new URL(url).pathname;
        const m = p.match(/\.(jpe?g|png|gif|webp|avif)$/i);
        if (m)
            return m[1].toLowerCase().replace('jpeg', 'jpg');
    }
    catch (_a) {
        /* ignore */
    }
    return 'jpg';
}
function getTiendaNubeIntegration() {
    return __awaiter(this, void 0, void 0, function* () {
        const envToken = (process.env.TN_ACCESS_TOKEN || process.env.TIENDA_NUBE_ACCESS_TOKEN || '').trim();
        const envStore = (process.env.TN_STORE_ID || process.env.TIENDA_NUBE_STORE_ID || '').trim();
        if (envToken && envStore) {
            return { accessToken: envToken, storeId: envStore };
        }
        const row = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        const storeId = (0, channelMarginFetch_1.resolveTnStoreId)(row);
        if (!(row === null || row === void 0 ? void 0 : row.access_token) || !storeId) {
            throw new Error('No hay integración activa con Tienda Nube. Conectala desde Configuración o definí TN_STORE_ID y TN_ACCESS_TOKEN en .env');
        }
        return { accessToken: String(row.access_token), storeId };
    });
}
function fetchAllTnCategories(storeId, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        const headers = {
            Authentication: `bearer ${accessToken}`,
            'User-Agent': TN_USER_AGENT,
        };
        const all = [];
        let page = 1;
        while (page <= 300) {
            const res = yield axios_1.default.get(`${TN_BASE}/${storeId}/categories`, {
                headers,
                params: { page, per_page: 200 },
                validateStatus: () => true,
            });
            if (res.status !== 200) {
                throw new Error(`Error listando categorías TN (${res.status})`);
            }
            const chunk = Array.isArray(res.data) ? res.data : [];
            all.push(...chunk);
            if (chunk.length < 200)
                break;
            page++;
        }
        return all;
    });
}
function resolveCategoryIds(allCategories, query, explicitId, includeSubcategories = true) {
    if (explicitId != null && Number.isFinite(explicitId)) {
        const cat = allCategories.find((c) => c.id === explicitId);
        const ids = new Set([explicitId]);
        if (includeSubcategories && cat)
            collectDescendants(cat, allCategories, ids);
        return {
            ids: Array.from(ids),
            names: [cat ? categoryLabel(cat) : `ID ${explicitId}`],
        };
    }
    const q = normalize(query);
    const qHandle = q.replace(/\s+/g, '-');
    const ids = new Set();
    const names = [];
    const byId = new Map(allCategories.map((c) => [c.id, c]));
    for (const c of allCategories) {
        const namesList = [];
        if (c.name && typeof c.name === 'object') {
            namesList.push(...Object.values(c.name).map(String));
        }
        else if (c.name)
            namesList.push(String(c.name));
        const handles = c.handle ? Object.values(c.handle).map(String) : [];
        const match = namesList.some((n) => normalize(n).includes(q) || normalize(n) === q) ||
            handles.some((h) => normalize(h).includes(qHandle) || normalize(h) === qHandle);
        if (match) {
            names.push(categoryLabel(c));
            ids.add(c.id);
            if (includeSubcategories)
                collectDescendants(c, allCategories, ids);
        }
    }
    return { ids: Array.from(ids), names };
}
function collectDescendants(cat, all, out) {
    for (const subId of cat.subcategories || []) {
        if (out.has(subId))
            continue;
        out.add(subId);
        const sub = all.find((c) => c.id === subId);
        if (sub)
            collectDescendants(sub, all, out);
    }
}
function fetchProductsForCategories(storeId, accessToken, categoryIds, onLog) {
    return __awaiter(this, void 0, void 0, function* () {
        const headers = {
            Authentication: `bearer ${accessToken}`,
            'User-Agent': TN_USER_AGENT,
        };
        const byId = new Map();
        for (const categoryId of categoryIds) {
            let page = 1;
            while (page <= 300) {
                const res = yield axios_1.default.get(`${TN_BASE}/${storeId}/products`, {
                    headers,
                    params: { category_id: categoryId, page, per_page: 200 },
                    validateStatus: () => true,
                });
                if (res.status !== 200) {
                    onLog === null || onLog === void 0 ? void 0 : onLog(`[WARN] productos categoría ${categoryId} página ${page}: HTTP ${res.status}`);
                    break;
                }
                const chunk = Array.isArray(res.data) ? res.data : [];
                for (const p of chunk) {
                    if ((p === null || p === void 0 ? void 0 : p.id) != null)
                        byId.set(Number(p.id), p);
                }
                onLog === null || onLog === void 0 ? void 0 : onLog(`  Categoría ${categoryId}: página ${page} → ${chunk.length} productos`);
                if (chunk.length < 200)
                    break;
                page++;
                yield sleepTn();
            }
        }
        return Array.from(byId.values());
    });
}
function sleepTn() {
    const ms = Math.max(0, parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '400', 10));
    return new Promise((r) => setTimeout(r, ms));
}
function downloadCategoryImages(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const log = logFn(opts);
        const { accessToken, storeId } = yield getTiendaNubeIntegration();
        const includeSub = opts.includeSubcategories !== false;
        log(`Tienda Nube store_id=${storeId}`);
        log('Listando categorías…');
        const allCategories = yield fetchAllTnCategories(storeId, accessToken);
        const { ids: categoryIds, names: categoryNames } = resolveCategoryIds(allCategories, opts.categoryQuery, opts.categoryId, includeSub);
        if (categoryIds.length === 0) {
            throw new Error(`No se encontró ninguna categoría que coincida con «${opts.categoryQuery}». ` +
                `Probá con --category-id o revisá el nombre en TN.`);
        }
        log(`Categorías (${categoryIds.length}): ${categoryNames.join(', ') || categoryIds.join(', ')}`);
        log('Buscando productos…');
        const products = yield fetchProductsForCategories(storeId, accessToken, categoryIds, log);
        log(`Productos únicos: ${products.length}`);
        const withoutImages = products.filter((p) => { var _a; return !((_a = p.images) === null || _a === void 0 ? void 0 : _a.length); });
        if (withoutImages.length > 0) {
            log(`Completando imágenes de ${withoutImages.length} productos…`);
            yield (0, channelMarginFetch_2.runPool)(withoutImages, 4, (p) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                try {
                    const res = yield axios_1.default.get(`${TN_BASE}/${storeId}/products/${p.id}`, {
                        headers: {
                            Authentication: `bearer ${accessToken}`,
                            'User-Agent': TN_USER_AGENT,
                        },
                        validateStatus: () => true,
                    });
                    if (res.status === 200 && Array.isArray((_a = res.data) === null || _a === void 0 ? void 0 : _a.images)) {
                        p.images = res.data.images;
                    }
                }
                catch (_b) {
                    /* ignore */
                }
                yield sleepTn();
            }));
        }
        fs_1.default.mkdirSync(opts.outputDir, { recursive: true });
        const jobs = [];
        for (const product of products) {
            const images = [...(product.images || [])].sort((a, b) => { var _a, _b; return ((_a = a.position) !== null && _a !== void 0 ? _a : 0) - ((_b = b.position) !== null && _b !== void 0 ? _b : 0); });
            if (images.length === 0)
                continue;
            const productDir = path_1.default.join(opts.outputDir, productFolderName(product));
            fs_1.default.mkdirSync(productDir, { recursive: true });
            const seenInProduct = new Set();
            let idx = 0;
            for (const image of images) {
                const url = String(image.src || '').trim();
                if (!url || !url.startsWith('http'))
                    continue;
                if (seenInProduct.has(url))
                    continue;
                seenInProduct.add(url);
                idx++;
                const ext = extFromUrl(url);
                const pos = (_a = image.position) !== null && _a !== void 0 ? _a : idx;
                const fileName = `${String(pos).padStart(2, '0')}_img${image.id}.${ext}`;
                jobs.push({
                    product,
                    image,
                    filePath: path_1.default.join(productDir, fileName),
                    url,
                });
            }
        }
        log(`Imágenes a descargar: ${jobs.length}`);
        const errors = [];
        let downloaded = 0;
        let skipped = 0;
        let failed = 0;
        yield (0, channelMarginFetch_2.runPool)(jobs, 6, (job) => __awaiter(this, void 0, void 0, function* () {
            if (fs_1.default.existsSync(job.filePath)) {
                skipped++;
                return;
            }
            try {
                const res = yield axios_1.default.get(job.url, {
                    responseType: 'stream',
                    timeout: 60000,
                    validateStatus: () => true,
                });
                if (res.status !== 200 || !res.data) {
                    failed++;
                    errors.push(`${job.filePath}: HTTP ${res.status}`);
                    return;
                }
                yield (0, promises_1.pipeline)(res.data, (0, fs_2.createWriteStream)(job.filePath));
                downloaded++;
            }
            catch (e) {
                failed++;
                const msg = e instanceof Error ? e.message : String(e);
                errors.push(`${path_1.default.basename(job.filePath)}: ${msg}`);
            }
        }));
        log(`Listo: ${downloaded} descargadas, ${skipped} ya existían, ${failed} fallidas → ${opts.outputDir}`);
        return {
            categoryIds,
            categoryNames,
            productCount: products.length,
            imageCount: jobs.length,
            downloaded,
            skipped,
            failed,
            outputDir: opts.outputDir,
            errors: errors.slice(0, 50),
        };
    });
}
