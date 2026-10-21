# UI dedicada de Backtesting — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página server-driven `/backtest` (3 tabs: Corrida, Comparación, Historial) con persistencia de corridas y presets en SQLite, comparación de N estrategias por request, reusando el motor existente — sin descartar el modal actual.

**Architecture:** El motor `src/lib/backtest.ts` (puro, probado) se reusa tal cual; se le agrega la inyección opcional de klines pre-cargadas para que `POST /api/backtest/compare` descargue la historia **una vez** por (símbolo, intervalo, velas) y la comparta entre las N estrategias. Helpers puros nuevos en `src/lib/` con TDD; las rutas nuevas son thin (validación + helper + respuesta). La UI extrae el equity curve canvas y la tabla de trades del modal a componentes compartidos, y agrega `src/app/backtest/page.tsx` con 3 tabs.

**Tech Stack:** Next.js 16 App Router (routes `runtime=nodejs`), Prisma + SQLite (`db push`), Vitest, Tailwind 4, Canvas API (sin librerías de charts).

**Spec:** `docs/superpowers/specs/2026-10-21-backtest-ui-dedicated-design.md`

## Global Constraints

- TypeScript strict — no `any`, no `@ts-ignore`. Imports con alias `@/` para `src/lib/`, `src/hooks/`, `src/components/`; relativo (`./`) solo dentro de `src/components/panel/`.
- Rutas API: `export const runtime = "nodejs"` y `export const dynamic = "force-dynamic"`.
- Funciones nuevas en `src/lib/` puras (sin I/O) y con **tests ANTES que la implementación**. Tests en `src/lib/*.test.ts` — **nunca** en `src/app/`.
- Baseline: **344 tests** pasando; nunca reducir el conteo. Checks de ronda: `bun run lint` (0/0), `bun run typecheck` (limpio), `bun run test` (344+ verde).
- Prohibido `bun run build` — dev server / docker compose solamente.
- Ninguna cadena visible hardcodeada — `t()` de `useLanguage()`; keys nuevas bajo `backtestUI.*` en los **4 idiomas** (es/en/zh/fr). Reusar keys existentes de `backtest.*` cuando ya existan (verificar con grep en `src/lib/i18n.ts` antes de agregar).
- Contrato de errores API: `{ error: "message" }` con 400 (validación) / 502 (upstream Binance) / 200+`error` inline donde el modal ya lo hace — **nunca datos fabricados**.
- Límites del spec: compare ≤ 10 estrategias; `limit` velas entre 50 y 1000; `resultJson` cap 1 MB con truncado de trades determinístico; presets ≤ 20 con name ≤ 80 chars.
- Las klines del compare se piden **una vez** con cache de 60s (Map en `src/lib/cache.ts`): clave `backtest:klines:<symbol>:<interval>:<limit>`.
- Commits: Conventional Commits; uno por task. Nunca commitear `node_modules/`, `dev.log`, `*.png`, `db/custom.db`, `.next/`, `tool-results/`.
- Rama y arranque: trabajar en `feat/backtest-ui` (ya creada sobre `main` post-merge de PR #41).

---

### Task 1: Modelos Prisma (BacktestRun + BacktestPreset)

**Files:**
- Modify: `prisma/schema.prisma` (append al final del archivo)
- Create: nada más

**Interfaces:**
- Consumes: nada (schema nuevo).
- Produces: modelos `backtestRun` / `backtestPreset` en el client Prisma (`db.backtestRun.create/findMany/...`) que Task 7 consume. Postgres-style `Prisma` types no aplican: SQLite.

- [ ] **Step 1: Agregar los modelos al schema**

Al final de `prisma/schema.prisma` agregar:

```prisma
/// One persisted backtest run — config + full engine result. Rows are
/// created by POST /api/backtest/runs and listed by GET /api/backtest/runs
/// (summary columns only; resultJson is only served by GET /runs/:id).
model BacktestRun {
  id           String   @id @default(cuid())
  createdAt    DateTime @default(now())
  /// Uppercase USDT pair, e.g. "BTCUSDT".
  symbol       String
  /// "15m" | "1h" | "4h" | "1d".
  interval     String
  candles      Int
  /// Predefined strategy id, or null when the run used a custom strategy.
  strategyId   String?
  strategyName String
  isCustom     Boolean
  /// JSON: { minConfidence, initialCapital, stopLossPct, takeProfitPct,
  /// maxHoldCandles, positionSizing, fixedFractionalPct, feeBps }.
  config       String
  /// Denormalized summary columns — GET /runs lists without resultJson.
  totalTrades    Int
  winRatePct     Float
  totalReturnPct Float
  maxDrawdownPct Float
  profitFactor   Float
  /// Serialized BacktestResult (trades + equityCurve + stats), capped at
  /// 1 MB by src/lib/backtest-db.ts (deterministic trade truncation).
  resultJson   String

  @@index([createdAt(sort: Desc)])
  @@index([symbol, interval])
  @@index([strategyId])
}

/// Saved backtest configuration preset — reused with one click from the
/// dedicated /backtest page (apply / save / delete).
model BacktestPreset {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  name      String   @unique
  /// JSON: same shape as BacktestRun.config plus symbol/interval/limit.
  config    String
}
```

- [ ] **Step 2: Push del schema y regeneración del client**

```bash
bun run db:push
bun run db:generate
```

Expected: `Your database is now in sync with your schema` (ambos comandos exit 0). Si `db:push` pide confirmación por data loss, **detener y reportar** — el schema nuevo es additivo, perder datos sería un síntoma de que se tocó un modelo existente.

- [ ] **Step 3: Verificación de compilación**

```bash
bun run typecheck
```

Expected: exit 0 (el client Prisma expone `db.backtestRun.*`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(backtest-ui): modelos Prisma BacktestRun y BacktestPreset"
```

---

### Task 2: Helpers puros de persistencia (`src/lib/backtest-db.ts`) — TDD

**Files:**
- Create: `src/lib/backtest-db.ts`
- Test: `src/lib/backtest-db.test.ts`

**Interfaces:**
- Consumes: `BacktestResult` y `BacktestStats` de `src/lib/backtest.ts` (type-only import).
- Produces (Task 6/7 y Tasks 10–12 dependen de estas firmas EXACTAS):

```ts
export const RESULT_JSON_CAP_BYTES = 1_048_576;

export type RunSummary = {
  totalTrades: number;
  winRatePct: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
};

/** Extrae los 5 índices desnormalizados de un BacktestResult.stats.
 *  NaN/Infinity → 0 (SQLite no admite NaN y la lista no debe tener huecos). */
export function summarizeResult(stats: BacktestStats): RunSummary;

/** Serializa un BacktestResult completo aplicando el cap de 1 MB con
 *  truncado determinístico de trades (reduce a la mitad el KEEP hasta
 *  caber; nunca muta stats). Marca la truncación con `_truncation`. */
export function truncateResultJson(
  result: BacktestResult,
  cap: number = RESULT_JSON_CAP_BYTES,
): { json: string; truncated: boolean; keptTrades: number };

/** combina summarizeResult + truncateResultJson para la fila a insertar */
export function serializeRun(
  summary: RunSummary,
  result: BacktestResult,
): { summary: RunSummary; resultJson: string; truncated: boolean; keptTrades: number };

/** Parse defensivo de una fila cruda de la BD (JSON.parse puede fallar). */
export function parseStoredResult(resultJson: string): ParsedStoredResult;

export type ParsedStoredResult =
  | { ok: true; result: BacktestResult; truncatedMeta: { originalTrades: number; keptTrades: number } | null }
  | { ok: false; reason: string };
```

- [ ] **Step 1: Escribir los tests (fallan — el módulo no existe)**

Crear `src/lib/backtest-db.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { BacktestResult } from "@/lib/backtest";
import {
  RESULT_JSON_CAP_BYTES,
  parseStoredResult,
  serializeRun,
  summarizeResult,
  truncateResultJson,
} from "@/lib/backtest-db";

/** BacktestResult mínimo pero bien formado (solo lo que usan los helpers). */
function makeResult(opts?: {
  trades?: number;
  winRate?: number;
  totalReturnPct?: number;
  maxDrawdownPct?: number;
  profitFactor?: number;
}): BacktestResult {
  const n = opts?.trades ?? 3;
  return {
    symbol: "BTCUSDT",
    interval: "4h",
    candlesAnalyzed: 500,
    provider: "binance",
    trades: Array.from({ length: n }, (_, i) => ({
      entryIndex: i * 10,
      exitIndex: i * 10 + 5,
      entryPrice: 100 + i,
      exitPrice: 105 + i,
      entryTime: 1_700_000_000_000 + i * 10_000,
      exitTime: 1_700_005_000_000 + i * 10_000,
      pnl: 50,
      pnlPct: 5,
      holdCandles: 5,
      exitReason: "take_profit",
      action: "BUY",
      positionSizePct: 100,
      feesPaid: 2,
    })),
    equityCurve: [],
    stats: {
      totalTrades: n,
      wins: n,
      losses: 0,
      winRate: opts?.winRate ?? 100,
      totalReturnPct: opts?.totalReturnPct ?? 15,
      maxDrawdownPct: opts?.maxDrawdownPct ?? 3,
      profitFactor: opts?.profitFactor ?? 2,
      avgHoldCandles: 5,
      bestTradePct: 5,
      worstTradePct: 5,
      finalEquity: 11_500,
      totalFees: 6,
      avgPositionSizePct: 100,
      sharpeRatio: NaN,
      sortinoRatio: NaN,
      calmarRatio: NaN,
      maxWinStreak: n,
      maxLossStreak: 0,
      avgWinPct: 5,
      avgLossPct: 0,
      expectancyPct: 5,
    },
    durationBuckets: [],
    strategy: { id: "trend_buy", name: "Trend Buy", action: "BUY" },
    params: {
      minConfidence: 60,
      initialCapital: 10_000,
      stopLossPct: 5,
      takeProfitPct: 10,
      maxHoldCandles: 50,
      positionSizing: "full",
      fixedFractionalPct: 25,
      feeBps: 10,
    },
  };
}

describe("summarizeResult", () => {
  it("proyecta los 5 índices del stats", () => {
    expect(summarizeResult(makeResult().stats)).toEqual({
      totalTrades: 3,
      winRatePct: 100,
      totalReturnPct: 15,
      maxDrawdownPct: 3,
      profitFactor: 2,
    });
  });

  it("reemplaza NaN e Infinity por 0 (SQLite no admite no-finitos)", () => {
    const s = summarizeResult({
      ...makeResult().stats,
      winRate: NaN,
      profitFactor: Infinity,
    });
    expect(s.winRatePct).toBe(0);
    expect(s.profitFactor).toBe(0);
    expect(Number.isFinite(s.maxDrawdownPct)).toBe(true);
    expect(Number.isFinite(s.totalReturnPct)).toBe(true);
  });
});

describe("truncateResultJson", () => {
  it("no trunca un payload bajo el cap", () => {
    const out = truncateResultJson(makeResult({ trades: 3 }));
    expect(out.truncated).toBe(false);
    expect(out.keptTrades).toBe(3);
    expect(out.json.length).toBeLessThan(RESULT_JSON_CAP_BYTES);
    expect(JSON.parse(out.json).stats.totalTrades).toBe(3);
  });

  it("trunca trades de forma determinística hasta caber en el cap", () => {
    const result = makeResult({ trades: 200 });
    const out = truncateResultJson(result, 2_000);
    expect(out.truncated).toBe(true);
    expect(out.keptTrades).toBeLessThan(200);
    const parsed = JSON.parse(out.json);
    expect(parsed.trades.length).toBe(out.keptTrades);
    // NUNCA fabrica datos: los stats conservan el conteo original y la
    // metadata de truncación explica la diferencia.
    expect(parsed.stats.totalTrades).toBe(200);
    expect(parsed._truncation).toEqual({
      originalTrades: 200,
      keptTrades: out.keptTrades,
    });
  });

  it("determinismo: mismo input produce el mismo kept", () => {
    const a = truncateResultJson(makeResult({ trades: 200 }), 2_000);
    const b = truncateResultJson(makeResult({ trades: 200 }), 2_000);
    expect(b.keptTrades).toBe(a.keptTrades);
    expect(b.json).toBe(a.json);
  });

  it("cap absurdamente chico: cae a trades=[] sin lanzar", () => {
    const out = truncateResultJson(makeResult({ trades: 50 }), 10);
    expect(out.truncated).toBe(true);
    expect(out.keptTrades).toBe(0);
  });
});

describe("serializeRun", () => {
  it("combina summary + truncado", () => {
    const summary = summarizeResult(makeResult().stats);
    const out = serializeRun(summary, makeResult({ trades: 3 }));
    expect(out.summary).toEqual(summary);
    expect(out.truncated).toBe(false);
    expect(out.keptTrades).toBe(3);
    expect(() => JSON.parse(out.resultJson)).not.toThrow();
  });
});

describe("parseStoredResult", () => {
  it("round-trip: serialize → parse devuelve el resultado intacto", () => {
    const out = parseStoredResult(truncateResultJson(makeResult({ trades: 3 })).json);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.stats.totalTrades).toBe(3);
      expect(out.truncatedMeta).toBeNull();
    }
  });

  it("recupera la metadata de truncación si existe", () => {
    const json = truncateResultJson(makeResult({ trades: 200 }), 2_000).json;
    const out = parseStoredResult(json);
    expect(out.ok).toBe(true);
    if (out.ok && out.truncatedMeta) {
      expect(out.truncatedMeta.originalTrades).toBe(200);
      expect(out.truncatedMeta.keptTrades).toBe(out.result.trades.length);
    }
  });

  it("JSON inválido → ok:false con razón", () => {
    const out = parseStoredResult("{not json");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("JSON");
  });

  it("JSON válido pero sin forma de BacktestResult → ok:false", () => {
    const out = parseStoredResult(JSON.stringify({ hello: 1 }));
    expect(out.ok).toBe(false);
  });

  it("campos numéricos no-finitos en el stats del payload → ok:false", () => {
    const r = JSON.parse(truncateResultJson(makeResult({ trades: 1 }), 50_000).json);
    r.stats.winRate = "nota-numérica";
    const out = parseStoredResult(JSON.stringify(r));
    expect(out.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Correr los tests — confirmar RED**

```bash
bun run test src/lib/backtest-db.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Failed to resolve import "@/lib/backtest-db"` (el módulo no existe).

- [ ] **Step 3: Implementación mínima**

Crear `src/lib/backtest-db.ts`:

```typescript
/**
 * backtest-db.ts — pure serialization/parsing helpers for the persisted
 *  backtest runs (BacktestRun rows). NO I/O — the routes in
 *  src/app/api/backtest/runs call these and own the Prisma client.
 *
 * Invariant: never fabricate data. When the serialized result exceeds the
 * 1 MB cap, the trade list is truncated deterministically and the run's
 * stats keep the ORIGINAL values; the payload carries `_truncation` so the
 * UI can surface "showing K of N closed trades" instead of lying.
 */

import type { BacktestResult, BacktestStats } from "@/lib/backtest";

export const RESULT_JSON_CAP_BYTES = 1_048_576;

export type RunSummary = {
  totalTrades: number;
  winRatePct: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
};

function finiteOrZero(v: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function summarizeResult(stats: BacktestStats): RunSummary {
  return {
    totalTrades: Math.max(0, Math.floor(finiteOrZero(stats.totalTrades))),
    winRatePct: finiteOrZero(stats.winRate),
    totalReturnPct: finiteOrZero(stats.totalReturnPct),
    maxDrawdownPct: finiteOrZero(stats.maxDrawdownPct),
    profitFactor: finiteOrZero(stats.profitFactor),
  };
}

export type TruncationMeta = { originalTrades: number; keptTrades: number };

export function truncateResultJson(
  result: BacktestResult,
  cap: number = RESULT_JSON_CAP_BYTES,
): { json: string; truncated: boolean; keptTrades: number } {
  const originalTrades = result.trades.length;

  const serialize = (kept: number): string =>
    JSON.stringify({
      ...result,
      trades: result.trades.slice(0, kept),
      ...(kept < originalTrades
        ? { _truncation: { originalTrades, keptTrades: kept } }
        : {}),
    });

  // Fast path: under cap with all trades.
  let kept = originalTrades;
  let json = serialize(kept);
  if (Buffer.byteLength(json, "utf8") <= cap) {
    return { json, truncated: false, keptTrades: originalTrades };
  }

  // Deterministic shaving: halve the kept prefix until it fits (or empty).
  while (kept > 0 && Buffer.byteLength(json, "utf8") > cap) {
    kept = Math.floor(kept / 2);
    json = serialize(kept);
  }

  return { json, truncated: kept < originalTrades, keptTrades: kept };
}

export function serializeRun(
  summary: RunSummary,
  result: BacktestResult,
): { summary: RunSummary; resultJson: string; truncated: boolean; keptTrades: number } {
  const t = truncateResultJson(result);
  return {
    summary: { ...summary },
    resultJson: t.json,
    truncated: t.truncated,
    keptTrades: t.keptTrades,
  };
}

export type ParsedStoredResult =
  | {
      ok: true;
      result: BacktestResult;
      truncatedMeta: TruncationMeta | null;
    }
  | { ok: false; reason: string };

/** Estructura mínima que debe tener el payload guardado para considerarse
 *  un BacktestResult (los helpers nunca aceptan basura silenciosamente). */
function looksLikeResult(v: unknown): v is BacktestResult {
  if (v == null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.symbol === "string" &&
    typeof r.interval === "string" &&
    Array.isArray(r.trades) &&
    Array.isArray(r.equityCurve) &&
    r.stats != null &&
    typeof r.stats === "object"
  );
}

function statsHasOnlyFiniteNumbers(v: unknown): boolean {
  if (v == null || typeof v !== "object") return false;
  return Object.values(v as Record<string, unknown>).every(
    (x) => typeof x === "number" && Number.isFinite(x),
  );
}

export function parseStoredResult(resultJson: string): ParsedStoredResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return { ok: false, reason: "Stored payload is not valid JSON." };
  }
  if (!looksLikeResult(parsed)) {
    return { ok: false, reason: "Stored payload is not a BacktestResult." };
  }
  if (!statsHasOnlyFiniteNumbers((parsed as BacktestResult).stats)) {
    return { ok: false, reason: "Stored stats contain non-finite values." };
  }
  const meta = (parsed as { _truncation?: TruncationMeta })._truncation ?? null;
  return { ok: true, result: parsed as BacktestResult, truncatedMeta: meta };
}
```

- [ ] **Step 4: Correr los tests — confirmar GREEN**

```bash
bun run test src/lib/backtest-db.test.ts 2>&1 | tail -3
```

Expected: PASS (todos los `it` del archivo en verde).

- [ ] **Step 5: Suite completa + lint + typecheck**

```bash
bun run test 2>&1 | tail -3; bun run lint; bun run typecheck
```

Expected: 344 + ~14 nuevos = verde; lint 0/0; exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backtest-db.ts src/lib/backtest-db.test.ts
git commit -m "feat(backtest-ui): helpers puros de persistencia con cap de 1MB (TDD)"
```

---

### Task 3: Comparación de estrategias (`src/lib/backtest-compare.ts`) — TDD

**Files:**
- Create: `src/lib/backtest-compare.ts`
- Test: `src/lib/backtest-compare.test.ts`

**Interfaces:**
- Consumes: `BacktestResult` de `src/lib/backtest.ts`; `RunSummary` de `src/lib/backtest-db.ts` (Task 2 — usar `summarizeResult`).
- Produces (Task 6 y Task 11 dependen EXACTAMENTE de esto):

```ts
export type CompareEntry = {
  strategyId: string;
  strategyName: string;
  action: string;
  isCustom: boolean;
  /** Error a nivel de estrategia (resolución inválida, fallo de Binance,
   *  insuficiente data). null = la corrida salió. */
  error: string | null;
  /** BacktestResult cuando error === null. */
  result: BacktestResult | null;
};

export type ComparisonRow = {
  strategyId: string;
  strategyName: string;
  action: string;
  isCustom: boolean;
  error: string | null;
  /** null cuando la corrida falló (el UI renderiza el error en su lugar). */
  summary: RunSummary | null;
  /** true en la/s fila/s mejor/es de cada métrica (solo entre filas con
   *  summary; drawdown MÍNIMO gana; empates marcan a todos). */
  best: { winRate: boolean; totalReturn: boolean; maxDrawdown: boolean; profitFactor: boolean };
};

export function buildComparisonRows(entries: CompareEntry[]): ComparisonRow[];
```

- [ ] **Step 1: Escribir los tests (fallan)**

Crear `src/lib/backtest-compare.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { BacktestResult } from "@/lib/backtest";
import { buildComparisonRows, type CompareEntry } from "@/lib/backtest-compare";
import { summarizeResult } from "@/lib/backtest-db";

function makeResult(id: string, stats: Partial<BacktestResult["stats"]>): BacktestResult {
  const s = {
    totalTrades: 10,
    wins: 6,
    losses: 4,
    winRate: 60,
    totalReturnPct: 12,
    maxDrawdownPct: 4,
    profitFactor: 1.5,
    avgHoldCandles: 5,
    bestTradePct: 5,
    worstTradePct: -5,
    finalEquity: 11_200,
    totalFees: 20,
    avgPositionSizePct: 100,
    sharpeRatio: NaN,
    sortinoRatio: NaN,
    calmarRatio: NaN,
    maxWinStreak: 3,
    maxLossStreak: 2,
    avgWinPct: 4,
    avgLossPct: -2,
    expectancyPct: 2,
    ...stats,
  };
  return {
    symbol: "BTCUSDT",
    interval: "4h",
    candlesAnalyzed: 500,
    provider: "binance",
    trades: [],
    equityCurve: [],
    stats: s,
    durationBuckets: [],
    strategy: { id, name: id, action: "BUY" },
    params: {
      minConfidence: 60, initialCapital: 10_000, stopLossPct: 5,
      takeProfitPct: 10, maxHoldCandles: 50, positionSizing: "full",
      fixedFractionalPct: 25, feeBps: 10,
    },
  } as unknown as BacktestResult;
}

function entry(
  strategyId: string,
  over: Partial<CompareEntry> & { stats?: Partial<BacktestResult["stats"]> } = {},
): CompareEntry {
  const { stats, ...rest } = over;
  return {
    strategyId,
    strategyName: strategyId,
    action: "BUY",
    isCustom: false,
    error: null,
    result: stats ? makeResult(strategyId, stats) : null,
    ...rest,
  };
}

describe("buildComparisonRows", () => {
  it("lista vacía → [] y no lanza", () => {
    expect(buildComparisonRows([])).toEqual([]);
  });

  it("entrada con error → fila con summary null y sin best", () => {
    const rows = buildComparisonRows([entry("bad", { error: "upstream 502" })]);
    expect(rows[0]).toMatchObject({
      strategyId: "bad", error: "upstream 502",
      summary: null,
      best: { winRate: false, totalReturn: false, maxDrawdown: false, profitFactor: false },
    });
  });

  it("un solo elemento válido → es best en las 4 métricas", () => {
    const rows = buildComparisonRows([entry("solo", { stats: { winRate: 50 } })]);
    expect(rows[0].summary).toEqual(summarizeResult(makeResult("solo", {}).stats));
    expect(rows[0].best).toEqual({
      winRate: true, totalReturn: true, maxDrawdown: true, profitFactor: true,
    });
  });

  it("mejores por columna: winRate/retorno/FP máx, drawdown MÍNIMO", () => {
    const rows = buildComparisonRows([
      entry("a", { stats: { winRate: 60, totalReturnPct: 12, maxDrawdownPct: 4, profitFactor: 1.5 } }),
      entry("b", { stats: { winRate: 80, totalReturnPct: 12, maxDrawdownPct: 8, profitFactor: 2.0 } }),
      entry("c", { stats: { winRate: 40, totalReturnPct: 40, maxDrawdownPct: 2, profitFactor: 0.5 } }),
    ]);
    expect(rows[0].best).toEqual({ winRate: false, totalReturn: false, maxDrawdown: false, profitFactor: false });
    expect(rows[1].best).toEqual({ winRate: true, totalReturn: false, maxDrawdown: false, profitFactor: true });
    expect(rows[2].best).toEqual({ winRate: false, totalReturn: true, maxDrawdown: true, profitFactor: false });
  });

  it("empate absoluto → todos los empatados llevan best", () => {
    const rows = buildComparisonRows([
      entry("a", { stats: { winRate: 50 } }),
      entry("b", { stats: { winRate: 50 } }),
    ]);
    expect(rows[0].best.winRate).toBe(true);
    expect(rows[1].best.winRate).toBe(true);
  });

  it("filas con error quedan fuera de la competencia de best", () => {
    const rows = buildComparisonRows([
      entry("ok", { stats: { winRate: 30 } }),
      entry("ko", { error: "boom", result: null }),
    ]);
    expect(rows[0].best.winRate).toBe(true);
    expect(rows[1].best.winRate).toBe(false);
  });

  it("respeta isCustom y las 10 entradas", () => {
    const many: CompareEntry[] = Array.from({ length: 10 }, (_, i) =>
      entry(`s${i}`, { isCustom: true, stats: { winRate: i } }),
    );
    const rows = buildComparisonRows(many);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.isCustom)).toBe(true);
  });
});
```

- [ ] **Step 2: Correr los tests — confirmar RED**

```bash
bun run test src/lib/backtest-compare.test.ts 2>&1 | tail -3
```

Expected: FAIL — `Failed to resolve import "@/lib/backtest-compare"`.

- [ ] **Step 3: Implementación mínima**

Crear `src/lib/backtest-compare.ts`:

```typescript
/**
 * backtest-compare.ts — pure builder for the strategy-comparison table of
 * the dedicated /backtest page. Input: what POST /api/backtest/compare
 * produced per strategy. NO I/O — rendering lives in the UI.
 */

import type { BacktestResult } from "@/lib/backtest";
import { summarizeResult, type RunSummary } from "@/lib/backtest-db";

export type CompareEntry = {
  strategyId: string;
  strategyName: string;
  action: string;
  isCustom: boolean;
  error: string | null;
  result: BacktestResult | null;
};

export type ComparisonRow = {
  strategyId: string;
  strategyName: string;
  action: string;
  isCustom: boolean;
  error: string | null;
  summary: RunSummary | null;
  best: { winRate: boolean; totalReturn: boolean; maxDrawdown: boolean; profitFactor: boolean };
};

const NO_BEST = { winRate: false, totalReturn: false, maxDrawdown: false, profitFactor: false };

export function buildComparisonRows(entries: CompareEntry[]): ComparisonRow[] {
  const rows: ComparisonRow[] = entries.map((e) => ({
    strategyId: e.strategyId,
    strategyName: e.strategyName,
    action: e.action,
    isCustom: e.isCustom,
    error: e.error,
    summary: e.error == null && e.result ? summarizeResult(e.result.stats) : null,
    best: { ...NO_BEST },
  }));

  // Competencia de best solo entre filas con summary (una corrida fallida
  // no roba el "mejor" a las que corrieron).
  const scored = rows.filter((r): r is ComparisonRow & { summary: RunSummary } =>
    r.summary !== null && r.summary.totalTrades > 0,
  );
  if (scored.length > 0) {
    // Las keys de RunSummary y de best coinciden por nombre, así que el
    // index assignment es seguro (winRate/totalReturn/maxDrawdown/profitFactor).
    const bestBy = (key: keyof RunSummary, dir: "max" | "min") => {
      const values = scored.map((r) => r.summary[key]);
      const target = dir === "max" ? Math.max(...values) : Math.min(...values);
      for (const r of scored) r.best[key] = r.summary[key] === target;
    };
    bestBy("winRate", "max");
    bestBy("totalReturn", "max");
    bestBy("maxDrawdown", "min");
    bestBy("profitFactor", "max");
  }

  return rows;
}
```

- [ ] **Step 4: Correr los tests — confirmar GREEN**

```bash
bun run test src/lib/backtest-compare.test.ts 2>&1 | tail -3
```

Expected: PASS. Si `totalTrades: 10` en todos los makeResult hace que la fila `ko` con summary null no "compita" — verificar que `best.winRate` de `ok` es `true` (el test lo cubre).

- [ ] **Step 5: Suite + lint + typecheck + Commit**

```bash
bun run test 2>&1 | tail -3 && bun run lint && bun run typecheck
git add src/lib/backtest-compare.ts src/lib/backtest-compare.test.ts
git commit -m "feat(backtest-ui): builder puro de tabla de comparación (TDD)"
```

---

### Task 4: Inyección de klines pre-cargadas en `runBacktest` — TDD

**Files:**
- Modify: `src/lib/backtest.ts` (además de las líneas 54–79 `BacktestParams` y función `runBacktest` líneas 703–786; el bloque de fetch está en líneas 723–741)
- Modify: `src/lib/backtest.ts` — nuevo export `fetchKlinesCached` (después de `runMultiSymbolBacktest`, línea ~1010)
- Test: `src/lib/backtest.test.ts` (append de `describe` nuevos al archivo EXISTENTE)

**Interfaces:**
- Consumes: `Kline` (`{ openTime, open, high, low, close, volume, closeTime, quoteVolume, ... }` — ver `src/lib/providers/types.ts:18`) y `providerRouter` ya importados en `backtest.ts`; `getCached`/`setCached` de `@/lib/cache`.
- Produces (Task 6 consume EXACTAMENTE):
  - `BacktestParams` gana 2 campos opcionales: `preloadedKlines?: Kline[]`, `preloadedProvider?: ProviderId`.
  - `fetchKlinesCached(symbol: string, interval: BacktestInterval, limit: number): Promise<{ klines: Kline[]; provider: ProviderId }>` — con cache TTL 60s (`backtest:klines:<symbol>:<interval>:<limit>`).

- [ ] **Step 1: Escribir los tests que FALLAN primero**

Append al final de `src/lib/backtest.test.ts`:

```typescript
describe("runBacktest con preloadedKlines", () => {
  /** 260 velas elicadas (suficiente para warmup ≥220): flat en precio. */
  function makeKlines(n: number): Kline[] {
    return Array.from({ length: n }, (_, i) => ({
      openTime: 1_700_000_000_000 + i * 3_600_000,
      open: 100, high: 101, low: 99, close: 100,
      volume: 1_000, closeTime: 1_700_000_000_000 + i * 3_600_000 + 3_599_999,
      quoteVolume: 100_000,
    }));
  }

  it("usa las klines pre-cargadas SIN pegarle al provider (warmup suficiente)", async () => {
    const klines = makeKlines(260);
    const result = await runBacktest({
      symbol: "BTCUSDT", interval: "4h", limit: 260,
      strategy: STRATEGY_LIST.find((s) => s.id === "hold")!,
      action: "HOLD",
      preloadedKlines: klines, preloadedProvider: "binance",
    });
    expect(result.error).toBeUndefined();
    expect(result.candlesAnalyzed).toBe(260);
  });

  it("error inline (sin fetch) si las pre-cargadas son insuficientes", async () => {
    const result = await runBacktest({
      symbol: "BTCUSDT", interval: "4h", limit: 10,
      strategy: STRATEGY_LIST.find((s) => s.id === "hold")!,
      action: "HOLD",
      preloadedKlines: makeKlines(10),
    });
    expect(result.error).toContain("Insufficient historical data");
  });

  it("error inline (sin fetch) si no hay pre-cargadas ni red (klines=[])", async () => {
    const result = await runBacktest({
      symbol: "BTCUSDT", interval: "4h", limit: 500,
      strategy: STRATEGY_LIST.find((s) => s.id === "hold")!,
      action: "HOLD",
      preloadedKlines: [],
      preloadedProvider: "binance",
    });
    expect(result.error).toContain("Insufficient historical data");
  });
});
```

Los imports de arriba (`Kline`) ya existen (o se agregan al header de `backtest.test.ts` según necesite el archivo — revisar el header actual antes de doble-importar). `STRATEGY_LIST` ya se importa o importar de `@/lib/strategies`.

- [ ] **Step 2: Correr los tests — confirmar RED**

```bash
bun run test src/lib/backtest.test.ts 2>&1 | tail -5
```

Expected: FAIL — Object literal `preloadedKlines` no existe en `BacktestParams` (TS excess-property → `type check error` o comportamiento con fetch real: **si el test golpea la red, es el RED correcto** — interrumpir aquí y seguir calculando la implementación en el Step 3).

- [ ] **Step 3: Implementación — `BacktestParams` + fetch bloque**

En `src/lib/backtest.ts`, dentro de `export type BacktestParams` (línea ~76, después de `feeBps`) agregar:

```typescript
  /** Preloaded klines — when provided the engine SKIPS the provider fetch
   *  (used by POST /api/backtest/compare to share ONE upstream fetch across
   *  all N strategy runs). Same warmup rules apply (≥220 candles). */
  preloadedKlines?: Kline[];
  /** Provider the preloaded klines came from (for the result metadata). */
  preloadedProvider?: ProviderId;
```

Y en `runBacktest` (bloque actual líneas 723–741) reemplazar el `try { const res = await providerRouter.getKlines(...) } catch {...}` por:

```typescript
  let provider: ProviderId = params.preloadedProvider ?? "binance";
  let klines: Kline[] = params.preloadedKlines ?? [];
  if (!params.preloadedKlines) {
    try {
      const res = await providerRouter.getKlines(symbol, interval, safeLimit);
      klines = res.klines;
      provider = res.provider;
    } catch {
      return {
        symbol,
        interval,
        candlesAnalyzed: 0,
        provider,
        trades: [],
        equityCurve: [],
        stats: emptyStats(initialCapital),
        durationBuckets: [],
        strategy: { id: strategy.id, name: strategy.name, action },
        params: { minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles, positionSizing, fixedFractionalPct, feeBps },
        error: "Failed to fetch historical klines from upstream provider.",
      };
    }
  }
```

El resto del cuerpo queda EXACTAMENTE igual (el chequeo `klines.length < 220` ya produce el error de data insuficiente sin pegarle a la red).

- [ ] **Step 4: Implementación — `fetchKlinesCached`**

En `src/lib/backtest.ts` (encima del import block, volver24 firma) agregar los imports necesarios:

```typescript
import { getCached, setCached } from "@/lib/cache";
```

y al final del archivo exportar:

```typescript
/**
 * Klines para corridas de backtest EN SERVIDOR con una cache TTL de 60s.
 * POST /api/backtest/compare la llama UNA VEZ antes de correr N estrategias,
 * así N corridas comparten la misma respuesta de upstream (regla del spec:
 * N estrategias NO significan N descargas).
 */
export async function fetchKlinesCached(
  symbol: string,
  interval: BacktestInterval,
  limit: number,
): Promise<{ klines: Kline[]; provider: ProviderId }> {
  const safeLimit = Math.max(220, Math.min(1000, Math.floor(limit)));
  const key = `backtest:klines:${symbol}:${interval}:${safeLimit}`;
  const hit = getCached<{ klines: Kline[]; provider: ProviderId }>(key);
  if (hit) return hit;
  const res = await providerRouter.getKlines(symbol, interval, safeLimit);
  setCached(key, res);
  return res;
}
```

- [ ] **Step 5: Correr los tests — confirmar GREEN**

```bash
bun run test src/lib/backtest.test.ts 2>&1 | tail -3 && bun run typecheck
```

Expected: PASS y typecheck 0 (el import `@/lib/cache` en backtest.ts es válido — módulo puro server-side, no hay arrastre de I/O en el client porque backtest.ts no se importa desde componentes).

- [ ] **Step 6: Suite + lint + Commit**

```bash
bun run test 2>&1 | tail -3 && bun run lint
git add src/lib/backtest.ts src/lib/backtest.test.ts
git commit -m "feat(backtest-ui): inyección de klines pre-cargadas + fetchKlinesCached (TDD)"
```

---

### Task 5: Parsers de compare (`src/lib/backtest-request.ts`) — TDD

**Files:**
- Modify: `src/lib/backtest-request.ts` (append → el archivo es solo helpers puros)
- Test: `src/lib/backtest-request.test.ts` (append)

**Interfaces:**
- Consumes: `parseCustomStrategy`, `VALID_INTERVALS`, `parseTradeLimits` (mismo archivo); `resolveStrategy` (mismo); `isValidSymbolFormat` de `@/lib/providers/symbols`.
- Produces (Task 6 consume EXACTAMENTE):

```ts
export type StrategyRefsParse =
  | { ok: true; refs: ({ strategyId: string } | { customStrategy: CustomStrategy })[] }
  | { ok: false; error: string };

/** body.strategies → ≤10 refs válidas. Cada item es id string o CustomStrategy. */
export function parseStrategyRefs(body: Record<string, unknown>): StrategyRefsParse;

export type CompareBaseConfig = {
  symbol: string;
  interval: BacktestInterval;
  limit: number;
  tradeLimits: TradeLimits;
};

/** symbol/interval/limit + tradeLimits, con el mismo mensaje/vals que la route existente. */
export function parseCompareConfig(
  body: Record<string, unknown>,
): { ok: true; config: CompareBaseConfig } | { ok: false; error: string };
```

- [ ] **Step 1: Escribir los tests que FALLAN primero**

Append al final de `src/lib/backtest-request.test.ts`:

```typescript
describe("parseStrategyRefs", () => {
  const base = { minConfidence: 60 };

  it("sin strategies válido (vacio / no-array) → ok:false", () => {
    expect(parseStrategyRefs({ strategies: [] }).ok).toBe(false);
    expect(parseStrategyRefs({ strategies: undefined }).ok).toBe(false);
    expect(parseStrategyRefs({ strategies: "trend_buy" }).ok).toBe(false);
    if (!parseStrategyRefs({ strategies: undefined }).ok) {
      expect(parseStrategyRefs({ strategies: undefined }).error).toContain("strategies");
    }
  });

  it(">10 estrategias → ok:false con el cap explícito en el mensaje", () => {
    const many = Array.from({ length: 11 }, () => "trend_buy");
    const out = parseStrategyRefs({ strategies: many });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("10");
  });

  it("ids predefinidos se pasan por strategyId en orden", () => {
    const out = parseStrategyRefs({ strategies: ["trend_buy", " breakout_short "] });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.refs).toEqual([{ strategyId: "trend_buy" }, { strategyId: "BREAKOUT_SHORT" }]);
  });

  it("customStrategy válido pasa parseCustomStrategy", () => {
    const custom = { id: "c1", name: "Mi LX", action: "BUY", conditions: [{ type: "rsi_below", threshold: 30 }] };
    const out = parseStrategyRefs({ strategies: [custom] });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.refs[0]).toEqual({ customStrategy: { ...custom, createdAt: expect.any(Number) } });
  });

  it("condición con type desconocido → todo el ref sería inválido (ok:false)", () => {
    // Reusar la misma validación por item de parseCustomStrategy — cualquier
    // item inválido aborta el pedido (nunca pasar silenciosamente).
    const bad = [{ id: "c1", name: "x", action: "BUY", conditions: [{ type: "" }] }];
    expect(parseStrategyRefs({ strategies: bad }).ok).toBe(false);
    expect(parseStrategyRefs({ strategies: [42] }).ok).toBe(false);
  });
});

describe("parseCompareConfig", () => {
  it("symbol inválido o faltante → ok:false", () => {
    for (const body of [{}, { symbol: "fault"}, { symbol: "BTC/BTC" }]) {
      expect(parseCompareConfig(body).ok).toBe(false);
    }
  });

  it("interval fuera de VALids → ok:false con el IF como la route existente", () => {
    expect(parseCompareConfig({ symbol: "BTCUSDT", interval: "9m" }).ok).toBe(false);
  });

  it("limit fuera de [50,1000] → ok:false", () => {
    for (const limit of [49, 1500, "600"]) {
      expect(parseCompareConfig({ symbol: "BTCUSDT", limit }).ok).toBe(false);
    }
  });

  it("caso mínimo válido: defaults de intervalo 4h/500 y tradeLimits de parseTradeLimits", () => {
    const out = parseCompareConfig({ symbol: "ethusdt" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.config.symbol).toBe("ETHUSDT");
      expect(out.config.interval).toBe("4h");
      expect(out.config.limit).toBe(500);
      expect(out.config.tradeLimits.minConfidence).toBe(60);
      expect(out.config.tradeLimits.positionSizing).toBe("full");
    }
  });
});
```

- [ ] **Step 2: Correr los tests — confirmar RED**

```bash
bun run test src/lib/backtest-request.test.ts 2>&1 | tail -3
```

Expected: FAIL — `parseStrategyRefs is not defined`.

- [ ] **Step 3: Implementación (append a `backtest-request.ts`)**

```typescript
import { isValidSymbolFormat } from "@/lib/providers/symbols";

export type StrategyRef = { strategyId: string } | { customStrategy: CustomStrategy };

export type StrategyRefsParse =
  | { ok: true; refs: StrategyRef[] }
  | { ok: false; error: string };

/**
 * POST /api/backtest/compare: validar ≤10 estrategias mixtas (ids definidos
 * y custom del builder). Cada item inválido rechaza TODO el pedido — el
 * error por estrategia que rompe upstream es de corrida, no de request.
 */
export function parseStrategyRefs(
  body: Record<string, unknown>,
): StrategyRefsParse {
  const raw = body.strategies;
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      ok: false,
      error: "Provide strategies: non-empty array of predefined ids or customStrategy objects.",
    };
  }
  if (raw.length > 10) {
    return { ok: false, error: "Maximum 10 strategies allowed in compare mode." };
  }

  const refs: StrategyRef[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (!item.trim()) {
        return { ok: false, error: "Empty strategy id in strategies array." };
      }
      refs.push({ strategyId: item.trim().toUpperCase() });
      continue;
    }
    if (item != null && typeof item === "object" && !Array.isArray(item)) {
      const parsed = parseCustomStrategy(item as Record<string, unknown>);
      if (!parsed.ok) {
        return { ok: false, error: "Invalid customStrategy item in strategies array." };
      }
      refs.push({ customStrategy: parsed.strategy });
      continue;
    }
    return { ok: false, error: "Each strategy must be a predefined id string or a customStrategy object." };
  }
  return { ok: true, refs };
}

