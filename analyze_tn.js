const { query } = require('./backend/dist/database/db');

async function checkTiendaNubeData() {
  try {
    console.log('=== ANALIZANDO DATOS DE TIENDA NUBE ===\n');
    
    // Check if we have any products with SKU in their variants
    const variantsWithSKU = await query(`
      SELECT 
        pv.id,
        pv.sku,
        pv.tienda_nube_variant_id,
        p.name as product_name,
        p.tienda_nube_id,
        c.name as color_name,
        s.name as size_name
      FROM product_variants pv
      JOIN product_colors pc ON pv.product_color_id = pc.id
      JOIN products p ON pc.product_id = p.id
      JOIN colors c ON pc.color_id = c.id
      JOIN sizes s ON pv.size_id = s.id
      WHERE pv.sku IS NOT NULL
      LIMIT 10
    `);

    console.log(`=== VARIANTES CON SKU (${variantsWithSKU.length} encontradas) ===`);
    if (variantsWithSKU.length === 0) {
      console.log('⚠️  No se encontraron variantes con SKU');
    } else {
      variantsWithSKU.forEach(v => {
        console.log(`Producto: ${v.product_name}`);
        console.log(`  Variante: ${v.color_name} / ${v.size_name}`);
        console.log(`  SKU: ${v.sku}`);
        console.log(`  TN Variant ID: ${v.tienda_nube_variant_id}`);
        console.log('---');
      });
    }

    // Check if any products have SKU at product level
    const productsWithSKU = await query(`
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.tienda_nube_id,
        COUNT(pv.id) as variant_count
      FROM products p
      LEFT JOIN product_colors pc ON p.id = pc.product_id
      LEFT JOIN product_variants pv ON pc.id = pv.product_color_id
      WHERE p.sku IS NOT NULL AND p.tienda_nube_id IS NOT NULL
      GROUP BY p.id
      LIMIT 5
    `);

    console.log('\n=== PRODUCTOS CON SKU ===');
    productsWithSKU.forEach(p => {
      console.log(`Producto: ${p.name}`);
      console.log(`  SKU: ${p.sku}`);
      console.log(`  TN ID: ${p.tienda_nube_id}`);
      console.log(`  Variantes: ${p.variant_count}`);
      console.log('---');
    });

    // Check raw Tienda Nube data structure
    console.log('\n=== ESTRUCTURA DE DATOS TN ===');
    console.log('Productos con TN ID:', await query('SELECT COUNT(*) as count FROM products WHERE tienda_nube_id IS NOT NULL'));
    console.log('Variantes con TN Variant ID:', await query('SELECT COUNT(*) as count FROM product_variants WHERE tienda_nube_variant_id IS NOT NULL'));
    console.log('Variantes con SKU:', await query('SELECT COUNT(*) as count FROM product_variants WHERE sku IS NOT NULL'));

    console.log('\n=== RECOMENDACIÓN ===');
    console.log('Como Tienda Nube no está proporcionando SKU en las variantes,');
    console.log('necesitamos usar el SKU del producto principal + color + tamaño');
    console.log('para generar SKU únicos para cada variante.');

  } catch (error) {
    console.error('Error:', error.message);
  }
  process.exit(0);
}

checkTiendaNubeData();