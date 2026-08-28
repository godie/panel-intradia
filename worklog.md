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
