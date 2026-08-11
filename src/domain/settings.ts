import {
  FOLLOWER_FILTER_RANGE,
  SETTINGS_SCHEMA_VERSION,
  VIEWER_FILTER_RANGE,
} from "../shared/constants";

export interface FinderSettings {
  readonly schemaVersion: number;
  readonly viewerFilter: {
    readonly enabled: boolean;
    /** 정수, 1..30 */
    readonly max: number;
  };
  readonly followerFilter: {
    readonly enabled: boolean;
    /** 정수, 1..100 */
    readonly max: number;
  };
  readonly recentFirst: boolean;
  readonly theme: "dark";
}

export const DEFAULT_SETTINGS: FinderSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  viewerFilter: { enabled: true, max: VIEWER_FILTER_RANGE.fallback },
  followerFilter: { enabled: false, max: FOLLOWER_FILTER_RANGE.fallback },
  recentFirst: false,
  theme: "dark",
};

/**
 * 입력 정규화.
 * NaN, Infinity, 빈 문자열, 소수, 과도한 숫자를 모두 경계값 또는 fallback 으로 보정한다.
 */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const parsed = typeof value === "boolean" ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function clampViewerMax(value: unknown): number {
  return clampInt(value, VIEWER_FILTER_RANGE.min, VIEWER_FILTER_RANGE.max, VIEWER_FILTER_RANGE.fallback);
}

export function clampFollowerMax(value: unknown): number {
  return clampInt(
    value,
    FOLLOWER_FILTER_RANGE.min,
    FOLLOWER_FILTER_RANGE.max,
    FOLLOWER_FILTER_RANGE.fallback,
  );
}

/** 시청자 또는 팔로워 조건이 하나라도 켜져 있는가. 최근 정렬의 전제 조건이다. */
export function isBaseFilterActive(settings: FinderSettings): boolean {
  return settings.viewerFilter.enabled || settings.followerFilter.enabled;
}

/**
 * 상태 불변식.
 * UI 뿐 아니라 Reducer 와 Selector 어디에서 들어와도 같은 규칙이 강제되어야 한다.
 */
export function enforceSettingsInvariants(settings: FinderSettings): FinderSettings {
  const recentFirst = isBaseFilterActive(settings) && settings.recentFirst;
  if (recentFirst === settings.recentFirst) return settings;
  return { ...settings, recentFirst };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * storage 에서 읽은 임의 값을 안전한 설정으로 되돌린다.
 * 저장된 값이 손상되었거나 이전 스키마여도 기본값으로 복구하고 절대 던지지 않는다.
 */
export function normalizeSettings(raw: unknown): FinderSettings {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SETTINGS;

  const source = raw as Record<string, unknown>;
  const viewer = (source["viewerFilter"] ?? {}) as Record<string, unknown>;
  const follower = (source["followerFilter"] ?? {}) as Record<string, unknown>;

  const normalized: FinderSettings = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    viewerFilter: {
      enabled: asBoolean(viewer["enabled"], DEFAULT_SETTINGS.viewerFilter.enabled),
      max: clampViewerMax(viewer["max"]),
    },
    followerFilter: {
      enabled: asBoolean(follower["enabled"], DEFAULT_SETTINGS.followerFilter.enabled),
      max: clampFollowerMax(follower["max"]),
    },
    recentFirst: asBoolean(source["recentFirst"], DEFAULT_SETTINGS.recentFirst),
    theme: "dark",
  };

  return enforceSettingsInvariants(normalized);
}

/**
 * 현재 조건 자연어 요약.
 * 모든 조합에서 정확해야 한다.
 */
export function describeConditions(settings: FinderSettings): string {
  const parts: string[] = [];
  if (settings.viewerFilter.enabled) parts.push(`시청자 ${settings.viewerFilter.max}명 이하`);
  if (settings.followerFilter.enabled) parts.push(`팔로워 ${settings.followerFilter.max}명 이하`);
  if (parts.length === 0) return "조건을 하나 이상 선택하세요.";
  if (settings.recentFirst) parts.push("최근 시작 순");
  return parts.join(" · ");
}

/** 설정이 탐색 결과에 영향을 주는 방식으로 바뀌었는지 (재정렬만 필요한지 재탐색이 필요한지 구분용) */
export function settingsEqual(a: FinderSettings, b: FinderSettings): boolean {
  return (
    a.viewerFilter.enabled === b.viewerFilter.enabled &&
    a.viewerFilter.max === b.viewerFilter.max &&
    a.followerFilter.enabled === b.followerFilter.enabled &&
    a.followerFilter.max === b.followerFilter.max &&
    a.recentFirst === b.recentFirst
  );
}
