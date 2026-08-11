import { defineConfig } from "@playwright/test";
import type { ExtensionOptions } from "./tests/e2e/fixtures";

/**
 * Playwright 설정: Chrome MV3 확장 E2E. 백서 9.3.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 실행 전 준비 (중요)
 *
 *   1) npm run build          → dist/ 에 manifest.json, background.js, finder/index.html 생성
 *   2) npx playwright install chromium
 *   3) npm run test:e2e
 *
 * 이 스위트는 `dist/` 를 unpacked 확장으로 로드한다. 빌드 산출물이 없으면
 * tests/e2e/fixtures.ts 의 빌드 가드가 한국어 안내와 함께 즉시 실패시킨다.
 * dist 경로를 바꾸려면 `--project` 옵션 대신 다음 중 하나를 쓴다.
 *
 *   npx playwright test -- --extension-dist=<경로>   (지원하지 않음)
 *   NF_DIST_DIR=<경로> npx playwright test           (환경 변수)
 *   use: { extensionDist: "<경로>" }                 (아래 project 설정)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * webServer 는 쓰지 않는다. 확장 페이지는 `chrome-extension://` 오리진에서 직접 열리고,
 * 치지직 API 응답은 `page.route` 로 가로채 고정 JSON 을 돌려주므로 네트워크에 의존하지 않는다.
 *
 * 확장을 로드하려면 persistent context 가 필요하고, persistent context 는 프로필 디렉터리를
 * 독점한다. 그래서 병렬 실행을 끄고 worker 를 1개로 둔다.
 */
export default defineConfig<ExtensionOptions>({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  outputDir: "./test-results/e2e",

  fullyParallel: false,
  workers: 1,
  retries: 0,

  // 확장 로드 + React 마운트까지 감안한 여유값. 네트워크를 타지 않으므로 이보다 커질 이유가 없다.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  forbidOnly: Boolean(process.env["CI"]),
  reporter: [["list"]],

  use: {
    // 아래 두 값은 수동으로 만든 persistent context 의 페이지에도 그대로 적용된다.
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    // locale, timezone, viewport 는 launchPersistentContext 옵션이라
    // tests/e2e/fixtures.ts 에서 지정한다. 여기에 두면 적용되지 않는다.
  },

  projects: [
    {
      name: "chromium-extension",
      use: {
        // 빈 문자열이면 <프로젝트 루트>/dist 를 사용한다. NF_DIST_DIR 환경 변수가 우선한다.
        extensionDist: "",
      },
    },
  ],
});
