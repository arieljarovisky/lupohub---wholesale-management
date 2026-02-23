const { query } = require('./backend/dist/database/db');

async function checkDatabase() {
  try {
    console.log('=== VERIFICANDO BASE DE DATOS ===\n');
    
    // Check integrations
    const integrations = await query('SELECT * FROM integrations');
    console.log('=== INTEGRACIONES ACTIVAS ===');
    integrations.forEach(row => {
      console.log(`Plataforma: ${row.platform}`);
      console.log(`User ID: ${row.user_id}`);
      console.log(`Access Token: ${row.access_token ? 'Sí' : 'No'}`);
      console.log(`Refresh Token: ${row.refresh_token ? 'Sí' : 'No'}`);
      console.log(`Expira: ${row.expires_at}`);
      console.log(`Actualizado: ${row.updated_at}`);
      console.log('---');
    });

    if (integrations.length === 0) {
      console.log('⚠️  No hay integraciones activas\n');
    }

    // Check products
    const products = await query('SELECT COUNT(*) as count FROM products');
    console.log(`=== PRODUCTOS ===`);
    console.log(`Total productos: ${products[0].count}`);

    // Check product variants with SKU
    const variants = await query('SELECT COUNT(*) as count FROM product_variants WHERE sku IS NOT NULL');
    console.log(`Variantes con SKU: ${variants[0].count}`);

    // Check products with Tienda Nube ID
    const tnProducts = await query('SELECT COUNT(*) as count FROM products WHERE tienda_nube_id IS NOT NULL');
    console.log(`Productos de Tienda Nube: ${tnProducts[0].count}`);

    // Check products with Mercado Libre ID
    const mlProducts = await query('SELECT COUNT(*) as count FROM products WHERE mercado_libre_id IS NOT NULL');
    console.log(`Productos de Mercado Libre: ${mlProducts[0].count}`);

    // Check variant linking
    const linkedVariants = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN tienda_nube_variant_id IS NOT NULL THEN 1 END) as tn_linked,
        COUNT(CASE WHEN mercado_libre_variant_id IS NOT NULL THEN 1 END) as ml_linked
      FROM product_variants
    `);
    console.log(`\n=== VINCULACIÓN DE VARIANTES ===`);
    console.log(`Total variantes: ${linkedVariants[0].total}`);
    console.log(`Variantes vinculadas a TN: ${linkedVariants[0].tn_linked}`);
    console.log(`Variantes vinculadas a ML: ${linkedVariants[0].ml_linked}`);

    console.log('\n=== VERIFICACIÓN COMPLETADA ===');
    
  } catch (error) {
    console.error('Error al verificar base de datos:', error.message);
    if (error.code === 'ER_NO_SUCH_TABLE') {
      console.log('⚠️  Las tablas no existen. Ejecuta las migraciones primero.');
    }
  }
  process.exit(0);
}

checkDatabase();