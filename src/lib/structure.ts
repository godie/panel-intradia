/**
 * Market structure narrative — builds the 2-3 sentence Spanish text that
 * describes where price sits relative to the moving averages and what the
 * nearest technical invalidation trigger is.
 *
 * Pure function: takes already-computed numbers, returns a string. Never
 * invents values — if an input is null the text says so explicitly.
 */

import type { CrossState } from "./indicators";

function pctText(price: number, ref: number): string {
  const pct = ((price - ref) / ref) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

/**
 * buildStructureText — compose the human-readable structure summary.
 *
 * The text covers:
 *   1. Position of price relative to EMA55 & EMA200 (above/below/between)
 *      with the % distance to each.
 *   2. The cross-state interpretation (alcista/bajista/comprimido).
 *   3. The nearest invalidation trigger: if above the EMAs, the trigger is
 *      losing EMA55; if below, reclaiming EMA55; plus the distance to the
 *      nearest support/resistance level.
 */
export function buildStructureText(args: {
  spotPrice: number | null;
  ema55: number | null;
  ema200: number | null;
  crossState: CrossState | null;
  support: number | null;
  resistance: number | null;
}): string {
  const { spotPrice, ema55, ema200, crossState, support, resistance } = args;

  if (spotPrice == null) {
    return "No hay precio spot disponible; imposible evaluar la estructura de mercado.";
  }

  const parts: string[] = [];

  // 1. Position vs moving averages.
  if (ema55 != null && ema200 != null) {
    const above55 = spotPrice > ema55;
    const above200 = spotPrice > ema200;
    if (above55 && above200) {
      parts.push(
        `Precio operando por encima de ambas medias (${pctText(spotPrice, ema55)} vs EMA55, ${pctText(
          spotPrice,
          ema200,
        )} vs EMA200)`,
      );
    } else if (!above55 && !above200) {
      parts.push(
        `Precio operando por debajo de ambas medias (${pctText(spotPrice, ema55)} vs EMA55, ${pctText(
          spotPrice,
          ema200,
        )} vs EMA200)`,
      );
    } else {
      parts.push(
        `Precio comprimido entre las medias (${pctText(spotPrice, ema55)} vs EMA55, ${pctText(
          spotPrice,
          ema200,
        )} vs EMA200)`,
      );
    }
  } else if (ema55 != null) {
    parts.push(
      `Precio ${spotPrice >= ema55 ? "por encima" : "por debajo"} de la EMA55 (${pctText(
        spotPrice,
        ema55,
      )}); EMA200 no disponible`,
    );
  } else if (ema200 != null) {
    parts.push(
      `Precio ${spotPrice >= ema200 ? "por encima" : "por debajo"} de la EMA200 (${pctText(
        spotPrice,
        ema200,
      )}); EMA55 no disponible`,
    );
  } else {
    parts.push("Medias móviles no disponibles para este símbolo");
  }

  // 2. Cross-state interpretation.
  switch (crossState) {
    case "ALCISTA":
      parts.push("estructura de medias alcista (EMA55 > EMA200)");
      break;
    case "BAJISTA":
      parts.push("estructura de medias bajista (EMA55 < EMA200)");
      break;
    case "COMPRIMIDO":
      parts.push("medias comprimidas (diferencia < 0.15%), posible expansión direccional inminente");
      break;
    default:
      // state unavailable — nothing to add
      break;
  }

  // 3. Nearest invalidation trigger.
  if (ema55 != null) {
    if (spotPrice > ema55) {
      parts.push(
        `invalidación alcista si pierde EMA55 (~${fmtPrice(ema55)}, ${pctText(ema55, spotPrice)})`,
      );
    } else {
      parts.push(
        `invalidación bajista si recupera EMA55 (~${fmtPrice(ema55)}, ${pctText(ema55, spotPrice)})`,
      );
    }
  }
  if (resistance != null) {
    parts.push(`resistencia inmediata en ${fmtPrice(resistance)} (${pctText(resistance, spotPrice)})`);
  }
  if (support != null) {
    parts.push(`soporte inmediato en ${fmtPrice(support)} (${pctText(support, spotPrice)})`);
  }

  // Join with semicolons; capitalize the first letter.
  let text = parts.join("; ");
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  return text + ".";
}
