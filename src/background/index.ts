import { debugLog } from "../shared/invariant";
import { openFinderTab, registerActionRules } from "./action-rule";
import { runInstallMigrations } from "./settings-migration";

/**
 * Background Service Worker.
 *
 * 하지 않는 일
 *  - 데이터 탐색, 페이지네이션, 반복 Polling, 대규모 캐시 처리, 치지직 DOM 접근
 */

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await runInstallMigrations(details.reason);
    try {
      await registerActionRules();
    } catch (error) {
      debugLog({ event: "install.rules.failed", at: Date.now() });
      throw error;
    }
  })();
});

chrome.action.onClicked.addListener((tab) => {
  void openFinderTab(tab.windowId);
});
