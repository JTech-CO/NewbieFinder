/**
 * 불변식 위반은 조용히 넘기지 않는다.
 * 다만 사용자 화면을 통째로 깨뜨리지 않도록, 호출부가 잡을 수 있는 일반 Error 를 던진다.
 */

export class InvariantViolation extends Error {
  override readonly name = "InvariantViolation";

  constructor(message: string) {
    super(`[NewbieFinder] 불변식 위반: ${message}`);
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new InvariantViolation(message);
  }
}

/**
 * switch 문의 모든 분기를 처리했는지 컴파일 타임에 강제한다.
 */
export function assertNever(value: never, message = "처리되지 않은 분기"): never {
  throw new InvariantViolation(`${message}: ${JSON.stringify(value)}`);
}

/**
 * 개발 빌드에서만 남기는 구조화 로그.
 * 원시 응답 전체, 쿠키, 요청 헤더, 사용자 식별 정보는 절대 넘기지 않는다.
 */
export interface DebugEvent {
  event: string;
  at: number;
  durationMs?: number;
  pageIndex?: number;
  status?: number;
  errorCode?: string;
  count?: number;
}

declare const __DEV__: boolean;

export function debugLog(event: DebugEvent): void {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.debug("[NewbieFinder]", event);
  }
}
