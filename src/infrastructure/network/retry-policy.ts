import type { DiscoveryErrorCode } from "../../domain/errors";
import { REQUEST_POLICY } from "../../shared/constants";

/**
 * 재시도 정책.
 *
 * 재시도는 "일시적 오류 복구"이지 "차단 우회"가 아니다.
 *  - 401/403 은 재시도하지 않는다.
 *  - 429 는 Retry-After 를 우선하되, 지나치게 길면 기다리지 않고 중단한다.
 *  - 5xx 는 한 번만 다시 시도한다.
 */

export type RetryDecision =
  | { readonly retry: true; readonly delayMs: number }
  | { readonly retry: false; readonly code: DiscoveryErrorCode };

/** `Retry-After` 는 초 단위 정수 또는 HTTP-date 다. */
export function parseRetryAfter(header: string | null, now: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed.length === 0) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - now);
  }
  return null;
}

/** 제한된 지수 backoff. 무한 증가시키지 않는다. */
export function backoffDelay(attempt: number): number {
  const raw = REQUEST_POLICY.baseBackoffMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(REQUEST_POLICY.maxBackoffMs, raw);
}

export interface ClassifyInput {
  readonly status: number;
  /** 이 요청을 이미 몇 번 재시도했는지 (첫 시도는 0) */
  readonly attempt: number;
  readonly retryAfterHeader: string | null;
  readonly now: number;
}

export function classifyStatus(input: ClassifyInput): RetryDecision {
  const { status, attempt, retryAfterHeader, now } = input;

  if (status === 429) {
    if (attempt >= REQUEST_POLICY.maxRetries429) {
      return { retry: false, code: "RATE_LIMITED" };
    }
    const retryAfter = parseRetryAfter(retryAfterHeader, now);
    if (retryAfter !== null) {
      // 서버가 오래 기다리라고 하면 대기하지 않고 중단한다. 사용자를 붙잡아 두지 않는다.
      if (retryAfter > REQUEST_POLICY.maxHonoredRetryAfterMs) {
        return { retry: false, code: "RATE_LIMITED" };
      }
      return { retry: true, delayMs: retryAfter };
    }
    return { retry: true, delayMs: backoffDelay(attempt + 1) };
  }

  if (status === 401 || status === 403) {
    return { retry: false, code: "ACCESS_DENIED" };
  }

  if (status >= 500) {
    if (attempt >= REQUEST_POLICY.maxRetries5xx) {
      return { retry: false, code: "INVALID_RESPONSE" };
    }
    return { retry: true, delayMs: backoffDelay(attempt + 1) };
  }

  // 그 외 4xx 는 재시도해도 같은 결과다.
  return { retry: false, code: "INVALID_RESPONSE" };
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
