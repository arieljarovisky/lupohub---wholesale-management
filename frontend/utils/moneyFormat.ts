/** Importes en pesos AR: siempre 2 decimales (ej. enteros como 10.785,00). */
export function formatMoneyAr(value: number): string {
  const n = Number(value);
  if (Number.isNaN(n)) return '0,00';
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
