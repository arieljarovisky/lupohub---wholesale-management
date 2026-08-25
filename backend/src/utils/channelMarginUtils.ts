import axios from 'axios';
import { query, get } from '../database/db';
import { currentMonthNameEs } from './argentinaDate';

export type FobPriceListInfo = {
  id: string | null;
  name: string;
  byProductId: Map<string, number>;
  bySku: Map<string, number>;
};

export type FobYieldMetrics = {
  fob: number | null;
  avgPrice: number | null;
  costFob: number | null;
  profit: number | null;
  yieldOnCost: number | null;
  yieldOnSale: number | null;
};

function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

function skuKey(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toUpperCase();
}

async function loadFobMaps(listId: string): Promise<{ byProductId: Map<string, number>; bySku: Map<string, number> }> {
  const byProductId = new Map<string, number>();
  const bySku = new Map<string, number>();
  const rows = (await query(
    `SELECT pli.product_id, pli.price, p.sku
     FROM price_list_items pli
     LEFT JOIN products p ON p.id = pli.product_id
     WHERE pli.price_list_id = ?`,
    [listId]
  )) as Array<{ product_id: string; price: string | number | null; sku: string | null }>;
  for (const r of rows) {
    const price = Number(r.price);
    if (!Number.isFinite(price)) continue;
    byProductId.set(String(r.product_id), price);
    const sku = skuKey(r.sku);
    if (sku) bySku.set(sku, price);
  }
  return { byProductId, bySku };
}

/** Lista FOB por nombre exacto (p. ej. «Precios Fob Marzo») o la que contenga esas palabras. */
export async function resolveFobPriceListByName(preferredName: string): Promise<FobPriceListInfo> {
  const wanted = String(preferredName || '').trim();
  if (!wanted) return resolveFobPriceList();

  let pl = await get(
    `SELECT id, name FROM price_lists WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1`,
    [wanted]
  );
  if (!pl?.id) {
    const tokens = wanted
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3);
    if (tokens.length > 0) {
      const likes = tokens.map(() => 'LOWER(name) LIKE ?').join(' AND ');
      pl = await get(
        `SELECT id, name FROM price_lists WHERE ${likes} ORDER BY updated_at DESC, name LIMIT 1`,
        tokens.map((t) => `%${t}%`)
      );
    }
  }
  if (!pl?.id) {
    return { id: null, name: wanted, byProductId: new Map(), bySku: new Map() };
  }

  const id = String(pl.id);
  const name = String((pl as { name?: string }).name || wanted);
  const maps = await loadFobMaps(id);
  return { id, name, ...maps };
}

/** Lista FOB: env LUPOHUB_FOB_PRICE_LIST_ID, o la del mes actual (p. ej. «Precios Fob Agosto»), o la FOB más reciente. */
export async function resolveFobPriceList(): Promise<FobPriceListInfo> {
  let id: string | null = null;
  let name = '';

  const fobListIdEnv = (process.env.LUPOHUB_FOB_PRICE_LIST_ID || '').trim();
  if (fobListIdEnv) {
    const exists = await get('SELECT id, name FROM price_lists WHERE id = ?', [fobListIdEnv]);
    if (exists?.id) {
      id = String(exists.id);
      name = String((exists as { name?: string }).name || '');
    }
  }
  if (!id) {
    const month = currentMonthNameEs();
    const pl = await get(
      `SELECT id, name FROM price_lists WHERE LOWER(TRIM(name)) LIKE '%fob%'
       ORDER BY
         CASE WHEN ? <> '' AND LOWER(name) LIKE ? THEN 0 ELSE 1 END,
         CASE WHEN LOWER(TRIM(name)) = 'precios fob' THEN 0 ELSE 1 END,
         updated_at DESC,
         name
       LIMIT 1`,
      [month, month ? `%${month}%` : '%']
    );
    if (pl?.id) {
      id = String(pl.id);
      name = String((pl as { name?: string }).name || '');
    }
  }
  if (id) {
    const maps = await loadFobMaps(id);
    return { id, name, ...maps };
  }
  return { id: null, name: '', byProductId: new Map(), bySku: new Map() };
}

