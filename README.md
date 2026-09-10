# Panel Cuantitativo // Intradía

**Repository**: https://github.com/godie/panel-intradia.git

Panel cuantitativo en vivo para análisis técnico intradía de los principales
pares cripto contra USDT (BTC, ETH, XRP, SOL, BNB). Combina datos en tiempo
real desde Binance con un pipeline de cálculo de indicadores técnicos, eventos
de cruce persistidos, alertas personalizables y un sistema de estrategias
predefinidas — todo expuesto en un dashboard único en modo oscuro
estilo *trading-terminal*.

## Estado del proyecto

**Versión actual:** v31 (rondas 1–31 de iteración continua, ~4 años de
desarrollo). Estable, verificado end-to-end con navegador automatizado (agent-browser)
en los 4 idiomas soportados, 164/164 tests pasando, lint limpio.

### Qué incluye hoy

- **5 pares** monitorizados en paralelo (BTC/USDT, ETH/USDT, XRP/USDT, SOL/USDT, BNB/USDT) sobre velas de 4 h.
- **Tick en tiempo real** vía WebSocket de Binance/Bybit (mini-service `tick-stream` en puerto 3005) con throttle 800 ms por símbolo, fallback automático, reconexión y latido de estado.
- **Order book** en vivo (mini-service `order-book` en puerto 3004) con depth bar visual por activo.
- **Análisis cuantitativo cada 60 s** servido por `GET /api/analysis?symbol=…` (caché TTL 60 s en memoria):
  - EMA 55 / EMA 200 y estado del cruce (`ALCISTA` / `BAJISTA` / `COMPRIMIDO`)
  - Soporte / resistencia por pivotes ±3 sobre las últimas 80 velas
  - RSI(14) de Wilder
  - MACD(12, 26, 9) con detección de cruce y *momentum flip* del histograma
  - ATR(14) para volatilidad y **stop-loss sugerido** 1.5× ATR (long/short según tendencia)
  - Bollinger Bands(20, 2) con detección de **squeeze** y **squeeze breakout** direccional
  - Fibonacci retracement + extensions sobre los últimos 100 swings
  - VWAP(20) rolling con overlay en el sparkline
  - Estocástico(14, 3) %K/%D con detección de cruce
  - Ichimoku Kinko Hyo (9, 26, 52) con nube, Tenkan/Kijun/Senkou A y B/Chikou
  - Volumen 24 h en USD, número de trades, máximo/mínimo 24 h
- **Eventos persistidos en SQLite** vía Prisma (`CrossEvent`): cruces EMA, cruces MACD, momentum flip, squeeze y squeeze breakout, cruces estocásticos — cada uno con `dedup` adaptativo y notificación toast.
- **Historial de cruces** navegable con filtros por símbolo, tipo, dirección y rango temporal (`CrossHistory`).
- **Alertas de precio** personalizables en `localStorage` con verificación contra el stream de ticks y sonido Web Audio API (tono alcista / bajista) al dispararse.
- **Sistema de estrategias** predefinidas (Trend Buy / Mean Reversion Buy / Trend Short / Hold) con consenso agregado y selector por activo.
- **Constructor de estrategia personalizada** (UI completa) — combina 13 tipos de condiciones (EMA cross, RSI thresholds, MACD bullish/bearish, Stochastic cross, price vs VWAP, Bollinger squeeze, Ichimoku above/below), elige acción objetivo (BUY/SHORT/HOLD) y persiste en `localStorage`.
- **Backtest de estrategias** — evalúa cualquier estrategia (predefinida o personalizada) contra histórico de hasta 1000 velas (intervalos 15m/1h/4h/1d) con simulación de trades realista:
  - **Position sizing** configurable: 100% completo, fraccional fijo, **medio-Kelly** y **Kelly completo** (fracción de Kelly calculada desde el win rate + payoff realizado)
  - **Comisiones** configurables en basis points (default 10 bp = 0.10% por lado, Binance spot), descontadas del net PnL
  - **Exit rules**: stop-loss %, take-profit %, máximo de velas en posición, salida por señal enfriada, fin de datos
  - **Métricas**: operaciones, win rate, retorno total, máx. drawdown, profit factor, mantención promedio, mejor/peor operación, capital final, comisiones totales, tamaño promedio de posición
  - **Curva de capital** HiDPI con baseline, regiones en posición sombreadas, marcador de equity final
  - **Lista de operaciones** con precio entrada/salida, P&L %, velas, razón de salida (stop-loss / take-profit / tiempo máx. / señal / fin de datos)
