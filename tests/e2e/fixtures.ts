import { existsSync } from "node:fs";
import path from "node:path";

import { chromium, expect, test as base } from "@playwright/test";
import type { BrowserContext, Locator, Page, Route } from "@playwright/test";

import { FINDER_PAGE_PATH, STORAGE_KEYS } from "../../src/shared/constants";

/**
 * Chrome MV3 확장 E2E 공용 Fixture.
 *
 * 확장은 `chromium.launchPersistentContext` 로만 로드할 수 있다.
 * userDataDir 을 빈 문자열로 주면 Playwright 가 임시 프로필을 만들고 context 종료 시 정리한다.
 * 테스트마다 새 context 를 만들기 때문에 chrome.storage 도 매번 비어 있는 상태에서 시작한다.
 * (기본값 검증과 설정 복원 검증이 서로 오염되지 않게 하려면 이 격리가 필요하다.)
 *
 * 네트워크 정책: 이 스위트는 실제 치지직 API 를 호출하지 않는다.
 * `page.route` 로 `api.chzzk.naver.com` 을 가로채 고정 JSON 을 돌려준다.
 * 탐색은 Finder 페이지(확장 문서)에서 실행되므로 page 단위 route 로 모두 잡힌다.
 */

export const DEFAULT_VIEWPORT = { width: 1440, height: 900 } as const;

export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

export const CHZZK_API_ROUTE_GLOB = "**/api.chzzk.naver.com/**";

const LIVE_LIST_PATH = "/service/v1/lives";
const CHANNEL_PATH_PREFIX = "/service/v1/channels/";

/* ────────────────────────────────────────────────────────────────────────────
 * 빌드 산출물 위치
 * ──────────────────────────────────────────────────────────────────────────── */

const BUILD_REQUIRED_FILES = ["manifest.json", "background.js", FINDER_PAGE_PATH];

function buildGuidance(candidates: readonly string[]): string {
  return [
    "확장 빌드 산출물을 찾지 못했습니다.",
    "E2E 를 실행하기 전에 `npm run build` 로 dist/ 를 먼저 만들어 주세요.",
    `확인한 경로: ${candidates.join(", ")}`,
  ].join("\n");
}

/** 우선순위: 명시 옵션 → NF_DIST_DIR 환경 변수 → 설정 파일 기준 루트 → testDir 기준 루트. */
export function resolveExtensionDist(option: string, rootDir: string, testDir: string): string {
  const explicit = option.trim() !== "" ? option.trim() : (process.env["NF_DIST_DIR"]?.trim() ?? "");
  const candidates =
    explicit !== ""
      ? [path.resolve(explicit)]
      : [path.resolve(rootDir, "dist"), path.resolve(testDir, "..", "..", "dist")];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(buildGuidance(candidates));
}

