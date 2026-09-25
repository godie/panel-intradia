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
 * Hardcoded strings we know about. Empty on purpose: no new debt is accepted
 * here. Any entry means someone deferred translation work, and the equality
 * assertion below fails both on new debt and on stale entries. Do not re-add
 * anything — translate it instead.
 * Each entry is "<file> :: <literal>".
 */
const KNOWN_DEBT: string[] = []; // empty on purpose: no new debt is accepted

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
