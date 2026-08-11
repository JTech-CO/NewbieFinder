import { CHZZK_WEB_HOST, FINDER_PAGE_PATH } from "../shared/constants";

/**
 * 액션 활성화 규칙.
 *
 * declarativeContent 는 페이지 URL 조건만 본다. DOM 도, 탭 콘텐츠도 읽지 않는다.
 * Content Script 없이 "치지직에서만 아이콘 활성화"를 만족시키기 위한 선택이다.
 */

export const CHZZK_RULE_ID = "enable-newbie-finder-on-chzzk";

/**
 * declarativeContent 의 규칙 메서드는 Promise 를 돌려주지 않는다.
 * removeRules 가 끝나기 전에 addRules 가 실행되면 규칙이 사라질 수 있으므로 콜백으로 직렬화한다.
 */
function removeRules(ids: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.declarativeContent.onPageChanged.removeRules(ids, () => resolve());
  });
}

function addRules(rules: chrome.events.Rule[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.declarativeContent.onPageChanged.addRules(rules, () => resolve());
  });
}

export async function registerActionRules(): Promise<void> {
  // 아이콘은 기본적으로 비활성이다. manifest 의 default_state 와 함께 코드에서도 강제한다.
  await chrome.action.disable();

  await removeRules([CHZZK_RULE_ID]);
  await addRules([
    {
      id: CHZZK_RULE_ID,
      conditions: [
        new chrome.declarativeContent.PageStateMatcher({
          pageUrl: {
            schemes: ["https"],
            hostEquals: CHZZK_WEB_HOST,
          },
        }),
      ],
      actions: [new chrome.declarativeContent.ShowAction()],
    },
  ]);
}

/**
 * Finder 를 새 탭으로 연다. 치지직 탭은 건드리지 않는다.
 *
 * 이미 열린 Finder 탭을 재사용하려면 `tabs.query` 의 url 필터가 필요하고
 * 그건 `tabs` 권한을 요구한다. 최소 권한 원칙을 지키기 위해
 * v1 에서는 항상 새 탭을 연다. 탭 중복 방지는 v1.1 후보다.
 */
export async function openFinderTab(windowId?: number): Promise<void> {
  await chrome.tabs.create({
    url: chrome.runtime.getURL(FINDER_PAGE_PATH),
    ...(windowId !== undefined ? { windowId } : {}),
  });
}
