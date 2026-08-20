import { Request, Response } from 'express';
import axios from 'axios';
import { get } from '../database/db';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const TN_BASE = 'https://api.tiendanube.com/v1';

function lang(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const v = obj.es ?? obj.pt ?? obj.en ?? Object.values(obj)[0];
    return v != null ? String(v) : '';
  }
  return String(value);
}

/** Código de artículo desde SKU de variante (ej. 3350-01-130-280 → 3350-01). */
function deriveArticleSku(sku: string): string {
  const s = (sku || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{3,6}-\d{2,3})/);
  if (m) return m[1];
  const parts = s.split('-');
  if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return `${parts[0]}-${parts[1]}`;
  }
  return s;
}

function csvEscape(value: string): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function productSku(p: any): string {
  const variants = Array.isArray(p?.variants) ? p.variants : [];
  for (const v of variants) {
    const sku = String(v?.sku ?? '').trim();
    if (sku) return deriveArticleSku(sku) || sku;
  }
  return '';
}

function productUrl(p: any): string {
  const raw = p?.canonical_url || p?.url || '';
  return String(raw || '').trim();
}

/**
 * CSV: product_id,name,sku,url — una fila por producto publicado en Tienda Nube.
 * GET /integrations/tiendanube/products-csv-export
 * Query opcional: published=true|false|all (default true)
 */
export const exportTiendaNubeProductsCsv = async (req: Request, res: Response) => {
  try {
    const integration = await get(
      `SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`
    );
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) {
      return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
    }

    const publishedParam = String(req.query.published || 'true').trim().toLowerCase();
    const paramsBase: Record<string, string | number | boolean> = { per_page: 200 };
    if (publishedParam === 'true' || publishedParam === '1') paramsBase.published = true;
    else if (publishedParam === 'false' || publishedParam === '0') paramsBase.published = false;
    // published=all → sin filtro

    const headers = {
      Authentication: `bearer ${integration.access_token}`,
      'User-Agent': TN_USER_AGENT,
    };

    const products: any[] = [];
    let page = 1;
    while (page <= 500) {
      const response = await axios.get(`${TN_BASE}/${storeId}/products`, {
        headers,
        params: { ...paramsBase, page },
        validateStatus: () => true,
      });
      if (response.status !== 200) {
        const detail =
          response.data?.description ||
          response.data?.message ||
          response.data?.error ||
          response.statusText;
        if (page === 1) {
          return res.status(response.status >= 400 ? 502 : 500).json({
            message: 'Error consultando productos de Tienda Nube',
            detail,
          });
        }
        break;
      }
      const batch = Array.isArray(response.data) ? response.data : [];
      if (batch.length === 0) break;
      products.push(...batch);
      if (batch.length < 200) break;
      page += 1;
    }

    const lines: string[] = ['product_id,name,sku,url'];
    for (const p of products) {
      const id = p?.id != null ? String(p.id) : '';
      if (!id) continue;
      const name = lang(p?.name).replace(/\s+/g, ' ').trim();
      const sku = productSku(p);
      const url = productUrl(p);
      lines.push([csvEscape(id), csvEscape(name), csvEscape(sku), csvEscape(url)].join(','));
    }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const body = lines.join('\n') + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="productos_tiendanube_${stamp}.csv"`);
    // BOM para que Excel abra bien UTF-8
    res.send('\uFEFF' + body);
  } catch (error: any) {
    console.error('exportTiendaNubeProductsCsv:', error?.response?.data || error.message);
    res.status(500).json({ message: error.message || 'Error al exportar productos de Tienda Nube' });
  }
};
