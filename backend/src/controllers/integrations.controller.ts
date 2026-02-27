import { Request, Response } from 'express';
import axios from 'axios';
import { execute, query, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

const ML_AUTH_URL = 'https://auth.mercadolibre.com.ar/authorization';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

const TN_AUTH_URL = 'https://www.tiendanube.com/apps/authorize';
const TN_TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token';
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';

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
    res.redirect('http://localhost:3000/#settings?status=success&platform=mercadolibre');
  } catch (error: any) {
    console.error('Error in Mercado Libre callback:', error.response?.data || error.message);
    res.redirect('http://localhost:3000/#settings?status=error&platform=mercadolibre');
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

    res.redirect('http://localhost:3000/#settings?status=success&platform=tiendanube');
  } catch (error: any) {
    console.error('Error in Tienda Nube callback:', error.response?.data || error.message);
    res.redirect('http://localhost:3000/#settings?status=error&platform=tiendanube');
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

    while (hasMore) {
      try {
        const response = await axios.get(`https://api.tiendanube.com/v1/${store_id}/products`, {
          headers: {
            'Authentication': `bearer ${access_token}`,
            'User-Agent': TN_USER_AGENT
          },
          params: {
            page,
            per_page: 50 // Max allowed usually
          }
        });

        const products = response.data;
        if (products.length === 0) {
          hasMore = false;
          break;
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
        // Safety break
        if (page > 50) hasMore = false; 
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

    // Procesar según el tipo de evento
    if (event === 'order/created' || event === 'order/paid') {
      const orderId = req.body.id;
      await processTiendaNubeOrder(orderId);
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
    console.log(`[TN Order] Procesando orden ${orderId}, estado: ${order.status}`);

    // Solo procesar órdenes pagadas o confirmadas
    if (!['paid', 'open'].includes(order.payment_status)) {
      console.log(`[TN Order] Orden ${orderId} no está pagada, ignorando`);
      return;
    }

    const { updateVariantStock, logStockMovement } = await import('./stock.controller');

    for (const item of order.products || []) {
      const tnVariantId = item.variant_id;
      const quantity = item.quantity;

      // Buscar variante local por TN variant ID
      const variant = await get(
        `SELECT pv.id, s.stock as current_stock
         FROM product_variants pv
         LEFT JOIN stocks s ON s.variant_id = pv.id
         WHERE pv.tienda_nube_variant_id = ?`,
        [tnVariantId]
      );

      if (variant?.id) {
        const currentStock = variant.current_stock || 0;
        const newStock = Math.max(0, currentStock - quantity);
        
        await updateVariantStock(
          variant.id,
          newStock,
          'VENTA_TIENDA_NUBE',
          `Orden TN: ${orderId}`,
          false // No sincronizar de vuelta a TN (ya se vendió ahí)
        );
        
        console.log(`[TN Order] Descontado ${quantity} de variante ${variant.id}, stock: ${currentStock} -> ${newStock}`);
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

    const { updateVariantStock } = await import('./stock.controller');

    for (const item of order.order_items || []) {
      const mlVariationId = item.item?.variation_id;
      const quantity = item.quantity;

      if (!mlVariationId) continue;

      // Buscar variante local por ML variation ID
      const variant = await get(
        `SELECT pv.id, s.stock as current_stock
         FROM product_variants pv
         LEFT JOIN stocks s ON s.variant_id = pv.id
         WHERE pv.mercado_libre_variant_id = ?`,
        [mlVariationId]
      );

      if (variant?.id) {
        const currentStock = variant.current_stock || 0;
        const newStock = Math.max(0, currentStock - quantity);
        
        await updateVariantStock(
          variant.id,
          newStock,
          'VENTA_MERCADO_LIBRE',
          `Orden ML: ${orderId}`,
          false // No sincronizar de vuelta a ML (ya se vendió ahí)
        );
        
        console.log(`[ML Order] Descontado ${quantity} de variante ${variant.id}, stock: ${currentStock} -> ${newStock}`);
      }
    }
  } catch (error: any) {
    console.error('[ML Order] Error procesando orden:', error.message);
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
      SELECT pv.id, pv.tienda_nube_variant_id, p.tienda_nube_id, s.stock, pv.sku
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
        await axios.put(
          `https://api.tiendanube.com/v1/${integration.store_id}/products/${v.tienda_nube_id}/variants/${v.tienda_nube_variant_id}`,
          { stock: v.stock || 0 },
          {
            headers: {
              'Authentication': `bearer ${integration.access_token}`,
              'Content-Type': 'application/json',
              'User-Agent': TN_USER_AGENT
            }
          }
        );
        updated++;
        logs.push(`[OK] ${v.sku}: ${v.stock || 0} unidades`);
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

// Sincronizar todo el stock local a Mercado Libre
export const syncAllStockToMercadoLibre = async (req: Request, res: Response) => {
  try {
    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o token inválido' });
    }

    const variants = await query(`
      SELECT pv.id, pv.mercado_libre_variant_id, p.mercado_libre_id, s.stock, pv.sku
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
      try {
        await axios.put(
          `https://api.mercadolibre.com/items/${v.mercado_libre_id}/variations/${v.mercado_libre_variant_id}`,
          { available_quantity: v.stock || 0 },
          {
            headers: {
              'Authorization': `Bearer ${mlToken.access_token}`,
              'Content-Type': 'application/json'
            }
          }
        );
        updated++;
        logs.push(`[OK] ${v.sku}: ${v.stock || 0} unidades`);
      } catch (e: any) {
        errors++;
        logs.push(`[ERROR] ${v.sku}: ${e.response?.data?.message || e.message}`);
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
    console.error('Error syncing stock to ML:', error);
    res.status(500).json({ message: 'Error sincronizando stock', error: error.message });
  }
};

// ==================== ÓRDENES EXTERNAS ====================

// Obtener órdenes de Tienda Nube
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

    const { page = '1', per_page = '20', status, created_at_min, created_at_max } = req.query;

    let url = `https://api.tiendanube.com/v1/${storeId}/orders?page=${page}&per_page=${per_page}`;
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

    const orders = ordersRes.data.map((order: any) => {
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

    res.json({
      orders,
      page: parseInt(page as string),
      per_page: parseInt(per_page as string),
      total: ordersRes.headers['x-total-count'] || orders.length
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

    const { offset = '0', limit = '20', status, date_from, date_to } = req.query;

    let url = `https://api.mercadolibre.com/orders/search?seller=${mlToken.user_id}&offset=${offset}&limit=${limit}&sort=date_desc`;
    if (status) {
      url += `&order.status=${status}`;
    }
    if (date_from) {
      url += `&order.date_created.from=${date_from}T00:00:00.000-03:00`;
    }
    if (date_to) {
      url += `&order.date_created.to=${date_to}T23:59:59.999-03:00`;
    }

    const ordersRes = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
    });

    const orders = (ordersRes.data.results || []).map((order: any) => {
      // Determinar estado del envío
      let shippingStatus = null;
      if (order.shipping) {
        // El status puede venir en diferentes lugares
        shippingStatus = order.shipping.status || order.shipping.substatus || null;
        
        // Si no hay status, inferir del estado de la orden
        if (!shippingStatus) {
          if (order.status === 'paid' && order.shipping.id) {
            shippingStatus = 'ready_to_ship';
          }
        }
      }
      
      // Mapear estados de ML a nuestros estados
      const statusMap: Record<string, string> = {
        'to_be_agreed': 'pending',
        'pending': 'pending',
        'handling': 'handling',
        'ready_to_ship': 'ready_to_ship',
        'shipped': 'shipped',
        'delivered': 'delivered',
        'not_delivered': 'not_delivered',
        'cancelled': 'cancelled'
      };

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
        dateCreated: order.date_created,
        dateClosed: order.date_closed
      };
    });

    res.json({
      orders,
      offset: parseInt(offset as string),
      limit: parseInt(limit as string),
      total: ordersRes.data.paging?.total || orders.length
    });
  } catch (error: any) {
    console.error('Error fetching ML orders:', error.response?.data || error.message);
    res.status(500).json({ message: 'Error obteniendo órdenes de Mercado Libre', error: error.message });
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

    // Obtener detalles de los items (máximo 20 por request con multiget)
    const items: any[] = [];
    for (let i = 0; i < itemIds.length; i += 20) {
      const batch = itemIds.slice(i, i + 20);
      const multigetUrl = `https://api.mercadolibre.com/items?ids=${batch.join(',')}&attributes=id,title,available_quantity,sold_quantity,status,price,permalink,thumbnail,variations`;
      
      const detailsRes = await axios.get(multigetUrl, {
        headers: { 'Authorization': `Bearer ${mlToken.access_token}` }
      });

      for (const result of detailsRes.data) {
        if (result.code === 200 && result.body) {
          const item = result.body;
          
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
