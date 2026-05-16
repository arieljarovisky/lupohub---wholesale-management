import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { get } from '../database/db';
import { resolveTnStoreId } from '../utils/channelMarginFetch';
import { runPool } from '../utils/channelMarginFetch';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const TN_BASE = 'https://api.tiendanube.com/v1';

export type TnCategory = {
  id: number;
  name?: Record<string, string> | string;
  handle?: Record<string, string>;
  subcategories?: number[];
  parent?: number | null;
};

export type TnProductImage = {
  id: number;
  src: string;
  position?: number;
};

export type TnProduct = {
  id: number;
  name?: Record<string, string> | string;
  handle?: Record<string, string>;
  images?: TnProductImage[];
  categories?: number[];
};

export type DownloadCategoryImagesOptions = {
  categoryQuery: string;
  outputDir: string;
  categoryId?: number;
  includeSubcategories?: boolean;
  onLog?: (msg: string) => void;
};

export type DownloadCategoryImagesResult = {
  categoryIds: number[];
  categoryNames: string[];
  productCount: number;
  imageCount: number;
  downloaded: number;
  skipped: number;
  failed: number;
  outputDir: string;
  errors: string[];
};

function logFn(opts: DownloadCategoryImagesOptions) {
  return (msg: string) => {
    opts.onLog?.(msg);
    console.log(msg);
  };
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function categoryLabel(c: TnCategory): string {
  if (c.name && typeof c.name === 'object') {
    return String(c.name.es || c.name.en || c.name.pt || Object.values(c.name)[0] || c.id);
  }
  return String(c.name || c.id);
}

function productLabel(p: TnProduct): string {
  if (p.name && typeof p.name === 'object') {
    return String(p.name.es || p.name.en || p.name.pt || Object.values(p.name)[0] || p.id);
  }
  return String(p.name || p.id);
}

function productSlug(p: TnProduct): string {
  const h = p.handle;
  const handle =
    h && typeof h === 'object' ? String(h.es || h.en || h.pt || Object.values(h)[0] || '') : '';
  const base = handle || productLabel(p);
  return base
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || `producto-${p.id}`;
}

function extFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.(jpe?g|png|gif|webp|avif)$/i);
    if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  } catch {
    /* ignore */
  }
  return 'jpg';
}

export async function getTiendaNubeIntegration() {
  const envToken = (process.env.TN_ACCESS_TOKEN || process.env.TIENDA_NUBE_ACCESS_TOKEN || '').trim();
  const envStore = (process.env.TN_STORE_ID || process.env.TIENDA_NUBE_STORE_ID || '').trim();
  if (envToken && envStore) {
    return { accessToken: envToken, storeId: envStore };
  }

  const row = await get(
    `SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`
  );
  const storeId = resolveTnStoreId(row);
  if (!row?.access_token || !storeId) {
    throw new Error(
      'No hay integración activa con Tienda Nube. Conectala desde Configuración o definí TN_STORE_ID y TN_ACCESS_TOKEN en .env'
    );
  }
  return { accessToken: String(row.access_token), storeId };
}

export async function fetchAllTnCategories(
  storeId: string,
  accessToken: string
): Promise<TnCategory[]> {
  const headers = {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': TN_USER_AGENT,
  };
  const all: TnCategory[] = [];
  let page = 1;
  while (page <= 300) {
    const res = await axios.get(`${TN_BASE}/${storeId}/categories`, {
      headers,
      params: { page, per_page: 200 },
      validateStatus: () => true,
    });
    if (res.status !== 200) {
      throw new Error(`Error listando categorías TN (${res.status})`);
    }
    const chunk = Array.isArray(res.data) ? res.data : [];
    all.push(...chunk);
    if (chunk.length < 200) break;
    page++;
  }
  return all;
}

export function resolveCategoryIds(
  allCategories: TnCategory[],
  query: string,
  explicitId?: number,
  includeSubcategories = true
): { ids: number[]; names: string[] } {
  if (explicitId != null && Number.isFinite(explicitId)) {
    const cat = allCategories.find((c) => c.id === explicitId);
    const ids = new Set<number>([explicitId]);
    if (includeSubcategories && cat) collectDescendants(cat, allCategories, ids);
    return {
      ids: Array.from(ids),
      names: [cat ? categoryLabel(cat) : `ID ${explicitId}`],
    };
  }

  const q = normalize(query);
  const qHandle = q.replace(/\s+/g, '-');
  const ids = new Set<number>();
  const names: string[] = [];
  const byId = new Map(allCategories.map((c) => [c.id, c]));

  for (const c of allCategories) {
    const namesList: string[] = [];
    if (c.name && typeof c.name === 'object') {
      namesList.push(...Object.values(c.name).map(String));
    } else if (c.name) namesList.push(String(c.name));
    const handles = c.handle ? Object.values(c.handle).map(String) : [];
    const match =
      namesList.some((n) => normalize(n).includes(q) || normalize(n) === q) ||
      handles.some((h) => normalize(h).includes(qHandle) || normalize(h) === qHandle);

    if (match) {
      names.push(categoryLabel(c));
      ids.add(c.id);
      if (includeSubcategories) collectDescendants(c, allCategories, ids);
    }
  }

  return { ids: Array.from(ids), names };
}

