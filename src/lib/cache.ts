/**
 * In-memory TTL cache — 60 second server-side cache per cache key.
 *
 * Why not APCu / filesystem? We're running on the Next.js runtime which
 * keeps module-level state alive across requests within a single server
 * process, so a plain Map gives us the same 60s deduplication the spec
 * asks for, with zero I/O. Entries auto-expire on read.
 *
 * The cache stores the *fully computed* analysis payload so repeated
 * requests within 60s skip both the Binance round-trip and the math.
 */

type Entry<T> = {
  value: T;
  expiresAt: number; // epoch ms
};

const store = new Map<string, Entry<unknown>>();
const DEFAULT_TTL_MS = 60_000;

export function getCached<T>(key: string, now = Date.now()): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS, now = Date.now()): void {
  store.set(key, { value, expiresAt: now + ttlMs });
}

export function invalidate(key: string): void {
  store.delete(key);
}

export function clearAll(): void {
  store.clear();
}

/** Exposed for diagnostics / future admin endpoints. */
export function cacheStats(now = Date.now()): { entries: number; keys: string[] } {
  // Lazily purge expired entries while reporting.
  for (const [k, e] of store) {
    if (e.expiresAt <= now) store.delete(k);
  }
  return { entries: store.size, keys: [...store.keys()] };
}
