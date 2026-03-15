# Certificados AFIP

Colocá en **esta carpeta** tus archivos de certificado y clave privada para facturación electrónica:

- **`certificado.crt`** — tu certificado en formato PEM (o renombrá tu archivo .crt a este nombre).
- **`clave.key`** — tu clave privada en formato PEM (o renombrá tu archivo .key a este nombre).

En el `.env` del backend ya están configuradas las rutas:

```env
AFIP_CERT_PATH=./afip-certs/certificado.crt
AFIP_KEY_PATH=./afip-certs/clave.key
```

Si tus archivos tienen otro nombre (ej. `miempresa.crt` y `miempresa.key`), actualizá esas rutas en el `.env` o renombrá los archivos a `certificado.crt` y `clave.key`.

**Importante:** Los archivos deben estar en formato PEM. No subas estos archivos a Git (esta carpeta está en `.gitignore` para los .crt y .key).
