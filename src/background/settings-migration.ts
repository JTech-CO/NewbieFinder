import { migrateStorage } from "../infrastructure/storage/migrations";
import { debugLog } from "../shared/invariant";

/**
 * 설치·업데이트 시 한 번만 도는 저장소 정리.
 * Service Worker 는 여기까지만 한다. 데이터 탐색은 Finder 페이지의 몫이다.
 */
export async function runInstallMigrations(reason: chrome.runtime.OnInstalledReason): Promise<void> {
  debugLog({ event: `install.${reason}`, at: Date.now() });
  try {
    await migrateStorage();
  } catch {
    // 마이그레이션 실패가 확장 로드를 막아서는 안 된다.
    debugLog({ event: "install.migration.failed", at: Date.now() });
  }
}
