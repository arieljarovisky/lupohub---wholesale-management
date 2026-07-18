/** Empareja variaciones de un ítem ML por variationId, SKU o color+talle. */

import { codigoTalleParaSku, nombreTalleDesdeCodigo, TALLE_CODIGO_A_NOMBRE } from '../talles-tango';

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
  // "160 - GG" / "160-GG"
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

function skusCompatible(localRaw: string, remoteRaw: string): boolean {
  const local = normSkuForMlStockMatch(localRaw);
  const remote = normSkuForMlStockMatch(remoteRaw);
  if (!local || !remote || local === '0' || remote === '0') return false;
  if (local === remote) return true;
  // Sufijo/prefijo solo si ambos son razonablemente largos (evita falsos positivos)
  if (local.length >= 8 && remote.length >= 8) {
    if (local.endsWith(remote) || remote.endsWith(local)) return true;
    if (local.includes(remote) || remote.includes(local)) return true;
  }
  return false;
}

/**
 * Empareja la variación ML correcta (evita usar el stock total del ítem cuando hay varias).
 * Si hay variationId + SKU y el SKU de esa variación no coincide, ignora el ID y busca por SKU.
 */
export function matchMlVariationForVariantLink(variations: any[], link: MlVariantMatchLink): any | null {
  if (!Array.isArray(variations) || variations.length === 0) return null;

  const rawLocalSku = String(link.sku ?? '').trim();
  const varId = link.variationId != null ? String(link.variationId).trim() : '';

  if (varId) {
    const byId = variations.find((x: any) => String(x?.id) === varId);
    if (byId) {
      if (!rawLocalSku) return byId;
      const remoteSku = mlVariationSkuFromApi(byId).trim();
      // Si la variación no tiene SKU en API, confiar en el ID; si tiene y no coincide, re-matchear.
      if (!remoteSku || skusCompatible(rawLocalSku, remoteSku)) return byId;
    }
  }

  if (rawLocalSku) {
    const bySku = variations.find((v: any) => {
      const rawRemoteSku = mlVariationSkuFromApi(v).trim();
      return rawRemoteSku && skusCompatible(rawLocalSku, rawRemoteSku);
    });
    if (bySku) return bySku;
  }

  const colorN = normTextForMlStockMatch(String(link.color ?? ''));
  const sizeRaw = String(link.size ?? '').trim();
  if (colorN || sizeRaw) {
    const byAttrs = variations.find((v: any) => {
      const { color, size } = mlVariationColorSizeFromApi(v);
      const c = normTextForMlStockMatch(color);
      const colorOk = !colorN || c === colorN || c.includes(colorN) || colorN.includes(c);
      const sizeOk = !sizeRaw || sizesCompatible(sizeRaw, size);
      return colorOk && sizeOk;
    });
    if (byAttrs) return byAttrs;
  }
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
