type TnLevel = { location_id?: string; stock?: unknown };

function levelStock(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** Stock que muestra Tienda Nube: suma de sucursales, o el campo stock si no hay ubicaciones. */
export function readTnVariantStock(variant: any): number | null {
  const levels: TnLevel[] = Array.isArray(variant?.inventory_levels) ? variant.inventory_levels : [];
  if (levels.length > 0) {
    let sum = 0;
    let any = false;
    for (const lv of levels) {
      if (lv?.stock === '' || lv?.stock == null) continue;
      const n = Number(lv.stock);
      if (!Number.isFinite(n)) continue;
      sum += n;
      any = true;
    }
    if (any) return sum;
  }
  if (variant?.stock === '' || variant?.stock == null) return null;
  const n = Number(variant.stock);
  return Number.isFinite(n) ? n : null;
}

/**
 * Cuerpo del PUT. Con varias sucursales el número visible es la suma:
 * se ajusta la primera para que el total coincida con LupoHub.
 * Si las demás ya superan ese total, se dejan en 0 y todo el stock va a la primera.
 */
export function buildTnStockUpdateBody(desired: number, variant: any): Record<string, unknown> {
  const qty = Math.max(0, Math.floor(Number(desired) || 0));
  const levels: TnLevel[] = Array.isArray(variant?.inventory_levels) ? variant.inventory_levels : [];
  if (levels.length === 0) return { stock: qty };

  const parsed = levels.map((lv) => ({
    location_id:
      lv?.location_id != null && String(lv.location_id).trim() ? String(lv.location_id).trim() : undefined,
    stock: levelStock(lv?.stock),
  }));
  const others = parsed.slice(1).reduce((sum, lv) => sum + lv.stock, 0);
  const wipeOthers = qty - others < 0;

  return {
    inventory_levels: parsed.map((lv, i) => {
      const stock = wipeOthers ? (i === 0 ? qty : 0) : i === 0 ? qty - others : lv.stock;
      return lv.location_id ? { location_id: lv.location_id, stock } : { stock };
    }),
  };
}
