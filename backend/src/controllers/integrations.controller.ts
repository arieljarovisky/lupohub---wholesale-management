import { Request, Response } from 'express';
import axios from 'axios';
import { execute, query, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

const ML_AUTH_URL = 'https://auth.mercadolibre.com.ar/authorization';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

const TN_AUTH_URL = 'https://www.tiendanube.com/apps/authorize';
const TN_TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token';
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';

/** URL del frontend para redirigir después del OAuth (producción: tu dominio Vercel). */
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

// Función para obtener un token válido de Mercado Libre (refresca automáticamente si expiró)
async function getValidMLToken(): Promise<{ access_token: string; user_id: string } | null> {
  const integration = await get(`SELECT access_token, refresh_token, expires_at, user_id FROM integrations WHERE platform = 'mercadolibre'`);
  
  if (!integration) {
    return null;
  }

  const now = new Date();
  const expiresAt = new Date(integration.expires_at);
  
  // Si el token expira en menos de 10 minutos, refrescarlo
  const bufferTime = 10 * 60 * 1000; // 10 minutos
  if (expiresAt.getTime() - now.getTime() < bufferTime) {
    console.log('[ML Token] Token expirando pronto, refrescando...');
    
    const appId = process.env.MERCADO_LIBRE_APP_ID;
    const clientSecret = process.env.MERCADO_LIBRE_CLIENT_SECRET;
    
    if (!appId || !clientSecret || !integration.refresh_token) {
      console.error('[ML Token] No se puede refrescar: faltan credenciales o refresh_token');
      return null;
    }

    try {
      const response = await axios.post(ML_TOKEN_URL, {
        grant_type: 'refresh_token',
        client_id: appId,
        client_secret: clientSecret,
        refresh_token: integration.refresh_token
      });

      const { access_token, refresh_token, expires_in } = response.data;
      const newExpiresAt = new Date(Date.now() + expires_in * 1000);

      // Actualizar en la base de datos
      await execute(`
        UPDATE integrations 
        SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE platform = 'mercadolibre'
      `, [access_token, refresh_token, newExpiresAt]);

      console.log('[ML Token] Token refrescado exitosamente, expira:', newExpiresAt);
      
      return { access_token, user_id: integration.user_id };
    } catch (error: any) {
      console.error('[ML Token] Error refrescando token:', error.response?.data || error.message);
      return null;
    }
  }

  return { access_token: integration.access_token, user_id: integration.user_id };
}

export const getIntegrationStatus = async (req: Request, res: Response) => {
  try {
    const integrations = await query('SELECT platform, updated_at FROM integrations');
    const status = {
      mercadolibre: integrations.find((i: any) => i.platform === 'mercadolibre') ? true : false,
      tiendanube: integrations.find((i: any) => i.platform === 'tiendanube') ? true : false,
    };
    res.json(status);
  } catch (error) {
    console.error('Error getting integration status:', error);
    res.status(500).json({ message: 'Error getting integration status' });
  }
};

// Mercado Libre
export const getMercadoLibreAuthUrl = (req: Request, res: Response) => {
  const appId = process.env.MERCADO_LIBRE_APP_ID;
  // Use HTTPS for ngrok or production, but allow env override
  const redirectUri = process.env.MERCADO_LIBRE_REDIRECT_URI || 'https://dignifiedly-overgifted-ellsworth.ngrok-free.dev/api/integrations/mercadolibre/callback';
  
  if (!appId) {
    return res.status(500).json({ message: 'Mercado Libre App ID not configured' });
  }

  const url = `${ML_AUTH_URL}?response_type=code&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.json({ url });
};

export const handleMercadoLibreCallback = async (req: Request, res: Response) => {
  const { code } = req.query;
  const appId = process.env.MERCADO_LIBRE_APP_ID;
  const clientSecret = process.env.MERCADO_LIBRE_CLIENT_SECRET;
  const redirectUri = process.env.MERCADO_LIBRE_REDIRECT_URI || 'https://dignifiedly-overgifted-ellsworth.ngrok-free.dev/api/integrations/mercadolibre/callback';

  if (!code || !appId || !clientSecret) {
    return res.status(400).send('Missing code or configuration');
  }

  try {
    const response = await axios.post(ML_TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: appId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    const { access_token, refresh_token, expires_in, user_id } = response.data;
    
    // Calculate expiration time
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Save or update token
    await execute(`
      INSERT INTO integrations (platform, access_token, refresh_token, expires_at, user_id)
      VALUES ('mercadolibre', ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      access_token = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      expires_at = VALUES(expires_at),
      user_id = VALUES(user_id),
      updated_at = CURRENT_TIMESTAMP
    `, [access_token, refresh_token, expiresAt, user_id]);

    // Redirect to frontend settings page with success
    res.redirect(`${FRONTEND_URL}/#settings?status=success&platform=mercadolibre`);
  } catch (error: any) {
    console.error('Error in Mercado Libre callback:', error.response?.data || error.message);
    res.redirect(`${FRONTEND_URL}/#settings?status=error&platform=mercadolibre`);
  }
};

// Tienda Nube
export const getTiendaNubeAuthUrl = (req: Request, res: Response) => {
  const appId = process.env.TIENDA_NUBE_APP_ID;
  
  if (!appId) {
    return res.status(500).json({ message: 'Tienda Nube App ID not configured' });
  }

  // https://www.tiendanube.com/apps/<app_id>/authorize?response_type=code&scope=write_products,read_products
  
  const redirectUri = process.env.TIENDA_NUBE_REDIRECT_URI || 'http://localhost:3010/api/integrations/tiendanube/callback';
  const url = `https://www.tiendanube.com/apps/${appId}/authorize?response_type=code&scope=write_products,read_products&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.json({ url });
};

export const handleTiendaNubeCallback = async (req: Request, res: Response) => {
  const { code } = req.query;
  const appId = process.env.TIENDA_NUBE_APP_ID;
  const clientSecret = process.env.TIENDA_NUBE_CLIENT_SECRET;
  const redirectUri = process.env.TIENDA_NUBE_REDIRECT_URI || 'http://localhost:3010/api/integrations/tiendanube/callback';

  if (!code || !appId || !clientSecret) {
    return res.status(400).send('Missing code or configuration');
  }

  try {
    const response = await axios.post(TN_TOKEN_URL, {
      client_id: appId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    });

    const { access_token, user_id, scope } = response.data;
    
    // Tienda Nube tokens might not expire in the same way, or they might. The response usually has expires_in.
    // If not provided, we assume it's long-lived or handled differently.
    // Let's assume standard OAuth 2.0.
    const expires_in = response.data.expires_in || 31536000; // Default to 1 year if not provided
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // En Tienda Nube, user_id es el store_id
    await execute(`
      INSERT INTO integrations (platform, access_token, refresh_token, expires_at, user_id, store_id)
      VALUES ('tiendanube', ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      access_token = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      expires_at = VALUES(expires_at),
      user_id = VALUES(user_id),
      store_id = VALUES(store_id),
      updated_at = CURRENT_TIMESTAMP
    `, [access_token, response.data.refresh_token || null, expiresAt, user_id, user_id]);

    // Registrar webhook para order/paid y descontar stock automáticamente al vender
    const backendUrl = (process.env.BACKEND_URL || process.env.API_URL || '').replace(/\/$/, '');
    if (backendUrl && backendUrl.startsWith('https://')) {
      const webhookUrl = `${backendUrl}/api/integrations/tiendanube/webhook`;
      try {
        await axios.post(
          `https://api.tiendanube.com/v1/${user_id}/webhooks`,
          { event: 'order/paid', url: webhookUrl },
          { headers: { 'Authentication': `bearer ${access_token}`, 'User-Agent': TN_USER_AGENT } }
        );
        console.log('[TN] Webhook order/paid registrado:', webhookUrl);
      } catch (whErr: any) {
        const msg = whErr.response?.data?.url?.[0] || whErr.response?.data?.event?.[0] || whErr.message;
        console.warn('[TN] No se pudo registrar webhook (puede existir ya):', msg);
      }
    } else {
      console.warn('[TN] Configure BACKEND_URL (HTTPS) en .env para activar descuento de stock automático por ventas.');
    }

    res.redirect(`${FRONTEND_URL}/#settings?status=success&platform=tiendanube`);
  } catch (error: any) {
    console.error('Error in Tienda Nube callback:', error.response?.data || error.message);
    res.redirect(`${FRONTEND_URL}/#settings?status=error&platform=tiendanube`);
  }
};

export const updateMercadoLibreStock = async (sku: string, newStock: number) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) return;

    const { access_token, user_id } = mlToken;

    // 1. Search item by SKU (seller_custom_field)
    // ML API to search items by SKU is tricky, usually we search by item_id.
    // Assuming we don't have item_id mapped in DB yet, we might need to search.
    // Or if we have mapped it, use it.
    
    // For now, let's assume we need to search or we rely on 'mercadolibre_id' in products table if it was mapped.
    // But stock is per variant.
    // We need to know the ML Variation ID.
    
    // Simplification: Log that we would update ML here.
    // To do this properly we need to store ML Item ID and Variation ID in product_variants.
    console.log(`[ML Sync] Would update SKU ${sku} to stock ${newStock}`);
    
    // Actual implementation requires:
    // 1. GET /users/{user_id}/items/search?seller_sku={sku} -> Get Item ID
    // 2. GET /items/{item_id} -> Find Variation ID matching SKU
    // 3. PUT /items/{item_id}/variations/{variation_id} { available_quantity: newStock }
    
    // Since we don't have this mapping fully robust yet, we'll implement a best-effort search.
    const searchRes = await axios.get(`https://api.mercadolibre.com/users/${user_id}/items/search`, {
        headers: { Authorization: `Bearer ${access_token}` },
        params: { seller_sku: sku }
    });
    
    if (searchRes.data.results && searchRes.data.results.length > 0) {
        const itemId = searchRes.data.results[0];
        // Fetch item details to find variation
        const itemRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        
        const variations = itemRes.data.variations;
        let variationId = null;
        
        if (variations && variations.length > 0) {
            const targetVar = variations.find((v: any) => v.seller_custom_field === sku);
            if (targetVar) variationId = targetVar.id;
        }
        
        if (variationId) {
            // Update Variation Stock
            await axios.put(`https://api.mercadolibre.com/items/${itemId}/variations/${variationId}`, {
                available_quantity: newStock
            }, {
                headers: { Authorization: `Bearer ${access_token}` }
            });
            console.log(`[ML Sync] Updated Item ${itemId} Variation ${variationId} to ${newStock}`);
        } else if (!variations || variations.length === 0) {
            // Update Item Stock (if no variations)
            await axios.put(`https://api.mercadolibre.com/items/${itemId}`, {
                available_quantity: newStock
            }, {
                headers: { Authorization: `Bearer ${access_token}` }
            });
            console.log(`[ML Sync] Updated Item ${itemId} to ${newStock}`);
        }
    }
    
  } catch (error: any) {
    console.error(`[ML Sync Error] SKU ${sku}:`, error.response?.data || error.message);
  }
};

