"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  readStoredValue,
  writeStoredValue,
  subscribeToKey,
} from "@/lib/storage-store";

/**
 * useLocalStorageString — hydration-safe persisted state backed by
 * localStorage, built on `useSyncExternalStore`.
 *
 * - SSR/hydration renders `fallback` (getServerSnapshot), so markup always
 *   matches and React error #418 can't happen.
 * - After hydration the client snapshot reads the stored value; re-renders
 *   happen only when the stored string actually changes.
 * - No setState-in-effect (satisfies `react-hooks/set-state-in-effect`).
 * - Writes from this tab notify subscribers directly; other tabs propagate
 *   via the native `storage` event.
 *
 * Note: the value is a raw string. For structured data, pair this hook with
 * JSON (de)serialization at the call site, or use readStoredJson directly in
 * event handlers / effects (never during render).
 */
export function useLocalStorageString(
  key: string,
  fallback: string,
): [string, (value: string) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => subscribeToKey(key, () => onChange()),
    [key],
  );

  const getSnapshot = useCallback(() => readStoredValue(key) ?? fallback, [key, fallback]);

  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: string) => writeStoredValue(key, next),
    [key],
  );

  return [value, setValue];
}
