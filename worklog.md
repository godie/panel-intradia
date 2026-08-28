# Worklog — Panel Cuantitativo // Intradía

## Project Status (as of initial delivery)

**Estado:** Funcional y verificado end-to-end con agent-browser + VLM.

El proyecto es un panel cuantitativo cripto en vivo (BTC/USD, ETH/USD, XRP/USD)
con análisis técnico intradía. El prompt original pedía **backend en PHP**, pero
el entorno sandbox solo expone el puerto 3000 vía Next.js (no se puede servir
PHP externamente). Por ello se implementó **toda la lógica de backend en una
API Route de Next.js** (`/api/analysis`) que respeta **exactamente** el mismo
contrato JSON, caché de 60s, manejo de errores 502 y separación de funciones
(`fetchKlines`, `fetchTicker24h`, `calculateEMA`, `findSupportResistance`,
`buildStructureText`) que pedía el spec de PHP. El frontend consume solo el
JSON ya calculado, tal como exigía el requisito no funcional.

## Architecture

```
src/
  app/
    api/analysis/route.ts   — GET /api/analysis?symbol=BTCUSDT (cache 60s, 502 on error)
    page.tsx                — dashboard (fetch paralelo 3 símbolos, refresco 60s + botón manual)
    layout.tsx              — fuentes Inter + JetBrains Mono, tema oscuro forzado
    globals.css             — paleta trading-terminal (#0A0D12), animaciones ticker/live-dot
  lib/
    binance.ts              — fetchKlines + fetchTicker24h (timeout 5s, AbortController, errores tipados)
    indicators.ts           — calculateEMA (SMA seed + recurrencia k=2/(N+1)), findSupportResistance (pivotes ±3, lookback 80), determineCrossState (COMPRIMIDO <0.15%)
    structure.ts            — buildStructureText en español (posición vs medias, % distancia, gatillo invalidación)
    cache.ts                — caché en memoria TTL 60s por símbolo (Map)
    types.ts                — AnalysisResponse + SYMBOL_META compartidos API/frontend
  components/panel/
    asset-card.tsx          — tarjeta por activo (badge estado, precio spot, sparkline, filas EMA/S/R, estructura)
    sparkline.tsx           — canvas HiDPI con precio + EMA55 (ámbar) + EMA200 (azul dashed) + area fill por estado
    ticker-tape.tsx         — marquee scroll continuo con 3 precios + cambio 24h (loop duplicado sin costura)
```

## JSON Contract (cumplido exactamente)

```json
{
  "symbol": "BTCUSDT",
  "spot_price": 77708.11,
  "change_24h_pct": -3.09,
  "ema55_4h": 76378.76,
  "ema200_4h": 69783.37,
  "cross_state": "ALCISTA",
  "resistance": 78828.15,
  "support": 77632.58,
  "structure_text": "Precio operando por encima de ambas medias (+1.74% vs EMA55, +11.36% vs EMA200); estructura de medias alcista (EMA55 > EMA200); invalidación alcista si pierde EMA55 (~76,379, -1.71%); resistencia inmediata en 78,828 (+1.44%); soporte inmediato en 77,633 (-0.10%).",
  "no_disponible": { "spot_price": false, "change_24h_pct": false, "ema55_4h": false, "ema200_4h": false, "cross_state": false, "resistance": false, "support": false },
  "series": { "closes": [...], "ema55": [...], "ema200": [...] },
  "updated_at": "2026-08-29T06:45:28.000Z"
}
```

