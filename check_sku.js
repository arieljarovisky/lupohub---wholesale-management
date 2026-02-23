const { query } = require('./backend/dist/database/db');

async function checkSKUDetails() {
  try {
    console.log('=== VERIFICANDO DETALLES DE SKU ===\n');
    
    // Check if SKU column exists
    const columns = await query('DESCRIBE product_variants');
    console.log('Columnas en product_variants:');
    columns.forEach(col => {
      console.log(`- ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });

    // Check some sample variants to see their SKU values
    const sampleVariants = await query(`
      SELECT 
        pv.id,
        pv.sku,
        pv.tienda_nube_variant_id,
        pv.mercado_libre_variant_id,
        pc.product_id,
        c.name as color_name,
        s.name as size_name
      FROM product_variants pv
      JOIN product_colors pc ON pv.product_color_id = pc.id
      JOIN colors c ON pc.color_id = c.id
      JOIN sizes s ON pv.size_id = s.id
      LIMIT 10
    `);

    console.log('\n=== MUESTRA DE VARIANTES ===');
    sampleVariants.forEach(v => {
      console.log(`ID: ${v.id}`);
      console.log(`  SKU: ${v.sku || 'NULL'}`);
      console.log(`  TN ID: ${v.tienda_nube_variant_id || 'NULL'}`);
      console.log(`  ML ID: ${v.mercado_libre_variant_id || 'NULL'}`);
      console.log(`  Producto: ${v.product_id}`);
      console.log(`  Color/Talle: ${v.color_name} / ${v.size_name}`);
      console.log('---');
    });

    // Check Tienda Nube products to see if they have SKU in their variants
    const tnProducts = await query(`
      SELECT 
        p.id,
        p.name,
        p.sku as product_sku,
        p.tienda_nube_id
      FROM products p
      WHERE p.tienda_nube_id IS NOT NULL
      LIMIT 5
    `);

    console.log('\n=== PRODUCTOS DE TIENDA NUBE ===');
    for (const product of tnProducts) {
      console.log(`Producto: ${product.name} (ID: ${product.id})`);
      console.log(`  SKU Producto: ${product.product_sku}`);
      console.log(`  TN ID: ${product.tienda_nube_id}`);
      
      const variants = await query(`
        SELECT 
          pv.id,
          pv.sku,
          pv.tienda_nube_variant_id,
          c.name as color,
          s.name as size
        FROM product_variants pv
        JOIN product_colors pc ON pv.product_color_id = pc.id
        JOIN colors c ON pc.color_id = c.id
        JOIN sizes s ON pv.size_id = s.id
        WHERE pc.product_id = ?
      `, [product.id]);
      
      console.log(`  Variantes (${variants.length}):`);
      variants.forEach(v => {
        console.log(`    - ${v.color} / ${v.size}: SKU=${v.sku || 'NULL'}, TN_ID=${v.tienda_nube_variant_id || 'NULL'}`);
      });
      console.log('---');
    }

    console.log('\n=== VERIFICACIÓN COMPLETADA ===');
    
  } catch (error) {
    console.error('Error al verificar SKU:', error.message);
  }
  process.exit(0);
}

checkSKUDetails();