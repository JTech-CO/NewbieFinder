import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CacheEntry, ScanCoverage, StreamCandidate } from "../../src/domain/models";
import { CACHE_LIMITS, CACHE_SCHEMA_VERSION, CACHE_TTL } from "../../src/shared/constants";
import {
  clearAllCaches,
  clearChannelCache,
  freshnessOf,
  mergeChannelCache,
  pickFreshChannels,
  readChannelCache,
  readLiveCache,
  writeLiveCache,
} from "../../src/infrastructure/storage/cache-store";
import type {
  ChannelCachePayload,
  LiveCachePayload,
} from "../../src/infrastructure/storage/cache-store";
import { resetMemoryStores } from "../../src/infrastructure/storage/chrome-storage";

/**
 * 캐시 저장소 통합 테스트.
 *
 * 캐시는 "빠르게 보여 주기" 위한 것이지 "실시간인 척하기" 위한 것이 아니다.
 * 신선도 경계와 상한이 어긋나면 오래된 값을 현재처럼 표시하게 되므로 경계를 정확히 못 박는다.
 */

const NOW = 1_775_000_000_000;

// 저장소는 메모리 폴백을 쓰므로 케이스마다 비워 격리한다.
beforeEach(() => {
  resetMemoryStores();
});

afterEach(() => {
  resetMemoryStores();
});

function hexId(index: number): string {
  return index.toString(16).padStart(32, "0");
}

function entryOf(createdAt: number, freshMs: number, staleMs: number): CacheEntry<string> {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    key: "테스트 키",
    payload: "테스트 값",
    createdAt,
    expiresAt: createdAt + freshMs,
    staleUntil: createdAt + staleMs,
  };
}

/* ------------------------------------------------------------------ */
/* freshnessOf                                                         */
/* ------------------------------------------------------------------ */

describe("freshnessOf", () => {
  const entry = entryOf(NOW, 1_000, 5_000);

  it("만료 시각 직전까지는 fresh 입니다.", () => {
    expect(freshnessOf(entry, NOW)).toBe("fresh");
    expect(freshnessOf(entry, NOW + 999)).toBe("fresh");
  });

  it("만료 시각에 도달하면 stale 로 넘어갑니다.", () => {
    expect(freshnessOf(entry, NOW + 1_000)).toBe("stale");
    expect(freshnessOf(entry, NOW + 4_999)).toBe("stale");
  });

  it("stale 기한에 도달하면 expired 입니다.", () => {
    expect(freshnessOf(entry, NOW + 5_000)).toBe("expired");
    expect(freshnessOf(entry, NOW + 100_000)).toBe("expired");
  });

  it("엔트리가 없거나 스키마 버전이 다르면 expired 로 다룹니다.", () => {
    expect(freshnessOf(undefined, NOW)).toBe("expired");
    expect(freshnessOf({ ...entry, schemaVersion: CACHE_SCHEMA_VERSION + 1 }, NOW)).toBe("expired");
  });
});

/* ------------------------------------------------------------------ */
/* pickFreshChannels                                                   */
/* ------------------------------------------------------------------ */