function collectDescendants(cat: TnCategory, all: TnCategory[], out: Set<number>) {
  for (const subId of cat.subcategories || []) {
    if (out.has(subId)) continue;
    out.add(subId);
    const sub = all.find((c) => c.id === subId);
    if (sub) collectDescendants(sub, all, out);
  }
}

export async function fetchProductsForCategories(
  storeId: string,
  accessToken: string,
  categoryIds: number[],
  onLog?: (msg: string) => void
): Promise<TnProduct[]> {
  const headers = {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': TN_USER_AGENT,
  };
  const byId = new Map<number, TnProduct>();

  for (const categoryId of categoryIds) {
    let page = 1;
    while (page <= 300) {
      const res = await axios.get(`${TN_BASE}/${storeId}/products`, {
        headers,
        params: { category_id: categoryId, page, per_page: 200 },
        validateStatus: () => true,
      });
      if (res.status !== 200) {
        onLog?.(`[WARN] productos categoría ${categoryId} página ${page}: HTTP ${res.status}`);
        break;
      }
      const chunk = Array.isArray(res.data) ? (res.data as TnProduct[]) : [];
      for (const p of chunk) {
        if (p?.id != null) byId.set(Number(p.id), p);
      }
      onLog?.(`  Categoría ${categoryId}: página ${page} → ${chunk.length} productos`);
      if (chunk.length < 200) break;
      page++;
      await sleepTn();
    }
  }

  return Array.from(byId.values());
}

function sleepTn() {
  const ms = Math.max(0, parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '400', 10));
  return new Promise((r) => setTimeout(r, ms));
}

export async function downloadCategoryImages(
  opts: DownloadCategoryImagesOptions
): Promise<DownloadCategoryImagesResult> {
  const log = logFn(opts);
  const { accessToken, storeId } = await getTiendaNubeIntegration();
  const includeSub = opts.includeSubcategories !== false;

  log(`Tienda Nube store_id=${storeId}`);
  log('Listando categorías…');
  const allCategories = await fetchAllTnCategories(storeId, accessToken);

  const { ids: categoryIds, names: categoryNames } = resolveCategoryIds(
    allCategories,
    opts.categoryQuery,
    opts.categoryId,
    includeSub
  );

  if (categoryIds.length === 0) {
    throw new Error(
      `No se encontró ninguna categoría que coincida con «${opts.categoryQuery}». ` +
        `Probá con --category-id o revisá el nombre en TN.`
    );
  }

  log(`Categorías (${categoryIds.length}): ${categoryNames.join(', ') || categoryIds.join(', ')}`);
  log('Buscando productos…');
  const products = await fetchProductsForCategories(storeId, accessToken, categoryIds, log);
  log(`Productos únicos: ${products.length}`);

  const withoutImages = products.filter((p) => !p.images?.length);
  if (withoutImages.length > 0) {
    log(`Completando imágenes de ${withoutImages.length} productos…`);
    await runPool(withoutImages, 4, async (p) => {
      try {
        const res = await axios.get(`${TN_BASE}/${storeId}/products/${p.id}`, {
          headers: {
            Authentication: `bearer ${accessToken}`,
            'User-Agent': TN_USER_AGENT,
          },
          validateStatus: () => true,
        });
        if (res.status === 200 && Array.isArray(res.data?.images)) {
          p.images = res.data.images;
        }
      } catch {
        /* ignore */
      }
      await sleepTn();
    });
  }

  fs.mkdirSync(opts.outputDir, { recursive: true });

  type ImageJob = {
    product: TnProduct;
    image: TnProductImage;
    filePath: string;
    url: string;
  };

  const jobs: ImageJob[] = [];
  const seenUrls = new Set<string>();

  for (const product of products) {
    const images = [...(product.images || [])].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0)
    );
    const slug = productSlug(product);
    let idx = 0;
    for (const image of images) {
      const url = String(image.src || '').trim();
      if (!url || !url.startsWith('http')) continue;
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      idx++;
      const ext = extFromUrl(url);
      const fileName = `${slug}_p${image.position ?? idx}_img${image.id}.${ext}`;
      jobs.push({
        product,
        image,
        filePath: path.join(opts.outputDir, fileName),
        url,
      });
    }
  }

  log(`Imágenes a descargar: ${jobs.length}`);
  const errors: string[] = [];
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  await runPool(jobs, 6, async (job) => {
    if (fs.existsSync(job.filePath)) {
      skipped++;
      return;
    }
    try {
      const res = await axios.get(job.url, {
        responseType: 'stream',
        timeout: 60000,
        validateStatus: () => true,
      });
      if (res.status !== 200 || !res.data) {
        failed++;
        errors.push(`${job.filePath}: HTTP ${res.status}`);
        return;
      }
      await pipeline(res.data, createWriteStream(job.filePath));
      downloaded++;
    } catch (e: unknown) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${path.basename(job.filePath)}: ${msg}`);
    }
  });

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
}