- **Backtests guardados + comparación** — persiste resultados en `localStorage` (cap 50, auto-compacción para no llenar la quota), abre el panel de historial y marca 2-3 para **compararlos lado a lado** en una tabla con el mejor valor por métrica resaltado en verde.
- **Market overview** agregado (sentimiento global, Δ24h promedio, RSI promedio) y matriz de correlación entre pares.
- **Sparkline HiDPI** por activo con precio, EMA55, EMA200, Bollinger upper/lower + fill, y VWAP dashed; etiquetas min/max/eje y precio spot en el borde.
- **Range bar** con posición del spot en el rango soporte/resistencia + marcadores de EMA55, EMA200, extensiones de Fibonacci (38.2/61.8/78.6 + 🎯 161.8).
- **i18n completo** en 4 idiomas: Español (por defecto), Inglés, 中文, Français — todas las strings visibles usan `t()` (incluyendo descripciones de señales, banners, modal de backtest, comparación, etc.).
- **Atajos de teclado**, ayuda modal, exportación de snapshot, selector de stop-loss, scatter-plot modal.
- **Responsive** verificado a 390 px (móvil): grid de 6 cards en 1 columna sin overflow.

### Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│  Navegador (Next.js client, React 19)                        │
│   ├─ Dashboard principal (puerto 3000 vía Next.js / 81 vía   │
│   │  Caddy)                                                  │
│   ├─ Hooks: useTickStream · useOrderBook · usePriceAlerts ·  │
│   │  useCrossAlerts · useStrategyAlerts · useKeyboard…       │
│   └─ Persistencia cliente: localStorage (alertas, secciones  │
│      colapsables, idioma)                                    │
└───────────────────────┬──────────────────────────────────────┘
                        │ REST + socket.io
┌───────────────────────┴──────────────────────────────────────┐
│  Next.js API routes                                          │
│   /api/analysis   /api/returns   /api/correlation            │
│   /api/cross-history   /api/backtest (POST)                  │
│   Caché 60 s · indicadores puros · persistencia Prisma        │
└───────────────────────┬──────────────────────────────────────┘
                        │ fetch + WS
┌───────────────────────┴──────────────────────────────────────┐
│  Binance                                                     │
│   REST  · klines (4 h) + ticker 24 h                         │
│   WS    · trade streams combinados                           │
└──────────────────────────────────────────────────────────────┘

Mini-services independientes (Bun):
  · tick-stream  :3005  socket.io → ticks Binance/Bybit en vivo
  · order-book   :3004  socket.io → depth agregado