export type CompareBaseConfig = {
  symbol: string;
  interval: BacktestInterval;
  limit: number;
  tradeLimits: TradeLimits;
};

/** Base config del compare con mensajes/defaults партии with /api/backtest. */
export function parseCompareConfig(
  body: Record<string, unknown>,
): { ok: true; config: CompareBaseConfig } | { ok: false; error: string } {
  const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
  if (!isValidSymbolFormat(symbol)) {
    return { ok: false, error: "Invalid or missing symbol (use a USDT pair, e.g. BTCUSDT)." };
  }
  const interval =
    typeof body.interval === "string" ? (body.interval as BacktestInterval) : "4h";
  if (!VALID_INTERVALS.includes(interval)) {
    return { ok: false, error: `Invalid interval: ${interval}` };
  }
  const limit = typeof body.limit === "number" ? body.limit : 500;
  if (!Number.isFinite(limit) || limit < 50 || limit > 1000) {
    return { ok: false, error: "limit must be between 50 and 1000." };
  }
  return {
    ok: true,
    config: { symbol, interval, limit, tradeLimits: parseTradeLimits(body) },
  };
}
```

Notas exactas para el executor:
- `parseStrategyRefs` ignora el case: ids a `.toUpperCase()` para tolerar `"trend_Buy"` (la resolución con `resolveStrategy` es case-sensitive — Task 6 lo cubre vía misma función).
- `isValidSymbolFormat` debe importarse una sóla vez — no importa si ya está (verificar header antes de duplicar).

- [ ] **Step 4: Correr los tests — confirmar GREEN**

```bash
bun run test src/lib/backtest-request.test.ts 2>&1 | tail -3 && bun run typecheck && bun run lint
```

Expected: PASS, typecheck/lint limpio.

- [ ] **Step 5: Commit**

```bash
git add src/lib/backtest-request.ts src/lib/backtest-request.test.ts
git commit -m "feat(backtest-ui): parsers puros de compare (refs y base config, TDD)"
```

---

### Task 6: Route `POST /api/backtest/compare`

**Files:**
- Create: `src/app/api/backtest/compare/route.ts`

**Interfaces:**
- Consumes:
  - `parseCompareConfig`, `parseStrategyRefs`, `resolveStrategy` (Task 5 y existente) de `@/lib/backtest-request`.
  - `runBacktest`, `fetchKlinesCached`, `BacktestParams` (Task 4) de `@/lib/backtest`.
  - `buildComparisonRows`, `CompareEntry` (Task 3) de `@/lib/backtest-compare`.
- Produces: `POST /api/backtest/compare` → 200 `{ results: CompareEntry[] }` (solo corredas: `result` + summary-level data; el cliente arma la tabla con `buildComparisonRows` o recibe ya `rows` — el response incluye AMBOS: `results` crudo y `rows` ya listas para la UI).
- Contrato: validación falla → 400 `{ error }`. Upstream Binance falla → NO 502 global: cada estrategy entry lleva `error` inline (el spec manda por-estrategia).

- [ ] **Step 1: Implementar la route**

Crear `src/app/api/backtest/compare/route.ts`:

```typescript
/**
 * POST /api/backtest/compare — correr N estrategias (≤10) contra el MISMO
 * config (symbol×interval×velas×tradeLimits) y devolver los resultados crudos
 * + las filas de comparación listas para la UI.
 *
 * Server-driven por diseño: fetchKlinesCached baja la historia UNA VEZ y la
 * inyecta en cada runBacktest through preloadedKlines (Task 4) — N estrategias
 * NO significan N descargas de Binance. Errores por estrategia quedan inline
 * en esa entry, nunca abortan las demás (spec: nada de datos fabricados).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  parseCompareConfig,
  parseStrategyRefs,
  resolveStrategy,
} from "@/lib/backtest-request";
import { buildComparisonRows, type CompareEntry } from "@/lib/backtest-compare";
import { fetchKlinesCached, runBacktest } from "@/lib/backtest";
import type { Kline, ProviderId } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const cfg = parseCompareConfig(body);
  if (!cfg.ok) {
    return NextResponse.json({ error: cfg.error }, { status: 400 });
  }
  const refs = parseStrategyRefs(body);
  if (!refs.ok) {
    return NextResponse.json({ error: refs.error }, { status: 400 });
  }

  // Resolución por ref (reusar resolveStrategy — mismo contrato que /api/backtest).
  type Resolved =
    | { ok: true; strategyRef: Parameters<typeof runBacktest>[0]["strategy"]; strategyId: string; strategyName: string; action: string; isCustom: boolean }
    | { ok: false; error: string };
  const resolved: Resolved[] = refs.refs.map((ref) => {
    const s = resolveStrategy(ref as Record<string, unknown>);
    if (!s.ok) return { ok: false, error: s.error };
    return {
      ok: true,
      strategyRef: s.strategyRef,
      strategyId: s.strategyId,
      strategyName: s.strategyName,
      action: s.action,
      isCustom: !!("customStrategy" in ref),
    };
  });

  // UNA descarga compartida (cache 60s). Una falla global marca todas las
  // entries con el mismo error inline (las fuenk corredas no existen).
  let klines: Kline[] | null = null;
  let provider: ProviderId | null = null;
  let upstreamError: string | null = null;
  try {
    const res = await fetchKlinesCached(cfg.config.symbol, cfg.config.interval, cfg.config.limit);
    klines = res.klines;
    provider = res.provider;
  } catch {
    upstreamError = "Failed to fetch historical klines from upstream provider.";
  }

  const results: CompareEntry[] = [];
  for (const r of resolved) {
    if (!r.ok) {
      results.push({
        strategyId: "unknown",
        strategyName: "unknown",
        action: "UNKNOWN",
        isCustom: false,
        error: r.error,
        result: null,
      });
      continue;
    }
    if (upstreamError != null || klines == null) {
      results.push({
        strategyId: r.strategyId,
        strategyName: r.strategyName,
        action: r.action,
        isCustom: r.isCustom,
        error: upstreamError,
        result: null,
      });
      continue;
    }
    const result = await runBacktest({
      symbol: cfg.config.symbol,
      interval: cfg.config.interval,
      limit: cfg.config.limit,
      strategy: r.strategyRef,
      action: r.action as Parameters<typeof runBacktest>[0]["action"],
      minConfidence: cfg.config.tradeLimits.minConfidence,
      initialCapital: cfg.config.tradeLimits.initialCapital,
      stopLossPct: cfg.config.tradeLimits.stopLossPct,
      takeProfitPct: cfg.config.tradeLimits.takeProfitPct,
      maxHoldCandles: cfg.config.tradeLimits.maxHoldCandles,
      positionSizing: cfg.config.tradeLimits.positionSizing,
      fixedFractionalPct: cfg.config.tradeLimits.fixedFractionalPct,
      feeBps: cfg.config.tradeLimits.feeBps,
      preloadedKlines: klines,
      preloadedProvider: provider,
    });
    results.push({
      strategyId: r.strategyId,
      strategyName: r.strategyName,
      action: r.action,
      isCustom: r.isCustom,
      error: result.error ?? null,
      result: result.error ? null : result,
    });
  }

  return NextResponse.json({ results, rows: buildComparisonRows(results) });
}
```

Notas para el executor (NO dejarlas en el código final):
- `resolveStrategy(ref as Record<string, unknown>)` recibe `{ strategyId }` **o** `{ customStrategy }` — su firma actual (`backtest-request.ts`) ya maneja ambas; el cast es solo porque el TS estrecho no infiere la union pasable. Si el cast choca, tipar `Resolved` con `StrategyResolution` importado en vez de redefinir.
- La entry de resolución inválida usa `strategyId: "unknown"`: buildComparisonRows la muestra como fila error sin competir.
- `action as Parameters<...>`: `resolveStrategy` devuelve `StrategyAction` y el engine espera exactamente eso; el cast es sólo para la estrechez de `BacktestParams.action`.

- [ ] **Step 2: Verificación en vivo con dev server (RED→GREEN del endpoint)**

Arrancar el dev server en el terminal ya corriendo (`bun run dev`, port 3000 — si ya corre, saltar):

```bash
curl -s -X POST http://localhost:3000/api/backtest/compare \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"BTCUSDT","strategies":["hold","trend_buy"]}' | head -c 400
```

Expected: JSON con `results` (2 entries — `hold` probablemente 0 trades, `trend_buy` con corrida) y `rows`. El endpoint no toca la BD.

Validaciones de error:

```bash
curl -s -X POST http://localhost:3000/api/backtest/compare -H 'Content-Type: application/json' -d '{"symbol":"BTCUSDT","strategies":[]}' | head -c 200
```

Expected: `{"error":"Provide strategies: non-empty array of predefined ids or customStrategy objects."}` 400.

- [ ] **Step 3: Lint + typecheck + Commit**

```bash
bun run lint && bun run typecheck
git add src/app/api/backtest/compare/route.ts
git commit -m "feat(backtest-ui): POST /api/backtest/compare (klines compartidas, N≤10, errores por estrategia)"
```

---

### Task 7: Routes de persistencia (`/api/backtest/runs` + `/api/backtest/presets`)

**Files:**
- Create: `src/app/api/backtest/runs/route.ts` (POST save y GET list)
- Create: `src/app/api/backtest/runs/[id]/route.ts` (GET detail y DELETE)
- Create: `src/app/api/backtest/presets/route.ts` (GET list y POST save)
- Create: `src/app/api/backtest/presets/[id]/route.ts` (DELETE)

**Interfaces:**
- Consumes: `db` de `@/lib/db` (`db.backtestRun`, `db.backtestPreset` — Task 1); `summarizeResult`/`truncateResultJson`/`RESULT_JSON_CAP_BYTES`/`parseStoredResult` (Task 2); `isValidSymbolFormat` de `@/lib/providers/symbols`; `VALID_INTERVALS` de `@/lib/backtest-request`.
- Produces (Tasks 10–12 consume):
  - `POST /api/backtest/runs` body `{ config, result }` donde `config = { symbol, interval, candles, strategyId?, strategyName, isCustom, ...tradeLimits-flats }` y `result` es un `BacktestResult` JSON completo → `{ id }` 200. Validación → 400; BD falla → 500 `{ error }`.
  - `GET /api/backtest/runs?limit=&symbol=&strategyId=` → `{ runs: [{ id, createdAt, symbol, interval, candles, strategyId, strategyName, isCustom, ...summary }] }` — **SIN** `resultJson`. `limit` default 50, clamp 1..100.
  - `GET /api/backtest/runs/[id]` → `{ run, result }` (result parseado con `parseStoredResult`; payload corrupto → 500 `{ error: "Stored payload is not valid JSON." }`).
  - `DELETE /api/backtest/runs/[id]` → `{ removed: true }` | 404 `{ error: "Run not found." }`.
  - `GET /api/backtest/presets` → `{ presets: [{ id, createdAt, name }] }`.
  - `POST /api/backtest/presets` body `{ name, config }` → `{ id }`; límites: name string trim no-vacío ≤80, ≤20 presets → 400 `Preset limit reached (20). Delete one first.`
  - `DELETE /api/backtest/presets/[id]` → `{ removed: true }` | 404.

- [ ] **Step 1: Implementar `runs/route.ts` (POST + GET)**

```typescript
/**
 * /api/backtest/runs — persist a backtest run (POST) and list them (GET).
 * POST validates + serializes (cap 1MB, deterministic trade truncation via
 * src/lib/backtest-db.ts) and answers with the created row id — saving IS
 * the user-requested workflow, so errors here ARE reported (400/500), the
 * fire-and-forget pattern of CrossEvent does NOT apply.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  RESULT_JSON_CAP_BYTES,
  truncateResultJson,
  summarizeResult,
} from "@/lib/backtest-db";
import { isValidSymbolFormat } from "@/lib/providers/symbols";
import { VALID_INTERVALS } from "@/lib/backtest-request";
import type { BacktestInterval } from "@/lib/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUMMARY_SELECT = {
  id: true,
  createdAt: true,
  symbol: true,
  interval: true,
  candles: true,
  strategyId: true,
  strategyName: true,
  isCustom: true,
  totalTrades: true,
  winRatePct: true,
  totalReturnPct: true,
  maxDrawdownPct: true,
  profitFactor: true,
} satisfies Prisma.BacktestRunSelect;

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function tooLargeResultError(): NextResponse {
  return NextResponse.json(
    { error: `resultJson exceeds the ${RESULT_JSON_CAP_BYTES}-byte cap even after trade truncation.` },
    { status: 400 },
  );
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const cfg = body.config != null && typeof body.config === "object"
    ? (body.config as Record<string, unknown>)
    : null;
  if (!cfg) {
    return NextResponse.json({ error: "Missing config object." }, { status: 400 });
  }

  const symbol = typeof cfg.symbol === "string" ? cfg.symbol.toUpperCase() : "";
  if (!isValidSymbolFormat(symbol)) {
    return NextResponse.json({ error: "Invalid or missing config.symbol." }, { status: 400 });
  }
  const interval = typeof cfg.interval === "string" ? cfg.interval : "";
  if (!VALID_INTERVALS.includes(interval as BacktestInterval)) {
    return NextResponse.json({ error: `Invalid config.interval: ${interval}` }, { status: 400 });
  }
  const candles = finite(cfg.candles) && cfg.candles >= 50 && cfg.candles <= 1000 ? Math.floor(cfg.candles) : 0;
  if (candles === 0) {
    return NextResponse.json({ error: "config.candles must be a number in [50, 1000]." }, { status: 400 });
  }
  const strategyId = typeof cfg.strategyId === "string" && cfg.strategyId ? cfg.strategyId : null;
  const strategyName = typeof cfg.strategyName === "string" && cfg.strategyName.trim()
    ? cfg.strategyName.trim().slice(0, 120)
    : "";
  if (!strategyName) {
    return NextResponse.json({ error: "config.strategyName is required." }, { status: 400 });
  }
  const isCustom = cfg.isCustom === true;

  const result = body.result as BacktestResultInput | null;
  if (!result || typeof result !== "object" || !Array.isArray((result as { trades?: unknown }).trades)) {
    return NextResponse.json({ error: "Missing or invalid result (BacktestResult shape expected)." }, { status: 400 });
  }

  // Config completo (solo tradeLimits flats): minConfidence, initialCapital,
  // stopLossPct, takeProfitPct, maxHoldCandles, positionSizing,
  // fixedFractionalPct, feeBps — white-listed, nunca echo passthrough.
  const configJson = JSON.stringify({
    minConfidence: numberOrNullCfg(cfg, "minConfidence", 60),
    initialCapital: numberOrNullCfg(cfg, "initialCapital", 10_000),
    stopLossPct: numberOrNullCfg(cfg, "stopLossPct", 5),
    takeProfitPct: numberOrNullCfg(cfg, "takeProfitPct", 10),
    maxHoldCandles: numberOrNullCfg(cfg, "maxHoldCandles", 50),
    positionSizing: typeof cfg.positionSizing === "string" ? cfg.positionSizing : "full",
    fixedFractionalPct: numberOrNullCfg(cfg, "fixedFractionalPct", 25),
    feeBps: numberOrNullCfg(cfg, "feeBps", 10),
  });

  const summary = summarizeResult(result.stats);
  const t = truncateResultJson(result);
  if (Buffer.byteLength(t.json, "utf8") > RESULT_JSON_CAP_BYTES && t.keptTrades === 0) {
    return tooLargeResultError();
  }

  try {
    const row = await db.backtestRun.create({
      data: {
        symbol,
        interval,
        candles,
        strategyId,
        strategyName,
        isCustom,
        config: configJson,
        totalTrades: summary.totalTrades,
        winRatePct: summary.winRatePct,
        totalReturnPct: summary.totalReturnPct,
        maxDrawdownPct: summary.maxDrawdownPct,
        profitFactor: summary.profitFactor,
        resultJson: t.json,
      },
      select: { id: true },
    });
    return NextResponse.json({ id: row.id, truncated: t.truncated, keptTrades: t.keptTrades });
  } catch (err) {
    console.error("POST /api/backtest/runs failed:", err);
    return NextResponse.json({ error: "Could not persist the run." }, { status: 500 });
  }
}

function numberOrNullCfg(cfg: Record<string, unknown>, key: string, def: number): number {
  const v = cfg[key];
  return finite(v) ? v : def;
}

type BacktestResultInput = { stats: unknown; trades: unknown[]; [k: string]: unknown };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 50;
  const symbol = sp.get("symbol")?.toUpperCase() || undefined;
  const strategyId = sp.get("strategyId") || undefined;

  try {
    const runs = await db.backtestRun.findMany({
      where: { ...(symbol ? { symbol } : {}), ...(strategyId ? { strategyId } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: SUMMARY_SELECT,
    });
    return NextResponse.json({ runs });
  } catch (err) {
    console.error("GET /api/backtest/runs failed:", err);
    return NextResponse.json({ error: "Could not list runs." }, { status: 500 });
  }
}
```

Nota: `BacktestResultInput` es un tipo mínimo estructural (el server no revalida TODO el BacktestResult aquí — la UI envía lo que el engine devolvió; la validación completa corre en `GET /[id]` via `parseStoredResult`). Si el typecheck lo siente weak, importar el tipo real: `import type { BacktestResult } from "@/lib/backtest"` y usarlo directo para `result`.

- [ ] **Step 2: Implementar `runs/[id]/route.ts` (GET detail + DELETE)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseStoredResult } from "@/lib/backtest-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const row = await db.backtestRun.findUnique({
      where: { id },
      select: {
        id: true, createdAt: true, symbol: true, interval: true, candles: true,
        strategyId: true, strategyName: true, isCustom: true, config: true,
        totalTrades: true, winRatePct: true, totalReturnPct: true,
        maxDrawdownPct: true, profitFactor: true, resultJson: true,
      },
    });
    if (!row) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    const parsed = parseStoredResult(row.resultJson);
    if (!parsed.ok) {
      // Corrupción de BD (defensa del spec: nunca datos fabricados).
      return NextResponse.json({ error: parsed.reason }, { status: 500 });
    }
    return NextResponse.json({ run: row, result: parsed.result, truncation: parsed.truncatedMeta });
  } catch (err) {
    console.error("GET /api/backtest/runs/[id] failed:", err);
    return NextResponse.json({ error: "Could not load the run." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const deleted = await db.backtestRun.deleteMany({ where: { id } });
    if (deleted.count === 0) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    return NextResponse.json({ removed: true });
  } catch (err) {
    console.error("DELETE /api/backtest/runs/[id] failed:", err);
    return NextResponse.json({ error: "Could not delete the run." }, { status: 500 });
  }
}
```

- [ ] **Step 3: Implementar `presets/route.ts` y `presets/[id]/route.ts`**

`presets/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESET_LIMIT = 20;

export async function GET() {
  try {
    const presets = await db.backtestPreset.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, name: true },
    });
    return NextResponse.json({ presets });
  } catch (err) {
    console.error("GET /api/backtest/presets failed:", err);
    return NextResponse.json({ error: "Could not list presets." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) {
    return NextResponse.json(
      { error: "Preset name is required (max 80 chars)." }, { status: 400 },
    );
  }
  if (body.config == null || typeof body.config !== "object" || Array.isArray(body.config)) {
    return NextResponse.json({ error: "Preset config object is required." }, { status: 400 });
  }
  if ((body.config as Record<string, unknown>).symbol != null) {
    const symbol = String((body.config as Record<string, unknown>).symbol).toUpperCase();
    // Light-touch symbol check (full validation happens on run).
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      return NextResponse.json({ error: "Preset config.symbol looks invalid." }, { status: 400 });
    }
  }

  try {
    const count = await db.backtestPreset.count();
    if (count >= PRESET_LIMIT) {
      return NextResponse.json(
        { error: `Preset limit reached (${PRESET_LIMIT}). Delete one first.` },
        { status: 400 },
      );
    }
    // Si el nombre ya existe, sobreescribe (el user corrigió su config).
    await db.backtestPreset.deleteMany({ where: { name } });
    const row = await db.backtestPreset.create({
      data: { name, config: JSON.stringify(body.config) },
      select: { id: true },
    });
    return NextResponse.json({ id: row.id });
  } catch (err) {
    console.error("POST /api/backtest/presets failed:", err);
    return NextResponse.json({ error: "Could not save the preset." }, { status: 500 });
  }
}
```

`presets/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const deleted = await db.backtestPreset.deleteMany({ where: { id } });
    if (deleted.count === 0) {
      return NextResponse.json({ error: "Preset not found." }, { status: 404 });
    }
    return NextResponse.json({ removed: true });
  } catch (err) {
    console.error("DELETE /api/backtest/presets/[id] failed:", err);
    return NextResponse.json({ error: "Could not delete the preset." }, { status: 500 });
  }
}
```

Además el `GET` presets debe exponer el `config` parseado para aplicarlo con un click — cambiar el `select` de `GET` por `{ id, createdAt, name, config: true }` y devolver cada preset con `config: JSON.parse(row.config)` con try/catch por fila (los corruptos se filtran con `console.warn`). El shape final: `{ presets: [{ id, createdAt, name, config: Record<string, unknown> }] }`.

- [ ] **Step 4: Prueba en vivo con dev server**

Dev server ya arriba. Probar ambos endpoints:

```bash
# POST run (config + result mínimo fabricado SOLO para smoke — el flujo real
# lo manda el UI con el objeto real del engine):
RESULT=$(curl -s -X POST http://localhost:3000/api/backtest -H 'Content-Type: application/json' -d '{"symbol":"BTCUSDT","interval":"4h","limit":220,"strategyId":"trend_buy"}')
curl -s -X POST http://localhost:3000/api/backtest/runs -H 'Content-Type: application/json' \
  -d "{\"config\":{\"symbol\":\"BTCUSDT\",\"interval\":\"4h\",\"candles\":220,\"strategyId\":\"trend_buy\",\"strategyName\":\"Trend Buy\",\"isCustom\":false},\"result\":$RESULT}" | head -c 200

curl -s "http://localhost:3000/api/backtest/runs?limit=5" | head -c 400
curl -s "http://localhost:3000/api/backtest/presets" | head -c 300
curl -s -X POST http://localhost:3000/api/backtest/presets -H 'Content-Type: application/json' \
  -d '{"name":"smoke-preset","config":{"symbol":"BTCUSDT","interval":"4h","limit":500}}' | head -c 200
```

Expected: POST run → `{ id: "<cuid>", truncated: false, keptTrades: n }`; GET runs → ≥1 fila con summary; presets POST → `{ id }`. append `--fail-with-body` a cada curl para capturar 4xx/5xx en el exit.

- [ ] **Step 5: Lint + typecheck + Commit**

```bash
bun run lint && bun run typecheck && bun run test 2>&1 | tail -3
git add src/app/api/backtest/runs src/app/api/backtest/presets
git commit -m "feat(backtest-ui): persistencia de corridas y presets en SQLite"
```

---

### Task 8: Extracción de componentes compartidos (`equity-curve` + `trade-table`)

**Files:**
- Create: `src/components/panel/backtest/equity-curve.tsx`
- Create: `src/components/panel/backtest/trade-table.tsx`
- Modify: `src/components/panel/backtest-modal.tsx` (usar los nuevos; borrar el código movido)

**Interfaces:**
- Consumes: `BacktestTrade` de `@/lib/backtest`; `useLanguage`; los imports relativos `require` dentro de `src/components/panel/`.
- Produces (Tasks 10–11 reutilizan EXACTAMENTE):

```tsx
// equity-curve.tsx
type Props = { result: BacktestResult; className?: string };
export function EquityCurveCanvas({ result, className }: Props): JSX.Element

// trade-table.tsx
type Props = { trades: BacktestTrade[]; maxHeightClass?: string };
export function TradeTable({ trades, maxHeightClass }: Props): JSX.Element
```

Regla del extracción: el código de dibujo/estilos se mueve **verbatim** desde el modal; SOLO se reemplazan: la referencia al `canvasRef` local por un `useRef` interno del componente, los `t("backtest.*")` siguen igual, y las dependencias del `useEffect` pasan a las props. El modal queda visivamente idéntico (regresión visual = ninguna).

- [ ] **Step 1: Crear `src/components/panel/backtest/equity-curve.tsx`**

Ancla del código a mover: en `src/components/panel/backtest-modal.tsx`, el `useEffect` que dibuja (líneas ~298–290; anchor exacto: `const canvas = canvasRef.current;`) y el `<canvas ref={canvasRef}` (líneas ~990–1010). Estructura completa del archivo nuevo:

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { BacktestResult } from "@/lib/backtest";
import { useLanguage } from "@/hooks/use-language";

type Props = {
  /** Full result from the engine... */
  result: BacktestResult;
  className?: string;
};

