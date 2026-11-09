import axios from 'axios';
import { getTiendaNubeIntegration } from './tiendanubeCategoryImages.service';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const TN_BASE = 'https://api.tiendanube.com/v1';
const CACHE_TTL_MS = 3 * 60 * 1000;

export type ShowroomPriceItem = {
  id: string;
  productId: number;
  name: string;
  articleCode: string;
  barcode: string | null;
  brand: string | null;
  image: string | null;
  stock: number | null;
  /** Precio de venta con el descuento de transferencia de Pago Nube (0% si no hay). */
  priceTransfer: number | null;
  /** Precio de venta con tarjeta en 1 pago (sin interés de cuotas). */
  priceCard: number | null;
  /** Precio tachado de la ficha, si es mayor al de venta. */
  compareAtPrice: number | null;
  url: string | null;
};

export type ShowroomPriceList = {
  generatedAt: string;
  productCount: number;
  transferDiscountPercent: number;
  cardDiscountPercent: number;
  items: ShowroomPriceItem[];
};

type CacheEntry = { at: number; data: ShowroomPriceList };

let cache: CacheEntry | null = null;
let inflight: Promise<ShowroomPriceList> | null = null;

function lang(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const v = obj.es ?? obj.pt ?? obj.en ?? Object.values(obj)[0];
    return v != null ? String(v) : '';
  }
  return String(value);
}

function parseMoney(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function applyPaymentDiscount(price: number | null, percent: number): number | null {
  if (price == null) return null;
  const pct = Number.isFinite(percent) && percent > 0 && percent < 100 ? percent : 0;
  if (!pct) return price;
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}

/** Precio que cobra la tienda hoy, y el tachado si existe. */
export function resolveVariantPrices(variant: {
  price?: unknown;
  promotional_price?: unknown;
  compare_at_price?: unknown;
} | null | undefined): { selling: number | null; compareAt: number | null } {
  if (!variant) return { selling: null, compareAt: null };
  const list = parseMoney(variant.price);
  const promo = parseMoney(variant.promotional_price);
  const compare = parseMoney(variant.compare_at_price);
  const selling = promo ?? list;
  let compareAt: number | null = null;
  if (compare != null && selling != null && compare > selling + 0.009) compareAt = compare;
  else if (promo != null && list != null && list > promo + 0.009) compareAt = list;
  return { selling, compareAt };
}

function sleepTn() {
  const ms = Math.max(0, parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '350', 10));
  return new Promise((r) => setTimeout(r, ms));
}

function tnHeaders(accessToken: string) {
  return {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': TN_USER_AGENT,
  };
}

function imageUrl(product: any): string | null {
  const images = Array.isArray(product?.images) ? [...product.images] : [];
  images.sort((a: any, b: any) => (a?.position ?? 0) - (b?.position ?? 0));
  for (const img of images) {
    let src = String(img?.src || img?.url || '').trim();
    if (src.startsWith('//')) src = `https:${src}`;
    if (src.startsWith('http')) return src;
  }
  return null;
}

function productUrl(product: any, storeBase: string): string | null {
  const canon = typeof product?.canonical_url === 'string' ? product.canonical_url.trim() : '';
  if (canon.startsWith('http')) return canon;
  const handle = lang(product?.handle).trim();
  if (storeBase && handle) return `${storeBase.replace(/\/$/, '')}/productos/${encodeURIComponent(handle)}/`;
  return null;
}

function variantOptionLabel(variant: any): string {
  const values = Array.isArray(variant?.values) ? variant.values : [];
  return values
    .map((value: unknown) => lang(value).trim())
    .filter(Boolean)
    .join(' / ');
}

