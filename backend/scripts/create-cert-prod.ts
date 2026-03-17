/**
 * Script para crear certificado de producción usando la automatización
 * "create-cert-prod" de Afip SDK (ARCA / web services en modo Producción).
 *
 * Uso:
 *   1. Obtener ACCESS_TOKEN desde app.afipsdk.com (logueado con tu usuario).
 *   2. Definir variables de entorno y ejecutar:
 *
 *   AFIP_ACCESS_TOKEN=tu_token \
 *   AFIP_CUIT=30709231045 \
 *   AFIP_ARCA_USERNAME=30709231045 \
 *   AFIP_ARCA_PASSWORD=tu_password_arca \
 *   AFIP_CERT_ALIAS=mi-cert-prod \
 *   npx ts-node scripts/create-cert-prod.ts
 *
 *   En Windows (PowerShell) podés setear las variables antes del comando o usar .env
 *   (no pongas la contraseña en el código ni la subas al repo).
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();
dotenv.config({ path: path.join(process.cwd(), '.env.production') });

const accessToken = process.env.AFIP_ACCESS_TOKEN?.trim();
const cuit = process.env.AFIP_CUIT?.trim();
const username = process.env.AFIP_ARCA_USERNAME?.trim() || cuit;
const password = process.env.AFIP_ARCA_PASSWORD?.trim();
const alias = process.env.AFIP_CERT_ALIAS?.trim() || 'afipsdk';

async function main() {
  if (!accessToken) {
    console.error('Falta AFIP_ACCESS_TOKEN. Obtenelo desde app.afipsdk.com');
    process.exit(1);
  }
  if (!cuit) {
    console.error('Falta AFIP_CUIT (11 dígitos).');
    process.exit(1);
  }
  if (!password) {
    console.error('Falta AFIP_ARCA_PASSWORD (contraseña para loguearte en ARCA).');
    process.exit(1);
  }

  const Afip = (await import('@afipsdk/afip.js')).default;
  const afip = new Afip({ access_token: accessToken });

  const data = {
    cuit: cuit.replace(/\D/g, ''),
    username: (username || cuit).replace(/\D/g, ''),
    password,
    alias: (alias || 'afipsdk').replace(/\W/g, '') || 'afipsdk'
  };

  console.log('Ejecutando automatización create-cert-prod...');
  console.log('CUIT:', data.cuit, '| Alias:', data.alias);

  try {
    const response = await afip.CreateAutomation('create-cert-prod', data, true);
    console.log('\n--- Respuesta ---');
    console.log(JSON.stringify(response, null, 2));

    const certContent = (response as any)?.data?.cert;
    const keyContent = (response as any)?.data?.key;
    if (certContent && keyContent) {
      const certsDir = path.join(process.cwd(), 'afip-certs');
      if (!fs.existsSync(certsDir)) {
        fs.mkdirSync(certsDir, { recursive: true });
        console.log('\nCarpeta afip-certs creada.');
      }
      const safeAlias = (data.alias || 'cert').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
      const certFile = path.join(certsDir, `${safeAlias}-prod.crt`);
      const keyFile = path.join(certsDir, `${safeAlias}-prod.key`);
      fs.writeFileSync(certFile, certContent.trim() + '\n', 'utf8');
      fs.writeFileSync(keyFile, keyContent.trim() + '\n', 'utf8');
      console.log('\nArchivos generados:');
      console.log('  Certificado:', certFile);
      console.log('  Clave privada:', keyFile);
      console.log('\nPara usar en .env local:');
      console.log(`  AFIP_CERT_PATH=${certFile.replace(process.cwd(), '.').replace(/\\/g, '/')}`);
      console.log(`  AFIP_KEY_PATH=${keyFile.replace(process.cwd(), '.').replace(/\\/g, '/')}`);
    } else {
      console.log('\nLa respuesta no incluyó data.cert / data.key. Revisá la respuesta arriba.');
    }
  } catch (error: any) {
    console.error('Error:', error?.message || error);
    process.exit(1);
  }
}

main();