/**
 * EquityCurveCanvas — HiDPI canvas equity chart, extracted VERBATIM from
 * BacktestModal (repo rule: Canvas API, no chart libs). Renders the equity
 * curve with its baseline, in-position bands and direction coloring.
 */
export function EquityCurveCanvas({ result, className }: Props) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // ... (pegar AQUÍ el cuerpo del useEffect del modal SIN cambios)
  }, [result, t]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "w-full"}
      role="img"
      aria-label={t("backtest.equityCurve")}
    />
  );
}
```

IMPORTANT en el paso: copiar el cuerpo del `useEffect` COMPLETO (el loop de `equityCurve` incluido) del modal SIN cambios de lógica. Puntos exactos a revisar mientras se mueve:
- Si el código usa el `initialCapital` del estado del modal, reemplazarlo por `result.params.initialCapital` (ya viene dentro del result — NO agregar props nuevas).
- Los strings visibles del canvas se pintan con `t("backtest.*")` — quedan igual.
- El array de deps del `useEffect` nuevo: `[result, t]` (resultado + traducciones; nada más).
- HiDPI: el bloque `window.devicePixelRatio` del modal se mueve tal cual (regla AGENTS §4).

- [ ] **Step 2: Crear `src/components/panel/backtest/trade-table.tsx`**

Ancla: en `backtest-modal.tsx`, el bloque `<table>` que renderiza `result.trades` (buscar `REASON_KEYS` — el mapa ya existe en ese archivo, líneas 64–70; el `<table>` real lo usa). Archivo nuevo:

```tsx
"use client";