export const syncProductsFromTiendaNube = async (req: Request, res: Response) => {
  try {
    // 1. Get Access Token
    const integration = await get(`SELECT * FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration || !integration.access_token) {
      return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
    }

    const { access_token, user_id: store_id } = integration;

    // 2. Fetch Products from Tienda Nube
    // Pagination loop
    let page = 1;
    let hasMore = true;
    let importedCount = 0;
    let updatedCount = 0;
    
    // Log array to return to frontend
    const logs: string[] = [];
    const log = (msg: string) => {
        console.log(msg);
        logs.push(msg);
    };

    const perPage = 200; // API Tienda Nube permite hasta 200 por página
    while (hasMore) {
      try {
        const response = await axios.get(`https://api.tiendanube.com/v1/${store_id}/products`, {
          headers: {
            'Authentication': `bearer ${access_token}`,
            'User-Agent': TN_USER_AGENT
          },
          params: {
            page,
            per_page: perPage
          }
        });

        const products = response.data;
        if (products.length === 0) {
          hasMore = false;
          break;
        }
        log(`[Sync] Página ${page}: ${products.length} productos`);
        if (products.length < perPage) {
          hasMore = false;
        }

        // Process each product
        for (const tnProduct of products) {
          try {
            log(`[Sync] Processing Product: ${tnProduct.name.es || tnProduct.name} (ID: ${tnProduct.id})`);
            
            const sku = tnProduct.variants?.[0]?.sku || `TN-${tnProduct.id}`;
            
            let existingProduct = await get(`SELECT * FROM products WHERE tienda_nube_id = ?`, [tnProduct.id]);
            if (!existingProduct && sku) {
                 existingProduct = await get(`SELECT * FROM products WHERE sku = ?`, [sku]);
            }
            let productId = existingProduct?.id;
            if (existingProduct) {
              await execute(`
                UPDATE products SET 
                name = ?, 
                tienda_nube_id = ?,
                description = COALESCE(?, description)
                WHERE id = ?
              `, [tnProduct.name.es || tnProduct.name.pt || tnProduct.name, tnProduct.id, tnProduct.description?.es || '', productId]);
              updatedCount++;
            } else {
              productId = uuidv4();
              await execute(`
                INSERT INTO products (id, sku, name, category, base_price, description, tienda_nube_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `, [
                productId, 
                sku, 
                tnProduct.name.es || tnProduct.name.pt || tnProduct.name, 
                'General',
                Number(tnProduct.variants?.[0]?.price || 0),
                tnProduct.description?.es || '',
                tnProduct.id
              ]);
              importedCount++;
            }
  
            // Atributos del producto en Tienda Nube: cada índice corresponde a variant.values[i]
            // e.g. attributes: [{ es: "Color" }, { es: "Talle" }] -> values[0]=color, values[1]=talle
            const productAttributes = tnProduct.attributes || [];
            const isSizeAttr = (name: string) => /talle|talla|size|tamano|tamaño/i.test(name);
            const isColorAttr = (name: string) => /color|colour|cor/i.test(name);
            // Detectar si un valor parece ser un talle típico
            const looksLikeSize = (val: string) => {
              const v = val.trim().toUpperCase();
              // Talles comunes: U, P, M, G, GG, XG, XXG, XXXG, S, L, XL, XXL, números
              return /^(U|P|M|G|GG|XG|XXG|XXXG|S|L|XL|XXL|XXXL|\d+)$/i.test(v);
            };

            const processedVariantIds: string[] = [];
            for (const variant of tnProduct.variants) {
              try {
                const values = variant.values || [];
                log(`  [Variant] ID: ${variant.id}, SKU: ${variant.sku}, Stock: ${variant.stock}, Values: ${JSON.stringify(values)}`);
                
                let sizeName = 'U';
                let colorName = 'Único';
                if (values.length > 0) {
                  const sizeParts: string[] = [];
                  const colorParts: string[] = [];
                  for (let i = 0; i < values.length; i++) {
                    const attr = productAttributes[i];
                    const attrName = (attr && (attr.es || attr.en || attr.pt || (typeof attr === 'string' ? attr : '')))?.toString().trim() || '';
                    const val = (values[i]?.es ?? values[i]?.pt ?? values[i]?.en ?? values[i])?.toString().trim() || '';
                    if (!val) continue;
                    if (isSizeAttr(attrName)) {
                      sizeParts.push(val);
                    } else if (isColorAttr(attrName)) {
                      colorParts.push(val);
                    } else {
                      // Sin nombre de atributo reconocido: detectar por el valor
                      if (looksLikeSize(val)) {
                        sizeParts.push(val);
                      } else {
                        colorParts.push(val);
                      }
                    }
                  }
                  if (sizeParts.length > 0) sizeName = sizeParts.join(' ');
                  if (colorParts.length > 0) colorName = colorParts.join(' ');
                  // Si no se detectó nada, usar el primer valor como color y 'U' como talle
                  if (sizeName === 'U' && colorName === 'Único' && values.length > 0) {
                    const firstVal = values[0]?.es || values[0]?.pt || values[0];
                    if (firstVal) {
                      if (looksLikeSize(firstVal)) {
                        sizeName = firstVal;
                      } else {
                        colorName = firstVal;
                      }
                    }
                  }
                }
  
                let colorId = null;
                let colorRow = await get(`SELECT id FROM colors WHERE name = ?`, [colorName]);
                if (!colorRow) {
                  colorId = `c-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                  let code = colorName.substring(0, 50).toUpperCase();
                  try {
                    await execute(`INSERT INTO colors (id, name, code, hex) VALUES (?, ?, ?, ?)`, [colorId, colorName, code, '#000000']);
                  } catch (e: any) {
                    if (e.code === 'ER_DUP_ENTRY') {
                      code = code.substring(0, 45) + Math.floor(Math.random() * 1000);
                      try {
                        await execute(`INSERT INTO colors (id, name, code, hex) VALUES (?, ?, ?, ?)`, [colorId, colorName, code, '#000000']);
                      } catch (e2: any) {
                        console.error(`Failed to insert color ${colorName}`, e2);
                      }
                    } else if (e.code === 'ER_BAD_FIELD_ERROR') {
                      await execute(`INSERT INTO colors (id, name, code) VALUES (?, ?, ?)`, [colorId, colorName, code]);
                    } else {
                      throw e;
                    }
                  }
                } else {
                  colorId = colorRow.id;
                }
  
                let sizeId = null;
                const safeSizeCode = sizeName.substring(0, 100); 
                let sizeRow = await get(`SELECT id FROM sizes WHERE size_code = ?`, [safeSizeCode]);
                if (!sizeRow) {
                  sizeId = `s-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                  try {
                    await execute(`INSERT INTO sizes (id, size_code, name) VALUES (?, ?, ?)`, [sizeId, safeSizeCode, sizeName]);
                  } catch (e: any) {
                    if (e.code === 'ER_BAD_FIELD_ERROR') {
                      await execute(`INSERT INTO sizes (id, size_code) VALUES (?, ?)`, [sizeId, safeSizeCode]);
                    } else if (e.code === 'ER_DUP_ENTRY') {
                      const existing = await get(`SELECT id FROM sizes WHERE size_code = ?`, [safeSizeCode]);
                      sizeId = existing?.id;
                    } else {
                      throw e;
                    }
                  }
                } else {
                  sizeId = sizeRow.id;
                }
  
                let productColorRow = await get(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]);
                let productColorId = productColorRow?.id;
                if (!productColorId) {
                  productColorId = uuidv4();
                  await execute(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
                }
  
                let variantRow = await get(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`, [productColorId, sizeId]);
                let localVariantId = variantRow?.id;
                if (!localVariantId) {
                  localVariantId = uuidv4();
                  await execute(`
                    INSERT INTO product_variants (id, product_color_id, size_id, tienda_nube_variant_id, sku) 
                    VALUES (?, ?, ?, ?, ?)
                  `, [localVariantId, productColorId, sizeId, variant.id, variant.sku || null]);
                } else {
                  await execute(`UPDATE product_variants SET tienda_nube_variant_id = ?, sku = ? WHERE id = ?`, [variant.id, variant.sku || null, localVariantId]);
                }
                processedVariantIds.push(localVariantId);
  
                const stock = variant.stock !== null && variant.stock !== undefined ? Number(variant.stock) : 0;
                await execute(`
                  INSERT INTO stocks (variant_id, stock) VALUES (?, ?)
                  ON DUPLICATE KEY UPDATE stock = VALUES(stock)
                `, [localVariantId, stock]);
  
                if (variant.sku) {
                  updateMercadoLibreStock(variant.sku, stock).catch(e => console.error(e));
                }
              } catch (variantErr: any) {
                log(`[ERROR] Variant ${variant.id}: ${variantErr?.response?.data?.message || variantErr?.message || 'Error desconocido'}`);
              }
            }
            if (processedVariantIds.length > 0 && productId) {
              try {
                await execute(`
                  DELETE st FROM stocks st
                  JOIN product_variants pv ON st.variant_id = pv.id
                  JOIN product_colors pc ON pv.product_color_id = pc.id
                  WHERE pc.product_id = ? AND pv.id NOT IN (${processedVariantIds.map(() => '?').join(',')})
                `, [productId, ...processedVariantIds]);
                await execute(`
                  DELETE pv FROM product_variants pv
                  JOIN product_colors pc ON pv.product_color_id = pc.id
                  WHERE pc.product_id = ? AND pv.id NOT IN (${processedVariantIds.map(() => '?').join(',')})
                `, [productId, ...processedVariantIds]);
                await execute(`
                  DELETE pc FROM product_colors pc
                  LEFT JOIN product_variants pv ON pv.product_color_id = pc.id
                  WHERE pc.product_id = ? AND pv.id IS NULL
                `, [productId]);
                log(`  [Cleanup] Eliminadas variantes locales no presentes en Tienda Nube para producto ${tnProduct.id}`);
              } catch (cleanupErr: any) {
                log(`[ERROR] Cleanup producto ${tnProduct.id}: ${cleanupErr?.message || 'Error desconocido'}`);
              }
            }
          } catch (prodErr: any) {
            log(`[ERROR] Product ${tnProduct?.id}: ${prodErr?.response?.data?.message || prodErr?.message || 'Error desconocido'}`);
          }
        }

        page++;
        // Safety break (hasta 200 páginas = 40.000 productos)
        if (page > 200) hasMore = false; 
      } catch (error: any) {
        // If 404, likely means page out of range or end of list
        if (error.response?.status === 404) {
          hasMore = false;
        } else {
          throw error;
        }
      }
    }

    res.json({ message: 'Sincronización completada', imported: importedCount, updated: updatedCount, logs });

  } catch (error: any) {
    console.error('Error syncing products:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error sincronizando productos', error: error.message });
  }
};

/** Talles estándar para el público: P, M, G, GG, XG, XXG, XXXG (+ U para único) */
const STANDARD_SIZES = ['P', 'M', 'G', 'GG', 'XG', 'XXG', 'XXXG', 'U'] as const;

/** Mapeo de nombres comunes a talle estándar (clave en mayúsculas/normalizada) */
function normalizeSizeToStandard(raw: string): string {
  const v = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!v) return 'U';
  // Ya estándar
  if (STANDARD_SIZES.includes(v as any)) return v;
  // Único / sin talla
  if (/^U$|UNICO|ÚNICO|LISO|UNICA|ÚNICA/i.test(v)) return 'U';
  // Pequeño
  if (/^P$|^S$|^PP$|^XS$|^1$|^2$|^34$|^36$|^35$|^XXS$/i.test(v)) return 'P';
  // Mediano
  if (/^M$|^3$|^4$|^38$|^40$/i.test(v)) return 'M';
  // Grande
  if (/^G$|^L$|^5$|^6$|^42$|^44$/i.test(v)) return 'G';
  if (/^GG$|^7$|^8$|^46$/i.test(v)) return 'GG';
  // Extra grande
  if (/^XG$|^XL$|^9$|^10$|^48$/i.test(v)) return 'XG';
  if (/^XXG$|^XXL$|^11$|^12$|^50$/i.test(v)) return 'XXG';
  if (/^XXXG$|^XXXL$|^13$|^52$/i.test(v)) return 'XXXG';
  // Por texto
  if (/EXTRA\s*GRANDE|XXL|XX\s*L/i.test(v) && !/XXX/i.test(v)) return 'XXG';
  if (/XXX|TRIPLE/i.test(v)) return 'XXXG';
  if (/XL|EXTRA\s*LARGE/i.test(v)) return 'XG';
  if (/GRANDE|LARGE|^L$/i.test(v)) return 'G';
  if (/MEDIANO|MEDIUM|^M$/i.test(v)) return 'M';
  if (/PEQUEÑO|SMALL|^S$|^P$/i.test(v)) return 'P';
  return v; // dejar como está si no hay match
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export const normalizeSizesInTiendaNube = async (req: Request, res: Response) => {
  try {
    const integration = await get(`SELECT * FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration || !integration.access_token) {
      return res.status(400).json({ message: 'No estás conectado a Tienda Nube' });
    }
    const { access_token, user_id: store_id } = integration;
    const logs: string[] = [];
    const log = (msg: string) => {
      console.log(msg);
      logs.push(msg);
    };
    let updatedVariants = 0;
    let skippedProducts = 0;
    let page = 1;
    let hasMore = true;
    const isSizeAttr = (name: string) => /talle|talla|size|tamano|tamaño/i.test(name);

    while (hasMore) {
      const response = await axios.get(`https://api.tiendanube.com/v1/${store_id}/products`, {
        headers: { 'Authentication': `bearer ${access_token}`, 'User-Agent': TN_USER_AGENT },
        params: { page, per_page: 50 }
      });
      const products = response.data;
      if (!products?.length) {
        hasMore = false;
        break;
      }
      for (const tnProduct of products) {
        const productAttributes = tnProduct.attributes || [];
        let sizeAttrIndex = -1;
        for (let i = 0; i < productAttributes.length; i++) {
          const attr = productAttributes[i];
          const name = (attr?.es ?? attr?.en ?? attr?.pt ?? (typeof attr === 'string' ? attr : '')).toString();
          if (isSizeAttr(name)) {
            sizeAttrIndex = i;
            break;
          }
        }
        if (sizeAttrIndex === -1) {
          skippedProducts++;
          continue;
        }
        for (const variant of tnProduct.variants || []) {
          const values = variant.values || [];
          if (sizeAttrIndex >= values.length) continue;
          const sizeVal = values[sizeAttrIndex];
          const current = (sizeVal?.es ?? sizeVal?.pt ?? sizeVal?.en ?? sizeVal)?.toString().trim() || '';
          const normalized = normalizeSizeToStandard(current);
          if (normalized === current) continue;
          const newValues = values.map((obj: any, i: number) => {
            if (i !== sizeAttrIndex) return obj;
            const langKeys = obj && typeof obj === 'object' ? Object.keys(obj) : ['es'];
            const next: Record<string, string> = {};
            for (const lang of langKeys) next[lang] = normalized;
            return next;
          });
          try {
            await axios.put(
              `https://api.tiendanube.com/v1/${store_id}/products/${tnProduct.id}/variants/${variant.id}`,
              { values: newValues },
              { headers: { 'Authentication': `bearer ${access_token}`, 'User-Agent': TN_USER_AGENT } }
            );
            updatedVariants++;
            log(`  [TN] Producto ${tnProduct.id} variante ${variant.id}: "${current}" → "${normalized}"`);
            await delay(250);
          } catch (err: any) {
            log(`  [ERROR] Variante ${variant.id}: ${err.response?.data?.description || err.message}`);
          }
        }
      }
      page++;
      if (page > 100) hasMore = false;
    }

    res.json({
      message: 'Normalización de talles en Tienda Nube completada',
      updatedVariants,
      skippedProducts,
      logs
    });
  } catch (error: any) {
    console.error('Error normalizing sizes:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error normalizando talles en Tienda Nube', error: error.message });
  }
};

export const disconnectIntegration = async (req: Request, res: Response) => {
  const { platform } = req.params as { platform: 'mercadolibre' | 'tiendanube' };
  if (!platform || !['mercadolibre', 'tiendanube'].includes(platform)) {
    return res.status(400).json({ message: 'Plataforma inválida' });
  }
  try {
    await execute(`DELETE FROM integrations WHERE platform = ?`, [platform]);
    return res.json({ message: 'Desconectado', platform });
  } catch (error: any) {
    return res.status(500).json({ message: 'Error desconectando', error: error.message });
  }
};

export const testMercadoLibreConnection = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'No estás conectado a Mercado Libre o el token no se pudo refrescar',
        details: 'No se encontró token de acceso válido'
      });
    }
    
    const { access_token, user_id } = mlToken;
    
    // Obtener fecha de expiración actual
    const integration = await get(`SELECT expires_at FROM integrations WHERE platform = 'mercadolibre'`);
    
    // Probar la conexión obteniendo información del usuario
    const userRes = await axios.get(`https://api.mercadolibre.com/users/${user_id}`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    // Obtener cantidad de publicaciones
    const itemsRes = await axios.get(`https://api.mercadolibre.com/users/${user_id}/items/search`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    res.json({ 
      success: true, 
      message: 'Conexión exitosa (token auto-renovable)',
      details: {
        userId: user_id,
        nickname: userRes.data.nickname,
        email: userRes.data.email,
        country: userRes.data.country_id,
        totalItems: itemsRes.data.paging?.total || itemsRes.data.results?.length || 0,
        expiresAt: integration?.expires_at ? new Date(integration.expires_at).toLocaleString() : 'N/A'
      }
    });
  } catch (error: any) {
    console.error('Error testing ML connection:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Error de conexión',
      details: error.response?.data?.message || error.message
    });
  }
};

