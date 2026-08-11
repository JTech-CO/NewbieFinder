import { describe, expect, it } from "vitest";

import {
  applyFilters,
  followerLookupIsBlocking,
  judgeCandidate,
  matchesCandidate,
  needsFollowerLookup,
  shouldDiscover,
} from "../../src/domain/filters";
import type { StreamCandidate } from "../../src/domain/models";
import type { FinderSettings } from "../../src/domain/settings";
import { DEFAULT_SETTINGS } from "../../src/domain/settings";

const BASE_EPOCH = Date.parse("2026-08-11T00:11:17+09:00");

function makeCandidate(overrides: Partial<StreamCandidate> = {}): StreamCandidate {
  return {
    liveId: "20476569",
    channelId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    channelName: "채널A",
    channelImageUrl: null,
    liveTitle: "테스트 방송",
    thumbnailUrl: null,
    viewerCount: 5,
    followerCount: null,
    followerState: "idle",
    startedAtRaw: "2026-08-11 00:11:17",
    startedAtEpoch: BASE_EPOCH,
    adult: false,
    verified: false,
    categoryName: null,
    sourceFetchedAt: BASE_EPOCH,
    ...overrides,
  };
}

function settingsOf(options: {
  viewer?: boolean;
  viewerMax?: number;
  follower?: boolean;
  followerMax?: number;
  recent?: boolean;
}): FinderSettings {
  return {
    ...DEFAULT_SETTINGS,
    viewerFilter: { enabled: options.viewer ?? false, max: options.viewerMax ?? 10 },
    followerFilter: { enabled: options.follower ?? false, max: options.followerMax ?? 50 },
    recentFirst: options.recent ?? false,
  };
}

describe("시청자 조건", () => {
  it("시청자 0명은 N=1 결과에 포함합니다", () => {
    const item = makeCandidate({ viewerCount: 0 });
    expect(judgeCandidate(item, settingsOf({ viewer: true, viewerMax: 1 }))).toBe("matched");
  });

  it("시청자 정확히 1명은 N=1 결과에 포함합니다", () => {
    const item = makeCandidate({ viewerCount: 1 });
    expect(matchesCandidate(item, settingsOf({ viewer: true, viewerMax: 1 }))).toBe(true);
  });

  it("시청자 2명은 N=1 결과에서 제외합니다", () => {
    const item = makeCandidate({ viewerCount: 2 });
    expect(judgeCandidate(item, settingsOf({ viewer: true, viewerMax: 1 }))).toBe(
      "excluded-viewer",
    );
  });

  it("시청자 정확히 30명은 N=30 결과에 포함합니다", () => {
    const item = makeCandidate({ viewerCount: 30 });
    expect(judgeCandidate(item, settingsOf({ viewer: true, viewerMax: 30 }))).toBe("matched");
  });

  it("시청자 31명은 N=30 결과에서 제외합니다", () => {
    const item = makeCandidate({ viewerCount: 31 });
    expect(judgeCandidate(item, settingsOf({ viewer: true, viewerMax: 30 }))).toBe(
      "excluded-viewer",
    );
  });

  it("시청자 조건이 꺼져 있으면 시청자 수로 거르지 않습니다", () => {
    const item = makeCandidate({ viewerCount: 9_999 });
    expect(judgeCandidate(item, settingsOf({ viewer: false }))).toBe("matched");
  });
});

describe("팔로워 조건", () => {
  it("팔로워 정확히 100명은 N=100 결과에 포함합니다", () => {
    const item = makeCandidate({ followerCount: 100, followerState: "ready" });
    expect(judgeCandidate(item, settingsOf({ follower: true, followerMax: 100 }))).toBe("matched");
  });

  it("팔로워 101명은 N=100 결과에서 제외합니다", () => {
    const item = makeCandidate({ followerCount: 101, followerState: "ready" });
    expect(judgeCandidate(item, settingsOf({ follower: true, followerMax: 100 }))).toBe(
      "excluded-follower",
    );
  });

  it("팔로워 0명도 포함합니다", () => {
    const item = makeCandidate({ followerCount: 0, followerState: "ready" });
    expect(judgeCandidate(item, settingsOf({ follower: true, followerMax: 1 }))).toBe("matched");
  });

  it("아직 확인하지 않은 항목은 결과에 넣지 않고 대기로 둡니다", () => {
    const idle = makeCandidate({ followerState: "idle", followerCount: null });
    const loading = makeCandidate({ followerState: "loading", followerCount: null });
    const settings = settingsOf({ follower: true, followerMax: 100 });

    expect(judgeCandidate(idle, settings)).toBe("awaiting-follower");
    expect(judgeCandidate(loading, settings)).toBe("awaiting-follower");
  });

  it("상태가 ready 여도 팔로워 수가 없으면 결과에 넣지 않습니다", () => {
    const item = makeCandidate({ followerState: "ready", followerCount: null });
    expect(judgeCandidate(item, settingsOf({ follower: true, followerMax: 100 }))).toBe(
      "awaiting-follower",
    );
  });

  it("확인에 실패한 항목은 상한 이하로 추정하지 않고 미확인으로 분리합니다", () => {
    const item = makeCandidate({ followerState: "failed", followerCount: null });
    expect(judgeCandidate(item, settingsOf({ follower: true, followerMax: 100 }))).toBe(
      "unresolved-follower",
    );
  });

  it("팔로워 조건이 꺼져 있으면 미확인 상태여도 결과에 포함합니다", () => {
    const item = makeCandidate({ followerState: "failed", followerCount: null });
    expect(judgeCandidate(item, settingsOf({ viewer: true, viewerMax: 10 }))).toBe("matched");
  });
});

