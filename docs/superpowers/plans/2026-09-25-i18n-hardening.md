# i18n Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar toda la deuda de i18n del dashboard (una clave que falta en francés y 18 literales hardcodeados en componentes) y dejar tres tests que impidan que vuelva a acumularse.

**Architecture:** Tres capas. (1) Un test de paridad que compara los 4 diccionarios entre sí. (2) Un test que valida que cada clave literal pasada a `t()` exista. (3) Un test que escanea los componentes buscando literales visibles, con una allowlist de tokens no traducibles y una lista `KNOWN_DEBT` que **debe encogerse** con cada fix (el test falla si aparece deuda nueva *o* si una entrada de la lista quedó obsoleta). Los fixes en sí son mecánicos: agregar la clave en los 4 idiomas (o reusar una existente) y reemplazar el literal por `t()`.

**Tech Stack:** TypeScript 5 strict, React 19, Vitest 4 (entorno `node`), Next.js 16 App Router. Sin dependencias nuevas.

**Spec:** No hay un spec separado: la fuente de verdad es el **inventario de la sección Context**, producido por una auditoría ejecutada contra el repo (no por lectura). Complementa las reglas de i18n de `AGENTS.md` (sección 5).

## Global Constraints

- 4 idiomas: `es` (default), `en`, `zh`, `fr`. Cadena de fallback: idioma → español → la clave misma.
- **NUNCA** hardcodear strings visibles al usuario. Todo texto visible, incluidos `aria-label`, `title`, `placeholder` y `alt`, sale de `t()` de `useLanguage()`.
- Valores dinámicos: `{placeholder}` en el diccionario + `.replace()` en el componente. Nunca concatenar fragmentos traducidos.
- Al agregar una clave, se agrega en **los 4 diccionarios** en el mismo commit (el test de paridad lo exige).
- Tests en `src/lib/*.test.ts` (co-locados). **Nunca** en `src/app/`.
- Imports con alias `@/` para `src/lib`, `src/hooks`, `src/components`.
- Los conteos de tests no bajan: hoy **278 pasan**. Este plan los sube.
- Antes de cada commit: `bun run lint` (0 errores, 0 warnings) y `bun run typecheck` (limpio) y `bun run test` (todo verde).
- Commits: Conventional Commits (`test(i18n):`, `fix(i18n):`, `refactor(i18n):`).
- `es` es el diccionario de referencia para los tests (es el que tiene fallback a sí mismo).
- No tocar `src/components/ui/*` en este plan (ver *Additional findings*).

---

## Context

### Inventario (auditoría ejecutada, no leída)

Script temporal que cruzó los 4 diccionarios contra los 138 archivos `src/**/*.{ts,tsx}`. Resultados:

| Clase | Cantidad | Detalle |
|---|---|---|
| Claves que faltan en algún idioma | **3** | `card.stateAlcista`, `card.stateBajista`, `card.stateComprimido` — **faltan en `fr`** |
| Claves usadas que no existen | **0** | ninguna clave mal escrita |
| Claves definidas y no referenciadas | **0** | las 472 claves se usan (contando las que viven en mapas) |
| Strings hardcodeadas en componentes de la app | **14** | ver tabla abajo |
| Strings hardcodeadas que el regex NO ve | **4** | `macd-panel` ×2 banners, `rsi-gauge` ×1 zona (3 etiquetas), `scatter-plot-modal` ×1 |
| Primitivos de shadcn sin importar | **46 / 48** | código muerto, fuera de alcance |

**Impacto real de las 3 claves de `fr`:** un usuario francés ve el estado EMA en español (`Alcista`/`Bajista`/`Comprimido`) porque el fallback cae a `es`.

### Los 14 literales que el detector puede ver