/** 빌드가 완료된 dist 인지 확인한다. 반쯤 만들어진 디렉터리를 로드하면 원인을 찾기 어렵다. */
export function assertBuildArtifacts(distDir: string): void {
  const missing = BUILD_REQUIRED_FILES.filter((file) => !existsSync(path.join(distDir, file)));
  if (missing.length > 0) {
    throw new Error(
      [
        `빌드 산출물이 불완전합니다: ${distDir}`,
        `없는 파일: ${missing.join(", ")}`,
        "`npm run build` 를 다시 실행한 뒤 E2E 를 실행해 주세요.",
      ].join("\n"),
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 고정 응답 (네트워크 비의존)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface MockLiveSeed {
  readonly liveId: number;
  /** 32자리 소문자 16진수. CHANNEL_ID_PATTERN 을 만족해야 후보로 살아남는다. */
  readonly channelId: string;
  readonly channelName: string;
  readonly liveTitle: string;
  readonly viewerCount: number;
  readonly followerCount: number;
  readonly startedMinutesAgo: number;
  readonly adult: boolean;
}

/**
 * 기본 조건(시청자 10명 이하)에서 세 항목 모두 통과하도록 구성했다.
 * 팔로워 값은 기본 팔로워 상한(50명)을 기준으로 통과 2건, 제외 1건이 되게 두었다.
 */
export const MOCK_LIVES: readonly MockLiveSeed[] = [
  {
    liveId: 90_001,
    channelId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    channelName: "테스트 채널 하나",
    liveTitle: "조용한 저녁 잡담 방송",
    viewerCount: 3,
    followerCount: 12,
    startedMinutesAgo: 8,
    adult: false,
  },
  {
    liveId: 90_002,
    channelId: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
    channelName: "테스트 채널 둘",
    liveTitle: "처음 켜 보는 인디 게임",
    viewerCount: 7,
    followerCount: 48,
    startedMinutesAgo: 41,
    adult: false,
  },
  {
    liveId: 90_003,
    channelId: "112233445566778899aabbccddeeff00",
    channelName: "테스트 채널 셋",
    liveTitle: "그림 연습 스트리밍",
    viewerCount: 10,
    followerCount: 140,
    startedMinutesAgo: 96,
    adult: false,
  },
];

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** epoch(ms) → 치지직 `openDate` 표기(`YYYY-MM-DD HH:mm:ss`, KST 벽시계). */
export function toChzzkOpenDate(epochMs: number): string {
  const kst = new Date(epochMs + 9 * 60 * 60 * 1_000);
  return (
    `${kst.getUTCFullYear()}-${pad2(kst.getUTCMonth() + 1)}-${pad2(kst.getUTCDate())}` +
    ` ${pad2(kst.getUTCHours())}:${pad2(kst.getUTCMinutes())}:${pad2(kst.getUTCSeconds())}`
  );
}

/** 라이브 목록 고정 응답. `page.next` 를 null 로 두어 한 페이지에서 탐색이 끝나게 한다. */
export function buildLiveListResponse(now: number): unknown {
  return {
    code: 200,
    message: null,
    content: {
      size: MOCK_LIVES.length,
      data: MOCK_LIVES.map((seed) => ({
        liveId: seed.liveId,
        liveTitle: seed.liveTitle,
        // 원격 이미지를 부르지 않도록 썸네일은 null 로 둔다. UI 는 로컬 대체 이미지를 쓴다.
        liveImageUrl: null,
        defaultThumbnailImageUrl: null,
        concurrentUserCount: seed.viewerCount,
        openDate: toChzzkOpenDate(now - seed.startedMinutesAgo * 60_000),
        adult: seed.adult,
        categoryType: "GAME",
        liveCategory: "test_category",
        liveCategoryValue: "테스트 카테고리",
        channel: {
          channelId: seed.channelId,
          channelName: seed.channelName,
          channelImageUrl: null,
          verifiedMark: false,
        },
      })),
      page: { next: null },
    },
  };
}

/**
 * 채널 고정 응답.
 * 알 수 없는 채널에는 실제 API 와 같은 자리표시자(`channelId: null`)를 돌려준다.
 * adapter 가 이 값을 "팔로워 0명"으로 오인하지 않는지도 함께 확인할 수 있다.
 */
export function buildChannelResponse(channelId: string): unknown {
  const seed = MOCK_LIVES.find((item) => item.channelId === channelId);
  if (!seed) {
    return {
      code: 200,
      message: null,
      content: {
        channelId: null,
        channelName: "(알 수 없음)",
        channelImageUrl: null,
        verifiedMark: false,
        channelType: null,
        followerCount: 0,
        openLive: false,
      },
    };
  }
  return {
    code: 200,
    message: null,
    content: {
      channelId: seed.channelId,
      channelName: seed.channelName,
      channelImageUrl: null,
      verifiedMark: false,
      channelType: "STREAMING",
      followerCount: seed.followerCount,
      openLive: true,
    },
  };
}

const RESPONSE_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  // 확장 페이지는 host_permissions 덕분에 CORS 를 타지 않지만, 환경차를 없애려고 명시한다.
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "accept, content-type",
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, headers: RESPONSE_HEADERS, body: JSON.stringify(body) });
}

export interface ChzzkApiMockOptions {
  /** 목 응답의 기준 시각(epoch ms). 지정하지 않으면 설치 시점을 쓴다. */
  readonly now?: number;
}

/**
 * 치지직 API 를 고정 JSON 으로 대체한다.
 * 여기서 처리하지 않은 경로는 404 로 닫아 실제 네트워크로 새어 나가지 않게 한다.
 */