Campo extra `series` añadido para que el frontend pueda dibujar el sparkline
sin llamar a Binance directamente (respeta "el frontend solo consume el JSON
ya calculado"). `no_disponible` es un objeto por-campo; el frontend muestra
literalmente "Dato no disponible" cuando cualquier flag es `true`.

## Goals / Completed Modifications / Verification

- ✅ Backend: EMA55/EMA200 (semilla SMA + recurrencia), soporte/resistencia
  por pivotes ±3 sobre últimas 80 velas, estado de cruce (ALCISTA/BAJISTA/
  COMPRIMIDO <0.15%), texto de estructura en español, caché 60s, errores 502.
- ✅ Frontend: tema oscuro trading-terminal (#0A0D12), tipografía mono para
  números (JetBrains Mono) + sans para etiquetas (Inter), paleta exacta
  (verde #5FBF8F, rojo #E2604F, ámbar #E8B04B, azul #4FA8D8), ticker tape
  scroll continuo, 3 tarjetas con sparkline canvas (precio+EMA55+EMA200),
  refresco auto 60s + botón manual + countdown, "Dato no disponible" literal,
  footer sticky con disclaimer.
- ✅ Responsive: 3 columnas desktop → 1 columna móvil (verificado 390px).
- ✅ Footer sticky: confirmado `sticksToBottom=true` en viewport alto (1400px),
  empuje natural en contenido largo.
- ✅ Accesibilidad: foco visible en botón refresco (`focus-visible:outline`),
  ARIA labels en tarjetas/canvas/botón, contraste AA.
- ✅ Lint limpio (`bun run lint` sin errores ni warnings).
- ✅ Dev log sin errores de runtime; API responde 200, caché reduce latencia
  de ~220ms a ~10ms en hits.
- ✅ Verificación agent-browser: página renderiza, 3 canvas dibujados, ticker
  visible, botón refresco funcional, countdown activo.
- ✅ Verificación VLM: "High visual polish, professional trading-terminal
  aesthetic, charts fully rendered with visible lines, no bugs".

### Cómo servirlo

El proyecto corre en el dev server de Next.js (puerto 3000):

```bash
bun run dev    # http://localhost:3000  (única ruta visible: /)
```

El endpoint es `GET /api/analysis?symbol={BTCUSDT|ETHUSDT|XRPUSDT}`.

## Unresolved Issues / Risks / Next-Phase Priorities

1. **Binance geo-disponibilidad**: la API pública de Binance puede estar
   bloqueada en algunas regiones. Hoy funciona desde el sandbox. Si falla en
   producción, considerar fallback a `api.binance.us` o un proxy. Prioridad
   baja mientras funcione.
2. **Persistencia de caché**: la caché es en memoria (Map) — se pierde al
   reiniciar el server. Aceptable para dev; en prod con múltiples instancias
   migrar a Redis/APCu-equivalente. Prioridad baja.
3. **Rate limits de Binance**: con caché 60s y 3 símbolos = ~3 requests/min,
   muy por debajo del límite (1200/min). Sin riesgo.
4. **Tests automatizados**: no se escribieron tests (policy del entorno).
   Las funciones de `indicators.ts` y `structure.ts` son puras y fáciles de
   testear si se añade Jest/Vitest en una fase futura.
5. **Más indicadores**: el panel podría ampliarse con RSI, MACD, volumen,
  order book depth, o alertas cuando el cruce de medias ocurre. Espacio
   claro para iteración.
6. **Websockets para precio real-time**: actualmente refresco cada 60s. Se
   podría añadir un mini-service socket.io (puerto 3003) conectado a
   Binance WebSocket para precios tick-a-tick, manteniendo el análisis de
   EMA cada 60s. Mejora futura.

## Notes for Next Phase (cron webDevReview)

El cron job cada 15 minutos debe:
1. Leer este worklog para entender el estado.
2. Hacer QA con agent-browser (abrir /, verificar 3 tarjetas, sparklines,
   ticker, botón refresco, footer sticky, responsive móvil).
3. Si hay bugs → arreglar. Si estable → proponer nuevas features
   (RSI/MACD, alertas de cruce, websocket tick, más pares, modo claro
   opcional, exportar snapshot, historial de cruces).
4. Actualizar este worklog.

---
Task ID: round-2
Agent: cron webDevReview (webDevReview)
Task: QA continua + añadir features (RSI, visualizador S/R, resumen de mercado) + mejorar styling.

Work Log:
- Leído worklog previo: proyecto estable, sin bugs, VLM 9/10 en ronda 1.
- QA con agent-browser: página carga sin errores de runtime/console, 3 tarjetas
  renderizan con datos reales de Binance, botón refresco funcional, footer
  sticky confirmado (sticksToBottom=true en viewport 2400px), responsive móvil
  (1 columna a 390px). Dev log sin errores.
- Decisión: estabilidad confirmada → añadir nuevas features de alto impacto.
- Backend (`src/lib/indicators.ts`):
  - Añadido `calculateRSI(closes, 14)` — RSI de Wilder con suavizado estándar,
    semilla = SMA de primeros 14 cambios, recurrencia
    `avgGain_t = (avgGain_{t-1}*(period-1) + gain_t)/period`. Edge cases:
    avgLoss=0 → RSI=100, avgGain=0 → RSI=0.
  - Añadido `detectRecentCross(ema55Series, ema200Series)` — escanea últimas
    30 velas buscando flip de signo en (ema55-ema200), devuelve
    `{happened, candles_since_cross, direction}`. `happened=true` si el cruce
    fue dentro de 10 velas.
  - Añadido campo `trades` al Ticker24h (mapeado de `count` de Binance).
- Backend (`src/lib/types.ts`): ampliado `AnalysisResponse` con `rsi_14_4h`,
  `cross_info`, `volume_24h_usd`, `trades_24h`, `high_24h`, `low_24h`, y sus
  flags en `no_disponible`. Añadido `series.rsi` para el mini-sparkline del RSI.
- Backend (`src/app/api/analysis/route.ts`): integrado el cálculo de RSI +
  cross_info + campos de ticker en `buildAnalysis`. Eliminado el tipo local
  duplicado, ahora importa de `@/lib/types`.
- Frontend — nuevos componentes:
  - `range-bar.tsx` — barra horizontal que muestra la posición del precio spot
    dentro del rango soporte/resistencia, con marcadores verticales para
    EMA55, EMA200 y banda del rango 24h (low→high). El dot del spot es
    verde/ámbar/rojo según su posición en el rango (bottom/mid/top third).
    Glowing dot con transición CSS de 500ms.
  - `rsi-gauge.tsx` — gauge compacto con track de 3 zonas (oversold <30 verde,
    neutral 30-70 gris, overbought >70 rojo), needle vertical con glow, valor
    numérico + label (Sobrecomprado/Neutral/Sobrevendido), escala 0-30-50-70-100,
    y mini-sparkline SVG del historial RSI (últimos 40 puntos) con líneas de
    referencia en 30/70.
  - `market-summary.tsx` — tira agregada bajo el header con: pill de sentimiento
    global (Riesgo Alcista/Bajista/Mixto basado en conteo de estados), breakdown
    ALCISTA X/3 + BAJISTA X/3 + COMPRIMIDO X/3, Δ24h promedio, RSI promedio, y
    badges de alerta "⚡ N cruce alcista/bajista reciente" cuando aplica.
- Frontend — `asset-card.tsx` integrado:
  - `PriceFlash` — wrapper del precio con flash de brightness (key-based CSS
    animation, sin state/ref/effect — cumple lint react-hooks/refs).
  - Strip de 24h high/low/volumen debajo del precio (L $X · $vol · H $Y).
  - RangeBar con label "POSICIÓN EN EL RANGO · S/R".
  - RsiGauge como fila enriquecida en la sección de métricas.
  - Banner de "Cruce alcista/bajista · hace N vela(s)" cuando
    cross_info.happened=true, con icono Zap pulsante.
  - Animación `animate-card-enter` (fade-up 0.4s) en el article.
  - Hover refinado: `-translate-y-0.5` + glow state-colored.
- Frontend — `sparkline.tsx` mejorado:
  - Etiqueta del precio spot en el borde derecho (fondo semi-transparente).
  - Etiquetas de min/max en el eje Y izquierdo.
- Frontend — `page.tsx`: insertado `MarketSummary` entre header y main grid.
  Actualizada la nota de metodología para documentar RSI y detección de cruces.
- CSS (`globals.css`): añadidas animaciones `card-enter`, `price-flash`,
  `shimmer`, y media query `prefers-reduced-motion` que las desactiva todas.
- Lint: 2 iteraciones para resolver `react-hooks/refs` (primer intento con
  useRef-during-render fue rechazado; solución final: key-based CSS animation
  pura sin ref). Lint final limpio.
- Verificación agent-browser: 3 tarjetas renderizan con RSI (BTC 44.2 Neutral),
  RangeBar (rango 69,316–81,947 con marcadores S/R/55/200), MarketSummary
  ("MERCADO: RIESGO ALCISTA · ALCISTA 3/3 · BAJISTA 0/3"), strip 24h
  (L $76,888 · $1.54B · H $81,478). Sin errores console/runtime.
- Verificación VLM desktop: "9/10 Institutional Grade UI, rivals TradingView
  Terminal/Bloomberg, S/R range bar is a standout UX addition, zero bugs
  detected". Recomendación: añadir tooltips en hover para precisión.
- Verificación VLM mobile (390px): "single-column works, no overflow, RSI gauge
  and S/R range bar usable, market summary readable. Well-optimized for mobile."
- Footer sticky re-confirmado (sticksToBottom=true en viewport 2400px).

Stage Summary:
- **Estado:** v2 entregada y verificada. La app pasó de "tracker" a "quantitative
  analysis tool" (cita VLM). 4 nuevas features backend + 3 nuevos componentes
  frontend + pulido de styling, todo sin romper el contrato JSON original
  (campos nuevos son aditivos).
- **Artefactos producidos:**
  - `src/lib/indicators.ts` (+calculateRSI, +detectRecentCross, +CrossInfo type)
  - `src/lib/types.ts` (AnalysisResponse ampliado)
  - `src/lib/binance.ts` (+trades en Ticker24h)
  - `src/app/api/analysis/route.ts` (integración nuevos cálculos)
  - `src/components/panel/range-bar.tsx` (nuevo)
  - `src/components/panel/rsi-gauge.tsx` (nuevo)
  - `src/components/panel/market-summary.tsx` (nuevo)
  - `src/components/panel/asset-card.tsx` (PriceFlash + integraciones)
  - `src/components/panel/sparkline.tsx` (etiquetas eje)
  - `src/app/page.tsx` (MarketSummary + metodología actualizada)
  - `src/app/globals.css` (3 animaciones + reduced-motion)
- **Contrato JSON ampliado** (campos nuevos, retrocompatible):
  `rsi_14_4h`, `cross_info {happened, candles_since_cross, direction, window}`,
  `volume_24h_usd`, `trades_24h`, `high_24h`, `low_24h`, `series.rsi[]`.

## Unresolved Issues / Risks / Next-Phase Priorities (round 2)

1. **Tooltips en hover** (sugerencia VLM): añadir tooltips nativos o via
   Radix Tooltip en el RangeBar y RsiGauge para mostrar timestamps/valores
   exactos. Prioridad media.
2. **Persistencia de cruces históricos**: actualmente `detectRecentCross`
   solo ve la última vela de datos; sería útil persistir un log de cruces
   (cuándo ocurrieron, dirección) en SQLite via Prisma para mostrar un
   historial. Prioridad media.
3. **MACD**: complemento natural de RSI/EMA. Añadir MACD line + histograma
   al sparkline o como mini-panel. Prioridad media.
4. **Websocket tick-a-tick**: el precio refresca cada 60s; un mini-service
   socket.io (puerto 3003) conectado a Binance WS daría ticks en tiempo real
   manteniendo el análisis de EMA cada 60s. Prioridad alta para próxima ronda.
5. **Más pares**: SOL, BNB, ADA ampliarían el panel. Solo requiere añadir
   al ALLOWED_SYMBOLS set + SYMBOL_META. Prioridad baja.
6. **Modo claro opcional**: el tema es oscuro forzado; un toggle sería
   accesible pero requeriría re-trabajar la paleta. Prioridad baja.
7. **Exportar snapshot**: botón para descargar el estado actual como
   JSON/PNG para archivar decisiones. Prioridad baja.
8. **Tests**: las funciones puras (calculateRSI, detectRecentCross,
   findSupportResistance) son fácilmente testeables con Vitest. Prioridad
   media para robustez.

## Recommended Next Step (round 3)

Priorizar **websocket tick-a-tick** (item 4) — es la mejora de mayor impacto
percibido: el precio parpadeando en tiempo real transforma la experiencia.
Mantener el análisis EMA/RSI/S-R a 60s (no necesita más frecuencia). Si el
esfuerzo es alto, fallback a **MACD** (item 3) que es puramente backend +
frontend aditivo sin nuevo servicio.

---
Task ID: round-3
Agent: cron webDevReview
Task: WebSocket tick-a-tick + MACD + styling improvements.

Work Log:
- Leído worklog previo: v2 estable, VLM 9/10 desktop y mobile. Próxima
  prioridad recomendada era **websocket tick-a-tick** (alta) o **MACD**
  (media). Se decidieron **ambas** en esta ronda para maximizar impacto.
- QA inicial con agent-browser (vía Caddy gateway puerto 81, NO puerto
  3000 directo — el gateway enruta `/foo?XTransformPort=NNNN` al puerto
  correcto; cargar la página en 3000 directo rompe `io('/?XTransformPort=3003')`
  porque Next.js no sabe proxyar WebSocket upgrades).
- Mini-service **ws-tick** (puerto 3003, socket.io + Binance combined trade
  stream para btcusdt/ethusdt/xrpusdt, throttle 800ms/symbol):
  - Iniciado con `setsid nohup bun index.ts > service.log 2>&1 &`.
  - Verificado: log muestra `[binance] connected, streaming trades` y
    `[client] connected` cuando el browser abre la página.
  - Health endpoint `/health` responde ( aunque el path `/` está reservado
    para socket.io, el httpServer handler custom atiende `/health`).
- **Hook `useTickStream`** (`src/hooks/use-tick-stream.ts`):
  - Patrón `useSyncExternalStore` (React 19 nativo) — evita el lint
    `react-hooks/set-state-in-effect` que rompía el primer intento con
    `setLocal(state)` síncrono en el effect.
  - Singleton a nivel módulo: UN socket.io compartido entre todos los
    `useTickStream()` callers (3 AssetCards + header). Sin esto, abriría
    3+1 sockets redundantes.
  - Escucha `tick`, `ws-status`, `heartbeat`. Devuelve
    `{prices, connected, binanceLive, lastHeartbeat, tickCount}`.
  - `clearTickPriceGlobal(symbol)` — borra el precio cached del tick;
    usado por `page.tsx` al refrescar REST para que el spot_price recién
    obtenido tome el control hasta el próximo tick.
- Backend MACD (`src/lib/indicators.ts`):
  - Añadido `calculateMACD(closes, fast=12, slow=26, signal=9)` — Appel
    defaults. MACD line = EMA(fast) - EMA(slow), Signal = EMA(signal)
    sobre la porción no-null del MACD line (semilla SMA del helper
    `calculateEMA`), Histogram = MACD - Signal.
  - Edge cases: devuelve `available:false` cuando `n < slow+signal` o
    `fast >= slow` o `period <= 0`. Las series se alinean con `closes`
    (null hasta que ambas EMAs están definidas; signal aún más tarde).
  - Helper `MACDResult` type exportado.
- Backend types (`src/lib/types.ts`):
  - `AnalysisResponse.macd: {line, signal, histogram}` (todos number|null).
  - `AnalysisResponse.series.macd_histogram: (number|null)[]`.
  - `AnalysisResponse.no_disponible.macd: boolean`.
- Backend route (`src/app/api/analysis/route.ts`):
  - Importa `calculateMACD`, lo invoca con 12/26/9 sobre los 4h closes.
  - Incluye `macd` y `series.macd_histogram` en el payload. Flag
    `no_disponible.macd = !macdRes.available`.
  - Verificado: `curl /api/analysis?symbol=BTCUSDT` devuelve
    `macd: {line: 286.45, signal: 652.99, histogram: -366.54}` y
    `series.macd_histogram` con 120 entradas.
- Frontend — **`MacdPanel`** (`src/components/panel/macd-panel.tsx`):
  - Histograma compacto de los últimos ~40 valores. Cada barra vertical
    crece desde la línea base (centro) — verde (#5fbf8f) hacia arriba si
    positivo, rojo (#e2604f) hacia abajo si negativo.
  - Altura normalizada contra max(|hist|) del viewport para que el chart
    siempre llene el espacio sin distorsión.
  - Etiquetas numéricas MACD/Signal/Hist en un grid de 3 columnas debajo
    del chart, coloreadas según signo del histograma.
  - Estado de tendencia ("Alcista ↑" / "Bajista ↓" / "Creciente ↓" /
    "Recuperando ↑") comparando el último histograma vs el anterior.
  - Estado `cross`: "MACD > Signal" o "MACD < Signal".
  - Notice explícito "MACD no disponible" cuando `unavailable || line == null`.
- Frontend — `AssetCard` (`src/components/panel/asset-card.tsx`):
  - Props nuevas: `livePrice?`, `tickActive?`, `lastTickAt?`, `nowMs?`.
  - `displayPrice = livePrice ?? data.spot_price` (con guards `Number.isFinite`).
  - Badge "TICK" pulsante (Radio icon + `animate-pulse`) cuando
    `tickActive && livePrice` es válido, con tooltip `tick hace Ns`.
  - Línea "tick hace Ns" debajo del precio (formato `Ns` o `Nm`).
  - `PriceFlash` ahora acepta `live` y aplica color verde (#5fbf8f) al
    flash cuando el tick está activo — refuerzo visual del live update.
  - Sparkline y RangeBar ahora consumen `displayPrice` (no `data.spot_price`)
    para que el dot del spot se mueva en tiempo real con los ticks.
  - `MacdPanel` insertado entre Sparkline y RangeBar como pedía el spec.
- Frontend — `page.tsx`:
  - `useTickStream()` al top level. Pasa `livePrice`, `tickActive`,
    `lastTickAt`, `nowMs` a cada `AssetCard`.
  - Estado `nowMs` (1Hz) para computar "tick hace Ns" sin causar cascada
    de re-renders en el store (es state local del Page, no del hook).
  - En cada refresh REST exitoso, llama `clearTickPriceGlobal(symbol)`
    para que el REST spot_price tome el control hasta el próximo tick.
  - Header: indicador de conexión con 3 estados:
      * `live` — verde pulsante "TICK LIVE" (Radio icon, `live-pulse` anim).
      * `connecting` — ámbar "CONECTANDO" (Wifi icon).
      * `offline` — rojo "OFFLINE" (WifiOff icon).
    Transiciones `transition-colors duration-300` para suavizar el cambio
    de estado. Tooltip muestra `tickCount`, `lastHeartbeat`.
  - Metodología actualizada para documentar MACD + tick stream.
  - Wrapper `terminal-grid` en el root + overlay `terminal-scanlines`
    (pointer-events-none, position fixed) para el look "CRT terminal".
- CSS (`globals.css`):
  - `.terminal-grid` — grid lines 48px (rgba 0.035) + radials existentes.
  - `.terminal-scanlines` — repeating-linear-gradient horizontal (rgba
    0.025) con `mix-blend-mode: overlay`, opacity 0.7.
  - `@keyframes scan-sweep` — sweep glow vertical cada 12s, desactivado
    bajo `prefers-reduced-motion`.
- Lint: 1 iteración para resolver `react-hooks/set-state-in-effect` en
  `use-tick-stream.ts` (solución: refactor a `useSyncExternalStore`).
  Lint final limpio (`bun run lint` sin errores ni warnings).
- Dev log: API 200s en todos los símbolos, latencia 4-200ms (caché HIT
  ~5ms, MISS ~120ms). Sin errores de runtime.
- Verificación agent-browser (vía puerto 81, no 3000):
  - 3 tarjetas renderizadas con sparkline, MACD histogram, RSI gauge,
    RangeBar, strip 24h.
  - TICK badge visible en las 3 tarjetas. "tick hace 0s/3s/4s" debajo del
    precio. Header muestra "TICK LIVE".
  - Sin errores de console, sin errores de runtime.
  - Footer sticky reconfirmado en viewport 2400px (sticksToBottom=true).
- Verificación VLM desktop (1440x900): "9/10 — 3 cards with sparklines +
  MACD histogram panels (green/red bars), TICK LIVE badge in top right
  with green pulsing dot, TICK badges and 'tick hace Ns' timestamps next
  to prices, subtle CRT scanline + grid texture, no visual bugs, color
  coding correct, layout cohesive".
- Verificación VLM mobile (390x844): "9/10 — single-column layout, all
  cards readable, charts/indicators visible without overflow, TICK LIVE
  indicator visible, market summary readable, no horizontal overflow".
- Verificación API: `curl /api/analysis?symbol=BTCUSDT` confirma
  `macd: {line, signal, histogram}` y `series.macd_histogram[120]`
  presentes en el payload.

Stage Summary:
- **Estado:** v3 entregada y verificada. La app pasó de "quantitative
  analysis tool" a "live trading terminal" (cita VLM: "highly professional,
  premium trading tool"). 2 features nuevas (WebSocket ticks + MACD) +
  styling refinements (scanline/grid overlay), todo sin romper el
  contrato JSON (campos aditivos, retrocompatible).
- **Artefactos producidos:**
  - `src/hooks/use-tick-stream.ts` (nuevo — useSyncExternalStore + singleton)
  - `src/lib/indicators.ts` (+calculateMACD, +MACDResult type)
  - `src/lib/types.ts` (AnalysisResponse.macd + series.macd_histogram
    + no_disponible.macd)
  - `src/app/api/analysis/route.ts` (integración MACD en buildAnalysis)
  - `src/components/panel/macd-panel.tsx` (nuevo — histograma + labels)
  - `src/components/panel/asset-card.tsx` (+livePrice/tickActive props,
    +TICK badge, +tick-hace-Ns, MACD panel integrado)
  - `src/app/page.tsx` (useTickStream + header conn indicator +
    clearTickPriceGlobal on REST refresh + terminal-grid wrapper)
  - `src/app/globals.css` (.terminal-grid + .terminal-scanlines +
    @keyframes scan-sweep + reduced-motion guard)
- **Contrato JSON ampliado** (campos nuevos, retrocompatible):
  `macd {line, signal, histogram}`, `series.macd_histogram[]`,
  `no_disponible.macd`.
- **Mini-service ws-tick** corriendo en puerto 3003 (singleton socket.io
  + Binance combined trade stream + throttle 800ms/symbol).

## Unresolved Issues / Next-Phase Priorities (round 3)

1. **Persistencia del mini-service ws-tick**: el proceso `bun index.ts`
   se cae cuando el shell session termina. Ya mitigado con `setsid` para
   detach del controlling terminal, pero en producción debería ser un
   systemd unit o pm2. Prioridad baja para dev.
2. **Tooltips en hover** (sugerencia VLM ronda 2, aún pendiente):
   añadir tooltips nativos o Radix Tooltip en RangeBar, RsiGauge y
   MacdPanel para mostrar timestamps/valores exactos. Prioridad media.
3. **MACD crossovers como alerta**: hoy el MacdPanel muestra el histograma
   pero no detecta cruces MACD/signal recientes. Análogo a
   `detectRecentCross` para EMA55/200. Prioridad media.
4. **Persistencia de cruces históricos** (ítem 2 de ronda 2, aún
   pendiente): log de cruces en SQLite via Prisma para historial.
   Prioridad media.
5. **Más pares** (SOL, BNB, ADA): solo requiere añadir al ALLOWED_SYMBOLS
   set + SYMBOL_META + al array SYMBOLS del mini-service. Prioridad baja.
6. **Tests automatizados**: las funciones puras (calculateRSI,
   calculateMACD, detectRecentCross, findSupportResistance) son fácilmente
   testeables con Vitest. Prioridad media para robustez.
7. **Modo claro opcional**: el tema es oscuro forzado; un toggle sería
   accesible pero requeriría re-trabajar la paleta y el terminal-grid.
   Prioridad baja.
8. **Optimización re-render ticks**: hoy cada tick re-renderiza el Page
   entero (porque `useTickStream` devuelve un snapshot nuevo). Para 3
   cards × 1.25 ticks/symbol/s = ~4 re-renders/s, irrelevante. Pero si se
   añaden más pares podría valer la pena memoizar AssetCard con React.memo
   y un comparador de precio. Prioridad baja.

## Recommended Next Step (round 4)

Priorizar **alerts visuales de cruce MACD/signal** (item 3) — el panel ya
tiene todo el cómputo necesario (MACD line + signal disponibles en cada
refresco). Añadir un banner "⚡ MACD cruce alcista/bajista · hace N vela(s)"
análogo al de EMA55/200, y un destello en el histograma del último bar
cuando hay flip de signo. Es la iteración natural que convierte el MACD
panel de "lectura" a "alerta activa".

En paralelo, añadir **tooltips nativos** (item 2) en RangeBar/RsiGauge/
MacdPanel para mostrar timestamps y valores exactos — solución rápida de
alto impacto en UX sin backend adicional.

Si sobra ancho de banda, dar de alta un segundo mini-service de
**order book depth L2** (puerto 3004) para enriquecer el RangeBar con
información de bid/ask volume. Es la feature que más diferencia un panel
cuantitativo de un dashboard de precio.
