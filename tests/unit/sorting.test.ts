import { describe, expect, it } from "vitest";

import type { StreamCandidate } from "../../src/domain/models";
import type { FinderSettings } from "../../src/domain/settings";
import { DEFAULT_SETTINGS } from "../../src/domain/settings";
import { buildComparator, comparators, sortCandidates } from "../../src/domain/sorting";

/**
 * 정렬 표.
 *
 * | 활성 조건 | 최근 OFF                            | 최근 ON                             |
 * |----------|-------------------------------------|-------------------------------------|
 * | 시청자만  | 시청자 asc → 시작 desc               | 시작 desc → 시청자 asc               |
 * | 팔로워만  | 팔로워 asc → 시청자 asc              | 시작 desc → 팔로워 asc               |
 * | 둘 다     | 시청자 asc → 팔로워 asc → 시작 desc   | 시작 desc → 시청자 asc → 팔로워 asc   |
 */

const T = Date.parse("2026-08-11T00:00:00+09:00");

function makeCandidate(liveId: string, overrides: Partial<StreamCandidate> = {}): StreamCandidate {
  return {
    liveId,
    channelId: `${liveId.padStart(2, "0")}112233445566778899aabbccddee`.slice(0, 32),
    channelName: `채널 ${liveId}`,
    channelImageUrl: null,
    liveTitle: `방송 ${liveId}`,
    thumbnailUrl: null,
    viewerCount: 5,
    followerCount: null,
    followerState: "idle",
    startedAtRaw: "2026-08-11 00:00:00",
    startedAtEpoch: T,
    adult: false,
    verified: false,
    categoryName: null,
    sourceFetchedAt: T,
    ...overrides,
  };
}

function settingsOf(viewer: boolean, follower: boolean, recent: boolean): FinderSettings {
  return {
    ...DEFAULT_SETTINGS,
    viewerFilter: { enabled: viewer, max: 30 },
    followerFilter: { enabled: follower, max: 100 },
    recentFirst: recent,
  };
}

function ids(items: readonly StreamCandidate[]): string[] {
  return items.map((item) => item.liveId);
}

describe("시청자 조건만 켜진 경우", () => {
  const items: StreamCandidate[] = [
    makeCandidate("a", { viewerCount: 5, startedAtEpoch: T + 300 }),
    makeCandidate("b", { viewerCount: 5, startedAtEpoch: T + 100 }),
    makeCandidate("c", { viewerCount: 2, startedAtEpoch: T + 200 }),
  ];

  it("최근 OFF 이면 시청자 오름차순 → 시작 내림차순", () => {
    expect(ids(sortCandidates(items, settingsOf(true, false, false)))).toEqual(["c", "a", "b"]);
  });

  it("최근 ON 이면 시작 내림차순 → 시청자 오름차순", () => {
    expect(ids(sortCandidates(items, settingsOf(true, false, true)))).toEqual(["a", "c", "b"]);
  });
});

describe("팔로워 조건만 켜진 경우", () => {
  const items: StreamCandidate[] = [
    makeCandidate("p", {
      followerCount: 10,
      followerState: "ready",
      viewerCount: 8,
      startedAtEpoch: T + 300,
    }),
    makeCandidate("q", {
      followerCount: 3,
      followerState: "ready",
      viewerCount: 20,
      startedAtEpoch: T + 100,
    }),
    makeCandidate("r", {
      followerCount: 10,
      followerState: "ready",
      viewerCount: 2,
      startedAtEpoch: T + 300,
    }),
  ];

  it("최근 OFF 이면 팔로워 오름차순 → 시청자 오름차순", () => {
    expect(ids(sortCandidates(items, settingsOf(false, true, false)))).toEqual(["q", "r", "p"]);
  });

  it("최근 ON 이면 시작 내림차순 → 팔로워 오름차순", () => {
    const recentItems: StreamCandidate[] = [
      makeCandidate("d1", { followerCount: 1, followerState: "ready", startedAtEpoch: T + 100 }),
      makeCandidate("d2", { followerCount: 50, followerState: "ready", startedAtEpoch: T + 300 }),
      makeCandidate("d3", { followerCount: 5, followerState: "ready", startedAtEpoch: T + 300 }),
    ];
    expect(ids(sortCandidates(recentItems, settingsOf(false, true, true)))).toEqual([
      "d3",
      "d2",
      "d1",
    ]);
  });
});

describe("두 조건이 모두 켜진 경우", () => {
  const items: StreamCandidate[] = [
    makeCandidate("e1", {
      viewerCount: 5,
      followerCount: 20,
      followerState: "ready",
      startedAtEpoch: T + 100,
    }),
    makeCandidate("e2", {
      viewerCount: 5,
      followerCount: 2,
      followerState: "ready",
      startedAtEpoch: T + 50,
    }),
    makeCandidate("e3", {
      viewerCount: 5,
      followerCount: 20,
      followerState: "ready",
      startedAtEpoch: T + 400,
    }),
    makeCandidate("e4", {
      viewerCount: 1,
      followerCount: 99,
      followerState: "ready",
      startedAtEpoch: T + 10,
    }),
  ];

  it("최근 OFF 이면 시청자 → 팔로워 → 시작 순서", () => {
    expect(ids(sortCandidates(items, settingsOf(true, true, false)))).toEqual([
      "e4",
      "e2",
      "e3",
      "e1",
    ]);
  });

  it("최근 ON 이면 시작 → 시청자 → 팔로워 순서", () => {
    expect(ids(sortCandidates(items, settingsOf(true, true, true)))).toEqual([
      "e3",
      "e1",
      "e2",
      "e4",
    ]);
  });
});