export async function installChzzkApiMock(
  page: Page,
  options: ChzzkApiMockOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now();

  await page.route(CHZZK_API_ROUTE_GLOB, async (route) => {
    const request = route.request();

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: RESPONSE_HEADERS, body: "" });
      return;
    }

    const url = new URL(request.url());

    if (url.pathname === LIVE_LIST_PATH) {
      await fulfillJson(route, buildLiveListResponse(now));
      return;
    }

    if (url.pathname.startsWith(CHANNEL_PATH_PREFIX)) {
      const channelId = decodeURIComponent(url.pathname.slice(CHANNEL_PATH_PREFIX.length));
      await fulfillJson(route, buildChannelResponse(channelId));
      return;
    }

    await fulfillJson(route, { code: 404, message: "not found", content: null }, 404);
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * UI 접근 계약
 *
 * 셀렉터를 한곳에 모아 둔다. Finder UI 마크업이 바뀌면 여기만 고치면 된다.
 * ──────────────────────────────────────────────────────────────────────────── */

export const FILTER_PANEL_LABEL = "뉴비 탐색 조건";

/** Switch 는 `role="switch"` 가 기준이지만 checkbox 구현도 받아 준다. */
function toggleByName(page: Page, name: RegExp): Locator {
  return page.getByRole("switch", { name }).or(page.getByRole("checkbox", { name }));
}

/** 숫자 입력은 `<input type="number">`(spinbutton)가 기준이다. */
function numberFieldByName(page: Page, name: RegExp): Locator {
  return page.getByRole("spinbutton", { name }).or(page.getByRole("textbox", { name }));
}

export const ui = {
  header: (page: Page): Locator => page.getByRole("banner"),
  main: (page: Page): Locator => page.getByRole("main"),
  filterPanel: (page: Page): Locator =>
    page.getByRole("complementary", { name: FILTER_PANEL_LABEL }),
  footer: (page: Page): Locator => page.getByRole("contentinfo"),

  viewerSwitch: (page: Page): Locator => toggleByName(page, /시청자/),
  followerSwitch: (page: Page): Locator => toggleByName(page, /팔로워/),
  recentSortSwitch: (page: Page): Locator => toggleByName(page, /최근 시작/),

  viewerNumber: (page: Page): Locator => numberFieldByName(page, /시청자/),
  followerNumber: (page: Page): Locator => numberFieldByName(page, /팔로워/),

  conditionSummary: (page: Page, text: RegExp): Locator =>
    page.getByRole("complementary", { name: FILTER_PANEL_LABEL }).getByText(text),
} as const;

/** 비활성 여부. `disabled` 속성과 `aria-disabled` 를 모두 인정한다. */
export async function isControlDisabled(locator: Locator): Promise<boolean> {
  if ((await locator.count()) === 0) return false;
  if ((await locator.getAttribute("aria-disabled")) === "true") return true;
  return !(await locator.isEnabled());
}

/** Switch 를 원하는 상태로 만든다. 이미 그 상태면 클릭하지 않는다. */
export async function setToggle(locator: Locator, on: boolean): Promise<void> {
  if ((await locator.isChecked()) !== on) {
    await locator.click();
  }
  await expect(locator).toBeChecked({ checked: on });
}

/** chrome.storage.sync 에 저장된 설정을 읽는다. 저장 완료를 기다릴 때 쓴다. */
export interface StoredSettingsSummary {
  viewerEnabled: boolean;
  viewerMax: number;
  followerEnabled: boolean;
  followerMax: number;
  recentFirst: boolean;
}

export async function readStoredSettings(page: Page): Promise<StoredSettingsSummary | null> {
  return await page.evaluate(async (key: string): Promise<StoredSettingsSummary | null> => {
    const bag = await chrome.storage.sync.get(key);
    const raw = bag[key] as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object") return null;

    const viewer = (raw["viewerFilter"] ?? {}) as Record<string, unknown>;
    const follower = (raw["followerFilter"] ?? {}) as Record<string, unknown>;

    return {
      viewerEnabled: viewer["enabled"] === true,
      viewerMax: Number(viewer["max"]),
      followerEnabled: follower["enabled"] === true,
      followerMax: Number(follower["max"]),
      recentFirst: raw["recentFirst"] === true,
    };
  }, STORAGE_KEYS.settings);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Fixture
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ExtensionOptions {
  /** 로드할 빌드 산출물 디렉터리. 비워 두면 <프로젝트 루트>/dist 를 쓴다. */
  extensionDist: string;
}

export interface OpenFinderOptions {
  /** 치지직 API 목을 설치할지 여부. 기본값 true. */
  readonly mockApi?: boolean;
  /** 목 응답의 기준 시각(epoch ms). */
  readonly now?: number;
}

export type OpenFinder = (options?: OpenFinderOptions) => Promise<Page>;

export interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  finderUrl: string;
  openFinder: OpenFinder;
}

