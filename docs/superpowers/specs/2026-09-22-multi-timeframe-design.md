# Multi-timeframe analysis + comparison page — Design

**Date**: 2026-09-22
**Status**: approved (design), pending implementation plan

## Goal

Hoy todo el análisis se calcula sobre velas de **4h** y el sufijo `_4h` está
hardcodeado en el schema del response. El usuario quiere:

1. Poder ver cada card en **1h, 4h, 1D o 1W**.
2. Una **página fullscreen de comparación** con dos temporalidades fijas a la
   vez, para contrastar señal micro vs macro (ej. "en 4h dice vender y en 1W
   mantener o comprar") y sacar su propia conclusión.

Decisiones tomadas durante el brainstorming:

- Selector de temporalidad **por card** (no global), default `4h`.
- La comparación es una **página propia fullscreen**, no un modal.
- En la comparación, cada celda muestra **señal + métricas clave**.
- Las temporalidades son **3 presets fijos consecutivos** (sin dropdowns):
  `1h↔4h`, `4h↔1D`, `1D↔1W`.
- Los campos del response se **renombran sin sufijo** (`rsi_14_4h` → `rsi_14`)
  y se agrega `timeframe`. Ningún campo miente sobre su intervalo.

## Non-goals

- No se agregan intervalos distintos de 1h/4h/1D/1W.
- No se agrega un selector libre de pares de temporalidades.
- No se cambia el intervalo que usan los agregados del dashboard (quedan en 4h).
- No se toca el backtest más allá del rename de campos.

## 1. `src/lib/timeframes.ts` (nuevo — puro, testeable)

```ts
export type Timeframe = "1h" | "4h" | "1d" | "1w";

/** Orden canónico mostrado en la UI. */
export const TIMEFRAMES: readonly Timeframe[] = ["1h", "4h", "1d", "1w"];

export const DEFAULT_TIMEFRAME: Timeframe = "4h";

/** i18n keys for the short label shown on the selector buttons. */
export const TIMEFRAME_LABEL_KEY: Record<Timeframe, string> = {
  "1h": "tf.1h",
  "4h": "tf.4h",
  "1d": "tf.1d",
  "1w": "tf.1w",
};

export function isTimeframe(value: unknown): value is Timeframe;

/** Accepts case/alias variants and returns the canonical value, or null.
 *  "4H" -> "4h", "1D"/"daily"/"d" -> "1d", "1W"/"weekly"/"w" -> "1w",
 *  "1H"/"hourly" -> "1h". Unknown -> null. */
export function normalizeTimeframe(value: string | null | undefined): Timeframe | null;

export type ComparePreset = {
  /** URL id, e.g. "4h-1d". */
  id: string;
  /** Left column (micro / shorter timeframe). */
  a: Timeframe;
  /** Right column (macro / longer timeframe). */
  b: Timeframe;
};

export const COMPARE_PRESETS: readonly ComparePreset[] = [
  { id: "1h-4h", a: "1h", b: "4h" },
  { id: "4h-1d", a: "4h", b: "1d" },
  { id: "1d-1w", a: "1d", b: "1w" },
];

export const DEFAULT_COMPARE_PRESET_ID = "4h-1d";

/** Returns the matching preset, or null for an unknown id. */
export function getPreset(id: string | null | undefined): ComparePreset | null;

/** localStorage key holding the per-symbol timeframe map (one JSON object). */
export const TF_MAP_STORAGE_KEY = "panel:tf-map";

/** Parse the persisted map. Never throws: unknown keys/values are dropped,
 *  unknown timeframes are ignored. Returns {} for "" / malformed / null. */
export function parseTimeframeMap(raw: string | null): Record<string, Timeframe>;

/** Inverse of parseTimeframeMap. */
export function serializeTimeframeMap(map: Record<string, Timeframe>): string;
```

Reglas:
- Binance/Bybit esperan el intervalo en minúscula (`1d`, `1w`), que es el valor
  canónico que se usa tanto en el query param `tf` como en `getKlines`.
- `isTimeframe` hace match exacto sobre el valor canónico (sin normalizar).
- `normalizeTimeframe` es el borde de entrada (query param / localStorage).
- **Una sola clave de localStorage** (`panel:tf-map`) guarda el TF de todos los
  símbolos, en vez de una clave por símbolo. Motivo: `useLocalStorageString`
  (el hook hydration-safe existente) no se puede llamar dentro de un
  `symbols.map()` (reglas de hooks), y el page necesita conocer el TF de todos
  los símbolos para armar los fetch. Una clave + `useMemo` sobre el JSON
  resuelve las dos cosas sin `setState` en render ni en effect.

Tests (`src/lib/timeframes.test.ts`): cada valor canónico, cada alias,
mayúsculas, `null`/`""`/basura → `null`, `getPreset` con id válido/inválido,
que los presets sean consecutivos (el `b` de un preset es el `a` del siguiente),
y `parseTimeframeMap` → `serializeTimeframeMap` round-trip + entradas
corruptas (`"{"`, `"null"`, valores no-Timeframe, claves vacías).

## 2. Schema del response (`src/lib/types.ts`)

`AnalysisResponse` gana:

```ts
/** Intervalo de vela sobre el que se calcularon los indicadores. */
timeframe: Timeframe;
```

Rename (mismo nivel, sin sufijo):

| antes | después |
|---|---|
| `ema55_4h` | `ema55` |
| `ema200_4h` | `ema200` |
| `rsi_14_4h` | `rsi_14` |
| `atr_14_4h` | `atr_14` |
| `vwap_20_4h` | `vwap_20` |

Las mismas 5 claves dentro de `no_disponible`. Los comentarios que dicen
"on 4h" pasan a "on the response's `timeframe`".

No se renombran los campos **cuyo nombre no lleva sufijo** (aunque su contenido
sí se calcule sobre el intervalo elegido): `spot_price`, `change_24h_pct`,
`volume_24h_usd`, `trades_24h`, `high_24h`, `low_24h` (estos seis vienen del
ticker de 24h, son independientes del intervalo), `series`, `fibonacci`,
`stop_loss_suggestion`, `bollinger*`, `stochastic`, `stoch_cross`, `ichimoku`,
`structure_text`.

Consumidores a actualizar (rename mecánico):
`src/app/api/analysis/route.ts`, `src/lib/strategies.ts`,
`src/lib/custom-strategies.ts`, `src/lib/backtest.ts`,
`src/components/panel/asset-card.tsx`,
`src/components/panel/ticker-detail-modal.tsx`,
`src/components/panel/market-summary.tsx`,
`src/components/panel/market-overview.tsx`.

### `src/lib/backtest.ts`

- Sólo rename de las 5 claves en `buildAnalysisSnapshot`.
- **No** se le agrega `timeframe` a `buildAnalysisSnapshot`. Ese objeto es un
  *fixture parcial* que sólo alimenta `strategy.evaluate()` (ya se construye con
  `as unknown as AnalysisResponse`, así que la ausencia de campos no la detecta
  TypeScript), y ninguna estrategia lee `timeframe`. Si una futura estrategia lo
  lee, el lugar a arreglar es ese cast.
- `BacktestInterval = "15m" | "1h" | "4h" | "1d"` (ya existe, línea 46) **no se
  toca**: es un dominio distinto del de la UI (tiene `15m`, no tiene `1w`). La
  duplicación de los 3 valores compartidos es intencional y se resuelve recién
  si los dos dominios convergen.

**Sin migración**: verificado que `src/lib/saved-backtests.ts` persiste
`BacktestResult` (stats/trades/params/strategy) y **no** contiene ningún
`AnalysisResponse`, así que los backtests guardados no se rompen con el rename.
`export-snapshot.ts` sí exporta `AnalysisResponse` a un archivo que el usuario
descarga: los archivos viejos quedan con las claves `_4h` y no se migran
(aceptado).

## 3. API (`src/app/api/analysis/route.ts`)

- Query param nuevo **opcional**: `tf`.
  - Ausente → `DEFAULT_TIMEFRAME` (`4h`), retrocompatible.
  - Inválido → `400 { error: "Temporalidad inválida. Usar 1h, 4h, 1d o 1w." }`.
- `providerRouter.getKlines(symbol, tf, 500)`.
- Cache key: `analysis:${symbol}:${tf}` (TTL 60s, igual que hoy).
- `buildAnalysis(symbol, klines, ticker, source, tf)` agrega `timeframe: tf`
  al payload.
- 500 velas en todos los intervalos: `EMA200` necesita 200 y el Fibonacci mira
  100. Para `1h` eso son ~21 días de historia, suficiente.

## 4. Dashboard (`src/app/page.tsx`)

- `cells` se keyea `"${symbol}:${tf}"` en vez de `symbol`. Todos los accesos
  (`tickerItems`, reconciliación, skeletons, guardas de error) usan ese key.
- El TF por símbolo vive en **una sola** clave de localStorage
  (`TF_MAP_STORAGE_KEY`, un JSON `{"BTCUSDT":"1h",...}`) leída con el hook ya
  existente `useLocalStorageString` (`src/hooks/use-local-storage.ts`, basado en
  `useSyncExternalStore` → hydration-safe, sin `setState` en render):

  ```ts
  const [tfMapRaw, setTfMapRaw] = useLocalStorageString(TF_MAP_STORAGE_KEY, "{}");
  const tfMap = useMemo(() => parseTimeframeMap(tfMapRaw), [tfMapRaw]);
  const tfFor = (s: string) => tfMap[s] ?? DEFAULT_TIMEFRAME;
  ```

  Se mantiene un `tfMapRef` (mismo patrón que el `symbolsRef` que ya existe) para
  que `fetchAll` (callback estable) lea el mapa vigente sin recrearse.
- `fetchAll` arma las keys como `` `${s}:${tfFor(s)}` `` para cada símbolo y
  fetchea `/api/analysis?symbol=X&tf=TF`. Con todo en 4h (default) es
  exactamente el mismo request que hoy.
- El estilo de actualización sigue el patrón **ya existente** en el effect de
  reconciliación (que ya hace `setCells(...)` adentro): se le agrega `tfMapRaw`
  a las dependencias, así cambiar un TF siembra el cell nuevo y refetchea. No se
  introduce ningún patrón nuevo de efectos.
- Cada card renderiza un **`TimeframeSelector`** nuevo
  (`src/components/panel/timeframe-selector.tsx`) — controlado por props
  (`value`, `onChange`), sin estado propio ni localStorage adentro:
  4 botones (`1h 4h 1D 1W`), el activo destacado, `aria-pressed`, y labels desde
  `t(TIMEFRAME_LABEL_KEY[tf])`. El page es el único que persiste
  (`setTfMapRaw(serializeTimeframeMap({ ...tfMap, [symbol]: tf }))`).
- **Agregados fijos en 4h**: `TickerTape`, `MarketSummary`, `MarketOverview` y
  `useStrategyAlerts` siguen alimentándose de `cells["${symbol}:4h"]`, y su
  header muestra la etiqueta `4h`. Consecuencia buscada: si el usuario no toca
  ningún selector, no hay requests extra.
- `AssetCard` recibe `timeframe` (para mostrar "· 1D" en los labels de EMA/RSI)
  y `onCompare` opcional para el botón "Comparar".
- Los labels que hoy tienen el `4h` **hardcodeado en el JSX** pasan a usar el TF
  activo (mismo `t(TIMEFRAME_LABEL_KEY[tf])`):
  - `asset-card.tsx`: `${t("card.ema55")} · 4h`, `${t("card.ema200")} · 4h`.
  - `ticker-detail-modal.tsx`: `${t("card.ema55")} · 4h`, `${t("card.ema200")} · 4h`.
  El modal recibe el `timeframe` del cell que abrió, no siempre 4h.

## 5. `src/lib/consensus.ts` (nuevo — puro, testeable)

Se extrae la lógica hoy embebida en
`src/components/panel/strategy-consensus.tsx` a una función pura:

```ts
export type ConsensusLevel =
  | "strong_buy" | "buy" | "mixed" | "short" | "strong_short";

export type ConsensusResult = {
  level: ConsensusLevel;
  votes: Record<StrategyAction, number>;
  avgConfidence: number;
  /** -100 (all short) .. +100 (all buy), para la barra de score. */
  scorePct: number;
  results: (StrategyResult & { strategy: Strategy })[];
};

export function computeConsensus(data: AnalysisResponse): ConsensusResult;
```

Mantiene exactamente los umbrales actuales: `BUY>=3 && SHORT===0` →
`strong_buy`; `BUY>=2 && SHORT===0` → `buy`; `SHORT>=3 && BUY===0` →
`strong_short`; `SHORT>=2 && BUY===0` → `short`; si no, `mixed`.

`strategy-consensus.tsx` pasa a consumir `computeConsensus` (la UI no cambia:
mismos badges, misma barra, misma lista). La tabla de comparación usa la misma
función → una sola fuente de verdad.

Tests (`src/lib/consensus.test.ts`): cada nivel de consenso, el conteo de votos,
`avgConfidence`, `scorePct` clampeado a ±100, y un `data` sin indicadores
(`no_disponible` todo true) → no rompe y da `mixed` o `WAIT` según los umbrales.

## 6. Página `/comparar` (`src/app/comparar/page.tsx`)

- Ruta nueva, **fullscreen**, con el mismo shell que `/` (header, `terminal-grid`,
  footer sticky `mt-auto`), `"use client"`.
- Selector de preset: 3 botones con los `COMPARE_PRESETS`. El preset activo se
  lee de `searchParams` (`?preset=4h-1d`) y al cambiarlo se hace
  `router.replace` con el nuevo id, para que la URL sea compartible y
  sobreviva el reload. Id desconocido → `DEFAULT_COMPARE_PRESET_ID`.
- Tabla responsive (con scroll horizontal en mobile):
  - Fila = cada símbolo del watchlist (`loadWatchlist()` adoptado en un effect,
    igual que en `/` — nunca en el initializer).
  - Columna izquierda = preset `a`, columna derecha = preset `b`.
  - Cada celda muestra: acción de consenso (`computeConsensus`) + % de
    confianza, estado EMA (`cross_state`), precio (`spot_price`), `rsi_14`,
    `ema55`/`ema200`, `macd.histogram`, `atr_14`, y si hay cruce reciente
    (`cross_info.happened` / `macd_cross.happened`).
  - Valores `no_disponible` → "N/D" (misma convención que las cards).
- Datos: `Promise.all` sobre `símbolos × [a, b]` contra
  `/api/analysis?symbol=X&tf=TF`, con `cache: "no-store"` y reusando el cache
  server-side de 60s. Sin símbolos → estado vacío. Error en una celda → "N/D"
  en esa celda, la tabla no se cae.
- Accesos: botón **"Comparar"** en el header de `/` y en cada `AssetCard`
  (reusa `lucide-react`; `onCompare` opcional en `Props`), que navega a
  `/comparar?preset=4h-1d`.
- Volver a `/`: link en el header de `/comparar`.

## 7. i18n (`src/lib/i18n.ts`)

Claves nuevas en los 4 idiomas (`es` default, `en`, `zh`, `fr`):

- `tf.1h`, `tf.4h`, `tf.1d`, `tf.1w` — labels cortos ("1H", "4H", "1D", "1W").
- `tf.label` — "Temporalidad" / "Timeframe".
- `compare.title`, `compare.subtitle`, `compare.preset`, `compare.colA`,
  `compare.colB`, `compare.empty`, `compare.loading`, `compare.back`,
  `compare.asset`, `compare.consensus`, `compare.emaState`, `compare.price`,
  `compare.recentCross`.

Ninguna string visible hardcodeada (regla de AGENTS.md).

## 8. Verificación

- `bun run lint` → 0 errores, 0 warnings.
- `bun run test` → los 228 actuales + `timeframes.test.ts` + `consensus.test.ts`.
- Manual:
  - `curl '/api/analysis?symbol=BTCUSDT'` → `timeframe:"4h"` y `rsi_14` (no `rsi_14_4h`).
  - `curl '/api/analysis?symbol=BTCUSDT&tf=1w'` → `timeframe:"1w"`, `rsi_14`
    distinto al de 4h.
  - `curl '/api/analysis?symbol=BTCUSDT&tf=99'` → 400.
  - `/` → cambiar una card a 1D, recargar, verificar que persiste, y que el
    resto del dashboard sigue en 4h.
  - `/comparar?preset=1d-1w` → tabla con las 2 columnas, con datos reales.
  - Sin errores de hydration en consola (el watchlist y el TF se leen en
    effects / `useSyncExternalStore`, nunca en el render inicial).

## Riesgos

- **Volumen del rename**: 8 archivos, ~80 referencias. Mitigado por el rename
  mecánico, el typecheck estricto (`tsc --noEmit`) y los 228 tests existentes —
  si alguna referencia queda con `_4h`, TypeScript falla.
- **Requests**: con N símbolos y ambos selectores cambiados, el dashboard pide
  N pares extra (uno por símbolo cambiado). `/comparar` pide `2 × N`. Todo pasa
  por el cache de 60s y por el `AbortController` existe en `fetchAll`.
- **Confusión de agregados en 4h**: el header de `MarketSummary`/`MarketOverview`
  debe mostrar "4h" explícito para que no se lea como si siguiera al selector
  de las cards.
