import axios from 'axios';
import { execute, get } from '../database/db';
import { buildTiendaNubeInlinePageContent } from './publicTrackingPageHtml.service';

const CONFIG_KEY = 'tiendanube_express_tracking_page';
/** URL canónica en multilupo.com.ar/seguimiento-de-envios/ */
const PAGE_HANDLE = 'seguimiento-de-envios';
/** Página duplicada que pudo crearse en syncs anteriores */
const LEGACY_PAGE_HANDLES = ['seguimiento-envio'] as const;
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const TN_PAGES_API = '2025-03';

export type ExpressTrackingPageConfig = {
  enabled: boolean;
  pageId?: number | null;
  pageHandle?: string;
  pageUrl?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
};

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await execute(`
    CREATE TABLE IF NOT EXISTS catalog_configs (
      config_key VARCHAR(64) PRIMARY KEY,
      config LONGTEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  tableReady = true;
}

export function getPublicApiBaseUrl(): string {
  const raw = (process.env.BACKEND_URL || process.env.API_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}

export function buildStorePageContent(): string {
  const seguimientoUrl = `${getPublicApiBaseUrl()}/public/seguimiento`;
  return buildTiendaNubeInlinePageContent(seguimientoUrl);
}

/** @deprecated Tienda Nube bloquea iframes en páginas custom. Usar buildStorePageContent(). */
export function buildStorePageIframeHtml(): string {
  return buildStorePageContent();
}

export async function loadExpressTrackingPageConfig(): Promise<ExpressTrackingPageConfig> {
  await ensureTable();
  const row = await get('SELECT config FROM catalog_configs WHERE config_key = ?', [CONFIG_KEY]);
  if (!row?.config) return { enabled: false };
  try {
    const parsed = JSON.parse(row.config) as ExpressTrackingPageConfig;
    return { ...parsed, enabled: !!parsed.enabled };
  } catch {
    return { enabled: false };
  }
}

export async function saveExpressTrackingPageConfig(config: ExpressTrackingPageConfig): Promise<void> {
  await ensureTable();
  await execute(
    `INSERT INTO catalog_configs (config_key, config) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE config = VALUES(config)`,
    [CONFIG_KEY, JSON.stringify(config)]
  );
}

function tnHeaders(accessToken: string) {
  return {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': TN_USER_AGENT,
    'Content-Type': 'application/json',
  };
}

function pagesBase(storeId: string | number): string {
  return `https://api.tiendanube.com/${TN_PAGES_API}/${storeId}/pages`;
}