export const test = base.extend<ExtensionOptions & ExtensionFixtures>({
  extensionDist: ["", { option: true }],

  context: async ({ extensionDist }, use, testInfo) => {
    const distDir = resolveExtensionDist(extensionDist, testInfo.config.rootDir, testInfo.project.testDir);
    assertBuildArtifacts(distDir);

    // 확장은 persistent context 에서만 로드된다. 첫 인자가 빈 문자열이면 임시 프로필을 쓴다.
    //
    // 채널은 반드시 `chromium` 이어야 한다. Playwright 의 기본 headless 는
    // chromium-headless-shell 을 쓰는데 그 빌드는 확장을 로드하지 못한다.
    // `chromium` 채널은 새 headless 모드의 완전한 Chromium 을 띄우므로 확장이 동작한다.
    // 그래서 --headless=new 를 직접 넘기지 않는다. Playwright 가 알아서 정한다.
    // 로컬에 그 빌드가 없을 때만 NF_BROWSER_CHANNEL=chrome 처럼 바꿔 쓴다.
    const context = await chromium.launchPersistentContext("", {
      channel: process.env["NF_BROWSER_CHANNEL"]?.trim() || "chromium",
      args: [
        `--disable-extensions-except=${distDir}`,
        `--load-extension=${distDir}`,
        // Chrome 137+ 는 --load-extension 을 기본 차단한다. 안정 채널에서도 로드되게 되돌린다.
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        "--no-first-run",
        "--no-default-browser-check",
      ],
      viewport: { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      colorScheme: "dark",
    });

    /*
     * 트레이싱은 기본으로 끈다.
     *
     * screenshots/snapshots 트레이싱은 테스트마다 새로 띄우는 persistent context 에서
     * 비용이 크고, 정리 단계가 테스트 타임아웃을 넘겨 실패하는 원인이 된다.
     * 실패를 파고들 때만 켠다.
     *
     *   PowerShell : $env:NF_E2E_TRACE="1"; npx playwright test
     *   bash/zsh   : NF_E2E_TRACE=1 npx playwright test
     */
    const tracing = process.env["NF_E2E_TRACE"] === "1";
    if (tracing) {
      await context.tracing.start({ screenshots: true, snapshots: true });
    }

    await use(context);

    if (tracing) {
      if (testInfo.status !== testInfo.expectedStatus) {
        const tracePath = testInfo.outputPath("trace.zip");
        await context.tracing.stop({ path: tracePath });
        await testInfo.attach("trace", { path: tracePath, contentType: "application/zip" });
      } else {
        await context.tracing.stop();
      }
    }

    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // MV3 Service Worker 는 확장 로드 직후 등록된다. 아직이면 등록 이벤트를 기다린다.
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker", { timeout: 15_000 }));

    const id = new URL(worker.url()).host;
    if (!EXTENSION_ID_PATTERN.test(id)) {
      throw new Error(`Service Worker URL 에서 확장 ID 를 읽지 못했습니다: ${worker.url()}`);
    }
    await use(id);
  },

  finderUrl: async ({ extensionId }, use) => {
    await use(`chrome-extension://${extensionId}/${FINDER_PAGE_PATH}`);
  },

  openFinder: async ({ context, finderUrl }, use) => {
    const open: OpenFinder = async (options = {}) => {
      const page = await context.newPage();
      if (options.mockApi !== false) {
        await installChzzkApiMock(page, options.now === undefined ? {} : { now: options.now });
      }
      await page.goto(finderUrl, { waitUntil: "domcontentloaded" });
      // React 마운트 완료 신호로 main 랜드마크를 기다린다.
      await ui.main(page).first().waitFor({ state: "visible", timeout: 20_000 });
      return page;
    };

    await use(open);
  },
});

export { expect };
