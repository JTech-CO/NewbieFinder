import type { StreamCandidate } from "./models";
import type { FinderSettings } from "./settings";

/**
 * 정렬 규칙.
 *
 * | 활성 조건 | 최근 OFF                                   | 최근 ON                                    |
 * |----------|--------------------------------------------|--------------------------------------------|
 * | 시청자만  | 시청자 asc → 시작 desc                      | 시작 desc → 시청자 asc                      |
 * | 팔로워만  | 팔로워 asc → 시청자 asc                     | 시작 desc → 팔로워 asc                      |
 * | 둘 다     | 시청자 asc → 팔로워 asc → 시작 desc          | 시작 desc → 시청자 asc → 팔로워 asc          |
 *
 * 마지막 타이브레이커는 항상 channelId 다. 같은 데이터면 항상 같은 순서가 나와야 한다.
 */

type Comparator = (a: StreamCandidate, b: StreamCandidate) => number;

const byViewerAsc: Comparator = (a, b) => a.viewerCount - b.viewerCount;

/** 팔로워 미확인(null)은 항상 뒤로 보낸다. 0명으로 취급하지 않는다. */
const byFollowerAsc: Comparator = (a, b) => {
  const av = a.followerCount;
  const bv = b.followerCount;
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return av - bv;
};

/** 시작 시각 내림차순. 파싱 실패 항목은 뒤로 보낸다. */
const byStartedAtDesc: Comparator = (a, b) => {
  const av = a.startedAtEpoch;
  const bv = b.startedAtEpoch;
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return bv - av;
};

const byChannelId: Comparator = (a, b) =>
  a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : 0;

function chain(...comparators: Comparator[]): Comparator {
  return (a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  };
}

export function buildComparator(settings: FinderSettings): Comparator {
  const viewer = settings.viewerFilter.enabled;
  const follower = settings.followerFilter.enabled;
  const recent = settings.recentFirst;

  if (recent) {
    if (viewer && follower) return chain(byStartedAtDesc, byViewerAsc, byFollowerAsc, byChannelId);
    if (follower) return chain(byStartedAtDesc, byFollowerAsc, byChannelId);
    return chain(byStartedAtDesc, byViewerAsc, byChannelId);
  }

  if (viewer && follower) return chain(byViewerAsc, byFollowerAsc, byStartedAtDesc, byChannelId);
  if (follower && !viewer) return chain(byFollowerAsc, byViewerAsc, byChannelId);
  // 시청자만, 또는 조건이 없는 경우의 기본 정렬
  return chain(byViewerAsc, byStartedAtDesc, byChannelId);
}

/**
 * 안정 정렬로 후보를 정렬한다. Array.prototype.sort 는 ES2019 부터 안정 정렬을 보장한다.
 * 입력 배열을 변경하지 않는다.
 */
export function sortCandidates(
  items: readonly StreamCandidate[],
  settings: FinderSettings,
): StreamCandidate[] {
  return [...items].sort(buildComparator(settings));
}

export const comparators = {
  byViewerAsc,
  byFollowerAsc,
  byStartedAtDesc,
  byChannelId,
  chain,
};
