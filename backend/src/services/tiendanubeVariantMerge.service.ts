import axios from 'axios';
import { tnDeleteWithRetry, tnPostWithRetry, tnPutWithRetry } from '../utils/tiendanubeClient';

export type TnVariantRow = {
  id: number | string;
  values?: unknown[];
  stock?: number | string | null;
  stock_management?: boolean;
};

export type TnVariantMergePlan = {
  variant: TnVariantRow;
  current: string;
  normalized: string;
  willUpdate: boolean;
};

function variantValueText(val: unknown): string {
  return (
    (val as { es?: string; en?: string; pt?: string })?.es
    ?? (val as { es?: string; en?: string; pt?: string })?.pt
    ?? (val as { es?: string; en?: string; pt?: string })?.en
    ?? val
  )?.toString().trim() || '';
}

function variantStockQty(v: TnVariantRow): number {
  if (v.stock_management === false) return 0;
  if (v.stock === '' || v.stock == null) return 0;
  const n = Number(v.stock);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function fetchVariantStockFromApi(
  storeId: string,
  productId: number | string,
  variantId: number | string,
  headers: Record<string, string>
): Promise<number> {
  const res = await axios.get(
    `https://api.tiendanube.com/v1/${storeId}/products/${productId}/variants/${variantId}`,
    { headers }
  );
  const row = res.data as TnVariantRow;
  return variantStockQty(row);
}

function pickKeeperPlan(group: TnVariantMergePlan[]): TnVariantMergePlan {
  const alreadyTarget = group.filter((p) => !p.willUpdate);
  if (alreadyTarget.length) return alreadyTarget[0];
  const sorted = group.slice().sort((a, b) => String(a.variant.id).localeCompare(String(b.variant.id)));
  return sorted[0];
}

function buildValuesWithAttr(
  values: unknown[],
  attrIndex: number,
  normalized: string
): unknown[] {
  return values.map((obj, i) => {
    if (i !== attrIndex) return obj;
    const langKeys = obj && typeof obj === 'object' ? Object.keys(obj as object) : ['es'];
    const next: Record<string, string> = {};
    for (const lang of langKeys) next[lang] = normalized;
    return next;
  });
}

/**
 * Fusiona variantes que colisionan tras normalizar (ej. G + G/44-46 → G):
 * suma stock en la variante que se queda y elimina las demás en Tienda Nube.
 */
export async function mergeTiendaNubeDuplicateVariants(options: {
  storeId: string;
  productId: number | string;
  attrIndex: number;
  group: TnVariantMergePlan[];
  headers: Record<string, string>;
  log: (msg: string) => void;
}): Promise<{ mergedCount: number; stockAdded: number }> {
  const { storeId, productId, attrIndex, group, headers, log } = options;
  if (group.length < 2) return { mergedCount: 0, stockAdded: 0 };

  const keeperPlan = pickKeeperPlan(group);
  const absorbs = group.filter((p) => String(p.variant.id) !== String(keeperPlan.variant.id));
  if (!absorbs.length) return { mergedCount: 0, stockAdded: 0 };

  const baseUrl = `https://api.tiendanube.com/v1/${storeId}/products/${productId}`;
  let keeperStock = variantStockQty(keeperPlan.variant);
  if (keeperStock === 0) {
    keeperStock = await fetchVariantStockFromApi(storeId, productId, keeperPlan.variant.id, headers);
  }
  let totalStock = keeperStock;
  const absorbLabels: string[] = [];

  for (const a of absorbs) {
    let add = variantStockQty(a.variant);
    if (add === 0) {
      add = await fetchVariantStockFromApi(storeId, productId, a.variant.id, headers);
    }
    totalStock += add;
    absorbLabels.push(`${a.variant.id}("${a.current}"→${a.normalized}, +${add})`);
  }

  for (const a of absorbs) {
    try {
      await tnDeleteWithRetry(axios, `${baseUrl}/variants/${a.variant.id}`, { headers });
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { description?: string } }; message?: string };
      throw new Error(
        `No se pudo eliminar variante ${a.variant.id}: ${ax.response?.data?.description || ax.message}`
      );
    }
  }

  const keeperValues = keeperPlan.variant.values || [];
  const targetName = keeperPlan.normalized;
  const keeperCurrent = variantValueText(keeperValues[attrIndex]);
  if (keeperPlan.willUpdate || keeperCurrent !== targetName) {
    await tnPutWithRetry(
      axios,
      `${baseUrl}/variants/${keeperPlan.variant.id}`,
      { values: buildValuesWithAttr(keeperValues, attrIndex, targetName) },
      { headers }
    );
  }

  const stockAdded = Math.max(0, totalStock - keeperStock);
  if (totalStock > 0 || stockAdded > 0) {
    try {
      await tnPostWithRetry(
        axios,
        `${baseUrl}/variants/stock`,
        { action: 'replace', value: totalStock, id: keeperPlan.variant.id },
        { headers }
      );
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { description?: string } }; message?: string };
      log(
        `  [WARN] Producto ${productId} variante ${keeperPlan.variant.id}: stock no actualizado (${ax.response?.data?.description || ax.message})`
      );
    }
  }

  log(
    `  [MERGE] Producto ${productId}: variante ${keeperPlan.variant.id} queda "${targetName}" stock=${totalStock}; eliminadas ${absorbs.length} (${absorbLabels.join(', ')})`
  );

  return { mergedCount: absorbs.length, stockAdded: Math.max(0, stockAdded) };
}
