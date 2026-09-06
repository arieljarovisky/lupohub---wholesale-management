/** Códigos AFIP WSFEX (FEXGetPARAM_DST_pais) — destino del comprobante E. */
export const AFIP_DST_TIERRA_DEL_FUEGO = 250;

/** Lista fallback si AFIP no responde (incluye zonas argentinas especiales). */
export const AFIP_EXPORT_DST_FALLBACK: { code: number; name: string }[] = [
  { code: AFIP_DST_TIERRA_DEL_FUEGO, name: 'AAE Tierra del Fuego - ARGENTINA' },
  { code: 256, name: 'ZF Córdoba - ARGENTINA' },
  { code: 257, name: 'ZF Mendoza - ARGENTINA' },
  { code: 259, name: 'ZF Comodoro Rivadavia - ARGENTINA' },
  { code: 212, name: 'Estados Unidos' },
  { code: 203, name: 'Brasil' },
  { code: 225, name: 'Uruguay' },
  { code: 208, name: 'Chile' },
  { code: 224, name: 'Paraguay' },
  { code: 218, name: 'México' },
  { code: 204, name: 'Colombia' },
];

export function parseAfipDstPaisResponse(raw: unknown): { code: number; name: string }[] {
  const parsed: { code: number; name: string }[] = [];
  const seen = new Set<number>();

  const pushPais = (code: unknown, name: unknown) => {
    const c = Number(code);
    const n = String(name ?? '').trim();
    if (!Number.isFinite(c) || c <= 0 || !n || seen.has(c)) return;
    seen.add(c);
    parsed.push({ code: c, name: n });
  };

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;

    const dstCode = o.DST_Codigo ?? o.DST_codigo ?? o.Dst_codigo ?? o.dst_codigo ?? o.Dst_Cmp;
    const dstName =
      o.DST_Ds ?? o.DST_ds ?? o.Dst_Ds ?? o.dst_ds ?? o.Descripcion ?? o.DST_Descripcion;
    if (dstCode != null && dstName != null) {
      pushPais(dstCode, dstName);
    }

    if (o.CliCodigo != null) pushPais(o.CliCodigo, o.CliDescripcion);

    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };

  walk(raw);
  parsed.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return parsed;
}

export function mergeAfipExportDestinos(
  fromAfip: { code: number; name: string }[]
): { code: number; name: string }[] {
  const map = new Map<number, string>();
  for (const p of AFIP_EXPORT_DST_FALLBACK) map.set(p.code, p.name);
  for (const p of fromAfip) map.set(p.code, p.name);
  return Array.from(map.entries())
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