export function lookupFobPrice(
  info: FobPriceListInfo,
  productId?: string | null,
  sku?: string | null
): number | null {
  if (productId && info.byProductId.has(productId)) {
    const n = info.byProductId.get(productId)!;
    return Number.isFinite(n) ? n : null;
  }
  const key = skuKey(sku);
  if (key && info.bySku.has(key)) {
    const n = info.bySku.get(key)!;
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Ganancia y rendimiento vs FOB: (ingresos − FOB × unidades) / (FOB × unidades). */
export function calcFobYield(revenue: number, units: number, fob: number | null): FobYieldMetrics {
  const avgPrice = units > 0 && Number.isFinite(revenue) ? roundMoney(revenue / units) : null;
  if (fob == null || !Number.isFinite(fob) || units <= 0) {
    return { fob, avgPrice, costFob: null, profit: null, yieldOnCost: null, yieldOnSale: null };
  }
  const costFob = roundMoney(fob * units);
  const profit = roundMoney(Number(revenue) - costFob);
  const yieldOnCost = costFob > 0 ? roundMoney((profit / costFob) * 100) : null;
  const yieldOnSale = Number(revenue) > 0 ? roundMoney((profit / Number(revenue)) * 100) : null;
  return { fob, avgPrice, costFob, profit, yieldOnCost, yieldOnSale };
}

/** IVA sobre tasas (ej. 21% → multiplicador 1.21). Las tasas TN suelen mostrarse como «X% + IVA». */
export function getIvaMultiplier(): number {
  const pct = Number(process.env.LUPOHUB_FEE_IVA_PERCENT ?? '21');
  const n = Number.isFinite(pct) && pct >= 0 ? pct : 21;
  return 1 + n / 100;
}

export type TnFeePresetDef = {
  label: string;
  ratePercent: number;
  cptPercent: number;
  appliesIva: boolean;
};

/** Tasas según panel de pagos Tienda Nube (Pago Nube / Mercado Pago en TN). */
export const TN_FEE_PRESETS: Record<string, TnFeePresetDef> = {
  pago_nube_14d: {
    label: 'Pago Nube · tarjeta/billetera · 14 días',
    ratePercent: 3.29,
    cptPercent: 0,
    appliesIva: true,
  },
  pago_nube_7d: {
    label: 'Pago Nube · tarjeta/billetera · 7 días',
    ratePercent: 4.19,
    cptPercent: 0,
    appliesIva: true,
  },
  pago_nube_1d: {
    label: 'Pago Nube · tarjeta/billetera · 1 día',
    ratePercent: 5.89,
    cptPercent: 0,
    appliesIva: true,
  },
  pago_nube_transfer_1d: {
    label: 'Pago Nube · transferencia bancaria · 1 día',
    ratePercent: 0.99,
    cptPercent: 0,
    appliesIva: true,
  },
  tn_mp_18d: {
    label: 'Mercado Pago en TN · 18 días',
    ratePercent: 3.39,
    cptPercent: 1,
    appliesIva: true,
  },
  tn_mp_10d: {
    label: 'Mercado Pago en TN · 10 días',
    ratePercent: 4.39,
    cptPercent: 1,
    appliesIva: true,
  },
  tn_mp_instant: {
    label: 'Mercado Pago en TN · al momento',
    ratePercent: 6.29,
    cptPercent: 1,
    appliesIva: true,
  },
};

export function listTnFeePresets(): Array<{ id: string } & TnFeePresetDef> {
  return Object.entries(TN_FEE_PRESETS).map(([id, def]) => ({ id, ...def }));
}

/** @deprecated Usar preset; se mantiene por compatibilidad con LUPOHUB_TN_SALE_FEE_PERCENT. */
export function getTnFeeConfig(): { percent: number; fixed: number } {
  const percent = Number(process.env.LUPOHUB_TN_SALE_FEE_PERCENT ?? '6.5');
  const fixed = Number(process.env.LUPOHUB_TN_SALE_FEE_FIXED ?? '0');
  return {
    percent: Number.isFinite(percent) && percent >= 0 ? percent : 0,
    fixed: Number.isFinite(fixed) && fixed >= 0 ? fixed : 0,
  };
}

export function resolveTnFeePreset(presetId?: string): { id: string } & TnFeePresetDef {
  const envDefault = (process.env.LUPOHUB_TN_FEE_PRESET || 'tn_mp_instant').trim();
  const id = (presetId || envDefault).trim();
  if (id === 'custom') {
    const legacy = getTnFeeConfig();
    return {
      id: 'custom',
      label: `Personalizado (.env ${legacy.percent}%${legacy.fixed ? ` + $${legacy.fixed}` : ''})`,
      ratePercent: legacy.percent,
      cptPercent: 0,
      appliesIva: true,
    };
  }
  const def = TN_FEE_PRESETS[id];
  if (def) return { id, ...def };
  return { id: 'tn_mp_instant', ...TN_FEE_PRESETS.tn_mp_instant };
}

export function calcTnSaleFeeFromPreset(
  price: number,
  preset: { ratePercent: number; cptPercent: number; appliesIva: boolean },
  fixed = 0
): { total: number; ratePart: number; cptPart: number } {
  const p = Math.max(0, Number(price) || 0);
  const iva = preset.appliesIva ? getIvaMultiplier() : 1;
  const ratePart = p * (preset.ratePercent / 100) * iva;
  const cptPart = p * (preset.cptPercent / 100);
  const total = Math.round((ratePart + cptPart + fixed) * 100) / 100;
  return {
    total,
    ratePart: Math.round(ratePart * 100) / 100,
    cptPart: Math.round(cptPart * 100) / 100,
  };
}

export function calcTnSaleFee(price: number, config = getTnFeeConfig()): number {
  return calcTnSaleFeeFromPreset(
    price,
    { ratePercent: config.percent, cptPercent: 0, appliesIva: true },
    config.fixed
  ).total;
}

/** CPT cobro personalizado / transferencia en ML (panel «Personalizado», típ. 1%). */
export function getMlPaymentCptPercent(): number {
  const n = Number(process.env.LUPOHUB_ML_PAYMENT_CPT_PERCENT ?? '1');
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function calcMlPaymentCpt(price: number, percent = getMlPaymentCptPercent()): number {
  const p = Math.max(0, Number(price) || 0);
  return Math.round(p * (percent / 100) * 100) / 100;
}

export function calcMargin(price: number, fee: number, fob: number | null): number | null {
  if (fob == null || !Number.isFinite(fob)) return null;
  const m = Number(price) - Number(fee) - Number(fob);
  return Number.isFinite(m) ? Math.round(m * 100) / 100 : null;
}

export function calcMarginPercent(margin: number | null, price: number): number | null {
  if (margin == null || !Number.isFinite(price) || price <= 0) return null;
  return Math.round((margin / price) * 10000) / 100;
}

/** Comisión ML (`sale_fee_amount`) desde GET /sites/{SITE}/listing_prices. */
export function parseListingPricesSaleFee(data: unknown, listingTypeId: string): number {
  const lt = (listingTypeId || '').trim();
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data as Record<string, unknown>] : [];
  const match = rows.find((r) => String((r as { listing_type_id?: string })?.listing_type_id || '') === lt);
  const row = match ?? rows[0];
  const n = Number((row as { sale_fee_amount?: unknown })?.sale_fee_amount);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function fetchListingSaleFeeAmount(
  accessToken: string,
  item: Record<string, unknown>,
  price: number,
  cache: Map<string, number>
): Promise<number> {
  const siteId = String(item?.site_id || '').trim();
  const categoryId = String(item?.category_id || '').trim();
  const listingTypeId = String(item?.listing_type_id || '').trim();
  const currencyId = String(item?.currency_id || '').trim() || 'ARS';
  const shipping = item?.shipping as { logistic_type?: unknown } | undefined;
  const logisticType = shipping?.logistic_type != null ? String(shipping.logistic_type).trim() : '';

  if (!siteId || !listingTypeId || !Number.isFinite(price) || price <= 0) return 0;

  const priceRounded = Math.round(price * 100) / 100;
  const cacheKey = `${siteId}|${categoryId}|${listingTypeId}|${priceRounded}|${currencyId}|${logisticType}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const params: Record<string, string | number> = {
    price: priceRounded,
    listing_type_id: listingTypeId,
    currency_id: currencyId,
  };
  if (categoryId) params.category_id = categoryId;
  if (logisticType) params.logistic_type = logisticType;

  try {
    const res = await axios.get(`https://api.mercadolibre.com/sites/${encodeURIComponent(siteId)}/listing_prices`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params,
      validateStatus: () => true,
    });
    if (res.status !== 200) {
      cache.set(cacheKey, 0);
      return 0;
    }
    const fee = parseListingPricesSaleFee(res.data, listingTypeId);
    cache.set(cacheKey, fee);
    return fee;
  } catch {
    cache.set(cacheKey, 0);
    return 0;
  }
}
