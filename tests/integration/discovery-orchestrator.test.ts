import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyFilters } from "../../src/domain/filters";
import { DiscoveryError } from "../../src/domain/errors";
import type {
  FollowerState,
  LiveCursor,
  ScanCoverage,
  StreamCandidate,
} from "../../src/domain/models";
import { DEFAULT_SETTINGS } from "../../src/domain/settings";
import type { FinderSettings } from "../../src/domain/settings";
import { DISCOVERY_BUDGET } from "../../src/shared/constants";
import { computeViewerFrontier, mergeCandidate } from "../../src/application/discovery-events";
import type {
  DiscoveryResumeToken,
  DiscoverySnapshot,
} from "../../src/application/discovery-events";
import {
  createDiscoveryOrchestrator,
  selectStrategy,
} from "../../src/application/discovery-orchestrator";
import { createFollowerResolver } from "../../src/application/follower-resolver";
import type {
  FollowerResolveSummary,
  FollowerResolver,
} from "../../src/application/follower-resolver";
import { resolveBudgetLimits } from "../../src/application/request-budget";
import { createChzzkClient } from "../../src/infrastructure/chzzk-web/client";
import type { RequestOptions } from "../../src/infrastructure/chzzk-web/client";
import { seedCursorForViewerCeiling } from "../../src/infrastructure/chzzk-web/endpoints";
import { resetMemoryStores } from "../../src/infrastructure/storage/chrome-storage";

/**
 * 애플리케이션 계층 통합 테스트.
 *
 * 여기서 검증하는 것은 "정직한 결과"다.
 *  - 확인하지 못한 범위를 확인한 것처럼 말하지 않는가
 *  - 실패한 채널을 조건 충족으로 추정하지 않는가
 *  - 요청 제한을 만났을 때 남은 요청을 계속 보내지 않는가
 */

const FIXED_NOW = 1_775_000_000_000;

/* ------------------------------------------------------------------ */
/* 테스트 격리                                                          */
/* ------------------------------------------------------------------ */

// 팔로워 캐시는 메모리 폴백에 쌓이므로 케이스마다 비운다.
beforeEach(() => {
  resetMemoryStores();
});

afterEach(() => {
  resetMemoryStores();
});

/* ------------------------------------------------------------------ */
/* 픽스처                                                               */
/* ------------------------------------------------------------------ */

/** 실측 응답과 같은 32자리 소문자 16진수 채널 ID */
function hexId(index: number): string {
  return index.toString(16).padStart(32, "0");
}

interface LiveFixture {
  readonly liveId: number;
  readonly channelId: string;
  readonly viewerCount: number;
  readonly openDate?: string;
  readonly adult?: boolean;
}

function rawLiveItem(fixture: LiveFixture): unknown {
  return {
    liveId: fixture.liveId,
    liveTitle: `테스트 방송 ${fixture.liveId}`,
    liveImageUrl: null,
    defaultThumbnailImageUrl: null,
    concurrentUserCount: fixture.viewerCount,
    openDate: fixture.openDate ?? "2026-08-11 00:11:17",
    adult: fixture.adult ?? false,
    categoryType: "GAME",
    liveCategory: "test_category",
    liveCategoryValue: "테스트 카테고리",
    channel: {
      channelId: fixture.channelId,
      channelName: `채널 ${fixture.channelId.slice(-4)}`,
      channelImageUrl: null,
      verifiedMark: false,
    },
  };
}

