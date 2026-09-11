/**
 * storage-store — a tiny pub/sub wrapper around localStorage designed
 * for `useSyncExternalStore` (see src/hooks/use-local-storage.ts).
 *
 * Why this exists: reading localStorage in a useState initializer (or render)
 * breaks SSR hydration (React error #418), and restoring the value with
 * setState inside an effect trips the `react-hooks/set-state-in-effect` lint
 * rule. `useSyncExternalStore` solves both: getServerSnapshot renders the
 * default, getSnapshot reads storage and only re-renders when the stored
 * string actually changes.
 *
 * Falls back to an in-memory map when localStorage is unavailable (SSR,
 * tests, private mode) so nothing throws.
 */

// Per-key listener registry. One "storage" listener + one in-memory registry
// instead of one listener per (key × subscriber).
type Listener = (value: string | null) => void;
const keyListeners = new Map<string, Set<Listener>>();

// In-memory fallback used when localStorage is unavailable (SSR, tests).
const memoryStore = new Map<string, string>();

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    // Accessing localStorage can itself throw in some privacy modes.
    localStorage.getItem("__probe__");
    return localStorage;
  } catch {
    return null;
  }
}

function notifyKey(key: string, value: string | null): void {
  const listeners = keyListeners.get(key);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(value);
  }
}

// Installed once on first subscribe. localStorage's own "storage" event only
// fires in *other* tabs, so writes are notified directly in writeStoredValue.
let globalListenerInstalled = false;
function installGlobalListener(): void {
  if (globalListenerInstalled) return;
  if (typeof window === "undefined") return; // SSR / node — no storage events
  globalListenerInstalled = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null) {
      // clear() — notify every key we know about.
      for (const key of keyListeners.keys()) {
        notifyKey(key, null);
      }
    } else if (keyListeners.has(event.key)) {
      notifyKey(event.key, event.newValue);
    }
  });
}

/**
 * readStoredValue — returns the raw string stored at `key`, or null.
 * Never throws (falls back to the in-memory store / null on errors).
 */
export function readStoredValue(key: string): string | null {
  const storage = getStorage();
  if (storage) {
    try {
      return storage.getItem(key);
    } catch {
      // fall through to memory store
    }
  }
  return memoryStore.get(key) ?? null;
}

/**
 * readStoredJson — parses the stored JSON value, returning `fallback` when
 * missing or malformed.
 */
export function readStoredJson<T>(key: string, fallback: T): T {
  const raw = readStoredValue(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * writeStoredValue — persists the string and notifies subscribers of `key`.
 * Quota / privacy errors are swallowed.
 */
export function writeStoredValue(key: string, value: string): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(key, value);
    } catch {
      // quota exceeded / privacy mode — keep the in-memory copy
    }
  }
  memoryStore.set(key, value);
  // Notify own-tab subscribers (the storage event only crosses tabs).
  notifyKey(key, value);
}

/**
 * removeStoredValue — clears the key and notifies subscribers with null.
 */
export function removeStoredValue(key: string): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
  }
  memoryStore.delete(key);
  notifyKey(key, null);
}

/**
 * subscribeToKey — subscribes `listener` to changes of `key` (own-tab writes
 * via writeStoredValue + cross-tab storage events). Returns an unsubscribe
 * function.
 */
export function subscribeToKey(key: string, listener: Listener): () => void {
  installGlobalListener();
  let listeners = keyListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    keyListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) keyListeners.delete(key);
  };
}
