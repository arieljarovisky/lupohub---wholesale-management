/** Fecha de pedido / listado: DD/MM/YYYY sin hora. */
export function formatOrderDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const s = String(dateStr).trim();
  const dateOnly = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) {
    const [y, m, d] = dateOnly[1].split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (!isNaN(dt.getTime())) {
      return dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
  }
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return s.slice(0, 10);
  return dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
