# Facturación desde LupoHub

LupoHub permite **emitir facturas electrónicas con CAE (AFIP)** usando **Afip SDK** ([app.afipsdk.com](https://app.afipsdk.com)), además de generar remitos e exportar a Excel.

---

## Facturación electrónica AFIP (Afip SDK)

### Requisitos
- **CUIT** de tu empresa (11 dígitos).
- **Autenticación:** una de estas dos opciones:
  - **Opción A:** Access token de [app.afipsdk.com](https://app.afipsdk.com).
  - **Opción B:** Tu **certificado (.crt)** y **clave privada (.key)** en formato PEM (los que te da AFIP para facturación electrónica).
- En cada **cliente** que vaya a recibir Factura A: cargar su **CUIT** en la ficha del cliente. Si no tiene CUIT, se emite Factura B (consumidor final).

### Configuración en el servidor

Definí estas variables de entorno en el backend (donde corre LupoHub).

**Siempre obligatorio:**
| Variable | Descripción |
|----------|-------------|
| `AFIP_CUIT` | TU CUIT de 11 dígitos (solo números). |

**Autenticación (elegí una de las dos):**

**Opción A – Token de Afip SDK**
| Variable | Descripción |
|----------|-------------|
| `AFIP_ACCESS_TOKEN` | Token que te da Afip SDK al iniciar sesión en app.afipsdk.com. |

**Opción B – Certificado y clave privada (tu .crt y .key)**
| Variable | Descripción |
|----------|-------------|
| `AFIP_CERT_PATH` | Ruta al archivo del **certificado** (.crt o .pem) en formato PEM, **o** el contenido PEM pegado (que empiece con `-----BEGIN CERTIFICATE-----`). |
| `AFIP_KEY_PATH` | Ruta al archivo de la **clave privada** (.key o .pem) en formato PEM, **o** el contenido PEM pegado (que empiece con `-----BEGIN ... PRIVATE KEY-----`). |

**Opcionales:**
| Variable | Descripción |
|----------|-------------|
| `AFIP_PTO_VTA` | Punto de venta (número). Por defecto: 1. |
| `AFIP_PRODUCTION` | Poner `true` o `1` para usar **producción** de AFIP. Si no se define, se usa **homologación**. |

**Ejemplo con token (Opción A)** en `.env` del backend:
```env
AFIP_CUIT=20123456789
AFIP_ACCESS_TOKEN=tu_token_de_app_afipsdk
AFIP_PTO_VTA=1
```

**Ejemplo con certificado y clave (Opción B)** – archivos en una carpeta del servidor:
```env
AFIP_CUIT=20123456789
AFIP_CERT_PATH=./afip-certs/certificado.crt
AFIP_KEY_PATH=./afip-certs/clave.key
AFIP_PTO_VTA=1
AFIP_PRODUCTION=true
```

Si usás rutas relativas (ej. `./afip-certs/...`), se resuelven desde el directorio desde donde se inicia el backend. Colocá los archivos `.crt` y `.key` en una carpeta que no se suba a Git (agregá `afip-certs/` al `.gitignore`).

### Backend en Railway (y front en Vercel)

En Railway no podés subir archivos al servidor de forma sencilla, así que tenés dos opciones:

**Opción recomendada: usar token de Afip SDK**

1. Entrá a [app.afipsdk.com](https://app.afipsdk.com), iniciá sesión y copiá tu **access token**.
2. En **Railway** → tu proyecto del backend → **Variables**.
3. Agregá:
   - `AFIP_CUIT` = tu CUIT (11 dígitos)
   - `AFIP_ACCESS_TOKEN` = el token que copiaste
   - `AFIP_PTO_VTA` = 1 (o tu punto de venta)
   - `AFIP_PRODUCTION` = true (si querés facturas reales)
4. Guardá y redeployá el backend. Listo: en la app (Vercel) el botón «Emitir factura» usará el backend de Railway.

**Opción con certificado y clave en variables**

Si preferís usar tu .crt y .key, podés pegar el **contenido PEM** en variables de entorno de Railway:

1. Abrí tu archivo `certificado.crt` en un editor de texto y copiá todo (desde `-----BEGIN CERTIFICATE-----` hasta `-----END CERTIFICATE-----`).
2. En Railway, creá la variable `AFIP_CERT_PATH` y pegá ese contenido. Si Railway no acepta múltiples líneas, pegá todo en **una sola línea** reemplazando cada salto de línea por `\n` (barra invertida + n). Ejemplo: `-----BEGIN CERTIFICATE-----\nMIIE...\n-----END CERTIFICATE-----`.
3. Lo mismo con `AFIP_KEY_PATH`: contenido completo de tu archivo `.key`, en una línea con `\n` donde van los saltos.
4. Agregá también `AFIP_CUIT`, `AFIP_PTO_VTA` y si corresponde `AFIP_PRODUCTION=true`.
5. Redeployá.

El frontend en Vercel no necesita ninguna variable de AFIP: solo llama al backend. En **Vercel** → tu proyecto del front → **Environment Variables** asegurate de tener `VITE_API_URL` = `https://tu-backend.railway.app/api` (la URL base de tu backend en Railway, terminando en `/api`). Así el botón «Emitir factura» en la app usará el backend de Railway.

### Cómo emitir una factura

1. En **Pedidos**, abrí el pedido que quieras facturar.
2. Si AFIP está configurado, verás el botón **Emitir factura** (ícono de recibo) junto a Remito y Excel.
3. Al hacer clic, el sistema emite la factura en AFIP:
   - Si el **cliente tiene CUIT** → Factura A.
   - Si no tiene CUIT → Factura B (consumidor final).
4. Se guarda el **CAE** y el número de comprobante; el pedido queda marcado como **FACTURADO**.

### Detalles técnicos

- El backend usa el paquete **@afipsdk/afip.js** (`npm install @afipsdk/afip.js`).
- Se calcula IVA 21% sobre el total del pedido (neto = total / 1.21).
- Una vez emitida, no se puede volver a facturar el mismo pedido.

---

## Remito (sin AFIP)

En **Pedidos**, en cada pedido podés usar **Generar remito** para abrir una ventana imprimible (o guardar como PDF) con remitente, destinatario, transporte e ítems. Los datos del remitente se configuran en **Configuración → Transportes**.

---

## Exportar a Excel

Desde Pedidos podés **exportar un pedido** o **todos los pedidos** a Excel (formato planilla con ítems, precios y totales) para llevarlos a tu contador o a otro sistema.

---

## Resumen

| Acción | Dónde | Requisito |
|--------|--------|-----------|
| Emitir factura con CAE (AFIP) | Pedidos → botón «Emitir factura» | Variables AFIP en el servidor + Afip SDK token |
| Generar remito (PDF) | Pedidos → ícono hoja | Datos remitente en Configuración → Transportes |
| Exportar a Excel | Pedidos → ícono Excel | Ninguno |
| Cargar CUIT del cliente | Clientes → ficha del cliente | Para Factura A |

Para más información sobre Afip SDK: [docs.afipsdk.com](https://docs.afipsdk.com).
