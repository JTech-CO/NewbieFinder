import type { FinderSettings } from "../../domain/settings";
import { DEFAULT_SETTINGS, enforceSettingsInvariants, normalizeSettings } from "../../domain/settings";
import { STORAGE_KEYS } from "../../shared/constants";
import { syncStore } from "./chrome-storage";

/**
 * 사용자 설정 저장소. chrome.storage.sync 에 작은 설정값만 둔다.
 * 저장 실패는 던지지 않는다. UI 가 메모리 상태로 계속 동작해야 한다.
 */

export async function loadSettings(): Promise<FinderSettings> {
  const raw = await syncStore.get<unknown>(STORAGE_KEYS.settings);
  if (raw === undefined) return DEFAULT_SETTINGS;
  return normalizeSettings(raw);
}

export async function saveSettings(settings: FinderSettings): Promise<boolean> {
  return syncStore.set(STORAGE_KEYS.settings, enforceSettingsInvariants(settings));
}

export async function clearSettings(): Promise<boolean> {
  return syncStore.remove(STORAGE_KEYS.settings);
}

/** 다른 창에서 설정이 바뀌면 반영한다. */
export function subscribeSettings(listener: (settings: FinderSettings) => void): () => void {
  return syncStore.subscribe(STORAGE_KEYS.settings, (value) => {
    listener(value === undefined ? DEFAULT_SETTINGS : normalizeSettings(value));
  });
}
