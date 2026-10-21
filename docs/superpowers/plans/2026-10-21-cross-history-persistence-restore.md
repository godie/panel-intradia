# Cross-History Persistence — Plan de corrección

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restaurar la persistencia de cruces (EMA/MACD/momentum/squeeze/stoch) a SQLite (muerta desde el PR #4) y arreglar la pantalla de historial que parece vacía aunque la BD tenga 120 cruces.

**Architecture:** `/api/analysis` es el único lugar que ve la series crudas de cada `(symbol, timeframe)`. Se extrae una función **pura** `collectCrossCandidates(payload)` que decide, desde el payload ya computado, qué cruces son "fresh"; el route la invoca fire-and-forget tras `buildAnalysis` y cada candidato pasa por `recordCrossIfNew` (dedup 6h ya existente en DB). En la UI, el header `CrossHistory` debe dejar de depender exclusivamente de las stats de 7 días para no aparentar vacío.

**Tech Stack:** Next.js 16 API routes (`runtime=nodejs`), Prisma + SQLite, Vitest.

## Global Constraints

- TypeScript strict, imports con alias `@/` para `src/lib/` (AGENTS.md §2).
- Funciones nuevas en `src/lib/` puras y con tests antes que la implementación (AGENTS.md §1, §3). Baseline: 337 tests, no reducir el conteo.
- Tests viven en `src/lib/*.test.ts`; nunca en `src/app/`.
- No hardcodear strings visibles: usar `t()` de `useLanguage()` (AGENTS.md §5).
- Errores de DB jamás rompen la respuesta del API: `recordCrossIfNew` ya silencia sus errores y registra en stderr (mantener).
- Baseline del runtime antes de tocar: lint/typecheck/test verdes (verificados hoy post-rebase de main).

## Diagnóstico

1. **La escritura está muerta desde PR #4.** `git log -S persistCrosses` muestra que fue añadida en `c69c199` (2026-08-29) a `src/app/api/analysis/route.ts` y eliminada en `0a2c7f8` "harden websocket routing and types" (`2026-09-07`, merged ~2026-09-10). Hoy `persistCrosses` no existe en ningún lado y `recordCrossIfNew` no tiene ningún caller en `src/` (grep verificado). La tabla acumuló 120 filas entre 2026-08-28 y 2026-09-10 y **cero filas desde entonces** (`MAX(detectedAt)=2026-09-10T17:03:32Z` sobre el volumen real `panel_db`, con sqlite3 dentro de un contenedor).
2. **La lectura funciona.** Verificado en runtime: contenedor con `panel_db` montado → `wget /api/cross-history?limit=5` devuelve los eventos JSON correctos (`{events, stats, count}`). Consumers existentes: `CrossHistory` (limit=30, poll 60s), `useCrossAlerts` (limit=20), `ticker-detail-modal` (symbol&limit=10).
3. **La UI parece vacía por dos razones de UX, no por datos:**
   - `CrossHistory` arranca colapsado (`expanded=false` por defecto).
   - El subheader solo muestra counts de `getCrossStats(7)`, es decir cruces de los últimos 7 días. Con el último cruce a 41 días, `totalAll=0` y el header cae al fallback `"EMA · MACD · momentum flips persistidos en SQLite"`, que parece "no hay nada".
4. **Latente (fuera de alcance mínimo, detectado en la investigación):** `CrossEvent` no tiene columna `timeframe`; el dedup (symbol+type+direction, 6h) trata como duplicado el mismo cruce detectado en 1h y 4h. Tarea futura opcional.

Archivos que tocaremos:
- `src/lib/cross-history.ts`: añade `collectCrossCandidates` (función pura).
- `src/lib/cross-history.test.ts`: nuevo, tests de la función pura.
- `src/app/api/analysis/route.ts`: añade el fire-and-forget en el GET.
- `src/components/panel/cross-history.tsx`: header sin falso vacío.

---

### Task 1: `collectCrossCandidates` (puro, TDD)

**Files:**
- Modify: `src/lib/cross-history.ts` (añadir export al final del bloque de tipos/funciones puras)
- Create: `src/lib/cross-history.test.ts`

**Interfaces:**
- Consumes: `AnalysisResponse` de `@/lib/types` (campos: `symbol`, `spot_price`, `cross_info`, `macd_cross`, `bollinger_squeeze`, `squeeze_breakout`, `stoch_cross`).
- Produces: `type CrossCandidate = { symbol: string; type: CrossEventType; direction: CrossDirection; price: number; candlesAgo: number }` y `collectCrossCandidates(payload: AnalysisResponse): CrossCandidate[]`. Task 2 usa exactamente este contrato.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { collectCrossCandidates } from "./cross-history";
import type { AnalysisResponse } from "./types";

function basePayload(overrides: Partial<AnalysisResponse> = {}): AnalysisResponse {
  return {
    symbol: "BTCUSDT",
    timeframe: "4h",
    spot_price: 80468.63,
    change_24h_pct: 2.3,
    ema55: 82453.99,
    ema200: 81958.3,
    cross_state: "ALCISTA",
    cross_info: { happened: true, candles_since_cross: 2, direction: "bullish", window: 10 },
    resistance: null,
    support: null,
    rsi_14: 55,
    volume_24h_usd: null,
    trades_24h: null,
    high_24h: null,
    low_24h: null,
    macd: { line: 1, signal: 0.5, histogram: 0.5 },
    macd_cross: {
      happened: true,
      candles_since_cross: 1,
      direction: "bullish",
      momentum_flip: true,
      momentum_flip_direction: "bearish",
      candles_since_flip: 3,
      window: 6,
    },
    atr_14: 100,
    bollinger: { upper: 2, middle: 1, lower: 0, bandwidth: 3.5 },
    bollinger_squeeze: { is_squeezed: false, threshold_pct: 3, bandwidth: 3.5 },
    squeeze_breakout: { happened: false, direction: null, candles_since_breakout: null, bandwidth_before: null, bandwidth_after: null },
    stop_loss_suggestion: null,
    fibonacci: null,
    vwap_20: null,
    stochastic: { k: 50, d: 48 },
    stoch_cross: { happened: true, candles_since_cross: 4, direction: "bullish", k_at_cross: 30 },
    ichimoku: {
      tenkan: 1, kijun: 1, senkou_a: 1, senkou_b: 1, chikou: 1,
      cloud_color: "bullish", price_vs_cloud: "above",
    },
    structure_text: "",
    source: "binance",
    no_disponible: {} as AnalysisResponse["no_disponible"],
  } as unknown as AnalysisResponse;
}
```

Tests (un `describe` por contenido):

```ts
describe("collectCrossCandidates", () => {
  it("ema fresh → 1 candidato 'ema' bullish", () => {
    const p = basePayload({ macd_cross: null, stoch_cross: { happened: false, candles_since_cross: null, direction: null, k_at_cross: null } });
    const out = collectCrossCandidates(p);
    expect(out).toEqual([
      { symbol: "BTCUSDT", type: "ema", direction: "bullish", price: 80468.63, candlesAgo: 2 },
    ]);
  });

  it("macd cross + momentum flip → 2 candidatos distintos", () => {
    const p = basePayload({
      cross_info: { happened: false, candles_since_cross: null, direction: null, window: 10 },
      stoch_cross: { happened: false, candles_since_cross: null, direction: null, k_at_cross: null },
    });
    const out = collectCrossCandidates(p);
    expect(out.map((c) => c.type).sort()).toEqual(["macd", "momentum"]);
  });

  it("squeeze_breakout happened → candidato con la direction del breakout", () => {
    const p = basePayload({
      cross_info: { happened: false, candles_since_cross: null, direction: null, window: 10 },
      macd_cross: null,
      stoch_cross: { happened: false, candles_since_cross: null, direction: null, k_at_cross: null },
      squeeze_breakout: { happened: true, direction: "bearish", candles_since_breakout: 2, bandwidth_before: 2.8, bandwidth_after: 4.1 },
    });
    const out = collectCrossCandidates(p);
    expect(out).toEqual([
      { symbol: "BTCUSDT", type: "squeeze_breakout", direction: "bearish", price: 80468.63, candlesAgo: 2 },
    ]);
  });

  it("squeeze activo → candidato 'squeeze' con direction 'neutral'", () => {
    const p = basePayload({
      cross_info: { happened: false, candles_since_cross: null, direction: null, window: 10 },
      macd_cross: null,
      stoch_cross: { happened: false, candles_since_cross: null, direction: null, k_at_cross: null },
      bollinger_squeeze: { is_squeezed: true, threshold_pct: 3, bandwidth: 2.1 },
    });
    const out = collectCrossCandidates(p);
    expect(out).toEqual([
      { symbol: "BTCUSDT", type: "squeeze", direction: "neutral", price: 80468.63, candlesAgo: 0 },
    ]);
  });

  it("spot_price null → lista vacía (no hay precio que registrar)", () => {
    const out = collectCrossCandidates(basePayload({ spot_price: null }));
    expect(out).toEqual([]);
  });

  it("payload sin cruces fresh → lista vacía", () => {
    const out = collectCrossCandidates(basePayload({
      cross_info: { happened: false, candles_since_cross: null, direction: null, window: 10 },
      macd_cross: { happened: false, candles_since_cross: null, direction: null, momentum_flip: false, momentum_flip_direction: null, candles_since_flip: null, window: 6 },
      stoch_cross: { happened: false, candles_since_cross: null, direction: null, k_at_cross: null },
    }));
    expect(out).toEqual([]);
  });

  it("top-level nulls (cross_info=null, macd_cross=null, stoch_cross=null) → 0 candidatos y sin throw", () => {
    const out = collectCrossCandidates(basePayload({ cross_info: null, macd_cross: null, stoch_cross: null }));
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/lib/cross-history.test.ts`
Expected: FAIL — "collectCrossCandidates is not exported" / import error.

- [ ] **Step 3: Write minimal implementation** (append to `src/lib/cross-history.ts`)

```ts
export type CrossCandidate = {
  symbol: string;
  type: CrossEventType;
  direction: CrossDirection;
  price: number;
  candlesAgo: number;
};

/**
 * collectCrossCandidates — función pura: recibe un payload ya computado y
 * devuelve los cruces fresh ahora mismo. [] cuando no hay spot price
 * (no hay nada que registrar) o no hay señal fresh. Sin I/O.
 */
export function collectCrossCandidates(
  payload: AnalysisResponse,
): CrossCandidate[] {
  const out: CrossCandidate[] = [];
  const price = payload.spot_price;
  if (price == null || !Number.isFinite(price)) return out;

  const push = (
    type: CrossEventType,
    direction: CrossDirection,
    candlesAgo: number,
  ): void => {
    out.push({ symbol: payload.symbol, type, direction, price, candlesAgo });
  };

  const ema = payload.cross_info;
  if (ema?.happened && ema.direction) {
    push("ema", ema.direction, ema.candles_since_cross ?? 0);
  }

  const macd = payload.macd_cross;
  if (macd?.happened && macd.direction) {
    push("macd", macd.direction, macd.candles_since_cross ?? 0);
  }
  if (macd?.momentum_flip && macd.momentum_flip_direction) {
    push("momentum", macd.momentum_flip_direction, macd.candles_since_flip ?? 0);
  }

  const breakout = payload.squeeze_breakout;
  if (breakout?.happened && breakout.direction) {
    push("squeeze_breakout", breakout.direction, breakout.candles_since_breakout ?? 0);
  }

  if (payload.bollinger_squeeze?.is_squeezed) {
    push("squeeze", "neutral", 0);
  }

  const stoch = payload.stoch_cross;
  if (stoch?.happened && stoch.direction) {
    push("stoch_cross", stoch.direction, stoch.candles_since_cross ?? 0);
  }

  return out;
}

Nota: el `import type { AnalysisResponse } from "./types"` va al tope del archivo
(mismo bloque de imports; no después).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/lib/cross-history.test.ts`
Expected: PASS (7 tests nuevos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cross-history.ts src/lib/cross-history.test.ts
git commit -m "feat(cross-history): collectCrossCandidates pura — extrae cruces fresh del payload (TDD)"
```

---

### Task 2: Wire del fire-and-forget en `/api/analysis` (restaura la escritura)

**Files:**
- Modify: `src/app/api/analysis/route.ts` (import + hook en GET, tras `setCached`)

**Interfaces:**
- Consumes: `collectCrossCandidates(payload): CrossCandidate[]` (Task 1) y `recordCrossIfNew(input: CrossCandidate): Promise<void>` (existente, ya traga errores con `console.error`).

- [ ] **Step 1: Añadir el import** (junto a los de `@/lib/`):

```ts
import { collectCrossCandidates, recordCrossIfNew } from "@/lib/cross-history";
```

- [ ] **Step 2: Persistir tras `buildAnalysis`**: en `GET`, entre `setCached(...)` y el `return`:

```ts
    setCached(cacheKey, payload, CACHE_TTL_MS);

    // Restaura (el commit 0a2c7f8 del PR #4 la había quitado sin querer):
    // registra los cruces fresh en SQLite. Fire-and-forget: recordCrossIfNew
    // ya traga errores de DB, y nunca debe bloquear ni fallar la respuesta.
    for (const candidate of collectCrossCandidates(payload)) {
      void recordCrossIfNew(candidate);
    }

    return NextResponse.json(payload, {
      headers: { "x-cache": "MISS", "x-source": klinesRes.provider, "cache-control": "no-store" },
    });
```

- [ ] **Step 3: Run tests** (el route no tiene test propio aquí; regression-safety)

Run: `bun run test && bun run typecheck && bun run lint`
Expected: todo PASS (344 tests).

- [ ] **Step 4: Verificación end-to-end** (la escritura es asíncrona: confirma con el COUNT de la tabla; el exit code del curl no lo garantiza)

```bash
bun run db:push   # crea prisma/db/custom.db (DATABASE_URL file:./db/custom.db relativo a prisma/)
bun run dev &     # :3000
curl -s "http://localhost:3000/api/analysis?symbol=BTCUSDT&tf=4h" | head -c 80
sqlite3 prisma/db/custom.db "SELECT COUNT(*) FROM CrossEvent; SELECT MAX(detectedAt) FROM CrossEvent;"
```
Expected: COUNT crece solo si hay algún cruce fresh en el mercado ahora; lo **determinista** es que no aparezca `[cross-history] record error` en el log de dev y que MAX(detectedAt) sea de hoy **cuando sí haya** un candidato. Si durante la prueba no hay cruces fresh, repetir sobre un symbol con `cross_info.happened:true` observado en el browser.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/analysis/route.ts
git commit -m "fix(analysis): restaurar la persistencia fire-and-forget de cruces (regresión del PR #4)"
```

---

### Task 3: Header de CrossHistory sin falso vacío

**Files:**
- Modify: `src/components/panel/cross-history.tsx` (subheader cuando `totalAll===0`)

**Problema exacto:** con la db con meses de data, `getCrossStats(7)` da 0 y el fallback de texto hace parecer "sin datos". Mostrar el histórico real (los events ya vienen en el mismo fetch).

- [ ] **Step 1: Cambiar el subheader**: reemplazar el ternario por uno de 3 vía (sin anidar):

```tsx
// Header subheader — el fetch ya está disponible en el componente (allEvents existe):
const eventCount = allEvents.length;
const lastEvent = allEvents[0] ?? null; // allEvents está ordenado newest-first
const lastRelative = lastEvent ? fmtRelative(lastEvent.detectedAt) : null;
```

Render en el `<p className="mt-0.5 ...">` (reemplazar el ternario actual):

```tsx
<p className="mt-0.5 text-[11px] text-muted-foreground">
  {totalAll > 0
    ? `${totalAll} ${t("crossHistory.recent")} · ${events.length} ${t("crossHistory.recents")}`
    : eventCount > 0
      ? `${eventCount} históricos · ${t("crossHistory.lastEvent").replace("{when}", lastRelative)}`
      : "EMA · MACD · momentum flips persistidos en SQLite"}
</p>
```

Necesita un key nuevo en i18n → añadir en `src/lib/i18n.ts` `"crossHistory.lastEvent": "último: {when}"` en los 4 idiomas (es `último: {when}`, en `last: {when}`, más zh/fr). El componente debe hacer `t("crossHistory.lastEvent").replace("{when}", lastRelative)`. Nota: `fmtRelative(iso)` ya existe en el componente (es la misma que formatea cada fila del timeline, `hace Xd/Xh/min`) — reutilizarla, no duplicar el helper.

- [ ] **Step 2: Run tests + guardas i18n existentes**

Run: `bun run test -- src/lib/i18n-usage.test.ts src/lib/i18n-hardcoded.test.ts src/lib/i18n.test.ts && bun run lint && bun run typecheck`
Expected: PASS — los test guards atrapan falta de paridad/claves.

- [ ] **Step 3: Verificación manual en browser**

`bun run dev` → dashboard → expandir la sección "Historial de cruces": con db histórica debe mostrar `30 históricos · último: hace 41d` (30, no 120: el fetch trae limit=30), y las alertas de `useCrossAlerts` no deben romperse.

- [ ] **Step 4: Commit**

```bash
git add src/components/panel/cross-history.tsx src/lib/i18n.ts
git commit -m "fix(ui): el historial de cruces no parece vacío cuando la data es >7d"
```

---

### Task 4: Verificación final de la rama

- [ ] **Step 1:** `bun run lint && bun run typecheck && bun run test` → verde (344).
- [ ] **Step 2:** ejecutar el stack completo de Docker Compose: `docker compose up -d --build`, abrir :81, esperar 2-3 minutos y correr:
```bash
docker exec panel_app sqlite3 /app/db/custom.db "SELECT COUNT(*) FROM CrossEvent;"
```
Esperado: COUNT > 120 cuando haya un cruce fresh. Si durante la prueba no hay cruces fresh en el mercado, revisar MAX(detectedAt) solo cuando aparezca uno (debe ser posterior al deploy).
- [ ] **Step 3: Commit final / PR**: `git push` y PR "fix(cross-history): restaurar escritura + UI sin falso vacío".

---

## Out of scope

- **timeframe en el dedup** (tarea futura): requiere migración Prisma (`db push`) y afecta al schema, así que va en su propio PR después de aterrizar Tasks 1-3.
- Backfill de los cruces perdidos desde el 10 de septiembre (los klines históricos existen vía provider, pero reconstruir 41 días de cruces es otro proyecto).
- Purga/retención de la tabla CrossEvent (la tabla crece ~120 filas en ~6 semanas; no urgente).
- El bot (PR #35): mantener el alcance en el dashboard/API.

## Riesgos

- Re-introducción del side effect en el GET de `/api/analysis`: se mitiga con `void` y la garantía de swallowing de `recordCrossIfNew`; no puede romper la respuesta. Anclaje exacto: el hook va justo después de `setCached` y antes del `return`.
- El dedup de 6h existente evita duplicados por el polling cada 60s de las 4 cards (una por timeframe). Al no existir columna `timeframe`, el primer cross que se registre (vía el timeframe que dijo primero) esconderá los cruces equivalentes de los demás timeframes hasta 6h (es la tarea futura mencionada en Out of scope).
- i18n: la guard `src/lib/i18n-usage.test.ts` fallará si el nuevo key no existe en los 4 idiomas; añadir en Task 3 el par en es/en/zh/fr.
