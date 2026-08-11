import type { DiscoveryResumeToken, DiscoverySnapshot } from "../application/discovery-events";
import type { DiscoveryErrorCode } from "../domain/errors";
import type { DataOrigin, DiscoveryState, StreamCandidate } from "../domain/models";
import { INITIAL_DISCOVERY_STATE } from "../domain/models";
import type { FinderSettings } from "../domain/settings";
import { DEFAULT_SETTINGS, enforceSettingsInvariants } from "../domain/settings";

/**
 * Finder 탭 수명 동안만 유지되는 UI 상태.
 * 조건 의존 불변식(최근 정렬)은 UI 뿐 아니라 여기에서도 강제된다.
 */
export interface FinderState {
  readonly settings: FinderSettings;
  readonly settingsLoaded: boolean;
  readonly candidates: readonly StreamCandidate[];
  readonly discovery: DiscoveryState;
  /** `계속 탐색` 에 쓸 이어받기 토큰. null 이면 더 볼 구간이 없다. */
  readonly resume: DiscoveryResumeToken | null;
  readonly isRunning: boolean;
  /** 수동 새로고침 쿨다운 계산 기준 */
  readonly lastRefreshAt: number | null;
  readonly noticeDismissed: boolean;
  /** 설정 저장에 실패한 적이 있는지 (STORAGE_FAILURE 고지용) */
  readonly storageFailed: boolean;
}

export const INITIAL_FINDER_STATE: FinderState = {
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  candidates: [],
  discovery: INITIAL_DISCOVERY_STATE,
  resume: null,
  isRunning: false,
  lastRefreshAt: null,
  noticeDismissed: false,
  storageFailed: false,
};

export type FinderAction =
  | { type: "settings/hydrated"; settings: FinderSettings; noticeDismissed: boolean }
  | { type: "settings/changed"; settings: FinderSettings }
  | { type: "settings/save-failed" }
  | { type: "notice/dismissed" }
  | { type: "cache/hydrated"; candidates: readonly StreamCandidate[]; origin: DataOrigin; updatedAt: number; discovery: Partial<DiscoveryState> }
  | { type: "discovery/started"; at: number; manual: boolean }
  | { type: "discovery/snapshot"; snapshot: DiscoverySnapshot }
  | { type: "discovery/finished"; snapshot: DiscoverySnapshot; resume: DiscoveryResumeToken | null }
  | { type: "discovery/failed"; code: DiscoveryErrorCode }
  | { type: "discovery/cancelled" }
  | {
      type: "followers/updated";
      updates: ReadonlyArray<{ channelId: string; followerCount: number | null }>;
    };

export function finderReducer(state: FinderState, action: FinderAction): FinderState {
  switch (action.type) {
    case "settings/hydrated":
      return {
        ...state,
        settings: enforceSettingsInvariants(action.settings),
        settingsLoaded: true,
        noticeDismissed: action.noticeDismissed,
      };

    case "settings/changed": {
      const settings = enforceSettingsInvariants(action.settings);
      if (settings === state.settings) return state;
      return { ...state, settings };
    }

    case "settings/save-failed":
      return { ...state, storageFailed: true };

    case "notice/dismissed":
      return { ...state, noticeDismissed: true };

    case "cache/hydrated":
      return {
        ...state,
        candidates: action.candidates,
        discovery: {
          ...state.discovery,
          ...action.discovery,
          phase: "ready",
          dataOrigin: action.origin,
          lastUpdatedAt: action.updatedAt,
        },
      };

    case "discovery/started":
      return {
        ...state,
        isRunning: true,
        lastRefreshAt: action.manual ? action.at : state.lastRefreshAt,
        discovery: {
          ...state.discovery,
          phase: state.candidates.length > 0 ? state.discovery.phase : "loading-lives",
          errorCode: null,
        },
      };

    case "discovery/snapshot":
      return {
        ...state,
        candidates: action.snapshot.candidates,
        discovery: action.snapshot.state,
      };

    case "discovery/finished":
      return {
        ...state,
        isRunning: false,
        candidates: action.snapshot.candidates,
        discovery: action.snapshot.state,
        resume: action.resume,
      };

    case "discovery/failed":
      return {
        ...state,
        isRunning: false,
        discovery: {
          ...state.discovery,
          // 이전 결과가 있으면 지우지 않는다. 오류는 배너로만 알린다.
          phase: state.candidates.length > 0 ? "partial" : "error",
          errorCode: action.code,
        },
      };

    case "discovery/cancelled":
      return { ...state, isRunning: false };

    case "followers/updated": {
      // 팔로워 조건이 꺼져 있을 때의 Lazy 조회 결과 반영. 결과 포함 여부는 바뀌지 않는다.
      if (action.updates.length === 0) return state;
      const patch = new Map(action.updates.map((u) => [u.channelId, u.followerCount]));
      let changed = false;
      const candidates = state.candidates.map((candidate) => {
        if (!patch.has(candidate.channelId)) return candidate;
        const followerCount = patch.get(candidate.channelId) ?? null;
        changed = true;
        return {
          ...candidate,
          followerCount,
          followerState: followerCount === null ? ("failed" as const) : ("ready" as const),
        };
      });
      if (!changed) return state;
      return {
        ...state,
        candidates,
        discovery: {
          ...state.discovery,
          resolvedChannels: candidates.filter((c) => c.followerState === "ready").length,
          unresolvedChannels: candidates.filter((c) => c.followerState === "failed").length,
        },
      };
    }

    default:
      return state;
  }
}
