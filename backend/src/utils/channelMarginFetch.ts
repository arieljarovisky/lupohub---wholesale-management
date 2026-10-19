import axios from 'axios';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';

/** Ejecuta tareas con concurrencia limitada. */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < items.length) {
        const idx = next++;
        await fn(items[idx]);
      }
    })
  );
}

function parseTnMoney(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function parseTnListAndPromo(
  variant: { price?: unknown; promotional_price?: unknown } | null | undefined
): { list: number; promo: number | null } {
  if (!variant) return { list: 0, promo: null };
  const list = parseTnMoney(variant.price);
  const promo = parseTnMoney(variant.promotional_price);
  return { list, promo: promo > 0 ? promo : null };
}

/** Precio que cobra la tienda: promocional si existe, si no el de lista. */
export function parseTnPrice(variant: { price?: unknown; promotional_price?: unknown } | null | undefined): number {
  const { list, promo } = parseTnListAndPromo(variant);
  return promo != null && promo > 0 ? promo : list;
}

/** Precio representativo del producto TN (todas las variantes suelen tener el mismo). */
export function pickTnProductPrice(tnVariants: unknown[]): number {
  for (const tv of tnVariants) {
    const p = parseTnPrice(tv as { price?: unknown; promotional_price?: unknown });
    if (p > 0) return p;
  }
  return 0;
}

type MlVarRef = { variantId: string; variationId: string | null };

export async function fetchMlItemsMultiget(
  accessToken: string,
  mlItemIds: Map<string, MlVarRef[]>,
  prices: Record<string, { priceML?: number; mlItem?: Record<string, unknown> }>,
  mlItemCache: Map<string, Record<string, unknown>>
): Promise<void> {
  const ids = Array.from(mlItemIds.keys());
  const headers = { Authorization: `Bearer ${accessToken}` };
  const batchSize = 20;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    try {
      const res = await axios.get(
        `https://api.mercadolibre.com/items?ids=${batch.join(',')}&include_attributes=all`,
        { headers, validateStatus: () => true }
      );
      const wrappers = Array.isArray(res.data) ? res.data : [];
      for (const wrapper of wrappers) {
        if (wrapper?.code !== 200 || !wrapper?.body) continue;
        const item = wrapper.body as Record<string, unknown>;
        const itemId = String(item.id || wrapper.id || '');
        if (!itemId) continue;
        mlItemCache.set(itemId, item);
        const vars = mlItemIds.get(itemId) || [];
        const variations = (item.variations as unknown[]) || [];
        for (const { variantId, variationId } of vars) {
          if (!prices[variantId]) continue;
          let priceML = 0;
          if (variations.length === 0) {
            priceML = Number(item.price ?? 0);
          } else if (variationId) {
            const vr = variations.find((x: any) => String(x.id) === String(variationId));
            priceML = Number((vr as any)?.price ?? item.price ?? 0);
          } else if (variations.length === 1) {
            priceML = Number((variations[0] as any)?.price ?? item.price ?? 0);
          } else {
            priceML = Number(item.price ?? 0);
          }
          prices[variantId].priceML = priceML;
          prices[variantId].mlItem = item;
        }
      }
    } catch {
      /* ignore batch */
    }
  }
}

type TnVarRef = { variantId: string; tnVariantId: string };

export type TnPriceSlot = {
  priceTN?: number;
  priceTNList?: number;
  priceTNPromo?: number | null;
};

export async function fetchTnProductsBatched(
  storeId: string,
  accessToken: string,
  tnProductIds: Map<string, TnVarRef[]>,
  prices: Record<string, TnPriceSlot>
): Promise<void> {
  const ids = Array.from(tnProductIds.keys());
  if (ids.length === 0) return;

  const tnHeaders = {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': TN_USER_AGENT,
  };

  const tnProductById = new Map<string, { variants?: unknown[] }>();
  const batchSize = 30;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    try {
      const res = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products`, {
        headers: tnHeaders,
        params: { ids: batch.join(','), per_page: batch.length },
        validateStatus: () => true,
      });
      if (res.status !== 200) continue;
      const products = Array.isArray(res.data) ? res.data : [];
      for (const product of products) {
        if (product?.id != null) tnProductById.set(String(product.id), product);
      }
    } catch {
      /* ignore batch */
    }
  }

  // Fallback: productos no devueltos por ?ids= (límite o ID inválido)
  const missing = ids.filter((id) => !tnProductById.has(id));
  await runPool(missing, 4, async (tnProductId) => {
    try {
      const res = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products/${tnProductId}`, {
        headers: tnHeaders,
        validateStatus: () => true,
      });
      if (res.status === 200 && res.data?.id != null) {
        tnProductById.set(String(res.data.id), res.data);
      }
    } catch {
      /* ignore */
    }
  });

  for (const [tnProductId, entries] of tnProductIds) {
    const product = tnProductById.get(tnProductId);
    const tnVariants = (product?.variants as unknown[]) || [];
    let fallback = { list: 0, promo: null as number | null };
    for (const tv of tnVariants) {
      const parsed = parseTnListAndPromo(tv as { price?: unknown; promotional_price?: unknown });
      if (parsed.list > 0 || (parsed.promo != null && parsed.promo > 0)) {
        fallback = parsed;
        break;
      }
    }

    for (const { variantId, tnVariantId } of entries) {
      if (!prices[variantId]) continue;
      const tv = tnVariants.find((x: any) => String(x?.id) === String(tnVariantId));
      const parsed = tv
        ? parseTnListAndPromo(tv as { price?: unknown; promotional_price?: unknown })
        : { list: 0, promo: null as number | null };
      const use = parsed.list > 0 || parsed.promo != null ? parsed : fallback;
      const selling = use.promo != null && use.promo > 0 ? use.promo : use.list;
      if (selling <= 0 && use.list <= 0) continue;
      prices[variantId].priceTNList = use.list;
      prices[variantId].priceTNPromo = use.promo;
      prices[variantId].priceTN = selling > 0 ? selling : use.list;
    }
  }
}

export function resolveTnStoreId(integration: { store_id?: string; user_id?: string } | null | undefined): string {
  return String(integration?.store_id || integration?.user_id || '').trim();
}
