import {
  EXTENSION_ID_PATTERN,
  FILTER_PANEL_LABEL,
  expect,
  isControlDisabled,
  readStoredSettings,
  setToggle,
  test,
  ui,
} from "./fixtures";

/**
 * 확장 E2E. 네트워크 없이 결정적으로 검증 가능한 것만 다룬다.
 *
 * 실행 전 `npm run build` 로 dist/ 를 만들어야 한다. (playwright.config.ts 주석 참고)
 *
 * 여기서 다루지 않는 항목과 이유
 *  - 일반 사이트/치지직에서의 Action 활성 여부, Action 클릭으로 새 탭 열기
 *    → declarativeContent 규칙과 툴바 클릭은 페이지 컨텍스트 밖이라 Playwright 로 구동할 수 없다.
 *  - 새로고침 쿨다운, 브라우저 재시작 후 복원, 확장 제거 시 데이터 삭제
 *    → 실시간 대기 또는 브라우저 수명주기 조작이 필요해 결정성이 떨어진다. 수동 QA 로 남긴다.
 *  - 결과 카드 링크 검증
 *    → 카드 렌더는 탐색 결과에 의존하므로 통합 테스트(tests/integration)에서 다룬다.
 */

test.describe("NewbieFinder 확장", () => {
  test("Service Worker 가 등록됩니다.", async ({ context, extensionId }) => {
    expect(extensionId).toMatch(EXTENSION_ID_PATTERN);

    const workers = context.serviceWorkers();
    expect(workers.length).toBeGreaterThan(0);

    const workerUrl = workers[0]?.url() ?? "";
    expect(workerUrl).toBe(`chrome-extension://${extensionId}/background.js`);
  });

  test("manifest 에 default_popup 이 없습니다.", async ({ context, extensionId }) => {
    const page = await context.newPage();
    const response = await page.goto(`chrome-extension://${extensionId}/manifest.json`);

    expect(response, "manifest.json 응답을 받지 못했습니다.").not.toBeNull();
    const manifest = (await response?.json()) as Record<string, unknown>;

    expect(manifest["manifest_version"]).toBe(3);

    // Action 은 존재하되 팝업을 열지 않아야 한다. 클릭은 Finder 새 탭으로 이어진다.
    const action = manifest["action"] as Record<string, unknown> | undefined;
    expect(action, "manifest 에 action 이 없습니다.").toBeDefined();
    expect(action?.["default_popup"]).toBeUndefined();
    expect(manifest["action_popup"]).toBeUndefined();
    expect(manifest["page_action"]).toBeUndefined();

    const background = manifest["background"] as Record<string, unknown> | undefined;
    expect(background?.["service_worker"]).toBe("background.js");
    expect(background?.["type"]).toBe("module");
  });

  test("Finder 페이지가 열리고 헤더·필터 패널·푸터 랜드마크가 보입니다.", async ({
    openFinder,
  }) => {
    const page = await openFinder();

    await expect(ui.header(page)).toBeVisible();
    await expect(ui.main(page)).toBeVisible();
    await expect(ui.filterPanel(page)).toBeVisible();
    await expect(ui.footer(page)).toBeVisible();

    await expect(page).toHaveTitle(/NewbieFinder/);
    await expect(ui.filterPanel(page)).toHaveAttribute("aria-label", FILTER_PANEL_LABEL);
  });

  test("기본 조건이 시청자 10명 이하로 표시됩니다.", async ({ openFinder }) => {
    const page = await openFinder();

    await expect(ui.viewerSwitch(page)).toBeChecked();
    await expect(ui.followerSwitch(page)).not.toBeChecked();
    await expect(ui.viewerNumber(page)).toHaveValue("10");

    await expect(ui.conditionSummary(page, /시청자\s*10명\s*이하/).first()).toBeVisible();
  });

  test("두 기본 조건을 모두 끄면 최근 시작 순이 비활성화되고 안내 문구가 보입니다.", async ({
    openFinder,
  }) => {
    const page = await openFinder();

    await setToggle(ui.viewerSwitch(page), false);
    await setToggle(ui.followerSwitch(page), false);

    const recent = ui.recentSortSwitch(page);
    await expect
      .poll(async () => await isControlDisabled(recent), {
        message: "최근 시작 순 컨트롤이 비활성(disabled 또는 aria-disabled)이어야 합니다.",
        timeout: 10_000,
      })
      .toBe(true);

    // 색상만으로 비활성을 전달하지 않는다. 이유를 문구로 함께 보여 준다.
    const guidance = page
      .getByText(/조건을 먼저 켜세요/)
      .or(page.getByText("조건을 하나 이상 선택하세요."));
    await expect(guidance.first()).toBeVisible();
  });

  test("시청자 조건을 다시 켜면 최근 시작 순이 활성화됩니다.", async ({ openFinder }) => {
    const page = await openFinder();

    await setToggle(ui.viewerSwitch(page), false);
    await setToggle(ui.followerSwitch(page), false);

    const recent = ui.recentSortSwitch(page);
    await expect.poll(async () => await isControlDisabled(recent), { timeout: 10_000 }).toBe(true);

    await setToggle(ui.viewerSwitch(page), true);

    await expect
      .poll(async () => await isControlDisabled(recent), {
        message: "시청자 조건을 켜면 최근 시작 순을 쓸 수 있어야 합니다.",
        timeout: 10_000,
      })
      .toBe(false);
  });

  test("시청자 숫자 입력에 999 를 넣고 포커스를 벗어나면 30 으로 보정됩니다.", async ({
    openFinder,
  }) => {
    const page = await openFinder();

    const input = ui.viewerNumber(page);
    await input.fill("999");
    await input.blur();

    // VIEWER_FILTER_RANGE.max = 30.
    await expect(input).toHaveValue("30");
    await expect(ui.conditionSummary(page, /시청자\s*30명\s*이하/).first()).toBeVisible();
  });

  test("푸터에 비제휴 고지가 보입니다.", async ({ openFinder }) => {
    const page = await openFinder();

    const notice = ui.footer(page).getByText(/공식 서비스가 아/);
    await expect(notice.first()).toBeVisible();
    await expect(notice.first()).toContainText(/NAVER|CHZZK|치지직/);
  });

  test("페이지를 새로 열어도 마지막 설정이 복원됩니다.", async ({ openFinder }) => {
    const first = await openFinder();

    await setToggle(ui.followerSwitch(first), true);
    const viewerInput = ui.viewerNumber(first);
    await viewerInput.fill("7");
    await viewerInput.blur();
    await expect(viewerInput).toHaveValue("7");

    // 저장은 비동기다. chrome.storage.sync 에 반영될 때까지 기다린 뒤 페이지를 닫는다.
    await expect
      .poll(async () => await readStoredSettings(first), {
        message: "변경한 조건이 chrome.storage.sync 에 저장되어야 합니다.",
        timeout: 15_000,
      })
      .toEqual({
        viewerEnabled: true,
        viewerMax: 7,
        followerEnabled: true,
        followerMax: 50,
        recentFirst: false,
      });

    await first.close();

    const second = await openFinder();
    await expect(ui.viewerSwitch(second)).toBeChecked();
    await expect(ui.followerSwitch(second)).toBeChecked();
    await expect(ui.viewerNumber(second)).toHaveValue("7");
    await expect(ui.followerNumber(second)).toHaveValue("50");
    await expect(
      ui.conditionSummary(second, /시청자\s*7명\s*이하.*팔로워\s*50명\s*이하/).first(),
    ).toBeVisible();
  });
});
