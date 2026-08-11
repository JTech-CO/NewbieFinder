import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DiscoveryError } from "../../src/domain/errors";
import { CACHE_TTL, DISCOVERY_BUDGET } from "../../src/shared/constants";
import { createFollowerResolver } from "../../src/application/follower-resolver";
import type { FollowerOutcome } from "../../src/application/follower-resolver";
import { createChzzkClient } from "../../src/infrastructure/chzzk-web/client";
import type { ChzzkClient, RequestOptions } from "../../src/infrastructure/chzzk-web/client";
import type { ChannelInfoResult } from "../../src/infrastructure/chzzk-web/channel-adapter";
import type { LivePageResult } from "../../src/infrastructure/chzzk-web/live-adapter";
import { mergeChannelCache, readChannelCache } from "../../src/infrastructure/storage/cache-store";
import { resetMemoryStores } from "../../src/infrastructure/storage/chrome-storage";

/**
 * 팔로워 판정 통합 테스트.
 *
 * 확인하는 것
 *  - 캐시가 신선하면 네트워크를 건드리지 않는다
 *  - 동시 실행이 4를 넘지 않는다
 *  - 429 를 만나면 우회하지 않고 남은 요청을 흘려보낸다
 *  - 알 수 없는 채널 응답을 "팔로워 0명"으로 오해하지 않는다
 */

const NOW = 1_775_000_000_000;

// 팔로워 캐시는 메모리 폴백에 쌓이므로 케이스마다 비운다.
beforeEach(() => {
  resetMemoryStores();
});

afterEach(() => {
  resetMemoryStores();
});

/* ------------------------------------------------------------------ */
/* 도우미                                                               */
/* ------------------------------------------------------------------ */

function hexId(index: number): string {
  return index.toString(16).padStart(32, "0");
}

