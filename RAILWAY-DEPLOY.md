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
SKIP_DB_INIT=0  # Permite que el entrypoint cree la DB
```

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

## Opción B: 3 Deployments Separados (Más Granular)

Si quieres que cada servicio sea independiente:

### 1. Deploy del App Principal (Next.js)

```bash
railway login
railway init  # Seleccionar repositorio

# En Railway Dashboard → Variable:
NODE_ENV=production
PORT=8000
```

### 2. Deploy de tick-stream

Crear un nuevo Deployment:

```bash
# Dockerfile para tick-stream:
FROM oven/bun:1.3.6
WORKDIR /app
COPY mini-services/tick-stream/package.json ./
COPY mini-services/tick-stream/bun.lock* ./
RUN bun install --frozen-lockfile
COPY mini-services/tick-stream/ ./
EXPOSE 3005
CMD ["bun", "index.ts"]
```

### 3. Deploy de order-book

Similar a tick-stream pero con `order-book/`:

```dockerfile
FROM oven/bun:1.3.6
WORKDIR /app
COPY mini-services/order-book/package.json ./
COPY mini-services/order-book/bun.lock* ./
RUN bun install --frozen-lockfile
COPY mini-services/order-book/ ./
EXPOSE 3004
CMD ["bun", "index.ts"]
```

---

## Configurar la Base de Datos

### Opción 1: SQLite Local (Actual)

Railway mantiene un volumen persistente. No requiere cambios:

```bash
# El Dockerfile ya crea /app/db/ volume
# DATABASE_URL=file:./db/custom.db (por defecto)
```

### Opción 2: Postgres (Recomendado para producción)

```bash
# En Railway Dashboard:
# 1. Add Service → PostgreSQL
# 2. Railway proporciona DATABASE_URL automáticamente
# 3. Actualizar schema:

docker-compose -f docker-compose.railway.yml exec app bunx prisma db push
```

---

## Configurar Networking

### Permitir que los servicios se comuniquen

En Railway, los servicios corren en la misma red interna. Usar nombres internos:

**En docker-compose.railway.yml:**
```yaml
services:
  app:
    environment:
      CORS_ORIGINS: http://tick-stream:3005,http://order-book:3004
```

### Acceso Público HTTPS

Railway asigna automáticamente un dominio HTTPS:
```
https://panel-intradia-prod.up.railway.app/
```

Para un dominio personalizado:
1. Ir a Railway Dashboard → Settings → Domains
2. Agregar tu dominio (ej. `panel.tudominio.com`)
3. Actualizar DNS records según las instrucciones

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

**El dashboard no carga datos (infinito "Cargando…")**
```bash
railway logs -f app
# Buscar errores de WebSocket connection
```

**WebSocket no conecta a tick-stream**
```bash
# Verificar que CORS_ORIGINS está correctamente configurado
railway variables

# Debe incluir: https://panel-intradia-prod.up.railway.app
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