| Archivo | Línea | Literal |
|---|---|---|
| `src/app/page.tsx` | 407 | `aria-label="Actualizar ahora los datos del panel"` |
| `src/app/page.tsx` | 432 | `title="Exportar análisis actual como JSON"` |
| `src/app/page.tsx` | 472 | `title="Atajos: R=refrescar, C=colapsar todo, E=expandir todo, ?=ayuda"` |
| `src/components/panel/sparkline.tsx` | 298 | `aria-label="Mini gráfico sparkline de precio con EMA55 y EMA200 superpuestas"` |
| `src/components/panel/price-alerts-button.tsx` | 104 | `aria-label="Cerrar"` |
| `src/components/panel/price-alerts-button.tsx` | 216 | `aria-label="Eliminar alerta"` |
| `src/components/panel/keyboard-help-modal.tsx` | 87 | `aria-label="Cerrar"` |
| `src/components/panel/scatter-plot-modal.tsx` | 238 | `aria-label="Cerrar"` |
| `src/components/panel/strategy-consensus.tsx` | 91 | texto `Neutral` (eje de la barra de score) |
| `src/components/panel/strategy-consensus.tsx` | 92 | texto `Buy` (eje de la barra de score) |
| `src/components/panel/correlation-matrix.tsx` | 170 | `aria-label="Número de velas"` |
| `src/components/panel/stop-loss-selector.tsx` | 87 | `aria-label="Multiplicador ATR del stop loss"` |
| `src/components/panel/language-selector.tsx` | 39 | `aria-label="Select language"` (¡en inglés!) |
| `src/components/panel/range-bar.tsx` | 214 | `title="rango S/R"` |

### Los 3 literales invisibles al regex (los encontré leyendo)

| Archivo | Línea | Literal |
|---|---|---|
| `src/components/panel/macd-panel.tsx` | 89-90 | `Cruce MACD {alcista\|bajista} · hace {n} vela(s)` |
| `src/components/panel/macd-panel.tsx` | 106-107 | `Giro momentum {alcista\|bajista} · hace {n} vela(s)` |
| `src/components/panel/rsi-gauge.tsx` | 48-52 | `Sobrecomprado` / `Sobrevendido` / `Neutral` |
| `src/components/panel/scatter-plot-modal.tsx` | 231 | `Scatter de returns · {interval} · {limit} velas` |

### Claves que YA existen y hay que reusar (no crear)

| Reusar | En vez de |
|---|---|
| `common.close` (`Cerrar`/`Close`/`关闭`/`Fermer`) | los 3 `aria-label="Cerrar"` |
| `strategy.buyLabel` (`Buy`) | el texto `Buy` del eje en `strategy-consensus` |
| `common.neutral` (`Neutral`/`Neutral`/`中性`/`Neutre`) | el texto `Neutral` del eje en `strategy-consensus` **y** la zona neutral del RSI |

Las tres existen en los 4 idiomas (verificado con `grep -c "\"<clave\":" src/lib/i18n.ts` → 4). `common.neutral` ya se usa en `ticker-detail-modal.tsx:356`.

### Falsos positivos (documentar en la allowlist del detector, NO tocar)

- `src/lib/backtest.ts:484,760` — `t.pnl` es el parámetro de un arrow `(t) => t.pnl`, no una llamada a `t()`.
- `src/lib/providers/router.ts:30` — `"Promise"` es un tipo de TypeScript.
- `src/hooks/use-tick-stream.ts:198` — `"Record"` es un tipo de TypeScript.
- `src/components/panel/sparkline.tsx:188` — `// Cloud color: green when A > B, red when A < B.` es un **comentario** (el detector debe ignorar líneas que empiezan con `//` o `*`).

---

## File Structure

**Nuevos**
- `src/lib/i18n.test.ts` — paridad de los 4 diccionarios + valores vacíos.
- `src/lib/i18n-usage.test.ts` — cada clave literal pasada a `t()` existe en `es`.
- `src/lib/i18n-hardcoded.test.ts` — detector de literales visibles con allowlist + `KNOWN_DEBT`.

**Modificados**
- `src/lib/i18n.ts` — 16 claves nuevas × 4 idiomas + las 3 de `fr` que faltan.
- `src/app/page.tsx` — 3 atributos.
- `src/components/panel/sparkline.tsx`, `price-alerts-button.tsx`, `keyboard-help-modal.tsx`, `scatter-plot-modal.tsx`, `strategy-consensus.tsx`, `correlation-matrix.tsx`, `stop-loss-selector.tsx`, `language-selector.tsx`, `range-bar.tsx`, `macd-panel.tsx`, `rsi-gauge.tsx` — reemplazar literales por `t()`.

**Por qué los 3 tests van en archivos separados y no en uno:** cada uno falla por una causa distinta y se puede rechazar por separado (paridad vs clave mal escrita vs literal nuevo). Un solo `i18n.test.ts` con 3 describes también sería válido, pero separarlos deja el mensaje de fallo inequívoco en CI.

---

### Task 1: Paridad de diccionarios + las 3 claves que faltan en francés

**Files:**
- Create: `src/lib/i18n.test.ts`
- Modify: `src/lib/i18n.ts` (bloque `fr`, después de `"card.stateComprimido"` de `es`… ver paso 3)

