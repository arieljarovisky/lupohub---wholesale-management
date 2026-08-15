import axios from 'axios';
import path from 'path';
import {
  tnDeleteWithRetry,
  tnGetWithRetry,
  tnPostWithRetry,
  tnPutWithRetry,
} from '../utils/tiendanubeClient';
import { skuToCanonicalString } from '../utils/skuString';
import { getTiendaNubeIntegration } from './tiendanubeCategoryImages.service';

const TN_BASE = 'https://api.tiendanube.com/v1';
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const MAX_IMAGES_PER_PRODUCT = 15;

export type TnProductImage = {
  id: number;
  src: string;
  position: number;
  alt?: string | Record<string, string> | null;
};

export type TnProductImagesPayload = {
  productId: string;
  title: string;
  permalink: string;
  images: TnProductImage[];
};

export type ImageSaveItem = {
  id?: number;
  fileIndex?: number;
};

export type UploadedImageFile = {
  buffer: Buffer;
  filename: string;
  mimetype: string;
};

export type ImageMatchPreview = {
  productId: string;
  title: string;
  imageCount: number;
  files: Array<{ path: string; seq: number }>;
};

function tnHeaders(accessToken: string) {
  return {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': TN_USER_AGENT,
    'Content-Type': 'application/json',
  };
}

function productTitle(p: any): string {
  const n = p?.name;
  if (n && typeof n === 'object') return String(n.es || n.en || n.pt || Object.values(n)[0] || p?.id || '');
  return String(n || p?.id || '');
}

function mapImages(raw: any): TnProductImage[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((im: any) => ({
      id: Number(im?.id),
      src: String(im?.src || im?.url || ''),
      position: Number(im?.position) || 0,
      alt: im?.alt ?? null,
    }))
    .filter((im) => Number.isFinite(im.id) && im.id > 0)
    .sort((a, b) => a.position - b.position);
}

function tnErrorMessage(data: any, fallback: string): string {
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  return data.description || data.message || data.error || fallback;
}