export const debugMercadoLibreItem = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ error: 'No hay integración con ML o token inválido' });
    }
    
    const { access_token, user_id } = mlToken;
    
    // Obtener el primer item
    const searchRes = await axios.get(`https://api.mercadolibre.com/users/${user_id}/items/search?limit=1`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    const itemId = searchRes.data.results?.[0];
    if (!itemId) {
      return res.json({ message: 'No hay publicaciones' });
    }
    
    // Obtener detalles del item
    const itemRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    const item = itemRes.data;
    const firstVariation = item.variations?.[0];
    
    res.json({
      itemId: item.id,
      title: item.title,
      seller_custom_field: item.seller_custom_field,
      seller_sku: item.seller_sku,
      variation_count: item.variations?.length || 0,
      first_variation: firstVariation ? {
        id: firstVariation.id,
        seller_custom_field: firstVariation.seller_custom_field,
        seller_sku: firstVariation.seller_sku,
        attributes: firstVariation.attributes,
        attribute_combinations: firstVariation.attribute_combinations,
        all_keys: Object.keys(firstVariation)
      } : null,
      item_attributes: item.attributes?.filter((a: any) => 
        a.id?.includes('SKU') || a.id?.includes('GTIN') || a.id?.includes('CODE')
      )
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message, details: error.response?.data });
  }
};

