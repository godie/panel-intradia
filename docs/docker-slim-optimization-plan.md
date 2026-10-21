# Docker — plan de optimización de la imagen de producción (`dm/docker-slim`)

> Scope: rama `dm/docker-slim` rebaseada sobre `main` (PR #39 landed);
> base docker: `003e504` (standalone traced).
> Meta: reducir el tamaño de la imagen runtime sin perder funcionalidad.
> Resultado: **544 MB → 406 MB (−138 MB, −25 %)**, verificado end-to-end
> con `docker build`, arranque en volumen fresco, healthchecks y
> `docker compose up` de los 4 servicios.

## Diagnóstico de cuellos de botella

1. **Herramientas de sistema pesadas (`util-linux`, GNU wget)**: util-linux instala
   decenas de utilidades de disco y sistema (~15–20 MB) solo para usar `setpriv`.
   Alpine ya incluye `wget` en BusyBox y la alternativa estándar y ligera para
   delegar privilegios es `su-exec` (~15 KB).
2. **Binario de Caddy sin comprimir**: el binario Go oficial de Caddy pesa ~45–50 MB.
   Al ser un binario estático sin dependencias dinámicas complejas, la compresión con
   UPX reduce su tamaño en más de un 65 % sin alterar su ejecución.
3. **Engines redundantes del Prisma CLI**: la etapa `prisma-cli` instala el paquete
   completo de Prisma y sus binarios de motor. Para ejecutar exclusivamente
   `prisma db push` solo se requiere el `schema-engine` (musl); el `query-engine`
   duplicado en el CLI (~40 MB) y los archivos de documentación/tipos no se usan
   en ejecución.
4. **Basura en el árbol standalone de Next.js**: el trazador de dependencias de
   Next.js incluye archivos `.map` (source maps), definiciones `.d.ts`, carpetas de
   testing (`__tests__`, `test`) y documentación dentro de `node_modules`.
5. **Capas redundantes y mutaciones en runner**: usar `RUN chmod +x` tras un COPY
   duplica inodos y añade capas intermedias innecesarias. BuildKit
   (`syntax=docker/dockerfile:1.7`) permite `COPY --chmod=755 --chown=bun:bun`.

## Plan de optimización y justificación técnica

| Área | Acción | Justificación técnica | Reducción aprox. |
|---|---|---|---|
| Sistema base | Cambiar util-linux por su-exec y quitar GNU wget | Elimina binarios no usados (fdisk, blkid, etc.) conservando el cambio seguro de usuario en el entrypoint (`su-exec bun ...`). BusyBox cubre el healthcheck. | ~15–20 MB |
| Caddy | Comprimir binario con UPX en etapa temporal | UPX descomprime directamente en RAM al iniciar el proceso; el archivo en disco pasa de ~45 MB a ~15 MB. | ~30 MB |
| Prisma Engines | Purgar motores no requeridos del CLI | `prisma db push` no necesita el query-engine dentro de `@prisma/engines` (Next.js usa su propio cliente generado). | ~40 MB |
| Node Modules | Purgar `.map`, `.d.ts`, `*.md` y tests en runtime | Los mapas de código fuente y tipados TypeScript no son leídos por el runtime en producción. | ~25–45 MB |
| Layer Hygiene | Centralizar permisos y directorios con flags nativas | Reemplazar `RUN chmod` y `RUN mkdir` en el runner usando `COPY --chmod=755` y ensamblando `/app/db` en la etapa previa. | ~5 MB (en capas) |

## Cómo estaba antes de la mejora

Estado de partida de `dm/docker-slim` (commit `003e504`, imagen construida el
día anterior como `panelcuantitativo/app:alpine`):

- **Imagen: 544 MB** (y el `panelcuantitativo/app:latest` pre-standalone, de
  3 semanas antes, seguía pesando 2.21 GB).
- `apk` instalaba `util-linux` completo (fdisk, blkid, etc.) y GNU wget, solo
  para `setpriv` en el entrypoint y los healthchecks.
- El entrypoint caía de privilegios con `setpriv --reuid ... --init-groups`.
- Caddy se copiaba **sin comprimir** (~44 MB en disco) desde `caddy:2-alpine`.
- `@prisma/engines` llegaba completo a la imagen (33.5 MB) con
  `query-engine`, `prisma-fmt` y `libquery_engine` duplicados respecto al
  cliente generado.
- `node_modules` con basura de runtime: source maps, `.d.ts`, `*.md` y suites
  `test/`/`__tests__/` en todo el árbol trazado, el CLI y socket.io.
- Runner con mutaciones en imagen final: `RUN chmod +x` (×2) y
  `RUN mkdir -p /app/db && chown` después de `COPY --chown`.

## Cómo está ahora

Estado final (commits `d4077e5` + `b4bd74a`), con mediciones reales:

- **Imagen: 406 MB** (−138 MB, −25 % respecto a 544 MB), tags
  `panelcuantitativo/app:latest` y `:alpine` apuntando al contenido slim.
- Base con `bash ca-certificates openssl libstdc++ libc6-compat su-exec` —
  sin util-linux ni wget; los HEALTHCHECK usan el applet BusyBox.
- Entrypoint: `exec su-exec bun:bun "$0" "$@"` (PID 1 se mantiene, SIGTERM intacto).
- Caddy UPX-comprimido (`--best --lzma` en etapa temporal `caddy-upx`):
  **44 → 10.4 MB** en disco, `caddy version` (v2.11.7) corriendo dentro del build
  y en runtime.
- `@prisma/engines`: **33.5 → 18.5 MB** (`query-engine-*`, `prisma-fmt-*` y
  `libquery_engine-*` fuera; queda solo el `schema-engine` que usa `db push`).
- `node_modules` (trazado + CLI + mini-services) sin `*.md`, `*.map`, `*.d.ts`,
  `*.tsbuildinfo`, ni directorios `test`/`tests`/`docs`/`__tests__`.
- Runner sin `RUN chmod` ni `RUN mkdir`: scripts con `COPY --chmod=755` y
  `/app/db` ensamblado+chowneado en la etapa runtime (throwaway).

Tabla por área (estimado del plan vs medido):

| Área | Estimado | Medido |
|---|---|---|
| Sistema base (su-exec − util-linux − wget) | ~15–20 MB | junto con el resto, abajo |
| Caddy UPX | ~30 MB | ~34 MB (44 → 10.4 MB) |
| Prisma engines | ~40 MB | ~15 MB en `@prisma/engines` + redundantes en `@prisma/client/runtime` (ya purgados antes) |
| node_modules purge | ~25–45 MB | ~23 MB (incluida `docs/`) |
| Layer hygiene | ~5 MB | cero `RUN chmod/mkdir` en runner (menos capas) |
| **Total** | **~110–140 MB** | **−138 MB (544 → 406)** |

## Cambios hechos

`docker-entrypoint.sh` (1 commit) y `Dockerfile` (2 commits):

1. **`d4077e5` — perf(docker): −115 MB**
   - Base: `util-linux` y `wget` fuera; `su-exec` entra.
   - Entrypoint: `setpriv` → `su-exec bun:bun`.
   - Etapa `caddy-upx` (alpine + upx) comprime el binario; el runner copia desde ahí.
   - Etapa `prisma-cli`: `rm -f @prisma/engines/query-engine-* /prisma-fmt-*`.
   - Etapa runtime: purga extendida de `node_modules` (maps/dts/md/docs/tests)
     para el árbol trazado, el CLI y `mini-services/*/node_modules`; `/app/db`
     creado y chowneado ahí mismo.
   - Runner: `COPY --chmod=755 --chown=bun:bun` para los scripts; sin
     `RUN chmod`, sin `RUN mkdir /app/db`.
2. **`b4bd74a` — perf(docker): purgar libquery_engine y docs (−23 MB)**
   - El árbol trazado por Next ya traía su propia copia de `@prisma/engines` con
     `libquery_engine` (15 MB) que la purga de la etapa `prisma-cli` no
     alcanzaba (COPY no borra archivos ya presentes) → purga también en la
     etapa runtime.
   - `docs/` de los paquetes añadido a la purga de directorios.

## Verificación

- `docker build` exit 0; UPX ejecuta `caddy version` dentro del build.
- Volumen fresco: `prisma db push` crea el esquema ("DB ready"), Next Ready,
  `GET /` → 200 (BusyBox wget), `/api/status` con los dos mini-services OK.
- Mini-services: `tick-stream /health` y `order-book /health` con
  `binanceConnected: true` (probados individualmente y vía compose).
- Variante `ALL_IN_ONE=1` completa: caddy sirve el dashboard, mini-services
  conectados a Binance.
- `docker compose up -d --build` de los 4 servicios: app/tick-stream/order-book
  **healthy** (healthchecks de compose con BusyBox wget), caddy detrás;
  gateway :81 → dashboard 200, `/api/analysis` con datos reales,
  `/api/status` ok:true, sockets por prefijos `/_tick-stream/socket.io/` y
  `/_order-book/socket.io/` con CORS correcto (403 sin Origin / 200 con
  `Origin: http://localhost:81`).

## Mini-services: misma receta (355 → 158 MB)

Los Dockerfiles propios de `mini-services/tick-stream` y `mini-services/order-book`
(la variante standalone de cada servicio; el compose usa la imagen del app) pasaron
por el mismo tratamiento:

| | Antes | Ahora |
|---|---|---|
| Base | `oven/bun` Debian + `apt-get install wget ca-certificates` | `oven/bun` **alpine** (musl) + solo `ca-certificates` (wget es applet de BusyBox) |
| node_modules | intactos | purgados en la MISMA layer (`.md`/`.map`/`.d.ts`/, `test`/`tests`/`docs`/`__tests__`) |
| Usuario | root | `USER bun` + `COPY --chown=bun:bun` (no tocan volúmenes/db, no necesitan el entrypoint) |
| **Tamaño** | **386 MB c/u** | **158 MB c/u (−228 MB, −59 %)** |

Verificación: ambos contenedores boot con `/health` correcto y
`binanceConnected: true`, corren como `bun`, y `mini-services/validate-service.sh`
PASA para los dos (contrato de `/health`, handshake en `/socket.io/` con
Origin permitido, 403 sin Origin/extranjero, 404 en ruta desconocida). Nota:
el :3005 del host estaba ocupado por un túnel ssh ajeno, la validación corrió
en un contenedor con el repo montado.

## Cómo replicar / desplegar

```bash
docker build -t panelcuantitativo/app:latest .   # ~406 MB
docker compose up -d --build                     # stack completo, healthchecks
```

Nota: `docs/` está en `.dockerignore`, así que este archivo no entra en la imagen.