```

## Stack técnico

| Capa            | Tecnología                                                     |
| --------------- | -------------------------------------------------------------- |
| Framework       | Next.js 16 (App Router, `output: standalone`)                  |
| UI              | React 19, TypeScript 5, Tailwind CSS 4, Radix UI, shadcn/ui   |
| Estado          | Zustand, TanStack Query, `useSyncExternalStore`                |
| Datos           | Prisma 6 + SQLite (`CrossEvent`)                               |
| Tiempo real     | socket.io-client + socket.io                                   |
| Validación      | Zod 4                                                          |
| Tests           | Vitest 4 (164 tests sobre funciones puras de indicadores + WebSocket routing)      |
| Lint            | ESLint 9 con `eslint-config-next`                              |
| Mini-services   | Bun 1.4.2 (`tick-stream`, `order-book`)                        |
| Runtime         | Bun 1.4.2 (dev server + mini-services)                         |
| Proxy           | Caddy (puerto 81, enrutamiento por path `/_tick-stream/*` y `/_order-book/*`) |
| CI               | GitHub Actions: lint, test, build, Prisma validate, mini-services |
| i18n            | Diccionario estático en `src/lib/i18n.ts` (es/en/zh/fr)        |

## Instalación

Para instrucciones detalladas de instalación local (Docker o manual) y
despliegue en producción, consulta **[INSTALL.md](./INSTALL.md)**.

Resumen rápido (Docker):

```bash
git clone https://github.com/godie/panel-intradia.git intradia_cripto
cd intradia_cripto
cp .env.example .env
docker compose up -d --build
# abrir http://localhost:81/
```

Resumen rápido (sin Docker, modo dev):

```bash
bun install
bun run db:push
bun run dev    # http://localhost:3000
```

### Requisitos

- **Docker** ≥ 24 (recomendado) o **Bun** ≥ 1.4.2 (manual)
- `CORS_ORIGINS` opcional: lista separada por comas de orígenes exactos permitidos para los WebSockets (por defecto `http://localhost:81,http://localhost:3000`)
- Acceso HTTPS saliente a `api.binance.com`, `stream.binance.com` y
  opcionalmente `api.binance.us` si la región bloquea el endpoint principal
- (Opcional) **Caddy** si vas a servir tras un proxy en modo manual
- **Sin .env en el repo** — se usa `.env.example` como template; copiálo a `.env` y ajustálo si hacés cambio (solo `DATABASE_URL` para SQLite, `CORS_ORIGINS` para los WebSockets)

### Pasos

```bash
# 1. Clonar e instalar dependencias del dashboard
git clone https://github.com/godie/panel-intradia.git intradia_cripto
cd intradia_cripto
bun install

# 2. Variables de entorno
cp .env.example .env
# editar .env si quieres cambiar la ruta de SQLite (por defecto file:./db/custom.db)

# 3. Configurar la base de datos local (SQLite vía Prisma)
bun run db:push          # crea el esquema (modelo CrossEvent)
# opcional: bun run db:generate si editas schema.prisma

# 4. Lanzar el dashboard
bun run dev              # http://localhost:3000

# 5. (Opcional pero recomendado) mini-services de tiempo real
#    En terminales separadas:
cd mini-services/tick-stream && bun install && bun run start   # :3005
cd mini-services/order-book && bun install && bun run start # :3004

# 6. (Opcional) proxy Caddy para enrutar los mini-services por path
caddy run --config Caddyfile   # :81
```

### Scripts disponibles

| Comando               | Descripción                                                    |
| --------------------- | -------------------------------------------------------------- |
| `bun run dev`         | Dev server con HMR en puerto 3000                              |
| `bun run build`       | Build de producción con output standalone                      |
| `bun run start`       | Sirve el build standalone con Bun                              |
| `bun run lint`        | ESLint sobre todo el repo (debe ser 0 errores, 0 warnings)      |
| `bun test`            | Ejecuta los tests de Vitest (164 tests)                        |
| `bun run db:push`     | Aplica el esquema Prisma a SQLite                              |
| `bun run db:migrate`  | Crea una migración nueva                                       |
| `bun run db:reset`    | Resetea la base de datos (⚠ borra cruces persistidos)          |
| `bunx prisma validate`| Valida el esquema Prisma (necesita DATABASE_URL en .env)        |

## Uso

### Endpoints principales

```http
GET  /api/analysis?symbol={BTCUSDT|ETHUSDT|XRPUSDT|SOLUSDT|BNBUSDT}
GET  /api/returns?symbols=BTCUSDT,ETHUSDT&window=24h
GET  /api/correlation?symbols=BTCUSDT,ETHUSDT,XRPUSDT&window=30d
GET  /api/cross-history?symbol=BTCUSDT&type=ema&since=24h
POST /api/backtest
     body: { symbol, interval, limit, strategyId | customStrategy,
             minConfidence, initialCapital, stopLossPct, takeProfitPct,
             maxHoldCandles, positionSizing, fixedFractionalPct, feeBps }
```

Todos los símbolos no listados responden `400`. Errores de Binance devuelven
`502` con detalle; el frontend muestra literalmente `"Dato no disponible"`
para los campos afectados. `/api/backtest` devuelve `200` incluso ante
fallos upstream — el error viaja inline en el campo `error` del JSON para que
el modal pueda renderizarlo sin HTTP 500.

### Navegación

- Click en cualquier card para desplegar/sección con análisis ampliado.
- Botón **Alertas** (campana) en el header → crear alertas de precio por
  símbolo (above/below) con sonido al dispararse.
- Botón **Exportar** → snapshot JSON del estado actual.
- Botón **Backtest** (en cada card, dentro del panel de estrategia) → abre
  el modal de backtest con configuración completa (símbolo, intervalo,
  tamaño de posición, comisiones, stop-loss/take-profit, capital inicial).
- Botón **Crear estrategia** (debajo de cada card) → constructor de
  estrategia personalizada con 13 condiciones.
- `R` → refrescar manualmente · `?` → ayuda de atajos · idioma: dropdown en
  el header (es/en/zh/fr).

## Sugerencias para usuarios finales

1. **Lee la metodología antes de operar.** El panel te da señales técnicas,
   no financieras. Ningún cruce, RSI ni MACD es una orden de compra/venta por
   sí solo — únelos con gestión de riesgo.
2. **Empieza por el Market Overview.** Resume el sesgo agregado (Alcista /
   Bajista / Mixto), el Δ24h y el RSI medio. Útil para filtrar antes de
   mirar una card individual.
3. **Sigue el contexto, no el tick.** El spot en vivo sirve para temporizar
   entradas; las decisiones se toman sobre el análisis 4 h (EMA, RSI, MACD,
   S/R, Fibonacci).
4. **Atento a los banners de evento.** Los pulsos ⚡ en cada card indican:
   - Cruce EMA55/200 reciente (alcista/bajista)
   - Cruce MACD reciente + momentum flip
   - Squeeze / Squeeze breakout de Bollinger
   - Cruce estocástico %K/%D
   - Bandera de **stop-loss sugerido** (ATR 1.5× según dirección de la EMA)
5. **Configura alertas con holgura.** El mercado cripto oscila; un threshold
   demasiado ajustado disparará constantes falsos positivos. Trabaja con %
   sobre el spot actual, no con precios absolutos que caducan en horas.
6. **El sonido es opcional.** Si operas en oficina o compartes espacio, el
   pitido se desactiva desde el propio modal de alertas.
7. **Exporta antes de eventos macro.** Antes de FOMC, CPI o un halving,
   descarga el snapshot para tener el contexto registrado.
8. **No mires solo velas 4 h.** El panel está calibrado para swing
   intradía / corto plazo; para *scalping* de minutos necesitas otro tipo de
   time-frame (no incluido).
9. **Cuidado con la región.** Si Binance geo-bloquea tu IP, el panel
   degradará con `"Dato no disponible"`. Configura un proxy o usa
   `api.binance.us` editando `src/lib/binance.ts`.
10. **El historial de cruces vive en SQLite.** El archivo `db/custom.db`
    acumula todos los eventos desde el primer arranque. Si lo borras
    (`db:reset`), pierdes ese registro pero el panel sigue funcionando.
11. **Backtestea antes de operar.** Usa el modal de backtest para validar
    tu estrategia contra histórico (hasta 1000 velas). Prueba varios
    modos de position sizing: **medio-Kelly** suele ser más robusto que
    100% completo (menos drawdown), y ajusta las comisiones a las de tu
    exchange (Binance spot ~10 bp, futures ~5 bp).
12. **Compara backtests guardados.** Marca 2-3 backtests y ábralos en la
    vista de comparación lado a lado — el mejor valor por métrica se
    resalta en verde. Útil para elegir entre position sizing o para
    comparar estrategias predefinidas vs. custom.
13. **Los backtests guardados viven en `localStorage`.** Si limpias la
    cache del navegador o usas modo incógnito, los pierdes. El límite es
    50 entries (las más viejas se descartan).

## Próximos pasos planificados

- **Walk-forward optimization** para backtests: divide el histórico en
  ventanas in-sample / out-of-sample para detectar overfitting.
- **Modo claro opcional.**
- **Tests E2E** (Playwright o agent-browser) de los flujos de alertas +
  backtest + comparación (actualmente solo hay tests unitarios sobre
  funciones puras de indicadores + WebSocket routing).
- **Más pares** (SOL, BNB ya incluidos; en consideración SUI, TON, AVAX).
- **Backtest multi-símbolo**: ejecutar la misma estrategia en los 5 pares
  y agregar el equity curve.
- **Importar/exportar backtests guardados** como JSON para compartir
  configuraciones entre navegadores.
- **Persistencia de alertas disparadas** en el historial de cruces.
- **Modo de notificaciones push** (Web Push API) para alertas disparadas
  cuando la pestaña no está visible.

## Aviso

Este proyecto es **una herramienta de análisis técnico con propósito
educativo y de soporte a la decisión**. No es una recomendación de inversión,
no ejecuta órdenes en ningún exchange y no almacena credenciales. El autor no
se hace responsable de pérdidas derivadas del uso de la información mostrada.
Opera bajo tu propio riesgo.
