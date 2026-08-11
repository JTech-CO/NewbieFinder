import type { DiscoveryErrorCode } from "./errors";

/**
 * 정규화 도메인 모델.
 *
 * 이 계층은 Chrome API, React, Zod, fetch 를 import 하지 않는다.
 * 원시 응답은 infrastructure adapter 가 여기로 변환한다.
 */

export type FollowerState = "idle" | "loading" | "ready" | "failed";

export interface StreamCandidate {
  readonly liveId: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly channelImageUrl: string | null;
  readonly liveTitle: string;
  readonly thumbnailUrl: string | null;
  readonly viewerCount: number;
  /** 확인되지 않았으면 null. 0 과 혼동하지 않는다. */
  readonly followerCount: number | null;
  readonly followerState: FollowerState;
  /** 원본 openDate 문자열을 보존한다. */
  readonly startedAtRaw: string;
  /** 파싱 실패 시 null. 실패는 제외 사유가 아니라 정렬 후순위 사유다. */
  readonly startedAtEpoch: number | null;
  readonly adult: boolean;
  readonly verified: boolean;
  readonly categoryName: string | null;
  readonly sourceFetchedAt: number;
}

/** 라이브 목록 keyset 커서. 실측 응답 `content.page.next` 구조. */
export interface LiveCursor {
  readonly concurrentUserCount: number;
  readonly liveId: number;
}

/**
 * 탐색 전략.
 *
 * - `viewer-tail`: 시청자 조건이 켜져 있을 때. keyset 커서를 `시청자 상한 + 1` 에 시드해
 *   조건을 만족하는 구간만 내림차순으로 훑는다. 모든 응답 항목이 조건을 통과하므로 낭비가 없고,
 *   커서가 끝나면 "해당 구간 전체 탐색 완료"를 정직하게 주장할 수 있다.
 * - `latest`: 시청자 조건 없이 팔로워 조건만 켜져 있을 때. 최근 시작한 방송부터 훑는다.
 *   전체 라이브를 대표하지 않으므로 항상 부분 결과다.
 */
export type ScanStrategy = "viewer-tail" | "latest";

/** 이번 탐색이 실제로 커버한 범위. "정직한 데이터" 원칙의 근거가 되는 값이다. */
export interface ScanCoverage {
  readonly strategy: ScanStrategy;
  /** viewer-tail 에서 시드에 사용한 시청자 상한. latest 에서는 null */
  readonly viewerCeiling: number | null;
  /** viewer-tail 에서 지금까지 완전히 훑은 가장 낮은 시청자 수. 아직 없으면 null */
  readonly viewerFrontier: number | null;
  /** 커서를 끝까지 소진했는가 (= 대상 구간을 빠짐없이 훑었는가) */
  readonly exhausted: boolean;
}

export type DiscoveryPhase =
  | "idle"
  | "loading-lives"
  | "loading-followers"
  | "ready"
  | "partial"
  | "error";

export type PartialReason =
  | "page-budget"
  | "channel-budget"
  | "rate-limit"
  | "network"
  | "latest-strategy";

/** 화면에 표시 중인 데이터가 어디서 왔는지. 캐시를 실시간처럼 보이지 않게 한다. */
export type DataOrigin = "none" | "network" | "cache-fresh" | "cache-stale";

export interface DiscoveryState {
  readonly phase: DiscoveryPhase;
  readonly scannedPages: number;
  readonly scannedLives: number;
  readonly resolvedChannels: number;
  readonly unresolvedChannels: number;
  /** 팔로워 판정 대기 중인 후보 수 */
  readonly pendingChannels: number;
  readonly matchedResults: number;
  readonly hasNextPage: boolean;
  readonly coverage: ScanCoverage;
  readonly partialReason: PartialReason | null;
  readonly lastUpdatedAt: number | null;
  readonly dataOrigin: DataOrigin;
  readonly errorCode: DiscoveryErrorCode | null;
  /** openDate 파싱에 실패한 항목 수 (진단용, 제외 사유는 아님) */
  readonly unparsedDates: number;
}

export const INITIAL_SCAN_COVERAGE: ScanCoverage = {
  strategy: "viewer-tail",
  viewerCeiling: null,
  viewerFrontier: null,
  exhausted: false,
};

export const INITIAL_DISCOVERY_STATE: DiscoveryState = {
  phase: "idle",
  scannedPages: 0,
  scannedLives: 0,
  resolvedChannels: 0,
  unresolvedChannels: 0,
  pendingChannels: 0,
  matchedResults: 0,
  hasNextPage: false,
  coverage: INITIAL_SCAN_COVERAGE,
  partialReason: null,
  lastUpdatedAt: null,
  dataOrigin: "none",
  errorCode: null,
  unparsedDates: 0,
};

export interface CacheEntry<T> {
  readonly schemaVersion: number;
  readonly key: string;
  readonly payload: T;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly staleUntil: number;
}

export type CacheFreshness = "fresh" | "stale" | "expired";