describe("조건이 없을 때의 기본 정렬", () => {
  it("시청자 오름차순 → 시작 내림차순을 씁니다", () => {
    const items: StreamCandidate[] = [
      makeCandidate("x", { viewerCount: 9, startedAtEpoch: T + 100 }),
      makeCandidate("y", { viewerCount: 1, startedAtEpoch: T + 10 }),
    ];
    expect(ids(sortCandidates(items, settingsOf(false, false, false)))).toEqual(["y", "x"]);
  });
});

describe("결측값 처리", () => {
  it("날짜 파싱에 실패한 항목은 최근 정렬에서 뒤로 갑니다", () => {
    const items: StreamCandidate[] = [
      makeCandidate("n1", { startedAtEpoch: null }),
      makeCandidate("n2", { startedAtEpoch: T + 100 }),
      makeCandidate("n3", { startedAtEpoch: T + 500 }),
    ];
    expect(ids(sortCandidates(items, settingsOf(true, false, true)))).toEqual(["n3", "n2", "n1"]);
  });

  it("날짜 파싱 실패는 제외 사유가 아니라 후순위 사유입니다", () => {
    const items: StreamCandidate[] = [
      makeCandidate("n1", { viewerCount: 3, startedAtEpoch: null }),
      makeCandidate("n2", { viewerCount: 3, startedAtEpoch: T + 100 }),
    ];
    const sorted = sortCandidates(items, settingsOf(true, false, false));
    expect(sorted).toHaveLength(2);
    expect(ids(sorted)).toEqual(["n2", "n1"]);
  });

  it("팔로워 미확인 항목은 0명이 아니라 뒤로 보냅니다", () => {
    const items: StreamCandidate[] = [
      makeCandidate("f1", { followerCount: null, followerState: "failed" }),
      makeCandidate("f2", { followerCount: 7, followerState: "ready" }),
      makeCandidate("f3", { followerCount: 0, followerState: "ready" }),
    ];
    expect(ids(sortCandidates(items, settingsOf(false, true, false)))).toEqual(["f3", "f2", "f1"]);
  });

  it("비교 함수 단위로도 결측값이 뒤로 갑니다", () => {
    const withValue = makeCandidate("v", { followerCount: 1, startedAtEpoch: T });
    const withoutValue = makeCandidate("w", { followerCount: null, startedAtEpoch: null });

    expect(comparators.byFollowerAsc(withoutValue, withValue)).toBeGreaterThan(0);
    expect(comparators.byFollowerAsc(withValue, withoutValue)).toBeLessThan(0);
    expect(comparators.byFollowerAsc(withoutValue, withoutValue)).toBe(0);

    expect(comparators.byStartedAtDesc(withoutValue, withValue)).toBeGreaterThan(0);
    expect(comparators.byStartedAtDesc(withValue, withoutValue)).toBeLessThan(0);
    expect(comparators.byStartedAtDesc(withoutValue, withoutValue)).toBe(0);
  });
});

describe("타이브레이커 결정성", () => {
  const sameEverything: StreamCandidate[] = [
    makeCandidate("t1", {
      channelId: "cccccccccccccccccccccccccccccccc",
      viewerCount: 5,
      followerCount: 10,
      followerState: "ready",
      startedAtEpoch: T,
    }),
    makeCandidate("t2", {
      channelId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      viewerCount: 5,
      followerCount: 10,
      followerState: "ready",
      startedAtEpoch: T,
    }),
    makeCandidate("t3", {
      channelId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      viewerCount: 5,
      followerCount: 10,
      followerState: "ready",
      startedAtEpoch: T,
    }),
  ];

  it("모든 값이 같으면 channelId 오름차순으로 정합니다", () => {
    const sorted = sortCandidates(sameEverything, settingsOf(true, true, false));
    expect(sorted.map((item) => item.channelId)).toEqual([
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "cccccccccccccccccccccccccccccccc",
    ]);
  });

  it("입력 순서가 달라도 같은 결과가 나옵니다", () => {
    const settings = settingsOf(true, true, true);
    const forward = ids(sortCandidates(sameEverything, settings));
    const reversed = ids(sortCandidates([...sameEverything].reverse(), settings));
    const rotated = ids(
      sortCandidates(
        [sameEverything[1], sameEverything[2], sameEverything[0]].filter(
          (item): item is StreamCandidate => item !== undefined,
        ),
        settings,
      ),
    );

    expect(reversed).toEqual(forward);
    expect(rotated).toEqual(forward);
  });

  it("모든 조합에서 비교 함수가 대칭입니다", () => {
    const combos: Array<[boolean, boolean, boolean]> = [
      [true, false, false],
      [true, false, true],
      [false, true, false],
      [false, true, true],
      [true, true, false],
      [true, true, true],
    ];

    for (const [viewer, follower, recent] of combos) {
      const compare = buildComparator(settingsOf(viewer, follower, recent));
      const first = sameEverything[0];
      const second = sameEverything[1];
      if (first === undefined || second === undefined) throw new Error("표본이 부족합니다.");
      expect(Math.sign(compare(first, second))).toBe(-Math.sign(compare(second, first)));
    }
  });
});

describe("sortCandidates", () => {
  it("입력 배열을 변경하지 않습니다", () => {
    const items: StreamCandidate[] = [
      makeCandidate("s1", { viewerCount: 9 }),
      makeCandidate("s2", { viewerCount: 1 }),
    ];
    const before = ids(items);
    const sorted = sortCandidates(items, settingsOf(true, false, false));

    expect(ids(items)).toEqual(before);
    expect(sorted).not.toBe(items);
    expect(ids(sorted)).toEqual(["s2", "s1"]);
  });

  it("빈 목록에도 안전하게 동작합니다", () => {
    expect(sortCandidates([], settingsOf(true, true, true))).toEqual([]);
  });
});
