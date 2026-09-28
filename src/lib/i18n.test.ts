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
