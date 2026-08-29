import { describe, it, expect } from "vitest";
import { buildStructureText } from "./structure";

describe("buildStructureText", () => {
  it("returns the unavailable message when spotPrice is null", () => {
    const text = buildStructureText({
      spotPrice: null,
      ema55: 100,
      ema200: 90,
      crossState: "ALCISTA",
      support: 95,
      resistance: 110,
    });
    expect(text).toContain("No hay precio spot disponible");
  });

  it("describes price above both EMAs with percentage distances", () => {
    const text = buildStructureText({
      spotPrice: 110,
      ema55: 100,
      ema200: 90,
      crossState: "ALCISTA",
      support: 95,
      resistance: 115,
    });
    expect(text).toContain("por encima de ambas medias");
    expect(text).toContain("vs EMA55");
    expect(text).toContain("vs EMA200");
    // 110 vs 100 = +10.00%
    expect(text).toContain("+10.00%");
    // 110 vs 90 = +22.22%
    expect(text).toContain("+22.22%");
  });

  it("describes price below both EMAs", () => {
    const text = buildStructureText({
      spotPrice: 80,
      ema55: 100,
      ema200: 90,
      crossState: "BAJISTA",
      support: 75,
      resistance: 95,
    });
    expect(text).toContain("por debajo de ambas medias");
    // 80 vs 100 = -20.00%
    expect(text).toContain("-20.00%");
  });

  it("describes price compressed between the EMAs", () => {
    // Price 95 > EMA200 (90) but < EMA55 (100) → between.
    const text = buildStructureText({
      spotPrice: 95,
      ema55: 100,
      ema200: 90,
      crossState: "COMPRIMIDO",
      support: 88,
      resistance: 98,
    });
    expect(text).toContain("comprimido entre las medias");
  });

  it("includes the cross-state interpretation", () => {
    const bullish = buildStructureText({
      spotPrice: 110,
      ema55: 100,
      ema200: 90,
      crossState: "ALCISTA",
      support: 95,
      resistance: 115,
    });
    expect(bullish).toContain("estructura de medias alcista");

    const bearish = buildStructureText({
      spotPrice: 80,
      ema55: 100,
      ema200: 90,
      crossState: "BAJISTA",
      support: 75,
      resistance: 95,
    });
    expect(bearish).toContain("estructura de medias bajista");

    const compressed = buildStructureText({
      spotPrice: 95,
      ema55: 100,
      ema200: 90,
      crossState: "COMPRIMIDO",
      support: 88,
      resistance: 98,
    });
    expect(compressed).toContain("medias comprimidas");
  });

  it("includes the invalidation trigger when EMA55 is available", () => {
    // Price above EMA55 → invalidation is "losing EMA55".
    const text = buildStructureText({
      spotPrice: 110,
      ema55: 100,
      ema200: 90,
      crossState: "ALCISTA",
      support: 95,
      resistance: 115,
    });
    expect(text).toContain("invalidación alcista");
    expect(text).toContain("EMA55");

    // Price below EMA55 → invalidation is "reclaiming EMA55".
    const text2 = buildStructureText({
      spotPrice: 80,
      ema55: 100,
      ema200: 90,
      crossState: "BAJISTA",
      support: 75,
      resistance: 95,
    });
    expect(text2).toContain("invalidación bajista");
  });

  it("includes resistance and support levels when available", () => {
    const text = buildStructureText({
      spotPrice: 100,
      ema55: 95,
      ema200: 85,
      crossState: "ALCISTA",
      support: 90,
      resistance: 110,
    });
    expect(text).toContain("resistencia inmediata");
    expect(text).toContain("110");
    expect(text).toContain("soporte inmediato");
    expect(text).toContain("90");
  });

  it("handles null EMA55 and EMA200 gracefully", () => {
    const text = buildStructureText({
      spotPrice: 100,
      ema55: null,
      ema200: null,
      crossState: null,
      support: 95,
      resistance: 110,
    });
    expect(text).toContain("Medias móviles no disponibles");
    // Should still capitalize the first letter.
    expect(text[0]).toBe(text[0].toUpperCase());
  });

  it("handles only EMA55 available (EMA200 null)", () => {
    const text = buildStructureText({
      spotPrice: 110,
      ema55: 100,
      ema200: null,
      crossState: null,
      support: 95,
      resistance: 115,
    });
    expect(text).toContain("EMA55");
    expect(text).toContain("EMA200 no disponible");
  });

  it("handles only EMA200 available (EMA55 null)", () => {
    const text = buildStructureText({
      spotPrice: 110,
      ema55: null,
      ema200: 90,
      crossState: null,
      support: 95,
      resistance: 115,
    });
    expect(text).toContain("EMA200");
    expect(text).toContain("EMA55 no disponible");
  });

  it("ends with a period", () => {
    const text = buildStructureText({
      spotPrice: 100,
      ema55: 95,
      ema200: 85,
      crossState: "ALCISTA",
      support: 90,
      resistance: 110,
    });
    expect(text.endsWith(".")).toBe(true);
  });

  it("capitalizes the first letter", () => {
    const text = buildStructureText({
      spotPrice: 100,
      ema55: 95,
      ema200: 85,
      crossState: "ALCISTA",
      support: 90,
      resistance: 110,
    });
    expect(text[0]).toBe("P"); // "Precio..."
  });

  it("handles all inputs null except spotPrice", () => {
    const text = buildStructureText({
      spotPrice: 100,
      ema55: null,
      ema200: null,
      crossState: null,
      support: null,
      resistance: null,
    });
    expect(text).toContain("Medias móviles no disponibles");
    expect(text.endsWith(".")).toBe(true);
  });
});