describe("pickFreshChannels", () => {
  it("신선도 기한 안의 항목만 돌려줍니다.", () => {
    const payload: ChannelCachePayload = {
      [hexId(1)]: { followerCount: 10, fetchedAt: NOW },
      [hexId(2)]: { followerCount: 20, fetchedAt: NOW - CACHE_TTL.channelFreshMs + 1 },
      [hexId(3)]: { followerCount: 30, fetchedAt: NOW - CACHE_TTL.channelFreshMs },
      [hexId(4)]: { followerCount: 40, fetchedAt: NOW - CACHE_TTL.channelStaleMs },
    };

    const fresh = pickFreshChannels(payload, NOW);

    expect([...fresh.keys()].sort()).toEqual([hexId(1), hexId(2)].sort());
    expect(fresh.get(hexId(1))).toBe(10);
    expect(fresh.get(hexId(2))).toBe(20);
    // 경계에 도달한 순간부터는 재조회 대상이다.
    expect(fresh.has(hexId(3))).toBe(false);
    expect(fresh.has(hexId(4))).toBe(false);
  });

  it("팔로워 수가 숫자가 아닌 손상된 항목은 건너뜁니다.", () => {
    const broken = {
      [hexId(5)]: { followerCount: "12", fetchedAt: NOW },
      [hexId(6)]: { fetchedAt: NOW },
      [hexId(7)]: null,
      [hexId(8)]: { followerCount: 3, fetchedAt: NOW },
    } as unknown as ChannelCachePayload;

    const fresh = pickFreshChannels(broken, NOW);

    expect([...fresh.keys()]).toEqual([hexId(8)]);
  });

  it("빈 캐시에서는 빈 결과를 돌려줍니다.", () => {
    expect(pickFreshChannels({}, NOW).size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* mergeChannelCache                                                   */
/* ------------------------------------------------------------------ */

describe("mergeChannelCache", () => {
  it("저장한 팔로워 수를 그대로 읽어 옵니다.", async () => {
    const ok = await mergeChannelCache(
      new Map([
        [hexId(1), 10],
        [hexId(2), 20],
      ]),
      NOW,
    );

    expect(ok).toBe(true);
    const stored = await readChannelCache();
    expect(stored[hexId(1)]).toEqual({ followerCount: 10, fetchedAt: NOW });
    expect(stored[hexId(2)]).toEqual({ followerCount: 20, fetchedAt: NOW });
  });

  it("나중에 조회한 값이 이전 값을 덮어쓰고, 손대지 않은 항목은 그대로 둡니다.", async () => {
    await mergeChannelCache(
      new Map([
        [hexId(1), 10],
        [hexId(2), 20],
      ]),
      NOW,
    );
    await mergeChannelCache(new Map([[hexId(1), 15]]), NOW + 60_000);

    const stored = await readChannelCache();
    expect(stored[hexId(1)]).toEqual({ followerCount: 15, fetchedAt: NOW + 60_000 });
    expect(stored[hexId(2)]).toEqual({ followerCount: 20, fetchedAt: NOW });
  });

  it("빈 갱신은 기존 캐시를 건드리지 않습니다.", async () => {
    const ok = await mergeChannelCache(new Map(), NOW);
    expect(ok).toBe(true);
    expect(await readChannelCache()).toEqual({});
  });

  it("보관 기한이 지난 항목은 병합할 때 함께 정리합니다.", async () => {
    await mergeChannelCache(new Map([[hexId(1), 10]]), NOW);
    await mergeChannelCache(new Map([[hexId(2), 20]]), NOW + CACHE_TTL.channelStaleMs + 1);

    const stored = await readChannelCache();
    expect(Object.keys(stored)).toEqual([hexId(2)]);
  });

  it("상한을 넘지 않으며 최근에 조회한 항목을 남깁니다.", async () => {
    const limit = CACHE_LIMITS.maxChannelEntries;
    const extra = 100;

    const older = new Map<string, number>();
    for (let index = 0; index < limit; index += 1) {
      older.set(hexId(index), index);
    }
    await mergeChannelCache(older, NOW);

    const newer = new Map<string, number>();
    for (let index = 0; index < extra; index += 1) {
      newer.set(hexId(limit + index), 1_000 + index);
    }
    await mergeChannelCache(newer, NOW + 60_000);

    const stored = await readChannelCache();
    expect(Object.keys(stored)).toHaveLength(limit);

    // 최신 항목은 하나도 잘려 나가지 않는다.
    for (const [channelId, followerCount] of newer) {
      expect(stored[channelId]).toEqual({ followerCount, fetchedAt: NOW + 60_000 });
    }
    // 상한을 맞추기 위해 그만큼의 오래된 항목이 빠졌다.
    const survivingOld = [...older.keys()].filter((id) => stored[id] !== undefined);
    expect(survivingOld).toHaveLength(limit - extra);
  });

  it("정리한 캐시는 다시 비울 수 있습니다.", async () => {
    await mergeChannelCache(new Map([[hexId(1), 10]]), NOW);
    expect(Object.keys(await readChannelCache())).toHaveLength(1);

    await clearChannelCache();
    expect(await readChannelCache()).toEqual({});
  });
});

/* ------------------------------------------------------------------ */
/* 라이브 캐시                                                          */
/* ------------------------------------------------------------------ */

const COVERAGE: ScanCoverage = {
  strategy: "viewer-tail",
  viewerCeiling: 10,
  viewerFrontier: 3,
  exhausted: false,
};

function candidateOf(index: number): StreamCandidate {
  return {
    liveId: String(1_000 + index),
    channelId: hexId(index),
    channelName: `채널 ${index}`,
    channelImageUrl: null,
    liveTitle: `테스트 방송 ${index}`,
    thumbnailUrl: null,
    viewerCount: index % 30,
    followerCount: null,
    followerState: "idle",
    startedAtRaw: "2026-08-11 00:11:17",
    startedAtEpoch: NOW - index * 1_000,
    adult: false,
    verified: false,
    categoryName: null,
    sourceFetchedAt: NOW,
  };
}

describe("라이브 캐시", () => {
  it("저장한 후보와 커버리지를 그대로 읽어 오며 TTL 경계를 지킵니다.", async () => {
    const payload: LiveCachePayload = {
      candidates: [candidateOf(1), candidateOf(2)],
      coverage: COVERAGE,
      scannedPages: 3,
      scannedLives: 120,
      viewerCeiling: 10,
    };

    expect(await writeLiveCache(payload, NOW)).toBe(true);

    const entry = await readLiveCache();
    expect(entry?.payload.candidates).toHaveLength(2);
    expect(entry?.payload.coverage).toEqual(COVERAGE);
    expect(entry?.payload.scannedPages).toBe(3);
    expect(entry?.payload.viewerCeiling).toBe(10);

    expect(freshnessOf(entry, NOW)).toBe("fresh");
    expect(freshnessOf(entry, NOW + CACHE_TTL.liveFreshMs - 1)).toBe("fresh");
    expect(freshnessOf(entry, NOW + CACHE_TTL.liveFreshMs)).toBe("stale");
    expect(freshnessOf(entry, NOW + CACHE_TTL.liveStaleMs)).toBe("expired");
  });

  it("후보 수 상한을 넘으면 잘라서 저장합니다.", async () => {
    const overflow = CACHE_LIMITS.maxLiveCandidates + 10;
    const payload: LiveCachePayload = {
      candidates: Array.from({ length: overflow }, (_, index) => candidateOf(index)),
      coverage: COVERAGE,
      scannedPages: 20,
      scannedLives: overflow,
      viewerCeiling: 10,
    };

    await writeLiveCache(payload, NOW);

    const entry = await readLiveCache();
    expect(entry?.payload.candidates).toHaveLength(CACHE_LIMITS.maxLiveCandidates);
  });

  it("모든 캐시를 한 번에 비울 수 있습니다.", async () => {
    await writeLiveCache(
      {
        candidates: [candidateOf(1)],
        coverage: COVERAGE,
        scannedPages: 1,
        scannedLives: 1,
        viewerCeiling: 10,
      },
      NOW,
    );
    await mergeChannelCache(new Map([[hexId(1), 10]]), NOW);

    await clearAllCaches();

    expect(await readLiveCache()).toBeUndefined();
    expect(await readChannelCache()).toEqual({});
  });
});
