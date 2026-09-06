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
exports.getPublicApiBaseUrl = getPublicApiBaseUrl;
exports.buildStorePageContent = buildStorePageContent;
exports.buildStorePageIframeHtml = buildStorePageIframeHtml;
exports.loadExpressTrackingPageConfig = loadExpressTrackingPageConfig;
exports.saveExpressTrackingPageConfig = saveExpressTrackingPageConfig;
exports.syncExpressTrackingPageToStore = syncExpressTrackingPageToStore;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const publicTrackingPageHtml_service_1 = require("./publicTrackingPageHtml.service");
const CONFIG_KEY = 'tiendanube_express_tracking_page';
/** URL canónica en multilupo.com.ar/seguimiento-de-envios/ */
const PAGE_HANDLE = 'seguimiento-de-envios';
/** Página duplicada que pudo crearse en syncs anteriores */
const LEGACY_PAGE_HANDLES = ['seguimiento-envio'];
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const TN_PAGES_API = '2025-03';
let tableReady = false;
function ensureTable() {
    return __awaiter(this, void 0, void 0, function* () {
        if (tableReady)
            return;
        yield (0, db_1.execute)(`
    CREATE TABLE IF NOT EXISTS catalog_configs (
      config_key VARCHAR(64) PRIMARY KEY,
      config LONGTEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
        tableReady = true;
    });
}
function getPublicApiBaseUrl() {
    const raw = (process.env.BACKEND_URL || process.env.API_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');
    return raw.endsWith('/api') ? raw : `${raw}/api`;
}
function buildStorePageContent() {
    return (0, publicTrackingPageHtml_service_1.buildTiendaNubeInlinePageContent)(getPublicApiBaseUrl());
}
/** @deprecated Tienda Nube bloquea iframes en páginas custom. Usar buildStorePageContent(). */
function buildStorePageIframeHtml() {
    return buildStorePageContent();
}
function loadExpressTrackingPageConfig() {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensureTable();
        const row = yield (0, db_1.get)('SELECT config FROM catalog_configs WHERE config_key = ?', [CONFIG_KEY]);
        if (!(row === null || row === void 0 ? void 0 : row.config))
            return { enabled: false };
        try {
            const parsed = JSON.parse(row.config);
            return Object.assign(Object.assign({}, parsed), { enabled: !!parsed.enabled });
        }
        catch (_a) {
            return { enabled: false };
        }
    });
}
function saveExpressTrackingPageConfig(config) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensureTable();
        yield (0, db_1.execute)(`INSERT INTO catalog_configs (config_key, config) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE config = VALUES(config)`, [CONFIG_KEY, JSON.stringify(config)]);
    });
}
function tnHeaders(accessToken) {
    return {
        Authentication: `bearer ${accessToken}`,
        'User-Agent': TN_USER_AGENT,
        'Content-Type': 'application/json',
    };
}
function pagesBase(storeId) {
    return `https://api.tiendanube.com/${TN_PAGES_API}/${storeId}/pages`;
}
function listPages(storeId, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const res = yield axios_1.default.get(pagesBase(storeId), {
            headers: tnHeaders(accessToken),
            validateStatus: () => true,
        });
        if (res.status !== 200) {
            const detail = ((_a = res.data) === null || _a === void 0 ? void 0 : _a.description) || ((_b = res.data) === null || _b === void 0 ? void 0 : _b.message) || res.statusText;
            throw new Error(`No se pudieron listar páginas de Tienda Nube (${res.status}): ${detail}`);
        }
        const payload = (_g = (_e = (_d = (_c = res.data) === null || _c === void 0 ? void 0 : _c.pages) === null || _d === void 0 ? void 0 : _d.results) !== null && _e !== void 0 ? _e : (_f = res.data) === null || _f === void 0 ? void 0 : _f.results) !== null && _g !== void 0 ? _g : res.data;
        return Array.isArray(payload) ? payload : [];
    });
}
function pageMatchesHandle(page, handle) {
    const h = page === null || page === void 0 ? void 0 : page.handle;
    if (!h || typeof h !== 'object')
        return false;
    return Object.values(h).some((v) => String(v).toLowerCase() === handle.toLowerCase());
}
function pageTitle(page) {
    var _a;
    const name = (_a = page === null || page === void 0 ? void 0 : page.name) !== null && _a !== void 0 ? _a : page === null || page === void 0 ? void 0 : page.title;
    if (name && typeof name === 'object') {
        return Object.values(name)
            .map((v) => String(v || '').trim())
            .filter(Boolean)
            .join(' ');
    }
    return String(name || '').trim();
}
function isTrackingRelatedPage(page) {
    if (pageMatchesHandle(page, PAGE_HANDLE))
        return true;
    for (const legacy of LEGACY_PAGE_HANDLES) {
        if (pageMatchesHandle(page, legacy))
            return true;
    }
    return pageTitle(page).toLowerCase().includes('seguimiento');
}
function findTrackingPage(pages, storedPageId) {
    const canonical = pages.find((p) => pageMatchesHandle(p, PAGE_HANDLE));
    if (canonical)
        return canonical;
    for (const legacy of LEGACY_PAGE_HANDLES) {
        const found = pages.find((p) => pageMatchesHandle(p, legacy));
        if (found)
            return found;
    }
    const byTitle = pages.find((p) => isTrackingRelatedPage(p));
    if (byTitle)
        return byTitle;
    if (storedPageId) {
        return pages.find((p) => Number(p.id) === Number(storedPageId));
    }
    return undefined;
}
function cleanupDuplicateTrackingPages(storeId, accessToken, keepPageId, pages) {
    return __awaiter(this, void 0, void 0, function* () {
        for (const page of pages) {
            if (Number(page.id) === Number(keepPageId))
                continue;
            if (!isTrackingRelatedPage(page))
                continue;
            try {
                yield deleteTrackingPage(storeId, accessToken, Number(page.id));
                console.log('[syncExpressTrackingPage] Página duplicada eliminada:', page.id, pageTitle(page));
            }
            catch (e) {
                console.warn('[syncExpressTrackingPage] No se pudo eliminar duplicado:', page.id, (e === null || e === void 0 ? void 0 : e.message) || e);
            }
        }
    });
}
function pageBody() {
    const content = buildStorePageContent();
    return {
        page: {
            publish: true,
            i18n: {
                es_AR: {
                    title: 'Seguimiento de envio',
                    content,
                    seo_handle: PAGE_HANDLE,
                    seo_title: 'Seguimiento de envio',
                    seo_description: 'Consultá el estado de tu envío express con tu código de seguimiento.',
                },
            },
        },
    };
}
function createTrackingPage(storeId, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const res = yield axios_1.default.post(pagesBase(storeId), pageBody(), {
            headers: tnHeaders(accessToken),
            validateStatus: () => true,
        });
        if (res.status !== 200 && res.status !== 201) {
            const detail = ((_a = res.data) === null || _a === void 0 ? void 0 : _a.description) || ((_b = res.data) === null || _b === void 0 ? void 0 : _b.message) || JSON.stringify(res.data) || res.statusText;
            throw new Error(`No se pudo crear la página en Tienda Nube (${res.status}): ${detail}`);
        }
        return res.data;
    });
}
function updateTrackingPage(storeId, accessToken, pageId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const res = yield axios_1.default.put(`${pagesBase(storeId)}/${pageId}`, pageBody(), {
            headers: tnHeaders(accessToken),
            validateStatus: () => true,
        });
        if (res.status !== 200) {
            const detail = ((_a = res.data) === null || _a === void 0 ? void 0 : _a.description) || ((_b = res.data) === null || _b === void 0 ? void 0 : _b.message) || res.statusText;
            throw new Error(`No se pudo actualizar la página en Tienda Nube (${res.status}): ${detail}`);
        }
        return res.data;
    });
}
function deleteTrackingPage(storeId, accessToken, pageId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const res = yield axios_1.default.delete(`${pagesBase(storeId)}/${pageId}`, {
            headers: tnHeaders(accessToken),
            validateStatus: () => true,
        });
        if (res.status !== 200 && res.status !== 204) {
            const detail = ((_a = res.data) === null || _a === void 0 ? void 0 : _a.description) || ((_b = res.data) === null || _b === void 0 ? void 0 : _b.message) || res.statusText;
            throw new Error(`No se pudo eliminar la página en Tienda Nube (${res.status}): ${detail}`);
        }
    });
}
function syncExpressTrackingPageToStore(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const integration = yield (0, db_1.get)(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
        if (!(integration === null || integration === void 0 ? void 0 : integration.access_token)) {
            throw new Error('Conectá Tienda Nube antes de activar la página de seguimiento.');
        }
        const storeId = integration.store_id || integration.user_id;
        if (!storeId)
            throw new Error('No se encontró el store_id de Tienda Nube.');
        const current = yield loadExpressTrackingPageConfig();
        const enabled = (_a = opts === null || opts === void 0 ? void 0 : opts.enabled) !== null && _a !== void 0 ? _a : current.enabled;
        const accessToken = String(integration.access_token);
        if (!enabled) {
            // No borramos la página en TN: puede ser una página histórica de la tienda (ej. /seguimiento-de-envios/).
            const next = {
                enabled: false,
                pageId: (_b = current.pageId) !== null && _b !== void 0 ? _b : null,
                pageHandle: current.pageHandle || PAGE_HANDLE,
                pageUrl: (_c = current.pageUrl) !== null && _c !== void 0 ? _c : null,
                lastSyncedAt: new Date().toISOString(),
                lastError: null,
            };
            yield saveExpressTrackingPageConfig(next);
            return next;
        }
        let pageId = (_d = current.pageId) !== null && _d !== void 0 ? _d : null;
        let pageData = null;
        try {
            const pages = yield listPages(storeId, accessToken);
            const existing = findTrackingPage(pages, pageId);
            if (existing === null || existing === void 0 ? void 0 : existing.id)
                pageId = Number(existing.id);
            pageData = pageId
                ? yield updateTrackingPage(storeId, accessToken, pageId)
                : yield createTrackingPage(storeId, accessToken);
            pageId = Number(pageData === null || pageData === void 0 ? void 0 : pageData.id) || pageId;
            yield cleanupDuplicateTrackingPages(storeId, accessToken, Number(pageId), pages);
            const handle = ((_e = pageData === null || pageData === void 0 ? void 0 : pageData.handle) === null || _e === void 0 ? void 0 : _e.es_AR) ||
                ((_f = pageData === null || pageData === void 0 ? void 0 : pageData.handle) === null || _f === void 0 ? void 0 : _f.es) ||
                ((_g = existing === null || existing === void 0 ? void 0 : existing.handle) === null || _g === void 0 ? void 0 : _g.es_AR) ||
                ((_h = existing === null || existing === void 0 ? void 0 : existing.handle) === null || _h === void 0 ? void 0 : _h.es) ||
                PAGE_HANDLE;
            const next = {
                enabled: true,
                pageId,
                pageHandle: String(handle),
                pageUrl: `/${handle}/`,
                lastSyncedAt: new Date().toISOString(),
                lastError: null,
            };
            yield saveExpressTrackingPageConfig(next);
            return next;
        }
        catch (error) {
            const next = Object.assign(Object.assign({}, current), { enabled: true, lastSyncedAt: new Date().toISOString(), lastError: (error === null || error === void 0 ? void 0 : error.message) || 'Error sincronizando página' });
            yield saveExpressTrackingPageConfig(next);
            throw error;
        }
    });
}