import type { BacktestTrade } from "@/lib/backtest";
import { useLanguage } from "@/hooks/use-language";

type Props = {
  trades: BacktestTrade[];
  /** Tailwind max-height utility for the scroll container. Default none. */
  maxHeightClass?: string;
};

const REASON_KEYS: Record<BacktestTrade["exitReason"], string> = {
  stop_loss: "backtest.reasonStopLoss",
  take_profit: "backtest.reasonTakeProfit",
  max_hold: "backtest.reasonMaxHold",
  signal_exit: "backtest.reasonSignalExit",
  end_of_data: "backtest.reasonEnd",
};

/**
 * TradeTable — closing trades as a scrollable table, extracted VERBATIM
 * from BacktestModal (mismas clases y colores; solo se parametriza la
 * altura del contenedor de scroll).
 */
export function TradeTable({ trades, maxHeightClass }: Props) {
  const { t } = useLanguage();
  return (
    <div className={maxHeightClass ?? "max-h-96 overflow-y-auto"}>
      {/* PEGAR AQUÍ la <table> del modal verbatim, con:
          - result.trades  → trades
          - t("backtest.colEntry") etc. igual
          - sin referencia a estado local del modal */}
    </div>
  );
}
```

- [ ] **Step 3: Re-wire del modal**

En `src/components/panel/backtest-modal.tsx`:
1. Agregar imports:
   ```typescript
   import { EquityCurveCanvas } from "./backtest/equity-curve";
   import { TradeTable } from "./backtest/trade-table";
   ```
   (relative rule incontrado — AGENTS.md §2),
2. Reemplazar el useEffect del canvas (ancla línea 298–290) y su `<canvas>` (líneas ~1006) por `<EquityCurveCanvas result={result} />` (guardado con `result &&`).
3. Reemplazar la `<table>` de trades por `<TradeTable trades={result.trades} />`.
4. `REASON_KEYS` ya no se usa en el modal → borrarlo del modal (queda en trade-table).
5. `canvasRef` y su `useRef` ya no se usan → borrar.
6. Revisar si el modal usa trades table variables adicionales (`t("backtest.entry")`…): aqui NO crear keys nuevas — todo lo que el modal ya tenía sigue funcionando igual.

- [ ] **Step 4: Verificación — suite + typecheck + lint + smoke visual del modal**

```bash
bun run typecheck && bun run lint && bun run test 2>&1 | tail -3
```

Expected: todo verde (344+ — los tests no validan visuals). Smoke visual queda para el rebuild del final (Task 13) — el modal debe verse igual: equity curve + tabla con colores idénticos.

- [ ] **Step 5: Commit**

```bash
git add src/components/panel/backtest/equity-curve.tsx src/components/panel/backtest/trade-table.tsx src/components/panel/backtest-modal.tsx
git commit -m "refactor(backtest-ui): extraer EquityCurveCanvas y TradeTable del modal sin cambio visual"
```

---

### Task 9: Página `/backtest` — scaffold, tabs, header link, i18n base

**Files:**
- Create: `src/app/backtest/page.tsx` (client, tabs shell + estado compartido del config form)
- Modify: `src/app/page.tsx` (~líneas 443–446, junto al link Comparar — agregar link Backtest)
- Modify: `src/lib/i18n.ts` (keys base `backtestUI.*` en los 4 idiomas)

**Interfaces:**
- Consumes: `useLanguage`; `buildGatewaySocketTarget` NO aplica (todo por fetch REST).
- Produces: ruta `/backtest` con tabs "run" | "compare" | "history"; Tasks 10–12 llenan cada tab con componentes en `src/components/panel/backtest/tab-*.tsx`.

- [ ] **Step 1: Keys i18n base (4 idiomas) en `src/lib/i18n.ts`**

Buscar en `src/lib/i18n.ts` el dict español (dot-keys ordenadas) y agregar las keys `backtestUI.*` en los 4 dicts (es, en, zh, fr). Valores EXACTOS:

```
es: backtestUI.nav = "Backtest"
    backtestUI.title = "Backtesting dedicado"
    backtestUI.tabRun = "Corrida"
    backtestUI.tabCompare = "Comparación"
    backtestUI.tabHistory = "Historial"
