/**
 * Tests for src/lib/storage-store.ts — a tiny pub/sub wrapper around
 * localStorage that lets hooks use `useSyncExternalStore` for hydration-safe
 * persisted state.
 *
 * The lib falls back to an in-memory store when localStorage is unavailable
 * (Node/test environment, SSR, private mode), so all tests run without a DOM.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  readStoredValue,
  readStoredJson,
  writeStoredValue,
  removeStoredValue,
  subscribeToKey,
} from "./storage-store";

// ---------------------------------------------------------------------------
// Minimal localStorage stub for the Node test environment (vitest.config uses
// environment: "node"). Backed by a Map; implements the Storage interface.
// ---------------------------------------------------------------------------
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
}
const memoryStorage = new MemoryStorage();
vi.stubGlobal("localStorage", memoryStorage);
vi.stubGlobal("Storage", MemoryStorage);

beforeEach(() => {
  memoryStorage.clear();
});

describe("readStoredValue", () => {
  it("returns null for a missing key", () => {
    expect(readStoredValue("missing:key")).toBeNull();
  });

  it("returns the stored string verbatim", () => {
    localStorage.setItem("k1", "hello");
    expect(readStoredValue("k1")).toBe("hello");
  });

  it("returns the empty string when stored", () => {
    localStorage.setItem("k2", "");
    expect(readStoredValue("k2")).toBe("");
  });

  it("returns null when localStorage throws (corrupted store)", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("boom");
    });
    expect(readStoredValue("k3")).toBeNull();
    spy.mockRestore();
  });
});

describe("readStoredJson", () => {
  it("returns fallback for a missing key", () => {
    expect(readStoredJson("missing:json", [1, 2])).toEqual([1, 2]);
  });

  it("parses valid JSON", () => {
    localStorage.setItem("j1", JSON.stringify({ a: 1 }));
    expect(readStoredJson("j1", { a: 0 })).toEqual({ a: 1 });
  });

  it("returns fallback for malformed JSON", () => {
    localStorage.setItem("j2", "{not json");
    expect(readStoredJson("j2", "fb")).toBe("fb");
  });
});

describe("writeStoredValue", () => {
  it("stores a string that readStoredValue returns", () => {
    writeStoredValue("w1", "v1");
    expect(readStoredValue("w1")).toBe("v1");
  });

  it("silently ignores quota errors", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => writeStoredValue("w2", "v2")).not.toThrow();
    spy.mockRestore();
  });
});

describe("subscribeToKey", () => {
  it("notifies the subscriber when the key changes", () => {
    const listener = vi.fn();
    const unsub = subscribeToKey("s1", listener);
    writeStoredValue("s1", "x");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("x");
    unsub();
  });

  it("does not notify when a different key changes", () => {
    const listener = vi.fn();
    const unsub = subscribeToKey("s2", listener);
    writeStoredValue("other", "x");
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("notifies with null when the key is removed", () => {
    writeStoredValue("s3", "x");
    const listener = vi.fn();
    const unsub = subscribeToKey("s3", listener);
    removeStoredValue("s3");
    expect(listener).toHaveBeenCalledWith(null);
    unsub();
  });

  it("does not notify on raw localStorage writes (own-tab writes must use the lib)", () => {
    // Raw localStorage mutations bypass the lib's notification: same-tab
    // "storage" events never fire in the browser. Cross-tab changes still
    // propagate via the real storage event.
    const listener = vi.fn();
    const unsub = subscribeToKey("s3b", listener);
    localStorage.setItem("s3b", "raw");
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsub = subscribeToKey("s4", listener);
    unsub();
    writeStoredValue("s4", "x");
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies without localStorage (memory fallback)", () => {
    const listener = vi.fn();
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("no storage");
    });
    const unsub = subscribeToKey("s5", listener);
    writeStoredValue("s5", "mem");
    expect(listener).toHaveBeenCalledWith("mem");
    unsub();
    spy.mockRestore();
  });
});