export const syncProductsFromMercadoLibre = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No estás conectado a Mercado Libre o el token expiró' });
    }
    const { access_token, user_id } = mlToken;
    const logs: string[] = [];
    let linkedVariants = 0;
    let linkedProducts = 0;
    let notFound = 0;
    
    logs.push(`[ML] User ID: ${user_id}`);
    logs.push(`[ML] Token válido (auto-refrescado si necesario)`);
    
    let realUserId = user_id;
    
    // Obtener todos los items del usuario
    let searchRes;
    let allItems: string[] = [];
    let offset = 0;
    const limit = 50;
    
    try {
      // Paginar para obtener todos los items
      do {
        searchRes = await axios.get(`https://api.mercadolibre.com/users/${realUserId}/items/search?limit=${limit}&offset=${offset}`, {
          headers: { Authorization: `Bearer ${access_token}` }
        });
        const results = searchRes.data.results || [];
        allItems = allItems.concat(results);
        logs.push(`[ML] Página ${Math.floor(offset/limit) + 1}: ${results.length} items (total acumulado: ${allItems.length})`);
        offset += limit;
        
        // Continuar si hay más items
        const total = searchRes.data.paging?.total || 0;
        if (offset >= total || results.length === 0) break;
      } while (offset < 500); // Máximo 500 items para evitar timeout
      
    } catch (searchError: any) {
      logs.push(`[ML ERROR] Error buscando items: ${searchError.response?.data?.message || searchError.message}`);
      logs.push(`[ML ERROR] Status: ${searchError.response?.status}`);
      logs.push(`[ML ERROR] URL: https://api.mercadolibre.com/users/${realUserId}/items/search`);
      return res.json({ 
        message: 'Error obteniendo publicaciones de ML', 
        linkedVariants: 0, 
        linkedProducts: 0,
        notFound: 0,
        totalItems: 0,
        logs 
      });
    }
    
    const items: string[] = allItems;
    logs.push(`[ML] Total encontradas: ${items.length} publicaciones en Mercado Libre`);
    
    // Procesar items en lotes usando multiget para mayor velocidad
    const batchSize = 20;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      logs.push(`\n[ML] Procesando lote ${Math.floor(i/batchSize) + 1}/${Math.ceil(items.length/batchSize)} (${batch.length} items)`);
      
      try {
        // Usar multiget para obtener varios items a la vez
        const multigetRes = await axios.get(`https://api.mercadolibre.com/items?ids=${batch.join(',')}`, {
          headers: { Authorization: `Bearer ${access_token}` }
        });
        
        const itemsData = multigetRes.data || [];
        
        for (const itemWrapper of itemsData) {
          if (itemWrapper.code !== 200 || !itemWrapper.body) {
            logs.push(`  [Error] Item ${itemWrapper.id || 'desconocido'}: código ${itemWrapper.code}`);
            continue;
          }
          
          const mlItem = itemWrapper.body;
          const variations = mlItem.variations || [];
          const itemTitle = mlItem.title || mlItem.id;
          
          if (variations.length > 0) {
            // Item con variaciones
            let variantesVinculadas = 0;
            let variantesNoEncontradas = 0;
            
            // Extraer número de artículo del título (ej: "Art.5690" -> "5690")
            const artMatch = itemTitle.match(/Art\.?\s*(\d+)/i) || itemTitle.match(/Modelo?\s*(\d+)/i) || itemTitle.match(/(\d{3,})/);
            const artNumber = artMatch ? artMatch[1] : null;
            
            // Buscar producto por número de artículo en el nombre o SKU
            let productMatch: any = null;
            if (artNumber) {
              productMatch = await get(
                `SELECT id, sku, name FROM products WHERE sku LIKE ? OR name LIKE ? LIMIT 1`,
                [`%${artNumber}%`, `%${artNumber}%`]
              );
            }
            
            for (const v of variations) {
              // Buscar SKU en múltiples campos posibles de ML
              const mlSku = v.seller_custom_field 
                || v.seller_sku 
                || (v.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name)
                || '';
              
              // Extraer color y talle de attribute_combinations
              const attrCombs = v.attribute_combinations || [];
              const mlColor = attrCombs.find((a: any) => a.id === 'COLOR')?.value_name || '';
              const mlSize = attrCombs.find((a: any) => a.id === 'SIZE')?.value_name || '';
              
              let row: any = null;
              
              // Método 1: Buscar por SKU si existe
              if (mlSku) {
                row = await get(
                  `SELECT pv.id AS variant_id, pc.product_id AS product_id 
                   FROM product_variants pv 
                   JOIN product_colors pc ON pv.product_color_id = pc.id 
                   WHERE pv.sku = ?`,
                  [mlSku]
                );
              }
              
              // Método 2: Buscar por producto + color + talle
              if (!row && productMatch?.id && (mlColor || mlSize)) {
                row = await get(
                  `SELECT pv.id AS variant_id, pc.product_id AS product_id 
                   FROM product_variants pv 
                   JOIN product_colors pc ON pv.product_color_id = pc.id 
                   JOIN colors c ON pc.color_id = c.id
                   JOIN sizes s ON pv.size_id = s.id
                   WHERE pc.product_id = ? 
                     AND (UPPER(c.name) LIKE ? OR UPPER(c.code) LIKE ?)
                     AND UPPER(s.size_code) = ?
                   LIMIT 1`,
                  [productMatch.id, `%${mlColor.toUpperCase()}%`, `%${mlColor.toUpperCase()}%`, mlSize.toUpperCase()]
                );
              }
              
              // Método 3: Buscar solo por producto + talle (si el color no matchea)
              if (!row && productMatch?.id && mlSize) {
                row = await get(
                  `SELECT pv.id AS variant_id, pc.product_id AS product_id 
                   FROM product_variants pv 
                   JOIN product_colors pc ON pv.product_color_id = pc.id 
                   JOIN sizes s ON pv.size_id = s.id
                   WHERE pc.product_id = ? AND UPPER(s.size_code) = ?
                   LIMIT 1`,
                  [productMatch.id, mlSize.toUpperCase()]
                );
              }
              
              if (row?.variant_id) {
                await execute(`UPDATE product_variants SET mercado_libre_variant_id = ? WHERE id = ?`, [v.id, row.variant_id]);
                await execute(`UPDATE products SET mercado_libre_id = COALESCE(?, mercado_libre_id) WHERE id = ?`, [mlItem.id, row.product_id]);
                // Si el producto solo tiene código (Tango), completar nombre con el título de ML
                await execute(
                  `UPDATE products SET name = IF(COALESCE(TRIM(name), '') = '' OR name = sku, ?, name) WHERE id = ?`,
                  [itemTitle, row.product_id]
                );
                linkedVariants++;
                variantesVinculadas++;
              } else {
                notFound++;
                variantesNoEncontradas++;
              }
            }
            
            // Log resumido por item
            if (variantesVinculadas > 0) {
              logs.push(`  [OK] ${itemTitle}: ${variantesVinculadas}/${variations.length} variantes vinculadas`);
            } else if (artNumber) {
              logs.push(`  [?] ${itemTitle}: Art.${artNumber} no encontrado en BD local`);
            } else {
              logs.push(`  [X] ${itemTitle}: No se pudo extraer número de artículo`);
            }
          } else {
            // Item sin variaciones
            const mlSku = mlItem.seller_custom_field || mlItem.seller_sku || '';
            
            // Extraer número de artículo del título
            const artMatch = itemTitle.match(/Art\.?\s*(\d+)/i) || itemTitle.match(/Modelo?\s*(\d+)/i) || itemTitle.match(/(\d{3,})/);
            const artNumber = artMatch ? artMatch[1] : null;
            
            let prod: any = null;
            
            // Buscar por SKU si existe
            if (mlSku) {
              prod = await get(`SELECT id FROM products WHERE sku = ?`, [mlSku]);
              if (!prod) {
                prod = await get(`SELECT id FROM products WHERE sku LIKE ?`, [`%${mlSku}%`]);
              }
            }
            
            // Si no hay SKU, buscar por número de artículo
            if (!prod && artNumber) {
              prod = await get(
                `SELECT id FROM products WHERE sku LIKE ? OR name LIKE ? LIMIT 1`,
                [`%${artNumber}%`, `%${artNumber}%`]
              );
            }
            
            if (prod?.id) {
              await execute(`UPDATE products SET mercado_libre_id = ? WHERE id = ?`, [mlItem.id, prod.id]);
              // Si el producto solo tiene código (Tango), completar nombre con el título de ML
              await execute(
                `UPDATE products SET name = IF(COALESCE(TRIM(name), '') = '' OR name = sku, ?, name) WHERE id = ?`,
                [itemTitle, prod.id]
              );
              linkedProducts++;
              logs.push(`  [OK] ${itemTitle} vinculado`);
            } else {
              notFound++;
              logs.push(`  [X] ${itemTitle} - no encontrado`);
            }
          }
        }
      } catch (e: any) {
        logs.push(`[ML Lote Error]: ${e?.response?.data?.message || e?.message || 'Error'}`);
      }
    }
    
    logs.push(`\n========== RESUMEN ==========`);
    logs.push(`Publicaciones ML procesadas: ${items.length}`);
    logs.push(`Variantes vinculadas: ${linkedVariants}`);
    logs.push(`Productos vinculados (sin variantes): ${linkedProducts}`);
    logs.push(`No encontrados/Sin SKU: ${notFound}`);
    logs.push(``);
    logs.push(`NOTA: Si "No encontrados" es alto, verifica que:`);
    logs.push(`1. Las variantes en ML tengan el campo "SKU del vendedor" configurado`);
    logs.push(`2. Los SKUs en ML coincidan EXACTAMENTE con los de Tienda Nube`);
    logs.push(`3. Hayas importado primero los productos desde Tienda Nube`);
    
    res.json({ 
      message: 'Sincronización ML completada', 
      linkedVariants, 
      linkedProducts,
      notFound,
      totalItems: items.length,
      logs 
    });
  } catch (error: any) {
    console.error('Error sincronizando ML:', error);
    res.status(500).json({ message: 'Error sincronizando Mercado Libre', error: error.message });
  }
};

