import { DiscoveryError } from "../../domain/errors";
import { REQUEST_POLICY } from "../../shared/constants";
import { debugLog } from "../../shared/invariant";
import { isAllowedApiUrl } from "../chzzk-web/endpoints";
import { classifyStatus, delay } from "./retry-policy";

/**
 * 공개 JSON 읽기 전용 요청.
 *
 * 인증 정보가 실려 나가지 않도록 브라우저 기본 동작에 의존하지 않고 명시한다.
 *  - credentials: "omit"      쿠키를 보내지 않는다
 *  - redirect: "error"        예상하지 않은 호스트로 따라가지 않는다
 *  - referrerPolicy           Referer 를 흘리지 않는다
 *  - Cookie / Authorization / User-Agent 를 직접 설정하지 않는다 (위장 금지)
 */

export interface FetchJsonOptions {
  /** 사용자 취소(새로고침, 탭 종료)용 시그널 */
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function combineSignals(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeoutSignal]) : timeoutSignal;
}

export async function fetchPublicJson(url: URL, options: FetchJsonOptions = {}): Promise<unknown> {
  if (!isAllowedApiUrl(url)) {
    throw new DiscoveryError("INVALID_RESPONSE");
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new DiscoveryError("NETWORK_OFFLINE");
  }

  const timeoutMs = options.timeoutMs ?? REQUEST_POLICY.timeoutMs;
  const maxAttempts = Math.max(REQUEST_POLICY.maxRetries429, REQUEST_POLICY.maxRetries5xx) + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    options.signal?.throwIfAborted();

    const startedAt = Date.now();
    let response: Response;

    try {
      response = await fetch(url, {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: combineSignals(options.signal, timeoutMs),
      });
    } catch (error) {
      if (isAbortError(error)) {
        // 사용자가 취소한 것이면 그대로 전파해 호출부가 조용히 접게 한다.
        if (options.signal?.aborted) throw error;
        throw new DiscoveryError("REQUEST_TIMEOUT", { cause: error });
      }
      // redirect: "error" 위반과 네트워크 실패는 모두 TypeError 로 온다.
      throw new DiscoveryError("NETWORK_OFFLINE", { cause: error });
    }

    if (response.ok) {
      debugLog({ event: "fetch.ok", at: startedAt, durationMs: Date.now() - startedAt, status: response.status });
      try {
        return (await response.json()) as unknown;
      } catch (error) {
        throw new DiscoveryError("INVALID_RESPONSE", { status: response.status, cause: error });
      }
    }

    const decision = classifyStatus({
      status: response.status,
      attempt,
      retryAfterHeader: response.headers.get("Retry-After"),
      now: Date.now(),
    });

    debugLog({ event: "fetch.retryable", at: startedAt, status: response.status });

    if (!decision.retry) {
      throw new DiscoveryError(decision.code, { status: response.status });
    }
    await delay(decision.delayMs, options.signal);
  }

  throw new DiscoveryError("RATE_LIMITED");
}