function hexIds(count: number, offset = 0): string[] {
  return Array.from({ length: count }, (_, index) => hexId(offset + index));
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolvedInfo(channelId: string, followerCount: number): ChannelInfoResult {
  return {
    kind: "resolved",
    channelId,
    followerCount,
    channelImageUrl: null,
    verified: false,
    openLive: true,
  };
}

/** 라이브 목록을 쓰지 않는 채널 전용 스텁 클라이언트 */
function createChannelClient(
  handler: (channelId: string) => Promise<ChannelInfoResult>,
): ChzzkClient {
  return {
    fetchLivePage(): Promise<LivePageResult> {
      throw new Error("이 테스트는 라이브 목록을 사용하지 않습니다.");
    },
    fetchChannelInfo(channelId): Promise<ChannelInfoResult> {
      return handler(channelId);
    },
  };
}

function rawChannel(channelId: string, followerCount: number): unknown {
  return {
    code: 200,
    message: null,
    content: {
      channelId,
      channelName: `채널 ${channelId.slice(-4)}`,
      channelImageUrl: null,
      verifiedMark: false,
      channelType: "STREAMING",
      followerCount,
      openLive: true,
    },
  };
}

/** 존재하지 않는 채널을 물었을 때 오는 자리표시자 응답 */
function rawUnknownChannel(): unknown {
  return {
    code: 200,
    message: null,
    content: {
      channelId: null,
      channelName: "(알 수 없음)",
      channelImageUrl: null,
      verifiedMark: false,
      channelType: null,
      followerCount: 0,
      openLive: false,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 캐시                                                                 */
/* ------------------------------------------------------------------ */

describe("팔로워 판정: 캐시", () => {
  it("신선한 캐시가 있으면 네트워크 요청을 만들지 않습니다.", async () => {
    const channelId = hexId(1);
    await mergeChannelCache(new Map([[channelId, 77]]), NOW);

    let calls = 0;
    const client = createChannelClient(async (id) => {
      calls += 1;
      return resolvedInfo(id, 5);
    });

    const outcomes: FollowerOutcome[] = [];
    const resolver = createFollowerResolver(client, { now: () => NOW + 1_000 });
    const summary = await resolver.resolve([channelId], {
      onResolved: (outcome) => outcomes.push(outcome),
    });

    expect(calls).toBe(0);
    expect(summary).toEqual({ resolved: 1, failed: 0, skipped: 0, haltedBy: null });
    expect(outcomes).toEqual([{ kind: "resolved", channelId, followerCount: 77 }]);
  });

  it("캐시에 없는 채널만 네트워크로 조회합니다.", async () => {
    const cachedId = hexId(2);
    const missingId = hexId(3);
    await mergeChannelCache(new Map([[cachedId, 11]]), NOW);

    const requested: string[] = [];
    const client = createChannelClient(async (id) => {
      requested.push(id);
      return resolvedInfo(id, 22);
    });

    const resolver = createFollowerResolver(client, { now: () => NOW + 1_000 });
    const summary = await resolver.resolve([cachedId, missingId]);

    expect(requested).toEqual([missingId]);
    expect(summary.resolved).toBe(2);
    expect(summary.failed).toBe(0);
  });

  it("신선도 기한이 지난 캐시는 다시 조회합니다.", async () => {
    const channelId = hexId(4);
    await mergeChannelCache(new Map([[channelId, 11]]), NOW);

    const requested: string[] = [];
    const client = createChannelClient(async (id) => {
      requested.push(id);
      return resolvedInfo(id, 99);
    });

    const resolver = createFollowerResolver(client, {
      now: () => NOW + CACHE_TTL.channelFreshMs,
    });
    const summary = await resolver.resolve([channelId]);

    expect(requested).toEqual([channelId]);
    expect(summary.resolved).toBe(1);
  });

  it("조회에 성공한 팔로워 수는 캐시에 남아 다음 실행에서 재사용됩니다.", async () => {
    const ids = hexIds(3, 10);
    let calls = 0;
    const client = createChannelClient(async (id) => {
      calls += 1;
      return resolvedInfo(id, 30);
    });

    const resolver = createFollowerResolver(client, { now: () => NOW });
    await resolver.resolve(ids);
    expect(calls).toBe(3);

    const stored = await readChannelCache();
    expect(Object.keys(stored).sort()).toEqual(ids.slice().sort());

    const second = await resolver.resolve(ids);
    expect(calls).toBe(3);
    expect(second.resolved).toBe(3);
  });

  it("같은 채널 ID 가 중복으로 들어와도 한 번만 조회합니다.", async () => {
    const channelId = hexId(20);
    const other = hexId(21);
    const requested: string[] = [];
    const client = createChannelClient(async (id) => {
      requested.push(id);
      return resolvedInfo(id, 1);
    });

    const resolver = createFollowerResolver(client, { now: () => NOW });
    const summary = await resolver.resolve([channelId, channelId, other, channelId]);

    expect(requested.slice().sort()).toEqual([channelId, other].sort());
    expect(summary.resolved).toBe(2);
  });

  it("조회 대상이 없으면 아무 요청도 만들지 않습니다.", async () => {
    let calls = 0;
    const client = createChannelClient(async (id) => {
      calls += 1;
      return resolvedInfo(id, 1);
    });

    const resolver = createFollowerResolver(client, { now: () => NOW });
    const summary = await resolver.resolve([]);

    expect(calls).toBe(0);
    expect(summary).toEqual({ resolved: 0, failed: 0, skipped: 0, haltedBy: null });
  });
});

/* ------------------------------------------------------------------ */
/* 동시성                                                               */
/* ------------------------------------------------------------------ */

describe("팔로워 판정: 동시성", () => {
  it("동시에 실행되는 채널 요청이 4개를 넘지 않습니다.", async () => {
    const ids = hexIds(24, 100);
    let active = 0;
    let maxActive = 0;

    const client = createChannelClient(async (id) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(2);
      active -= 1;
      return resolvedInfo(id, 5);
    });

    const resolver = createFollowerResolver(client, { now: () => NOW });
    const summary = await resolver.resolve(ids);

    expect(summary.resolved).toBe(24);
    expect(maxActive).toBe(DISCOVERY_BUDGET.channelConcurrency);
    expect(active).toBe(0);
  });

  it("예산보다 많은 채널이 들어오면 초과분은 시도하지 않고 남겨 둡니다.", async () => {
    const ids = hexIds(10, 200);
    const requested: string[] = [];
    const client = createChannelClient(async (id) => {
      requested.push(id);
      return resolvedInfo(id, 5);
    });

    const resolver = createFollowerResolver(client, { now: () => NOW });
    const summary = await resolver.resolve(ids, { maxNetworkLookups: 4 });

    expect(requested).toHaveLength(4);
    expect(summary.resolved).toBe(4);
    expect(summary.skipped).toBe(6);
    expect(summary.haltedBy).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 실패 처리                                                            */
/* ------------------------------------------------------------------ */

describe("팔로워 판정: 실패 처리", () => {
  it("429 를 만나면 남은 요청을 보내지 않고 중단합니다.", async () => {
    const total = 60;
    const ids = hexIds(total, 300);
    let calls = 0;

    const client = createChannelClient(async () => {
      calls += 1;
      throw new DiscoveryError("RATE_LIMITED", { status: 429 });
    });

    const resolver = createFollowerResolver(client, { now: () => NOW });
    const summary = await resolver.resolve(ids);

    expect(summary.haltedBy).toBe("RATE_LIMITED");
    // 우회하지 않고 멈춘다. 전체를 다 물어보지 않는다.
    expect(calls).toBeLessThan(total);
    // 이미 출발한 요청까지만 마무리하고 대기 큐는 흘려보낸다.
    expect(calls).toBeLessThanOrEqual(DISCOVERY_BUDGET.channelConcurrency * 2);
    expect(summary.resolved).toBe(0);
  });

  it("403 을 만나도 같은 방식으로 즉시 멈춥니다.", async () => {
    const total = 40;
    const ids = hexIds(total, 400);
    let calls = 0;

    const client = createChannelClient(async () => {
      calls += 1;
      throw new DiscoveryError("ACCESS_DENIED", { status: 403 });
    });

    const resolver = createFollowerResolver(client, { now: () => NOW });
    const summary = await resolver.resolve(ids);

    expect(summary.haltedBy).toBe("ACCESS_DENIED");
    expect(calls).toBeLessThan(total);
    expect(calls).toBeLessThanOrEqual(DISCOVERY_BUDGET.channelConcurrency * 2);
  });

  it("응답 형식이 깨진 채널은 확인 실패로 남기고 나머지는 계속 조회합니다.", async () => {
    const ids = hexIds(6, 500);
    const brokenId = ids[2];

    const client = createChannelClient(async (id) => {
      if (id === brokenId) throw new DiscoveryError("CHANNEL_SCHEMA_CHANGED");
      return resolvedInfo(id, 12);
    });

    const outcomes: FollowerOutcome[] = [];
    const resolver = createFollowerResolver(client, { now: () => NOW });
    const summary = await resolver.resolve(ids, {
      onResolved: (outcome) => outcomes.push(outcome),
    });

    expect(summary.resolved).toBe(5);
    expect(summary.failed).toBe(1);
    expect(summary.haltedBy).toBeNull();
    expect(outcomes.filter((outcome) => outcome.kind === "failed")).toEqual([
      { kind: "failed", channelId: brokenId },
    ]);

    // 실패한 채널은 캐시에도 남기지 않는다.
    const stored = await readChannelCache();
    expect(Object.keys(stored)).toHaveLength(5);
    expect(Object.keys(stored)).not.toContain(brokenId);
  });

  it("알 수 없는 채널 응답은 팔로워 0명이 아니라 확인 실패로 분류합니다.", async () => {
    const knownId = hexId(600);
    const unknownId = hexId(601);

    const requestJson = async (url: URL, options: RequestOptions): Promise<unknown> => {
      options.signal?.throwIfAborted();
      const channelId = url.pathname.split("/").at(-1) ?? "";
      return channelId === knownId ? rawChannel(knownId, 9) : rawUnknownChannel();
    };

    const client = createChzzkClient({ requestJson, now: () => NOW });
    const outcomes: FollowerOutcome[] = [];
    const resolver = createFollowerResolver(client, { now: () => NOW });
    const summary = await resolver.resolve([knownId, unknownId], {
      onResolved: (outcome) => outcomes.push(outcome),
    });

    expect(summary.resolved).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.haltedBy).toBeNull();
    expect(outcomes).toContainEqual({ kind: "failed", channelId: unknownId });
    expect(outcomes).toContainEqual({ kind: "resolved", channelId: knownId, followerCount: 9 });

    const stored = await readChannelCache();
    expect(Object.keys(stored)).toEqual([knownId]);
  });

  it("취소된 신호로 실행하면 요청을 보내지 않고 실패로도 세지 않습니다.", async () => {
    const ids = hexIds(8, 700);
    let calls = 0;
    const client = createChannelClient(async (id) => {
      calls += 1;
      return resolvedInfo(id, 3);
    });

    const controller = new AbortController();
    controller.abort();

    const resolver = createFollowerResolver(client, { now: () => NOW });
    const summary = await resolver.resolve(ids, { signal: controller.signal });

    expect(calls).toBe(0);
    expect(summary.resolved).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.haltedBy).toBeNull();
  });
});