// ==================== WEBHOOKS ====================

// Webhook de Tienda Nube para órdenes/ventas
export const handleTiendaNubeWebhook = async (req: Request, res: Response) => {
  try {
    const { event, store_id } = req.body;
    console.log(`[TN Webhook] Evento: ${event}, Store: ${store_id}`);
    
    // Verificar que el store_id coincide
    const integration = await get(`SELECT store_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration || integration.store_id !== store_id?.toString()) {
      console.log('[TN Webhook] Store ID no coincide, ignorando');
      return res.status(200).json({ received: true, ignored: true });
    }

    // Procesar solo cuando la orden se paga (descontar stock una sola vez)
    if (event === 'order/paid') {
      const orderId = req.body.id ?? req.body.order_id ?? req.body.order?.id;
      if (orderId) await processTiendaNubeOrder(String(orderId));
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[TN Webhook] Error:', error.message);
    res.status(200).json({ received: true, error: error.message });
  }
};

// Procesar orden de Tienda Nube y descontar stock
const processTiendaNubeOrder = async (orderId: string) => {
  try {
    const integration = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) return;

    // Idempotencia: no descontar dos veces la misma orden (p. ej. si TN reenvía el webhook)
    const alreadyProcessed = await get(
      `SELECT id FROM stock_movements WHERE movement_type = 'VENTA_TIENDA_NUBE' AND reference = ? LIMIT 1`,
      [`Orden TN: ${orderId}`]
    );
    if (alreadyProcessed) {
      console.log(`[TN Order] Orden ${orderId} ya procesada, omitiendo`);
      return;
    }

    const orderRes = await axios.get(
      `https://api.tiendanube.com/v1/${integration.store_id}/orders/${orderId}`,
      {
        headers: {
          'Authentication': `bearer ${integration.access_token}`,
          'User-Agent': TN_USER_AGENT
        }
      }
    );

    const order = orderRes.data;
    console.log(`[TN Order] Procesando orden ${orderId}, payment_status: ${order.payment_status}`);

    // Solo descontar cuando la venta está pagada
    if (order.payment_status !== 'paid') {
      console.log(`[TN Order] Orden ${orderId} no está pagada (${order.payment_status}), ignorando`);
      return;
    }

    const { updateVariantStock } = await import('./stock.controller');

    for (const item of order.products || []) {
      const tnVariantId = item.variant_id;
      const quantity = item.quantity;
      const itemSku = (item.sku || item.variant_sku || '').toString().trim();

      let variant = null;
      if (tnVariantId) {
        variant = await get(
          `SELECT pv.id, s.stock as current_stock
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.tienda_nube_variant_id = ?`,
          [tnVariantId]
        );
      }
      if (!variant?.id && itemSku) {
        variant = await get(
          `SELECT pv.id, s.stock as current_stock
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.sku = ?`,
          [itemSku]
        );
      }
      if (!variant?.id && itemSku) {
        variant = await get(
          `SELECT pv.id, s.stock as current_stock
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           JOIN products p ON p.id = (SELECT product_id FROM product_colors WHERE id = pv.product_color_id)
           WHERE p.sku = ? OR pv.sku LIKE ?`,
          [itemSku, `${itemSku}%`]
        );
      }

      if (variant?.id) {
        const currentStock = variant.current_stock || 0;
        const newStock = Math.max(0, currentStock - quantity);
        await updateVariantStock(
          variant.id,
          newStock,
          'VENTA_TIENDA_NUBE',
          `Orden TN: ${orderId}`,
          false
        );
        console.log(`[TN Order] Descontado ${quantity} de variante ${variant.id}, stock: ${currentStock} -> ${newStock}`);
      } else {
        console.log(`[TN Order] Variante no encontrada para TN variant_id=${tnVariantId} sku=${itemSku}`);
      }
    }
  } catch (error: any) {
    console.error('[TN Order] Error procesando orden:', error.message);
  }
};

// Webhook de Mercado Libre para órdenes/ventas
export const handleMercadoLibreWebhook = async (req: Request, res: Response) => {
  try {
    const { topic, resource, user_id } = req.body;
    console.log(`[ML Webhook] Topic: ${topic}, Resource: ${resource}`);

    // Verificar que el user_id coincide
    const integration = await get(`SELECT user_id FROM integrations WHERE platform = 'mercadolibre'`);
    if (!integration || integration.user_id !== user_id?.toString()) {
      console.log('[ML Webhook] User ID no coincide, ignorando');
      return res.status(200).json({ received: true, ignored: true });
    }

    // Procesar según el tipo de notificación
    if (topic === 'orders_v2') {
      const orderId = resource.replace('/orders/', '');
      await processMercadoLibreOrder(orderId);
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[ML Webhook] Error:', error.message);
    res.status(200).json({ received: true, error: error.message });
  }
};

// Procesar orden de Mercado Libre y descontar stock
const processMercadoLibreOrder = async (orderId: string) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) return;

    const orderRes = await axios.get(
      `https://api.mercadolibre.com/orders/${orderId}`,
      {
        headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
      }
    );

    const order = orderRes.data;
    console.log(`[ML Order] Procesando orden ${orderId}, estado: ${order.status}`);

    // Solo procesar órdenes pagadas
    if (order.status !== 'paid') {
      console.log(`[ML Order] Orden ${orderId} no está pagada, ignorando`);
      return;
    }

    // Enviar mensaje de agradecimiento al comprador
    await sendThankYouMessage(orderId, order, mlToken.access_token);

    const { updateVariantStock } = await import('./stock.controller');

    for (const item of order.order_items || []) {
      const mlVariationId = item.item?.variation_id;
      const quantity = item.quantity;
      const itemSku = (item.item?.sku || item.sku || '').toString().trim();

      let variant = null;
      if (mlVariationId) {
        variant = await get(
          `SELECT pv.id, s.stock as current_stock
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.mercado_libre_variant_id = ?`,
          [mlVariationId]
        );
      }
      if (!variant?.id && itemSku) {
        variant = await get(
          `SELECT pv.id, s.stock as current_stock
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           WHERE pv.sku = ?`,
          [itemSku]
        );
      }
      if (!variant?.id && itemSku) {
        variant = await get(
          `SELECT pv.id, s.stock as current_stock
           FROM product_variants pv
           LEFT JOIN stocks s ON s.variant_id = pv.id
           JOIN product_colors pc ON pc.id = pv.product_color_id
           JOIN products p ON p.id = pc.product_id
           WHERE p.sku = ? OR pv.sku LIKE ?`,
          [itemSku, `${itemSku}%`]
        );
      }

      if (variant?.id) {
        const currentStock = variant.current_stock || 0;
        const newStock = Math.max(0, currentStock - quantity);
        await updateVariantStock(
          variant.id,
          newStock,
          'VENTA_MERCADO_LIBRE',
          `Orden ML: ${orderId}`,
          false
        );
        console.log(`[ML Order] Descontado ${quantity} de variante ${variant.id}, stock: ${currentStock} -> ${newStock}`);
      } else if (mlVariationId || itemSku) {
        console.log(`[ML Order] Variante no encontrada para ML variation_id=${mlVariationId} sku=${itemSku}`);
      }
    }
  } catch (error: any) {
    console.error('[ML Order] Error procesando orden:', error.message);
  }
};