**Interfaces:**
- Consumes: `dictionaries: Record<Lang, Dict>` y `LANGUAGES` de `@/lib/i18n` (ya existen, no cambiar su firma).
- Produces: nada que otras tasks importen.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/lib/i18n.test.ts
import { describe, expect, it } from "vitest";
import { LANGUAGES, dictionaries } from "@/lib/i18n";

describe("i18n dictionaries", () => {
  const esKeys = Object.keys(dictionaries.es).sort();

  it("has the exact same key set in all 4 languages", () => {
    for (const { code } of LANGUAGES) {
      const keys = Object.keys(dictionaries[code]).sort();
      const missing = esKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !esKeys.includes(k));
      // Comparing the objects makes the failure message name the keys.
      expect({ lang: code, missing, extra }).toEqual({
        lang: code,
        missing: [],
        extra: [],
      });
    }
  });

  it("has no blank translation", () => {
    for (const { code } of LANGUAGES) {
      for (const [key, value] of Object.entries(dictionaries[code])) {
        expect(value.trim(), `${code} / ${key}`).not.toBe("");
      }
    }
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bun run test src/lib/i18n.test.ts`
Expected: FAIL en `has the exact same key set…` con `missing: ["card.stateAlcista", "card.stateBajista", "card.stateComprimido"]` para `lang: "fr"`.

- [ ] **Step 3: Agregar las 3 claves a `fr`**

En `src/lib/i18n.ts`, dentro del diccionario `fr` (el cuarto bloque `const fr: Dict = {`), insertar **inmediatamente después** de la línea `"card.change24h": "24h",` de ese diccionario (ancla verificada: existe en los 4 diccionarios):

```typescript
  "card.stateAlcista": "Haussier",
  "card.stateBajista": "Baissier",
  "card.stateComprimido": "Comprimé",
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bun run test src/lib/i18n.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verificación completa + commit**

```bash
bun run lint && bun run typecheck && bun run test
git add src/lib/i18n.test.ts src/lib/i18n.ts
git commit -m "test(i18n): exigir paridad de claves entre los 4 diccionarios y completar las 3 de fr"
```

---

### Task 2: Guard de claves literales pasadas a `t()`

**Files:**
- Create: `src/lib/i18n-usage.test.ts`

**Interfaces:**
- Consumes: `dictionaries` de `@/lib/i18n`.
- Produces: nada.

- [ ] **Step 1: Escribir el test**

Este test debe pasar de entrada (hoy hay 0 claves rotas): su valor es evitar que un typo futuro renderice la clave cruda en pantalla.

```typescript
// src/lib/i18n-usage.test.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dictionaries } from "@/lib/i18n";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(path)) out.push(path);
  }
  return out;
}

describe("t() usages", () => {
  it("only uses literal keys that exist in the Spanish dictionary", () => {
    const known = new Set(Object.keys(dictionaries.es));
    const missing: string[] = [];
    for (const file of walk("src")) {
      if (file.endsWith("i18n.ts")) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bt\(\s*"([^"]+)"\s*\)/g)) {
        if (!known.has(match[1])) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test**

Run: `bun run test src/lib/i18n-usage.test.ts`
Expected: PASS. Si falla, el mensaje lista `archivo: clave` y hay que corregir esa clave (o definirla en `es`).

- [ ] **Step 3: Verificación completa + commit**

```bash
bun run lint && bun run typecheck && bun run test
git add src/lib/i18n-usage.test.ts
git commit -m "test(i18n): fallar cuando una clave literal de t() no existe"
```

---

### Task 3: Detector de literales visibles (con deuda conocida explícita)

**Files:**
- Create: `src/lib/i18n-hardcoded.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `KNOWN_DEBT` — las tasks 4 y 5 **eliminan entradas** de este array. El test compara por igualdad, así que una entrada obsoleta también lo hace fallar.

- [ ] **Step 1: Escribir el test con la deuda conocida cargada**

```typescript
// src/lib/i18n-hardcoded.test.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Strings visible to users that are NOT translatable and therefore fine:
 * acronyms, numbers, units, and the technical labels of the indicators.
 */
const ALLOWED = [
  /^[A-Z0-9 ·./%+$:-]+$/, // MACD, RSI, 24H, N/D, USD…
  /^[—·|/]+$/,
];

/**
 * Hardcoded strings we know about. This list MUST shrink: the assertion below
 * compares by equality, so a stale entry fails the test too.
 * Each entry is "<file> :: <literal>".
 */
const KNOWN_DEBT: string[] = [
  "src/app/page.tsx :: Actualizar ahora los datos del panel",
  "src/app/page.tsx :: Exportar análisis actual como JSON",
  "src/app/page.tsx :: Atajos: R=refrescar, C=colapsar todo, E=expandir todo, ?=ayuda",
  "src/components/panel/sparkline.tsx :: Mini gráfico sparkline de precio con EMA55 y EMA200 superpuestas",
  "src/components/panel/price-alerts-button.tsx :: Cerrar",
  "src/components/panel/price-alerts-button.tsx :: Eliminar alerta",
  "src/components/panel/keyboard-help-modal.tsx :: Cerrar",
  "src/components/panel/scatter-plot-modal.tsx :: Cerrar",
  "src/components/panel/strategy-consensus.tsx :: Neutral",
  "src/components/panel/strategy-consensus.tsx :: Buy",
  "src/components/panel/correlation-matrix.tsx :: Número de velas",
  "src/components/panel/stop-loss-selector.tsx :: Multiplicador ATR del stop loss",
  "src/components/panel/language-selector.tsx :: Select language",
  "src/components/panel/range-bar.tsx :: rango S/R",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx$/.test(path)) out.push(path);
  }
  return out;
}

/** Attribute values and single-line JSX text, skipping translated lines. */
function findLiterals(file: string): string[] {
  const found: string[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
    if (/\bt\(/.test(line)) continue; // already translated on this line
    for (const m of line.matchAll(/(?:aria-label|title|placeholder|alt)=\{?\s*"([^"]{3,})"/g))
      found.push(m[1]);
    for (const m of line.matchAll(/>\s*([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ ,.'·%()/-]{2,})\s*</g))
      found.push(m[1].trim());
  }
  return found;
}

describe("hardcoded user-visible strings", () => {
  it("has no literal outside the known-debt list", () => {
    const files = walk("src/components/panel").concat([
      "src/app/page.tsx",
      "src/app/comparar/page.tsx",
      "src/app/status/page.tsx",
    ]);
    const found: string[] = [];
    for (const file of files) {
      for (const literal of findLiterals(file)) {
        if (ALLOWED.some((re) => re.test(literal))) continue;
        found.push(`${file} :: ${literal}`);
      }
    }
    // Equality (not subset) so BOTH new debt and stale entries fail.
    expect([...new Set(found)].sort()).toEqual([...KNOWN_DEBT].sort());
  });
});
```

- [ ] **Step 2: Correr el test y ajustar la lista hasta que pase**

Run: `bun run test src/lib/i18n-hardcoded.test.ts`
Expected: PASS. **Si falla**, el diff muestra qué literales sobran o faltan: agregar los que falten a `KNOWN_DEBT` (son deuda real que las tasks 4-6 van a borrar) y **quitar** los que el detector no ve (por ejemplo el texto multilínea de `scatter-plot-modal.tsx:231`, que se arregla en Task 6 aunque el detector no lo liste). No relajar `ALLOWED` para que pase.

- [ ] **Step 3: Verificación completa + commit**

```bash
bun run lint && bun run typecheck && bun run test
git add src/lib/i18n-hardcoded.test.ts
git commit -m "test(i18n): detector de literales visibles con deuda conocida explicita"
```

---

### Task 4: `page.tsx` — los 3 atributos del header

**Files:**
- Modify: `src/lib/i18n.ts` (4 diccionarios)
- Modify: `src/app/page.tsx:407,432,472`
- Modify: `src/lib/i18n-hardcoded.test.ts` (borrar 3 entradas de `KNOWN_DEBT`)

**Interfaces:**
- Produces (claves i18n nuevas, usadas sólo acá): `header.refreshAria`, `header.exportAria`, `header.shortcutsAria`.

- [ ] **Step 1: Agregar las 3 claves a los 4 diccionarios**

Ancla: la línea `"header.shortcuts": …` de cada diccionario (existe en los 4). Insertar **inmediatamente después** en cada uno:

```typescript
// es
  "header.refreshAria": "Actualizar ahora los datos del panel",
  "header.exportAria": "Exportar análisis actual como JSON",
  "header.shortcutsAria": "Atajos: R=refrescar, C=colapsar todo, E=expandir todo, ?=ayuda",
// en
  "header.refreshAria": "Refresh the panel data now",
  "header.exportAria": "Export the current analysis as JSON",
  "header.shortcutsAria": "Shortcuts: R=refresh, C=collapse all, E=expand all, ?=help",
// zh
  "header.refreshAria": "立即刷新面板数据",
  "header.exportAria": "将当前分析导出为 JSON",
  "header.shortcutsAria": "快捷键：R=刷新，C=全部折叠，E=全部展开，?=帮助",
// fr
  "header.refreshAria": "Actualiser maintenant les données du panneau",
  "header.exportAria": "Exporter l'analyse actuelle en JSON",
  "header.shortcutsAria": "Raccourcis : R=actualiser, C=tout réduire, E=tout développer, ?=aide",
```

- [ ] **Step 2: Reemplazar los literales en `page.tsx`**

```tsx
// L407 — antes
aria-label="Actualizar ahora los datos del panel"
// después
aria-label={t("header.refreshAria")}

// L432 — antes
title="Exportar análisis actual como JSON"
// después
title={t("header.exportAria")}

// L472 — antes
title="Atajos: R=refrescar, C=colapsar todo, E=expandir todo, ?=ayuda"
// después
title={t("header.shortcutsAria")}
```

- [ ] **Step 3: Borrar las 3 entradas de `KNOWN_DEBT`**

En `src/lib/i18n-hardcoded.test.ts`, eliminar estas tres líneas del array:

```typescript
  "src/app/page.tsx :: Actualizar ahora los datos del panel",
  "src/app/page.tsx :: Exportar análisis actual como JSON",
  "src/app/page.tsx :: Atajos: R=refrescar, C=colapsar todo, E=expandir todo, ?=ayuda",
```

- [ ] **Step 4: Verificar**

Run: `bun run test src/lib/i18n-hardcoded.test.ts src/lib/i18n.test.ts`
Expected: PASS ambos. El detector falla si el literal quedó (deuda nueva) o si `KNOWN_DEBT` conserva una entrada ya arreglada.

- [ ] **Step 5: Verificación completa + commit**

```bash
bun run lint && bun run typecheck && bun run test
git add src/lib/i18n.ts src/app/page.tsx src/lib/i18n-hardcoded.test.ts
git commit -m "fix(i18n): traducir los aria-label y title del header"
```

---

### Task 5: Los 11 literales restantes de los componentes (reusando claves existentes donde se puede)

**Files:**
- Modify: `src/lib/i18n.ts` (4 diccionarios, 6 claves nuevas)
- Modify: `src/components/panel/sparkline.tsx:298`, `price-alerts-button.tsx:104,216`, `keyboard-help-modal.tsx:87`, `scatter-plot-modal.tsx:238`, `strategy-consensus.tsx:91,92`, `correlation-matrix.tsx:170`, `stop-loss-selector.tsx:87`, `language-selector.tsx:39`, `range-bar.tsx:214`
- Modify: `src/lib/i18n-hardcoded.test.ts` (borrar 11 entradas)

**Interfaces:**
- Consumes: `common.close` (ya existe, ×4) y `strategy.buyLabel` (ya existe, ×4) — **no** crear equivalentes.
- Produces: `sparkline.ariaLabel`, `alerts.deleteAria`, `correlation.limitAria`, `stopLoss.multiplierAria`, `header.languageAria`, `rangeBar.ariaLabel`.

- [ ] **Step 1: Agregar las 6 claves nuevas a los 4 diccionarios**

Anclas por clave (todas existen en los 4 diccionarios):
`sparkline.ariaLabel` y `rangeBar.ariaLabel` → después de `"card.rangeTitle"`; `alerts.deleteAria` → después de `"alerts.title"`; `correlation.limitAria` → después de `"overview.correlation"`; `stopLoss.multiplierAria` → después de `"card.atrHint"`; `header.languageAria` → después de `"header.shortcuts"`.

```typescript
// es
  "sparkline.ariaLabel": "Mini gráfico sparkline de precio con EMA55 y EMA200 superpuestas",
  "rangeBar.ariaLabel": "Rango soporte/resistencia",
  "alerts.deleteAria": "Eliminar alerta",
  "correlation.limitAria": "Número de velas",
  "stopLoss.multiplierAria": "Multiplicador ATR del stop loss",
  "header.languageAria": "Seleccionar idioma",
// en
  "sparkline.ariaLabel": "Sparkline chart of price with EMA55 and EMA200 overlaid",
  "rangeBar.ariaLabel": "Support/resistance range",
  "alerts.deleteAria": "Delete alert",
  "correlation.limitAria": "Number of candles",
  "stopLoss.multiplierAria": "Stop-loss ATR multiplier",
  "header.languageAria": "Select language",
// zh
  "sparkline.ariaLabel": "价格迷你走势图，叠加 EMA55 和 EMA200",
  "rangeBar.ariaLabel": "支撑/阻力区间",
  "alerts.deleteAria": "删除提醒",
  "correlation.limitAria": "K线数量",
  "stopLoss.multiplierAria": "止损 ATR 倍数",
  "header.languageAria": "选择语言",
// fr
  "sparkline.ariaLabel": "Mini-graphique sparkline du prix avec EMA55 et EMA200 superposées",
  "rangeBar.ariaLabel": "Plage support/résistance",
  "alerts.deleteAria": "Supprimer l'alerte",
  "correlation.limitAria": "Nombre de bougies",
  "stopLoss.multiplierAria": "Multiplicateur ATR du stop-loss",
  "header.languageAria": "Choisir la langue",
```

- [ ] **Step 2: Reemplazar los 11 literales**

```tsx
// sparkline.tsx:298
aria-label={t("sparkline.ariaLabel")}
// range-bar.tsx:214
title={t("rangeBar.ariaLabel")}
// price-alerts-button.tsx:104  → REUSAR la clave existente
aria-label={t("common.close")}
// price-alerts-button.tsx:216
aria-label={t("alerts.deleteAria")}
// keyboard-help-modal.tsx:87
aria-label={t("common.close")}
// scatter-plot-modal.tsx:238
aria-label={t("common.close")}
// strategy-consensus.tsx:91-92 (texto del eje de la barra de score)
<span>{t("common.neutral")}</span>   // ya existe, se reusa
<span>{t("strategy.buyLabel")}</span>
// correlation-matrix.tsx:170
aria-label={t("correlation.limitAria")}
// stop-loss-selector.tsx:87
aria-label={t("stopLoss.multiplierAria")}
// language-selector.tsx:39
aria-label={t("header.languageAria")}
```

- [ ] **Step 3: Agregar el `useLanguage` que falte**

`sparkline.tsx`, `range-bar.tsx` ya lo tienen (se agregó en el PR #34). Verificar con `grep -c useLanguage <archivo>`; si alguno de los 11 archivos no lo tiene, agregar:

```tsx
import { useLanguage } from "@/hooks/use-language";
// dentro del componente:
const { t } = useLanguage();
```

- [ ] **Step 4: Borrar las 11 entradas de `KNOWN_DEBT`**

Eliminar del array todas las entradas de `page.tsx`… **no**: las de `page.tsx` ya se borraron en Task 4. Borrar sólo las 11 que quedan (sparkline, price-alerts ×2, keyboard-help, scatter-plot, strategy-consensus ×2, correlation-matrix, stop-loss, language-selector, range-bar).

- [ ] **Step 5: Verificar**

Run: `bun run test src/lib/i18n-hardcoded.test.ts src/lib/i18n.test.ts src/lib/i18n-usage.test.ts`
Expected: PASS los tres.

- [ ] **Step 6: Verificación completa + commit**

```bash
bun run lint && bun run typecheck && bun run test
git add src/lib/i18n.ts src/components/panel src/lib/i18n-hardcoded.test.ts
git commit -m "fix(i18n): traducir los literales visibles de los componentes del panel"
```

---

### Task 6: Los 4 literales que el detector no ve (MACD, RSI, scatter)

**Files:**
- Modify: `src/lib/i18n.ts` (4 diccionarios: 4 claves `macd.*`, 2 `rsi.*`, 1 `scatter.title`)
- Modify: `src/components/panel/macd-panel.tsx:89-90,106-107`
- Modify: `src/components/panel/rsi-gauge.tsx:48-52`
- Modify: `src/components/panel/scatter-plot-modal.tsx:231`

**Interfaces:**
- Consumes: `common.neutral` (ya existe ×4, verificada en Context → *Claves que YA existen*).
- Produces: `macd.crossBull`, `macd.crossBear`, `macd.momentumBull`, `macd.momentumBear`, `rsi.overbought`, `rsi.oversold`, `scatter.title`.

- [ ] **Step 1: Agregar las 7 claves a los 4 diccionarios**

Anclas: `macd.*` → después de `"card.macd"`; `rsi.*` → después de `"card.rsi"`; `scatter.title` → después de `"overview.correlation"`. (Las tres anclas existen en los 4 diccionarios.)

```typescript
// es
  "macd.crossBull": "Cruce MACD alcista · hace {n} vela(s)",
  "macd.crossBear": "Cruce MACD bajista · hace {n} vela(s)",
  "macd.momentumBull": "Giro momentum alcista · hace {n} vela(s)",
  "macd.momentumBear": "Giro momentum bajista · hace {n} vela(s)",
  "rsi.overbought": "Sobrecomprado",
  "rsi.oversold": "Sobrevendido",
  "scatter.title": "Scatter de returns · {interval} · {limit} velas",
// en
  "macd.crossBull": "Bullish MACD cross · {n} candle(s) ago",
  "macd.crossBear": "Bearish MACD cross · {n} candle(s) ago",
  "macd.momentumBull": "Bullish momentum flip · {n} candle(s) ago",
  "macd.momentumBear": "Bearish momentum flip · {n} candle(s) ago",
  "rsi.overbought": "Overbought",
  "rsi.oversold": "Oversold",
  "scatter.title": "Returns scatter · {interval} · {limit} candles",
// zh
  "macd.crossBull": "MACD 看涨交叉 · {n} 根K线前",
  "macd.crossBear": "MACD 看跌交叉 · {n} 根K线前",
  "macd.momentumBull": "动能转多 · {n} 根K线前",
  "macd.momentumBear": "动能转空 · {n} 根K线前",
  "rsi.overbought": "超买",
  "rsi.oversold": "超卖",
  "scatter.title": "收益率散点图 · {interval} · {limit} 根K线",
// fr
  "macd.crossBull": "Croisement MACD haussier · il y a {n} bougie(s)",
  "macd.crossBear": "Croisement MACD baissier · il y a {n} bougie(s)",
  "macd.momentumBull": "Retournement de momentum haussier · il y a {n} bougie(s)",
  "macd.momentumBear": "Retournement de momentum baissier · il y a {n} bougie(s)",
  "rsi.overbought": "Suracheté",
  "rsi.oversold": "Survendu",
  "scatter.title": "Nuage de rendements · {interval} · {limit} bougies",
```

- [ ] **Step 2: `macd-panel.tsx` — los dos banners**

```tsx
// L88-91 — antes
<Zap className="h-3 w-3 animate-pulse" aria-hidden />
Cruce MACD {macdCross.direction === "bullish" ? "alcista" : "bajista"} · hace{" "}
{macdCross.candles_since_cross} vela(s)
// después
<Zap className="h-3 w-3 animate-pulse" aria-hidden />
{t(macdCross.direction === "bullish" ? "macd.crossBull" : "macd.crossBear").replace(
  "{n}",
  String(macdCross.candles_since_cross ?? 0),
)}

// L105-107 — antes
<Zap className="h-2.5 w-2.5" aria-hidden />
Giro momentum {macdCross.momentum_flip_direction === "bullish" ? "alcista" : "bajista"} · hace{" "}
{macdCross.candles_since_flip} vela(s)
// después
<Zap className="h-2.5 w-2.5" aria-hidden />
{t(
  macdCross.momentum_flip_direction === "bullish"
    ? "macd.momentumBull"
    : "macd.momentumBear",
).replace("{n}", String(macdCross.candles_since_flip ?? 0))}
```

- [ ] **Step 3: `rsi-gauge.tsx` — las 3 etiquetas de zona**

```tsx
// antes
const label =
  zone === "overbought"
    ? "Sobrecomprado"
    : zone === "oversold"
      ? "Sobrevendido"
      : "Neutral";
// después
const label =
  zone === "overbought"
    ? t("rsi.overbought")
    : zone === "oversold"
      ? t("rsi.oversold")
      : t("common.neutral");
```

- [ ] **Step 4: `scatter-plot-modal.tsx:231`**

```tsx
// antes
Scatter de returns · {interval} · {limit} velas
// después
{t("scatter.title").replace("{interval}", interval).replace("{limit}", String(limit))}
```

- [ ] **Step 5: Verificar los `{n}` / `{interval}` / `{limit}` resueltos**

Run:
```bash
grep -rn 'replace("{n}"' src/components/panel/macd-panel.tsx
grep -rn 'replace("{interval}"' src/components/panel/scatter-plot-modal.tsx
```
Expected: una coincidencia cada uno (si falta, el usuario ve el literal `{n}`).

- [ ] **Step 6: Verificación completa + commit**

```bash
bun run lint && bun run typecheck && bun run test
git add src/lib/i18n.ts src/components/panel
git commit -m "fix(i18n): traducir los banners del MACD, las zonas del RSI y el titulo del scatter"
```

---

### Task 7: Cierre — la deuda conocida queda vacía

**Files:**
- Modify: `src/lib/i18n-hardcoded.test.ts`

**Interfaces:**
- Consumes: `KNOWN_DEBT` de la Task 3.
- Produces: nada.

- [ ] **Step 1: Vaciar `KNOWN_DEBT` y endurecer el test**

Reemplazar el array por uno vacío y agregar la aserción que deja la intención explícita:

```typescript
const KNOWN_DEBT: string[] = []; // vacío a propósito: no se acepta deuda nueva
```

- [ ] **Step 2: Correr el test**

Run: `bun run test src/lib/i18n-hardcoded.test.ts`
Expected: PASS con `found === []`. Si falla, quedó un literal sin traducir: el mensaje dice cuál.

- [ ] **Step 3: Verificación completa + commit**

```bash
bun run lint && bun run typecheck && bun run test
git add src/lib/i18n-hardcoded.test.ts
git commit -m "test(i18n): la lista de deuda hardcodeada queda vacia"
```

---

## Additional findings (fuera de alcance de este plan)

**46 de los 48 primitivos de `src/components/ui/*` no se importan en ningún lado.** Verificado cruzando todos los imports de `src/**` contra el contenido de la carpeta. Los únicos usados son `sonner` y `toast`; el resto (`sidebar`, `carousel`, `pagination`, `breadcrumb`, `dialog`, `sheet`, `form`, `chart`, …) es andamiaje de shadcn que quedó del scaffold. Además son la mayor fuente de literales hardcodeados del repo (en inglés), que este plan excluye a propósito.

Recomendación: un plan aparte de borrado de código muerto. **No** mezclarlo con i18n: son 46 archivos y el riesgo de borrar algo que se iba a usar es una decisión de producto, no de traducción.

**`scatter-plot-modal.tsx` no se renderiza en ningún lado** (verificado por grep). Se traduce igual (Task 6) porque es barato, pero si se decide borrarlo, la Task 6 pierde su Step 4.

**`backtest.close` es un duplicado de `common.close`** (mismo valor, 4 idiomas). Candidato a unificar en el plan de limpieza.

---

## Self-Review

**1. Cobertura del inventario:**

| Hallazgo del inventario | Task |
|---|---|
| 3 claves faltantes en `fr` | Task 1 |
| 0 claves rotas | Task 2 (guard para que siga siendo 0) |
| 14 literales visibles por el regex | Tasks 4 (3) + 5 (11) |
| 4 literales invisibles al regex | Task 6 |
| Falsos positivos (tipos, comentarios, arrow params) | documentados en Context; el detector los ignora por diseño (salta comentarios y líneas con `t(`) |
| 46 primitivos shadcn muertos | Additional findings (fuera de alcance, con recomendación) |
| `scatter-plot-modal` no renderizado | Additional findings |
| `backtest.close` duplicado | Additional findings |

**2. Placeholder scan:** sin TBD/TODO. Todos los steps con código tienen el código. Las traducciones están escritas en los 4 idiomas, no descritas.

**3. Consistencia de nombres:** las 16 claves nuevas se declaran una sola vez y se usan con el mismo string en el paso que las consume: `header.refreshAria`, `header.exportAria`, `header.shortcutsAria`, `header.languageAria`, `sparkline.ariaLabel`, `rangeBar.ariaLabel`, `alerts.deleteAria`, `correlation.limitAria`, `stopLoss.multiplierAria`, `macd.crossBull`, `macd.crossBear`, `macd.momentumBull`, `macd.momentumBear`, `rsi.overbought`, `rsi.oversold`, `scatter.title`. Las reusadas (`common.close`, `strategy.buyLabel`, `common.neutral`) existen en los 4 idiomas y no se redefinen.

**4. Riesgo conocido:** el detector de la Task 3 es heurístico. El Step 2 de esa task dice explícitamente que si el diff no coincide hay que ajustar `KNOWN_DEBT` (no relajar `ALLOWED`), y la Task 6 cubre los casos que el regex no puede ver. Un detector perfecto requeriría un parser de JSX; para 4 idiomas y un puñado de componentes, la heurística + el inventario revisado a mano es suficiente y no agrega dependencias.
