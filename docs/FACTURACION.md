# Cómo facturar desde LupoHub

Hoy el sistema **no emite facturas electrónicas**; solo tiene los datos necesarios (pedidos, clientes, ítems, totales). Para facturar desde tu sistema tenés estas opciones:

---

## Opción 1: Facturación electrónica AFIP (Argentina)

Para emitir facturas con validez fiscal tenés que usar los **Web Services de AFIP** (o un proveedor que los use).

### Requisitos
- **CUIT** de tu empresa (y CUIT/CUIL del cliente en cada factura).
- **Certificado digital** y clave fiscal (AFIP).
- **Servicio de facturación electrónica** dado de alta en AFIP (Facturación Electrónica).

### Alternativas técnicas

| Enfoque | Complejidad | Descripción |
|--------|------------|-------------|
| **Integración directa con AFIP** | Alta | Usar WSFE/WSFEv1 desde tu backend; requiere certificado, homologación y mantener el servicio. |
| **Proveedor de facturación electrónica** | Media | Servicios como **Nubefact**, **Facturación Argentina**, **Billpad**, etc. que exponen una API: vos enviás datos del comprobante y ellos se encargan de AFIP y te devuelven el PDF + CAE. |
| **Exportar a un ERP/contabilidad** | Baja | Exportar pedidos (Excel o API) a **Siigo**, **Bejerman**, **Sistemas de gestión** y facturar desde ahí. |

### Si elegís un proveedor con API (recomendado)
1. Darte de alta en el proveedor y obtener API key / credenciales.
2. En LupoHub: agregar en **Configuración** las credenciales del servicio.
3. Desde un pedido **Despachado** (o Confirmado), botón **“Emitir factura”** que envíe al proveedor: cliente (razón social, CUIT, domicilio), ítems (descripción, cantidad, precio, IVA), total.
4. El proveedor devuelve CAE, número de comprobante y PDF; podés guardarlos en una tabla `invoices` y mostrar “Facturado” en el pedido.

### Campo CUIT en clientes
Para facturar a un cliente necesitás su **CUIT o CUIL**. En LupoHub ya está el campo opcional **CUIT** en clientes (Configuración → Clientes). Completalo en cada cliente que vaya a recibir factura.

---

## Opción 2: Generar comprobante en PDF desde LupoHub

Sin AFIP ni proveedor externo podés **generar un PDF** con los datos del pedido (tipo “comprobante de venta” o “remito”) para imprimir o enviar por email. No tiene validez fiscal por sí solo; sirve como respaldo o para que tu contador luego emita la factura en AFIP.

### Cómo implementarlo
- **Backend:** instalar una librería de PDF (por ejemplo `pdfkit` o `puppeteer`).
- **Endpoint:** `GET /api/orders/:id/comprobante.pdf` que arme el PDF con: datos de tu empresa, cliente, ítems del pedido, totales, fecha.
- **Frontend:** en la tarjeta del pedido, botón “Descargar comprobante” que abra o descargue ese PDF.

Si querés que te indique los pasos concretos en el código (rutas, controlador, modelo de datos), decime y los detallo.

---

## Opción 3: Exportar datos y facturar en otro sistema

Ya podés **exportar pedidos a Excel** (desde la lista de pedidos o por pedido). Ese Excel tiene cliente, ítems, cantidades, precios y total.

- Abrís el Excel en tu sistema de contabilidad o en la web de AFIP (carga manual).
- O si tu contador usa un sistema con importación, podés sumar una **exportación específica** (por ejemplo CSV/Excel con columnas que pida ese sistema) desde LupoHub.

---

## Resumen

| Objetivo | Opción recomendada |
|----------|--------------------|
| Factura electrónica con CAE (Argentina) | Proveedor API (Nubefact, etc.) o integración AFIP directa |
| Solo comprobante para imprimir/enviar | Generar PDF desde LupoHub (Opción 2) |
| Facturar desde tu contador/ERP | Exportar Excel/CSV (Opción 3) |

Si me decís con qué querés integrar (ej. “Nubefact” o “solo PDF por ahora”), puedo guiarte paso a paso en el código de LupoHub.
