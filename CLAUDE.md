# Panel Cuantitativo // Intradía

Dashboard Next.js de análisis técnico intradía en vivo para pares cripto
contra USDT (BTC, ETH, XRP, SOL, BNB). Ver `README.md` para la descripción
completa de features y `INSTALL.md` para despliegue. Este archivo cubre solo
lo que un agente necesita para trabajar en el repo con seguridad.

## Stack

- Next.js 16 (App Router, `output: standalone`), React 19, TypeScript 5 (strict)
- Tailwind CSS 4 + Radix UI + shadcn/ui, Zustand, TanStack Query
- Prisma 6 + SQLite (`db/custom.db`, modelo `CrossEvent`)
- Vitest 4 para tests unitarios; ESLint 9 (`eslint-config-next`)
- Runtime: **Bun** (no npm/yarn) — `bun install`, `bun run <script>`
- Mini-services independientes en `mini-services/` (Bun + socket.io):
  `order-book` (:3004) y el tick-stream WS. Se instalan/arrancan por
  separado de la app Next.js.

## Comandos

```bash
bun run dev          # dev server, puerto 3000 (loguea a dev.log)
bun run build         # build standalone
bun run lint          # ESLint sobre todo el repo
bun test              # vitest run (bun run test también funciona)
bun run test:watch
bun run db:push       # aplica schema Prisma a SQLite (sin migración)
bun run db:migrate    # migración nueva
bun run db:reset      # ⚠ borra CrossEvent persistidos
```

Los tests viven junto al código fuente (`src/lib/**/*.test.ts`), no en
`tests/` (esa carpeta es para scripts de shell de build/CI). Antes de dar
por terminado un cambio en `src/lib`, corre `bun test` y `bun run lint`.

## Arquitectura de proveedores de datos (`src/lib/providers/`)

Rama activa: `feat/provider-abstraction-bybit` — se está generalizando el
acceso a mercado para no depender solo de Binance.

- `types.ts` define la interfaz `MarketDataProvider` que todo proveedor
  (Binance, Bybit, …) debe implementar. Convenciones clave:
  - Símbolos siempre en mayúsculas terminados en `USDT` (p. ej. `BTCUSDT`);
    el remapeo específico de cada exchange vive en `symbols.ts`.
  - Toda llamada de red dentro de un provider **debe** lanzar
    `UpstreamError` en caso de fallo — el router depende de esto para
    tratar los fallos de forma uniforme.
  - `getKlines`/`getTicker24h` devuelven datos completos o lanzan; nunca
    datos parciales.
  - `subscribeTicks` devuelve una función `unsubscribe`.
- `router.ts` (`createProviderRouter`) prueba proveedores en orden y usa
  el primero saludable/exitoso, cacheando la fuente activa en memoria. El
  singleton por defecto (`providerRouter`) usa `[binance, bybit]` en ese
  orden. Los tests inyectan su propia lista de providers.
- Al añadir un proveedor nuevo: implementar `MarketDataProvider` en su
  propio archivo (ver `binance.ts`/`bybit.ts` como referencia), añadir su
  `ProviderId` en `types.ts`, registrar en el array del router, y cubrir
  con tests siguiendo el patrón `*.test.ts` existente (`router.test.ts`,
  `symbols.test.ts`, etc.).

## Convenciones de código

- Alias de import `@/*` → `src/*` (configurado en `tsconfig.json` y
  `vitest.config.ts`).
- ESLint tiene la mayoría de reglas estrictas desactivadas a propósito
  (`no-explicit-any`, `no-unused-vars`, `exhaustive-deps`, etc. → `off`).
  No las reactives en código nuevo sin que el usuario lo pida.
- i18n: diccionario estático en `src/lib/i18n.ts`, 4 idiomas (es/en/zh/fr),
  español por defecto. Si tocas texto visible en UI, actualiza las 4
  entradas.
- Indicadores técnicos (`src/lib/indicators.ts`, `structure.ts`) son
  funciones puras — así se testean en Vitest sin mocks de red. Mantén esa
  separación: lógica de cálculo pura vs. fetch/IO en providers o API
  routes.
- Endpoints API en `src/app/api/*/route.ts` devuelven `400` para símbolos
  no soportados y `502` si el upstream (exchange) falla — no cambies estos
  contratos sin actualizar el frontend que espera `"Dato no disponible"`.

## Base de datos

- SQLite local vía Prisma, un único modelo `CrossEvent` (cruces EMA/MACD/
  squeeze/estocástico persistidos con dedup adaptativo).
- `bun run db:reset` es destructivo — nunca ejecutarlo sin confirmación
  explícita del usuario.

## Cosas a NO hacer

- No uses `npm`/`yarn` — el proyecto usa Bun exclusivamente (hay
  `bun.lock`, no `package-lock.json`).
- No borres ni reescribas `db/custom.db` ni corras `db:reset` sin permiso.
- No subas archivos `preview-*.png`/`worklog.md` a limpieza automática —
  son artefactos de iteración del proyecto, no basura.
- No asumas un único exchange: cualquier código que hable con "el mercado"
  debe pasar por `providerRouter`, no importar `binance.ts` directamente.
