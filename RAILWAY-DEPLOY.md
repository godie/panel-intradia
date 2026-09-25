# Deploy en Railway

Guía paso a paso para desplegar el **Panel Cuantitativo // Intradía** en Railway.

## Requisitos

- Cuenta en Railway (https://railway.app/)
- GitHub conectado a Railway
- Repositorio clonado en local (con `Dockerfile` y `docker-compose.railway.yml`)

---

## Opción A: Deploy desde GitHub (Recomendado)

### 1. Crear Proyecto en Railway

```bash
# 1. Ir a https://railway.app/dashboard
# 2. Click "New Project" → "Deploy from GitHub Repo"
# 3. Seleccionar repositorio "panel-intradia"
# 4. Autorizar si es necesario
```

### 2. Configurar el Deployment

Railway detectará automáticamente:
- ✅ Dockerfile presente
- ✅ Bun como runtime
- ✅ Build command: `bun run build`
- ✅ Start command: `bun server.js`

**IMPORTANTE**: En Railway Dashboard → Settings:

```bash
# Agregar variables de entorno:

NODE_ENV=production
PORT=8000
CORS_ORIGINS=https://panel-intradia-prod.up.railway.app
DATABASE_URL=file:/app/db/custom.db   # Ruta ABSOLUTA (ver nota abajo)
SKIP_DB_INIT=0  # Permite que el entrypoint cree la DB
BINANCE_BASE_URL=https://api.binance.us/api/v3  # Railway corre en US (ver nota)
```

> **`BINANCE_BASE_URL` es obligatorio en Railway.** La región por defecto de
> Railway es **us-west (San Francisco)**, y `api.binance.com` responde **HTTP
> 451** a IPs de EE.UU.; Bybit también bloquea esa región. Sin esta variable el
> dashboard no carga ningún dato y `/api/analysis` devuelve `502`. Apuntala al
> endpoint US (`https://api.binance.us/api/v3`).
>
> Alternativa sin variable de entorno: cambiar la región del servicio a
> **europe-west4** (ambos upstreams funcionan desde la UE), a costa de más
> latencia para usuarios en Sudamérica.

> **`DATABASE_URL` es obligatorio.** Sin esa variable el entrypoint falla con
> `Prisma schema validation - P1012: Environment variable not found:
> DATABASE_URL` y el contenedor queda en restart loop. El `Dockerfile` ya la
> define con ese mismo valor por defecto, así que sólo hace falta declararla si
> querés apuntar a otro archivo o a otro motor.
>
> **Ruta absoluta, no relativa.** `file:./db/custom.db` se resuelve contra el
> directorio del schema (`/app/prisma/db/custom.db`), no contra `/app`. Usá
> siempre `file:/app/db/custom.db`.

> **Persistencia**: el filesystem de Railway es efímero. Para que el historial
> de cruces sobreviva a un redeploy hay que montar un **Volume** en `/app/db`
> (Railway Dashboard → Service → Settings → Volumes → Mount path `/app/db`).
> Sin volumen, cada deploy arranca con la DB vacía.

### 3. Esperar Deploy

- Railway construirá la imagen Docker
- Copiará todos los servicios (app + mini-services + Prisma)
- Iniciará el container

**Tiempo estimado**: 3–5 minutos para el primer build.

### 4. Acceder al Dashboard

```bash
# Una vez que esté running:
https://panel-intradia-prod.up.railway.app/
```

---

## Opción B: stack completo (app + mini-services + Caddy)

Replica lo que corre en Docker local: **4 servicios**, y **sólo Caddy con
dominio público**. Los otros tres quedan en la red privada
(`<servicio>.railway.internal`).

> **Por qué Caddy y no exponer cada mini-service.** El frontend deriva la URL
> del socket del propio origen de la página (`/_tick-stream/socket.io/`), así
> que quien sirve el HTML tiene que proxear esos dos paths. Eso es lo que hace
> Caddy, y evita tener que tocar código de la app.

### 1. `app` (Next.js)

- **Root Directory**: `.` · **Dockerfile**: `Dockerfile` · **Start command**: el default (`bun server.js`)
- **Variables**:
  ```
  NODE_ENV=production
  PORT=8000
  DATABASE_URL=file:/app/db/custom.db
  BINANCE_BASE_URL=https://api.binance.us/api/v3
  TICK_STREAM_UPSTREAM=tick-stream.railway.internal:3005
  ORDER_BOOK_UPSTREAM=order-book.railway.internal:3004
  ```
- **Volume**: montar en `/app/db` (ver *Base de datos*)
- **Público**: no

`PORT=8000` se setea explícito a propósito: Railway inyecta su propio `PORT` y
si no lo fijás, `APP_UPSTREAM` de Caddy no puede saber a qué puerto apuntar.
`TICK_STREAM_UPSTREAM` / `ORDER_BOOK_UPSTREAM` son las que usa `/status` para
probar los mini-services **desde el servidor**; sin ellas `/status` los marca
inalcanzables aunque el browser conecte bien.

### 2. `tick-stream`

- **Root Directory**: `.` · **Dockerfile**: `mini-services/tick-stream/Dockerfile`
- **Variables**: `CORS_ORIGINS=https://<dominio-de-caddy>`
- **Público**: no

### 3. `order-book`

- **Root Directory**: `.` · **Dockerfile**: `mini-services/order-book/Dockerfile`
- **Variables**: `CORS_ORIGINS=https://<dominio-de-caddy>`
- **Público**: no

> `CORS_ORIGINS` es **obligatorio**: los mini-services validan el `Origin` en el
> handshake y su default es `localhost`. Sin esto el socket devuelve **403**.
> El valor es el dominio público de Caddy (el que abre el browser), no el
> interno.

### 4. `caddy` (único servicio público)

- **Root Directory**: `.` · **Dockerfile**: `caddy/Dockerfile`
- **Variables**:
  ```
  APP_UPSTREAM=app.railway.internal:8000
  TICK_STREAM_UPSTREAM=tick-stream.railway.internal:3005
  ORDER_BOOK_UPSTREAM=order-book.railway.internal:3004
  ```
- **Público**: **sí** — este es el dominio que abrís

Caddy escucha en `$PORT` (Railway lo inyecta), por eso el Caddyfile usa
`:{$PORT:81}`. El `caddy/Dockerfile` hornea el Caddyfile porque Railway no puede
montar un archivo suelto.

### Verificar que quedó bien

Abrí `https://<dominio-de-caddy>/status`. La página combina las dos señales y te
dice cuál es el problema:

| Diagnóstico | Significa |
|---|---|
| Todo en orden | servidor y browser llegan |
| El servidor llega pero el browser no | gateway/paths mal (`CORS_ORIGINS`, `handle_path`) |
| El browser llega pero el servidor no | `TICK_STREAM_UPSTREAM` / `ORDER_BOOK_UPSTREAM` mal |
| Ninguno llega | mini-services no desplegados |

---

## Configurar la Base de Datos

### Opción 1: SQLite (actual)

Railway tiene filesystem **efímero**: sin un Volume, cada deploy arranca con la
DB vacía (se pierde el historial de cruces).

```bash
# Railway Dashboard → Service `app` → Settings → Volumes
#   Mount path: /app/db
#
# Variable (ruta ABSOLUTA — una ruta relativa se resuelve contra prisma/, no
# contra /app, y termina fuera del volumen):
DATABASE_URL=file:/app/db/custom.db
```

### Opción 2: Postgres (si algún día hace falta)

Sólo tiene sentido si pasás a **varias réplicas** o necesitás escritores
concurrentes — SQLite no escala ahí. Una sola instancia no lo necesita.

```bash
# 1. Add Service → PostgreSQL
# 2. Railway inyecta DATABASE_URL en ese servicio: copiala al servicio `app`
# 3. Cambiar el provider en prisma/schema.prisma: "sqlite" → "postgresql"
# 4. Rebuild (el cliente Prisma se genera por provider)
# 5. Reemplazar `db push` por `migrate deploy` en docker-entrypoint.sh
```

---

## Configurar Networking

### Red privada entre servicios

En Railway los servicios del mismo proyecto se ven por `<servicio>.railway.internal`
en el puerto donde **escuchan realmente** (no el `$PORT` inyectado). De ahí que
los upstreams internos sean:

```
app.railway.internal:8000          (PORT=8000 explícito)
tick-stream.railway.internal:3005  (puerto hardcodeado en el servicio)
order-book.railway.internal:3004   (puerto hardcodeado en el servicio)
```

`CORS_ORIGINS` de los mini-services es la excepción: ahí va el dominio **público**
de Caddy, porque el `Origin` lo manda el browser, no la red interna.

### Acceso Público HTTPS

En la Opción B **sólo Caddy** tiene dominio público. Railway asigna uno automático:

```
https://<algo>.up.railway.app/
```

Para un dominio personalizado:
1. Railway Dashboard → servicio `caddy` → Settings → Domains
2. Agregar el dominio (ej. `panel.tudominio.com`)
3. Actualizar los DNS records según las instrucciones
4. Actualizar `CORS_ORIGINS` de los dos mini-services con el dominio nuevo

---

## Monitoreo y Logs

```bash
# Ver logs en tiempo real
railway logs -f

# Ver variables de entorno
railway variables

# Reiniciar el deployment
railway redeploy
```

---

## Actualizar a Nueva Versión

```bash
# 1. Hacer push a GitHub
git push origin main

# 2. Railway detectará cambios y rebuildeará automáticamente
# 3. Si hay cambios en Prisma schema:
railway run bunx prisma db push
```

---

## Costo Estimado

| Recurso | Uso | Precio |
|---|---|---|
| Compute (Next.js) | 24/7, bajo tráfico | ~$0.50/mes |
| Compute (tick-stream) | 24/7 | ~$0.30/mes |
| Compute (order-book) | 24/7 | ~$0.30/mes |
| Storage (DB volume) | ~100 MB | ~$0.10/mes |
| **Total** | | ~**$1.20/mes** |

(Puede variar con tráfico; Railway cobra por CPU-hours + storage)

---

## Troubleshooting

> **Primero abrí `/status`.** Distingue las dos fallas que se ven igual desde el
> browser: "el servidor no alcanza los mini-services" vs "el browser no conecta
> al gateway". Sin eso estás adivinando.

**El dashboard no carga datos (infinito "Cargando…")**
```bash
railway logs -f app
# Buscar "All providers failed for getKlines(...)": el error ahora lista el
# motivo de CADA provider, no sólo del último.
```

**WebSocket no conecta (header OFFLINE)**
```bash
railway variables --service tick-stream   # y --service order-book
# CORS_ORIGINS debe ser el dominio PÚBLICO de Caddy, no el interno.
# Y sólo Caddy debe tener dominio público.
```

**Base de datos no inicializa**
```bash
# Manualmente forzar schema push
railway run bunx prisma db push --force
```

**Memoria insuficiente**
```bash
# Railway auto-escala. Si ves OOM errors:
railway logs -f
# Considerar upgrade del plan o reducir concurrent connections
```

---

## Siguiente: Dominio Personalizado

```bash
# 1. Comprar dominio (Namecheap, GoDaddy, etc.)
# 2. En Railway Dashboard → Settings → Domains
# 3. Apuntar DNS a Railway (CNAME o A record)
# 4. Esperar ~5 min a que se propague
```

Listo. Railway manejará automáticamente los certificados SSL/TLS vía Let's Encrypt.