export async function getTiendaNubeProductImages(productId: string): Promise<TnProductImagesPayload> {
  const { accessToken, storeId } = await getTiendaNubeIntegration();
  const url = `${TN_BASE}/${storeId}/products/${encodeURIComponent(productId)}`;
  const res = await tnGetWithRetry(axios, url, {
    headers: tnHeaders(accessToken),
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    throw Object.assign(new Error(tnErrorMessage(res.data, 'Producto no encontrado en Tienda Nube')), {
      status: res.status >= 400 && res.status < 500 ? res.status : 502,
    });
  }
  const p = res.data as any;
  return {
    productId: String(p.id),
    title: productTitle(p),
    permalink: String(p.url || ''),
    images: mapImages(p.images),
  };
}

async function uploadImage(
  storeId: string,
  accessToken: string,
  productId: string,
  file: UploadedImageFile
): Promise<TnProductImage> {
  const ext = (path.extname(file.filename) || '.jpg').toLowerCase() || '.jpg';
  const safeName = `img-${Date.now()}${ext}`.replace(/[^\w.-]/g, '');
  const body = {
    filename: safeName,
    attachment: file.buffer.toString('base64'),
  };
  const url = `${TN_BASE}/${storeId}/products/${encodeURIComponent(productId)}/images`;
  const r = await tnPostWithRetry(axios, url, body, {
    headers: tnHeaders(accessToken),
    validateStatus: () => true,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(tnErrorMessage(r.data, `Tienda Nube rechazó la imagen ${file.filename}`));
  }
  const im = r.data;
  return {
    id: Number(im.id),
    src: String(im.src || ''),
    position: Number(im.position) || 0,
    alt: im.alt ?? null,
  };
}

async function deleteImage(storeId: string, accessToken: string, productId: string, imageId: number) {
  const url = `${TN_BASE}/${storeId}/products/${encodeURIComponent(productId)}/images/${imageId}`;
  await tnDeleteWithRetry(axios, url, {
    headers: tnHeaders(accessToken),
  });
}

async function setImagePosition(
  storeId: string,
  accessToken: string,
  productId: string,
  imageId: number,
  position: number
) {
  const url = `${TN_BASE}/${storeId}/products/${encodeURIComponent(productId)}/images/${imageId}`;
  await tnPutWithRetry(
    axios,
    url,
    { position },
    {
      headers: tnHeaders(accessToken),
    }
  );
}

export async function saveTiendaNubeProductImages(
  productId: string,
  opts: {
    items: ImageSaveItem[];
    files: UploadedImageFile[];
    keepExisting?: boolean;
  }
): Promise<TnProductImagesPayload> {
  const { accessToken, storeId } = await getTiendaNubeIntegration();
  const current = await getTiendaNubeProductImages(productId);
  const currentIds = new Set(current.images.map((i) => i.id));
  const items = Array.isArray(opts.items) ? opts.items : [];
  const keepExisting = opts.keepExisting === true;

  const desiredExistingIds = items
    .map((it) => (it.id != null ? Number(it.id) : NaN))
    .filter((id) => Number.isFinite(id) && id > 0);

  for (const id of desiredExistingIds) {
    if (!currentIds.has(id)) {
      throw Object.assign(new Error(`La imagen ${id} ya no está en la publicación. Recargá y volvé a intentar.`), {
        status: 409,
      });
    }
  }

  const incomingFileCount = items.filter((it) => it.fileIndex != null && Number.isFinite(Number(it.fileIndex))).length
    ? new Set(
        items
          .map((it) => (it.fileIndex != null ? Number(it.fileIndex) : NaN))
          .filter((n) => Number.isFinite(n) && n >= 0)
      ).size
    : opts.files.length;
  const projectedCount = keepExisting
    ? current.images.length + incomingFileCount
    : new Set(desiredExistingIds).size + incomingFileCount;
  if (projectedCount > MAX_IMAGES_PER_PRODUCT) {
    throw Object.assign(
      new Error(
        `Tienda Nube permite hasta ${MAX_IMAGES_PER_PRODUCT} imágenes por publicación (quedarían ${projectedCount}).`
      ),
      { status: 400 }
    );
  }

  const fileIndexes = [
    ...new Set(
      items
        .map((it) => (it.fileIndex != null ? Number(it.fileIndex) : NaN))
        .filter((n) => Number.isFinite(n) && n >= 0)
    ),
  ].sort((a, b) => a - b);

  const fileIdByIndex = new Map<number, number>();
  for (const idx of fileIndexes) {
    const file = opts.files[idx];
    if (!file?.buffer?.length) {
      throw Object.assign(new Error(`Falta el archivo #${idx + 1}`), { status: 400 });
    }
    const created = await uploadImage(storeId, accessToken, productId, file);
    fileIdByIndex.set(idx, created.id);
  }

  const orderedIds: number[] = [];
  if (keepExisting) {
    for (const im of current.images) orderedIds.push(im.id);
  }
  for (const item of items) {
    if (item.id != null && Number.isFinite(Number(item.id))) {
      orderedIds.push(Number(item.id));
    } else if (item.fileIndex != null && fileIdByIndex.has(Number(item.fileIndex))) {
      orderedIds.push(fileIdByIndex.get(Number(item.fileIndex)) as number);
    }
  }

  const seen = new Set<number>();
  const uniqueOrdered = orderedIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  if (uniqueOrdered.length > MAX_IMAGES_PER_PRODUCT) {
    throw Object.assign(
      new Error(`Tienda Nube permite hasta ${MAX_IMAGES_PER_PRODUCT} imágenes por publicación (quedarían ${uniqueOrdered.length}).`),
      { status: 400 }
    );
  }

  const keepSet = new Set(uniqueOrdered);
  const toDelete = keepExisting
    ? []
    : current.images.filter((im) => !keepSet.has(im.id)).map((im) => im.id);

  for (const id of toDelete) {
    await deleteImage(storeId, accessToken, productId, id);
  }

  for (let i = 0; i < uniqueOrdered.length; i++) {
    await setImagePosition(storeId, accessToken, productId, uniqueOrdered[i], i + 1);
  }

  return getTiendaNubeProductImages(productId);
}

type ProductLite = {
  id: string;
  title: string;
  imageCount: number;
  skuKeys: string[];
};

function compactKey(raw: string): string {
  return skuToCanonicalString(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function variantSkus(p: any): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(p?.variants) ? p.variants : []) {
    const sku = skuToCanonicalString(v?.sku);
    if (sku) out.push(sku);
  }
  return out;
}

async function fetchAllProductsLite(): Promise<ProductLite[]> {
  const { accessToken, storeId } = await getTiendaNubeIntegration();
  const all: ProductLite[] = [];
  let page = 1;
  while (page <= 300) {
    const res = await tnGetWithRetry(axios, `${TN_BASE}/${storeId}/products`, {
      headers: tnHeaders(accessToken),
      params: { page, per_page: 200 },
      validateStatus: () => true,
    });
    if (res.status !== 200) {
      throw new Error(tnErrorMessage(res.data, `Error listando productos de Tienda Nube (HTTP ${res.status})`));
    }
    const chunk = Array.isArray(res.data) ? res.data : [];
    for (const p of chunk) {
      if (p?.id == null) continue;
      const skus = variantSkus(p);
      const skuKeys = new Set<string>();
      skuKeys.add(String(p.id));
      for (const sku of skus) {
        const c = compactKey(sku);
        if (c) skuKeys.add(c);
      }
      all.push({
        id: String(p.id),
        title: productTitle(p),
        imageCount: Array.isArray(p.images) ? p.images.length : 0,
        skuKeys: [...skuKeys],
      });
    }
    if (chunk.length < 200) break;
    page++;
  }
  return all;
}

/** Extrae claves de matching (ID TN, SKU) y el orden sugerido desde un path de archivo. */
export function parseImageFileRef(relativePath: string): { keys: string[]; seq: number } {
  const norm = String(relativePath || '').replace(/\\/g, '/').trim();
  const base = path.basename(norm).replace(/\.[^.]+$/, '');
  const keys: string[] = [];
  let seq = 0;

  const folderId = norm.match(/__(\d+)(?:\/|$)/);
  if (folderId) keys.push(folderId[1]);

  const zipImg = base.match(/^(\d{1,2})[_-]img\d+/i);
  if (zipImg) {
    seq = parseInt(zipImg[1], 10) || 0;
  } else {
    const trail = base.match(/^(.*?)(?:[_\-\s]| \()(\d{1,2})\)?$/);
    if (trail && compactKey(trail[1]).length >= 2) {
      seq = parseInt(trail[2], 10) || 0;
      const k = compactKey(trail[1]);
      if (k) keys.push(k);
      if (/^\d+$/.test(trail[1].trim())) keys.push(trail[1].trim());
    } else {
      const k = compactKey(base);
      if (k) keys.push(k);
      if (/^\d+$/.test(base.trim())) keys.push(base.trim());
    }
  }

  return { keys: [...new Set(keys.filter(Boolean))], seq };
}

export async function previewTiendaNubeImageMatches(opts: {
  paths: string[];
  productIds?: string[];
}): Promise<{
  matches: ImageMatchPreview[];
  unmatched: Array<{ path: string; reason: string }>;
  ambiguous: Array<{ path: string; productIds: string[]; titles: string[] }>;
}> {
  const products = await fetchAllProductsLite();
  const allowed = opts.productIds?.length
    ? new Set(opts.productIds.map((id) => String(id)))
    : null;
  const pool = allowed ? products.filter((p) => allowed.has(p.id)) : products;

  const byId = new Map<string, ProductLite>();
  const bySku = new Map<string, ProductLite[]>();
  for (const p of pool) {
    byId.set(p.id, p);
    for (const k of p.skuKeys) {
      if (k === p.id) continue;
      const list = bySku.get(k) || [];
      list.push(p);
      bySku.set(k, list);
    }
  }

  const grouped = new Map<string, ImageMatchPreview>();
  const unmatched: Array<{ path: string; reason: string }> = [];
  const ambiguous: Array<{ path: string; productIds: string[]; titles: string[] }> = [];

  for (const rawPath of opts.paths) {
    const { keys, seq } = parseImageFileRef(rawPath);
    const candidates = new Map<string, ProductLite>();
    for (const key of keys) {
      const byProductId = byId.get(key);
      if (byProductId) candidates.set(byProductId.id, byProductId);
      const skuHits = bySku.get(compactKey(key)) || bySku.get(key) || [];
      for (const p of skuHits) candidates.set(p.id, p);
    }

    if (candidates.size === 0 && keys.length === 1) {
      const compact = compactKey(keys[0]);
      if (compact.length >= 4) {
        const prefixHits = pool.filter((p) => p.skuKeys.some((k) => k !== p.id && k.startsWith(compact)));
        const unique = [...new Map(prefixHits.map((p) => [p.id, p])).values()];
        if (unique.length === 1) candidates.set(unique[0].id, unique[0]);
        else if (unique.length > 1) {
          ambiguous.push({
            path: rawPath,
            productIds: unique.map((p) => p.id),
            titles: unique.map((p) => p.title),
          });
          continue;
        }
      }
    }

    if (candidates.size === 0) {
      unmatched.push({
        path: rawPath,
        reason: keys.length ? `Sin publicación para «${keys.join(', ')}»` : 'No se pudo leer SKU o ID del archivo',
      });
      continue;
    }
    if (candidates.size > 1) {
      const list = [...candidates.values()];
      ambiguous.push({
        path: rawPath,
        productIds: list.map((p) => p.id),
        titles: list.map((p) => p.title),
      });
      continue;
    }

    const product = [...candidates.values()][0];
    const row = grouped.get(product.id) || {
      productId: product.id,
      title: product.title,
      imageCount: product.imageCount,
      files: [],
    };
    row.files.push({ path: rawPath, seq });
    grouped.set(product.id, row);
  }

  const matches = [...grouped.values()].map((m) => ({
    ...m,
    files: [...m.files].sort((a, b) => a.seq - b.seq || a.path.localeCompare(b.path)),
  }));

  return { matches, unmatched, ambiguous };
}
