import { CHZZK_OPEN_DATE_UTC_OFFSET } from "../shared/constants";

/**
 * 날짜 처리.
 *
 * 실측 응답의 `openDate` 는 `"2026-08-11 00:11:17"` 처럼 오프셋이 없다.
 * 값은 한국 표준시(UTC+9) 벽시계이므로 오프셋을 명시적으로 붙여 파싱한다.
 * 브라우저의 로컬 시간대로 암묵 해석되게 두면 해외 사용자에게 9시간이 틀어진다.
 */

const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const HAS_EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * openDate 문자열을 epoch(ms)로 변환한다.
 * 해석할 수 없으면 null 을 반환한다. null 은 방송을 숨기는 사유가 아니다.
 */
export function parseOpenDate(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0) return null;

  if (HAS_EXPLICIT_ZONE.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const match = NAIVE_DATETIME.exec(value);
  if (!match) return null;

  const [, y, mo, d, h, mi, s] = match;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}${CHZZK_OPEN_DATE_UTC_OFFSET}`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 방송 시작 후 경과 시간.
 *  `방금 시작` / `8분 전 시작` / `1시간 12분 전 시작` / `1일 3시간 전 시작`
 */
export function formatElapsedSince(startedAtEpoch: number | null, now: number): string {
  if (startedAtEpoch === null) return "시작 시간 확인 불가";

  const delta = now - startedAtEpoch;
  // 시계 오차 등으로 미래 시각이 오면 방금 시작으로 처리한다.
  if (delta < MINUTE) return "방금 시작";

  if (delta < HOUR) {
    return `${Math.floor(delta / MINUTE)}분 전 시작`;
  }

  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR);
    const minutes = Math.floor((delta % HOUR) / MINUTE);
    return minutes === 0 ? `${hours}시간 전 시작` : `${hours}시간 ${minutes}분 전 시작`;
  }

  const days = Math.floor(delta / DAY);
  const hours = Math.floor((delta % DAY) / HOUR);
  return hours === 0 ? `${days}일 전 시작` : `${days}일 ${hours}시간 전 시작`;
}

let timeFormatter: Intl.DateTimeFormat | null = null;

/** 데이터 갱신 시각. `오전 2:14 갱신` */
export function formatUpdatedAt(epoch: number | null): string {
  if (epoch === null) return "아직 탐색하지 않음";
  timeFormatter ??= new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
  return `${timeFormatter.format(new Date(epoch))} 갱신`;
}

/** 캐시 배지용 상대 표현. `8분 전 갱신` */
export function formatRelativeUpdate(epoch: number | null, now: number): string {
  if (epoch === null) return "갱신 기록 없음";
  const delta = Math.max(0, now - epoch);
  if (delta < MINUTE) return "방금 갱신";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}분 전 갱신`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}시간 전 갱신`;
  return `${Math.floor(delta / DAY)}일 전 갱신`;
}

/** 개발 로그 전용. 사람이 읽는 화면에는 쓰지 않는다. */
export function toIsoString(epoch: number): string {
  return new Date(epoch).toISOString();
}
