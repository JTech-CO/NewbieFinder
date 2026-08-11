import type { StreamCandidate } from "./models";
import type { FinderSettings } from "./settings";
import { isBaseFilterActive } from "./settings";

/**
 * 후보 판정.
 *
 * 핵심 규칙 두 가지
 *  1. 두 조건이 모두 켜지면 AND 결합이다. OR 은 v1 에 없다.
 *  2. 팔로워 수가 확인되지 않은 채널을 "조건을 만족한다"고 추정하지 않는다.
 */

export type CandidateVerdict =
  | "matched"
  | "excluded-adult"
  | "excluded-viewer"
  | "excluded-follower"
  | "awaiting-follower"
  | "unresolved-follower";

export function judgeCandidate(item: StreamCandidate, settings: FinderSettings): CandidateVerdict {
  // 성인 방송 제외는 v1 고정이며 필터보다 먼저 적용한다.
  if (item.adult) return "excluded-adult";

  if (settings.viewerFilter.enabled && item.viewerCount > settings.viewerFilter.max) {
    return "excluded-viewer";
  }

  if (settings.followerFilter.enabled) {
    if (item.followerState === "failed") return "unresolved-follower";
    if (item.followerState !== "ready" || item.followerCount === null) return "awaiting-follower";
    if (item.followerCount > settings.followerFilter.max) return "excluded-follower";
  }

  return "matched";
}

export function matchesCandidate(item: StreamCandidate, settings: FinderSettings): boolean {
  return judgeCandidate(item, settings) === "matched";
}

export interface FilterOutcome {
  /** 결과 그리드에 표시할 후보 */
  readonly matched: StreamCandidate[];
  /** 팔로워 판정 대기 중: 그리드가 아니라 카운트로만 보여 준다. */
  readonly awaitingFollower: number;
  /** 팔로워 확인 실패: 상한 이하로 추정하지 않고 미확인으로 분리한다. */
  readonly unresolvedFollower: number;
}

export function applyFilters(
  items: readonly StreamCandidate[],
  settings: FinderSettings,
): FilterOutcome {
  const matched: StreamCandidate[] = [];
  let awaitingFollower = 0;
  let unresolvedFollower = 0;

  for (const item of items) {
    switch (judgeCandidate(item, settings)) {
      case "matched":
        matched.push(item);
        break;
      case "awaiting-follower":
        awaitingFollower += 1;
        break;
      case "unresolved-follower":
        unresolvedFollower += 1;
        break;
      default:
        break;
    }
  }

  return { matched, awaitingFollower, unresolvedFollower };
}

/**
 * 팔로워 조회가 필요한 후보인지.
 *
 * - 팔로워 조건이 켜져 있으면: 시청자 조건을 통과한 후보만 조회한다(요청 낭비 방지).
 * - 팔로워 조건이 꺼져 있으면: 표시 중인 카드에 한해 Lazy 조회한다. 결과 포함 여부에는 영향이 없다.
 */
export function needsFollowerLookup(item: StreamCandidate, settings: FinderSettings): boolean {
  if (item.adult) return false;
  if (item.followerState === "ready" || item.followerState === "loading") return false;
  if (item.followerState === "failed") return false;
  if (settings.viewerFilter.enabled && item.viewerCount > settings.viewerFilter.max) return false;
  return true;
}

/** 팔로워 조건이 켜져 있어 조회가 결과 판정에 필수인 상황인지 */
export function followerLookupIsBlocking(settings: FinderSettings): boolean {
  return settings.followerFilter.enabled;
}

/** 조건이 하나도 없으면 네트워크 탐색을 시작하지 않는다. */
export function shouldDiscover(settings: FinderSettings): boolean {
  return isBaseFilterActive(settings);
}
