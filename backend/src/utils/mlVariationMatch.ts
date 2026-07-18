/** Empareja variaciones de un ítem ML por variationId, SKU o color+talle. */

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

/** Empareja la variación ML correcta (evita usar el stock total del ítem cuando hay varias). */
export function matchMlVariationForVariantLink(variations: any[], link: MlVariantMatchLink): any | null {
  if (!Array.isArray(variations) || variations.length === 0) return null;
  const varId = link.variationId != null ? String(link.variationId).trim() : '';
  if (varId) {
    const byId = variations.find((x: any) => String(x?.id) === varId);
    if (byId) return byId;
  }
  const rawLocalSku = String(link.sku ?? '').trim();
  if (rawLocalSku) {
    const localSku = normSkuForMlStockMatch(rawLocalSku);
    const bySku = variations.find((v: any) => {
      const rawRemoteSku = mlVariationSkuFromApi(v).trim();
      return rawRemoteSku && normSkuForMlStockMatch(rawRemoteSku) === localSku;
    });
    if (bySku) return bySku;
  }
  const colorN = normTextForMlStockMatch(String(link.color ?? ''));
  const sizeN = normTextForMlStockMatch(String(link.size ?? ''));
  if (colorN || sizeN) {
    const byAttrs = variations.find((v: any) => {
      const { color, size } = mlVariationColorSizeFromApi(v);
      const c = normTextForMlStockMatch(color);
      const s = normTextForMlStockMatch(size);
      return (!colorN || c === colorN) && (!sizeN || s === sizeN);
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