export function readPaymentDiscount(html: string, methodId: string): number {
  const marker = `id="info-payment-method-${methodId}"`;
  const start = html.indexOf(marker);
  if (start < 0) return 0;
  const slice = html.slice(start, start + 5000);
  const match = slice.match(/data-payment-discount=["']([\d.]+)["']/);
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : 0;
}

async function fetchPublishedProducts(storeId: string, accessToken: string): Promise<any[]> {
  const headers = tnHeaders(accessToken);
  const all: any[] = [];
  let page = 1;
  while (page <= 500) {
    const res = await axios.get(`${TN_BASE}/${storeId}/products`, {
      headers,
      params: { page, per_page: 200, published: true },
      validateStatus: () => true,
      timeout: 60000,
    });
    if (res.status !== 200) {
      const detail =
        res.data?.description || res.data?.message || res.data?.error || `HTTP ${res.status}`;
      if (page === 1) {
        throw new Error(`No se pudieron leer los productos de Tienda Nube (${detail})`);
      }
      break;
    }
    const chunk = Array.isArray(res.data) ? res.data : [];
    all.push(...chunk);
    if (chunk.length < 200) break;
    page += 1;
    await sleepTn();
  }
  return all;
}

async function fetchStoreBase(storeId: string, accessToken: string): Promise<string> {
  try {
    const res = await axios.get(`${TN_BASE}/${storeId}/store`, {
      headers: tnHeaders(accessToken),
      validateStatus: () => true,
      timeout: 15000,
    });
    if (res.status !== 200 || !res.data) return '';
    const withProtocol = String(res.data.url_with_protocol || '').trim();
    if (withProtocol.startsWith('http')) return withProtocol.replace(/\/$/, '');
    const domain = String(res.data.original_domain || '').trim();
    if (domain) return `https://${domain.replace(/^https?:\/\//, '')}`;
  } catch {
    /* la lista igual se arma sin descuentos de medio de pago */
  }
  return '';
}

async function fetchPaymentDiscounts(pageUrl: string): Promise<{ transfer: number; card: number }> {
  if (!pageUrl) return { transfer: 0, card: 0 };
  try {
    const res = await axios.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'text/html',
      },
      timeout: 12000,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(data) => data],
    });
    if (res.status !== 200 || typeof res.data !== 'string') return { transfer: 0, card: 0 };
    return {
      transfer: readPaymentDiscount(res.data, 'wire_transfer'),
      card: readPaymentDiscount(res.data, 'credit_card'),
    };
  } catch {
    return { transfer: 0, card: 0 };
  }
}

function mapItems(
  products: any[],
  storeBase: string,
  discounts: { transfer: number; card: number }
): ShowroomPriceItem[] {
  const items: ShowroomPriceItem[] = [];
  for (const product of products) {
    if (product?.published === false) continue;
    const productId = Number(product?.id);
    if (!Number.isFinite(productId)) continue;
    const productName = lang(product?.name).replace(/\s+/g, ' ').trim() || `Producto ${productId}`;
    const brandRaw = lang(product?.brand).replace(/\s+/g, ' ').trim();
    const brand = brandRaw || null;
    const image = imageUrl(product);
    const url = productUrl(product, storeBase);
    const variants = (Array.isArray(product?.variants) ? product.variants : []).filter(
      (variant: any) => variant?.visible !== false
    );
    const multi = variants.length > 1;

    for (const variant of variants) {
      const variantId = variant?.id != null ? String(variant.id) : '';
      if (!variantId) continue;
      const sku = String(variant?.sku || '').trim();
      const barcodeRaw = String(variant?.barcode || '').trim();
      const barcode = barcodeRaw && barcodeRaw !== sku ? barcodeRaw : null;
      const option = variantOptionLabel(variant);
      const name = multi && option ? `${productName} · ${option}` : productName;
      const { selling, compareAt } = resolveVariantPrices(variant);
      const stockRaw = variant?.stock;
      const stock =
        stockRaw == null || stockRaw === '' || !Number.isFinite(Number(stockRaw))
          ? null
          : Math.max(0, Math.trunc(Number(stockRaw)));

      items.push({
        id: variantId,
        productId,
        name,
        articleCode: sku,
        barcode,
        brand,
        image,
        stock,
        priceTransfer: applyPaymentDiscount(selling, discounts.transfer),
        priceCard: applyPaymentDiscount(selling, discounts.card),
        compareAtPrice: compareAt,
        url,
      });
    }
  }

  items.sort((a, b) => {
    const codeA = a.articleCode || '\uffff';
    const codeB = b.articleCode || '\uffff';
    const byCode = codeA.localeCompare(codeB, 'es', { numeric: true, sensitivity: 'base' });
    if (byCode !== 0) return byCode;
    return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  });
  return items;
}

async function compute(): Promise<ShowroomPriceList> {
  const { accessToken, storeId } = await getTiendaNubeIntegration();
  const [products, storeBase] = await Promise.all([
    fetchPublishedProducts(storeId, accessToken),
    fetchStoreBase(storeId, accessToken),
  ]);

  const sample = products.find((product) => productUrl(product, storeBase));
  const discounts = await fetchPaymentDiscounts(sample ? productUrl(sample, storeBase) || '' : '');
  const items = mapItems(products, storeBase, discounts);

  return {
    generatedAt: new Date().toISOString(),
    productCount: items.length,
    transferDiscountPercent: discounts.transfer,
    cardDiscountPercent: discounts.card,
    items,
  };
}

export async function buildShowroomPriceList(opts?: { refresh?: boolean }): Promise<ShowroomPriceList> {
  if (opts?.refresh) cache = null;
  if (!opts?.refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  if (!opts?.refresh && inflight) return inflight;

  let run!: Promise<ShowroomPriceList>;
  run = compute()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      if (inflight === run) inflight = null;
    });

  inflight = run;
  return run;
}