// Enviar mensaje de agradecimiento al comprador de ML
const sendThankYouMessage = async (orderId: string, order: any, accessToken: string) => {
  try {
    // Verificar si el mensaje automático está habilitado
    const config = await get(`SELECT enabled, message_template FROM ml_auto_message_config WHERE id = 1`);
    if (config && !config.enabled) {
      console.log(`[ML Message] Mensaje automático deshabilitado, omitiendo orden ${orderId}`);
      return;
    }

    const buyerId = order.buyer?.id;
    if (!buyerId) {
      console.log(`[ML Message] No se encontró buyer_id para orden ${orderId}`);
      return;
    }

    // Verificar si ya enviamos mensaje para esta orden (evitar duplicados)
    const alreadySent = await get(
      `SELECT id FROM ml_messages_sent WHERE order_id = ?`,
      [orderId]
    );

    if (alreadySent) {
      console.log(`[ML Message] Ya se envió mensaje para orden ${orderId}, omitiendo`);
      return;
    }

    // Obtener el nombre del comprador
    const buyerName = order.buyer?.first_name || order.buyer?.nickname || 'Cliente';
    
    // Obtener los productos comprados para personalizar el mensaje
    const productNames = (order.order_items || [])
      .map((item: any) => item.item?.title)
      .filter(Boolean)
      .slice(0, 2) // Máximo 2 productos en el mensaje
      .join(' y ');

    // Usar plantilla personalizada o mensaje por defecto
    let message: string;
    if (config?.message_template) {
      message = config.message_template
        .replace('{nombre}', buyerName)
        .replace('{productos}', productNames ? ` de ${productNames}` : '');
    } else {
      message = `¡Hola ${buyerName}! 🙌

Muchas gracias por tu compra${productNames ? ` de ${productNames}` : ''}. 

Tu pedido ya está siendo preparado con mucho cuidado. Te avisaremos apenas lo despachemos.

Si tenés alguna consulta, no dudes en escribirnos. ¡Gracias por confiar en nosotros!

Saludos,
Equipo Lupo`;
    }

    // Enviar mensaje usando la API de mensajes de ML
    // La API de mensajes usa el pack_id (si existe) o el order_id
    const packId = order.pack_id || orderId;
    
    await axios.post(
      `https://api.mercadolibre.com/messages/packs/${packId}/sellers/${order.seller?.id || (await getValidMLToken())?.user_id}`,
      {
        from: {
          user_id: order.seller?.id
        },
        to: {
          user_id: buyerId
        },
        text: message
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Registrar que ya enviamos el mensaje
    await execute(
      `INSERT INTO ml_messages_sent (order_id, buyer_id, sent_at) VALUES (?, ?, NOW())`,
      [orderId, buyerId]
    );

    console.log(`[ML Message] ✓ Mensaje de agradecimiento enviado para orden ${orderId} a ${buyerName}`);
  } catch (error: any) {
    // Si la tabla no existe, crearla
    if (error.message?.includes('ml_messages_sent') || error.code === 'ER_NO_SUCH_TABLE') {
      try {
        await execute(`
          CREATE TABLE IF NOT EXISTS ml_messages_sent (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id VARCHAR(50) NOT NULL UNIQUE,
            buyer_id VARCHAR(50),
            sent_at DATETIME,
            INDEX idx_order_id (order_id)
          )
        `);
        console.log('[ML Message] Tabla ml_messages_sent creada');
      } catch (tableError) {
        console.error('[ML Message] Error creando tabla:', tableError);
      }
    }
    
    // Log del error pero no fallar el proceso principal
    console.error(`[ML Message] Error enviando mensaje para orden ${orderId}:`, error.response?.data || error.message);
  }
};

// Sincronizar todo el stock local a Tienda Nube
export const syncAllStockToTiendaNube = async (req: Request, res: Response) => {
  try {
    const integration = await get(`SELECT access_token, store_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token || !integration?.store_id) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }

    const variants = await query(`
      SELECT pv.id, pv.tienda_nube_variant_id, p.tienda_nube_id, s.stock, pv.sku,
             COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack
      FROM product_variants pv
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN stocks s ON s.variant_id = pv.id
      WHERE pv.tienda_nube_variant_id IS NOT NULL AND p.tienda_nube_id IS NOT NULL
    `);

    let updated = 0;
    let errors = 0;
    const logs: string[] = [];

    for (const v of variants) {
      try {
        const pack = Math.max(1, Number((v as any).tn_pack) || 1);
        const stockToSend = Math.floor(Number(v.stock || 0) / pack);
        await axios.put(
          `https://api.tiendanube.com/v1/${integration.store_id}/products/${v.tienda_nube_id}/variants/${v.tienda_nube_variant_id}`,
          { stock: stockToSend },
          {
            headers: {
              'Authentication': `bearer ${integration.access_token}`,
              'Content-Type': 'application/json',
              'User-Agent': TN_USER_AGENT
            }
          }
        );
        updated++;
        logs.push(`[OK] ${v.sku}: ${v.stock || 0} un. → ${stockToSend} (pack x${pack})`);
      } catch (e: any) {
        errors++;
        logs.push(`[ERROR] ${v.sku}: ${e.response?.data?.description || e.message}`);
      }
    }

    res.json({
      message: 'Sincronización completada',
      updated,
      errors,
      total: variants.length,
      logs
    });
  } catch (error: any) {
    console.error('Error syncing stock to TN:', error);
    res.status(500).json({ message: 'Error sincronizando stock', error: error.message });
  }
};

// Sincronizar stock de la app hacia Mercado Libre (app = fuente de verdad). Usa la misma lógica que updateMercadoLibreStockByVariant (subrecurso + fallback PUT item).
export const syncAllStockToMercadoLibre = async (req: Request, res: Response) => {
  try {
    const { updateMercadoLibreStockByVariant } = await import('./stock.controller');
    const variants = await query(`
      SELECT pv.id, pv.mercado_libre_variant_id, p.mercado_libre_id, s.stock, pv.sku,
             COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
      FROM product_variants pv
      JOIN product_colors pc ON pc.id = pv.product_color_id
      JOIN products p ON p.id = pc.product_id
      LEFT JOIN stocks s ON s.variant_id = pv.id
      WHERE pv.mercado_libre_variant_id IS NOT NULL AND p.mercado_libre_id IS NOT NULL
    `);

    let updated = 0;
    let errors = 0;
    const logs: string[] = [];

    for (const v of variants) {
      const pack = Math.max(1, Number((v as any).ml_pack) || 1);
      const stockToSend = Math.floor(Number(v.stock || 0) / pack);
      const ok = await updateMercadoLibreStockByVariant(
        v.mercado_libre_id,
        v.mercado_libre_variant_id,
        stockToSend
      );
      if (ok) {
        updated++;
        logs.push(`[OK] ${v.sku}: ${v.stock || 0} un. → ${stockToSend} (pack x${pack})`);
      } else {
        errors++;
        logs.push(`[ERROR] ${v.sku}: no se pudo actualizar`);
      }
    }

    res.json({
      message: 'Stock sincronizado a Mercado Libre',
      updated,
      errors,
      total: variants.length,
      logs
    });
  } catch (error: any) {
    console.error('Error syncing stock to ML:', error);
    res.status(500).json({ message: 'Error sincronizando stock a Mercado Libre', error: error.message });
  }
};

// Opcional: importar stock desde Mercado Libre a la app (útil para alinear una vez o si ML fue actualizado fuera de la app)
export const importStockFromMercadoLibre = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }
    const { updateVariantStock } = await import('./stock.controller');

    let updated = 0;
    let errors = 0;
    const logs: string[] = [];
    const limit = 50;
    let offset = 0;

    while (true) {
      const itemsRes = await axios.get(
        `https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=active&offset=${offset}&limit=${limit}`,
        { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } }
      );
      const itemIds: string[] = itemsRes.data.results || [];
      if (itemIds.length === 0) break;

      const batchSize = 10;
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batch = itemIds.slice(i, i + batchSize);
        const itemPromises = batch.map((itemId: string) =>
          axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
            headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
          }).then(r => r.data).catch(() => null)
        );
        const items = await Promise.all(itemPromises);

        for (const item of items) {
          if (!item) continue;
          if (item.variations && item.variations.length > 0) {
            for (const v of item.variations) {
              const mlQty = v.available_quantity ?? 0;
              const row = await get(
                `SELECT pv.id as variant_id FROM product_variants pv
                 JOIN product_colors pc ON pc.id = pv.product_color_id
                 JOIN products p ON p.id = pc.product_id
                 WHERE p.mercado_libre_id = ? AND pv.mercado_libre_variant_id = ?`,
                [item.id, v.id]
              );
              if (row?.variant_id) {
                const ok = await updateVariantStock(row.variant_id, mlQty, 'IMPORTACION_ML', 'Importación desde ML', false);
                if (ok) { updated++; logs.push(`[OK] ${v.seller_custom_field || v.id}: ${mlQty}`); }
                else { errors++; logs.push(`[ERROR] ${v.seller_custom_field || v.id}`); }
              }
            }
          } else {
            const mlQty = item.available_quantity ?? 0;
            const variantRow = await get(
              `SELECT pv.id as variant_id FROM product_variants pv
               JOIN product_colors pc ON pc.id = pv.product_color_id
               JOIN products p ON p.id = pc.product_id
               WHERE p.mercado_libre_id = ? LIMIT 1`,
              [item.id]
            );
            if (variantRow?.variant_id) {
              const ok = await updateVariantStock(variantRow.variant_id, mlQty, 'IMPORTACION_ML', 'Importación desde ML', false);
              if (ok) { updated++; logs.push(`[OK] ${item.id}: ${mlQty}`); }
              else { errors++; logs.push(`[ERROR] ${item.id}`); }
            }
          }
        }
      }
      if (itemIds.length < limit) break;
      offset += limit;
    }

    res.json({
      message: 'Stock importado desde Mercado Libre',
      updated,
      errors,
      logs
    });
  } catch (error: any) {
    console.error('Error importing stock from ML:', error);
    res.status(500).json({ message: 'Error importando stock desde Mercado Libre', error: error.message });
  }
};

// ==================== ÓRDENES EXTERNAS ====================

/** Agrega cantidad vendida por variant_id desde órdenes pagadas de Tienda Nube */
async function getTiendaNubeVariantSoldMap(accessToken: string, storeId: string): Promise<Map<number, number>> {
  const soldByVariant = new Map<number, number>();
  let page = 1;
  const perPage = 50;
  while (true) {
    const res = await axios.get(`https://api.tiendanube.com/v1/${storeId}/orders`, {
      headers: { 'Authentication': `bearer ${accessToken}`, 'User-Agent': TN_USER_AGENT },
      params: { page, per_page: perPage }
    });
    const orders = res.data || [];
    if (orders.length === 0) break;
    for (const order of orders) {
      if (order.payment_status !== 'paid') continue;
      for (const line of order.products || []) {
        const vid = line.variant_id;
        if (vid == null) continue;
        const qty = Number(line.quantity) || 0;
        soldByVariant.set(vid, (soldByVariant.get(vid) || 0) + qty);
      }
    }
    if (orders.length < perPage) break;
    page++;
    if (page > 500) break;
  }
  return soldByVariant;
}

