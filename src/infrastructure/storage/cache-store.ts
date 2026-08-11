import type { CacheEntry, CacheFreshness, ScanCoverage, StreamCandidate } from "../../domain/models";
import {
  CACHE_LIMITS,
  CACHE_SCHEMA_VERSION,
  CACHE_TTL,
  STORAGE_KEYS,
} from "../../shared/constants";
import { localStore } from "./chrome-storage";

/**
 * 읽기 전용 공개 데이터 캐시. chrome.storage.local.
 *
 * 저장하는 것: 공개 라이브 목록 요약, 채널 팔로워 수, 갱신 시각.
 * 저장하지 않는 것: 쿠키, 계정 정보, 방문 기록, 원시 응답 전체.
 */

export interface LiveCachePayload {
  readonly candidates: StreamCandidate[];
  readonly coverage: ScanCoverage;
  readonly scannedPages: number;
  readonly scannedLives: number;
  /** 이 캐시를 만든 설정의 시청자 상한. 조건이 넓어지면 재사용할 수 없다. */
  readonly viewerCeiling: number | null;
}

export interface ChannelCacheRecord {
  readonly followerCount: number;
  readonly fetchedAt: number;
}

export type ChannelCachePayload = Record<string, ChannelCacheRecord>;

function makeEntry<T>(key: string, payload: T, now: number, freshMs: number, staleMs: number): CacheEntry<T> {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    key,
    payload,
    createdAt: now,
    expiresAt: now + freshMs,
    staleUntil: now + staleMs,
  };
}

export function freshnessOf<T>(entry: CacheEntry<T> | undefined, now: number): CacheFreshness {
  if (!entry) return "expired";
  if (entry.schemaVersion !== CACHE_SCHEMA_VERSION) return "expired";
  if (now < entry.expiresAt) return "fresh";
  if (now < entry.staleUntil) return "stale";
  return "expired";
}

export async function readLiveCache(): Promise<CacheEntry<LiveCachePayload> | undefined> {
  const entry = await localStore.get<CacheEntry<LiveCachePayload>>(STORAGE_KEYS.liveCache);
  if (!entry || entry.schemaVersion !== CACHE_SCHEMA_VERSION) return undefined;
  if (!Array.isArray(entry.payload?.candidates)) return undefined;
  return entry;
}

export async function writeLiveCache(payload: LiveCachePayload, now: number): Promise<boolean> {
  // 용량 상한. unlimitedStorage 를 쓰지 않으므로 스스로 자른다.
  const trimmed: LiveCachePayload = {
    ...payload,
    candidates: payload.candidates.slice(0, CACHE_LIMITS.maxLiveCandidates),
  };
  return localStore.set(
    STORAGE_KEYS.liveCache,
    makeEntry(STORAGE_KEYS.liveCache, trimmed, now, CACHE_TTL.liveFreshMs, CACHE_TTL.liveStaleMs),
  );
}

export async function clearLiveCache(): Promise<boolean> {
  return localStore.remove(STORAGE_KEYS.liveCache);
}

export async function readChannelCache(): Promise<ChannelCachePayload> {
  const entry = await localStore.get<CacheEntry<ChannelCachePayload>>(STORAGE_KEYS.channelCache);
  if (!entry || entry.schemaVersion !== CACHE_SCHEMA_VERSION) return {};
  const payload = entry.payload;
  return payload && typeof payload === "object" ? payload : {};
}

/** 아직 신선한 팔로워 수만 돌려준다. */
export function pickFreshChannels(
  payload: ChannelCachePayload,
  now: number,
): Map<string, number> {
  const fresh = new Map<string, number>();
  for (const [channelId, record] of Object.entries(payload)) {
    if (!record || typeof record.followerCount !== "number") continue;
    if (now - record.fetchedAt < CACHE_TTL.channelFreshMs) {
      fresh.set(channelId, record.followerCount);
    }
  }
  return fresh;
}

/**
 * 팔로워 캐시 병합 저장.
 * 오래된 항목부터 버려 상한을 유지한다. (LRU 대신 fetchedAt 기준: 조회 시각이 곧 유용성이다)
 */
export async function mergeChannelCache(
  updates: ReadonlyMap<string, number>,
  now: number,
): Promise<boolean> {
  if (updates.size === 0) return true;

  const current = await readChannelCache();
  const merged: ChannelCachePayload = { ...current };

  for (const [channelId, followerCount] of updates) {
    merged[channelId] = { followerCount, fetchedAt: now };
  }

  const alive = Object.entries(merged)
    .filter(([, record]) => now - record.fetchedAt < CACHE_TTL.channelStaleMs)
    .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
    .slice(0, CACHE_LIMITS.maxChannelEntries);

  const next: ChannelCachePayload = Object.fromEntries(alive);

  return localStore.set(
    STORAGE_KEYS.channelCache,
    makeEntry(
      STORAGE_KEYS.channelCache,
      next,
      now,
      CACHE_TTL.channelFreshMs,
      CACHE_TTL.channelStaleMs,
    ),
  );
}

export async function clearChannelCache(): Promise<boolean> {
  return localStore.remove(STORAGE_KEYS.channelCache);
}

export async function clearAllCaches(): Promise<void> {
  await Promise.all([clearLiveCache(), clearChannelCache()]);
}
