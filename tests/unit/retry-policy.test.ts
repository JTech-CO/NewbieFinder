import { describe, expect, it } from "vitest";

import type { RetryDecision } from "../../src/infrastructure/network/retry-policy";
import {
  backoffDelay,
  classifyStatus,
  delay,
  parseRetryAfter,
} from "../../src/infrastructure/network/retry-policy";
import { REQUEST_POLICY } from "../../src/shared/constants";

/** 재시도는 일시 오류 복구이지 차단 우회가 아니다. */

const NOW = Date.parse("2026-08-11T00:00:00Z");

function classify(
  status: number,
  attempt: number,
  retryAfterHeader: string | null = null,
): RetryDecision {
  return classifyStatus({ status, attempt, retryAfterHeader, now: NOW });
}

describe("parseRetryAfter", () => {
  it("초 단위 정수를 밀리초로 바꿉니다", () => {
    expect(parseRetryAfter("5", NOW)).toBe(5_000);
    expect(parseRetryAfter("0", NOW)).toBe(0);
    expect(parseRetryAfter("  3  ", NOW)).toBe(3_000);
    expect(parseRetryAfter("1.5", NOW)).toBe(1_500);
  });

  it("HTTP-date 를 남은 시간으로 바꿉니다", () => {
    expect(parseRetryAfter("Tue, 11 Aug 2026 00:00:10 GMT", NOW)).toBe(10_000);
  });

  it("이미 지난 HTTP-date 는 0 으로 다룹니다", () => {
    expect(parseRetryAfter("Mon, 10 Aug 2026 23:59:30 GMT", NOW)).toBe(0);
  });

  it("헤더가 없거나 비어 있거나 해석 불가하면 null 입니다", () => {
    expect(parseRetryAfter(null, NOW)).toBeNull();
    expect(parseRetryAfter("", NOW)).toBeNull();
    expect(parseRetryAfter("   ", NOW)).toBeNull();
    expect(parseRetryAfter("나중에", NOW)).toBeNull();
  });
});

describe("backoffDelay", () => {
  it("기본 대기에서 시작해 두 배씩 늘어납니다", () => {
    expect(backoffDelay(1)).toBe(REQUEST_POLICY.baseBackoffMs);
    expect(backoffDelay(2)).toBe(REQUEST_POLICY.baseBackoffMs * 2);
    expect(backoffDelay(3)).toBe(REQUEST_POLICY.baseBackoffMs * 4);
  });

  it("상한을 넘지 않습니다", () => {
    expect(backoffDelay(10)).toBe(REQUEST_POLICY.maxBackoffMs);
    expect(backoffDelay(100)).toBe(REQUEST_POLICY.maxBackoffMs);
  });

  it("0 이하의 시도 횟수에서도 음수 대기가 나오지 않습니다", () => {
    expect(backoffDelay(0)).toBe(REQUEST_POLICY.baseBackoffMs);
    expect(backoffDelay(-3)).toBe(REQUEST_POLICY.baseBackoffMs);
  });
});

describe("classifyStatus - 429", () => {
  it("한계 안에서는 backoff 로 재시도합니다", () => {
    expect(classify(429, 0)).toEqual({ retry: true, delayMs: backoffDelay(1) });
    expect(classify(429, 1)).toEqual({ retry: true, delayMs: backoffDelay(2) });
  });

  it("재시도 한계에 도달하면 무한 재시도하지 않고 중단합니다", () => {
    expect(classify(429, REQUEST_POLICY.maxRetries429)).toEqual({
      retry: false,
      code: "RATE_LIMITED",
    });
    expect(classify(429, REQUEST_POLICY.maxRetries429 + 5)).toEqual({
      retry: false,
      code: "RATE_LIMITED",
    });
  });

  it("Retry-After 초 값을 backoff 보다 우선합니다", () => {
    expect(classify(429, 0, "3")).toEqual({ retry: true, delayMs: 3_000 });
    expect(classify(429, 0, "0")).toEqual({ retry: true, delayMs: 0 });
  });

  it("Retry-After HTTP-date 도 존중합니다", () => {
    expect(classify(429, 0, "Tue, 11 Aug 2026 00:00:07 GMT")).toEqual({
      retry: true,
      delayMs: 7_000,
    });
  });

  it("Retry-After 가 지나치게 길면 기다리지 않고 중단합니다", () => {
    const tooLongSeconds = REQUEST_POLICY.maxHonoredRetryAfterMs / 1_000 + 1;
    expect(classify(429, 0, String(tooLongSeconds))).toEqual({
      retry: false,
      code: "RATE_LIMITED",
    });
  });

  it("허용 한계와 같은 Retry-After 는 존중합니다", () => {
    const exactSeconds = REQUEST_POLICY.maxHonoredRetryAfterMs / 1_000;
    expect(classify(429, 0, String(exactSeconds))).toEqual({
      retry: true,
      delayMs: REQUEST_POLICY.maxHonoredRetryAfterMs,
    });
  });

  it("해석할 수 없는 Retry-After 는 backoff 로 대체합니다", () => {
    expect(classify(429, 0, "잠시 후")).toEqual({ retry: true, delayMs: backoffDelay(1) });
  });
});

describe("classifyStatus - 인증·권한", () => {
  it("401 은 재시도하지 않고 즉시 중단합니다", () => {
    expect(classify(401, 0)).toEqual({ retry: false, code: "ACCESS_DENIED" });
  });

  it("403 은 재시도하지 않고 즉시 중단합니다", () => {
    expect(classify(403, 0)).toEqual({ retry: false, code: "ACCESS_DENIED" });
  });

  it("Retry-After 가 있어도 재시도하지 않습니다", () => {
    expect(classify(403, 0, "1")).toEqual({ retry: false, code: "ACCESS_DENIED" });
  });
});

describe("classifyStatus - 5xx", () => {
  it("한 번만 다시 시도합니다", () => {
    expect(classify(500, 0)).toEqual({ retry: true, delayMs: backoffDelay(1) });
    expect(classify(503, 0)).toEqual({ retry: true, delayMs: backoffDelay(1) });
    expect(classify(500, REQUEST_POLICY.maxRetries5xx)).toEqual({
      retry: false,
      code: "INVALID_RESPONSE",
    });
  });

  it("재시도 상한은 1회입니다", () => {
    expect(REQUEST_POLICY.maxRetries5xx).toBe(1);
    expect(classify(502, 1)).toEqual({ retry: false, code: "INVALID_RESPONSE" });
  });
});

describe("classifyStatus - 그 외 4xx", () => {
  it("재시도해도 같은 결과이므로 중단합니다", () => {
    expect(classify(400, 0)).toEqual({ retry: false, code: "INVALID_RESPONSE" });
    expect(classify(404, 0)).toEqual({ retry: false, code: "INVALID_RESPONSE" });
    expect(classify(418, 0)).toEqual({ retry: false, code: "INVALID_RESPONSE" });
  });
});

describe("delay", () => {
  it("0 이하이면 즉시 완료합니다", async () => {
    await expect(delay(0)).resolves.toBeUndefined();
    await expect(delay(-10)).resolves.toBeUndefined();
  });

  it("짧은 대기를 기다립니다", async () => {
    await expect(delay(1)).resolves.toBeUndefined();
  });

  it("이미 중단된 신호에서는 대기하지 않고 거부합니다", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(delay(5_000, controller.signal)).rejects.toBeDefined();
  });

  it("대기 중 중단되면 즉시 거부합니다", async () => {
    const controller = new AbortController();
    const pending = delay(5_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });
});