describe("두 조건 결합 (AND)", () => {
  const settings = settingsOf({
    viewer: true,
    viewerMax: 10,
    follower: true,
    followerMax: 100,
  });

  it("두 조건을 모두 만족해야 포함합니다", () => {
    const item = makeCandidate({ viewerCount: 4, followerCount: 40, followerState: "ready" });
    expect(judgeCandidate(item, settings)).toBe("matched");
  });

  it("시청자 조건만 만족하면 제외합니다", () => {
    const item = makeCandidate({ viewerCount: 4, followerCount: 500, followerState: "ready" });
    expect(judgeCandidate(item, settings)).toBe("excluded-follower");
  });

  it("팔로워 조건만 만족하면 제외합니다", () => {
    const item = makeCandidate({ viewerCount: 40, followerCount: 4, followerState: "ready" });
    expect(judgeCandidate(item, settings)).toBe("excluded-viewer");
  });
});

describe("성인 방송", () => {
  it("조건과 무관하게 성인 항목을 제외합니다", () => {
    const item = makeCandidate({ adult: true, viewerCount: 1, followerCount: 1 });
    expect(judgeCandidate(item, settingsOf({ viewer: true, viewerMax: 30 }))).toBe(
      "excluded-adult",
    );
    expect(judgeCandidate(item, settingsOf({ follower: true, followerMax: 100 }))).toBe(
      "excluded-adult",
    );
    expect(judgeCandidate(item, settingsOf({}))).toBe("excluded-adult");
  });

  it("성인 항목은 필터보다 먼저 걸러집니다", () => {
    const item = makeCandidate({ adult: true, viewerCount: 999, followerState: "failed" });
    expect(judgeCandidate(item, settingsOf({ viewer: true, follower: true }))).toBe(
      "excluded-adult",
    );
  });
});

describe("applyFilters", () => {
  it("포함·대기·미확인을 각각 분리해 셉니다", () => {
    const items: StreamCandidate[] = [
      makeCandidate({ liveId: "1", viewerCount: 2, followerCount: 10, followerState: "ready" }),
      makeCandidate({ liveId: "2", viewerCount: 3, followerCount: 900, followerState: "ready" }),
      makeCandidate({ liveId: "3", viewerCount: 4, followerState: "idle" }),
      makeCandidate({ liveId: "4", viewerCount: 5, followerState: "loading" }),
      makeCandidate({ liveId: "5", viewerCount: 6, followerState: "failed" }),
      makeCandidate({ liveId: "6", viewerCount: 99, followerState: "ready", followerCount: 1 }),
      makeCandidate({ liveId: "7", adult: true, viewerCount: 1 }),
    ];

    const outcome = applyFilters(
      items,
      settingsOf({ viewer: true, viewerMax: 10, follower: true, followerMax: 100 }),
    );

    expect(outcome.matched.map((item) => item.liveId)).toEqual(["1"]);
    expect(outcome.awaitingFollower).toBe(2);
    expect(outcome.unresolvedFollower).toBe(1);
  });

  it("입력 배열을 변경하지 않습니다", () => {
    const items: StreamCandidate[] = [makeCandidate({ liveId: "1" })];
    const snapshot = [...items];
    applyFilters(items, settingsOf({ viewer: true }));
    expect(items).toEqual(snapshot);
  });

  it("빈 목록에도 안전하게 동작합니다", () => {
    const outcome = applyFilters([], settingsOf({ viewer: true }));
    expect(outcome.matched).toEqual([]);
    expect(outcome.awaitingFollower).toBe(0);
    expect(outcome.unresolvedFollower).toBe(0);
  });
});

describe("needsFollowerLookup", () => {
  it("성인 항목은 조회하지 않습니다", () => {
    expect(needsFollowerLookup(makeCandidate({ adult: true }), settingsOf({ viewer: true }))).toBe(
      false,
    );
  });

  it("이미 확인했거나 진행 중이거나 실패한 항목은 다시 조회하지 않습니다", () => {
    const settings = settingsOf({ follower: true });
    expect(needsFollowerLookup(makeCandidate({ followerState: "ready" }), settings)).toBe(false);
    expect(needsFollowerLookup(makeCandidate({ followerState: "loading" }), settings)).toBe(false);
    expect(needsFollowerLookup(makeCandidate({ followerState: "failed" }), settings)).toBe(false);
  });

  it("시청자 조건을 통과하지 못한 항목은 조회하지 않습니다", () => {
    const item = makeCandidate({ viewerCount: 40, followerState: "idle" });
    expect(needsFollowerLookup(item, settingsOf({ viewer: true, viewerMax: 10 }))).toBe(false);
  });

  it("시청자 조건을 통과한 미확인 항목은 조회합니다", () => {
    const item = makeCandidate({ viewerCount: 4, followerState: "idle" });
    expect(needsFollowerLookup(item, settingsOf({ viewer: true, viewerMax: 10 }))).toBe(true);
  });
});

describe("탐색 전제", () => {
  it("팔로워 조건이 켜져 있을 때만 조회가 판정에 필수입니다", () => {
    expect(followerLookupIsBlocking(settingsOf({ follower: true }))).toBe(true);
    expect(followerLookupIsBlocking(settingsOf({ viewer: true }))).toBe(false);
  });

  it("조건이 하나도 없으면 탐색을 시작하지 않습니다", () => {
    expect(shouldDiscover(settingsOf({}))).toBe(false);
    expect(shouldDiscover(settingsOf({ viewer: true }))).toBe(true);
    expect(shouldDiscover(settingsOf({ follower: true }))).toBe(true);
  });
});
