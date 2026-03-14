# Catálogos persistentes en Railway

Los archivos de catálogos (PDFs) se guardan en el disco del servidor. En Railway **cada deploy crea un contenedor nuevo con disco vacío**, por eso los PDFs subidos desaparecen después de un redeploy aunque los registros sigan en la base de datos.

## Solución: volumen persistente

1. **Crear un Volume en Railway**
   - En tu proyecto → servicio del backend → pestaña **Variables** o **Settings**.
   - En **Volumes** creá un nuevo volumen (ej. `uploads-data`).
   - Montalo en la ruta: **`/data`** (o la ruta que prefieras).

2. **Variable de entorno**
   - En el mismo servicio, en **Variables**, agregá:
   - **`UPLOADS_ROOT`** = **`/data`** (debe coincidir con la ruta de montaje del volumen).

3. **Redeploy**
   - Los nuevos archivos que subas quedarán en `/data/uploads/catalogs` y **persistirán** entre deploys.

Los catálogos que ya se habían “perdido” (registros en la DB pero archivo ya no existe) seguirán mostrando el mensaje de archivo no disponible; para esos tendrás que volver a subir el PDF o eliminar el registro y subirlo de nuevo.
