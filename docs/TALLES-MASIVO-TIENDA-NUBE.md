# Cómo cambiar los talles masivamente en Tienda Nube

Para que el público vea **solo** estos talles: **P, M, G, GG, XG, XXG, XXXG**, **U** (único) y los numéricos infantiles **4, 6, 8, 10, 12, 14**, podés hacerlo de dos formas.

---

## Opción 1: Desde LupoHub (recomendado)

1. Entrá a **Configuración** (engranaje) y abrí la pestaña **Integraciones**.
2. Con Tienda Nube **conectado**, en la tarjeta de Tienda Nube hacé clic en **NORMALIZAR TALLES**.
3. La app procesa el catálogo **por lotes** (varios minutos en tiendas grandes); dejá el modal abierto hasta que termine.
4. Actualizará en Tienda Nube las variantes con atributo "Talle"/"Size"/"Talla", convirtiendo los valores a:
   - **P** (ej. S, PP, XS, 34, 36…)
   - **M** (ej. 38, 40…)
   - **G** (ej. L, 42, 44…)
   - **GG** (ej. 46…)
   - **XG** (ej. XL, 48…)
   - **XXG** (ej. XXL, 50…)
   - **XXXG** (ej. XXXL, 52…)
   - **U** (ej. Único, Unico, Liso…)
   - **4, 6, 8, 10, 12, 14** (talles infantiles; no se convierten a letras)
   - Rangos y textos viejos (ej. `M 37-40`, `Gg 45 Al 48`, `P - 85`, `Xxg`, `Eg`, `Plus`…) → letra estándar correspondiente
5. Al terminar, ejecutá de nuevo **CONSULTAR PRODUCTOS** para refrescar datos en LupoHub.

**Duplicados:** Si un producto tiene, por ejemplo, talle `M` y `M 37-40` (mismo color), al unificar ambos pasan a `M` y Tienda Nube no lo permite. Esas variantes aparecen como `[SKIP]` en el log; hay que fusionar stock y borrar la variante sobrante en el admin de TN.

---

## Opción 2: Desde Tienda Nube (CSV)

1. En el **administrador de Tienda Nube**: **Productos > Lista de productos**.
2. Clic en **Importar y exportar** (o en los tres puntos "...").
3. **Descargar** la lista de productos (archivo CSV).  
   Ayuda: [Cómo descargar la lista de productos](https://ayuda.tiendanube.com/122710-importar-y-exportar-productos/como-descargar-la-lista-de-productos-de-mi-tiendanube).
4. Abrí el CSV en Excel o Google Sheets. Buscá la columna que corresponde a **variante / talle** (según el nombre que use tu exportación).
5. Reemplazá todos los valores por solo: **P**, **M**, **G**, **GG**, **XG**, **XXG**, **XXXG**, **U** o **4/6/8/10/12/14**, según corresponda (ej. "XL" → "XG", "Único" → "U", "M 37-40" → "M").
6. Guardá el archivo como **CSV** (delimitado por comas). No uses .XLS o .XLSX para importar.
7. En Tienda Nube: **Importar y exportar > Cargar archivo .csv**.
8. Subí el archivo y elegí **"Modificar productos ya existentes"** para no duplicar productos.
9. Asigná cada columna al campo correcto (no ignores la columna "Identificador de URL") y hacé clic en **Importar**.

**Importante:** La carga masiva en Tienda Nube no está disponible en el plan Inicial/gratuito. El límite es de hasta 20.000 filas por importación.

---

## Colores

Para unificar nombres de color en Tienda Nube (filtros sin duplicados), usá **NORMALIZAR COLORES** en la misma pantalla de integraciones. Detalle: [COLORES-MASIVO-TIENDA-NUBE.md](./COLORES-MASIVO-TIENDA-NUBE.md).

---

## Si TALLE y COLOR aparecen invertidos

Si en LupoHub ves, por ejemplo, "TALLE: AZUL" y "COLOR: GG", en Tienda Nube ese producto tiene el orden de atributos al revés. Conviene:

1. En Tienda Nube, editar el producto y que el **primer** atributo sea, por ejemplo, **Color** y el segundo **Talle** (o al revés, pero que los nombres sean claros).
2. Volver a ejecutar **Importar productos** en LupoHub para que se reasignen bien TALLE y COLOR según los nombres de los atributos en Tienda Nube.
