/** Empareja variaciones de un ítem ML por variationId / SKU / color+talle (con guardas). */

import { codigoTalleParaSku, nombreTalleDesdeCodigo, TALLE_CODIGO_A_NOMBRE } from '../talles-tango';
import { colorsAreEquivalent } from './colorNameStandard';

export type MlVariantMatchLink = {
  variationId?: string | null;
  sku?: string | null;
  color?: string | null;
  size?: string | null;
};

export function normSkuForMlStockMatch(s: string): string {
  const d = String(s ?? '').replace(/\D/g, '');
  return (d.replace(/^0+/, '') || '0').toUpperCase();
}

/**
 * Prefijo de artículo comparable entre `0069102-140-280` y `0069102140280`.
 * Evita cruces entre artículos distintos en el mismo MLA.
 */
export function articleDigitsFromSku(sku: string): string {
  const s = String(sku ?? '').trim();
  if (!s) return '';
  const dashed = s.match(/^([A-Za-z0-9]+)-(\d{2,4})-/);
  if (dashed) return normSkuForMlStockMatch(dashed[1]);
  const digits = s.replace(/\D/g, '');
  // artículo(7) + talle(3) + color(3) = 13, o artículo más corto + 6
  if (digits.length >= 13) return normSkuForMlStockMatch(digits.slice(0, -6));
  if (digits.length >= 10) return normSkuForMlStockMatch(digits.slice(0, -6));
  return normSkuForMlStockMatch(digits);
}

export function sameArticleSku(localRaw: string, remoteRaw: string): boolean {
  const a = articleDigitsFromSku(localRaw);
  const b = articleDigitsFromSku(remoteRaw);
  return !!a && !!b && a !== '0' && b !== '0' && a === b;
}

