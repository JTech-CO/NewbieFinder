import { describe, expect, it } from "vitest";

import {
  formatElapsedSince,
  formatRelativeUpdate,
  formatUpdatedAt,
  parseOpenDate,
  toIsoString,
} from "../../src/domain/date";
import { CHZZK_OPEN_DATE_UTC_OFFSET } from "../../src/shared/constants";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("parseOpenDate", () => {
  it("오프셋이 없는 문자열을 한국 표준시로 해석합니다", () => {
    expect(parseOpenDate("2026-08-11 00:11:17")).toBe(Date.parse("2026-08-11T00:11:17+09:00"));
  });

  it("상수로 선언된 오프셋을 사용합니다", () => {
    expect(CHZZK_OPEN_DATE_UTC_OFFSET).toBe("+09:00");
    expect(parseOpenDate("2026-01-01 00:00:00")).toBe(
      Date.parse(`2026-01-01T00:00:00${CHZZK_OPEN_DATE_UTC_OFFSET}`),
    );
  });

  it("브라우저 로컬 시간대로 암묵 해석하지 않습니다", () => {
    // UTC 기준으로는 전날 15:11:17 이어야 한다.
    const epoch = parseOpenDate("2026-08-11 00:11:17");
    expect(epoch).not.toBeNull();
    expect(new Date(epoch ?? 0).toISOString()).toBe("2026-08-10T15:11:17.000Z");
  });

  it("T 구분자와 초 생략 형식도 받습니다", () => {
    expect(parseOpenDate("2026-08-11T00:11:17")).toBe(Date.parse("2026-08-11T00:11:17+09:00"));
    expect(parseOpenDate("2026-08-11 00:11")).toBe(Date.parse("2026-08-11T00:11:00+09:00"));
  });

  it("앞뒤 공백을 제거하고 해석합니다", () => {
    expect(parseOpenDate("  2026-08-11 00:11:17  ")).toBe(Date.parse("2026-08-11T00:11:17+09:00"));
  });

  it("오프셋이나 Z 가 명시되어 있으면 그대로 신뢰합니다", () => {
    expect(parseOpenDate("2026-08-10T15:11:17Z")).toBe(Date.parse("2026-08-10T15:11:17Z"));
    expect(parseOpenDate("2026-08-11T00:11:17+09:00")).toBe(
      Date.parse("2026-08-11T00:11:17+09:00"),
    );
    expect(parseOpenDate("2026-08-11T09:11:17+18:00")).toBe(
      Date.parse("2026-08-11T09:11:17+18:00"),
    );
  });

  it("해석할 수 없는 값은 null 을 돌려줍니다", () => {
    expect(parseOpenDate("")).toBeNull();
    expect(parseOpenDate("   ")).toBeNull();
    expect(parseOpenDate("어제")).toBeNull();
    expect(parseOpenDate("2026-08-11")).toBeNull();
    expect(parseOpenDate("11/08/2026 00:11:17")).toBeNull();
    expect(parseOpenDate(null)).toBeNull();
    expect(parseOpenDate(undefined)).toBeNull();
    expect(parseOpenDate(1_756_000_000_000)).toBeNull();
    expect(parseOpenDate({ openDate: "2026-08-11 00:11:17" })).toBeNull();
  });

  it("형식은 맞지만 존재하지 않는 날짜는 null 을 돌려줍니다", () => {
    expect(parseOpenDate("2026-13-45 99:99:99")).toBeNull();
  });
});

describe("formatElapsedSince", () => {
  const now = Date.parse("2026-08-11T12:00:00+09:00");

  it("시작 시각을 모르면 그렇게 밝힙니다", () => {
    expect(formatElapsedSince(null, now)).toBe("시작 시간 확인 불가");
  });

  it("1분 미만이면 방금 시작으로 표시합니다", () => {
    expect(formatElapsedSince(now, now)).toBe("방금 시작");
    expect(formatElapsedSince(now - 59_999, now)).toBe("방금 시작");
  });

  it("시계 오차로 미래 시각이 와도 방금 시작으로 처리합니다", () => {
    expect(formatElapsedSince(now + 5 * MINUTE, now)).toBe("방금 시작");
  });

  it("1시간 미만이면 분 단위로 표시합니다", () => {
    expect(formatElapsedSince(now - MINUTE, now)).toBe("1분 전 시작");
    expect(formatElapsedSince(now - 8 * MINUTE, now)).toBe("8분 전 시작");
    expect(formatElapsedSince(now - 59 * MINUTE, now)).toBe("59분 전 시작");
  });

  it("하루 미만이면 시간과 분으로 표시합니다", () => {
    expect(formatElapsedSince(now - HOUR, now)).toBe("1시간 전 시작");
    expect(formatElapsedSince(now - (HOUR + 12 * MINUTE), now)).toBe("1시간 12분 전 시작");
    expect(formatElapsedSince(now - (23 * HOUR + 59 * MINUTE), now)).toBe("23시간 59분 전 시작");
  });

  it("하루 이상이면 일과 시간으로 표시합니다", () => {
    expect(formatElapsedSince(now - DAY, now)).toBe("1일 전 시작");
    expect(formatElapsedSince(now - (DAY + 3 * HOUR), now)).toBe("1일 3시간 전 시작");
    expect(formatElapsedSince(now - (2 * DAY + 30 * MINUTE), now)).toBe("2일 전 시작");
  });
});

describe("formatRelativeUpdate", () => {
  const now = Date.parse("2026-08-11T12:00:00+09:00");

  it("갱신 기록이 없으면 그렇게 밝힙니다", () => {
    expect(formatRelativeUpdate(null, now)).toBe("갱신 기록 없음");
  });

  it("네 구간을 각각 표현합니다", () => {
    expect(formatRelativeUpdate(now - 30_000, now)).toBe("방금 갱신");
    expect(formatRelativeUpdate(now - 8 * MINUTE, now)).toBe("8분 전 갱신");
    expect(formatRelativeUpdate(now - 3 * HOUR, now)).toBe("3시간 전 갱신");
    expect(formatRelativeUpdate(now - 2 * DAY, now)).toBe("2일 전 갱신");
  });

  it("미래 시각은 방금 갱신으로 처리합니다", () => {
    expect(formatRelativeUpdate(now + HOUR, now)).toBe("방금 갱신");
  });
});

describe("formatUpdatedAt", () => {
  it("탐색 기록이 없으면 그렇게 밝힙니다", () => {
    expect(formatUpdatedAt(null)).toBe("아직 탐색하지 않음");
  });

  it("갱신 시각을 사람이 읽는 문구로 만듭니다", () => {
    const text = formatUpdatedAt(Date.parse("2026-08-11T02:14:00+09:00"));
    expect(text.endsWith(" 갱신")).toBe(true);
    expect(text.length).toBeGreaterThan("갱신".length);
  });
});

describe("toIsoString", () => {
  it("개발 로그용 ISO 문자열을 만듭니다", () => {
    expect(toIsoString(Date.parse("2026-08-10T15:11:17Z"))).toBe("2026-08-10T15:11:17.000Z");
  });
});
