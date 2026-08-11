import type { FilterOutcome } from "../domain/filters";
import { applyFilters } from "../domain/filters";
import type { DiscoveryState, StreamCandidate } from "../domain/models";
import { describeConditions, isBaseFilterActive } from "../domain/settings";
import { sortCandidates } from "../domain/sorting";
import { DISCOVERY_BUDGET } from "../shared/constants";
import type { FinderState } from "./app-reducer";

/**
 * 화면이 보는 파생 값. 필터 계산은 Memoized Selector 로 처리한다.
 * 여기 있는 함수는 전부 순수 함수다. 호출부에서 useMemo 로 감싼다.
 */

export function selectFilterOutcome(state: FinderState): FilterOutcome {
  return applyFilters(state.candidates, state.settings);
}

export function selectResults(state: FinderState, outcome: FilterOutcome): StreamCandidate[] {
  return sortCandidates(outcome.matched, state.settings);
}

export type StatusKind = "idle" | "loading" | "ready" | "partial" | "stale" | "cached" | "error";

export interface StatusBadge {
  readonly kind: StatusKind;
  readonly label: string;
}

export function selectStatusBadge(state: FinderState): StatusBadge {
  const { discovery, isRunning } = state;

  if (isRunning) {
    return {
      kind: "loading",
      label: discovery.phase === "loading-followers" ? "채널 정보 확인 중" : "라이브 탐색 중",
    };
  }
  if (discovery.phase === "error") return { kind: "error", label: "연결 실패" };
  if (discovery.dataOrigin === "cache-stale") return { kind: "stale", label: "이전 데이터" };
  if (discovery.phase === "partial") return { kind: "partial", label: "부분 결과" };
  if (discovery.dataOrigin === "cache-fresh") return { kind: "cached", label: "캐시" };
  if (discovery.phase === "ready") return { kind: "ready", label: "실시간" };
  return { kind: "idle", label: "아직 탐색하지 않음" };
}

export function selectConditionSummary(state: FinderState): string {
  return describeConditions(state.settings);
}

/**
 * 탐색이 실제로 커버한 범위를 사람이 읽는 문장으로.
 * "전체를 찾았다"고 말할 수 있는 경우와 아닌 경우를 반드시 구분한다.
 */
export function selectCoverageNote(state: FinderState): string | null {
  const { coverage, scannedLives } = state.discovery;

  if (coverage.strategy === "latest") {
    return scannedLives > 0
      ? `최근 시작한 방송 ${scannedLives.toLocaleString("ko-KR")}개를 확인한 결과입니다.`
      : null;
  }

  if (coverage.viewerCeiling === null) return null;

  if (coverage.exhausted) {
    return `시청자 ${coverage.viewerCeiling}명 이하 라이브를 빠짐없이 확인했습니다.`;
  }

  if (coverage.viewerFrontier !== null) {
    return `시청자 ${coverage.viewerFrontier}~${coverage.viewerCeiling}명 구간까지 확인했습니다. 더 적은 시청자 구간이 남아 있습니다.`;
  }

  return null;
}

/** 탐색을 아직 끝내지 못한 구간이 있어 `계속 탐색` 을 제공해야 하는지 */
export function selectCanContinue(state: FinderState): boolean {
  return !state.isRunning && state.resume !== null && state.discovery.hasNextPage;
}

export type EmptyVariant = "no-condition" | "no-result" | "no-live" | null;

export function selectEmptyVariant(state: FinderState, resultCount: number): EmptyVariant {
  if (!isBaseFilterActive(state.settings)) return "no-condition";
  if (resultCount > 0) return null;
  if (state.isRunning) return null;
  if (state.discovery.phase === "idle") return null;
  if (state.discovery.scannedLives === 0) return "no-live";
  return "no-result";
}

/** 남은 새로고침 쿨다운(ms). 0 이면 지금 누를 수 있다. */
export function selectRefreshCooldownMs(state: FinderState, now: number): number {
  if (state.lastRefreshAt === null) return 0;
  const elapsed = now - state.lastRefreshAt;
  return Math.max(0, DISCOVERY_BUDGET.refreshCooldownMs - elapsed);
}

/**
 * 현재 확보한 데이터가 지금 조건을 감당할 수 있는지.
 * 시청자 상한을 지난 탐색 범위보다 높이면 아직 받아 오지 않은 구간이 생긴다.
 */
export function selectNeedsWiderScan(state: FinderState): boolean {
  if (!state.settings.viewerFilter.enabled) return false;
  const { coverage } = state.discovery;
  if (coverage.strategy !== "viewer-tail") return true;
  if (coverage.viewerCeiling === null) return false;
  return state.settings.viewerFilter.max > coverage.viewerCeiling;
}

/**
 * 다시 탐색해야 하는지. 재정렬·재필터링만으로 해결되지 않는 경우다.
 *  1. 시청자 상한을 지난 탐색 범위보다 높였다 → 못 받아 온 구간이 있다
 *  2. 전략 자체가 바뀌었다 (시청자 조건 ON/OFF)
 *  3. 팔로워 조건을 새로 켰는데 아직 판정하지 않은 후보가 있다
 */
export function selectNeedsRescan(state: FinderState): boolean {
  if (!isBaseFilterActive(state.settings)) return false;
  if (state.candidates.length === 0) return false;
  if (selectNeedsWiderScan(state)) return true;

  const strategy = state.settings.viewerFilter.enabled ? "viewer-tail" : "latest";
  if (state.discovery.coverage.strategy !== strategy) return true;

  if (state.settings.followerFilter.enabled) {
    const hasUnjudged = state.candidates.some(
      (candidate) =>
        !candidate.adult &&
        candidate.followerState === "idle" &&
        (!state.settings.viewerFilter.enabled ||
          candidate.viewerCount <= state.settings.viewerFilter.max),
    );
    if (hasUnjudged) return true;
  }

  return false;
}

export function selectProgressText(discovery: DiscoveryState): string[] {
  const lines: string[] = [];
  if (discovery.scannedPages > 0) {
    lines.push(
      `라이브 목록 ${discovery.scannedPages}페이지 · ${discovery.scannedLives.toLocaleString("ko-KR")}개 방송 확인`,
    );
  }
  const totalChannels = discovery.resolvedChannels + discovery.unresolvedChannels + discovery.pendingChannels;
  if (totalChannels > 0 && discovery.pendingChannels > 0) {
    lines.push(
      `채널 정보 ${discovery.resolvedChannels + discovery.unresolvedChannels} / ${totalChannels} 판정`,
    );
  }
  return lines;
}