en: backtestUI.nav = "Backtest"
    backtestUI.title = "Dedicated backtesting"
    backtestUI.tabRun = "Run"
    backtestUI.tabCompare = "Compare"
    backtestUI.tabHistory = "History"
zh: backtestUI.nav = "回测"
    backtestUI.title = "专用回测"
    backtestUI.tabRun = "运行"
    backtestUI.tabCompare = "对比"
    backtestUI.tabHistory = "历史"
fr: backtestUI.nav = "Backtest"
    backtestUI.title = "Backtesting dédié"
    backtestUI.tabRun = "Exécution"
    backtestUI.tabCompare = "Comparaison"
    backtestUI.tabHistory = "Historique"
```

Las keys restantes (`backtestUI.save`, `backtestUI.savedMsg`, etc.) se agregan en cada task de tab — cada task trae su lista exacta.

- [ ] **Step 2: Scaffold de la página**

Crear `src/app/backtest/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { BarChart3, Home } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import TabRun from "@/components/panel/backtest/tab-run";
import TabCompare from "@/components/panel/backtest/tab-compare";
import TabHistory from "@/components/panel/backtest/tab-history";

type TabId = "run" | "compare" | "history";

/**
 * Dedicated backtesting workspace (server-driven): thin client wrapper.
 * Each tab is its own component in src/components/panel/backtest/.
 */
