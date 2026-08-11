import type { DiscoveryState, LiveCursor, ScanCoverage, StreamCandidate } from "../domain/models";

/**
 * 탐색 계층이 UI 로 올려 보내는 값.
 * UI 는 이 스냅샷만 보고 그린다. 오케스트레이터 내부 자료구조를 직접 만지지 않는다.
 */
export interface DiscoverySnapshot {
  readonly candidates: readonly StreamCandidate[];
  readonly state: DiscoveryState;
}

/**
 * `계속 탐색` 을 위한 이어받기 토큰.
 * 다음 구간을 이어 조회할 때 같은 요청 제한과 캐시를 그대로 쓴다.
 */
export interface DiscoveryResumeToken {
  readonly cursor: LiveCursor | null;
  readonly coverage: ScanCoverage;
  readonly scannedPages: number;
  readonly scannedLives: number;
}

export interface DiscoveryRunResult {
  readonly snapshot: DiscoverySnapshot;
  readonly resume: DiscoveryResumeToken | null;
}

/**
 * 후보 병합.
 *  - 1차 키 liveId, 2차 키 channelId
 *  - 같은 채널의 새 라이브가 오면 openDate 가 최신인 항목으로 교체한다.
 *  - 이미 확인한 팔로워 수는 새 라이브로 교체되어도 유지한다.
 */
export function mergeCandidate(
  byChannelId: Map<string, StreamCandidate>,
  incoming: StreamCandidate,
): void {
  const existing = byChannelId.get(incoming.channelId);
  if (!existing) {
    byChannelId.set(incoming.channelId, incoming);
    return;
  }

  if (existing.liveId === incoming.liveId) {
    // 같은 라이브의 재관측. 시청자 수 등 최신 값으로 갱신하되 팔로워 상태는 보존한다.
    byChannelId.set(incoming.channelId, {
      ...incoming,
      followerCount: existing.followerCount,
      followerState: existing.followerState,
    });
    return;
  }

  const existingAt = existing.startedAtEpoch ?? Number.NEGATIVE_INFINITY;
  const incomingAt = incoming.startedAtEpoch ?? Number.NEGATIVE_INFINITY;
  if (incomingAt > existingAt) {
    byChannelId.set(incoming.channelId, {
      ...incoming,
      followerCount: existing.followerCount,
      followerState: existing.followerState,
    });
  }
}

/**
 * 커서 기준으로 "빠짐없이 훑은" 가장 낮은 시청자 수를 계산한다.
 *
 * 다음 커서의 시청자 수가 7이면 8명 이상은 전부 받았고 7명은 아직 진행 중이다.
 * 커서가 끝났으면 0명까지 전부 받은 것이다.
 */
export function computeViewerFrontier(nextCursor: LiveCursor | null): number {
  return nextCursor === null ? 0 : nextCursor.concurrentUserCount + 1;
}

export function isCoverageComplete(coverage: ScanCoverage): boolean {
  return coverage.strategy === "viewer-tail" && coverage.exhausted;
}
