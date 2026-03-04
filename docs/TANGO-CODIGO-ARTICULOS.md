# Código de artículos Tango

Exportación desde Tango: el archivo de artículos tiene una columna **Código** con la siguiente estructura:

| Parte   | Posición | Longitud | Significado        |
|--------|----------|----------|--------------------|
| Artículo | 1–7    | 7 dígitos | Código del artículo |
| Talle  | 8–10     | 3 dígitos | Código de talle     |
| Color  | 11–13    | 3 dígitos | Código de color     |

**Ejemplo:** código `0012501  130197` (con espacios) o `0012501130197`:  
- Se extraen solo dígitos → `0012501130197`  
- Artículo: `0012501`  
- Talle: `130`  
- Color: `197`  

## Script de parseo

En el backend:

```bash
cd backend
npm run parse-tango "C:\Users\usuario\Downloads\Artículos.xlsx"
```

O con Node directo:

```bash
node scripts/parse-tango-articulos.js "C:\ruta\a\Artículos.xlsx"
```

Opciones:

- **`--solo-completos`**: solo incluye filas cuyo código tiene 13 dígitos (7+3+3), y omite códigos incompletos (0, 00, solo artículo sin talle/color, etc.).

El script:

1. Busca la columna "Código" en la primera hoja.
2. Extrae solo dígitos del código (ignora espacios) y parte en artículo (7), talle (3) y color (3).
3. Muestra una vista previa y un resumen (artículos/talles/colores únicos).
4. Guarda el resultado en `backend/scripts/tango-articulos-parseados.json` con campos `_articulo`, `_talle`, `_color` y `_codigoCompleto` por fila.

Con esto podés verificar que el parseo coincide con tu exportación de Tango antes de importar a LupoHub.