export default function BacktestPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<TabId>("run");

  const TABS: { id: TabId; label: string }[] = [
    { id: "run", label: t("backtestUI.tabRun") },
    { id: "compare", label: t("backtestUI.tabCompare") },
    { id: "history", label: t("backtestUI.tabHistory") },
  ];

  return (
    <main className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-[#4fa8d8]" aria-hidden />
          <span className="text-sm font-semibold">{t("backtestUI.title")}</span>
        </div>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
        >
          <Home className="h-3.5 w-3.5" aria-hidden />
          {t("backtestUI.title")}
        </a>
      </header>

      <div className="flex gap-2 border-b border-white/10 px-4 py-2" role="tablist" aria-label={t("backtestUI.title")}>
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => setTab(tb.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8] ${
              tab === tb.id
                ? "bg-[#4fa8d8]/15 text-[#4fa8d8]"
                : "text-foreground/60 hover:bg-white/5"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div className="flex-1 px-4 py-4">
        {tab === "run" && <TabRun />}
        {tab === "compare" && <TabCompare />}
        {tab === "history" && <TabHistory />}
      </div>
    </main>
  );
}
```

TabRun/TabCompare/TabHistory aún no existen → crear los 3 archivos con los stubs funcionales de abajo en ESTE task (regla: `bun run typecheck` debe pasar al terminar el task — no se commitea imports rotos).

`src/components/panel/backtest/tab-run.tsx`:
```tsx
"use client";
import { useLanguage } from "@/hooks/use-language";
/** Placeholder wiring implemented in Task 10. */
export default function TabRun() {
  const { t } = useLanguage();
  return <div className="text-sm text-muted-foreground">{t("backtestUI.tabRun")}</div>;
}
```

`tab-compare.tsx` y `tab-history.tsx`: mismo shape exacto (default export, `useLanguage`, un `<div>` con el label de SU tab — `t("backtestUI.tabCompare")` y `t("backtestUI.tabHistory")` respectivamente). El stub ya es funcional: muestra el label de la tab; Tasks 11–12 lo reemplazan por completo con `write_file`.

- [ ] **Step 3: Header link en el dashboard**

En `src/app/page.tsx` (líneas ~433–453, el bloque de `<Link href="/comparar">…</Link>`)**cambiar** — INSERTAR después del Link de /comparar (antes del de /status):

```tsx
<Link
  href="/backtest"
  className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
  aria-label={t("backtestUI.title")}
  title={t("backtestUI.title")}
>
  <BarChart3 className="h-3.5 w-3.5" aria-hidden />
  <span className="hidden sm:inline">{t("backtestUI.nav")}</span>
</Link>
```

Asegurar que `BarChart3` está importado de `lucide-react` en `page.tsx` (verificar en header; si no, agregarlo al import más cercano).

- [ ] **Step 4: Verificación de guardas i18n + typecheck + lint + suite**

```bash
bun run test src/lib/i18n.test.ts src/lib/i18n-usage.test.ts src/lib/i18n-hardcoded.test.ts 2>&1 | tail -3
bun run typecheck && bun run lint
```

Expected: guardas i18n GREEN (las keys existen en los 4 dicts — estas guardas CRUZAN cada key contra los 4 dicts y contra uso en componentes), typecheck 0.

- [ ] **Step 5: Smoke visual (dev server ya arriba)**

Smoke: visitar `http://localhost:3000/backtest` — los 3 tabs se ven con sus labels en español; click entre tabs cambia solo el panel activo (los stubs muestran el label). En `http://localhost:3000/` aparece el nuevo link Backtest junto a Comparar y Status.

- [ ] **Step 6: Commit**

```bash
git add src/app/backtest src/app/page.tsx src/lib/i18n.ts src/components/panel/backtest/tab-*.tsx
git commit -m "feat(backtest-ui): scaffold /backtest con 3 tabs + link en header + i18n base"
```

---

### Task 10: Tab Corrida — run individual con guardado en BD

**Files:**
- Create: `src/components/panel/backtest/config-form.tsx` (firmas compartidas con Task 11)
- Create: `src/components/panel/backtest/tab-run.tsx` (reemplaza stub)
- Modify: `src/lib/i18n.ts` (keys nuevas de esta tab, 4 idiomas)

**Interfaces:**
- Consumes: `EquityCurveCanvas`, `TradeTable` (Task 8); endpoint `POST /api/backtest` existente (contrato ya probado); `POST /api/backtest/runs` (Task 7); las 7 estrategias predefinidas vía `STRATEGY_LIST` de `@/lib/strategies` (ids: `trend_buy`, `mean_reversion_buy`, `trend_short`, `breakout_buy`, `mean_reversion_short`, `breakout_short`, `hold`); custom strategies del builder con `loadCustomStrategies` de `@/lib/custom-strategies` (verificar el nombre exacto del export con grep — si el export se llama distinto, usar el real); tipos `BacktestResult`, `BacktestInterval`, `PositionSizing` de `@/lib/backtest`.
- Produces: `config-form.tsx` con types compartidos que Task 11 reusa EXACTAMENTE:

```tsx
export type BacktestFormConfig = {
  symbol: string;
  interval: BacktestInterval;
  candles: number;           // 220 | 500 | 1000
  strategyId: string | null; // predefined id, null cuando action custom
  customStrategyName: string; // display name si custom
  customStrategy: CustomStrategy | null;
  minConfidence: number;
  initialCapital: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldCandles: number;
  positionSizing: PositionSizing;
  fixedFractionalPct: number;
  feeBps: number;
};

type Props = {
  value: BacktestFormConfig;
  onChange: (next: BacktestFormConfig) => void;
  /** Compare mode strips the strategy selector (Task 11 uses its own multi-select). */
  variant: "run" | "compare";
};

export function BacktestConfigForm({ value, onChange, variant }: Props): JSX.Element
```

Keys i18n NUEVAS de esta tab (agregarlas también en en/zh/fr):
```
backtestUI.configSymbol, backtestUI.configSymbolPlaceholder,
backtestUI.candlesLabel, backtestUI.capital, backtestUI.minConfidence,
backtestUI.stopLoss, backtestUI.takeProfit, backtestUI.maxHold,
backtestUI.positionSizing, backtestUI.fixedFractional, backtestUI.fees,
backtestUI.runBtn, backtestUI.running, backtestUI.saveBtn,
backtestUI.savedMsg, backtestUI.saveFailed, backtestUI.saveTruncated,
backtestUI.loadPresets, backtestUI.applyPreset, backtestUI.savePreset,
backtestUI.presetName, backtestUI.presetLimitReached, backtestUI.noPresets
```
Verificar en `src/lib/i18n.ts` si `backtest.walkForward` ya existe reusarlo; si no, agregar `backtestUI.walkForward` ES "Walk-Forward" EN/ZH/FR literal-técnicos. NO duplicar keys de `backtest.*` que ya sirven (colEntry, colExit, reasonStopLoss, etc.).

- [ ] **Step 1: Implementar `config-form.tsx`**

Estructura (código base; los inputs son los mismos que el modal usa hoy en su columna izquierda, mismas clases `rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs`):

```tsx
"use client";

import type { BacktestInterval, PositionSizing } from "@/lib/backtest";
import type { CustomStrategy } from "@/lib/custom-strategies";
import { useLanguage } from "@/hooks/use-language";

export type BacktestFormConfig = {
  symbol: string;
  interval: BacktestInterval;
  candles: number;
  strategyId: string | null;
  customStrategyName: string;
  customStrategy: CustomStrategy | null;
  minConfidence: number;
  initialCapital: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldCandles: number;
  positionSizing: PositionSizing;
  fixedFractionalPct: number;
  feeBps: number;
};

type Props = {
  value: BacktestFormConfig;
  onChange: (next: BacktestFormConfig) => void;
  variant: "run" | "compare";
};

const INTERVALS: BacktestInterval[] = ["15m", "1h", "4h", "1d"];
const CANDLE_OPTIONS = [220, 500, 1000];
const SIZING_OPTIONS: PositionSizing[] = ["full", "fixed_fractional", "half_kelly", "kelly"];

export function BacktestConfigForm({ value, onChange, variant }: Props) {
  const { t } = useLanguage();
  const set = (patch: Partial<BacktestFormConfig>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      {/* symbol */}
      <label className="block">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("backtestUI.configSymbol")}
        </span>
        <input
          type="text"
          value={value.symbol}
          placeholder="BTCUSDT"
          onChange={(e) => set({ symbol: e.target.value.toUpperCase() })}
          className="mt-1 w-full rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
        />
      </label>
      {/* interval segmented + candles select + SL/TP/maxHold/capital/minConfidence/sizing/feeBps */}
      {/* ...mismo field-shape del modal para cada key — cada input con su
             onChange set({key}) y tipo (number→parseFloat con fallback)... */}
    </div>
  );
}
```

El executor completa cada <label> del config con el shape del modal (los campos NUMÉRICOS con `type="number"` + `min`/`max` de `parseTradeLimits`: minConfidence 10–100, initialCapital 100–1e9, stopLossPct 0.1–50, takeProfitPct 0.1–200, maxHoldCandles 1–500, fixedFractionalPct 1–100, feeBps 0–500).

- [ ] **Step 2: Implementar `tab-run.tsx` (reemplaza stub)**

```tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, Play, Save } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { STRATEGY_LIST } from "@/lib/strategies";
import type { BacktestResult } from "@/lib/backtest";
import { loadCustomStrategies } from "@/lib/custom-strategies";
import { BacktestConfigForm, type BacktestFormConfig } from "./config-form";
import { EquityCurveCanvas } from "./equity-curve";
import { TradeTable } from "./trade-table";

const DEFAULT_CONFIG: BacktestFormConfig = {
  symbol: "BTCUSDT",
  interval: "4h",
  candles: 500,
  strategyId: "trend_buy",
  customStrategyName: "",
  customStrategy: null,
  minConfidence: 60,
  initialCapital: 10_000,
  stopLossPct: 5,
  takeProfitPct: 10,
  maxHoldCandles: 50,
  positionSizing: "full",
  fixedFractionalPct: 25,
  feeBps: 10,
};

export default function TabRun() {
  const { t } = useLanguage();
  const [config, setConfig] = useState<BacktestFormConfig>(DEFAULT_CONFIG);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true); setError(null); setSaveMsg(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: config.symbol, interval: config.interval, limit: config.candles,
          ...(config.strategyId && !config.customStrategy ? { strategyId: config.strategyId } : {}),
          ...(config.customStrategy ? { customStrategy: config.customStrategy } : {}),
          minConfidence: config.minConfidence, initialCapital: config.initialCapital,
          stopLossPct: config.stopLossPct, takeProfitPct: config.takeProfitPct,
          maxHoldCandles: config.maxHoldCandles, positionSizing: config.positionSizing,
          fixedFractionalPct: config.fixedFractionalPct, feeBps: config.feeBps,
        }),
      });
      const json = (await res.json()) as BacktestResult;
      if (json.error) { setError(json.error); setResult(null); }
      else { setResult(json); }
    } catch {
      setError(t("backtestUI.saveFailed"));
    } finally { setRunning(false); }
  }, [config, t]);

  const save = useCallback(async () => {
    if (!result) return;
    setSaveMsg(null);
    try {
      const res = await fetch("/api/backtest/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            symbol: result.symbol, interval: config.interval, candles: config.candles,
            strategyId: result.strategy.id.startsWith("custom_") || config.customStrategy ? null : result.strategy.id,
            strategyName: result.strategy.name, isCustom: !!config.customStrategy,
            minConfidence: config.minConfidence, initialCapital: config.initialCapital,
            stopLossPct: config.stopLossPct, takeProfitPct: config.takeProfitPct,
            maxHoldCandles: config.maxHoldCandles, positionSizing: config.positionSizing,
            fixedFractionalPct: config.fixedFractionalPct, feeBps: config.feeBps,
          },
          result,
        }),
      });
      const json = (await res.json()) as { id?: string; truncated?: boolean; error?: string };
      if (json.error) setSaveMsg(t("backtestUI.saveFailed") + " — " + json.error);
      else setSaveMsg(t("backtestUI.savedMsg") + (json.truncated ? " (" + t("backtestUI.saveTruncated") + ")" : ""));
    } catch { setSaveMsg(t("backtestUI.saveFailed")); }
  }, [result, config, t]);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-3 rounded-lg border border-white/10 bg-[#11151c] p-4 lg:sticky lg:top-4 lg:self-start">
        <BacktestConfigForm value={config} onChange={setConfig} variant="run" />
        <div className="flex flex-col gap-2">
          <button type="button" onClick={run} disabled={running}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[#5FBF8F] px-3 py-2 text-xs font-semibold text-[#0A0D12] transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            {running ? t("backtestUI.running") : t("backtestUI.runBtn")}
          </button>
          <button type="button" onClick={save} disabled={!result}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-[#4fa8d8]/40 bg-[#4fa8d8]/10 px-3 py-2 text-xs font-medium text-[#4fa8d8] transition-colors hover:bg-[#4fa8d8]/20 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]">
            <Save className="h-3.5 w-3.5" aria-hidden /> {t("backtestUI.saveBtn")}
          </button>
          {saveMsg && <p className="text-[11px] text-muted-foreground">{saveMsg}</p>}
        </div>
      </aside>

      <section className="space-y-4">
        {error && <div role="alert" className="rounded-md border border-[#E2604F]/40 bg-[#E2604F]/10 px-3 py-2 text-xs text-[#E2604F]">{error}</div>}
        {result && (
          <>
            <div className="rounded-lg border border-white/10 bg-[#11151c] p-4">
              <EquityCurveCanvas result={result} />
            </div>
            {/* fila de métricas destacadas (stats del result; los mismos keys de `backtest.*` del modal) */}
            <TradeTable trades={result.trades} maxHeightClass="max-h-[60vh]" />
          </>
        )}
      </section>
    </div>
  );
}
```

DETALLES OBLIGATORIOS al completar:
- El **selector de estrategia** (predefinida con `STRATEGY_LIST.find(...)` o custom cargada con `loadCustomStrategies`) va DENTRO de la tab, NO del config-form — porque solo la tab "run" elige una estrategia (el form del compare usa su propio multi-select). Grep del export de custom-strategies antes de usar (`loadCustomStrategies` puede llamarse `loadCustomStrategies` o `getCustomStrategies`; usar el real).
- El botón "Walk-Forward": abrir el componente `WalkForwardModal` con la misma prop-shape que `backtest-modal.tsx` usa en líneas 1304–1318 (`strategy`, `predefined`, `defaultSymbol`, `currentParams {…}` desde el config actual, `open`, `onClose`). En v1 se reusa el modal tal como está — visualmente sobre la página fullscreen, _no_ se reescribe inline (desviación menor del spec NOTADA en el commit message: "walk-forward reusado como modal sobre la página").
- La fila de métricas destacadas reutiliza los formatos existentes de `backtest.*` del modal (winRate, retorno, drawdown, profitFactor, trades, fees) — son las mismas keys que el modal usa hoy para el summary strip.
- Sin `useEffect` para derivar estado (regla react-hooks).

- [ ] **Step 3: Guardas i18n + checks**

```bash
bun run test src/lib/i18n*.test.ts 2>&1 | tail -3 && bun run typecheck && bun run lint
```

Expected: guardas GREEN (todas las `backtestUI.*` presentes en los 4 dicts), typecheck/lint limpio.

- [ ] **Step 4: Smoke live**

`http://localhost:3000/backtest` → tab Corrida: correr `trend_buy` sobre `BTCUSDT/4h/500`; equity curve pinta; tabla de trades numérica; click Guardar en BD → mensaje de confirmación. Confirmar en la BD: `sqlite3 db/custom.db 'SELECT id, symbol, strategyName, totalTrades FROM BacktestRun ORDER BY createdAt DESC LIMIT 3;'` (en el contenedor o local con DATABASE_URL absoluta) → 1 fila nueva.

- [ ] **Step 5: Commit**

```bash
git add src/components/panel/backtest/config-form.tsx src/components/panel/backtest/tab-run.tsx src/lib/i18n.ts
git commit -m "feat(backtest-ui): tab Corrida con guardado en BD y walk-forward reusado"
```

---

### Task 11: Tab Comparación — N estrategias con un config

**Files:**
- Create: `src/components/panel/backtest/tab-compare.tsx` (reemplaza stub)
- Modify: `src/lib/i18n.ts` (4 idiomas)

**Interfaces:**
- Consumes: `BacktestFormConfig`/`BacktestConfigForm` (variant `"compare"`, Task 10); `STRATEGY_LIST`; `loadCustomStrategies`; `buildComparisonRows` NO se importa en client — la route ya devuelve `rows` (Task 6). Tipos de la respuesta:

```tsx
type CompareEntry = {
  strategyId: string; strategyName: string; action: string; isCustom: boolean;
  error: string | null; result: import("@/lib/backtest").BacktestResult | null;
};
type ComparisonRow = {
  strategyId: string; strategyName: string; action: string; isCustom: boolean;
  error: string | null;
  summary: { totalTrades: number; winRatePct: number; totalReturnPct: number; maxDrawdownPct: number; profitFactor: number } | null;
  best: { winRate: boolean; totalReturn: boolean; maxDrawdown: boolean; profitFactor: boolean };
};
```

- Produces: guarda por estrategia en BD con `POST /api/backtest/runs` por entry (Task 7).

Keys i18n NUEVAS de esta tab (4 idiomas):
```
backtestUI.strategyPicker, backtestUI.selectAll, backtestUI.selectNone,
backtestUI.compareBtn, backtestUI.comparing, backtestUI.colStrategy,
backtestUI.colTrades, backtestUI.colWinRate, backtestUI.colReturn,
backtestUI.colDrawdown, backtestUI.colProfitFactor, backtestUI.bestMark,
backtestUI.expandRow, backtestUI.saveCompare, backtestUI.errorRow
```
(Verificar antes: si `backtest.winRate`/`backtest.return`/`backtest.drawdown`/`backtest.profitFactor` ya existen en i18n (el modal los usa en el summary strip) → REUSAR esos keys para las columnas y agregar solo `backtestUI.colStrategy`, `backtestUI.bestMark`, etc.)

- [ ] **Step 1: Implementar `tab-compare.tsx`**

```tsx
"use client";

import { useCallback, useState } from "react";
import { ChevronDown, Loader2, Play, Save } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { STRATEGY_LIST } from "@/lib/strategies";
import type { BacktestInterval } from "@/lib/backtest";
import { BacktestConfigForm, type BacktestFormConfig } from "./config-form";
import { EquityCurveCanvas } from "./equity-curve";
import { TradeTable } from "./trade-table";
```

Estado:
```tsx
const [config, setConfig] = useState<BacktestFormConfig>({ ...DEFAULT, strategyId: null, customStrategy: null });
const [selected, setSelected] = useState<Set<string>>(new Set(["trend_buy", "mean_reversion_buy"]));
const [customList, setCustomList] = useState<CustomStrategy[]>([]); // cargar con loadCustomStrategies al montar del builder
const [rows, setRows] = useState<ComparisonRow[] | null>(null);
const [entries, setEntries] = useState<Map<string, CompareEntry>>(new Map());
const [expanded, setExpanded] = useState<string | null>(null);
const [comparing, setComparing] = useState(false);
const [error, setError] = useState<string | null>(null);
```

`runCompare`:
```tsx
const runCompare = useCallback(async () => {
  if (selected.size === 0 && customList.length === 0) return;
  setComparing(true); setError(null); setRows(null); setExpanded(null);
  try {
    const res = await fetch("/api/backtest/compare", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: config.symbol, interval: config.interval, limit: config.candles,
        minConfidence: config.minConfidence, initialCapital: config.initialCapital,
        stopLossPct: config.stopLossPct, takeProfitPct: config.takeProfitPct,
        maxHoldCandles: config.maxHoldCandles, positionSizing: config.positionSizing,
        fixedFractionalPct: config.fixedFractionalPct, feeBps: config.feeBps,
        strategies: [
          ...[...selected],
          ...customList.map((c) => c), // CustomStrategy object via parseStrategyRefs
        ],
      }),
    });
    const json = (await res.json()) as { rows?: ComparisonRow[]; results?: CompareEntry[]; error?: string };
    if (json.error) { setError(json.error); return; }
    setRows(json.rows ?? []);
    setEntries(new Map((json.results ?? []).filter((e) => !e.error).map((e) => [e.strategyId, e])));
  } catch { setError(t("backtestUI.errorRow")); } finally { setComparing(false); }
}, [config, selected, customList, t]);
```

Tabla (desktop) — `overflow-x-auto` con `<table>`:
- `<th>`: estrategia | trades | winRate | retorno | drawdown | PF (con `backtest.*` existentes cuando aplique).
- Cada `<td>` de métrica: si `row.best[k]` → chip `bg-[#5FBF8F]/15 text-[#5FBF8F]` + `t("backtestUI.bestMark")` como `title` (y el valor en bold).
- Fila `row.summary === null` → el `row.error` en un `<td colSpan>` con icono `AlertTriangle` (buscar el import exacto que rayos `AlertTriangle` ya está usado en el repo — sí, en backtest-modal — reusar).
- Click en fila con summary → `setExpanded(row.strategyId === expanded ? null : row.strategyId)`; debajo renderiza el `EquityCurveCanvas` + `TradeTable` del `entries.get(row.strategyId)?.result`.
- Sección arriba: multiselección con checkboxes (una por estrategia predefinida `STRATEGY_LIST` + una por custom del builder), botones `selectAll`/`selectNone` que setean o vacían el Set. Contador visual `selected.size/7+customList.length`.
- Botón guardar comparación: por cada entry CON resultado → un POST `/api/backtest/runs` secuencial (mismo body shape del save de tab-run usando el `config` actual + `result` de la entry). Feedback con count guardado.

- [ ] **Step 2: Guardas + checks + smoke**

```bash
bun run test src/lib/i18n*.test.ts 2>&1 | tail -3 && bun run typecheck && bun run lint
```

Smoke: seleccionar 7 predefinidas, comparar sobre `BTCUSDT/4h/500` — el network tab: UN solo POST `/api/backtest/compare` (no 7 fetches) y el response `rows` con algunas `best` resaltadas; guardar comparación → 7 filas nuevas en BacktestRun (`SELECT COUNT(*) FROM BacktestRun WHERE interval='4h'`).

- [ ] **Step 3: Commit**

```bash
git add src/components/panel/backtest/tab-compare.tsx src/lib/i18n.ts
git commit -m "feat(backtest-ui): tab Comparación de estrategias con N runs server-shared klines"
```

---

### Task 12: Tab Historial — listado con filtros, detalle read-only, borrar/exportar

**Files:**
- Create: `src/components/panel/backtest/tab-history.tsx` (reemplaza stub)
- Modify: `src/lib/i18n.ts` (4 idiomas)

**Interfaces:**
- Consumes: `GET/DELETE /api/backtest/runs`, `GET /api/backtest/runs/[id]` (Task 7); `EquityCurveCanvas`, `TradeTable` (Task 8); `STRATEGY_LIST`.
- Produces: página de historial con detalle read-only inline (no modal nuevo — se reemplaza el contenido de la tab por el detalle y un botón volver).

Keys i18n NUEVAS (4 idiomas):
```
backtestUI.filterSymbol, backtestUI.filterStrategy, backtestUI.filterAll,
backtestUI.colDate, backtestUI.emptyHistory, backtestUI.backBtn,
backtestUI.deleteBtn, backtestUI.deletedMsg, backtestUI.exportBtn,
backtestUI.truncatedBadge, backtestUI.loadError, backtestUI.confirmDelete
```

- [ ] **Step 1: Implementar `tab-history.tsx`**

```tsx
"use client";

import { useCallback, useState } from "react";
import { ArrowLeft, Download, Loader2, Trash2 } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import type { BacktestResult } from "@/lib/backtest";
import { EquityCurveCanvas } from "./equity-curve";
import { TradeTable } from "./trade-table";

type RunSummaryRow = {
  id: string;
  createdAt: string;
  symbol: string;
  interval: string;
  candles: number;
  strategyId: string | null;
  strategyName: string;
  isCustom: boolean;
  totalTrades: number;
  winRatePct: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
};

type DetailPayload = {
  run: RunSummaryRow & { config: string };
  result: BacktestResult;
  truncation: { originalTrades: number; keptTrades: number } | null;
};
```

Comportamiento (estado: `filterSymbol`, `filterStrategyId`, `runs`, `detail`, `loading`, `error`):
- `loadList` con fetch `GET /api/backtest/runs?limit=50` pegando los filtros como query params SOLO si no están en "all". Se llama al montar (con estado de loading inicial `true`) y tras cada delete. NOTA react-hooks: al montar hay un fetch inicial — permisible aquí porque es estado de PEDIDO (no derivaciones de render); usar un `useEffect` con deps `[filterSymbol, filterStrategyId, reloadToken]` y un `reloadToken` manual para re-listar tras borrar (patrón ya usado en cross-history para refrescar bajo demanda).
- Tabla de listado: fecha (toLocaleString con try/catch), symbol+interval, estrategia (`strategyName` + chip `custom` si isCustom), trades, winRate, retorno, drawdown, acciones (detalle/borrar). Fila clickable → `loadDetail(row.id)`.
- `loadDetail`: fetch `GET /api/backtest/runs/[id]` → pantalla detalle: header con botón volver + badge `{truncation ? t("backtestUI.truncatedBadge").replace("{kept}", …).replace("{total}", …) : null}`, métricas destacadas (mismas de tab-run), `EquityCurveCanvas`, `TradeTable` (max-h-[60vh]).
- `deleteRun(id)`: **`confirm()` nativo del browser** con `t("backtestUI.confirmDelete")` (regla del repo: sin alerty toast custom) → si ok, `DELETE /api/backtest/runs/[id]` → clear detail y `setReloadToken(v => v+1)`. 404 → mensaje.
- `exportJson()` en la vista detalle: crea `Blob` con `{ run: detail.run, result: detail.result }` y descarga como `backtest-<symbol>-<strategyName>-<id>.json` (reusar el patrón de `export-snapshot.ts` si aplica — verificar export helpers; SI existe un helper de descarga reusarlo).
- Loading por estado con `<Loader2 className="animate-spin" />`; vacío → `t("backtestUI.emptyHistory")`; errores de API → banner `role="alert"` rojo con `t("backtestUI.loadError")` y el `error` del server si viene.

- [ ] **Step 2: Guardas + checks**

```bash
bun run test src/lib/i18n*.test.ts 2>&1 | tail -3 && bun run typecheck && bun run lint
```

Expected: todo verde.

- [ ] **Step 3: Smoke live**

Correr 2 corridas en la tab Corrida (símbolos diferentes), ir a Historial: lista ordenada desc, filtros cambian el resultado, click detalle pinta curva + trades, borrar con confirm y desaparece, exportar descarga JSON válido.

- [ ] **Step 4: Commit**

```bash
git add src/components/panel/backtest/tab-history.tsx src/lib/i18n.ts
git commit -m "feat(backtest-ui): tab Historial con filtros, detalle read-only, borrar y exportar"
```

---

### Task 13: Verificación final — suite completa + rebuild del stack + smoke acá

**Files:**
- Modify: nada código (si aparece un fix de última hora, ir en un commit `fix(backtest-ui):` aparte)

- [ ] **Step 1: Checks finales completos (Sobre todo el repo, no cache)**

```bash
bun run lint; echo "LINT_EXIT=$?"
bun run typecheck; echo "TSC_EXIT=$?"
bun run test 2>&1 | tail -4
```

Expected: lint 0/0, tsc exit 0, suite completa pass (344+ > 380 nuevos, imposible de saber sin contar exacto: registrar el conteo y reportar que NO se redujo la baseline).

- [ ] **Step 2: Rebuild del stack docker para smoke en :81**

```bash
docker compose build app 2>&1 | tail -5 && docker compose up -d 2>&1 | tail -5
sleep 20 && curl -s -o /dev/null -w '%{http_code}' http://localhost:81/backtest
```

Expected: `200`.

Nota: los mini-services no cambian (`websocket-security`, tick-stream, order-book intactos), pero el compose levanta todo — los 4 contenedores healthy es el gate.

- [ ] **Step 3: Smoke e2e en :81 (curl por Caddy, no por :3000)**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:81/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:81/backtest
curl -s -X POST http://localhost:81/api/backtest/compare -H 'Content-Type: application/json' \
  -d '{"symbol":"BTCUSDT","interval":"4h","limit":220,"strategies":["hold","trend_buy"]}' | head -c 300
```

Expected: 200, 200, `{"results":[…],"rows":[…]}`.

En el browser del user: `http://localhost:81/backtest` — probar correr, save, compare, historial.

- [ ] **Step 4: Commit (solo si hubo fix) + push a la rama**

```bash
git push -u origin feat/backtest-ui
```

(si no hubo fix, solo push -u). El PR se abre cuando el user lo pida (regla de sesión: no abrir PRs sin aviso).
