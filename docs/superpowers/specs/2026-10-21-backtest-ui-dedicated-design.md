# UI dedicada de Backtesting — Diseño

> Spec validado con el usuario el 2026-10-21, tras el merge de PR #41. El plan de implementación
> va en `docs/superpowers/plans/` (via writing-plans skill).

**Idioma de UI**: todas las cadenas visibles vía `t()` (`useLanguage()`), keys nuevas bajo
`backtestUI.*` en es/en/zh/fr (guardas de i18n existentes aplican en CI).

## Motivación

El backtesting hoy vive en dos modales (`BacktestModal` + `WalkForwardModal`) tapados dentro de las
cards: poca sala en fullscreen, workflow de investigación disperso y resultados solo en
localStorage. El usuario pidió: (1) workflow completo de investigación, (2) espacio fullscreen,
(3) persistencia de resultados en BD, (4) comparación de estrategias, (5) presets de configuración.

## Enfoque elegido: Server-driven (Opción B)

El server orquesta todo (corridas, comparación, guardado, presets). La página es thin client:
POSTea configs, recibe datos, renderiza. El motor `src/lib/backtest.ts` (puro, 1540 líneas, con
tests) y `POST /api/backtest` / `POST /api/backtest/walk-forward` se reusan tal cual.

## Ruta y navegación

- Nueva página `src/app/backtest/page.tsx` (client component, `"use client"`), link "Backtest" en
  el header junto a Comparar y Status.
- **El modal actual coexiste**: sigue disponible desde las cards para contexto rápido.
- Ruta visible #4 junto a `/`, `/comparar`, `/status`.

## Endpoints nuevos (todos `export const runtime = "nodejs"`)

1. **`POST /api/backtest/compare`** — comparación de estrategias con el mismo config.
   Body: `{ config, strategies }` donde strategies son ids predefinidos o `CustomStrategy`
   (cap 10). El server descarga klines **una vez** por (símbolo, intervalo, velas) — cacheada
   60s vía `lib/cache.ts` — y las pasa a cada backtest. Response:
   `[{ strategyId, name, action, error?, BacktestResult? }]` — un fallo por estrategia no aborta
   las demás (se marca `error` a nivel de estrategia, nunca datos fabricados).
2. **`POST /api/backtest/runs`** — persiste config + `BacktestResult` completo + metadatos en
   SQLite; devuelve `id`.
3. **`GET /api/backtest/runs?limit=50&symbol=&strategyId=`** — lista resumida (sin JSON pesado).
4. **`GET /api/backtest/runs/[id]`** / **`DELETE /api/backtest/runs/[id]`** — payload completo /
   borrado.
5. **`/api/backtest/presets`** — CRUD (`GET` list / `POST` save / `DELETE [id]`), en SQLite.

Nota: v1 solo la comparación es single-symbol. Multi-símbolo ya existe en `/api/backtest`
(`symbols[]`) y sigue en el Tab 1 (una corrida multi-símbolo no se compara ni se guarda con
MultiSymbolResult; es un workflow separado).

## Modelo de datos (`prisma/schema.prisma`, via `bun run db:push`)

```prisma
model BacktestRun {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())
  symbol     String
  interval   String
  candles    Int
  strategyId String?   // id predefinido, null si custom
  strategyName String
  isCustom   Boolean
  config     String   // JSON (capital, SL/TP, sizing, fees, minConfidence)
  // Índices desnormalizados (la lista no carga resultJson)
  totalTrades Int
  winRatePct  Float
  totalReturnPct Float
  maxDrawdownPct Float
  profitFactor  Float
  resultJson String   // BacktestResult serializado tal cual

  @@index([createdAt(sort: Desc)])
  @@index([symbol, interval])
  @@index([strategyId])
}

model BacktestPreset {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  name      String   @unique
  config    String
}
```

- `resultJson` como String (SQLite no tiene JSON útil en Prisma; patrón ya usado en el repo).
- Contraste con cruces (CrossEvent): ahí la escritura es fire-and-forget porque la respuesta del
  API no depende de la BD. Aquí POST/DELETE **sí** devuelven el resultado real (id created,
  confirmación de borrado): el guardado es parte del workflow pedido, no un efecto colateral.
  Los errores de lectura incidental (ej. listar presets al abrir la página) sí se degradan a
  banner sin bloquear la página.

