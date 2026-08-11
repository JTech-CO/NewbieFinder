import { describe, expect, it } from "vitest";

import type { FinderSettings } from "../../src/domain/settings";
import {
  DEFAULT_SETTINGS,
  clampFollowerMax,
  clampInt,
  clampViewerMax,
  describeConditions,
  enforceSettingsInvariants,
  isBaseFilterActive,
  normalizeSettings,
  settingsEqual,
} from "../../src/domain/settings";
import {
  FOLLOWER_FILTER_RANGE,
  SETTINGS_SCHEMA_VERSION,
  VIEWER_FILTER_RANGE,
} from "../../src/shared/constants";
import {
  clearSettings,
  loadSettings,
  saveSettings,
} from "../../src/infrastructure/storage/settings-store";

function makeSettings(overrides: Partial<FinderSettings> = {}): FinderSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function withFilters(options: {
  viewer: boolean;
  follower: boolean;
  recent: boolean;
  viewerMax?: number;
  followerMax?: number;
}): FinderSettings {
  return makeSettings({
    viewerFilter: {
      enabled: options.viewer,
      max: options.viewerMax ?? VIEWER_FILTER_RANGE.fallback,
    },
    followerFilter: {
      enabled: options.follower,
      max: options.followerMax ?? FOLLOWER_FILTER_RANGE.fallback,
    },
    recentFirst: options.recent,
  });
}

describe("clampInt", () => {
  it("하한 아래 값을 최소값으로 보정합니다", () => {
    expect(clampInt(0, 1, 30, 10)).toBe(1);
    expect(clampInt(-7, 1, 30, 10)).toBe(1);
  });

  it("상한 위 값을 최대값으로 보정합니다", () => {
    expect(clampInt(31, 1, 30, 10)).toBe(30);
    expect(clampInt(9_999, 1, 30, 10)).toBe(30);
  });

  it("소수를 반올림합니다", () => {
    expect(clampInt(12.4, 1, 30, 10)).toBe(12);
    expect(clampInt(12.5, 1, 30, 10)).toBe(13);
    expect(clampInt(0.4, 1, 30, 10)).toBe(1);
  });

  it("빈 문자열과 공백 문자열은 기본값으로 되돌립니다", () => {
    expect(clampInt("", 1, 30, 10)).toBe(10);
    expect(clampInt("   ", 1, 30, 10)).toBe(10);
    expect(clampInt("\t\n", 1, 30, 10)).toBe(10);
  });

  it("숫자로 읽을 수 있는 문자열은 숫자로 다룹니다", () => {
    expect(clampInt("7", 1, 30, 10)).toBe(7);
    expect(clampInt(" 7 ", 1, 30, 10)).toBe(7);
    expect(clampInt("31", 1, 30, 10)).toBe(30);
  });

  it("숫자가 아닌 문자열은 기본값으로 되돌립니다", () => {
    expect(clampInt("열 명", 1, 30, 10)).toBe(10);
    expect(clampInt("12명", 1, 30, 10)).toBe(10);
  });

  it("Infinity 와 NaN 은 상한이 아니라 기본값으로 되돌립니다", () => {
    expect(clampInt(Number.POSITIVE_INFINITY, 1, 30, 10)).toBe(10);
    expect(clampInt(Number.NEGATIVE_INFINITY, 1, 30, 10)).toBe(10);
    expect(clampInt(Number.NaN, 1, 30, 10)).toBe(10);
    expect(clampInt("Infinity", 1, 30, 10)).toBe(10);
  });

  it("boolean·undefined·객체는 기본값으로 되돌립니다", () => {
    expect(clampInt(true, 1, 30, 10)).toBe(10);
    expect(clampInt(false, 1, 30, 10)).toBe(10);
    expect(clampInt(undefined, 1, 30, 10)).toBe(10);
    expect(clampInt({}, 1, 30, 10)).toBe(10);
    expect(clampInt([1, 2], 1, 30, 10)).toBe(10);
  });
});

