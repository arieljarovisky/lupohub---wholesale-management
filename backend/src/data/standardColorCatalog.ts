/**
 * Catálogo estándar de colores por código numérico (3 dígitos).
 * Se usa para poblar `colors` con nombre y hex derivado del RGB.
 */
export type StandardColorRow = { code: string; name: string; rgb: [number, number, number] };

export const STANDARD_COLOR_CATALOG: StandardColorRow[] = [
  { code: '111', name: 'Blanco', rgb: [255, 255, 255] },
  { code: '112', name: 'Natural / Crudo', rgb: [245, 240, 225] },
  { code: '183', name: 'Off White', rgb: [242, 238, 230] },
  { code: '202', name: 'Azul pastel', rgb: [173, 196, 214] },
  { code: '256', name: 'Azul acero', rgb: [91, 122, 145] },
  { code: '278', name: 'Azul marino oscuro', rgb: [33, 45, 72] },
  { code: '280', name: 'Azul marino', rgb: [28, 54, 102] },
  { code: '292', name: 'Azul petróleo', rgb: [43, 86, 92] },
  { code: '338', name: 'Verde militar', rgb: [92, 104, 74] },
  { code: '402', name: 'Verde cactus', rgb: [126, 145, 115] },
  { code: '450', name: 'Verde oliva', rgb: [96, 102, 56] },
  { code: '484', name: 'Verde oliva oscuro', rgb: [70, 78, 48] },
  { code: '502', name: 'Rosa', rgb: [201, 154, 167] },
  { code: '542', name: 'Rosa nude', rgb: [222, 188, 192] },
  { code: '570', name: 'Bordó', rgb: [117, 33, 48] },
  { code: '590', name: 'Marsala', rgb: [134, 52, 68] },
  { code: '594', name: 'Vino', rgb: [108, 38, 52] },
  { code: '596', name: 'Malva vino', rgb: [170, 128, 140] },
  { code: '600', name: 'Beige', rgb: [214, 197, 176] },
  { code: '610', name: 'Arcilla oscura', rgb: [184, 172, 156] },
  { code: '614', name: 'Arena', rgb: [207, 190, 160] },
  { code: '654', name: 'Marrón claro', rgb: [155, 122, 92] },
  { code: '661', name: 'Marrón', rgb: [118, 82, 58] },
  { code: '670', name: 'Chocolate', rgb: [82, 52, 38] },
  { code: '800', name: 'Gris jaspeado', rgb: [181, 186, 188] },
  { code: '802', name: 'Gris claro', rgb: [205, 208, 210] },
  { code: '812', name: 'Gris medio', rgb: [154, 156, 160] },
  { code: '830', name: 'Gris oscuro', rgb: [97, 99, 103] },
  { code: '860', name: 'Grafito', rgb: [69, 73, 78] },
  { code: '882', name: 'Gris carbón jaspeado', rgb: [104, 108, 112] },
  { code: '887', name: 'Chumbo oscuro', rgb: [74, 76, 79] },
  { code: '976', name: 'Negro lavado', rgb: [44, 45, 48] },
  { code: '998', name: 'Negro grafito', rgb: [26, 28, 30] },
  { code: '999', name: 'Negro', rgb: [0, 0, 0] },
];

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}
