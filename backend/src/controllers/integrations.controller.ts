import { Request, Response } from 'express';
import axios from 'axios';
import { execute, query, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

const ML_AUTH_URL = 'https://auth.mercadolibre.com.ar/authorization';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

const TN_AUTH_URL = 'https://www.tiendanube.com/apps/authorize';
const TN_TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token';

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

    await execute(`
      INSERT INTO integrations (platform, access_token, refresh_token, expires_at, user_id)
      VALUES ('tiendanube', ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      access_token = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      expires_at = VALUES(expires_at),
      user_id = VALUES(user_id),
      updated_at = CURRENT_TIMESTAMP
    `, [access_token, response.data.refresh_token || null, expiresAt, user_id]);

    res.redirect('http://localhost:3000/#settings?status=success&platform=tiendanube');
  } catch (error: any) {
    console.error('Error in Tienda Nube callback:', error.response?.data || error.message);
    res.redirect('http://localhost:3000/#settings?status=error&platform=tiendanube');
  }
};

const updateMercadoLibreStock = async (sku: string, newStock: number) => {
  try {
    const integration = await get(`SELECT * FROM integrations WHERE platform = 'mercadolibre'`);
    if (!integration || !integration.access_token) return;

    const { access_token, user_id } = integration;

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
            'User-Agent': 'LupoHub (App)'
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
          log(`[Sync] Processing Product: ${tnProduct.name.es || tnProduct.name} (ID: ${tnProduct.id})`);
          
          // Check if exists by Tienda Nube ID or SKU
          const sku = tnProduct.variants?.[0]?.sku || `TN-${tnProduct.id}`;
          
          // Find existing product
          let existingProduct = await get(`SELECT * FROM products WHERE tienda_nube_id = ?`, [tnProduct.id]);
          if (!existingProduct && sku) {
               existingProduct = await get(`SELECT * FROM products WHERE sku = ?`, [sku]);
          }

          let productId = existingProduct?.id;

          if (existingProduct) {
            // Update
            await execute(`
              UPDATE products SET 
              name = ?, 
              tienda_nube_id = ?,
              description = COALESCE(?, description)
              WHERE id = ?
            `, [tnProduct.name.es || tnProduct.name.pt || tnProduct.name, tnProduct.id, tnProduct.description?.es || '', productId]);
            updatedCount++;
          } else {
            // Create
            productId = uuidv4();
            await execute(`
              INSERT INTO products (id, sku, name, category, base_price, description, tienda_nube_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
              productId, 
              sku, 
              tnProduct.name.es || tnProduct.name.pt || tnProduct.name, 
              'General', // Default category
              Number(tnProduct.variants?.[0]?.price || 0),
              tnProduct.description?.es || '',
              tnProduct.id
            ]);
            importedCount++;
          }

          // Process Variants for BOTH New and Updated Products
          for (const variant of tnProduct.variants) {
             const values = variant.values || [];
             log(`  [Variant] ID: ${variant.id}, SKU: ${variant.sku}, Stock: ${variant.stock}, Values: ${JSON.stringify(values)}`);
             
             // 1. Identify Attributes (Size/Color)
             let sizeName = 'U';
             let colorName = 'Único';
             
             // Simple heuristic based on Tienda Nube response
             if (values.length > 0) {
               // The log shows: [{"es":"Gris"},{"es":"Floreado"},{"es":"P"}]
               // We need to assume:
               // - The LAST element is ALWAYS the Size.
               // - Everything BEFORE the last element is the Color/Pattern.
               
               // Extract Size (Last element)
               const lastVal = values[values.length - 1];
               const extractedSize = lastVal?.es || lastVal?.pt || lastVal;
               if (extractedSize) sizeName = extractedSize;
               
               // Extract Color (All elements except the last one)
               if (values.length > 1) {
                   const colorParts = values.slice(0, values.length - 1);
                   const extractedColor = colorParts.map((v: any) => v.es || v.pt || v).join(' ');
                   if (extractedColor) colorName = extractedColor;
               } else {
                   // If only 1 value, assume it's Size? Or Color?
                   // If only 1 value, usually it's Size if apparel, or Color if accessory.
                   // Let's stick to: 1 value = Size (and Color = Único), unless it looks like a color.
                   // But previously we said 1 value = Color.
                   // Let's assume 1 value = Color for now as per previous logic, or maybe Size.
                   // Wait, if 1 value: [{"es": "Rojo"}] -> Is it size Rojo or Color Rojo? Likely Color.
                   // If [{"es": "XL"}] -> Likely Size.
                   // Let's keep it simple: If 1 val, it is Color. Size is U.
                   const firstVal = values[0];
                   const val = firstVal?.es || firstVal?.pt || firstVal;
                   if (val) colorName = val;
               }
             }

             // 2. Ensure Color Exists
             let colorId = null;
             // Check exact match
             let colorRow = await get(`SELECT id FROM colors WHERE name = ?`, [colorName]);
             if (!colorRow) {
               // Create Color
               colorId = `c-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
               
               // Use a safe code derived from name, but now we have 100 chars space.
               // We can use the name as code if we want, or a shortened version.
               // Let's use the first 50 chars uppercase as code.
               let code = colorName.substring(0, 50).toUpperCase();
               
               // Try insert
               try {
                  // Assuming 'hex' column exists now due to migration
                  await execute(`INSERT INTO colors (id, name, code, hex) VALUES (?, ?, ?, ?)`, [colorId, colorName, code, '#000000']);
               } catch (e: any) {
                  if (e.code === 'ER_DUP_ENTRY') {
                     // If code duplicate, append random
                     code = code.substring(0, 45) + Math.floor(Math.random() * 1000);
                     try {
                        await execute(`INSERT INTO colors (id, name, code, hex) VALUES (?, ?, ?, ?)`, [colorId, colorName, code, '#000000']);
                     } catch (e2: any) {
                        // Fallback to finding existing by code if name failed but code exists?
                        // Or just log error.
                        console.error(`Failed to insert color ${colorName}`, e2);
                     }
                  } else {
                     // If 'hex' column is missing (migration didn't run?), fallback to old insert
                     if (e.code === 'ER_BAD_FIELD_ERROR') {
                         await execute(`INSERT INTO colors (id, name, code) VALUES (?, ?, ?)`, [colorId, colorName, code]);
                     } else {
                         throw e;
                     }
                  }
               }
             } else {
               colorId = colorRow.id;
             }

             // 3. Ensure Size Exists
               let sizeId = null;
               // Try searching by name or size_code
               // We prefer searching by 'name' if column exists, but we used 'size_code' before.
               // Let's try to query by name first if we suspect the column exists.
               // To be safe, let's query by size_code as we did, but now size_code is wider.
               // But wait, we want to store the full name in 'name' column too.
               
               // Let's try to insert using full name as size_code (up to 100 chars).
               const safeSizeCode = sizeName.substring(0, 100); 
               
               let sizeRow = await get(`SELECT id FROM sizes WHERE size_code = ?`, [safeSizeCode]);
               
               if (!sizeRow) {
                 sizeId = `s-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                 
                 try {
                    // Try inserting with name column
                    await execute(`INSERT INTO sizes (id, size_code, name) VALUES (?, ?, ?)`, [sizeId, safeSizeCode, sizeName]);
                 } catch (e: any) {
                    if (e.code === 'ER_BAD_FIELD_ERROR') {
                        // Fallback if name column missing
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

             // 4. Link Product -> Color
             let productColorRow = await get(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]);
             let productColorId = productColorRow?.id;
             
             if (!productColorId) {
               productColorId = uuidv4();
               await execute(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
             }

             // 5. Link ProductColor -> Variant (Size)
             // IMPORTANT: Check if this size already exists for this color.
             // If we have duplicate variants for same color/size (which shouldn't happen logically but might in data),
             // we should update or reuse.
             let variantRow = await get(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`, [productColorId, sizeId]);
             let localVariantId = variantRow?.id;

             if (!localVariantId) {
                localVariantId = uuidv4();
                await execute(`
                  INSERT INTO product_variants (id, product_color_id, size_id, tienda_nube_variant_id) 
                  VALUES (?, ?, ?, ?)
                `, [localVariantId, productColorId, sizeId, variant.id]);
             } else {
                await execute(`UPDATE product_variants SET tienda_nube_variant_id = ? WHERE id = ?`, [variant.id, localVariantId]);
             }

             // 6. Update Stock
             // Tienda Nube stock is usually master if we are importing.
             // If inventory_management is true OR stock is present, update it.
             // Check if stock is null or undefined, default to 0.
             const stock = variant.stock !== null && variant.stock !== undefined ? Number(variant.stock) : 0;
             
             // Debug log (optional, remove in prod)
             // console.log(`Updating stock for ${localVariantId}: ${stock}`);

             await execute(`
                INSERT INTO stocks (variant_id, stock) VALUES (?, ?)
                ON DUPLICATE KEY UPDATE stock = VALUES(stock)
             `, [localVariantId, stock]);

             // 7. Push Stock to Mercado Libre (Auto Sync)
             // Only if SKU exists and stock > 0 (or we want to zero it out too)
             if (variant.sku) {
                // Fire and forget - don't await to speed up TN sync
                updateMercadoLibreStock(variant.sku, stock).catch(e => console.error(e));
             }
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