describe("clampViewerMax / clampFollowerMax", () => {
  it("시청자 값 0 은 1 로 보정합니다", () => {
    expect(clampViewerMax(0)).toBe(VIEWER_FILTER_RANGE.min);
    expect(clampViewerMax(0)).toBe(1);
  });

  it("시청자 값 31 은 30 으로 보정합니다", () => {
    expect(clampViewerMax(31)).toBe(VIEWER_FILTER_RANGE.max);
    expect(clampViewerMax(31)).toBe(30);
  });

  it("시청자 값 1 과 30 은 그대로 둡니다", () => {
    expect(clampViewerMax(1)).toBe(1);
    expect(clampViewerMax(30)).toBe(30);
  });

  it("팔로워 값 0 은 1 로 보정합니다", () => {
    expect(clampFollowerMax(0)).toBe(FOLLOWER_FILTER_RANGE.min);
    expect(clampFollowerMax(0)).toBe(1);
  });

  it("팔로워 값 101 은 100 으로 보정합니다", () => {
    expect(clampFollowerMax(101)).toBe(FOLLOWER_FILTER_RANGE.max);
    expect(clampFollowerMax(101)).toBe(100);
  });

  it("팔로워 값 1 과 100 은 그대로 둡니다", () => {
    expect(clampFollowerMax(1)).toBe(1);
    expect(clampFollowerMax(100)).toBe(100);
  });

  it("해석 불가 입력은 각 범위의 기본값으로 되돌립니다", () => {
    expect(clampViewerMax("")).toBe(VIEWER_FILTER_RANGE.fallback);
    expect(clampFollowerMax(Number.NaN)).toBe(FOLLOWER_FILTER_RANGE.fallback);
  });
});

describe("isBaseFilterActive / enforceSettingsInvariants", () => {
  it("조건이 하나라도 켜져 있으면 활성으로 봅니다", () => {
    expect(isBaseFilterActive(withFilters({ viewer: true, follower: false, recent: false }))).toBe(
      true,
    );
    expect(isBaseFilterActive(withFilters({ viewer: false, follower: true, recent: false }))).toBe(
      true,
    );
    expect(isBaseFilterActive(withFilters({ viewer: false, follower: false, recent: false }))).toBe(
      false,
    );
  });

  it("두 필터가 모두 꺼지면 최근 시작 순을 강제로 끕니다", () => {
    const result = enforceSettingsInvariants(
      withFilters({ viewer: false, follower: false, recent: true }),
    );
    expect(result.recentFirst).toBe(false);
  });

  it("조건이 켜져 있으면 최근 시작 순 설정을 유지합니다", () => {
    const viewerOnly = enforceSettingsInvariants(
      withFilters({ viewer: true, follower: false, recent: true }),
    );
    expect(viewerOnly.recentFirst).toBe(true);

    const followerOnly = enforceSettingsInvariants(
      withFilters({ viewer: false, follower: true, recent: true }),
    );
    expect(followerOnly.recentFirst).toBe(true);
  });

  it("바뀔 것이 없으면 같은 객체를 그대로 돌려줍니다", () => {
    const settings = withFilters({ viewer: true, follower: false, recent: false });
    expect(enforceSettingsInvariants(settings)).toBe(settings);
  });
});