// Obtener órdenes de Tienda Nube
// Obtener stock/publicaciones de Tienda Nube (igual que getMercadoLibreStock pero para TN)
export const getTiendaNubeStock = async (req: Request, res: Response) => {
  try {
    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) {
      return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
    }

    const { offset = '0', limit = '50' } = req.query;
    const page = Math.floor(Number(offset) / Number(limit)) + 1;
    const perPage = Math.min(200, Math.max(1, parseInt(limit as string) || 50)); // API TN permite hasta 200 por página

    const [productsRes, soldMap] = await Promise.all([
      axios.get(`https://api.tiendanube.com/v1/${storeId}/products`, {
        headers: {
          'Authentication': `bearer ${integration.access_token}`,
          'User-Agent': TN_USER_AGENT
        },
        params: { page, per_page: perPage }
      }),
      getTiendaNubeVariantSoldMap(integration.access_token, storeId)
    ]);

    const products = productsRes.data || [];
    const isSizeAttr = (name: string) => /talle|talla|size|tamano|tamaño/i.test(name);
    const isColorAttr = (name: string) => /color|colour|cor/i.test(name);

    const items: any[] = [];
    for (const p of products) {
      const title = p.name?.es || p.name?.pt || p.name?.en || p.name || '';
      const attrs = p.attributes || [];
      let sizeIdx = -1;
      let colorIdx = -1;
      attrs.forEach((a: any, i: number) => {
        const n = (a?.es ?? a?.en ?? a?.pt ?? '').toString();
        if (isSizeAttr(n)) sizeIdx = i;
        if (isColorAttr(n)) colorIdx = i;
      });
      let totalStock = 0;
      let soldTotal = 0;
      const variations = (p.variants || []).map((v: any) => {
        const stock = Number(v.stock) || 0;
        totalStock += stock;
        const sold = soldMap.get(v.id) || 0;
        soldTotal += sold;
        const values = v.values || [];
        const sizeVal = sizeIdx >= 0 && sizeIdx < values.length ? (values[sizeIdx]?.es ?? values[sizeIdx]?.pt ?? values[sizeIdx]?.en ?? values[sizeIdx]) : '';
        const colorVal = colorIdx >= 0 && colorIdx < values.length ? (values[colorIdx]?.es ?? values[colorIdx]?.pt ?? values[colorIdx]?.en ?? values[colorIdx]) : '';
        const toStr = (x: any) => (x != null && typeof x === 'object' ? (x.es ?? x.pt ?? x.en) : x) ?? '';
        return {
          variationId: v.id,
          sku: v.sku || '',
          size: String(toStr(sizeVal)),
          color: String(toStr(colorVal)),
          stock,
          sold
        };
      });
      const img = (p.images && p.images[0]) ? (p.images[0].src || p.images[0].url) : '';
      items.push({
        id: String(p.id),
        title,
        status: 'active',
        price: p.variants?.[0]?.price ?? 0,
        totalStock,
        soldTotal,
        thumbnail: img,
        permalink: p.url || `https://tiendanube.com`,
        hasVariations: variations.length > 1,
        variations
      });
    }

    const totalHeader = productsRes.headers['x-total-count'] || productsRes.headers['x-total'];
    const total = totalHeader ? parseInt(String(totalHeader), 10) : items.length;
    res.json({
      items,
      total: typeof total === 'number' && !isNaN(total) ? total : items.length,
      offset: parseInt(offset as string),
      limit: perPage
    });
  } catch (error: any) {
    console.error('Error fetching TN stock:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo stock de Tienda Nube', error: error.message });
  }
};

// Totales de stock Tienda Nube (todos los productos, para las cards)
export const getTiendaNubeStockTotals = async (req: Request, res: Response) => {
  try {
    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) {
      return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
    }
    const perPage = 200;
    let page = 1;
    let hasMore = true;
    let totalProducts = 0;
    let totalStock = 0;
    let lowStockCount = 0;
    let noStockCount = 0;
    while (hasMore) {
      const response = await axios.get(`https://api.tiendanube.com/v1/${storeId}/products`, {
        headers: {
          'Authentication': `bearer ${integration.access_token}`,
          'User-Agent': TN_USER_AGENT
        },
        params: { page, per_page: perPage }
      });
      const products = response.data || [];
      if (products.length === 0) {
        hasMore = false;
        break;
      }
      for (const p of products) {
        let productStock = 0;
        for (const v of p.variants || []) {
          productStock += Number(v.stock) || 0;
        }
        totalProducts += 1;
        totalStock += productStock;
        if (productStock === 0) noStockCount += 1;
        else if (productStock < 5) lowStockCount += 1;
      }
      if (products.length < perPage) hasMore = false;
      else page++;
      if (page > 200) hasMore = false;
    }
    res.json({
      totalProducts,
      totalStock,
      lowStockCount,
      noStockCount
    });
  } catch (error: any) {
    console.error('Error fetching TN stock totals:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo totales de Tienda Nube', error: error.message });
  }
};

export const getTiendaNubeOrders = async (req: Request, res: Response) => {
  try {
    const integration = await get(`SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`);
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }
    
    // En TN, store_id es igual a user_id
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) {
      return res.status(400).json({ message: 'No se encontró el store_id de Tienda Nube' });
    }

    const { page = '1', per_page = '20', status, created_at_min, created_at_max, only_paid_pending_shipment } = req.query;
    const perPageNum = Math.min(100, Math.max(1, parseInt(per_page as string) || 20));
    const pageNum = Math.max(1, parseInt(page as string) || 1);

    let url = `https://api.tiendanube.com/v1/${storeId}/orders?page=${pageNum}&per_page=${perPageNum}`;
    if (status) {
      url += `&status=${status}`;
    }
    if (created_at_min) {
      url += `&created_at_min=${created_at_min}`;
    }
    if (created_at_max) {
      url += `&created_at_max=${created_at_max}`;
    }

    const ordersRes = await axios.get(url, {
      headers: {
        'Authentication': `bearer ${integration.access_token}`,
        'User-Agent': TN_USER_AGENT
      }
    });

    let orders = ordersRes.data.map((order: any) => {
      // Extraer nombre del cliente de diferentes fuentes
      let customerName = 'Sin nombre';
      if (order.customer) {
        if (order.customer.name) {
          customerName = order.customer.name;
        } else if (order.customer.first_name || order.customer.last_name) {
          customerName = `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim();
        }
      }
      // También intentar desde contact o billing_address
      if (customerName === 'Sin nombre' && order.contact_name) {
        customerName = order.contact_name;
      }
      if (customerName === 'Sin nombre' && order.billing_name) {
        customerName = order.billing_name;
      }
      if (customerName === 'Sin nombre' && order.shipping_address?.name) {
        customerName = order.shipping_address.name;
      }

      return {
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: order.payment_status,
      shippingStatus: order.shipping_status,
      total: order.total,
      currency: order.currency,
      customer: {
        name: customerName,
        email: order.customer?.email || order.contact_email || '',
        phone: order.customer?.phone || order.contact_phone || ''
      },
      products: (order.products || []).map((p: any) => ({
        id: p.product_id,
        variantId: p.variant_id,
        name: p.name,
        sku: p.sku,
        quantity: p.quantity,
        price: p.price
      })),
      shippingAddress: order.shipping_address ? {
        address: order.shipping_address.address,
        city: order.shipping_address.city,
        province: order.shipping_address.province,
        zipcode: order.shipping_address.zipcode
      } : null,
      createdAt: order.created_at,
      updatedAt: order.updated_at
    }});

    if (only_paid_pending_shipment === '1' || only_paid_pending_shipment === 'true') {
      orders = orders.filter((o: any) =>
        o.paymentStatus === 'paid' &&
        o.shippingStatus !== 'shipped' &&
        o.shippingStatus !== 'delivered'
      );
    }

    res.json({
      orders,
      page: pageNum,
      per_page: perPageNum,
      total: (only_paid_pending_shipment === '1' || only_paid_pending_shipment === 'true') ? orders.length : (ordersRes.headers['x-total-count'] || orders.length)
    });
  } catch (error: any) {
    console.error('Error fetching TN orders:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo órdenes de Tienda Nube', error: error.message });
  }
};

// Obtener órdenes de Mercado Libre
export const getMercadoLibreOrders = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const { offset = '0', limit = '20', status, date_from, date_to, only_pending_shipment_and_cancelled } = req.query;
    const limitNum = Math.min(Math.max(1, parseInt(limit as string) || 20), 50);
    const offsetNum = Math.max(0, parseInt(offset as string) || 0);
    const onlyPendingAndCancelled = only_pending_shipment_and_cancelled === '1' || only_pending_shipment_and_cancelled === 'true';

    const mapOrder = (order: any) => {
      let shippingStatus = order._shipment_status ?? null;
      if (!shippingStatus && order.shipping) {
        shippingStatus = order.shipping.status || order.shipping.substatus || null;
        if (!shippingStatus && order.status === 'paid' && order.shipping.id) {
          shippingStatus = 'ready_to_ship';
        }
      }
      const statusMap: Record<string, string> = {
        'to_be_agreed': 'pending', 'pending': 'pending', 'handling': 'handling',
        'ready_to_ship': 'ready_to_ship', 'shipped': 'shipped', 'delivered': 'delivered',
        'not_delivered': 'not_delivered', 'cancelled': 'cancelled'
      };
      const logisticType = order.shipping?.logistic_type || null;
      const isFlex = logisticType === 'self_service';
      return {
        id: order.id,
        status: order.status,
        statusDetail: order.status_detail,
        total: order.total_amount,
        currency: order.currency_id,
        buyer: {
          id: order.buyer?.id,
          nickname: order.buyer?.nickname,
          firstName: order.buyer?.first_name,
          lastName: order.buyer?.last_name
        },
        items: (order.order_items || []).map((item: any) => ({
          id: item.item?.id,
          title: item.item?.title,
          sku: item.item?.seller_sku || item.item?.seller_custom_field,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          variationId: item.item?.variation_id
        })),
        shipping: order.shipping ? {
          id: order.shipping.id,
          status: statusMap[shippingStatus] || shippingStatus || 'pending'
        } : null,
        isFlex,
        dateCreated: order.date_created,
        dateClosed: order.date_closed
      };
    };

    let orders: any[];
    let total: number;

    if (onlyPendingAndCancelled) {
      // Solo "por enviar": órdenes pagadas cuyo shipment está en handling o ready_to_ship (API de Shipments)
      const baseParams = `seller=${mlToken.user_id}&limit=50&sort=date_desc`;
      const dateFrom = date_from ? `&order.date_created.from=${date_from}T00:00:00.000-03:00` : '';
      const dateTo = date_to ? `&order.date_created.to=${date_to}T23:59:59.999-03:00` : '';
      const paidRes = await axios.get(
        `https://api.mercadolibre.com/orders/search?${baseParams}&order.status=paid${dateFrom}${dateTo}`,
        { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } }
      );
      const paid = paidRes.data.results || [];

      const POR_ENVIAR_STATUSES = ['handling', 'ready_to_ship'];
      const authHeader = { 'Authorization': `Bearer ${mlToken.access_token}`, 'x-format-new': 'true' };

      const getShipmentId = async (order: any): Promise<number | null> => {
        const ship = order.shipping || order.shipment;
        if (ship?.id) return ship.id;
        try {
          const det = await axios.get(`https://api.mercadolibre.com/orders/${order.id}`, {
            headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
          });
          const s = det.data?.shipping || det.data?.shipment;
          return s?.id ?? null;
        } catch {
          return null;
        }
      };

      const getShipmentStatus = async (shipmentId: number): Promise<string | null> => {
        try {
          const res = await axios.get(`https://api.mercadolibre.com/shipments/${shipmentId}`, {
            headers: authHeader
          });
          const data = res.data || {};
          const st = (data.status ?? data.substatus ?? '').toString().trim().toLowerCase();
          return st || null;
        } catch {
          try {
            const res = await axios.get(`https://api.mercadolibre.com/marketplace/shipments/${shipmentId}`, {
              headers: authHeader
            });
            const data = res.data || {};
            const st = (data.status ?? data.substatus ?? '').toString().trim().toLowerCase();
            return st || null;
          } catch {
            return null;
          }
        }
      };

      const BATCH = 5;
      const ordersPorEnviar: any[] = [];
      for (let i = 0; i < paid.length; i += BATCH) {
        const batch = paid.slice(i, i + BATCH);
        const shipmentIds = await Promise.all(batch.map(getShipmentId));
        const statuses = await Promise.all(
          shipmentIds.map((id) => (id ? getShipmentStatus(id) : Promise.resolve(null)))
        );
        batch.forEach((order: any, idx: number) => {
          const st = statuses[idx];
          if (st && POR_ENVIAR_STATUSES.includes(st)) {
            order._shipment_status = st;
            ordersPorEnviar.push(order);
          }
        });
      }

      ordersPorEnviar.sort((a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime());

      // Agrupar misma compra: mismo comprador + misma fecha/hora (al minuto) = una sola fila
      const groupKey = (o: any) => {
        const buyerId = o.buyer?.id ?? '';
        const dateStr = (o.date_created || '').toString();
        const toMinute = dateStr.slice(0, 16);
        return `${buyerId}-${toMinute}`;
      };
      const groups = new Map<string, any[]>();
      for (const o of ordersPorEnviar) {
        const key = groupKey(o);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(o);
      }

      const groupedOrders = Array.from(groups.values()).map((group) => {
        const first = group[0];
        const orderIds = group.map((o: any) => o.id);
        const allItems = group.flatMap((o: any) => o.order_items || []);
        const merged = { ...first, order_ids: orderIds, order_items: allItems };
        merged._shipment_status = first._shipment_status;
        return merged;
      });

      total = groupedOrders.length;
      orders = groupedOrders.slice(offsetNum, offsetNum + limitNum).map((o: any) => {
        const mapped = mapOrder(o);
        if (o.order_ids && o.order_ids.length > 1) {
          (mapped as any).orderIds = o.order_ids;
        }
        return mapped;
      });
    } else {
      let url = `https://api.mercadolibre.com/orders/search?seller=${mlToken.user_id}&offset=${offsetNum}&limit=${limitNum}&sort=date_desc`;
      if (status) url += `&order.status=${status}`;
      if (date_from) url += `&order.date_created.from=${date_from}T00:00:00.000-03:00`;
      if (date_to) url += `&order.date_created.to=${date_to}T23:59:59.999-03:00`;
      const ordersRes = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
      });
      const raw = ordersRes.data.results || [];
      total = ordersRes.data.paging?.total ?? raw.length;
      orders = raw.map(mapOrder);
    }

    res.json({
      orders,
      offset: offsetNum,
      limit: limitNum,
      total
    });
  } catch (error: any) {
    console.error('Error fetching ML orders:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo órdenes de Mercado Libre', error: error.message });
  }
};

