import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { resetMemoryStores } from "../src/infrastructure/storage/chrome-storage";

/**
 * chrome API 스텁은 두지 않는다. infrastructure/storage/chrome-storage 가
 * chrome 이 없는 환경에서 메모리 폴백으로 동작하므로, 여기서는 테스트 간 격리만 보장한다.
 */
afterEach(() => {
  resetMemoryStores();
});
