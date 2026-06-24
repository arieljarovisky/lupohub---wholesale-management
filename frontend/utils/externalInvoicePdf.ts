import { api } from '../services/api';
import { getRemitente } from '../services/apiIntegration';
import { buildExternalChannelFacturaHtml } from './wholesaleInvoiceHtml';

/** Abre la factura AFIP de TN/ML en una pestaña nueva para imprimir o guardar como PDF. */
export async function openExternalInvoicePdf(invoiceId: string): Promise<void> {
  const data = await api.getExternalInvoicePrintData(invoiceId);
  let remitenteServer: Awaited<ReturnType<typeof api.getRemitenteServer>> | null = null;
  try {
    remitenteServer = await api.getRemitenteServer();
  } catch {
    remitenteServer = null;
  }
  const localRemitente = getRemitente();
  const remitente = {
    ...localRemitente,
    ...(remitenteServer || {}),
  };
  const html = buildExternalChannelFacturaHtml({
    invoice: data.invoice,
    products: data.products,
    remitente,
  });
  const w = window.open('', '_blank');
  if (!w) {
    throw new Error('El navegador bloqueó la ventana. Permití popups para este sitio e intentá de nuevo.');
  }
  w.document.write(html);
  w.document.close();
}