describe("normalizeSettings", () => {
  it("객체가 아닌 값은 기본 설정으로 복구합니다", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("깨진 값")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("손상된 필드를 경계값과 기본값으로 되돌립니다", () => {
    const result = normalizeSettings({
      viewerFilter: { enabled: "예", max: 999 },
      followerFilter: { enabled: true, max: -3 },
      recentFirst: "네",
      theme: "light",
    });

    expect(result.viewerFilter.enabled).toBe(DEFAULT_SETTINGS.viewerFilter.enabled);
    expect(result.viewerFilter.max).toBe(30);
    expect(result.followerFilter.enabled).toBe(true);
    expect(result.followerFilter.max).toBe(1);
    expect(result.recentFirst).toBe(false);
    expect(result.theme).toBe("dark");
    expect(result.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it("하위 객체가 없어도 던지지 않습니다", () => {
    const result = normalizeSettings({ recentFirst: true });
    expect(result.viewerFilter.max).toBe(VIEWER_FILTER_RANGE.fallback);
    expect(result.followerFilter.max).toBe(FOLLOWER_FILTER_RANGE.fallback);
  });

  it("저장된 값이 불변식을 어겼으면 복원하면서 바로잡습니다", () => {
    const result = normalizeSettings({
      viewerFilter: { enabled: false, max: 10 },
      followerFilter: { enabled: false, max: 50 },
      recentFirst: true,
    });
    expect(result.recentFirst).toBe(false);
  });
});

describe("describeConditions", () => {
  it("시청자 조건만 켜진 경우", () => {
    expect(
      describeConditions(
        withFilters({ viewer: true, follower: false, recent: false, viewerMax: 10 }),
      ),
    ).toBe("시청자 10명 이하");
  });

  it("시청자 조건 + 최근 시작 순", () => {
    expect(
      describeConditions(
        withFilters({ viewer: true, follower: false, recent: true, viewerMax: 5 }),
      ),
    ).toBe("시청자 5명 이하 · 최근 시작 순");
  });

  it("팔로워 조건만 켜진 경우", () => {
    expect(
      describeConditions(
        withFilters({ viewer: false, follower: true, recent: false, followerMax: 50 }),
      ),
    ).toBe("팔로워 50명 이하");
  });

  it("팔로워 조건 + 최근 시작 순", () => {
    expect(
      describeConditions(
        withFilters({ viewer: false, follower: true, recent: true, followerMax: 100 }),
      ),
    ).toBe("팔로워 100명 이하 · 최근 시작 순");
  });

  it("두 조건이 모두 켜진 경우", () => {
    expect(
      describeConditions(
        withFilters({
          viewer: true,
          follower: true,
          recent: false,
          viewerMax: 3,
          followerMax: 20,
        }),
      ),
    ).toBe("시청자 3명 이하 · 팔로워 20명 이하");
  });

  it("두 조건 + 최근 시작 순", () => {
    expect(
      describeConditions(
        withFilters({
          viewer: true,
          follower: true,
          recent: true,
          viewerMax: 3,
          followerMax: 20,
        }),
      ),
    ).toBe("시청자 3명 이하 · 팔로워 20명 이하 · 최근 시작 순");
  });

  it("조건이 하나도 없으면 선택을 안내합니다", () => {
    expect(describeConditions(withFilters({ viewer: false, follower: false, recent: false }))).toBe(
      "조건을 하나 이상 선택하세요.",
    );
    expect(describeConditions(withFilters({ viewer: false, follower: false, recent: true }))).toBe(
      "조건을 하나 이상 선택하세요.",
    );
  });
});

describe("settingsEqual", () => {
  it("탐색에 영향을 주는 필드가 같으면 같다고 봅니다", () => {
    const a = withFilters({ viewer: true, follower: true, recent: true });
    const b = { ...a, schemaVersion: a.schemaVersion + 1 };
    expect(settingsEqual(a, b)).toBe(true);
  });

  it("조건 값이 다르면 다르다고 봅니다", () => {
    const a = withFilters({ viewer: true, follower: false, recent: false, viewerMax: 10 });
    const b = withFilters({ viewer: true, follower: false, recent: false, viewerMax: 11 });
    expect(settingsEqual(a, b)).toBe(false);
  });

  it("필터 ON/OFF 가 다르면 다르다고 봅니다", () => {
    const a = withFilters({ viewer: true, follower: false, recent: false });
    const b = withFilters({ viewer: false, follower: true, recent: false });
    expect(settingsEqual(a, b)).toBe(false);
  });
});

describe("설정 저장·복원", () => {
  it("저장한 적이 없으면 기본 설정을 돌려줍니다", async () => {
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("필터를 켜고 끈 뒤 저장하면 그대로 복원됩니다", async () => {
    const settings = withFilters({
      viewer: false,
      follower: true,
      recent: true,
      followerMax: 20,
    });

    await expect(saveSettings(settings)).resolves.toBe(true);
    const restored = await loadSettings();

    expect(restored.viewerFilter.enabled).toBe(false);
    expect(restored.followerFilter.enabled).toBe(true);
    expect(restored.followerFilter.max).toBe(20);
    expect(restored.recentFirst).toBe(true);
  });

  it("불변식을 어긴 설정을 저장해도 복원 시 바로잡힙니다", async () => {
    await saveSettings(withFilters({ viewer: false, follower: false, recent: true }));
    const restored = await loadSettings();
    expect(restored.recentFirst).toBe(false);
  });

  it("설정을 지우면 다시 기본 설정으로 돌아갑니다", async () => {
    await saveSettings(withFilters({ viewer: true, follower: true, recent: true }));
    await expect(clearSettings()).resolves.toBe(true);
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("테스트 사이에 저장소가 격리됩니다", async () => {
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });
});