export function normTextForMlStockMatch(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function mlVariationSkuFromApi(v: any): string {
  const skuAttr =
    Array.isArray(v?.attributes) &&
    v.attributes.find((a: any) => (a?.id || '').toString().toUpperCase() === 'SELLER_SKU');
  const skuFromAttr = skuAttr ? (skuAttr.value_name ?? skuAttr.value ?? '').toString().trim() : '';
  return skuFromAttr || (v?.seller_sku ?? v?.seller_custom_field ?? '').toString().trim();
}

export function mlVariationColorSizeFromApi(v: any): { color: string; size: string } {
  let color = '';
  let size = '';
  const absorb = (attr: any) => {
    const id = (attr?.id || '').toString().toUpperCase();
    const name = (attr?.value_name ?? attr?.value ?? attr?.name ?? '').toString().trim();
    if (!name) return;
    if (id === 'COLOR' || id === 'COLOUR' || id === 'COR') color = color || name;
    if (id === 'SIZE' || id === 'SIZE_TYPE' || id === 'TALLE' || id === 'TALLA') size = size || name;
  };
  (v?.attribute_combinations || []).forEach(absorb);
  (Array.isArray(v?.attributes) ? v.attributes : []).forEach(absorb);
  return { color, size };
}

/** Aliases de talle: "160", "GG", "160 - GG", "gg", etc. */
export function sizeMatchKeys(size: string): Set<string> {
  const keys = new Set<string>();
  const add = (v: unknown) => {
    const n = normTextForMlStockMatch(String(v ?? ''));
    if (n) keys.add(n);
  };
  const raw = String(size ?? '').trim();
  if (!raw) return keys;
  add(raw);
  for (const part of raw.split(/[-–|/,\s]+/)) {
    if (part.trim()) add(part.trim());
  }
  const digits = raw.replace(/\D/g, '');
  if (digits) {
    add(digits);
    add(nombreTalleDesdeCodigo(digits));
    if (TALLE_CODIGO_A_NOMBRE[digits]) add(TALLE_CODIGO_A_NOMBRE[digits]);
  }
  const codeFromLetter = codigoTalleParaSku(raw);
  if (codeFromLetter) {
    add(codeFromLetter);
    add(nombreTalleDesdeCodigo(codeFromLetter));
  }
  return keys;
}

export function sizesCompatible(a: string, b: string): boolean {
  const A = sizeMatchKeys(a);
  const B = sizeMatchKeys(b);
  if (!A.size || !B.size) return false;
  for (const k of A) {
    if (B.has(k)) return true;
  }
  return false;
}

/** Solo igualdad exacta del SKU normalizado (dígitos). Evita que 150-594 y 180-594 colisionen. */
export function skusCompatible(localRaw: string, remoteRaw: string): boolean {
  const local = normSkuForMlStockMatch(localRaw);
  const remote = normSkuForMlStockMatch(remoteRaw);
  if (!local || !remote || local === '0' || remote === '0') return false;
  return local === remote;
}

function colorCompatible(localColor: string, remoteColor: string): boolean {
  return colorsAreEquivalent(localColor, remoteColor);
}

/**
 * Completa color/talle faltantes desde un SKU Lupo (artículo+talle+color).
 * Si ML ya trae COLOR y SIZE en atributos, esos mandan: en familias UP el seller_sku
 * a veces queda cruzado entre variantes (ej. Blanco G con SKU de Nude P).
 */
export function reconcileMlColorSizeWithLupoSku(
  sku: string,
  color: string,
  size: string
): { color: string; size: string } {
  const mlColor = String(color || '').trim();
  const mlSize = String(size || '').trim();
  // Atributos completos de la publicación: no pisar con SKU (puede estar desfasado).
  if (mlColor && mlSize) {
    return { color: mlColor, size: mlSize };
  }

  const digits = String(sku || '').replace(/\D/g, '');
  if (digits.length < 13) return { color: mlColor, size: mlSize };
  const sizeCode = digits.slice(-6, -3);
  if (!sizeCode || (!TALLE_CODIGO_A_NOMBRE[sizeCode] && !/^\d{3}$/.test(sizeCode))) {
    return { color: mlColor, size: mlSize };
  }
  if (!mlSize) return { color: mlColor, size: sizeCode };
  if (sizesCompatible(mlSize, sizeCode)) return { color: mlColor, size: mlSize };
  return { color: mlColor, size: mlSize };
}

/**
 * Empareja la variación ML correcta.
 * Prioridad: variationId guardado → SKU exacto → color+talle (con guardas de artículo).
 *
 * El ID que el usuario guardó al vincular manda.
 * color+talle se permite si ML no trae SKU usable, o si el SKU remoto es del mismo artículo
 * (evita el cruce 0067102↔0073304 en un MLA compartido, pero permite sync cuando
 * el SKU de ML está vacío / en otro formato y el vínculo no tiene variation_id).
 */
export function matchMlVariationForVariantLink(variations: any[], link: MlVariantMatchLink): any | null {
  if (!Array.isArray(variations) || variations.length === 0) return null;

  const rawLocalSku = String(link.sku ?? '').trim();
  const varId = link.variationId != null ? String(link.variationId).trim() : '';

  // 1) variationId explícito (vínculo guardado en LupoHub)
  if (varId) {
    const byId = variations.find((x: any) => String(x?.id) === varId);
    if (byId) return byId;
  }

  // 2) SKU exacto
  if (rawLocalSku) {
    const bySku = variations.filter((v: any) => {
      const rawRemoteSku = mlVariationSkuFromApi(v).trim();
      return rawRemoteSku && skusCompatible(rawLocalSku, rawRemoteSku);
    });
    if (bySku.length === 1) return bySku[0];
    if (bySku.length > 1) {
      const colorN = String(link.color ?? '').trim();
      const sizeRaw = String(link.size ?? '').trim();
      if (colorN || sizeRaw) {
        const narrowed = bySku.filter((v: any) => {
          const { color, size } = mlVariationColorSizeFromApi(v);
          const colorOk = !colorN || colorCompatible(colorN, color);
          const sizeOk = !sizeRaw || sizesCompatible(sizeRaw, size);
          return colorOk && sizeOk;
        });
        if (narrowed.length === 1) return narrowed[0];
      }
      return null;
    }
  }

  // 3) color + talle
  const colorN = String(link.color ?? '').trim();
  const sizeRaw = String(link.size ?? '').trim();
  if (!colorN || !sizeRaw) return null;

  let pool = variations;
  if (rawLocalSku) {
    const remotesWithSku = variations.filter((v: any) => !!mlVariationSkuFromApi(v).trim());
    // Si hay SKUs remotos y ninguno matcheó en (2), solo considerar:
    // - variaciones sin SKU, o
    // - SKU del mismo artículo (formato distinto).
    // Si todas tienen SKU de otro artículo → abortar (evita pisar stock ajeno).
    if (remotesWithSku.length > 0) {
      pool = variations.filter((v: any) => {
        const remoteSku = mlVariationSkuFromApi(v).trim();
        if (!remoteSku) return true;
        return sameArticleSku(rawLocalSku, remoteSku);
      });
      if (pool.length === 0) return null;
    }
  }

  const byAttrs = pool.filter((v: any) => {
    const { color, size } = mlVariationColorSizeFromApi(v);
    return colorCompatible(colorN, color) && sizesCompatible(sizeRaw, size);
  });
  if (byAttrs.length === 1) return byAttrs[0];

  return null;
}

export function resolveMlStockForVariantLink(item: any, link: MlVariantMatchLink): number | undefined {
  const variations: any[] = Array.isArray(item?.variations) ? item.variations : [];
  if (!variations.length) {
    return typeof item?.available_quantity === 'number' ? Number(item.available_quantity) : undefined;
  }
  const matched = matchMlVariationForVariantLink(variations, link);
  if (!matched) return undefined;
  return Number(matched.available_quantity ?? 0);
}

/** Completa SKU/atributos de variaciones (GET /items a menudo los omite). */
export async function enrichMlItemVariationsForMatch(
  item: any,
  accessToken: string,
  axiosGet: (url: string, config: any) => Promise<any>
): Promise<any> {
  const itemId = String(item?.id || '').trim();
  const variations = Array.isArray(item?.variations) ? item.variations : [];
  if (!itemId || variations.length === 0) return item;

  const needsEnrich = (v: any) => {
    const ac = v?.attribute_combinations;
    if (!Array.isArray(ac) || ac.length === 0) return true;
    const { color, size } = mlVariationColorSizeFromApi(v);
    return !mlVariationSkuFromApi(v) || (!color && !size);
  };

  if (!variations.some(needsEnrich)) return item;

  const headers = { Authorization: `Bearer ${accessToken}` };
  const enriched = await Promise.all(
    variations.map(async (v: any) => {
      if (!needsEnrich(v)) return v;
      const vid = v?.id;
      if (vid == null) return v;
      try {
        const r = await axiosGet(`https://api.mercadolibre.com/items/${itemId}/variations/${vid}`, {
          headers,
          validateStatus: () => true,
        });
        if (r.status === 200 && r.data) {
          return {
            ...v,
            ...r.data,
            id: v.id,
            available_quantity: v.available_quantity ?? r.data.available_quantity,
            attribute_combinations: r.data.attribute_combinations ?? v.attribute_combinations,
            attributes: r.data.attributes ?? v.attributes,
            seller_sku: r.data.seller_sku ?? v.seller_sku,
            seller_custom_field: r.data.seller_custom_field ?? v.seller_custom_field,
          };
        }
      } catch {
        /* ignorar */
      }
      return v;
    })
  );
  return { ...item, variations: enriched };
}
