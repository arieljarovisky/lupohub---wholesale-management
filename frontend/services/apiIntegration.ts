import { Product, ApiConfig } from '../types';

// Helper to get config from localStorage (in a real app, this might come from a secure backend or context)
export const getApiConfig = (): ApiConfig => {
  const configStr = localStorage.getItem('lupo_api_config');
  return configStr ? JSON.parse(configStr) : {
    tiendaNube: { accessToken: '', storeId: '', userAgent: '' },
    mercadoLibre: { accessToken: '', userId: '' }
  };
};

export const saveApiConfig = (config: ApiConfig) => {
  localStorage.setItem('lupo_api_config', JSON.stringify(config));
};

// --- TIENDA NUBE API ---

export const fetchTiendaNubeProducts = async () => {
  const { tiendaNube } = getApiConfig();
  if (!tiendaNube.accessToken || !tiendaNube.storeId) throw new Error("Faltan credenciales de Tienda Nube");

  try {
    const response = await fetch(`https://api.tiendanube.com/v1/${tiendaNube.storeId}/products`, {
      headers: {
        'Authentication': `bearer ${tiendaNube.accessToken}`,
        'User-Agent': tiendaNube.userAgent || 'LupoHub (demo)'
      }
    });

    if (!response.ok) throw new Error(`TN Error: ${response.statusText}`);
    return await response.json();
  } catch (error) {
    console.error("Error fetching TN products:", error);
    throw error;
  }
};

export const updateTiendaNubeStock = async (product: Product, newStock: number) => {
  const { tiendaNube } = getApiConfig();
  // We need the external IDs to update specific variants
  if (!tiendaNube.accessToken || !product.externalIds?.tiendaNube || !product.externalIds?.tiendaNubeVariant) {
    console.warn("Skipping TN update: Missing credentials or external IDs for", product.sku);
    return;
  }

  try {
    const response = await fetch(`https://api.tiendanube.com/v1/${tiendaNube.storeId}/products/${product.externalIds.tiendaNube}/variants/${product.externalIds.tiendaNubeVariant}`, {
      method: 'PUT',
      headers: {
        'Authentication': `bearer ${tiendaNube.accessToken}`,
        'User-Agent': tiendaNube.userAgent || 'LupoHub (demo)',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        stock: newStock
      })
    });

    if (!response.ok) throw new Error(`TN Update Error: ${await response.text()}`);
    console.log(`Tienda Nube Stock Updated for ${product.sku}: ${newStock}`);
    return true;
  } catch (error) {
    console.error("Failed to update TN stock:", error);
    return false;
  }
};

// --- MERCADO LIBRE API ---

export const fetchMercadoLibreItems = async () => {
  const { mercadoLibre } = getApiConfig();
  if (!mercadoLibre.accessToken || !mercadoLibre.userId) throw new Error("Faltan credenciales de Mercado Libre");

  try {
    // 1. Get Item IDs
    const searchRes = await fetch(`https://api.mercadolibre.com/users/${mercadoLibre.userId}/items/search`, {
      headers: { 'Authorization': `Bearer ${mercadoLibre.accessToken}` }
    });
    const searchData = await searchRes.json();
    
    if (!searchData.results || searchData.results.length === 0) return [];

    // 2. Get Item Details (Chunked in real life, simplified here)
    const ids = searchData.results.join(',');
    const itemsRes = await fetch(`https://api.mercadolibre.com/items?ids=${ids}`, {
      headers: { 'Authorization': `Bearer ${mercadoLibre.accessToken}` }
    });
    
    return await itemsRes.json();
  } catch (error) {
    console.error("Error fetching ML items:", error);
    throw error;
  }
};

export const updateMercadoLibreStock = async (product: Product, newStock: number) => {
  const { mercadoLibre } = getApiConfig();
  if (!mercadoLibre.accessToken || !product.externalIds?.mercadoLibre) {
    console.warn("Skipping ML update: Missing credentials or external IDs for", product.sku);
    return;
  }

  try {
    // Note: If product has variations, endpoint changes to /items/{id}/variations/{var_id}
    // Assuming simple item for demo or main item ID
    const response = await fetch(`https://api.mercadolibre.com/items/${product.externalIds.mercadoLibre}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${mercadoLibre.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        available_quantity: newStock
      })
    });

    if (!response.ok) throw new Error(`ML Update Error: ${await response.text()}`);
    console.log(`Mercado Libre Stock Updated for ${product.sku}: ${newStock}`);
    return true;
  } catch (error) {
    console.error("Failed to update ML stock:", error);
    return false;
  }
};

// --- UNIFIED SYNC ---

export const syncAllStock = async (products: Product[]) => {
  const results = { success: 0, failed: 0, details: [] as string[] };
  
  for (const p of products) {
    // Sync Tienda Nube
    if (p.integrations?.tiendaNube) {
      const tnSuccess = await updateTiendaNubeStock(p, p.stock);
      if (tnSuccess) results.success++; else results.failed++;
    }
    
    // Sync Mercado Libre
    if (p.integrations?.mercadoLibre) {
      const mlSuccess = await updateMercadoLibreStock(p, p.stock);
      if (mlSuccess) results.success++; else results.failed++;
    }
  }
  
  return results;
};
