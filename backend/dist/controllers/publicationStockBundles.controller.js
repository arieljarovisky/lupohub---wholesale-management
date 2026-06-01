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
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncBundleStock = exports.createListingFromSource = exports.removeBundle = exports.updateBundle = exports.createBundle = exports.getBundle = exports.syncListingBundlesStock = exports.saveBundleGroup = exports.getBundlesByProduct = exports.getListingVariations = exports.getSourcePreview = exports.listBundles = void 0;
const publicationStockBundle_service_1 = require("../services/publicationStockBundle.service");
const integrations_controller_1 = require("./integrations.controller");
const packListingCreate_service_1 = require("../services/packListingCreate.service");
const listBundles = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (req.query.grouped === '1' || req.query.grouped === 'true') {
            const groups = yield (0, publicationStockBundle_service_1.listPublicationBundleGroups)();
            return res.json(groups);
        }
        const rows = yield (0, publicationStockBundle_service_1.listPublicationBundles)();
        res.json(rows);
    }
    catch (e) {
        console.error('listBundles:', e);
        const msg = String((e === null || e === void 0 ? void 0 : e.message) || '');
        if (msg.includes("doesn't exist") || (e === null || e === void 0 ? void 0 : e.code) === 'ER_NO_SUCH_TABLE') {
            return res.json([]);
        }
        res.status(500).json({ message: 'Error listando packs de publicación', detail: msg });
    }
});
exports.listBundles = listBundles;
const getSourcePreview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const platform = req.query.platform;
        const sourceId = String(req.query.sourceId || req.query.source_id || '').trim();
        if (!platform || (platform !== 'mercadolibre' && platform !== 'tiendanube')) {
            return res.status(400).json({ message: 'platform inválida' });
        }
        if (!sourceId) {
            return res.status(400).json({ message: 'sourceId es requerido' });
        }
        const preview = yield (0, packListingCreate_service_1.fetchPublicationSourcePreview)(platform, sourceId);
        if (!preview) {
            const mlauHint = platform === 'mercadolibre' && /^MLAU\d+$/i.test((0, integrations_controller_1.normalizeMercadoLibreItemId)(sourceId))
                ? ' Verificá que el MLAU sea de tu cuenta ML y tenga publicaciones (activas o pausadas).'
                : '';
            return res.status(404).json({
                message: `Publicación no encontrada en la plataforma.${mlauHint}`
            });
        }
        res.json(preview);
    }
    catch (e) {
        console.error('getSourcePreview:', e);
        res.status(500).json({ message: (e === null || e === void 0 ? void 0 : e.message) || 'Error cargando vista previa' });
    }
});
exports.getSourcePreview = getSourcePreview;
const getListingVariations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const platform = req.query.platform;
        const listingId = String(req.query.listingId || req.query.listing_id || '').trim();
        if (!platform || (platform !== 'mercadolibre' && platform !== 'tiendanube')) {
            return res.status(400).json({ message: 'platform inválida' });
        }
        if (!listingId) {
            return res.status(400).json({ message: 'listingId es requerido' });
        }
        const result = yield (0, packListingCreate_service_1.fetchListingPackVariations)(platform, listingId);
        if (!result) {
            const mlauHint = platform === 'mercadolibre' && /^MLAU\d+$/i.test((0, integrations_controller_1.normalizeMercadoLibreItemId)(listingId))
                ? ' Verificá que el MLAU sea de tu cuenta ML.'
                : '';
            return res.status(404).json({
                message: `Publicación no encontrada en la plataforma.${mlauHint}`
            });
        }
        res.json(result);
    }
    catch (e) {
        console.error('getListingVariations:', e);
        res.status(500).json({ message: (e === null || e === void 0 ? void 0 : e.message) || 'Error obteniendo variaciones' });
    }
});
exports.getListingVariations = getListingVariations;
const getBundlesByProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const platform = req.query.platform;
        const externalProductId = String(req.query.externalProductId || '').trim();
        if (!platform || (platform !== 'mercadolibre' && platform !== 'tiendanube')) {
            return res.status(400).json({ message: 'platform inválida' });
        }
        if (!externalProductId) {
            return res.status(400).json({ message: 'externalProductId es requerido' });
        }
        const variants = yield (0, publicationStockBundle_service_1.findBundlesByProduct)(platform, externalProductId);
        res.json({ platform, externalProductId, variants });
    }
    catch (e) {
        console.error('getBundlesByProduct:', e);
        res.status(500).json({ message: 'Error obteniendo variantes del pack' });
    }
});
exports.getBundlesByProduct = getBundlesByProduct;
const saveBundleGroup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const body = req.body;
        if (!body.platform || (body.platform !== 'mercadolibre' && body.platform !== 'tiendanube')) {
            return res.status(400).json({ message: 'platform debe ser mercadolibre o tiendanube' });
        }
        if (!((_a = body.externalProductId) === null || _a === void 0 ? void 0 : _a.trim())) {
            return res.status(400).json({ message: 'externalProductId es requerido' });
        }
        if (!Array.isArray(body.variants) || body.variants.length === 0) {
            return res.status(400).json({ message: 'variants debe tener al menos una combinación de colores' });
        }
        const group = yield (0, publicationStockBundle_service_1.savePublicationBundleGroup)({
            platform: body.platform,
            externalProductId: body.externalProductId,
            listingLabel: body.listingLabel,
            variants: body.variants.map((v) => ({
                id: v.id,
                label: v.label,
                externalVariantId: v.externalVariantId,
                items: v.items || []
            }))
        });
        res.json(group);
    }
    catch (e) {
        console.error('saveBundleGroup:', e);
        res.status(500).json({ message: (e === null || e === void 0 ? void 0 : e.message) || 'Error guardando grupo de packs' });
    }
});
exports.saveBundleGroup = saveBundleGroup;
const syncListingBundlesStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _b;
    try {
        const body = req.body;
        if (!body.platform || !((_b = body.externalProductId) === null || _b === void 0 ? void 0 : _b.trim())) {
            return res.status(400).json({ message: 'platform y externalProductId son requeridos' });
        }
        yield (0, publicationStockBundle_service_1.syncAllBundlesForProduct)(body.platform, body.externalProductId);
        const variants = yield (0, publicationStockBundle_service_1.findBundlesByProduct)(body.platform, body.externalProductId);
        res.json({ platform: body.platform, externalProductId: body.externalProductId, variants });
    }
    catch (e) {
        console.error('syncListingBundlesStock:', e);
        res.status(500).json({ message: 'Error sincronizando stock de variantes' });
    }
});
exports.syncListingBundlesStock = syncListingBundlesStock;
const getBundle = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const bundle = yield (0, publicationStockBundle_service_1.loadBundleById)(String(req.params.id || ''));
        if (!bundle)
            return res.status(404).json({ message: 'Pack no encontrado' });
        res.json(bundle);
    }
    catch (e) {
        console.error('getBundle:', e);
        res.status(500).json({ message: 'Error obteniendo pack' });
    }
});
exports.getBundle = getBundle;
const createBundle = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _c;
    try {
        const body = req.body;
        if (!body.platform || (body.platform !== 'mercadolibre' && body.platform !== 'tiendanube')) {
            return res.status(400).json({ message: 'platform debe ser mercadolibre o tiendanube' });
        }
        if (!((_c = body.externalProductId) === null || _c === void 0 ? void 0 : _c.trim())) {
            return res.status(400).json({ message: 'externalProductId es requerido (ID publicación ML o producto TN)' });
        }
        if (!Array.isArray(body.items) || body.items.length === 0) {
            return res.status(400).json({ message: 'items debe tener al menos una variante' });
        }
        const bundle = yield (0, publicationStockBundle_service_1.createPublicationBundle)({
            platform: body.platform,
            externalProductId: body.externalProductId,
            externalVariantId: body.externalVariantId,
            label: body.label,
            items: body.items
        });
        res.status(201).json(bundle);
    }
    catch (e) {
        if ((e === null || e === void 0 ? void 0 : e.code) === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Ya existe un pack para esa publicación' });
        }
        console.error('createBundle:', e);
        res.status(500).json({ message: 'Error creando pack de publicación' });
    }
});
exports.createBundle = createBundle;
const updateBundle = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = String(req.params.id || '');
        const body = req.body;
        const bundle = yield (0, publicationStockBundle_service_1.updatePublicationBundle)(id, body);
        if (!bundle)
            return res.status(404).json({ message: 'Pack no encontrado' });
        res.json(bundle);
    }
    catch (e) {
        console.error('updateBundle:', e);
        res.status(500).json({ message: 'Error actualizando pack' });
    }
});
exports.updateBundle = updateBundle;
const removeBundle = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const ok = yield (0, publicationStockBundle_service_1.deletePublicationBundle)(String(req.params.id || ''));
        if (!ok)
            return res.status(404).json({ message: 'Pack no encontrado' });
        res.json({ deleted: true });
    }
    catch (e) {
        console.error('removeBundle:', e);
        res.status(500).json({ message: 'Error eliminando pack' });
    }
});
exports.removeBundle = removeBundle;
const createListingFromSource = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _d, _e;
    try {
        const body = req.body;
        if (!body.platform || (body.platform !== 'mercadolibre' && body.platform !== 'tiendanube')) {
            return res.status(400).json({ message: 'platform debe ser mercadolibre o tiendanube' });
        }
        if (!((_d = body.sourceExternalProductId) === null || _d === void 0 ? void 0 : _d.trim())) {
            return res.status(400).json({ message: 'sourceExternalProductId es requerido (publicación individual)' });
        }
        const hasVariants = Array.isArray(body.variants) && body.variants.length > 0;
        const hasItems = Array.isArray(body.items) && body.items.length > 0;
        if (!hasVariants && !hasItems) {
            return res.status(400).json({ message: 'Indicá al menos una combinación de colores (variants o items)' });
        }
        const result = yield (0, packListingCreate_service_1.createPackListingAndBundle)({
            platform: body.platform,
            sourceExternalProductId: body.sourceExternalProductId,
            titleSuffix: body.titleSuffix,
            skuSuffix: body.skuSuffix,
            label: body.label,
            published: body.published,
            items: body.items,
            variants: (_e = body.variants) === null || _e === void 0 ? void 0 : _e.map((v) => {
                var _a;
                return ({
                    label: v.label,
                    items: (_a = v.items) !== null && _a !== void 0 ? _a : []
                });
            }),
            publicationContent: body.publicationContent
        });
        res.status(201).json(result);
    }
    catch (e) {
        if ((e === null || e === void 0 ? void 0 : e.code) === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Ya existe un pack para esa publicación' });
        }
        console.error('createListingFromSource:', e);
        res.status(500).json({ message: (e === null || e === void 0 ? void 0 : e.message) || 'Error creando publicación pack' });
    }
});
exports.createListingFromSource = createListingFromSource;
const syncBundleStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = String(req.params.id || '');
        const bundle = yield (0, publicationStockBundle_service_1.loadBundleById)(id);
        if (!bundle)
            return res.status(404).json({ message: 'Pack no encontrado' });
        yield (0, publicationStockBundle_service_1.syncBundleListingStock)(id);
        const updated = yield (0, publicationStockBundle_service_1.loadBundleById)(id);
        res.json(updated);
    }
    catch (e) {
        console.error('syncBundleStock:', e);
        res.status(500).json({ message: 'Error sincronizando stock del pack' });
    }
});
exports.syncBundleStock = syncBundleStock;
