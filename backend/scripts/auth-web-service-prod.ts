/**
 * Script para autorizar el certificado de producción en un web service de AFIP
 * (automatización "auth-web-service-prod" de Afip SDK).
 * Ejecutalo después de create-cert-prod para que el certificado pueda usarse con WSFE.
 *
 * Uso:
 *   Mismas variables que create-cert-prod, más AFIP_WS_SERVICE (opcional, default wsfe):
 *
 *   AFIP_ACCESS_TOKEN=tu_token \
 *   AFIP_CUIT=30709231045 \
 *   AFIP_ARCA_USERNAME=30709231045 \
 *   AFIP_ARCA_PASSWORD=tu_password_arca \
 *   AFIP_CERT_ALIAS=lupohub \
 *   npm run auth-web-service-prod
 *
 *   Para otro servicio: AFIP_WS_SERVICE=wsfex npm run auth-web-service-prod
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();
dotenv.config({ path: path.join(process.cwd(), '.env.production') });

const accessToken = process.env.AFIP_ACCESS_TOKEN?.trim();
const cuit = process.env.AFIP_CUIT?.trim();
const username = process.env.AFIP_ARCA_USERNAME?.trim() || cuit;
const password = process.env.AFIP_ARCA_PASSWORD?.trim();
const alias = process.env.AFIP_CERT_ALIAS?.trim() || 'afipsdk';
const service = process.env.AFIP_WS_SERVICE?.trim() || 'wsfe';

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

  const data: Record<string, string> = {
    cuit: cuit.replace(/\D/g, ''),
    username: (username || cuit).replace(/\D/g, ''),
    password,
    alias: (alias || 'afipsdk').replace(/\W/g, '') || 'afipsdk',
    /** Afip SDK / ARCA: id del web service (wsfe, wsfex, …) */
    wsid: service,
    service
  };

  console.log('Ejecutando automatización auth-web-service-prod...');
  console.log('CUIT:', data.cuit, '| Alias:', data.alias, '| wsid:', data.wsid);
  console.log(
    'Tip: el alias debe coincidir con el certificado en app.afipsdk.com (ej. lupohub). Definí AFIP_CERT_ALIAS si no es afipsdk.'
  );

  try {
    const response = await afip.CreateAutomation('auth-web-service-prod', data, true);
    console.log('\n--- Respuesta ---');
    console.log(JSON.stringify(response, null, 2));
    console.log('\nSi status es "complete", el web service quedó autorizado para este certificado.');
  } catch (error: unknown) {
    const e = error as { message?: string; status?: number; data?: unknown };
    console.error('\n--- Error ---');
    console.error('HTTP:', e.status ?? '?', '|', e.message ?? String(error));
    if (e.data != null) {
      console.error('Detalle Afip SDK:');
      console.error(typeof e.data === 'string' ? e.data : JSON.stringify(e.data, null, 2));
    }
    console.error('\nCausas frecuentes del 400:');
    console.error('  1. AFIP_CERT_ALIAS incorrecto (debe ser el alias del cert en app.afipsdk.com)');
    console.error('  2. AFIP_ARCA_PASSWORD incorrecta o ARCA bloqueó el acceso');
    console.error('  3. El certificado no existe: corré create-cert-prod antes');
    console.error('  4. wsid inválido (exportación = wsfex)');
    console.error('  5. El servicio ya estaba autorizado (revisá en ARCA → Administrador de certificados)');
    process.exit(1);
  }
}

main();