async function listPages(storeId: string | number, accessToken: string): Promise<any[]> {
  const res = await axios.get(pagesBase(storeId), {
    headers: tnHeaders(accessToken),
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    const detail = res.data?.description || res.data?.message || res.statusText;
    throw new Error(`No se pudieron listar páginas de Tienda Nube (${res.status}): ${detail}`);
  }
  const payload = res.data?.pages?.results ?? res.data?.results ?? res.data;
  return Array.isArray(payload) ? payload : [];
}

function pageMatchesHandle(page: any, handle: string): boolean {
  const h = page?.handle;
  if (!h || typeof h !== 'object') return false;
  return Object.values(h).some((v) => String(v).toLowerCase() === handle.toLowerCase());
}

function pageTitle(page: any): string {
  const name = page?.name ?? page?.title;
  if (name && typeof name === 'object') {
    return Object.values(name)
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .join(' ');
  }
  return String(name || '').trim();
}

function isTrackingRelatedPage(page: any): boolean {
  if (pageMatchesHandle(page, PAGE_HANDLE)) return true;
  for (const legacy of LEGACY_PAGE_HANDLES) {
    if (pageMatchesHandle(page, legacy)) return true;
  }
  return pageTitle(page).toLowerCase().includes('seguimiento');
}

function findTrackingPage(pages: any[], storedPageId?: number | null): any | undefined {
  const canonical = pages.find((p) => pageMatchesHandle(p, PAGE_HANDLE));
  if (canonical) return canonical;
  for (const legacy of LEGACY_PAGE_HANDLES) {
    const found = pages.find((p) => pageMatchesHandle(p, legacy));
    if (found) return found;
  }
  const byTitle = pages.find((p) => isTrackingRelatedPage(p));
  if (byTitle) return byTitle;
  if (storedPageId) {
    return pages.find((p) => Number(p.id) === Number(storedPageId));
  }
  return undefined;
}

async function cleanupDuplicateTrackingPages(
  storeId: string | number,
  accessToken: string,
  keepPageId: number,
  pages: any[]
): Promise<void> {
  for (const page of pages) {
    if (Number(page.id) === Number(keepPageId)) continue;
    if (!isTrackingRelatedPage(page)) continue;
    try {
      await deleteTrackingPage(storeId, accessToken, Number(page.id));
      console.log('[syncExpressTrackingPage] Página duplicada eliminada:', page.id, pageTitle(page));
    } catch (e: any) {
      console.warn('[syncExpressTrackingPage] No se pudo eliminar duplicado:', page.id, e?.message || e);
    }
  }
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

async function createTrackingPage(storeId: string | number, accessToken: string): Promise<any> {
  const res = await axios.post(pagesBase(storeId), pageBody(), {
    headers: tnHeaders(accessToken),
    validateStatus: () => true,
  });
  if (res.status !== 200 && res.status !== 201) {
    const detail = res.data?.description || res.data?.message || JSON.stringify(res.data) || res.statusText;
    throw new Error(`No se pudo crear la página en Tienda Nube (${res.status}): ${detail}`);
  }
  return res.data;
}

async function updateTrackingPage(
  storeId: string | number,
  accessToken: string,
  pageId: number
): Promise<any> {
  const res = await axios.put(`${pagesBase(storeId)}/${pageId}`, pageBody(), {
    headers: tnHeaders(accessToken),
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    const detail = res.data?.description || res.data?.message || res.statusText;
    throw new Error(`No se pudo actualizar la página en Tienda Nube (${res.status}): ${detail}`);
  }
  return res.data;
}

async function deleteTrackingPage(
  storeId: string | number,
  accessToken: string,
  pageId: number
): Promise<void> {
  const res = await axios.delete(`${pagesBase(storeId)}/${pageId}`, {
    headers: tnHeaders(accessToken),
    validateStatus: () => true,
  });
  if (res.status !== 200 && res.status !== 204) {
    const detail = res.data?.description || res.data?.message || res.statusText;
    throw new Error(`No se pudo eliminar la página en Tienda Nube (${res.status}): ${detail}`);
  }
}

export async function syncExpressTrackingPageToStore(opts?: {
  enabled?: boolean;
}): Promise<ExpressTrackingPageConfig> {
  const integration = await get(
    `SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`
  );
  if (!integration?.access_token) {
    throw new Error('Conectá Tienda Nube antes de activar la página de seguimiento.');
  }
  const storeId = integration.store_id || integration.user_id;
  if (!storeId) throw new Error('No se encontró el store_id de Tienda Nube.');

  const current = await loadExpressTrackingPageConfig();
  const enabled = opts?.enabled ?? current.enabled;
  const accessToken = String(integration.access_token);

  if (!enabled) {
    // No borramos la página en TN: puede ser una página histórica de la tienda (ej. /seguimiento-de-envios/).
    const next: ExpressTrackingPageConfig = {
      enabled: false,
      pageId: current.pageId ?? null,
      pageHandle: current.pageHandle || PAGE_HANDLE,
      pageUrl: current.pageUrl ?? null,
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
    };
    await saveExpressTrackingPageConfig(next);
    return next;
  }

  let pageId = current.pageId ?? null;
  let pageData: any = null;

  try {
    const pages = await listPages(storeId, accessToken);
    const existing = findTrackingPage(pages, pageId);
    if (existing?.id) pageId = Number(existing.id);

    pageData = pageId
      ? await updateTrackingPage(storeId, accessToken, pageId)
      : await createTrackingPage(storeId, accessToken);
    pageId = Number(pageData?.id) || pageId;

    await cleanupDuplicateTrackingPages(storeId, accessToken, Number(pageId), pages);

    const handle =
      pageData?.handle?.es_AR ||
      pageData?.handle?.es ||
      existing?.handle?.es_AR ||
      existing?.handle?.es ||
      PAGE_HANDLE;

    const next: ExpressTrackingPageConfig = {
      enabled: true,
      pageId,
      pageHandle: String(handle),
      pageUrl: `/${handle}/`,
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
    };
    await saveExpressTrackingPageConfig(next);
    return next;
  } catch (error: any) {
    const next: ExpressTrackingPageConfig = {
      ...current,
      enabled: true,
      lastSyncedAt: new Date().toISOString(),
      lastError: error?.message || 'Error sincronizando página',
    };
    await saveExpressTrackingPageConfig(next);
    throw error;
  }
}
