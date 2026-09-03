# INSTALL.md

Guía de instalación y despliegue del **Panel Cuantitativo // Intradía**.

Hay dos caminos:

| Camino | Tiempo | Para quién |
|---|---|---|
| **[A) Docker Compose](#a-docker-compose--recomendado)** | ~3 min | Cualquiera que quiera correrlo local sin instalar Bun/Node |
| **[B) Sin Docker (manual)](#b-instalación-manual-sin-docker)** | ~10 min | Desarrolladores que quieran editar el código en caliente |

Y al final, **[Despliegue en producción](#despliegue-en-producción)** con instrucciones para VPS, Docker remoto y consideraciones para Vercel/Railway/Fly.

---

## A) Docker Compose — recomendado

### Requisitos

- **Docker Engine** ≥ 24 + **Docker Compose v2** (incluido en Docker Desktop).
- ~2 GB de RAM libre para los 4 contenedores.
- Acceso HTTPS saliente a `api.binance.com`, `stream.binance.com`, `api.binance.us` (si la región bloquea el endpoint principal).

### Pasos

```bash
# 1. Clonar
git clone <repo> intradia_cripto
cd intradia_cripto

# 2. (Opcional) configurar variables de entorno
cp .env.example .env
# editar .env si quieres cambiar la ruta de SQLite

# 3. Build + arrancar todos los servicios
docker compose up -d --build

# 4. Esperar ~30 s a que arranque todo (Caddy espera al healthcheck del app).
docker compose ps

# 5. Abrir el dashboard
open http://localhost:81/
```

### Qué se está ejecutando

| Servicio | Puerto interno | Puerto público | Función |
|---|---|---|---|
| `app` | 3000 | (interno) | Next.js standalone — dashboard + REST API |
| `ws-tick` | 3003 | (interno) | socket.io → ticks Binance en vivo |
| `order-book` | 3004 | (interno) | socket.io → order book L2 Binance |
| `caddy` | 81 | **81** | Reverse proxy con `?XTransformPort=` |

> **El frontend SIEMPRE se accede por `:81`** (Caddy), nunca directo al `:3000`. El browser necesita el proxy para que los WebSockets lleguen a los mini-services.

### Comandos útiles

```bash
docker compose ps                 # estado de los 4 servicios
docker compose logs -f app        # logs del dashboard
docker compose logs -f ws-tick    # logs del tick stream
docker compose restart app        # reiniciar solo el dashboard
docker compose down               # parar (conservar DB y config)
docker compose down -v            # parar + borrar volúmenes (pierdes el historial de cruces)
docker compose pull && docker compose up -d --build  # actualizar tras un pull
```

### Persistencia

- La base de datos SQLite vive en el volumen **`panel_db`** (named volume de Docker Compose). Sobrevive a `docker compose down` y se elimina con `docker compose down -v`.
- Los datos de Caddy (certs, config cacheada) viven en `caddy_data` y `caddy_config`.

### Troubleshooting

**El dashboard no carga datos (queda en "Cargando…" infinito):**
```bash
docker compose logs -f app
docker compose logs -f ws-tick
docker compose logs -f order-book
```
Lo más común es que la región del host bloquee `api.binance.com`. Solución:
```bash
docker compose exec app sh -c 'curl -I https://api.binance.com/api/v3/ping'
docker compose exec app sh -c 'curl -I https://api.binance.us/api/v3/ping'
```
Si `binance.us` responde pero `.com` no, edita `src/lib/binance.ts` línea 9 cambiando la URL base. (Próximamente esto será automático con la abstracción de providers.)

**Caddy arranca antes que el app y se cae:**
Espera 30 segundos, los healthchecks hacen retry. Si sigue fallando:
```bash
docker compose restart caddy
```

**Quiero ver el dashboard sin pasar por Caddy (modo dev):**
```bash
docker compose exec app sh
# dentro del contenedor:
bun run dev
# abre http://localhost:3000 (pero los WS no funcionarán — están en otros puertos)
```

---

## B) Instalación manual (sin Docker)

Para desarrollo local con HMR y editar el código en caliente.

### Requisitos

- **Bun** ≥ 1.3 ([instrucciones](https://bun.sh/docs/installation))
- **Node.js** ≥ 20 (opcional, solo si quieres correr el build standalone fuera de Bun)
- **Caddy** ≥ 2 (opcional — recomendado para enrutar WebSockets)
- Acceso HTTPS saliente a los endpoints de Binance.

### Pasos

```bash
# 1. Clonar e instalar
git clone <repo> intradia_cripto
cd intradia_cripto
bun install

# 2. Variables de entorno
cp .env.example .env
# editar .env si quieres cambiar la ruta de SQLite

# 3. Inicializar la base de datos (SQLite + Prisma)
bun run db:push

# 4. Lanzar el dashboard
bun run dev    # http://localhost:3000

# 5. (Recomendado) Caddy para enrutar los mini-services
caddy run --config Caddyfile   # :81 → proxy al dashboard + WS

# 6. (Recomendado) arrancar los mini-services en terminales separadas
cd mini-services/ws-tick    && bun install && bun run start   # :3003
cd mini-services/order-book && bun install && bun run start   # :3004
```

### Acceso

- **Dashboard (recomendado):** http://localhost:81/
- Dashboard directo (sin WS funcionales): http://localhost:3000/

### Scripts disponibles

| Comando | Descripción |
|---|---|
| `bun run dev` | Dev server con HMR en puerto 3000 |
| `bun run build` | Build standalone de producción |
| `bun run start` | Sirve el build standalone |
| `bun run lint` | ESLint sobre todo el repo |
| `bun test` | Ejecuta los tests de Vitest |
| `bun run db:push` | Aplica el esquema Prisma a SQLite |
| `bun run db:migrate` | Crea una migración nueva |
| `bun run db:reset` | Resetea la base de datos (⚠ borra cruces persistidos) |

---

## Despliegue en producción

### Opción 1: VPS con Docker Compose (la más simple)

Funciona en cualquier proveedor que soporte Docker (Hetzner CX22, DigitalOcean Droplet, Vultr, AWS Lightsail, un Raspberry Pi 4, etc.).

**Requisitos del VPS:** 2 vCPU, 2 GB RAM, 20 GB SSD, Ubuntu 22.04+ o Debian 12+.

```bash
# En el VPS
git clone <repo> /opt/intradia_cripto
cd /opt/intradia_cripto
cp .env.example .env

# Levantar todo
docker compose up -d --build

# Abrir el firewall
sudo ufw allow 81/tcp
```

**Persistencia:** la base de datos SQLite vive en el volumen `panel_db`. Haz backups periódicos:
```bash
docker compose exec app sh -c 'sqlite3 /app/db/custom.db ".backup /app/db/backup-$(date +%F).db"'
docker cp panel_app:/app/db/backup-YYYY-MM-DD.db ./backups/
```

**HTTPS con Caddy (recomendado):** edita el `Caddyfile` para que Caddy escuche en `:443` y gestione los certificados de Let's Encrypt automáticamente. Un ejemplo para `midominio.com`:

```caddyfile
midominio.com {
    reverse_proxy localhost:3000 {
        header_up Host {host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto https
        header_up X-Real-IP {remote_host}
    }

    @ws_t route /*?XTransformPort=3003*
    handle @ws_t {
        reverse_proxy localhost:3003 {
            header_up Host {host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto https
        }
    }

    @ws_ob route /*?XTransformPort=3004*
    handle @ws_ob {
        reverse_proxy localhost:3004 {
            header_up Host {host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto https
        }
    }
}
```

### Opción 2: Docker remoto (Registry privado)

Si prefieres imágenes pre-construidas:

```bash
# Local
docker build -t registry.example.com/intradia/app:1.0.0 -f Dockerfile .
docker push registry.example.com/intradia/app:1.0.0

# En el VPS, ajusta docker-compose.yml para usar esa imagen en vez de build:
# services:
#   app:
#     image: registry.example.com/intradia/app:1.0.0
#     # eliminar el bloque `build:`
```

### Opción 3: Despliegue manual (sin Docker)

```bash
# 1. Compilar
bun install --frozen-lockfile
bun run build
bunx prisma generate

# 2. Copiar al servidor
rsync -avz --exclude={node_modules,.next,db} ./ user@server:/opt/intradia/

# 3. En el servidor
cd /opt/intradia
bun install --production
cp .env.example .env
bunx prisma db push
bun run start    # sirve en :3000

# 4. Mini-services (systemd o pm2)
pm2 start bun --name ws-tick    -- mini-services/ws-tick/index.ts
pm2 start bun --name order-book -- mini-services/order-book/index.ts

# 5. Caddy como reverse proxy (misma config que arriba)
```

### Opción 4: Plataformas serverless (Vercel, Railway, Fly)

⚠️ **No recomendado** para este proyecto por dos razones:

1. **Los WebSockets requieren procesos persistentes.** Los mini-services (`ws-tick`, `order-book`) no corren en funciones serverless. Necesitas un host con procesos long-lived (Docker, Railway con worker, Fly con proceso regular).
2. **SQLite no funciona en plataformas efímeras** sin un volumen persistente (y muchas no lo ofrecen). Para serverless habría que migrar a Postgres o Turso.

Si aun así quieres ir serverless, el patrón recomendado es:
- **Vercel/Railway:** solo el dashboard (`bun run start`). Los mini-services van en un [Railway worker](https://railway.app/) o un [Fly machine](https://fly.io/).
- **Base de datos:** Turso (SQLite distribuido) o Neon (Postgres serverless).

Esta migración está fuera del alcance actual del proyecto — el código actual asume SQLite local.

---

## Actualizar a una nueva versión

```bash
git pull
docker compose down        # parar sin perder datos
docker compose up -d --build
```

Si la actualización cambia el esquema de Prisma:
```bash
docker compose exec app bunx prisma db push
```

---

## Limpieza total

```bash
# Borra contenedores, imágenes, volúmenes (DB incluida) y networks.
docker compose down -v --rmi all
```

---

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `DATABASE_URL` | `file:./db/custom.db` | Ubicación del archivo SQLite. En Docker Compose se monta como volumen. |
| `NODE_ENV` | (auto) | Forzar `production` en Docker. |
| `PORT` | `3000` | Puerto del Next.js standalone. No suele necesitar cambio. |

El proyecto **no necesita API keys** — todos los endpoints públicos de Binance / Bybit / CoinGecko que usamos son keyless.