// Totales de stock Mercado Libre (todas las publicaciones, para las cards)
export const getMercadoLibreStockTotals = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }
    const limit = 50;
    let offset = 0;
    let totalProducts = 0;
    let totalStock = 0;
    let lowStockCount = 0;
    let noStockCount = 0;
    while (true) {
      const itemsRes = await axios.get(
        `https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=active&offset=${offset}&limit=${limit}`,
        { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } }
      );
      const itemIds: string[] = itemsRes.data.results || [];
      if (itemIds.length === 0) break;
      const batchSize = 10;
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batch = itemIds.slice(i, i + batchSize);
        const results = await Promise.all(batch.map((id: string) =>
          axios.get(`https://api.mercadolibre.com/items/${id}`, { headers: { 'Authorization': `Bearer ${mlToken.access_token}` } }).then(r => r.data).catch(() => null)
        ));
        for (const item of results) {
          if (!item) continue;
          let productStock = 0;
          if (item.variations?.length) {
            productStock = (item.variations as any[]).reduce((s, v) => s + (v.available_quantity || 0), 0);
          } else {
            productStock = item.available_quantity || 0;
          }
          totalProducts += 1;
          totalStock += productStock;
          if (productStock === 0) noStockCount += 1;
          else if (productStock < 5) lowStockCount += 1;
        }
      }
      if (itemIds.length < limit) break;
      offset += limit;
      if (offset >= 10000) break;
    }
    res.json({ totalProducts, totalStock, lowStockCount, noStockCount });
  } catch (error: any) {
    console.error('Error fetching ML stock totals:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo totales de Mercado Libre', error: error.message });
  }
};

// Obtener stock de Mercado Libre
export const getMercadoLibreStock = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const { status = 'active', offset = '0', limit = '50' } = req.query;

    // Obtener lista de items del vendedor
    const itemsUrl = `https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?status=${status}&offset=${offset}&limit=${limit}`;
    const itemsRes = await axios.get(itemsUrl, {
      headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
    });

    const itemIds = itemsRes.data.results || [];
    
    if (itemIds.length === 0) {
      return res.json({ items: [], total: 0 });
    }

    // Obtener detalles completos de cada item (necesario para variaciones con atributos)
    const items: any[] = [];
    
    // Procesar en paralelo pero limitado a 10 concurrent requests
    const batchSize = 10;
    for (let i = 0; i < itemIds.length; i += batchSize) {
      const batch = itemIds.slice(i, i + batchSize);
      
      const itemPromises = batch.map(async (itemId: string) => {
        try {
          const itemRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
            headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
          });
          return itemRes.data;
        } catch (e) {
          console.error(`Error fetching item ${itemId}:`, e);
          return null;
        }
      });

      const batchResults = await Promise.all(itemPromises);
      
      for (const item of batchResults) {
        if (!item) continue;
        
        // Si tiene variaciones, obtener stock por variación
        if (item.variations && item.variations.length > 0) {
          let totalStock = 0;
          const variations = item.variations.map((v: any) => {
            totalStock += v.available_quantity || 0;
            
            // Extraer color y talle de los atributos
            let color = '';
            let size = '';
            (v.attribute_combinations || []).forEach((attr: any) => {
              if (attr.id === 'COLOR') color = attr.value_name;
              if (attr.id === 'SIZE') size = attr.value_name;
            });

            return {
              variationId: v.id,
              sku: v.seller_custom_field || '',
              color,
              size,
              stock: v.available_quantity || 0,
              sold: v.sold_quantity || 0
            };
          });

          items.push({
            id: item.id,
            title: item.title,
            status: item.status,
            price: item.price,
            totalStock,
            soldTotal: item.sold_quantity || 0,
            thumbnail: item.thumbnail,
            permalink: item.permalink,
            hasVariations: true,
            variations
          });
        } else {
          // Sin variaciones
          items.push({
            id: item.id,
            title: item.title,
            status: item.status,
            price: item.price,
            totalStock: item.available_quantity || 0,
            soldTotal: item.sold_quantity || 0,
            thumbnail: item.thumbnail,
            permalink: item.permalink,
            hasVariations: false,
            variations: []
          });
        }
      }
    }

    res.json({
      items,
      total: itemsRes.data.paging?.total || items.length,
      offset: parseInt(offset as string),
      limit: parseInt(limit as string)
    });
  } catch (error: any) {
    console.error('Error fetching ML stock:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo stock de Mercado Libre', error: error.message });
  }
};

// Obtener configuración de mensaje automático de ML
export const getMLAutoMessageConfig = async (req: Request, res: Response) => {
  try {
    // Crear tabla si no existe
    await execute(`
      CREATE TABLE IF NOT EXISTS ml_auto_message_config (
        id INT PRIMARY KEY DEFAULT 1,
        enabled BOOLEAN DEFAULT TRUE,
        message_template TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    const config = await get(`SELECT * FROM ml_auto_message_config WHERE id = 1`);
    
    if (!config) {
      // Insertar configuración por defecto
      const defaultMessage = `¡Hola {nombre}! 🙌

Muchas gracias por tu compra{productos}. 

Tu pedido ya está siendo preparado con mucho cuidado. Te avisaremos apenas lo despachemos.

Si tenés alguna consulta, no dudes en escribirnos. ¡Gracias por confiar en nosotros!

Saludos,
Equipo Lupo`;

      await execute(
        `INSERT INTO ml_auto_message_config (id, enabled, message_template) VALUES (1, TRUE, ?)`,
        [defaultMessage]
      );

      return res.json({
        enabled: true,
        messageTemplate: defaultMessage
      });
    }

    res.json({
      enabled: config.enabled === 1,
      messageTemplate: config.message_template
    });
  } catch (error: any) {
    console.error('Error getting ML auto message config:', error.message);
    res.status(500).json({ message: 'Error obteniendo configuración', error: error.message });
  }
};

// Guardar configuración de mensaje automático de ML
export const saveMLAutoMessageConfig = async (req: Request, res: Response) => {
  try {
    const { enabled, messageTemplate } = req.body;

    // Crear tabla si no existe
    await execute(`
      CREATE TABLE IF NOT EXISTS ml_auto_message_config (
        id INT PRIMARY KEY DEFAULT 1,
        enabled BOOLEAN DEFAULT TRUE,
        message_template TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await execute(
      `INSERT INTO ml_auto_message_config (id, enabled, message_template) 
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), message_template = VALUES(message_template)`,
      [enabled ? 1 : 0, messageTemplate]
    );

    res.json({ success: true, message: 'Configuración guardada' });
  } catch (error: any) {
    console.error('Error saving ML auto message config:', error.message);
    res.status(500).json({ message: 'Error guardando configuración', error: error.message });
  }
};
