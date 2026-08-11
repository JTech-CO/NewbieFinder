/**
 * chrome.storage 얇은 래퍼.
 *
 * 목적
 *  - Promise 기반 단일 인터페이스
 *  - 저장 실패를 throw 대신 값으로 다뤄 UI 가 멈추지 않게 함
 *  - chrome 이 없는 환경(단위 테스트, vite dev 서버)에서도 같은 코드가 동작하도록 메모리 폴백 제공
 */

export type StorageAreaName = "sync" | "local" | "session";

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<boolean>;
  remove(key: string): Promise<boolean>;
  /** 값 변경 구독. 해제 함수를 돌려준다. */
  subscribe(key: string, listener: (value: unknown) => void): () => void;
}

const memoryAreas = new Map<StorageAreaName, Map<string, unknown>>();
const memoryListeners = new Map<string, Set<(value: unknown) => void>>();

function memoryArea(area: StorageAreaName): Map<string, unknown> {
  let store = memoryAreas.get(area);
  if (!store) {
    store = new Map<string, unknown>();
    memoryAreas.set(area, store);
  }
  return store;
}

function chromeArea(area: StorageAreaName): chrome.storage.StorageArea | null {
  const runtime = (globalThis as { chrome?: typeof chrome }).chrome;
  if (!runtime?.storage) return null;
  // session 은 MV3 전용이며 일부 채널에서 없을 수 있다.
  const resolved = runtime.storage[area] as chrome.storage.StorageArea | undefined;
  return resolved ?? null;
}

export function createStore(area: StorageAreaName): KeyValueStore {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const native = chromeArea(area);
      if (!native) return memoryArea(area).get(key) as T | undefined;
      try {
        const result = await native.get(key);
        return result[key] as T | undefined;
      } catch {
        return undefined;
      }
    },

    async set(key: string, value: unknown): Promise<boolean> {
      const native = chromeArea(area);
      if (!native) {
        memoryArea(area).set(key, value);
        memoryListeners.get(`${area}:${key}`)?.forEach((listener) => listener(value));
        return true;
      }
      try {
        await native.set({ [key]: value });
        return true;
      } catch {
        // 용량 초과 등. 호출부가 STORAGE_FAILURE 로 다룰 수 있게 false 를 돌려준다.
        return false;
      }
    },

    async remove(key: string): Promise<boolean> {
      const native = chromeArea(area);
      if (!native) {
        memoryArea(area).delete(key);
        return true;
      }
      try {
        await native.remove(key);
        return true;
      } catch {
        return false;
      }
    },

    subscribe(key: string, listener: (value: unknown) => void): () => void {
      const runtime = (globalThis as { chrome?: typeof chrome }).chrome;
      if (!runtime?.storage?.onChanged) {
        const mapKey = `${area}:${key}`;
        const set = memoryListeners.get(mapKey) ?? new Set();
        set.add(listener);
        memoryListeners.set(mapKey, set);
        return () => set.delete(listener);
      }

      const handler = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ): void => {
        if (areaName !== area) return;
        const change = changes[key];
        if (change) listener(change.newValue);
      };

      runtime.storage.onChanged.addListener(handler);
      return () => runtime.storage.onChanged.removeListener(handler);
    },
  };
}

/** 테스트 격리를 위해 메모리 폴백을 비운다. */
export function resetMemoryStores(): void {
  memoryAreas.clear();
  memoryListeners.clear();
}

export const syncStore = createStore("sync");
export const localStore = createStore("local");
export const sessionStore = createStore("session");