function rawLivePage(items: readonly LiveFixture[], next: LiveCursor | null): unknown {
  return {
    code: 200,
    message: null,
    content: {
      size: items.length,
      data: items.map(rawLiveItem),
      page: { next, prev: null },
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

interface CandidateOverrides {
  readonly liveId: string;
  readonly channelId: string;
  readonly viewerCount?: number;
  readonly followerCount?: number | null;
  readonly followerState?: FollowerState;
  readonly startedAtEpoch?: number | null;
  readonly startedAtRaw?: string;
}

function candidateOf(overrides: CandidateOverrides): StreamCandidate {
  return {
    liveId: overrides.liveId,
    channelId: overrides.channelId,
    channelName: `채널 ${overrides.channelId.slice(-4)}`,
    channelImageUrl: null,
    liveTitle: `방송 ${overrides.liveId}`,
    thumbnailUrl: null,
    viewerCount: overrides.viewerCount ?? 3,
    followerCount: overrides.followerCount ?? null,
    followerState: overrides.followerState ?? "idle",
    startedAtRaw: overrides.startedAtRaw ?? "2026-08-11 00:00:00",
    startedAtEpoch: overrides.startedAtEpoch === undefined ? 1_000_000 : overrides.startedAtEpoch,
    adult: false,
    verified: false,
    categoryName: null,
    sourceFetchedAt: FIXED_NOW,
  };
}

function makeSettings(input: {
  readonly viewer?: { readonly enabled: boolean; readonly max: number };
  readonly follower?: { readonly enabled: boolean; readonly max: number };
  readonly recentFirst?: boolean;
}): FinderSettings {
  return {
    ...DEFAULT_SETTINGS,
    viewerFilter: input.viewer ?? DEFAULT_SETTINGS.viewerFilter,
    followerFilter: input.follower ?? DEFAULT_SETTINGS.followerFilter,
    recentFirst: input.recentFirst ?? DEFAULT_SETTINGS.recentFirst,
  };
}

/* ------------------------------------------------------------------ */
/* 가짜 네트워크                                                        */
/* ------------------------------------------------------------------ */

interface LiveCall {
  readonly index: number;
  readonly url: URL;
}

interface ChannelCall {
  readonly channelId: string;
  readonly url: URL;
}

interface Recorder {
  readonly liveUrls: URL[];
  readonly channelIds: string[];
  readonly requestJson: (url: URL, options: RequestOptions) => Promise<unknown>;
}

function createRecorder(handlers: {
  readonly live?: (call: LiveCall) => unknown;
  readonly channel?: (call: ChannelCall) => unknown;
}): Recorder {
  const liveUrls: URL[] = [];
  const channelIds: string[] = [];

  const requestJson = async (url: URL, options: RequestOptions): Promise<unknown> => {
    options.signal?.throwIfAborted();

    if (url.pathname === "/service/v1/lives") {
      const index = liveUrls.length;
      liveUrls.push(url);
      if (!handlers.live) throw new Error("라이브 응답 핸들러를 지정하지 않았습니다.");
      return handlers.live({ index, url });
    }

    const channelId = url.pathname.split("/").at(-1) ?? "";
    channelIds.push(channelId);
    if (!handlers.channel) throw new Error("채널 응답 핸들러를 지정하지 않았습니다.");
    return handlers.channel({ channelId, url });
  };

  return { liveUrls, channelIds, requestJson };
}

interface SpyResolver {
  readonly resolver: FollowerResolver;
  readonly calls: string[][];
}

function createSpyResolver(summary: Partial<FollowerResolveSummary> = {}): SpyResolver {
  const calls: string[][] = [];
  const resolver: FollowerResolver = {
    async resolve(channelIds) {
      calls.push([...channelIds]);
      return { resolved: 0, failed: 0, skipped: 0, haltedBy: null, ...summary };
    },
  };
  return { resolver, calls };
}

interface RunOutput {
  readonly snapshot: DiscoverySnapshot;
  readonly resume: DiscoveryResumeToken | null;
  readonly snapshots: DiscoverySnapshot[];
}

async function runOrchestrator(options: {
  readonly settings: FinderSettings;
  readonly requestJson: (url: URL, options: RequestOptions) => Promise<unknown>;
  readonly followerResolver?: FollowerResolver;
  readonly signal?: AbortSignal;
  readonly resume?: DiscoveryResumeToken | null;
  readonly existingCandidates?: readonly StreamCandidate[];
}): Promise<RunOutput> {
  const client = createChzzkClient({ requestJson: options.requestJson, now: () => FIXED_NOW });
  const followerResolver =
    options.followerResolver ?? createFollowerResolver(client, { now: () => FIXED_NOW });
  const orchestrator = createDiscoveryOrchestrator({
    client,
    followerResolver,
    now: () => FIXED_NOW,
    emitIntervalMs: 0,
  });

  const snapshots: DiscoverySnapshot[] = [];
  const result = await orchestrator.run({
    settings: options.settings,
    signal: options.signal ?? new AbortController().signal,
    resume: options.resume ?? null,
    existingCandidates: options.existingCandidates ?? [],
    onSnapshot: (snapshot) => {
      snapshots.push(snapshot);
    },
  });

  return { snapshot: result.snapshot, resume: result.resume, snapshots };
}

/* ------------------------------------------------------------------ */
/* 시나리오                                                             */
/* ------------------------------------------------------------------ */

describe("탐색 오케스트레이터: 정상 경로", () => {
  it("라이브와 채널 조회가 모두 성공하면 완전한 결과를 만듭니다.", async () => {
    const ids = [hexId(1), hexId(2), hexId(3)];
    const followers: Record<string, number> = {
      [ids[0] ?? ""]: 12,
      [ids[1] ?? ""]: 34,
      [ids[2] ?? ""]: 48,
    };

    const recorder = createRecorder({
      live: () =>
        rawLivePage(
          [
            { liveId: 101, channelId: ids[0] ?? "", viewerCount: 1 },
            { liveId: 102, channelId: ids[1] ?? "", viewerCount: 5 },
            { liveId: 103, channelId: ids[2] ?? "", viewerCount: 9 },
          ],
          null,
        ),
      channel: ({ channelId }) => rawChannel(channelId, followers[channelId] ?? 0),
    });

    const { snapshot, resume } = await runOrchestrator({
      settings: makeSettings({
        viewer: { enabled: true, max: 10 },
        follower: { enabled: true, max: 50 },
      }),
      requestJson: recorder.requestJson,
    });

    expect(snapshot.state.phase).toBe("ready");
    expect(snapshot.state.partialReason).toBeNull();
    expect(snapshot.state.errorCode).toBeNull();
    expect(snapshot.state.coverage.exhausted).toBe(true);
    expect(snapshot.state.coverage.strategy).toBe("viewer-tail");
    expect(snapshot.state.coverage.viewerCeiling).toBe(10);
    // 커서를 끝까지 소진했으므로 0명까지 빠짐없이 훑었다.
    expect(snapshot.state.coverage.viewerFrontier).toBe(0);
    expect(snapshot.state.hasNextPage).toBe(false);
    expect(snapshot.state.matchedResults).toBe(3);
    expect(snapshot.state.resolvedChannels).toBe(3);
    expect(snapshot.state.unresolvedChannels).toBe(0);
    expect(snapshot.state.pendingChannels).toBe(0);
    expect(snapshot.state.scannedPages).toBe(1);
    expect(snapshot.state.scannedLives).toBe(3);
    expect(resume).toBeNull();
    expect(recorder.liveUrls).toHaveLength(1);
    expect(recorder.channelIds.slice().sort()).toEqual(ids.slice().sort());
  });

  it("이어받기 토큰을 받으면 그 커서에서 이어 조회하고 누적 카운트를 유지합니다.", async () => {
    const resumeCoverage: ScanCoverage = {
      strategy: "viewer-tail",
      viewerCeiling: 10,
      viewerFrontier: 5,
      exhausted: false,
    };
    const resumeToken: DiscoveryResumeToken = {
      cursor: { concurrentUserCount: 4, liveId: 77 },
      coverage: resumeCoverage,
      scannedPages: 3,
      scannedLives: 120,
    };

    const recorder = createRecorder({
      live: () => rawLivePage([{ liveId: 900, channelId: hexId(9), viewerCount: 2 }], null),
    });

    const { snapshot } = await runOrchestrator({
      settings: makeSettings({
        viewer: { enabled: true, max: 10 },
        follower: { enabled: false, max: 50 },
      }),
      requestJson: recorder.requestJson,
      followerResolver: createSpyResolver().resolver,
      resume: resumeToken,
    });

    const first = recorder.liveUrls[0];
    expect(first?.searchParams.get("concurrentUserCount")).toBe("4");
    expect(first?.searchParams.get("liveId")).toBe("77");
    expect(snapshot.state.scannedPages).toBe(4);
    expect(snapshot.state.scannedLives).toBe(121);
  });
});

describe("탐색 오케스트레이터: 부분 실패", () => {
  it("2페이지 중 2페이지가 실패해도 1페이지 결과를 부분 결과로 남깁니다.", async () => {
    const recorder = createRecorder({
      live: ({ index }) => {
        if (index === 0) {
          return rawLivePage(
            [
              { liveId: 201, channelId: hexId(11), viewerCount: 2 },
              { liveId: 202, channelId: hexId(12), viewerCount: 4 },
            ],
            { concurrentUserCount: 4, liveId: 202 },
          );
        }
        throw new DiscoveryError("NETWORK_OFFLINE");
      },
    });

    const { snapshot } = await runOrchestrator({
      settings: makeSettings({
        viewer: { enabled: true, max: 10 },
        follower: { enabled: false, max: 50 },
      }),
      requestJson: recorder.requestJson,
      followerResolver: createSpyResolver().resolver,
    });

    expect(recorder.liveUrls).toHaveLength(2);
    expect(snapshot.state.phase).toBe("partial");
    expect(snapshot.state.partialReason).toBe("network");
    expect(snapshot.state.errorCode).toBe("NETWORK_OFFLINE");
    expect(snapshot.candidates).toHaveLength(2);
    expect(snapshot.state.scannedPages).toBe(1);
    expect(snapshot.state.matchedResults).toBe(2);
    expect(snapshot.state.coverage.exhausted).toBe(false);
  });

  it("채널 20개 중 3개가 실패하면 17개만 판정하고 3개는 미확인으로 남깁니다.", async () => {
    const total = 20;
    const failing = new Set([hexId(105), hexId(110), hexId(115)]);
    const items: LiveFixture[] = Array.from({ length: total }, (_, index) => ({
      liveId: 300 + index,
      channelId: hexId(100 + index),
      viewerCount: index + 1,
    }));

    const recorder = createRecorder({
      live: () => rawLivePage(items, null),
      channel: ({ channelId }) => {
        if (failing.has(channelId)) throw new DiscoveryError("CHANNEL_SCHEMA_CHANGED");
        return rawChannel(channelId, 20);
      },
    });

    const settings = makeSettings({
      viewer: { enabled: true, max: 30 },
      follower: { enabled: true, max: 100 },
    });

    const { snapshot } = await runOrchestrator({
      settings,
      requestJson: recorder.requestJson,
    });

    expect(snapshot.state.resolvedChannels).toBe(17);
    expect(snapshot.state.unresolvedChannels).toBe(3);
    expect(snapshot.state.matchedResults).toBe(17);

    const outcome = applyFilters(snapshot.candidates, settings);
    expect(outcome.matched).toHaveLength(17);
    expect(outcome.unresolvedFollower).toBe(3);
    // 확인하지 못한 채널을 조건 충족으로 추정하지 않는다.
    for (const matched of outcome.matched) {
      expect(failing.has(matched.channelId)).toBe(false);
    }
    for (const channelId of failing) {
      const candidate = snapshot.candidates.find((item) => item.channelId === channelId);
      expect(candidate?.followerState).toBe("failed");
      expect(candidate?.followerCount).toBeNull();
    }
  });
});

describe("탐색 오케스트레이터: 요청 제한", () => {
  it("라이브 목록에서 429 를 만나면 남은 페이지를 요청하지 않고 rate-limit 으로 알립니다.", async () => {
    const recorder = createRecorder({
      live: ({ index }) => {
        if (index === 0) {
          return rawLivePage([{ liveId: 401, channelId: hexId(21), viewerCount: 3 }], {
            concurrentUserCount: 3,
            liveId: 401,
          });
        }
        throw new DiscoveryError("RATE_LIMITED", { status: 429 });
      },
    });

    const { snapshot } = await runOrchestrator({
      settings: makeSettings({
        viewer: { enabled: true, max: 10 },
        follower: { enabled: false, max: 50 },
      }),
      requestJson: recorder.requestJson,
      followerResolver: createSpyResolver().resolver,
    });

    // 429 이후 추가 페이지 요청이 없어야 한다.
    expect(recorder.liveUrls).toHaveLength(2);
    expect(snapshot.state.errorCode).toBe("RATE_LIMITED");
    expect(snapshot.state.partialReason).toBe("rate-limit");
    expect(snapshot.state.phase).toBe("partial");
    expect(snapshot.candidates).toHaveLength(1);
  });

  it("채널 조회에서 429 를 만나면 남은 채널 요청을 흘려보냅니다.", async () => {
    const total = 60;
    const items: LiveFixture[] = Array.from({ length: total }, (_, index) => ({
      liveId: 500 + index,
      channelId: hexId(200 + index),
      viewerCount: (index % 20) + 1,
    }));

    const recorder = createRecorder({
      live: () => rawLivePage(items, null),
      channel: () => {
        throw new DiscoveryError("RATE_LIMITED", { status: 429 });
      },
    });

    const { snapshot } = await runOrchestrator({
      settings: makeSettings({
        viewer: { enabled: true, max: 30 },
        follower: { enabled: true, max: 100 },
      }),
      requestJson: recorder.requestJson,
    });

    expect(snapshot.state.partialReason).toBe("rate-limit");
    expect(snapshot.state.phase).toBe("partial");
    expect(recorder.channelIds.length).toBeLessThan(total);
    expect(recorder.channelIds.length).toBeLessThanOrEqual(DISCOVERY_BUDGET.channelConcurrency * 2);
  });
});

describe("탐색 오케스트레이터: 계약 파손", () => {
  it("봉투 구조가 바뀌면 후보를 만들지 않고 LIVE_SCHEMA_CHANGED 로 멈춥니다.", async () => {
    const recorder = createRecorder({ live: () => ({ hello: "world" }) });
    const spy = createSpyResolver();

    const { snapshot } = await runOrchestrator({
      settings: makeSettings({
        viewer: { enabled: true, max: 10 },
        follower: { enabled: true, max: 50 },
      }),
      requestJson: recorder.requestJson,
      followerResolver: spy.resolver,
    });

    expect(snapshot.candidates).toHaveLength(0);
    expect(snapshot.state.phase).toBe("error");
    expect(snapshot.state.errorCode).toBe("LIVE_SCHEMA_CHANGED");
    expect(snapshot.state.matchedResults).toBe(0);
    // 계약이 깨진 상태에서 채널 요청을 더 보내지 않는다.
    expect(spy.calls).toHaveLength(0);
    expect(recorder.channelIds).toHaveLength(0);
  });

  it("항목 스키마가 전부 바뀌어도 기본값으로 메우지 않고 멈춥니다.", async () => {
    const recorder = createRecorder({
      live: () => ({
        code: 200,
        message: null,
        content: { size: 2, data: [{ unexpected: 1 }, { unexpected: 2 }], page: { next: null } },
      }),
    });

    const { snapshot } = await runOrchestrator({
      settings: makeSettings({
        viewer: { enabled: true, max: 10 },
        follower: { enabled: false, max: 50 },
      }),
      requestJson: recorder.requestJson,
      followerResolver: createSpyResolver().resolver,
    });

    expect(snapshot.candidates).toHaveLength(0);
    expect(snapshot.state.phase).toBe("error");
    expect(snapshot.state.errorCode).toBe("LIVE_SCHEMA_CHANGED");
  });
});

describe("탐색 오케스트레이터: 예산", () => {
  it("페이지 예산을 다 쓰고도 다음 커서가 남으면 page-budget 과 이어받기 토큰을 남깁니다.", async () => {
    const limits = resolveBudgetLimits(false);
    const recorder = createRecorder({
      live: ({ index }) =>
        rawLivePage([{ liveId: 600 + index, channelId: hexId(300 + index), viewerCount: 2 }], {
          concurrentUserCount: 10,
          liveId: 10_000 - index,
        }),
    });

    const spy = createSpyResolver();
    const { snapshot, resume } = await runOrchestrator({
      settings: makeSettings({
        viewer: { enabled: true, max: 10 },
        follower: { enabled: false, max: 50 },
      }),
      requestJson: recorder.requestJson,
      followerResolver: spy.resolver,
    });

    expect(recorder.liveUrls).toHaveLength(limits.maxLivePages);
    expect(snapshot.state.partialReason).toBe("page-budget");
    expect(snapshot.state.phase).toBe("partial");
    expect(snapshot.state.hasNextPage).toBe(true);
    expect(snapshot.state.coverage.exhausted).toBe(false);
    expect(resume).not.toBeNull();
    expect(resume?.cursor).toEqual({
      concurrentUserCount: 10,
      liveId: 10_000 - (limits.maxLivePages - 1),
    });
    expect(resume?.scannedPages).toBe(limits.maxLivePages);
    expect(spy.calls).toHaveLength(0);
  });

  it("팔로워 조건이 켜지면 채널 예산에 맞춰 라이브 페이지 예산도 함께 줄어듭니다.", () => {
    const withFollower = resolveBudgetLimits(true);
    const withoutFollower = resolveBudgetLimits(false);

    expect(withoutFollower.maxLivePages).toBe(DISCOVERY_BUDGET.maxLivePagesPerRun);
    expect(withoutFollower.maxChannelLookups).toBe(0);
    expect(withFollower.maxChannelLookups).toBe(DISCOVERY_BUDGET.maxChannelLookupsPerRun);
    expect(withFollower.maxLivePages).toBeLessThan(withoutFollower.maxLivePages);
  });
});

describe("탐색 오케스트레이터: 전략", () => {
  it("viewer-tail 전략은 시드 커서를 (시청자 상한 + 1, 0) 으로 요청합니다.", async () => {
    const recorder = createRecorder({
      live: ({ index }) =>
        index === 0
          ? rawLivePage([{ liveId: 701, channelId: hexId(41), viewerCount: 6 }], {
              concurrentUserCount: 4,
              liveId: 12_345,
            })
          : rawLivePage([{ liveId: 702, channelId: hexId(42), viewerCount: 3 }], null),
    });

    const settings = makeSettings({
      viewer: { enabled: true, max: 7 },
      follower: { enabled: false, max: 50 },
    });
    expect(selectStrategy(settings)).toBe("viewer-tail");
    expect(seedCursorForViewerCeiling(7)).toEqual({ concurrentUserCount: 8, liveId: 0 });

    const { snapshot, snapshots } = await runOrchestrator({
      settings,
      requestJson: recorder.requestJson,
      followerResolver: createSpyResolver().resolver,
    });

    const first = recorder.liveUrls[0];
    expect(first?.pathname).toBe("/service/v1/lives");
    expect(first?.searchParams.get("concurrentUserCount")).toBe("8");
    expect(first?.searchParams.get("liveId")).toBe("0");
    expect(first?.searchParams.get("size")).toBe("50");
    expect(first?.searchParams.get("sortType")).toBeNull();

    // 두 번째 요청은 응답이 준 다음 커서를 그대로 쓴다.
    const second = recorder.liveUrls[1];
    expect(second?.searchParams.get("concurrentUserCount")).toBe("4");
    expect(second?.searchParams.get("liveId")).toBe("12345");

    // 1페이지를 받은 시점의 frontier 는 다음 커서 시청자 수 + 1 이다.
    expect(snapshots[0]?.state.coverage.viewerFrontier).toBe(5);
    expect(snapshot.state.coverage.viewerFrontier).toBe(0);
    expect(snapshot.state.coverage.exhausted).toBe(true);
  });

  it("latest 전략은 sortType=LATEST 를 붙이고 결과를 항상 부분 결과로 표시합니다.", async () => {
    const recorder = createRecorder({
      live: () =>
        rawLivePage(
          [
            { liveId: 801, channelId: hexId(51), viewerCount: 3 },
            { liveId: 802, channelId: hexId(52), viewerCount: 4 },
          ],
          null,
        ),
      channel: ({ channelId }) => rawChannel(channelId, 8),
    });

    const settings = makeSettings({
      viewer: { enabled: false, max: 10 },
      follower: { enabled: true, max: 50 },
    });
    expect(selectStrategy(settings)).toBe("latest");

    const { snapshot } = await runOrchestrator({
      settings,
      requestJson: recorder.requestJson,
    });

    const first = recorder.liveUrls[0];
    expect(first?.searchParams.get("sortType")).toBe("LATEST");
    expect(first?.searchParams.get("concurrentUserCount")).toBeNull();
    expect(first?.searchParams.get("liveId")).toBeNull();

    expect(snapshot.state.coverage.strategy).toBe("latest");
    expect(snapshot.state.coverage.viewerCeiling).toBeNull();
    expect(snapshot.state.coverage.viewerFrontier).toBeNull();
    expect(snapshot.state.partialReason).toBe("latest-strategy");
    expect(snapshot.state.phase).toBe("partial");
    expect(snapshot.state.matchedResults).toBe(2);
  });
});

describe("탐색 오케스트레이터: 취소", () => {
  it("이미 취소된 신호로 실행하면 요청을 하나도 보내지 않고 AbortError 를 던집니다.", async () => {
    const recorder = createRecorder({ live: () => rawLivePage([], null) });
    const controller = new AbortController();
    controller.abort();

    let caught: unknown = null;
    try {
      await runOrchestrator({
        settings: makeSettings({
          viewer: { enabled: true, max: 10 },
          follower: { enabled: false, max: 50 },
        }),
        requestJson: recorder.requestJson,
        followerResolver: createSpyResolver().resolver,
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as Error | null)?.name).toBe("AbortError");
    expect(recorder.liveUrls).toHaveLength(0);
  });

  it("진행 중에 취소하면 그 시점 이후로 요청을 보내지 않습니다.", async () => {
    const controller = new AbortController();
    const recorder = createRecorder({
      live: ({ index }) => {
        if (index === 0) {
          controller.abort();
          return rawLivePage([{ liveId: 901, channelId: hexId(61), viewerCount: 2 }], {
            concurrentUserCount: 2,
            liveId: 901,
          });
        }
        return rawLivePage([{ liveId: 902, channelId: hexId(62), viewerCount: 2 }], null);
      },
    });

    let caught: unknown = null;
    try {
      await runOrchestrator({
        settings: makeSettings({
          viewer: { enabled: true, max: 10 },
          follower: { enabled: false, max: 50 },
        }),
        requestJson: recorder.requestJson,
        followerResolver: createSpyResolver().resolver,
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as Error | null)?.name).toBe("AbortError");
    expect(recorder.liveUrls).toHaveLength(1);
  });
});

describe("후보 병합", () => {
  it("같은 채널의 새 라이브가 오면 최신 항목으로 교체하고 팔로워 상태를 보존합니다.", () => {
    const channelId = hexId(71);
    const map = new Map<string, StreamCandidate>();
    map.set(
      channelId,
      candidateOf({
        liveId: "1",
        channelId,
        startedAtEpoch: 100,
        followerCount: 42,
        followerState: "ready",
      }),
    );

    mergeCandidate(
      map,
      candidateOf({ liveId: "2", channelId, startedAtEpoch: 200, viewerCount: 9 }),
    );

    const merged = map.get(channelId);
    expect(merged?.liveId).toBe("2");
    expect(merged?.viewerCount).toBe(9);
    expect(merged?.followerCount).toBe(42);
    expect(merged?.followerState).toBe("ready");

    // 더 오래된 라이브는 최신 항목을 밀어내지 못한다.
    mergeCandidate(map, candidateOf({ liveId: "3", channelId, startedAtEpoch: 50 }));
    expect(map.get(channelId)?.liveId).toBe("2");

    // 같은 라이브의 재관측은 시청자 수만 갱신한다.
    mergeCandidate(
      map,
      candidateOf({ liveId: "2", channelId, startedAtEpoch: 200, viewerCount: 15 }),
    );
    expect(map.get(channelId)?.viewerCount).toBe(15);
    expect(map.get(channelId)?.followerCount).toBe(42);
    expect(map.get(channelId)?.followerState).toBe("ready");
  });

  it("페이지를 넘나들며 같은 채널이 등장해도 openDate 가 최신인 라이브만 남깁니다.", async () => {
    const channelId = hexId(72);
    const recorder = createRecorder({
      live: ({ index }) =>
        index === 0
          ? rawLivePage(
              [
                {
                  liveId: 1001,
                  channelId,
                  viewerCount: 5,
                  openDate: "2026-08-11 00:00:00",
                },
              ],
              { concurrentUserCount: 5, liveId: 1001 },
            )
          : rawLivePage(
              [
                {
                  liveId: 1002,
                  channelId,
                  viewerCount: 6,
                  openDate: "2026-08-11 01:00:00",
                },
              ],
              null,
            ),
    });

    const { snapshot } = await runOrchestrator({
      settings: makeSettings({
        viewer: { enabled: true, max: 10 },
        follower: { enabled: false, max: 50 },
      }),
      requestJson: recorder.requestJson,
      followerResolver: createSpyResolver().resolver,
    });

    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0]?.liveId).toBe("1002");
    expect(snapshot.candidates[0]?.viewerCount).toBe(6);
    expect(snapshot.state.scannedLives).toBe(2);
  });

  it("이어받은 후보의 확인된 팔로워 수는 새 라이브로 교체되어도 다시 조회하지 않습니다.", async () => {
    const channelId = hexId(73);
    const recorder = createRecorder({
      live: () =>
        rawLivePage(
          [{ liveId: 1102, channelId, viewerCount: 4, openDate: "2026-08-11 02:00:00" }],
          null,
        ),
      channel: ({ channelId: requested }) => rawChannel(requested, 999),
    });

    const { snapshot } = await runOrchestrator({
      settings: makeSettings({
        viewer: { enabled: true, max: 30 },
        follower: { enabled: true, max: 50 },
      }),
      requestJson: recorder.requestJson,
      existingCandidates: [
        candidateOf({
          liveId: "1101",
          channelId,
          startedAtEpoch: 1,
          followerCount: 7,
          followerState: "ready",
        }),
      ],
    });

    const candidate = snapshot.candidates[0];
    expect(snapshot.candidates).toHaveLength(1);
    expect(candidate?.liveId).toBe("1102");
    expect(candidate?.followerCount).toBe(7);
    expect(candidate?.followerState).toBe("ready");
    expect(recorder.channelIds).toHaveLength(0);
    expect(snapshot.state.matchedResults).toBe(1);
  });
});

describe("computeViewerFrontier", () => {
  it("커서가 끝나면 0명까지 훑은 것으로 계산합니다.", () => {
    expect(computeViewerFrontier(null)).toBe(0);
  });

  it("다음 커서 시청자 수보다 1 큰 값이 완전히 훑은 하한입니다.", () => {
    expect(computeViewerFrontier({ concurrentUserCount: 7, liveId: 5 })).toBe(8);
    expect(computeViewerFrontier({ concurrentUserCount: 0, liveId: 5 })).toBe(1);
    expect(computeViewerFrontier({ concurrentUserCount: 30, liveId: 1 })).toBe(31);
  });
});
