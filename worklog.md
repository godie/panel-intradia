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
