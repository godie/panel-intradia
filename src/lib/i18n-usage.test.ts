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
