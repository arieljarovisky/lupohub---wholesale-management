# Conectar la base de datos a Railway

## 1. Crear MySQL en Railway

1. Entrá a tu proyecto en [Railway](https://railway.app).
2. Click en **"+ New"** → **"Database"**.
3. Elegí **"Add MySQL"** (o "MySQL" si aparece en la lista).
4. Railway crea el servicio y te muestra las **Variables** de conexión.

## 2. Variables que Railway te da

Railway suele exponer algo de este estilo:

- **`MYSQL_URL`** o **`DATABASE_URL`**: URL completa tipo  
  `mysql://usuario:contraseña@host:puerto/nombre_base`

**O** variables sueltas:

- `MYSQLHOST` (o similar) → host
- `MYSQLUSER` → usuario  
- `MYSQLPASSWORD` → contraseña
- `MYSQLDATABASE` → nombre de la base
- `MYSQLPORT` → puerto (ej. 3306)

## 3. Conectar tu app (backend) a esa base

### Opción A: Usar la URL (recomendado)

Si Railway te da **`MYSQL_URL`** o **`DATABASE_URL`**:

1. En tu proyecto, entrá al servicio donde corre el **backend** (tu app Node).
2. **Variables** → **"+ New Variable"** o **"Add Variable"**.
3. En Railway podés **referenciar la variable del MySQL**:
   - Nombre: `MYSQL_URL` (o `DATABASE_URL`)
   - Valor: hacé click en **"Add Reference"** / **"Variable Reference"** y elegí la variable del servicio MySQL (ej. `MYSQL_URL` o la que tenga la URL de MySQL).

Así tu backend usa la misma URL que Railway genera para el MySQL.

### Opción B: Usar variables sueltas

Si en cambio tenés host, user, password, etc. por separado, en el **mismo servicio del backend** agregá:

| Variable en tu app | Valor (referencia o copia) |
|-------------------|----------------------------|
| `DB_HOST`         | Host del MySQL (o referencia a la variable de Railway) |
| `DB_USER`         | Usuario del MySQL |
| `DB_PASSWORD`     | Contraseña del MySQL |
| `DB_NAME`         | Nombre de la base (ej. `railway`) |
| `DB_PORT`         | Puerto (ej. `3306`) |

En Railway, para no copiar la contraseña a mano, usá **"Variable Reference"** y elegí la variable del plugin MySQL que corresponda (ej. `MYSQLPASSWORD`).

## 4. Resumen de variables que lee tu backend

Tu backend usa **una** de estas dos formas:

- **URL única:** `MYSQL_URL` o `DATABASE_URL`  
  Ejemplo: `mysql://user:pass@host:3306/railway`

- **Variables sueltas:**  
  `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`

Si definís `MYSQL_URL` o `DATABASE_URL`, el resto de las `DB_*` se ignoran para la conexión.

## 5. Crear las tablas la primera vez

La base en Railway viene vacía. Tu backend crea tablas al arrancar (por los scripts en `index.ts` que llaman a `addDespachosTable`, etc.). Con solo deployar el backend y que arranque con la variable de MySQL bien configurada, las tablas se crean solas.

Si tuvieras migraciones o un script aparte (ej. `npm run init-db`), podrías ejecutarlo una vez desde tu máquina apuntando a la misma URL, o desde un job en Railway.

## 6. Verificar

1. Deployá de nuevo el backend después de agregar la variable.
2. En Railway, en el servicio del backend, revisá los **Logs**.
3. Si ves algo como “Server running on port…” y no hay errores de conexión a MySQL, la base está conectada.

Si aparece un error tipo `ER_ACCESS_DENIED_ERROR` o `ECONNREFUSED`, revisá que la variable (URL o `DB_*`) sea exactamente la que muestra el plugin MySQL y que esté asociada al servicio correcto (tu backend).
