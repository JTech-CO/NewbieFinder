import { normalizeSettings } from "../../domain/settings";
import { CACHE_SCHEMA_VERSION, STORAGE_KEYS } from "../../shared/constants";
import { debugLog } from "../../shared/invariant";
import { localStore, syncStore } from "./chrome-storage";

/**
 * 설치·업데이트 시 저장소 마이그레이션. (Background Service Worker 책임)
 *
 * 방침
 *  - 설정은 스키마가 달라도 버리지 않고 정규화로 복구한다.
 *  - 캐시는 스키마 버전이 다르면 미련 없이 버린다. 잘못된 데이터를 보여 주는 것보다 다시 받는 게 낫다.
 */
export async function migrateStorage(): Promise<void> {
  await Promise.all([migrateSettings(), dropIncompatibleCaches()]);
}

async function migrateSettings(): Promise<void> {
  const raw = await syncStore.get<unknown>(STORAGE_KEYS.settings);
  if (raw === undefined) return;

  const normalized = normalizeSettings(raw);
  const changed = JSON.stringify(raw) !== JSON.stringify(normalized);
  if (changed) {
    await syncStore.set(STORAGE_KEYS.settings, normalized);
    debugLog({ event: "storage.settings.migrated", at: Date.now() });
  }
}

async function dropIncompatibleCaches(): Promise<void> {
  for (const key of [STORAGE_KEYS.liveCache, STORAGE_KEYS.channelCache]) {
    const entry = await localStore.get<{ schemaVersion?: number }>(key);
    if (entry && entry.schemaVersion !== CACHE_SCHEMA_VERSION) {
      await localStore.remove(key);
      debugLog({ event: "storage.cache.dropped", at: Date.now() });
    }
  }
}