## Layout de la página (3 tabs)

Header common: brand + estado de conexión (reusar patrón del dashboard). Desktop fullscreen
minimizado de chrome alrededor.

### Tab 1 · Corrida
- Config panel (columna izquierda sticky, `lg:grid-cols-[320px_1fr]`): símbolo, intervalo
  (15m/1h/4h/1d), velas (220/500/1000), capital, minConfidence, SL/TP, maxHold, sizing
  (full/fixedFractional), fees, estrategia (predefinida o del builder).
- Derecha: equity curve grande Canvas HiDPI (reusar el render del modal si es trivial de extraer
  a `components/panel/backtest/`, si no re-implementar — se usa una sola vez en la página),
  métricas destacadas, trade list scroll a ancho completo, acciones: Guardar en BD, Walk-Forward
  (embed inline, NO modal), aplicar/guardar presets.

### Tab 2 · Comparación
- Mismo config + multiselección de las 7 estrategias predefinidas (checkboxes) y customs del
  builder → `POST /api/backtest/compare`.
- Tabla de métricas lado a lado (trades, winRate, retorno, drawdown, profitFactor); "mejor de
  columna" resaltada (winRate/retorno máx, drawdown mín). Click en fila expande su equity curve
  + trade list debajo.
- Guardar comparación: cada estrategia compare guarda su propio run.

### Tab 3 · Historial
- Lista de `/api/backtest/runs` con filtros (símbolo, estrategia, intervalo), métricas
  resumidas + fecha. Click = carga payload completo en modo lectura
  (curva + trades). Acciones: Borrar, Exportar JSON.

Cross-tab: i18n completo vía `t()` (`backtestUI.*` keys, 4 idiomas); errores en banner por tab
(nunca datos fabricados); spinner por tab; responsive mobile single-column.

## Persistencia y límites (reglas anti-mala-práctica)

- Todo backtesting artefacto es **server-side** (SQLite), excepto el watchlist de cards que ya
  usa localStorage por diseño. Presets: ≤ 20, name ≤ 80 chars.
- Compare/runs: ≤ 10 estrategias; intervalo ∈ `VALID_INTERVALS`; velas ≤ 1000; símbolo
  validado con `isValidSymbolFormat`.
- `resultJson` cap defensivo de **1 MB** por run (real: ~100–400 KB en 500 velas); si excede,
  truncado de trades determinístico (nunca se fabrican datos).
- Errores: `{ error }` con 400 (validación) / 502 (Binance) / 500 (BD) — contrato de
  `/api/analysis`. Nunca respuesta parcial fabricada.
- Sin auto-purge en v1 (BD en volumen docker local); borrado manual por fila.

## Testing

- **TDD obligatorio en helpers puros** (`src/lib/*.test.ts`), todo nuevo lógica testable vive en
  `src/lib/`:
  - `backtest-compare.ts` — builder de tabla de comparación: campo de entrada
    `[strategyId, BacktestResult]`, salida filas de métricas + flags de "mejor de columna".
    Tests: lista vacía, empates, un solo elemento, NaN/Infinity, 10 estrategias.
  - `backtest-db.ts` — serialización/deserialización de `config`/`resultJson`, cap de 1 MB con
    truncado determinístico. Tests: round-trip, JSON inválido, payload masivo, campos faltantes.
  - Endpoint validation helpers puros (patrón `backtest-request.ts` existente).
- Rutas thin: solo validación + llamadas a helpers puros + errores por contrato.
- Baseline: 344 tests; nunca reducir el conteo.
- i18n guardas (`i18n-usage`, `i18n-hardcoded`) aplican a las keys nuevas en CI.

## Entrega

Rama `feat/backtest-ui` (creada sobre main post-squash de PR #41 `5dad277`). Commits:

1. Schema Prisma + helpers puros (TDD)
2. Endpoints `compare` / `runs` / `presets`
3. Página `/backtest` (3 tabs) + link en header + i18n
4. Smoke desde `localhost:81` (rebuild stack) + docs

## Fuera de alcance (v2)

- Multi-símbolo en comparación (matriz strategy × símbolo)
- Auto-purge/retención de runs
- Comparar contra resultados guardados (cross-run comparison)
- Optimización de parámetros / grid search
